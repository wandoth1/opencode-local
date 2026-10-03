import { GIB, MIB, clamp, finitePositive, type ContextRecommendation, type HardwareSnapshot, type LocalModelMetadata } from "./runtime"
const STEPS = [262144, 196608, 131072, 98304, 65536, 49152, 32768, 24576, 16384, 12288, 8192, 6144, 4096, 2048, 1024, 512, 256]
const DEFAULT_CONTEXT = 16384
const MIN_CONTEXT = 4096
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
  const n = finitePositive(value)
  return n !== undefined && Number.isInteger(n) ? n : undefined
}
export function estimateKvBytesPerToken(model: LocalModelMetadata, bytesPerElement = 2): number | undefined {
  const info = model.modelInfo
  const arch = typeof info["general.architecture"] === "string" ? info["general.architecture"] : model.family
  if (!arch || !finitePositive(bytesPerElement)) return undefined
  const get = (key: string) => finitePositive(info[`${arch}.${key}`])
  const layers = get("block_count")
  const heads = get("attention.head_count")
  const kvHeads = get("attention.head_count_kv") ?? heads
  const embedding = get("embedding_length")
  const fallback = heads && embedding ? embedding / heads : undefined
  const key = get("attention.key_length") ?? fallback
  const value = get("attention.value_length") ?? fallback
  if (!layers || !kvHeads || !key || !value) return undefined
  const result = layers * kvHeads * (key + value) * bytesPerElement
  return finitePositive(result) ? Math.ceil(result) : undefined
}
export function extractContextLength(info: Record<string, unknown>, parameters?: string): number | undefined {
  const arch = typeof info["general.architecture"] === "string" ? info["general.architecture"] : undefined
  const native = arch ? positiveInteger(info[`${arch}.context_length`]) : undefined
  if (native) return native
  const lengths = Object.entries(info).filter(([key]) => key.endsWith(".context_length"))
    .map(([, value]) => positiveInteger(value)).filter((value): value is number => value !== undefined)
  // A Modelfile num_ctx is a requested allocation, not permission to exceed the native maximum.
  if (lengths.length) return Math.min(...lengths)
  return positiveInteger(/(?:^|\n)\s*num_ctx\s+(\d+)/i.exec(parameters ?? "")?.[1])
}
function roundDown(tokens: number) {
  const floor = Math.max(1, Math.floor(tokens))
  return STEPS.find((step) => step <= floor) ?? floor
}
export function recommendContext(input: ContextBudgetInput): ContextRecommendation {
  const modelMaxContextTokens = positiveInteger(input.model.contextLength) ?? DEFAULT_CONTEXT
  const minimum = Math.min(MIN_CONTEXT, modelMaxContextTokens)
  const kv = estimateKvBytesPerToken(input.model, input.kvCacheBytesPerElement ?? 2)
  const size = finitePositive(input.model.fileSizeBytes)
  const loaded = finitePositive(input.loadedSizeVramBytes) ?? 0
  const estimatedModelVramBytes = size ? Math.ceil(size * 1.08 + OVERHEAD) : loaded || OVERHEAD
  const gpus = (input.hardware?.nvidiaGpus ?? []).filter((gpu) =>
    finitePositive(gpu.memoryTotalBytes) && Number.isFinite(gpu.memoryFreeBytes) && gpu.memoryFreeBytes >= 0,
  )
  // /api/ps does not identify the devices holding each model. Never sum GPUs or
  // reclaim an aggregated model allocation on an arbitrary individual GPU.
  const gpu = [...gpus].sort((a, b) => b.memoryFreeBytes - a.memoryFreeBytes)[0]
  const reasons: string[] = ["VRAM and KV values are estimates, not a guarantee of full-GPU residency."]
  let safe = Math.min(DEFAULT_CONTEXT, modelMaxContextTokens)
  let availableVramBytes: number | undefined
  let effective: number | undefined
  let reserve = 0
  let confidence: ContextRecommendation["confidence"] = "low"
  if (!gpu) reasons.push("No local NVIDIA telemetry; no GPU-fit claim can be made.")
  else {
    reserve = Math.max(RESERVE, gpu.memoryTotalBytes * 0.08)
    const free = clamp(gpu.memoryFreeBytes, 0, gpu.memoryTotalBytes)
    const reclaim = gpus.length === 1 ? Math.min(loaded, gpu.memoryTotalBytes - free) : 0
    effective = Math.min(gpu.memoryTotalBytes, free + reclaim)
    if (reclaim) reasons.push("The selected model is already loaded; only its bounded observed allocation was reclaimed.")
    if (gpus.length > 1) reasons.push("Multi-GPU placement is unknown; using one GPU, without reclaiming /api/ps totals.")
    availableVramBytes = Math.max(0, effective - estimatedModelVramBytes - reserve)
    if (kv && size) {
      const raw = Math.floor(availableVramBytes * 0.72 / kv)
      safe = Math.min(modelMaxContextTokens, Math.max(minimum, roundDown(raw)))
      confidence = gpus.length === 1 ? "high" : "low"
      reasons.push("Context was limited by the estimated KV cache and available NVIDIA VRAM.")
    } else {
      if (availableVramBytes === 0) safe = minimum
      reasons.push("Incomplete model size or architecture metadata; GPU fit cannot be established.")
    }
  }
  const requested = positiveInteger(input.requestedContextTokens)
  const recommendedContextTokens = Math.min(modelMaxContextTokens, requested ?? safe)
  if (requested && requested > modelMaxContextTokens) reasons.push("Requested context was capped at the model maximum.")
  if (requested) reasons.push(requested > safe ? "A user context override exceeds the hardware-safe estimate." : "A user context override was applied within the hardware-safe estimate.")
  const estimatedKvVramBytes = kv ? recommendedContextTokens * kv : undefined
  const expectedCpuOffload = effective !== undefined && (
    estimatedModelVramBytes + reserve + (estimatedKvVramBytes ?? 0) > effective
  )
  if (expectedCpuOffload) reasons.push("CPU offload or allocation failure is possible. Reduce context or use a smaller model/quantization.")
  // A pathological 1-token declaration must not be inflated; zero output/history is intentional.
  const recommendedOutputTokens = Math.min(recommendedContextTokens - 1, DEFAULT_OUTPUT, Math.floor(recommendedContextTokens / 4))
  const recommendedHistoryTokens = Math.floor((recommendedContextTokens - recommendedOutputTokens) / 4)
  return { modelMaxContextTokens, recommendedContextTokens, recommendedOutputTokens, recommendedHistoryTokens,
    estimatedModelVramBytes, estimatedKvBytesPerToken: kv, estimatedKvVramBytes, availableVramBytes,
    expectedCpuOffload, confidence, reasons }
}
export function contextRiskLabel(value: ContextRecommendation): "good" | "constrained" | "offload" {
  if (value.expectedCpuOffload) return "offload"
  return value.recommendedContextTokens < DEFAULT_CONTEXT || value.confidence === "low" ? "constrained" : "good"
}
export const ContextBudgetDefaults = { defaultContextTokens: DEFAULT_CONTEXT, minimumContextTokens: MIN_CONTEXT,
  defaultOutputTokens: DEFAULT_OUTPUT, modelRuntimeOverheadBytes: OVERHEAD, minimumGpuReserveBytes: RESERVE,
  referenceConsumerGpuBytes: 12 * GIB } as const
