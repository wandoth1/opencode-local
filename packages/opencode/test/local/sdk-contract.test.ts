import { test, expect } from "bun:test"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createOllamaNativeFetch } from "@/local/ollama/transport"

test("locked AI SDK consumes native text, reasoning, usage and multiple tool calls", async () => {
  const wire = createOllamaNativeFetch({ host: "http://127.0.0.1:11434", contexts: { fixture: 8192 }, fetch: async () => {
    const frames = [
      { message: { thinking: "checking", content: "hello" }, done: false },
      { message: { tool_calls: [{ function: { index: 0, name: "read_file", arguments: { path: "a" } } }] }, done: false },
      { message: { tool_calls: [{ function: { index: 1, name: "read_file", arguments: { path: "b" } } }] }, done: false },
      { message: { content: "" }, done: true, done_reason: "stop", prompt_eval_count: 8, eval_count: 4 },
    ]
    return new Response(frames.map((frame) => JSON.stringify(frame)).join("\n"), { headers: { "Content-Type": "application/x-ndjson" } })
  } })
  const provider = createOpenAICompatible({ name: "ollama", baseURL: "http://127.0.0.1:11434/v1", fetch: wire })
  const result = await provider.chatModel("fixture").doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "Read a and b" }] }],
    tools: [{ type: "function", name: "read_file", inputSchema: { type: "object", properties: { path: { type: "string" } } } }],
  })
  const parts: any[] = []
  const reader = result.stream.getReader()
  while (true) { const next = await reader.read(); if (next.done) break; parts.push(next.value) }
  expect(parts.filter((part) => part.type === "error")).toHaveLength(0)
  expect(parts.filter((part) => part.type === "tool-call")).toHaveLength(2)
  expect(JSON.stringify(parts)).toContain("hello")
  expect(JSON.stringify(parts)).toContain("checking")
  expect(parts.some((part) => part.type === "finish")).toBe(true)
})
