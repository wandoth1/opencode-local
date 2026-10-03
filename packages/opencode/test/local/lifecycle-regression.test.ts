import { expect, test } from "bun:test"
import { boundedText, readNdjson } from "@/local/ollama/io"
import { OllamaClient, ollamaHeaders } from "@/local/ollama/client"
import { createOllamaNativeFetch, openAIToOllamaRequest } from "@/local/ollama/transport"
import { resolveNvidiaSmiExecutable } from "@/local/hardware"

const endpoint = "http://127.0.0.1:11434/v1/chat/completions"
const encode = (value: string) => new TextEncoder().encode(value)
const request = { model: "fixture", messages: [{ role: "user", content: "hi" }] }
const response = () => Response.json({ message: { content: "ok" }, done: true })

async function settles<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Cancellation did not settle")), 1000) }),
    ])
  } finally { clearTimeout(timer) }
}

test("oversized request cancellation does not await an uncooperative source", async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encode("too long")) },
    cancel() { cancelled = true; return new Promise<void>(() => undefined) },
  })
  await expect(settles(boundedText(body, undefined, 2))).rejects.toThrow("size limit")
  expect(cancelled).toBe(true)
  expect(body.locked).toBe(false)
})

test("NDJSON iterator cleanup does not wait for cancellation of an idle server", async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encode('{"done":true}\n')) },
    cancel() { cancelled = true; return new Promise<void>(() => undefined) },
  })
  const iterator = readNdjson(body)
  expect((await iterator.next()).value).toEqual({ done: true })
  await settles(iterator.return(undefined))
  expect(cancelled).toBe(true)
  expect(body.locked).toBe(false)
})

test("reader exceptions do not disclose arbitrary upstream exception messages", async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("sensitive-fixture-value")) } })
  await expect(boundedText(body)).rejects.toThrow("Local runtime response stream failed")
})

test("invalid authentication header errors do not include the rejected secret", () => {
  expect(() => ollamaHeaders({ apiKey: "sensitive-fixture\r\nvalue" })).toThrow("Invalid Ollama authentication headers")
})

test("native fetch consumes Request body without cloning an unused tee", async () => {
  const input = new Request(endpoint, { method: "POST", body: JSON.stringify(request) })
  const fetcher = createOllamaNativeFetch({ host: "http://127.0.0.1:11434", contexts: { fixture: 2048 }, fetch: async () => response() })
  expect((await fetcher(input)).status).toBe(200)
  expect(input.bodyUsed).toBe(true)
})

test("aborting an unfinished Request body settles promptly and never reaches the daemon", async () => {
  const abort = new AbortController()
  let cancelled = false
  let reached = false
  const input = new Request(endpoint, {
    method: "POST", signal: abort.signal,
    body: new ReadableStream<Uint8Array>({ cancel() { cancelled = true } }),
  })
  const fetcher = createOllamaNativeFetch({ host: "http://127.0.0.1:11434", contexts: { fixture: 2048 }, fetch: async () => { reached = true; return response() } })
  const task = fetcher(input)
  abort.abort()
  await expect(settles(task)).rejects.toThrow("aborted")
  expect(cancelled).toBe(true)
  expect(reached).toBe(false)
})

test("error responses do not hang when cancel has no acknowledgement", async () => {
  const fetcher = createOllamaNativeFetch({
    host: "http://127.0.0.1:11434", contexts: { fixture: 2048 },
    fetch: async () => new Response(new ReadableStream({ cancel() { return new Promise<void>(() => undefined) } }), { status: 500 }),
  })
  expect((await settles(fetcher(endpoint, { method: "POST", body: JSON.stringify(request) }))).status).toBe(500)
})

test("conflicting tool IDs on the same index fail rather than merging two invocations", async () => {
  const frames = [
    { message: { tool_calls: [{ id: "first", function: { index: 0, name: "read_file", arguments: { path: "a" } } }] }, done: false },
    { message: { tool_calls: [{ id: "second", function: { index: 0, name: "read_file", arguments: { path: "b" } } }] }, done: true },
  ]
  const fetcher = createOllamaNativeFetch({
    host: "http://127.0.0.1:11434", contexts: { fixture: 2048 },
    fetch: async () => new Response(frames.map((item) => JSON.stringify(item)).join("\n")),
  })
  const result = await fetcher(endpoint, { method: "POST", body: JSON.stringify({ ...request, stream: true,
    tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
  }) })
  await expect(result.text()).rejects.toThrow("Conflicting native tool identity")
})

test("malformed function tool definitions are rejected before network access", () => {
  expect(() => openAIToOllamaRequest({ ...request, tools: [{ type: "function", function: { name: 42 } }] })).toThrow("named function")
  expect(() => openAIToOllamaRequest({ ...request, tools: [null] })).toThrow("named function")
})

test("native request explicitly disables daemon truncation and context shifting", () => {
  const value = openAIToOllamaRequest(request, 2048)
  expect(value.truncate).toBe(false)
  expect(value.shift).toBe(false)
})

test("hardware lookup never falls back to PATH or the current project", () => {
  const checked: string[] = []
  const result = resolveNvidiaSmiExecutable("win32", { SystemRoot: "C:\\Windows", ProgramFiles: "C:\\Program Files", PATH: "." }, (candidate) => {
    checked.push(candidate); return false
  })
  expect(result).toBeUndefined()
  expect(checked).toEqual(["C:\\Windows\\System32\\nvidia-smi.exe", "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe"])
  expect(resolveNvidiaSmiExecutable("win32", { SystemRoot: ".", ProgramFiles: "relative" }, () => true)).toBeUndefined()
  expect(resolveNvidiaSmiExecutable("darwin", {}, () => true)).toBeUndefined()
  expect(resolveNvidiaSmiExecutable("linux", { PATH: "." }, (candidate) => candidate === "/usr/lib/wsl/lib/nvidia-smi")).toBe("/usr/lib/wsl/lib/nvidia-smi")
})

test("benchmark excludes cached prompt tokens and preserves observed zero load time", async () => {
  const client = new OllamaClient({ fetch: async () => new Response(JSON.stringify({
    message: { content: "ok" }, done: true, eval_count: 2, eval_duration: 1000000000,
    prompt_eval_count: 100, prompt_eval_cached_count: 90, prompt_eval_duration: 1000000000,
    load_duration: 0, total_duration: 2000000000,
  })) })
  const result = await client.benchmark({ model: "fixture", contextTokens: 2048 })
  expect(result.promptTokens).toBe(100)
  expect(result.cachedPromptTokens).toBe(90)
  expect(result.promptTokensPerSecond).toBe(10)
  expect(result.outputTokensPerSecond).toBe(2)
  expect(result.loadDurationMs).toBe(0)
})

test("benchmark does not invent throughput for an entirely cached prompt", async () => {
  const client = new OllamaClient({ fetch: async () => new Response(JSON.stringify({
    message: { thinking: "ok" }, done: true, eval_count: 1,
    prompt_eval_count: 20, prompt_eval_cached_count: 20, prompt_eval_duration: 100,
  })) })
  expect((await client.benchmark({ model: "fixture", contextTokens: 2048 })).promptTokensPerSecond).toBeUndefined()
})

test("benchmark connection failures suppress third-party exception details", async () => {
  const client = new OllamaClient({ fetch: async () => { throw new Error("sensitive-fixture-value") } })
  await expect(client.benchmark({ model: "fixture", contextTokens: 2048 })).rejects.toThrow("Ollama benchmark connection failed")
})
