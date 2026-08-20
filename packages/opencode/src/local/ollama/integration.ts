import type { Config } from "@opencode-ai/plugin"
import { detectHardware } from "../hardware"
import type { HardwareSnapshot, LocalModelProfile, RuntimeCapabilities } from "../runtime"
import { OllamaClient, isLoopbackOllamaHost, normalizeOllamaHost } from "./client"
import { buildOllamaModel, type OllamaProviderModel } from "./model"
import { createOllamaNativeFetch } from "./transport"

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

export interface OllamaIntegrationSnapshot {
  settings: OllamaSettings
  version?: string
  hardware: HardwareSnapshot
  models: Record<string, OllamaProviderModel | ProviderConfig>
  profiles: Record<string, LocalModelProfile>
  capabilities: RuntimeCapabilities
}

type MutableConfig = Config & Record<string, any>
type ProviderConfig = Record<string, any>

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

function providerOptions(config: MutableConfig): ProviderConfig {
  return config.provider?.[PROVIDER_ID]?.options ?? {}
}

export function resolveOllamaSettings(config: MutableConfig): OllamaSettings {
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

function providerAllowed(config: MutableConfig) {
  if (process.env.OPENCODE_LOCAL_DISABLE === "1") return false
  if (Array.isArray(config.disabled_providers) && config.disabled_providers.includes(PROVIDER_ID)) return false
  if (Array.isArray(config.enabled_providers) && !config.enabled_providers.includes(PROVIDER_ID)) return false
  return true
}

function staticModels(config: MutableConfig): Record<string, ProviderConfig> {
  const models = config.provider?.[PROVIDER_ID]?.models
  return models && typeof models === "object" ? (models as Record<string, ProviderConfig>) : {}
}

async function inspect(config: MutableConfig, settings: OllamaSettings): Promise<OllamaIntegrationSnapshot | undefined> {
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
  const models: Record<string, OllamaProviderModel | ProviderConfig> = {}
  const profiles: Record<string, LocalModelProfile> = {}
  const contexts: Record<string, number> = {}

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
    contexts[item.metadata.id] = built.profile.context.recommendedContextTokens
  }

  for (const [id, model] of Object.entries(configuredModels)) {
    models[id] = model
    contexts[id] = settings.numCtx ?? positiveInteger(model.limit?.context) ?? contexts[id] ?? 16_384
  }

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

export function discoverOllama(config: MutableConfig, settings = resolveOllamaSettings(config)) {
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

function sdkOptions(options: ProviderConfig) {
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

export async function configureOllama(config: MutableConfig) {
  if (!providerAllowed(config)) return
  const settings = resolveOllamaSettings(config)
  const snapshot = await discoverOllama(config, settings)
  if (!snapshot) return

  const existing = (config.provider?.[PROVIDER_ID] ?? {}) as ProviderConfig
  const existingOptions = providerOptions(config)
  const contexts = Object.fromEntries(
    Object.entries(snapshot.models).map(([id, model]) => [
      id,
      settings.numCtx ?? snapshot.profiles[id]?.context.recommendedContextTokens ?? model.limit?.context ?? 16_384,
    ]),
  )
  const baseFetch = typeof existingOptions.fetch === "function" ? existingOptions.fetch : fetch
  const transport = createOllamaNativeFetch({
    host: settings.host,
    contexts,
    keepAlive: settings.keepAlive,
    enabled: settings.nativeTransport,
    fetch: baseFetch,
  })

  config.provider = config.provider ?? {}
  config.provider[PROVIDER_ID] = {
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
