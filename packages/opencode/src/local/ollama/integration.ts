import type { Config } from "@opencode-ai/plugin"
import { detectHardware } from "../hardware"
import type { HardwareSnapshot, LocalModelProfile, RuntimeCapabilities } from "../runtime"
import { OllamaClient, isLoopbackOllamaHost, normalizeOllamaHost } from "./client"
import { buildOllamaModel, type OllamaProviderModel } from "./model"
import { createOllamaNativeFetch, type FetchLike } from "./transport"

const PROVIDER_ID = "ollama"
const CACHE_TTL_MS = 30_000

export interface OllamaSettings {
  host: string
  explicitHost: boolean
  apiKey?: string
  headers?: Record<string, string>
  timeoutMs: number
  numCtx?: number
  keepAlive: string
  nativeTransport: boolean
  autoDiscover: boolean
  forceToolCall?: boolean
  forceReasoning?: boolean
  forceVision?: boolean
}

type ProviderModelConfig = {
  limit?: {
    context?: number
    output?: number
  }
  [key: string]: unknown
}

type LocalProviderModelConfig = OllamaProviderModel | ProviderModelConfig

type ProviderConfig = {
  name?: string
  npm?: string
  api?: string
  options?: Record<string, any>
  models?: Record<string, LocalProviderModelConfig>
  [key: string]: unknown
}

type MutableProviderConfig = {
  provider?: Record<string, ProviderConfig>
}

export interface OllamaIntegrationSnapshot {
  settings: OllamaSettings
  version?: string
  hardware: HardwareSnapshot
  models: Record<string, LocalProviderModelConfig>
  profiles: Record<string, LocalModelProfile>
  capabilities: RuntimeCapabilities
}

const cache = new Map<string, { expires: number; promise: Promise<OllamaIntegrationSnapshot | undefined> }>()
let latestSnapshot: OllamaIntegrationSnapshot | undefined

function envBoolean(name: string, fallback: boolean) {
  const value = process.env[name]
  if (value === undefined) return fallback
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase())
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

function mutableConfig(config: Config): MutableProviderConfig {
  return config as unknown as MutableProviderConfig
}

function configuredProvider(config: Config): ProviderConfig {
  const provider = mutableConfig(config).provider?.[PROVIDER_ID]
  return provider && typeof provider === "object" ? provider : {}
}

function providerOptions(config: Config): Record<string, any> {
  const options = configuredProvider(config).options
  return options && typeof options === "object" ? options : {}
}

export function resolveOllamaSettings(config: Config): OllamaSettings {
  const options = providerOptions(config)
  const configuredHost = options.host ?? options.nativeBaseURL ?? options.baseURL
  const environmentHost = process.env.OPENCODE_OLLAMA_HOST ?? process.env.OLLAMA_HOST
  const host = normalizeOllamaHost(String(configuredHost ?? environmentHost ?? "http://127.0.0.1:11434"))
  const explicitHost = Boolean(configuredHost ?? environmentHost)
  const timeoutMs =
    positiveInteger(options.discoveryTimeoutMs) ??
    positiveInteger(process.env.OPENCODE_OLLAMA_DISCOVERY_TIMEOUT_MS) ??
    1_500
  const numCtx = positiveInteger(options.numCtx) ?? positiveInteger(process.env.OPENCODE_OLLAMA_NUM_CTX)

  return {
    host,
    explicitHost,
    apiKey: typeof options.apiKey === "string" ? options.apiKey : process.env.OPENCODE_OLLAMA_API_KEY,
    headers: options.headers && typeof options.headers === "object" ? options.headers : undefined,
    timeoutMs,
    numCtx,
    keepAlive: String(options.keepAlive ?? process.env.OPENCODE_OLLAMA_KEEP_ALIVE ?? "10m"),
    nativeTransport:
      typeof options.nativeTransport === "boolean"
        ? options.nativeTransport
        : envBoolean("OPENCODE_OLLAMA_NATIVE_TRANSPORT", true),
    autoDiscover:
      typeof options.autoDiscover === "boolean" ? options.autoDiscover : envBoolean("OPENCODE_OLLAMA_AUTODETECT", true),
    forceToolCall: typeof options.forceToolCall === "boolean" ? options.forceToolCall : undefined,
    forceReasoning: typeof options.forceReasoning === "boolean" ? options.forceReasoning : undefined,
    forceVision: typeof options.forceVision === "boolean" ? options.forceVision : undefined,
  }
}

function providerAllowed(config: Config) {
  if (process.env.OPENCODE_LOCAL_DISABLE === "1") return false
  const disabled = (config as { disabled_providers?: unknown }).disabled_providers
  if (Array.isArray(disabled) && disabled.includes(PROVIDER_ID)) return false
  const enabled = (config as { enabled_providers?: unknown }).enabled_providers
  if (Array.isArray(enabled) && !enabled.includes(PROVIDER_ID)) return false
  return true
}

function staticModels(config: Config): Record<string, LocalProviderModelConfig> {
  const models = configuredProvider(config).models
  return models && typeof models === "object" ? models : {}
}

