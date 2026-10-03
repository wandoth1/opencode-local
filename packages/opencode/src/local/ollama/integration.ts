import type { LocalConfig } from "../runtime"
import { detectHardware } from "../hardware"
import { finitePositive, type HardwareSnapshot, type LocalModelProfile, type RuntimeCapabilities } from "../runtime"
import { configuredContextLength } from "../context-budget"
import { OllamaClient, isLoopbackOllamaHost, normalizeOllamaHost, type OllamaDiscoveryModel } from "./client"
import { LocalRuntimeError } from "./errors"
import { object, type Json } from "./io"
import { buildOllamaModel, type OllamaProviderModel } from "./model"
import { createOllamaNativeFetch, type FetchLike } from "./transport"

const PROVIDER_ID = "ollama"
const DEFAULT_HOST = "http://127.0.0.1:11434"
// Provenance belongs to the config instance, is not serialized, and is not a
// module-global cache. Retain the pre-hook provider, never rediscover its output.
const originalProvider = Symbol("opencode.local.original-provider")

export interface OllamaSettings {
  host: string
  explicitHost: boolean
  apiKey?: string
  headers?: Record<string, string>
  timeoutMs: number
  numCtx?: number
  keepAlive?: string
  nativeTransport: boolean
  autoDiscover: boolean
  forceToolCall?: boolean
  forceReasoning?: boolean
  forceVision?: boolean
  kvCacheBytesPerElement: number
  generationTimeoutMs?: number
  timeout?: number | false
  chunkTimeout?: number | false
  headerTimeout?: number | false
}
export interface OllamaIntegrationSnapshot {
  settings: OllamaSettings
  version?: string
  hardware: HardwareSnapshot
  models: Record<string, OllamaProviderModel>
  profiles: Record<string, LocalModelProfile>
  capabilities: RuntimeCapabilities
  warnings?: string[]
}
export interface OllamaOverrides { host?: string; numCtx?: number }
export interface OllamaDependencies { fetch?: FetchLike; hardware?: () => HardwareSnapshot }

