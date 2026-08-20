import { expect, test } from "bun:test"
import { createOllamaNativeFetch, openAIToOllamaRequest } from "@/local/ollama/transport"

test("converts OpenAI chat requests into Ollama native requests with context sizing", () => {
  const converted = openAIToOllamaRequest(
    {
      model: "qwen3-coder:8b",
      stream: true,
      max_tokens: 4096,
      temperature: 0.2,
      reasoning_effort: "high",
      messages: [
        { role: "system", content: "You are a coding agent." },
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this image" },
            { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: { name: "read_file", description: "Read", parameters: { type: "object" } },
        },
      ],
    },
    24_576,
    "10m",
  )

  expect(converted.options.num_ctx).toBe(24_576)
  expect(converted.options.num_predict).toBe(4096)
  expect(converted.think).toBe("high")
  expect(converted.keep_alive).toBe("10m")
  expect(converted.truncate).toBe(false)
  expect(converted.messages[1].images).toEqual(["aGVsbG8="])
})

test("streams Ollama NDJSON as OpenAI-compatible SSE without buffering the full response", async () => {
  let nativeRequest: any
  const nativeBody = [
    {
      model: "qwen3-coder:8b",
      created_at: "2026-08-20T10:00:00Z",
      message: { role: "assistant", thinking: "checking", content: "" },
      done: false,
    },
    {
      model: "qwen3-coder:8b",
      created_at: "2026-08-20T10:00:00Z",
      message: { role: "assistant", content: "done" },
      done: false,
    },
    {
      model: "qwen3-coder:8b",
      created_at: "2026-08-20T10:00:00Z",
      message: { role: "assistant", content: "" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 10,
      eval_count: 2,
    },
  ]
    .map((item) => JSON.stringify(item))
    .join("\n")

  const fetcher = createOllamaNativeFetch({
    host: "http://localhost:11434",
    contexts: { "qwen3-coder:8b": 24_576 },
    fetch: (async (input, init) => {
      expect(String(input)).toBe("http://localhost:11434/api/chat")
      nativeRequest = JSON.parse(String(init?.body))
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode(nativeBody.slice(0, 80)))
          controller.enqueue(encoder.encode(nativeBody.slice(80)))
          controller.close()
        },
      })
      return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } })
    }) as typeof fetch,
  })

  const response = await fetcher("http://localhost:11434/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3-coder:8b",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    }),
  })
  const text = await response.text()

  expect(nativeRequest.options.num_ctx).toBe(24_576)
  expect(response.headers.get("content-type")).toContain("text/event-stream")
  expect(text).toContain('"reasoning":"checking"')
  expect(text).toContain('"content":"done"')
  expect(text).toContain('"prompt_tokens":10')
  expect(text).toContain("data: [DONE]")
})
