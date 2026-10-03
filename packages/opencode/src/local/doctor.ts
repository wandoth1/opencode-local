import type { LocalConfig } from "./runtime"
import { OllamaClient } from "./ollama/client"
import { LocalRuntimeError } from "./ollama/errors"
import { diagnosticSnapshot, discoverOllama, originalOllamaConfig, providerAllowed, resolveOllamaSettings, type OllamaDependencies } from "./ollama/integration"

export interface DoctorArgs {
  host?: string
  model?: string
  numCtx?: number
  json?: boolean
  benchmark?: boolean
  outputTokens?: number
  benchmarkTimeoutMs?: number
}

export async function getDoctorReport(config: LocalConfig, globalConfig: LocalConfig, args: DoctorArgs, dependencies: OllamaDependencies = {}) {
  for (const [name, value] of [["num-ctx", args.numCtx], ["output-tokens", args.outputTokens]] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new LocalRuntimeError(`--${name} must be a positive integer`)
  }
  if (args.benchmarkTimeoutMs !== undefined && (!Number.isSafeInteger(args.benchmarkTimeoutMs) || args.benchmarkTimeoutMs < 0 || args.benchmarkTimeoutMs > 2147483647)) {
    throw new LocalRuntimeError("--benchmark-timeout-ms must be zero or positive milliseconds up to 2147483647")
  }
  const source = originalOllamaConfig(config)
  if (!providerAllowed(source)) throw new LocalRuntimeError("Ollama is disabled by OPENCODE_LOCAL_DISABLE or provider configuration")
  const preferred = typeof source.model === "string" && source.model.startsWith("ollama/") ? source.model.slice(7) : undefined
  const selected = args.model ?? preferred
  if (args.benchmark && !selected) throw new LocalRuntimeError("Benchmark requires --model or an explicit ollama/ model in configuration; no model will be loaded implicitly.")
  const settings = resolveOllamaSettings(source, globalConfig, args)
  const snapshot = await discoverOllama(source, settings, dependencies, true)
  if (!snapshot) throw new LocalRuntimeError("Ollama is disabled, unavailable, or has no usable chat models")
  const model = selected ?? Object.keys(snapshot.models)[0]
  if (!Object.hasOwn(snapshot.models, model)) throw new LocalRuntimeError("The selected Ollama model was not found")
  let benchmark
  if (args.benchmark) {
    const client = new OllamaClient({ ...settings, fetch: dependencies.fetch })
    const timeout = args.benchmarkTimeoutMs ?? settings.generationTimeoutMs ?? (typeof settings.timeout === "number" ? settings.timeout : 0)
    const result = await client.benchmark({
      model, contextTokens: snapshot.models[model].limit.context,
      outputTokens: args.outputTokens ?? 96, keepAlive: settings.keepAlive,
      signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    })
    const { sample: _sample, ...metrics } = result
    benchmark = metrics
  }
  return { generatedAt: new Date().toISOString(), selectedModel: model, snapshot: diagnosticSnapshot(snapshot), benchmark }
}
