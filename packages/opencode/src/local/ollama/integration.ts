import type { Config } from "@opencode-ai/plugin"
import { detectHardware } from "../hardware"
import { finitePositive, type HardwareSnapshot, type LocalModelProfile, type RuntimeCapabilities } from "../runtime"
import { OllamaClient, isLoopbackOllamaHost, normalizeOllamaHost, type OllamaDiscoveryModel } from "./client"
import { object, type Json } from "./io"
import { buildOllamaModel, type OllamaProviderModel } from "./model"
import { createOllamaNativeFetch, type FetchLike } from "./transport"
const PROVIDER_ID = "ollama"
const DEFAULT_HOST = "http://127.0.0.1:11434"
export interface OllamaSettings {
  host: string; explicitHost: boolean; apiKey?: string; headers?: Record<string, string>
  timeoutMs: number; numCtx?: number; keepAlive: string; nativeTransport: boolean; autoDiscover: boolean
  forceToolCall?: boolean; forceReasoning?: boolean; forceVision?: boolean; kvCacheBytesPerElement: number
}
export interface OllamaIntegrationSnapshot {
  settings: OllamaSettings; version?: string; hardware: HardwareSnapshot
  models: Record<string, OllamaProviderModel>; profiles: Record<string, LocalModelProfile>; capabilities: RuntimeCapabilities
}
export interface OllamaOverrides { host?: string; numCtx?: number }
export interface OllamaDependencies { fetch?: FetchLike; hardware?: () => HardwareSnapshot }
function provider(config: Config): Json { return object(object((config as unknown as Json).provider)?.ollama) ?? {} }
function options(config: Config): Json { return object(provider(config).options) ?? {} }
function endpoint(value: Json): string | undefined {
  const raw = value.host ?? value.nativeBaseURL ?? value.baseURL
  if (raw === undefined) return undefined
  if (typeof raw !== "string") throw new Error("Ollama host must be a string")
  return normalizeOllamaHost(raw)
}
function integer(value: unknown) {
  const n = finitePositive(value)
  return n && Number.isSafeInteger(n) ? n : undefined
}
function flag(name: string, fallback: boolean) {
  const value = process.env[name]
  return value === undefined ? fallback : !["0", "false", "no", "off"].includes(value.trim().toLowerCase())
}
function boolean(value: unknown): boolean | undefined { return typeof value === "boolean" ? value : undefined }
function stringHeaders(value: unknown): Record<string, string> | undefined {
  const source = object(value)
  return source ? Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : undefined
}
/** trustedConfig MUST be Config.getGlobal(), never the project-merged config. */
export function resolveOllamaSettings(config: Config, trustedConfig: Config = {} as Config, override: OllamaOverrides = {}): OllamaSettings {
  const merged = options(config), trusted = options(trustedConfig)
  const envRaw = process.env.OPENCODE_OLLAMA_HOST ?? process.env.OLLAMA_HOST
  const envHost = envRaw !== undefined ? normalizeOllamaHost(envRaw) : undefined
  const globalHost = endpoint(trusted)
  const projectHost = endpoint(merged)
  const cliHost = override.host !== undefined ? normalizeOllamaHost(override.host) : undefined
  const host = cliHost ?? envHost ?? projectHost ?? globalHost ?? DEFAULT_HOST
  if (!isLoopbackOllamaHost(host) && host !== envHost && host !== globalHost && host !== cliHost) {
    throw new Error("Remote Ollama endpoints must be authorized in global user configuration, environment, or --host")
  }
  // Bind credentials to the COMPLETE normalized endpoint, including path and port.
  // A loopback redirect to a different service is not a reason to inherit credentials.
  const canUseGlobal = host === (globalHost ?? DEFAULT_HOST)
  const canUseEnvironment = host === (envHost ?? DEFAULT_HOST)
  const envKey = canUseEnvironment ? process.env.OPENCODE_OLLAMA_API_KEY : undefined
  const globalKey = canUseGlobal && typeof trusted.apiKey === "string" ? trusted.apiKey : undefined
  return { host, explicitHost: Boolean(cliHost ?? envHost ?? projectHost ?? globalHost), apiKey: envKey ?? globalKey,
    headers: canUseGlobal ? stringHeaders(trusted.headers) : undefined,
    timeoutMs: Math.min(30000, integer(merged.discoveryTimeoutMs) ?? integer(process.env.OPENCODE_OLLAMA_DISCOVERY_TIMEOUT_MS) ?? 1500),
    numCtx: integer(override.numCtx) ?? integer(merged.numCtx) ?? integer(process.env.OPENCODE_OLLAMA_NUM_CTX),
    keepAlive: typeof merged.keepAlive === "string" ? merged.keepAlive : process.env.OPENCODE_OLLAMA_KEEP_ALIVE ?? "10m",
    nativeTransport: boolean(merged.nativeTransport) ?? flag("OPENCODE_OLLAMA_NATIVE_TRANSPORT", true),
    autoDiscover: boolean(merged.autoDiscover) ?? flag("OPENCODE_OLLAMA_AUTODETECT", true),
    forceToolCall: boolean(merged.forceToolCall), forceReasoning: boolean(merged.forceReasoning), forceVision: boolean(merged.forceVision),
    // This is an explicit estimation override; the client cannot inspect daemon environment variables.
    kvCacheBytesPerElement: finitePositive(process.env.OPENCODE_OLLAMA_KV_BYTES_PER_ELEMENT) ?? 2 }
}
export function providerAllowed(config: Config) {
  if (flag("OPENCODE_LOCAL_DISABLE", false)) return false
  const value = config as unknown as Json
  return !(Array.isArray(value.disabled_providers) && value.disabled_providers.includes(PROVIDER_ID)) &&
    !(Array.isArray(value.enabled_providers) && !value.enabled_providers.includes(PROVIDER_ID))
}
function staticModels(config: Config): Record<string, Json> {
  return Object.fromEntries(Object.entries(object(provider(config).models) ?? {}).filter(([, model]) => object(model)))
}
const remoteHardware: HardwareSnapshot = { platform: "remote", architecture: "unknown", cpuModel: "unknown", cpuCount: 0,
  systemMemoryTotalBytes: 0, systemMemoryFreeBytes: 0, nvidiaGpus: [] }
