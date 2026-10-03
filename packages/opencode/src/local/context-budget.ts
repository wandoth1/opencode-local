import {
  GIB,
  MIB,
  clamp,
  finitePositive,
  type ContextRecommendation,
  type HardwareSnapshot,
  type LocalModelMetadata,
} from "./runtime"

const DEFAULT_CONTEXT = 32768
const DEFAULT_OUTPUT = 8192
const OVERHEAD = 384 * MIB
const RESERVE = 1024 * MIB

export interface ContextBudgetInput {
  model: LocalModelMetadata
  hardware?: HardwareSnapshot
  requestedContextTokens?: number
  loadedSizeVramBytes?: number
  kvCacheBytesPerElement?: number
}

function positiveInteger(value: unknown) {
  const number = finitePositive(value)
  return number !== undefined && Number.isSafeInteger(number) ? number : undefined
}

/** Deliberately not a general estimator for hybrid, sliding-window or MLA models. */
export function estimateKvBytesPerToken(model: LocalModelMetadata, bytesPerElement = 2): number | undefined {
  const info = model.modelInfo
  const arch = typeof info["general.architecture"] === "string" ? info["general.architecture"] : model.family
  if (!arch || !["llama", "qwen2", "qwen3", "mistral"].includes(arch)) return undefined
  if (!finitePositive(bytesPerElement)) return undefined
  if (Object.keys(info).some((key) => /ssm\.|sliding_window|shared_kv|attention\.kv_lora_rank/.test(key))) return undefined
  const get = (key: string) => finitePositive(info[`${arch}.${key}`])
  const layers = get("block_count")
  const heads = get("attention.head_count")
  // Missing or null KV heads do not imply full multi-head attention.
  const kvHeads = get("attention.head_count_kv")
  const embedding = get("embedding_length")
  const fallback = heads && embedding ? embedding / heads : undefined
  const key = get("attention.key_length") ?? fallback
  const value = get("attention.value_length") ?? fallback
  if (!layers || !heads || !kvHeads || kvHeads > heads || !key || !value) return undefined
  const result = layers * kvHeads * (key + value) * bytesPerElement
  return finitePositive(result) ? Math.ceil(result) : undefined
}

export function extractContextLength(info: Record<string, unknown>, parameters?: string): number | undefined {
  const arch = typeof info["general.architecture"] === "string" ? info["general.architecture"] : undefined
  const native = arch ? positiveInteger(info[`${arch}.context_length`]) : undefined
  if (native) return native
  const lengths = Object.entries(info)
    .filter(([key]) => key.endsWith(".context_length"))
    .map(([, value]) => positiveInteger(value))
    .filter((value): value is number => value !== undefined)
  if (lengths.length) return Math.min(...lengths)
  return configuredContextLength(parameters)
}

/** Allocation requested in a Modelfile; keep distinct from the native maximum. */
export function configuredContextLength(parameters?: string) {
  return positiveInteger(/(?:^|\n)\s*num_ctx\s+(\d+)/i.exec(parameters ?? "")?.[1])
}

