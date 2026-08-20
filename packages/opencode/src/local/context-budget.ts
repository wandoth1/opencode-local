import {
  GIB,
  MIB,
  clamp,
  finitePositive,
  type ContextRecommendation,
  type HardwareSnapshot,
  type LocalModelMetadata,
} from "./runtime"

const CONTEXT_STEPS = [
  262_144,
  196_608,
  131_072,
  98_304,
  65_536,
  49_152,
  32_768,
  24_576,
  16_384,
  12_288,
  8_192,
  6_144,
  4_096,
  2_048,
]

const DEFAULT_CONTEXT = 16_384
const MIN_CONTEXT = 4_096
const DEFAULT_OUTPUT = 8_192
const MODEL_RUNTIME_OVERHEAD = 384 * MIB
const MIN_GPU_RESERVE = 768 * MIB
const MODEL_SIZE_MULTIPLIER = 1.08
const KV_SAFETY_FACTOR = 0.72

interface ArchitectureShape {
  blockCount?: number
  embeddingLength?: number
  headCount?: number
  headCountKv?: number
}

export interface ContextBudgetInput {
  model: LocalModelMetadata
  hardware?: HardwareSnapshot
  requestedContextTokens?: number
  loadedSizeVramBytes?: number
  kvCacheBytesPerElement?: number
}

function numberAt(info: Record<string, unknown>, key: string): number | undefined {
  return finitePositive(info[key])
}

function architectureShape(model: LocalModelMetadata): ArchitectureShape {
  const info = model.modelInfo
  const architecture =
    (typeof info["general.architecture"] === "string" ? info["general.architecture"] : undefined) ?? model.family
  if (!architecture) return {}
  return {
    blockCount: numberAt(info, `${architecture}.block_count`),
    embeddingLength: numberAt(info, `${architecture}.embedding_length`),
    headCount: numberAt(info, `${architecture}.attention.head_count`),
    headCountKv:
      numberAt(info, `${architecture}.attention.head_count_kv`) ?? numberAt(info, `${architecture}.attention.head_count`),
  }
}

export function estimateKvBytesPerToken(model: LocalModelMetadata, bytesPerElement = 2): number | undefined {
  const shape = architectureShape(model)
  if (!shape.blockCount || !shape.embeddingLength || !shape.headCount || !shape.headCountKv) return undefined
  const headDimension = shape.embeddingLength / shape.headCount
  const result = 2 * shape.blockCount * shape.headCountKv * headDimension * bytesPerElement
  return Number.isFinite(result) && result > 0 ? Math.ceil(result) : undefined
}

export function extractContextLength(modelInfo: Record<string, unknown>, parameters?: string): number | undefined {
  const candidates = Object.entries(modelInfo)
    .filter(([key]) => key.endsWith(".context_length"))
    .flatMap(([, value]) => {
      const parsed = finitePositive(value)
      return parsed === undefined ? [] : [parsed]
    })

  const configured = /(?:^|\n)\s*num_ctx\s+(\d+)/i.exec(parameters ?? "")?.[1]
  const configuredValue = finitePositive(configured)
  if (configuredValue !== undefined) candidates.push(configuredValue)
  if (candidates.length === 0) return undefined
  return Math.max(...candidates)
}

function roundContextDown(tokens: number, minimum = MIN_CONTEXT) {
  const rounded = CONTEXT_STEPS.find((step) => step <= tokens)
  return Math.max(minimum, rounded ?? minimum)
}

function gpuBudget(hardware: HardwareSnapshot | undefined) {
  const gpus = hardware?.nvidiaGpus ?? []
  if (gpus.length === 0) return undefined
  return {
    total: gpus.reduce((sum, gpu) => sum + gpu.memoryTotalBytes, 0),
    free: gpus.reduce((sum, gpu) => sum + gpu.memoryFreeBytes, 0),
    count: gpus.length,
  }
}

function outputBudget(context: number) {
  return roundContextDown(Math.min(DEFAULT_OUTPUT, Math.max(2_048, Math.floor(context / 4))), 2_048)
}