function configuredContext(model: LocalProviderModelConfig): number | undefined {
  return positiveInteger(model.limit?.context)
}

async function inspect(config: Config, settings: OllamaSettings): Promise<OllamaIntegrationSnapshot | undefined> {
  const configuredModels = staticModels(config)
  if (!settings.autoDiscover && Object.keys(configuredModels).length === 0) return undefined
  if (!settings.explicitHost && !isLoopbackOllamaHost(settings.host)) return undefined

  const client = new OllamaClient({
    host: settings.host,
    apiKey: settings.apiKey,
    headers: settings.headers,
    timeoutMs: settings.timeoutMs,
  })

  let discovered: Awaited<ReturnType<OllamaClient["discover"]>>
  try {
    discovered = settings.autoDiscover ? await client.discover() : []
  } catch {
    if (Object.keys(configuredModels).length === 0) return undefined
    discovered = []
  }

  let running: Awaited<ReturnType<OllamaClient["running"]>> = []
  let version: string | undefined
  try {
    ;[running, version] = await Promise.all([client.running(), client.version()])
  } catch {
    running = []
  }

  const hardware = detectHardware()
  const models: Record<string, LocalProviderModelConfig> = {}
  const profiles: Record<string, LocalModelProfile> = {}

  for (const item of discovered) {
    const built = buildOllamaModel(item, {
      openAIBaseURL: client.openAIBaseURL,
      hardware,
      running,
      requestedContextTokens: settings.numCtx,
      forceToolCall: settings.forceToolCall,
      forceReasoning: settings.forceReasoning,
      forceVision: settings.forceVision,
    })
    models[item.metadata.id] = built.model
    profiles[item.metadata.id] = built.profile
  }

  for (const [id, model] of Object.entries(configuredModels)) models[id] = model

  if (Object.keys(models).length === 0) return undefined
  return {
    settings,
    version,
    hardware,
    models,
    profiles,
    capabilities: {
      backend: "ollama",
      endpoint: settings.host,
      version,
      nativeTransport: settings.nativeTransport,
      modelDiscovery: settings.autoDiscover,
      modelIntrospection: discovered.some((item) => item.show !== undefined),
      runtimeIntrospection: running.length > 0,
    },
  }
}

export function discoverOllama(config: Config, settings = resolveOllamaSettings(config)) {
  const key = JSON.stringify({
    host: settings.host,
    apiKey: settings.apiKey ? "configured" : "none",
    numCtx: settings.numCtx,
    nativeTransport: settings.nativeTransport,
    autoDiscover: settings.autoDiscover,
  })
  const now = Date.now()
  const current = cache.get(key)
  if (current && current.expires > now) return current.promise
  const promise = inspect(config, settings).then((snapshot) => {
    if (snapshot) latestSnapshot = snapshot
    return snapshot
  })
  cache.set(key, { expires: now + CACHE_TTL_MS, promise })
  return promise
}

function sdkOptions(options: Record<string, any>) {
  const {
    host: _host,
    nativeBaseURL: _nativeBaseURL,
    nativeTransport: _nativeTransport,
    autoDiscover: _autoDiscover,
    discoveryTimeoutMs: _discoveryTimeoutMs,
    numCtx: _numCtx,
    keepAlive: _keepAlive,
    forceToolCall: _forceToolCall,
    forceReasoning: _forceReasoning,
    forceVision: _forceVision,
    ...rest
  } = options
  return rest
}

export async function configureOllama(config: Config) {
  if (!providerAllowed(config)) return
  const settings = resolveOllamaSettings(config)
  const snapshot = await discoverOllama(config, settings)
  if (!snapshot) return

  const mutable = mutableConfig(config)
  const existing = configuredProvider(config)
  const existingOptions = providerOptions(config)
  const contexts = Object.fromEntries(
    Object.entries(snapshot.models).map(([id, model]) => [
      id,
      settings.numCtx ?? snapshot.profiles[id]?.context.recommendedContextTokens ?? configuredContext(model) ?? 16_384,
    ]),
  )
  const baseFetch: FetchLike = typeof existingOptions.fetch === "function" ? existingOptions.fetch : fetch
  const transport = createOllamaNativeFetch({
    host: settings.host,
    contexts,
    keepAlive: settings.keepAlive,
    enabled: settings.nativeTransport,
    fetch: baseFetch,
  })

  mutable.provider = mutable.provider ?? {}
  mutable.provider[PROVIDER_ID] = {
    ...existing,
    name: existing.name ?? "Ollama (local)",
    npm: "@ai-sdk/openai-compatible",
    api: `${snapshot.settings.host}/v1`,
    options: {
      ...sdkOptions(existingOptions),
      baseURL: `${snapshot.settings.host}/v1`,
      apiKey: settings.apiKey ?? "ollama",
      includeUsage: true,
      fetch: transport,
    },
    models: snapshot.models,
  }
}

export function getLatestOllamaSnapshot() {
  return latestSnapshot
}

export const OllamaIntegration = {
  providerID: PROVIDER_ID,
  configure: configureOllama,
  discover: discoverOllama,
  latest: getLatestOllamaSnapshot,
  resolveSettings: resolveOllamaSettings,
} as const
