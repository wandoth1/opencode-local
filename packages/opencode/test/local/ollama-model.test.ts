import { expect, test } from "bun:test"
import { buildOllamaModel } from "@/local/ollama/model"
import type { OllamaDiscoveryModel } from "@/local/ollama/client"

function discovered(capabilities: string[]): OllamaDiscoveryModel {
  return {
    tag: {
      name: "qwen3-coder:8b",
      model: "qwen3-coder:8b",
      size: 5_000_000_000,
      modified_at: "2026-08-20T10:00:00Z",
    },
    show: { capabilities },
    metadata: {
      id: "qwen3-coder:8b",
      family: "qwen3",
      families: ["qwen3"],
      format: "gguf",
      parameterSize: "8B",
      quantization: "Q4_K_M",
      fileSizeBytes: 5_000_000_000,
      contextLength: 32_768,
      capabilities,
      modelInfo: {},
    },
  }
}

test("reported capabilities override broad model-name heuristics", () => {
  const { model } = buildOllamaModel(discovered(["completion"]), {
    openAIBaseURL: "http://127.0.0.1:11434/v1",
  })
  expect(model.tool_call).toBe(false)
  expect(model.reasoning).toBe(false)
  expect(model.attachment).toBe(false)
})

test("legacy Ollama metadata falls back to conservative model-family hints", () => {
  const { model } = buildOllamaModel(discovered([]), {
    openAIBaseURL: "http://127.0.0.1:11434/v1",
  })
  expect(model.tool_call).toBe(true)
  expect(model.reasoning).toBe(true)
  expect(model.attachment).toBe(false)
})

test("explicit capability overrides remain authoritative", () => {
  const { model } = buildOllamaModel(discovered(["completion"]), {
    openAIBaseURL: "http://127.0.0.1:11434/v1",
    forceToolCall: true,
    forceReasoning: true,
    forceVision: true,
  })
  expect(model.tool_call).toBe(true)
  expect(model.reasoning).toBe(true)
  expect(model.attachment).toBe(true)
})