export function recommendContext(input: ContextBudgetInput): ContextRecommendation {
  const modelMaxContextTokens = Math.max(MIN_CONTEXT, input.model.contextLength ?? DEFAULT_CONTEXT)
  const kvBytesPerToken = estimateKvBytesPerToken(input.model, input.kvCacheBytesPerElement ?? 2)
  const fileBasedModelVram =
    input.model.fileSizeBytes > 0
      ? Math.ceil(input.model.fileSizeBytes * MODEL_SIZE_MULTIPLIER + MODEL_RUNTIME_OVERHEAD)
      : undefined
  const estimatedModelVramBytes = fileBasedModelVram ?? input.loadedSizeVramBytes ?? MODEL_RUNTIME_OVERHEAD
  const budget = gpuBudget(input.hardware)
  const reasons: string[] = []

  let safeContext = Math.min(modelMaxContextTokens, DEFAULT_CONTEXT)
  let availableVramBytes: number | undefined
  let estimatedKvVramBytes: number | undefined
  let expectedCpuOffload = false
  let confidence: ContextRecommendation["confidence"] = "low"

  if (!budget) {
    reasons.push("No NVIDIA telemetry was available; using a conservative local default.")
  } else {
    const reserve = Math.max(MIN_GPU_RESERVE, Math.floor(budget.total * 0.08))
    const reclaimableLoadedVram = input.loadedSizeVramBytes ?? 0
    const effectiveFreeVram = budget.free + reclaimableLoadedVram
    availableVramBytes = Math.max(0, effectiveFreeVram - estimatedModelVramBytes - reserve)
    expectedCpuOffload = estimatedModelVramBytes + reserve > effectiveFreeVram
    if (reclaimableLoadedVram > 0) {
      reasons.push("The selected model is already loaded; its observed VRAM was added back before estimating a reload.")
    }
    if (budget.count > 1) reasons.push("VRAM was aggregated across multiple GPUs; actual Ollama placement may differ.")

    if (expectedCpuOffload) {
      safeContext = MIN_CONTEXT
      reasons.push("The model is unlikely to fit completely in available VRAM, so CPU offload is expected.")
      confidence = "medium"
    } else if (kvBytesPerToken) {
      const rawTokens = Math.floor((availableVramBytes * KV_SAFETY_FACTOR) / kvBytesPerToken)
      safeContext = roundContextDown(clamp(rawTokens, MIN_CONTEXT, modelMaxContextTokens))
      estimatedKvVramBytes = safeContext * kvBytesPerToken
      reasons.push("Context was limited by the estimated KV cache and available NVIDIA VRAM.")
      confidence = budget.count === 1 ? "high" : "medium"
    } else {
      safeContext = Math.min(modelMaxContextTokens, DEFAULT_CONTEXT)
      reasons.push("Model architecture metadata was incomplete, so KV cache size could not be calculated exactly.")
      confidence = "medium"
    }
  }

  const requested = finitePositive(input.requestedContextTokens)
  const recommendedContextTokens = requested
    ? roundContextDown(Math.min(requested, modelMaxContextTokens), MIN_CONTEXT)
    : safeContext

  if (requested) {
    if (requested > safeContext) {
      reasons.push("A user context override exceeds the hardware-safe estimate and may cause offload or allocation failure.")
      expectedCpuOffload = expectedCpuOffload || Boolean(budget)
    } else {
      reasons.push("A user context override was applied within the hardware-safe estimate.")
    }
  }

  const recommendedOutputTokens = Math.min(recommendedContextTokens - 1, outputBudget(recommendedContextTokens))
  const recommendedHistoryTokens = Math.max(
    1_024,
    Math.floor((recommendedContextTokens - recommendedOutputTokens) / 4),
  )

  return {
    modelMaxContextTokens,
    recommendedContextTokens,
    recommendedOutputTokens,
    recommendedHistoryTokens,
    estimatedModelVramBytes,
    estimatedKvBytesPerToken: kvBytesPerToken,
    estimatedKvVramBytes,
    availableVramBytes,
    expectedCpuOffload,
    confidence,
    reasons,
  }
}

export function contextRiskLabel(recommendation: ContextRecommendation): "good" | "constrained" | "offload" {
  if (recommendation.expectedCpuOffload) return "offload"
  if (recommendation.recommendedContextTokens < 16_384 || recommendation.confidence === "low") return "constrained"
  return "good"
}

export const ContextBudgetDefaults = {
  defaultContextTokens: DEFAULT_CONTEXT,
  minimumContextTokens: MIN_CONTEXT,
  defaultOutputTokens: DEFAULT_OUTPUT,
  modelRuntimeOverheadBytes: MODEL_RUNTIME_OVERHEAD,
  minimumGpuReserveBytes: MIN_GPU_RESERVE,
  referenceConsumerGpuBytes: 12 * GIB,
} as const
