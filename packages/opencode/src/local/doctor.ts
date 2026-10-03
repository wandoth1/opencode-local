import type { LocalConfig as Config } from "./runtime"
import { OllamaClient } from "./ollama/client"
import { diagnosticSnapshot, discoverOllama, resolveOllamaSettings, type OllamaDependencies } from "./ollama/integration"
export interface DoctorArgs { host?: string; model?: string; numCtx?: number; json?: boolean; benchmark?: boolean; outputTokens?: number }
export async function getDoctorReport(config: Config, globalConfig: Config, args: DoctorArgs, dependencies: OllamaDependencies = {}) {
  for (const [name, value] of [["num-ctx", args.numCtx], ["output-tokens", args.outputTokens]] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new Error(`--${name} must be a positive integer`)
  }
  const settings = resolveOllamaSettings(config, globalConfig, args)
  const snapshot = await discoverOllama(config, settings, dependencies)
  if (!snapshot) throw new Error("Ollama is disabled, unavailable, or has no usable chat models")
  const preferred = (config as unknown as { model?: string }).model
  const model = args.model ?? (preferred?.startsWith("ollama/") ? preferred.slice("ollama/".length) : undefined) ?? Object.keys(snapshot.models)[0]
  if (!Object.hasOwn(snapshot.models, model)) throw new Error("The selected Ollama model was not found")
  let benchmark
  if (args.benchmark) {
    const client = new OllamaClient({ ...settings, fetch: dependencies.fetch })
    const result = await client.benchmark({ model, contextTokens: snapshot.models[model].limit.context,
      outputTokens: args.outputTokens ?? 96, keepAlive: settings.keepAlive })
    // Generated sample text is deliberately excluded from public diagnostics.
    const { sample: _sample, ...metrics } = result
    benchmark = metrics
  }
  return { generatedAt: new Date().toISOString(), selectedModel: model, snapshot: diagnosticSnapshot(snapshot), benchmark }
}
