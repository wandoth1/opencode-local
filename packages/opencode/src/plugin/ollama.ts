import type { Config, Hooks } from "@opencode-ai/plugin"
import { OllamaIntegration } from "@/local/ollama/integration"
/** Each plugin instance receives a separately loaded global config, never project-derived trust. */
export async function OllamaPlugin(globalConfig: Config = {} as Config): Promise<Hooks> {
  return { async config(config: Config) { await OllamaIntegration.configure(config, globalConfig) } }
}
