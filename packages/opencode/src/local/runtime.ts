export const MIB = 1024 * 1024
export const GIB = 1024 * MIB
export type LocalBackend = "ollama" | "llama.cpp"
/** Narrow configuration boundary shared by the current core and older plugin SDK.
 * Other fields (including agent permissions) are deliberately outside this module. */
export interface LocalConfig {
  provider?: unknown
  enabled_providers?: unknown
  disabled_providers?: unknown
  model?: unknown
}
export interface NvidiaGpuSnapshot {
  index: number
  name: string
  driverVersion?: string
  /** Maximum CUDA version supported by the driver, not an installed CUDA toolkit. */
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
  loaded?: { sizeBytes?: number; sizeVramBytes?: number; contextLength?: number; expiresAt?: string }
}
export function finitePositive(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined
  const number = Number(value)
  return Number.isFinite(number) && number > 0 && number <= Number.MAX_SAFE_INTEGER ? number : undefined
}
export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "unknown"
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GiB`
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(0)} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`
  return `${Math.round(bytes)} B`
}
function sensitiveKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase()
  return /cookie|apikey|authorization|token|password|secret|credential|bearer/.test(normalized) || normalized === "auth" || normalized === "header" || normalized.endsWith("headers")
}
export function redactSecrets(value: unknown): unknown {
  const seen = new WeakSet<object>()
  const visit = (current: unknown, key?: string, depth = 0): unknown => {
    if (key && sensitiveKey(key)) return "[redacted]"
    if (typeof current === "function") return "[function]"
    if (typeof current === "string") {
      // Defense in depth. Doctor exports an allowlisted snapshot, not arbitrary config.
      if (/^(?:bearer|basic)\s+/i.test(current)) return "[redacted]"
      if (/^https?:\/\//i.test(current)) {
        try {
          const url = new URL(current)
          url.username = ""
          url.password = ""
          url.search = ""
          url.hash = ""
          return url.toString()
        } catch { return "[invalid URL]" }
      }
      return current
    }
    if (current === null || typeof current !== "object") return current
    if (depth > 20) return "[depth limit]"
    if (seen.has(current)) return "[circular]"
    seen.add(current)
    const result = Array.isArray(current)
      ? current.map((item) => visit(item, undefined, depth + 1))
      : Object.fromEntries(Object.entries(current).map(([name, entry]) => [name, visit(entry, name, depth + 1)]))
    seen.delete(current)
    return result
  }
  return visit(value)
}