export function recommendContext(input: ContextBudgetInput): ContextRecommendation {
  const maximum = positiveInteger(input.model.contextLength) ?? DEFAULT_CONTEXT
  const requested = positiveInteger(input.requestedContextTokens)
  // VRAM is advisory. Reducing num_ctx to fit a GPU can make system/tools alone
  // overflow before the first turn. Respect explicit allocations and native caps.
  const context = Math.min(maximum, requested ?? DEFAULT_CONTEXT)
  const kv = estimateKvBytesPerToken(input.model, input.kvCacheBytesPerElement ?? 2)
  const size = finitePositive(input.model.fileSizeBytes)
  const loaded = finitePositive(input.loadedSizeVramBytes) ?? 0
  const weights = size ? Math.ceil(size * 1.08 + OVERHEAD) : loaded || OVERHEAD
  const gpus = (input.hardware?.nvidiaGpus ?? []).filter(
    (gpu) => finitePositive(gpu.memoryTotalBytes) && Number.isFinite(gpu.memoryFreeBytes) && gpu.memoryFreeBytes >= 0,
  )
  const gpu = [...gpus].sort((a, b) => b.memoryFreeBytes - a.memoryFreeBytes)[0]
  const reasons = ["Context is selected for the agent, not reduced to fit transient free VRAM. Memory estimates are advisory."]
  if (requested) reasons.push("An explicit user or Modelfile context allocation was applied.")
  if (requested && requested > maximum) reasons.push("Requested context was capped at the model maximum.")
  if (context < DEFAULT_CONTEXT) reasons.push("Context is below the 32K agent default: system instructions, skills and tool schemas may not fit. Choose a larger window/model if the first turn overflows.")
  if (!kv) reasons.push("KV allocation is unknown for this architecture or incomplete metadata; no per-token GPU-fit estimate is made.")
  if (kv) reasons.push("KV estimate assumes conventional attention and the declared element precision; daemon allocation and concurrency can differ.")
  let availableVramBytes: number | undefined
  let effective: number | undefined
  let reserve = 0
  if (!gpu) reasons.push("No local NVIDIA telemetry; no GPU-fit claim can be made.")
  if (gpu) {
    reserve = Math.max(RESERVE, gpu.memoryTotalBytes * 0.08)
    const free = clamp(gpu.memoryFreeBytes, 0, gpu.memoryTotalBytes)
    const reclaim = gpus.length === 1 ? Math.min(loaded, gpu.memoryTotalBytes - free) : 0
    effective = Math.min(gpu.memoryTotalBytes, free + reclaim)
    if (reclaim) reasons.push("The selected model is already loaded; only its bounded observed allocation was reclaimed.")
    if (gpus.length > 1) reasons.push("Multi-GPU placement is unknown; using one GPU without reclaiming aggregate allocations.")
    availableVramBytes = Math.max(0, effective - weights - reserve)
  }
  const estimatedKvVramBytes = kv && finitePositive(kv * context) ? kv * context : undefined
  const expectedCpuOffload = effective !== undefined && weights + reserve + (estimatedKvVramBytes ?? 0) > effective
  if (expectedCpuOffload) reasons.push("CPU offload or allocation failure is possible. Free resources or use a smaller model; context was not silently reduced.")
  if (requested && availableVramBytes !== undefined && kv && requested * kv > availableVramBytes * 0.72) {
    reasons.push("The context override exceeds the advisory GPU memory estimate.")
  }
  const output = Math.min(context - 1, DEFAULT_OUTPUT, Math.floor(context / 4))
  return {
    modelMaxContextTokens: maximum,
    recommendedContextTokens: context,
    recommendedOutputTokens: output,
    recommendedHistoryTokens: Math.floor((context - output) / 4),
    estimatedModelVramBytes: weights,
    estimatedKvBytesPerToken: kv,
    estimatedKvVramBytes,
    availableVramBytes,
    expectedCpuOffload,
    confidence: gpu && gpus.length === 1 && kv && size ? "medium" : "low",
    reasons,
  }
}

export function contextRiskLabel(value: ContextRecommendation): "good" | "constrained" | "offload" {
  if (value.expectedCpuOffload) return "offload"
  return value.recommendedContextTokens < DEFAULT_CONTEXT || value.confidence === "low" ? "constrained" : "good"
}

export const ContextBudgetDefaults = {
  defaultContextTokens: DEFAULT_CONTEXT,
  minimumContextTokens: DEFAULT_CONTEXT,
  defaultOutputTokens: DEFAULT_OUTPUT,
  modelRuntimeOverheadBytes: OVERHEAD,
  minimumGpuReserveBytes: RESERVE,
  referenceConsumerGpuBytes: 12 * GIB,
} as const
