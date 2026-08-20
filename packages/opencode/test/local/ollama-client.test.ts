import { expect, test } from "bun:test"
import { OllamaClient, isLoopbackOllamaHost, normalizeOllamaHost } from "@/local/ollama/client"

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

test("normalizes native and OpenAI-compatible Ollama endpoints", () => {
  expect(normalizeOllamaHost("localhost:11434/v1/")).toBe("http://localhost:11434")
  expect(normalizeOllamaHost("http://127.0.0.1:11434/api")).toBe("http://127.0.0.1:11434")
  expect(isLoopbackOllamaHost("http://[::1]:11434/v1")).toBe(true)
  expect(isLoopbackOllamaHost("https://ollama.example.com")).toBe(false)
})

test("discovers tags, model metadata, capabilities, and context", async () => {
  const calls: string[] = []
  const client = new OllamaClient({
    host: "http://localhost:11434/v1",
    fetch: (async (input, init) => {
      const url = String(input)
      calls.push(`${init?.method ?? "GET"} ${url}`)
      if (url.endsWith("/api/tags")) {
        return response({
          models: [
            {
              name: "qwen3-coder:8b",
              model: "qwen3-coder:8b",
              size: 5_000_000_000,
              modified_at: "2026-08-20T10:00:00Z",
              details: {
                family: "qwen3",
                families: ["qwen3"],
                parameter_size: "8B",
                quantization_level: "Q4_K_M",
                format: "gguf",
              },
            },
          ],
        })
      }
      if (url.endsWith("/api/show")) {
        return response({
          parameters: "num_ctx 32768",
          capabilities: ["completion", "tools", "thinking"],
          model_info: {
            "general.architecture": "qwen3",
            "qwen3.context_length": 131072,
          },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as typeof fetch,
  })

  const [model] = await client.discover()
  expect(model.metadata.id).toBe("qwen3-coder:8b")
  expect(model.metadata.contextLength).toBe(131_072)
  expect(model.metadata.capabilities).toEqual(["completion", "tools", "thinking"])
  expect(calls).toHaveLength(2)
})
