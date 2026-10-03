import { test } from "bun:test"
import assert from "node:assert/strict"
import { GIB, finitePositive, redactSecrets, type HardwareSnapshot, type LocalModelMetadata } from "@/local/runtime"
import { recommendContext, estimateKvBytesPerToken, extractContextLength } from "@/local/context-budget"
import { parseNvidiaSmiCsv } from "@/local/hardware"
import { OllamaClient, normalizeOllamaHost, isLoopbackOllamaHost } from "@/local/ollama/client"
import { openAIToOllamaRequest, createOllamaNativeFetch, type FetchLike } from "@/local/ollama/transport"
import { resolveOllamaSettings, configureOllama, discoverOllama, diagnosticSnapshot } from "@/local/ollama/integration"
import { getDoctorReport } from "@/local/doctor"
import { boundedText, readNdjson } from "@/local/ollama/io"
const noHardware: HardwareSnapshot = { platform: "test", architecture: "x64", cpuModel: "fixture", cpuCount: 4,
  systemMemoryTotalBytes: 64 * GIB, systemMemoryFreeBytes: 32 * GIB, nvidiaGpus: [] }
const model: LocalModelMetadata = { id: "fixture:8b", families: ["llama"], family: "llama", fileSizeBytes: 8 * GIB,
  contextLength: 32768, capabilities: ["completion", "tools"], modelInfo: { "general.architecture": "llama",
    "llama.block_count": 32, "llama.embedding_length": 4096, "llama.attention.head_count": 32, "llama.attention.head_count_kv": 8 } }
const hardware = (free = 11.5): HardwareSnapshot => ({ ...noHardware, nvidiaGpus: [{ index: 0, name: "RTX 5070",
  memoryTotalBytes: 12 * GIB, memoryFreeBytes: free * GIB, memoryUsedBytes: (12 - free) * GIB }] })