/** No module-global snapshots or credential caches: each project gets an independent discovery. */
export async function discoverOllama(config: Config, settings = resolveOllamaSettings(config), dependencies: OllamaDependencies = {}): Promise<OllamaIntegrationSnapshot | undefined> {
  if (!providerAllowed(config)) return undefined
  const manual = staticModels(config)
  if (!settings.autoDiscover && !Object.keys(manual).length) return undefined
  const client = new OllamaClient({ ...settings, fetch: dependencies.fetch })
  let discovered: OllamaDiscoveryModel[] = []
  if (settings.autoDiscover) {
    try { discovered = await client.discover() }
    catch { if (!Object.keys(manual).length) return undefined }
  }
  // Embedding-only models must never be advertised as coding-agent chat models.
  discovered = discovered.filter((item) => !item.metadata.capabilities.length || item.metadata.capabilities.includes("completion"))
  const [runningResult, versionResult] = await Promise.allSettled([client.running(), client.version()])
  const running = runningResult.status === "fulfilled" ? runningResult.value : []
  const version = versionResult.status === "fulfilled" ? versionResult.value : undefined
  const hardware = isLoopbackOllamaHost(settings.host) ? (dependencies.hardware ?? detectHardware)() : { ...remoteHardware, nvidiaGpus: [] }
  const models: Record<string, OllamaProviderModel> = Object.create(null)
  const profiles: Record<string, LocalModelProfile> = Object.create(null)
  const items = new Map(discovered.map((item) => [item.metadata.id, item]))
  for (const id of Object.keys(manual)) if (!items.has(id)) items.set(id, { tag: { name: id }, metadata: {
    id, families: [], fileSizeBytes: 0, contextLength: Math.min(integer(manual[id].limit?.context) ?? 16384, 16384), capabilities: [], modelInfo: {} } })
  for (const [id, item] of items) {
    if (!id || id.length > 256 || /[\x00-\x1f\x7f]/.test(id)) continue
    const custom = manual[id] ?? {}
    const built = buildOllamaModel(item, { openAIBaseURL: client.openAIBaseURL, hardware, running,
      requestedContextTokens: settings.numCtx ?? integer(custom.limit?.context), kvCacheBytesPerElement: settings.kvCacheBytesPerElement,
      forceToolCall: boolean(custom.tool_call) ?? settings.forceToolCall,
      forceReasoning: boolean(custom.reasoning) ?? settings.forceReasoning,
      forceVision: boolean(custom.attachment) ?? settings.forceVision })
    if (typeof custom.name === "string") built.model.name = custom.name
    const output = integer(custom.limit?.output)
    if (output) {
      built.model.limit.output = Math.min(output, built.model.limit.context - 1)
      built.profile.context.recommendedOutputTokens = built.model.limit.output
      built.profile.context.recommendedHistoryTokens = Math.floor((built.model.limit.context - built.model.limit.output) / 4)
    }
    // Network/auth/npm/fetch/id overrides in project or per-model config are intentionally not copied.
    models[id] = built.model
    profiles[id] = built.profile
  }
  if (!Object.keys(models).length) return undefined
  return { settings, version, hardware, models, profiles, capabilities: { backend: "ollama", endpoint: settings.host, version,
    nativeTransport: settings.nativeTransport, modelDiscovery: settings.autoDiscover,
    modelIntrospection: discovered.some((item) => item.show !== undefined), runtimeIntrospection: runningResult.status === "fulfilled" } }
}
export async function configureOllama(config: Config, trustedConfig: Config = {} as Config, dependencies: OllamaDependencies = {}) {
  const mutable = config as unknown as Json
  if (!providerAllowed(config)) return
  let settings: OllamaSettings
  try { settings = resolveOllamaSettings(config, trustedConfig) }
  catch (error) {
    // Plugin errors are swallowed by OpenCode. Remove the unsafe fallback provider before throwing.
    if (mutable.provider) delete mutable.provider.ollama
    throw error
  }
  const snapshot = await discoverOllama(config, settings, dependencies)
  if (!snapshot) { if (mutable.provider) delete mutable.provider.ollama; return }
  const contexts = Object.fromEntries(Object.entries(snapshot.models).map(([id, model]) => [id, model.limit.context]))
  const transport = createOllamaNativeFetch({ host: settings.host, contexts, keepAlive: settings.keepAlive,
    enabled: settings.nativeTransport, apiKey: settings.apiKey, headers: settings.headers, fetch: dependencies.fetch })
  mutable.provider ??= {}
  mutable.provider.ollama = { name: "Ollama (OpenCode Local)", npm: "@ai-sdk/openai-compatible", api: `${settings.host}/v1`,
    options: {
      baseURL: `${settings.host}/v1`, apiKey: "ollama", includeUsage: true, fetch: transport,
      // Retain only safe runtime settings so doctor sees the effective project settings even after the config hook.
      numCtx: settings.numCtx, keepAlive: settings.keepAlive, discoveryTimeoutMs: settings.timeoutMs,
      nativeTransport: settings.nativeTransport, autoDiscover: settings.autoDiscover,
      forceToolCall: settings.forceToolCall, forceReasoning: settings.forceReasoning, forceVision: settings.forceVision,
    }, models: snapshot.models }
}
/** Explicit allowlist: never serialize arbitrary config, headers, fetch closures or a model's raw metadata. */
export function diagnosticSnapshot(snapshot: OllamaIntegrationSnapshot) {
  return { version: snapshot.version, endpoint: snapshot.settings.host, authenticated: Boolean(snapshot.settings.apiKey || snapshot.settings.headers),
    nativeTransport: snapshot.settings.nativeTransport, hardware: snapshot.hardware, capabilities: snapshot.capabilities,
    models: Object.fromEntries(Object.entries(snapshot.models).map(([id, model]) => [id, { name: model.name, limit: model.limit,
      tools: model.tool_call, reasoning: model.reasoning, vision: model.attachment, context: snapshot.profiles[id]?.context,
      loaded: snapshot.profiles[id]?.loaded }])) }
}
export const OllamaIntegration = { providerID: PROVIDER_ID, configure: configureOllama, discover: discoverOllama, resolveSettings: resolveOllamaSettings } as const
