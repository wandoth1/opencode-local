export const MIB = 1024 * 1024
export const GIB = 1024 * MIB

export type LocalBackend = "ollama" | "llama.cpp"

export interface NvidiaGpuSnapshot {
  index: number
  name: string
  driverVersion?: string
  cudaVersion?: string
  memoryTotalBytes: number
  memoryFreeBytes: number
  memoryUsedBytes: number
  utilizationPercent?: number
}

export interface HardwareSnapshot {
  platform: string
  architecture: string
  cpuModel: string
  cpuCount: number
  systemMemoryTotalBytes: number
  systemMemoryFreeBytes: number
  nvidiaGpus: NvidiaGpuSnapshot[]
}

export interface LocalModelMetadata {
  id: string
  family?: string
  families: string[]
  format?: string
  parameterSize?: string
  quantization?: string
  fileSizeBytes: number
  contextLength?: number
  capabilities: string[]
  modelInfo: Record<string, unknown>
}

export interface RuntimeCapabilities {
  backend: LocalBackend
  endpoint: string
  version?: string
  nativeTransport: boolean
  modelDiscovery: boolean
  modelIntrospection: boolean
  runtimeIntrospection: boolean
}

export interface ContextRecommendation {
  modelMaxContextTokens: number
  recommendedContextTokens: number
  recommendedOutputTokens: number
  recommendedHistoryTokens: number
  estimatedModelVramBytes: number
  estimatedKvBytesPerToken?: number
  estimatedKvVramBytes?: number
  availableVramBytes?: number
  expectedCpuOffload: boolean
  confidence: "high" | "medium" | "low"
  reasons: string[]
}

export interface LocalModelProfile {
  metadata: LocalModelMetadata
  context: ContextRecommendation
  loaded?: {
    sizeBytes?: number
    sizeVramBytes?: number
    contextLength?: number
    expiresAt?: string
  }
}

export function finitePositive(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return number
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "unknown"
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GiB`
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(0)} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`
  return `${Math.round(bytes)} B`
}

function sensitiveKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase()
  return (
    normalized === "headers" ||
    normalized === "header" ||
    normalized === "cookie" ||
    normalized === "cookies" ||
    normalized.includes("apikey") ||
    normalized.includes("authorization") ||
    normalized.includes("accesstoken") ||
    normalized.includes("refreshtoken") ||
    normalized.endsWith("token") ||
    normalized.includes("password") ||
    normalized.includes("secret")
  )
}

export function redactSecrets<T>(value: T): T {
  const seen = new WeakSet<object>()

  const visit = (current: unknown, key?: string): unknown => {
    if (key && sensitiveKey(key)) return "[redacted]"
    if (current === null || current === undefined) return current
    if (typeof current === "function") return "[function]"
    if (typeof current !== "object") return current
    if (seen.has(current)) return "[circular]"
    seen.add(current)

    if (Array.isArray(current)) return current.map((item) => visit(item))
    return Object.fromEntries(Object.entries(current).map(([entryKey, entry]) => [entryKey, visit(entry, entryKey)]))
  }

  return visit(value) as T
}