const config = (options = {}, models = {}): any => ({ provider: { ollama: { options, models } } })
const tools = ["a", "b", "read_file"].map((name) => ({ type: "function", function: { name, parameters: { type: "object" } } }))
const request = (extra = {}): any => ({ model: "fixture", messages: [{ role: "user", content: "hello" }], ...extra })
const frame = (message = {}, done = false, extra = {}): any => ({ model: "fixture", message, done, ...extra })
const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value) + "\n")
const ndjson = (frames: unknown[], newline = true) => new Response(new ReadableStream<Uint8Array>({ start(c) {
  for (let i = 0; i < frames.length; i++) c.enqueue(encode(JSON.stringify(frames[i]) + (newline || i < frames.length - 1 ? "\n" : "")))
  c.close()
} }))
function native(frames: unknown[], extra = {}) {
  return createOllamaNativeFetch({ host: "http://127.0.0.1:11434", contexts: { fixture: 8192 }, fetch: async () => ndjson(frames), ...extra })
}
async function streamed(frames: unknown[], extra = {}) {
  const response = await native(frames)("http://127.0.0.1:11434/v1/chat/completions", { method: "POST", body: JSON.stringify(request({ stream: true, tools, ...extra })) })
  return response.text()
}
function packets(text: string): any[] { return text.split("\n\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6))) }
async function withEnv(values: Record<string, string | undefined>, fn: () => unknown | Promise<unknown>) {
  const keys = ["OPENCODE_LOCAL_DISABLE", "OPENCODE_OLLAMA_HOST", "OLLAMA_HOST", "OPENCODE_OLLAMA_API_KEY", "OPENCODE_OLLAMA_AUTODETECT", ...Object.keys(values)]
  const saved = new Map(keys.map((key) => [key, process.env[key]]))
  try { for (const key of keys) delete process.env[key]; for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value; await fn() }
  finally { for (const [key, value] of saved) if (value === undefined) delete process.env[key]; else process.env[key] = value }
}
const fixtureFetch: FetchLike = async (input) => {
  const path = new URL(String(input)).pathname
  if (path.endsWith("/api/tags")) return Response.json({ models: [{ name: "fixture", size: 1000000000 }] })
  if (path.endsWith("/api/show")) return Response.json({ capabilities: ["completion", "tools"], model_info: { "general.architecture": "llama", "llama.context_length": 2048 } })
  if (path.endsWith("/api/version")) return Response.json({ version: "fixture-version" })
  if (path.endsWith("/api/ps")) return Response.json({ models: [] })
  throw new Error("Unexpected fixture endpoint")
}
const deps = { fetch: fixtureFetch, hardware: () => noHardware }

test("client rejects malformed model list and HTTP error without leaking body", async () => {
  await assert.rejects(new OllamaClient({ fetch: async () => Response.json({ models: [null] }) }).tags())
  await assert.rejects(new OllamaClient({ fetch: async () => new Response("secret-fixture", { status: 401 }) }).tags(), /HTTP 401/)
})
test("client and native transport disable HTTP redirects", async () => {
  const spy: FetchLike = async (_url, init) => { assert.equal(init?.redirect, "error"); return Response.json({ version: "test" }) }
  await new OllamaClient({ fetch: spy }).version()
  const fn = createOllamaNativeFetch({ host: "http://127.0.0.1:11434", contexts: {}, fetch: async (_url, init) => {
    assert.equal(init?.redirect, "error"); return Response.json(frame({ content: "ok" }, true))
  } })
  assert.equal((await fn("http://127.0.0.1:11434/v1/chat/completions", { body: JSON.stringify(request()) })).status, 200)
})
test("non-streaming is the default and parameters survive translation", () => {
  const r = openAIToOllamaRequest(request({ max_tokens: 10, max_completion_tokens: 20, top_k: 40, response_format: { type: "text" } }), 2048)
  assert.equal(r.stream, false); assert.equal(r.options.num_predict, 20); assert.equal(r.options.top_k, 40); assert.equal(r.format, undefined)
})
test("tool results infer function name from earlier call ID, not the ID itself", () => {
  const r = openAIToOllamaRequest(request({ messages: [{ role: "assistant", content: null, tool_calls: [{ id: "abc", function: { name: "read_file", arguments: '{"path":"x"}' } }] },
    { role: "tool", tool_call_id: "abc", content: "result" }] }))
  assert.equal(r.messages[1].tool_name, "read_file"); assert.equal(r.messages[0].content, "")
})
test("unsupported tool choices, malformed arguments and external images fail explicitly", () => {
  for (const tool_choice of ["required", { type: "function", function: { name: "a" } }]) assert.throws(() => openAIToOllamaRequest(request({ tool_choice, tools })))
  assert.throws(() => openAIToOllamaRequest(request({ messages: [{ role: "assistant", tool_calls: [{ function: { name: "a", arguments: "[1]" } }] }] })))
  assert.throws(() => openAIToOllamaRequest(request({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.invalid/image" } }] }] })))
})
test("thinking uses boolean for Qwen and levels for GPT-OSS", () => {
  assert.equal(openAIToOllamaRequest(request({ model: "qwen3", reasoning_effort: "high" })).think, true)
  assert.equal(openAIToOllamaRequest(request({ model: "gpt-oss:20b", reasoning_effort: "high" })).think, "high")
  assert.throws(() => openAIToOllamaRequest(request({ model: "gpt-oss:20b", reasoning_effort: "none" })))
})
test("preserves multiple unindexed native tool calls across chunks", async () => {
  const text = await streamed([frame({ tool_calls: [{ function: { name: "a", arguments: { x: 1 } } }] }), frame({ tool_calls: [{ function: { name: "b", arguments: { x: 2 } } }] }), frame({}, true)])
  const calls = packets(text).flatMap((p) => p.choices[0].delta.tool_calls ?? [])
  assert.deepEqual(calls.map((c) => c.function.name), ["a", "b"]); assert.notEqual(calls[0].id, calls[1].id)
})
test("supports indexed argument fragments, late names, IDs and sparse indexes", async () => {
  const text = await streamed([frame({ tool_calls: [{ function: { index: 7, arguments: '{"path":' } }] }),
    frame({ tool_calls: [{ id: "server-id", function: { index: 7, name: "read_file", arguments: '"x"}' } }] }), frame({}, true)])
  const calls = packets(text).flatMap((p) => p.choices[0].delta.tool_calls ?? [])
  assert.equal(calls.length, 1); assert.equal(calls[0].id, "server-id"); assert.equal(calls[0].index, 0); assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: "x" })
})
test("deduplicates repeated indexed object snapshots but not independent identical calls", async () => {
  const indexed = { function: { index: 0, name: "a", arguments: { x: 1 } } }
  const text = await streamed([frame({ tool_calls: [indexed] }), frame({ tool_calls: [indexed] }), frame({}, true)])
  assert.equal(packets(text).flatMap((p) => p.choices[0].delta.tool_calls ?? []).length, 1)
  const independent = { function: { name: "a", arguments: { x: 1 } } }
  const second = await streamed([frame({ tool_calls: [independent] }), frame({ tool_calls: [independent] }), frame({}, true)])
  assert.equal(packets(second).flatMap((p) => p.choices[0].delta.tool_calls ?? []).length, 2)
})
test("premature EOF fails rather than inventing a successful finish", async () => assert.rejects(streamed([frame({ content: "partial" })]), /without a done/))
test("invalid JSON and mid-stream server errors propagate without server secrets", async () => {
  await assert.rejects(streamed([frame({ content: "first" }), { error: "secret-fixture" }]), (error: any) => !error.message.includes("secret-fixture"))
  const fn = native([], { fetch: async () => new Response('{"message":{"content":"a"}}\nnot-json\n') })
  await assert.rejects((await fn("http://127.0.0.1:11434/v1/chat/completions", { body: JSON.stringify(request({ stream: true })) })).text())
})
test("never releases truncated or unknown tool calls", async () => {
  await assert.rejects(streamed([frame({ tool_calls: [{ function: { name: "a", arguments: {} } }] }, true, { done_reason: "length" })]))
  await assert.rejects(streamed([frame({ tool_calls: [{ function: { name: "unknown", arguments: {} } }] }, true)]))
})
test("streaming handles UTF-8 split across byte boundaries and final frame without newline", async () => {
  const bytes = encode(JSON.stringify(frame({ content: "España €" })) + "\n" + JSON.stringify(frame({}, true)))
  const fn = native([], { fetch: async () => new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close() } })) })
  const text = await (await fn("http://127.0.0.1:11434/v1/chat/completions", { body: JSON.stringify(request({ stream: true })) })).text()
  assert(text.includes("España €")); assert(text.endsWith("data: [DONE]\n\n"))
})
test("ReadableStream request bodies are translated instead of bypassing num_ctx", async () => {
  let seen: any
  const fn = native([], { fetch: async (_url: unknown, init: RequestInit) => { seen = JSON.parse(String(init.body)); return Response.json(frame({ content: "ok" }, true)) } })
  const response = await fn("http://127.0.0.1:11434/v1/chat/completions", { body: new ReadableStream({ start(c) { c.enqueue(encode(JSON.stringify(request()))); c.close() } }) })
  assert.equal(response.status, 200); assert.equal(seen.options.num_ctx, 8192); assert.equal(seen.stream, false)
})
test("endpoint-bound transport blocks credential diversion even with native mode off", async () => {
  for (const enabled of [true, false]) {
    let calls = 0
    const fn = native([], { enabled, apiKey: "fixture-key", fetch: async () => { calls++; return new Response() } })
    const response = await fn("https://attacker.invalid/v1/chat/completions", { body: JSON.stringify(request()) })
    assert.equal(response.status, 400); assert.equal(calls, 0)
  }
})
test("downstream cancellation stops a pending upstream read", async () => {
  let cancelled = false
  const fn = native([], { fetch: async () => new Response(new ReadableStream({ start(c) { c.enqueue(encode(frame({ content: "first" }))) }, cancel() { cancelled = true } })) })
  const response = await fn("http://127.0.0.1:11434/v1/chat/completions", { body: JSON.stringify(request({ stream: true })) })
  const reader = response.body!.getReader(); await reader.read(); await reader.cancel(); assert(cancelled)
})
test("parent abort propagates during generation", async () => {
  const parent = new AbortController()
  let seen: AbortSignal | undefined
  const fn = native([], { fetch: async (_url: unknown, init: RequestInit) => { seen = init.signal!; return new Response(new ReadableStream({ start(c) { c.enqueue(encode(frame({ content: "first" }))) } })) } })
  const response = await fn("http://127.0.0.1:11434/v1/chat/completions", { signal: parent.signal, body: JSON.stringify(request({ stream: true })) })
  const reader = response.body!.getReader(); await reader.read(); parent.abort(); await assert.rejects(reader.read()); assert(seen?.aborted)
})
test("oversized and invalid UTF-8 streams are rejected", async () => {
  await assert.rejects(boundedText(new Response("123456").body, undefined, 5))
  await assert.rejects((async () => { for await (const _value of readNdjson(new Response(Uint8Array.of(255)).body)) {} })())
})
test("benchmark rejects empty, incomplete and server-error responses", async () => {
  for (const frames of [[], [frame({}, true)], [frame({ content: "partial" })], [{ error: "secret" }]]) {
    const client = new OllamaClient({ fetch: async () => ndjson(frames) })
    await assert.rejects(client.benchmark({ model: "fixture", contextTokens: 2048 }))
  }
})
test("benchmark counts reasoning TTFT and final frame without newline", async () => {
  const client = new OllamaClient({ fetch: async () => ndjson([frame({ content: "", thinking: "first reasoning" }),
    frame({ content: "ok" }, true, { eval_count: 3, eval_duration: 100000000, prompt_eval_count: 10, prompt_eval_duration: 200000000 })], false) })
  const result = await client.benchmark({ model: "fixture", contextTokens: 2048 })
  assert(result.timeToFirstTokenMs !== undefined); assert.equal(result.outputTokensPerSecond, 30); assert.equal(result.promptTokensPerSecond, 50)
})