function provider(config: LocalConfig): Json { return object(object(config.provider)?.ollama) ?? {} }
function options(config: LocalConfig): Json { return object(provider(config).options) ?? {} }
function endpoint(value: Json): string | undefined {
  const raw = value.host ?? value.nativeBaseURL ?? value.baseURL
  if (raw === undefined) return undefined
  if (typeof raw !== "string") throw new LocalRuntimeError("Ollama host must be a string")
  return normalizeOllamaHost(raw)
}
function integer(value: unknown) {
  const number = finitePositive(value)
  return number !== undefined && Number.isSafeInteger(number) ? number : undefined
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
function timeoutOption(value: unknown): number | false | undefined {
  if (value === undefined || value === false) return value
  if (value === 0 || value === "0") return false
  const number = integer(value)
  if (number === undefined || number > 2147483647) throw new LocalRuntimeError("Ollama timeouts must be false, zero, or positive milliseconds up to 2147483647")
  return number
}

export function originalOllamaConfig(config: LocalConfig): LocalConfig {
  const source = config as LocalConfig & { [originalProvider]?: unknown }
  if (!Object.hasOwn(source, originalProvider)) return config
  return { ...config, provider: { ...object(config.provider), ollama: source[originalProvider] } }
}

/** trustedConfig MUST be Config.getGlobal(), never the project-merged config. */
export function resolveOllamaSettings(config: LocalConfig, trustedConfig: LocalConfig = {}, override: OllamaOverrides = {}): OllamaSettings {
  const merged = options(originalOllamaConfig(config))
  const trusted = options(trustedConfig)
  const dedicated = process.env.OPENCODE_OLLAMA_HOST
  const envRaw = dedicated ?? process.env.OLLAMA_HOST
  const envHost = envRaw !== undefined ? normalizeOllamaHost(envRaw) : undefined
  const globalHost = endpoint(trusted)
  const projectHost = endpoint(merged)
  const cliHost = override.host !== undefined ? normalizeOllamaHost(override.host) : undefined
  const host = cliHost ?? envHost ?? projectHost ?? globalHost ?? DEFAULT_HOST
  if (!isLoopbackOllamaHost(host) && host !== envHost && host !== globalHost && host !== cliHost) {
    throw new LocalRuntimeError("Remote Ollama endpoints must be authorized in global user configuration, environment, or --host")
  }
  const canUseGlobal = host === (globalHost ?? DEFAULT_HOST)
  // OLLAMA_HOST is a daemon bind hint, not an authorization to move a profile key.
  const credentialHost = dedicated !== undefined ? normalizeOllamaHost(dedicated) : globalHost ?? DEFAULT_HOST
  const envKey = host === credentialHost ? process.env.OPENCODE_OLLAMA_API_KEY : undefined
  const globalKey = canUseGlobal && typeof trusted.apiKey === "string" ? trusted.apiKey : undefined
  const generationTimeout = timeoutOption(merged.generationTimeoutMs ?? process.env.OPENCODE_OLLAMA_GENERATION_TIMEOUT_MS)
  return {
    host,
    explicitHost: Boolean(cliHost ?? envHost ?? projectHost ?? globalHost),
    apiKey: envKey ?? globalKey,
    headers: canUseGlobal ? stringHeaders(trusted.headers) : undefined,
    timeoutMs: Math.min(30000, integer(merged.discoveryTimeoutMs) ?? integer(process.env.OPENCODE_OLLAMA_DISCOVERY_TIMEOUT_MS) ?? 5000),
    numCtx: integer(override.numCtx) ?? integer(merged.numCtx) ?? integer(process.env.OPENCODE_OLLAMA_NUM_CTX),
    // Omitting keep_alive preserves the daemon's own OLLAMA_KEEP_ALIVE policy.
    keepAlive: typeof merged.keepAlive === "string" ? merged.keepAlive : process.env.OPENCODE_OLLAMA_KEEP_ALIVE,
    nativeTransport: boolean(merged.nativeTransport) ?? flag("OPENCODE_OLLAMA_NATIVE_TRANSPORT", true),
    autoDiscover: boolean(merged.autoDiscover) ?? flag("OPENCODE_OLLAMA_AUTODETECT", true),
    forceToolCall: boolean(merged.forceToolCall),
    forceReasoning: boolean(merged.forceReasoning),
    forceVision: boolean(merged.forceVision),
    // A client environment is not proof of a daemon's KV-cache setting.
    kvCacheBytesPerElement: finitePositive(process.env.OPENCODE_OLLAMA_KV_BYTES_PER_ELEMENT) ?? 2,
    generationTimeoutMs: generationTimeout === false ? undefined : generationTimeout,
    timeout: timeoutOption(merged.timeout),
    chunkTimeout: timeoutOption(merged.chunkTimeout),
    headerTimeout: timeoutOption(merged.headerTimeout),
  }
}

export function providerAllowed(config: LocalConfig) {
  if (flag("OPENCODE_LOCAL_DISABLE", false)) return false
  return !(Array.isArray(config.disabled_providers) && config.disabled_providers.includes(PROVIDER_ID)) &&
    !(Array.isArray(config.enabled_providers) && !config.enabled_providers.includes(PROVIDER_ID))
}
function staticModels(config: LocalConfig): Record<string, Json> {
  return Object.fromEntries(Object.entries(object(provider(config).models) ?? {}).filter(([, model]) => object(model)))
}
const remoteHardware: HardwareSnapshot = {
  platform: "remote", architecture: "unknown", cpuModel: "unknown", cpuCount: 0,
  systemMemoryTotalBytes: 0, systemMemoryFreeBytes: 0, nvidiaGpus: [],
}

export async function discoverOllama(
  config: LocalConfig,
  settings = resolveOllamaSettings(config),
  dependencies: OllamaDependencies = {},
  strict = false,
): Promise<OllamaIntegrationSnapshot | undefined> {
  if (!providerAllowed(config)) return undefined
  const manual = staticModels(originalOllamaConfig(config))
  if (Object.keys(manual).length > 256) throw new LocalRuntimeError("Select at most 256 manual Ollama models")
  if (!settings.autoDiscover && !Object.keys(manual).length) return undefined
  const client = new OllamaClient({ ...settings, fetch: dependencies.fetch })
  // No cached/static fallback after a failed live connection: doctor must not
  // report success using models belonging to a different or unreachable daemon.
  let discovered: OllamaDiscoveryModel[] = []
  try {
    if (settings.autoDiscover) discovered = await client.discover()
  } catch (error) {
    if (strict) throw error
    return undefined
  }
  const missing = Object.keys(manual).filter((id) => !discovered.some((item) => item.metadata.id === id))
  if (missing.length) discovered.push(...await client.discover(4, missing.map((name) => ({ name }))))
  const chat = discovered.filter((item) => !item.metadata.capabilities.length || item.metadata.capabilities.includes("completion"))
  const [runningResult, versionResult] = await Promise.allSettled([client.running(), client.version()])
  const running = runningResult.status === "fulfilled" ? runningResult.value : []
  const version = versionResult.status === "fulfilled" ? versionResult.value : undefined
  const hardware = isLoopbackOllamaHost(settings.host) ? (dependencies.hardware ?? detectHardware)() : { ...remoteHardware, nvidiaGpus: [] }
  const models: Record<string, OllamaProviderModel> = Object.create(null)
  const profiles: Record<string, LocalModelProfile> = Object.create(null)
  for (const item of chat) {
    const id = item.metadata.id
    if (!id || id.length > 256 || /[\x00-\x1f\x7f]/.test(id)) continue
    const custom = manual[id] ?? {}
    const built = buildOllamaModel(item, {
      openAIBaseURL: client.openAIBaseURL,
      hardware,
      running,
      requestedContextTokens: settings.numCtx ?? integer(custom.limit?.context) ?? configuredContextLength(item.show?.parameters),
      kvCacheBytesPerElement: settings.kvCacheBytesPerElement,
      forceToolCall: boolean(custom.tool_call) ?? settings.forceToolCall,
      forceReasoning: boolean(custom.reasoning) ?? settings.forceReasoning,
      forceVision: boolean(custom.attachment) ?? settings.forceVision,
    })
    if (typeof custom.name === "string") built.model.name = custom.name
    const output = integer(custom.limit?.output)
    if (output) {
      built.model.limit.output = Math.min(output, built.model.limit.context - 1)
      built.profile.context.recommendedOutputTokens = built.model.limit.output
      built.profile.context.recommendedHistoryTokens = Math.floor((built.model.limit.context - built.model.limit.output) / 4)
    }
    models[id] = built.model
    profiles[id] = built.profile
  }
  if (!Object.keys(models).length) {
    if (client.warnings.length) throw new LocalRuntimeError("No model could be introspected. Check /api/show or increase discoveryTimeoutMs; unknown capabilities were not guessed.")
    return undefined
  }
  return {
    settings, version, hardware, models, profiles,
    warnings: [...new Set(client.warnings)],
    capabilities: {
      backend: "ollama", endpoint: settings.host, version,
      nativeTransport: settings.nativeTransport, modelDiscovery: settings.autoDiscover,
      modelIntrospection: chat.some((item) => item.show !== undefined),
      runtimeIntrospection: runningResult.status === "fulfilled",
    },
  }
}

export async function configureOllama(config: LocalConfig, trustedConfig: LocalConfig = {}, dependencies: OllamaDependencies = {}) {
  const mutable = config as unknown as Json
  if (!Object.hasOwn(config, originalProvider)) {
    Object.defineProperty(config, originalProvider, { value: object(config.provider)?.ollama })
  }
  if (!providerAllowed(config)) {
    if (object(mutable.provider)) delete mutable.provider.ollama
    // Also prevent upstream models.dev/auth discovery from reintroducing Ollama.
    mutable.disabled_providers = [...new Set([...(Array.isArray(config.disabled_providers) ? config.disabled_providers : []), PROVIDER_ID])]
    return
  }
  let snapshot: OllamaIntegrationSnapshot | undefined
  try {
    const settings = resolveOllamaSettings(config, trustedConfig)
    snapshot = await discoverOllama(config, settings, dependencies)
  } catch (error) {
    if (object(mutable.provider)) delete mutable.provider.ollama
    if (error instanceof LocalRuntimeError) throw error
    throw new LocalRuntimeError("Ollama provider initialization failed safely. Check the endpoint and discovery timeout.")
  }
  if (!snapshot) { if (object(mutable.provider)) delete mutable.provider.ollama; return }
  const settings = snapshot.settings
  const contexts = Object.fromEntries(Object.entries(snapshot.models).map(([id, model]) => [id, model.limit.context]))
  const toolSupport = Object.fromEntries(Object.entries(snapshot.models).map(([id, model]) => [id, model.tool_call]))
  const transport = createOllamaNativeFetch({
    host: settings.host, contexts, toolSupport, keepAlive: settings.keepAlive,
    enabled: settings.nativeTransport, apiKey: settings.apiKey, headers: settings.headers,
    generationTimeoutMs: settings.generationTimeoutMs, fetch: dependencies.fetch,
  })
  for (const warning of snapshot.warnings ?? []) console.warn(`OpenCode Local: ${warning}`)
  mutable.provider ??= {}
  mutable.provider.ollama = {
    name: "Ollama (OpenCode Local)", npm: "@ai-sdk/openai-compatible", api: `${settings.host}/v1`,
    options: {
      baseURL: `${settings.host}/v1`, apiKey: "ollama", includeUsage: true, fetch: transport,
      timeout: settings.timeout, chunkTimeout: settings.chunkTimeout, headerTimeout: settings.headerTimeout,
    },
    models: snapshot.models,
  }
}

export function diagnosticSnapshot(snapshot: OllamaIntegrationSnapshot) {
  return {
    version: snapshot.version, endpoint: snapshot.settings.host,
    authenticated: Boolean(snapshot.settings.apiKey || snapshot.settings.headers),
    nativeTransport: snapshot.settings.nativeTransport, hardware: snapshot.hardware,
    capabilities: snapshot.capabilities, warnings: snapshot.warnings ?? [],
    models: Object.fromEntries(Object.entries(snapshot.models).map(([id, model]) => [id, {
      name: model.name, limit: model.limit, tools: model.tool_call,
      reasoning: model.reasoning, vision: model.attachment,
      context: snapshot.profiles[id]?.context, loaded: snapshot.profiles[id]?.loaded,
    }])),
  }
}
export const OllamaIntegration = {
  providerID: PROVIDER_ID, configure: configureOllama,
  discover: discoverOllama, resolveSettings: resolveOllamaSettings,
} as const
