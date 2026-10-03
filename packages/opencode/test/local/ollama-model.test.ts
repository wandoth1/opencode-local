import { expect, test } from "bun:test"
import { buildOllamaModel } from "@/local/ollama/model"
import type { OllamaDiscoveryModel } from "@/local/ollama/client"
function discovered(capabilities: string[]): OllamaDiscoveryModel {
  return { tag: { name: "qwen3-coder:8b", size: 5000000000, modified_at: "2026-08-20T10:00:00Z" },
    show: { capabilities }, metadata: { id: "qwen3-coder:8b", family: "qwen3", families: ["qwen3"], format: "gguf",
      parameterSize: "8B", quantization: "Q4_K_M", fileSizeBytes: 5000000000, contextLength: 32768, capabilities, modelInfo: {} } }
}
test("reported capabilities override broad model-name heuristics", () => {
  const { model } = buildOllamaModel(discovered(["completion"]), { openAIBaseURL: "http://127.0.0.1:11434/v1" })
  expect(model.tool_call).toBe(false); expect(model.reasoning).toBe(false); expect(model.attachment).toBe(false)
})
test("missing capabilities are not guessed from the model name", () => {
  const { model } = buildOllamaModel(discovered([]), { openAIBaseURL: "http://127.0.0.1:11434/v1" })
  expect(model.tool_call).toBe(false); expect(model.reasoning).toBe(false); expect(model.attachment).toBe(false)
})
test("explicit capability overrides remain authoritative", () => {
  const { model } = buildOllamaModel(discovered(["completion"]), { openAIBaseURL: "http://127.0.0.1:11434/v1",
    forceToolCall: true, forceReasoning: true, forceVision: true })
  expect(model.tool_call).toBe(true); expect(model.reasoning).toBe(true); expect(model.attachment).toBe(true)
})
test("GPT-OSS does not advertise an unsupported thinking-off variant", () => {
  const item = discovered(["completion", "thinking"]); item.metadata.id = "gpt-oss:20b"
  const { model } = buildOllamaModel(item, { openAIBaseURL: "http://127.0.0.1:11434/v1" })
  expect(model.variants.none).toBeUndefined(); expect(model.variants.low.reasoningEffort).toBe("low")
})
