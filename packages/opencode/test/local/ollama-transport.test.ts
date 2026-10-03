import { expect, test } from "bun:test"
import { createOllamaNativeFetch, openAIToOllamaRequest, type FetchLike } from "@/local/ollama/transport"
type ReaderResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>
function readWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 2000) {
  return new Promise<ReaderResult>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stream read timed out")), timeoutMs)
    reader.read().then((result) => { clearTimeout(timer); resolve(result) }, (error) => { clearTimeout(timer); reject(error) })
  })
}
test("converts OpenAI chat requests into Ollama native requests with context sizing", () => {
  const converted = openAIToOllamaRequest({ model: "qwen3-coder:8b", stream: true, max_tokens: 4096, temperature: 0.2, reasoning_effort: "high",
    messages: [{ role: "system", content: "You are a coding agent." }, { role: "user", content: [{ type: "text", text: "Inspect this image" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }] }, { role: "assistant", content: "prior answer", reasoning: "prior thought" }],
    tools: [{ type: "function", function: { name: "read_file", description: "Read", parameters: { type: "object" } } }] }, 24576, "10m")
  expect(converted.options.num_ctx).toBe(24576); expect(converted.options.num_predict).toBe(4096)
  // Qwen uses the boolean thinking mode; GPT-OSS levels have their own regression test.
  expect(converted.think).toBe(true); expect(converted.keep_alive).toBe("10m"); expect(converted.truncate).toBe(false)
  expect(converted.messages[1].images).toEqual(["aGVsbG8="]); expect(converted.messages[2].thinking).toBe("prior thought")
})
test("honors OpenAI tool_choice none by withholding native tools", () => {
  const converted = openAIToOllamaRequest({ model: "qwen3-coder:8b", messages: [{ role: "user", content: "Do not use tools" }], tool_choice: "none",
    tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }] }, 16384)
  expect(converted.tools).toBeUndefined()
})
test("streams Ollama NDJSON as SSE before the final response is available", async () => {
  let nativeRequest: any
  let releaseFinal!: () => void
  const finalGate = new Promise<void>((resolve) => { releaseFinal = resolve })
  const encoder = new TextEncoder()
  const fetcher = createOllamaNativeFetch({ host: "http://localhost:11434", contexts: { "qwen3-coder:8b": 24576 },
    fetch: (async (input, init) => {
      expect(String(input)).toBe("http://localhost:11434/api/chat"); nativeRequest = JSON.parse(String(init?.body))
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ model: "qwen3-coder:8b", message: { thinking: "checking", content: "first" }, done: false }) + "\n"))
        void finalGate.then(() => {
          controller.enqueue(encoder.encode(JSON.stringify({ model: "qwen3-coder:8b", message: { content: "done" }, done: true, done_reason: "stop", prompt_eval_count: 10, eval_count: 2 }) + "\n"))
          controller.close()
        })
      } }))
    }) as FetchLike })
  const response = await fetcher("http://localhost:11434/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "qwen3-coder:8b", stream: true, messages: [{ role: "user", content: "hello" }] }) })
  const reader = response.body!.getReader()
  try {
    const first = await readWithTimeout(reader)
    const firstText = new TextDecoder().decode(first.value)
    expect(nativeRequest.options.num_ctx).toBe(24576)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(firstText).toContain('"reasoning":"checking"'); expect(firstText).toContain('"content":"first"')
  } finally { releaseFinal() }
  let rest = ""
  while (true) { const chunk = await readWithTimeout(reader); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value) }
  expect(rest).toContain('"content":"done"'); expect(rest).toContain('"prompt_tokens":10'); expect(rest).toContain("data: [DONE]")
})
test("reads an OpenAI request body from a Request object", async () => {
  let nativeRequest: any
  const fetcher = createOllamaNativeFetch({ host: "http://127.0.0.1:11434", contexts: { "qwen3-coder:8b": 12288 }, fetch: async (_input, init) => {
    nativeRequest = JSON.parse(String(init?.body)); return Response.json({ model: "qwen3-coder:8b", message: { content: "ok" }, done: true, done_reason: "stop" })
  } })
  const response = await fetcher(new Request("http://127.0.0.1:11434/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "qwen3-coder:8b", stream: false, messages: [{ role: "user", content: "hello" }] }) }))
  const result = await response.json()
  expect(nativeRequest.options.num_ctx).toBe(12288); expect(result.choices[0].message.content).toBe("ok")
})
test("propagates downstream cancellation to the Ollama response body", async () => {
  let upstreamCancelled = false
  const fetcher = createOllamaNativeFetch({ host: "http://127.0.0.1:11434", contexts: { "qwen3-coder:8b": 8192 }, fetch: async () =>
    new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ message: { content: "first" }, done: false }) + "\n")) },
      cancel() { upstreamCancelled = true } })) })
  const response = await fetcher("http://127.0.0.1:11434/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "qwen3-coder:8b", stream: true, messages: [{ role: "user", content: "hello" }] }) })
  const reader = response.body!.getReader(); await readWithTimeout(reader); await reader.cancel("test cancellation")
  expect(upstreamCancelled).toBe(true)
})
