import type { Config, Hooks } from "@opencode-ai/plugin"
import { OllamaIntegration } from "@/local/ollama/integration"

export async function OllamaPlugin(): Promise<Hooks> {
  return {
    async config(config: Config) {
      await OllamaIntegration.configure(config)
    },
  }
}
