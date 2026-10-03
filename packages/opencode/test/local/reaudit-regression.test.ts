import { expect, test } from "bun:test"
import { GIB, type HardwareSnapshot, type LocalConfig, type LocalModelMetadata } from "@/local/runtime"
import { recommendContext, estimateKvBytesPerToken } from "@/local/context-budget"
import { OllamaClient, normalizeOllamaHost } from "@/local/ollama/client"
import { configureOllama, discoverOllama, resolveOllamaSettings } from "@/local/ollama/integration"
import { createOllamaNativeFetch, type FetchLike } from "@/local/ollama/transport"
import { checkAbort } from "@/local/ollama/io"
import { getDoctorReport } from "@/local/doctor"
import { parseCudaVersion } from "@/local/hardware"
import { isContextOverflow } from "../../../llm/src/provider-error"

const host = "http://127.0.0.1:11434"
const endpoint = `${host}/v1/chat/completions`
const metadata: LocalModelMetadata = {
  id: "fixture", family: "llama", families: ["llama"], fileSizeBytes: 9.2 * GIB,
  contextLength: 131072, capabilities: ["completion", "tools"],
  modelInfo: { "general.architecture": "llama", "llama.block_count": 32,
    "llama.embedding_length": 4096, "llama.attention.head_count": 32, "llama.attention.head_count_kv": 8 },
}
const hardware = (free: number): HardwareSnapshot => ({
  platform: "win32", architecture: "x64", cpuModel: "fixture", cpuCount: 4,
  systemMemoryTotalBytes: 64 * GIB, systemMemoryFreeBytes: 32 * GIB,
  nvidiaGpus: [{ index: 0, name: "RTX 5070", memoryTotalBytes: 12 * GIB,
    memoryFreeBytes: free * GIB, memoryUsedBytes: (12 - free) * GIB }],
})
const config = (options = {}, models = {}) => ({ provider: { ollama: { options, models } } })
const payload = (extra = {}) => ({ model: "fixture", messages: [{ role: "user", content: "hello" }], ...extra })
const tools = ["read", "read_all"].map((name) => ({ type: "function", function: { name, parameters: { type: "object" } } }))
const fixture: FetchLike = async (input) => {
  const route = new URL(String(input)).pathname
  if (route === "/api/tags") return Response.json({ models: [{ name: "fixture", size: 9.2 * GIB }] })
  if (route === "/api/show") return Response.json({ capabilities: ["completion", "tools"], model_info: {
    ...metadata.modelInfo, "llama.context_length": 131072,
  } })
  if (route === "/api/version") return Response.json({ version: "0.32.14" })
  if (route === "/api/ps") return Response.json({ models: [] })
  throw new Error("Unexpected fixture route")
}
async function withEnv(values: Record<string, string | undefined>, callback: () => unknown | Promise<unknown>) {
  const keys = [...new Set([...Object.keys(process.env).filter((key) => key.startsWith("OPENCODE_OLLAMA_") || key === "OPENCODE_LOCAL_DISABLE" || key === "OLLAMA_HOST"), ...Object.keys(values)])]
  const saved = new Map(keys.map((key) => [key, process.env[key]]))
  try {
    for (const key of keys) delete process.env[key]
    for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value
    await callback()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("B1: busy and empty 5070 budgets never shrink the agent default to 4K", async () => withEnv({}, async () => {
  for (const free of [0, 1.2, 11.5]) {
    const snapshot = await discoverOllama({}, undefined, { fetch: fixture, hardware: () => hardware(free) })
    expect(snapshot?.models.fixture.limit.context).toBe(32768)
    expect(snapshot?.models.fixture.limit.output).toBe(8192)
    expect(snapshot?.profiles.fixture.context.confidence).not.toBe("high")
  }
}))
test("B1: native maxima and deliberate small allocations are still respected", () => {
  expect(recommendContext({ model: { ...metadata, contextLength: 2048 }, hardware: hardware(1) }).recommendedContextTokens).toBe(2048)
  expect(recommendContext({ model: metadata, requestedContextTokens: 1024 }).recommendedContextTokens).toBe(1024)
})
test("M3: hybrid, sliding-window and missing-KV metadata cannot claim a conventional estimate", () => {
  for (const modelInfo of [
    { ...metadata.modelInfo, "llama.attention.sliding_window": 1024 },
    { ...metadata.modelInfo, "llama.ssm.state_size": 128 },
    { ...metadata.modelInfo, "llama.attention.head_count_kv": null },
    { ...metadata.modelInfo, "general.architecture": "qwen35" },
  ]) {
    const model = { ...metadata, modelInfo }
    expect(estimateKvBytesPerToken(model)).toBeUndefined()
    const result = recommendContext({ model, hardware: hardware(11.5) })
    expect(result.confidence).toBe("low")
    expect(result.estimatedKvVramBytes).toBeUndefined()
    expect(result.recommendedContextTokens).toBe(32768)
  }
})
test("M1: bare hosts use 11434 and unspecified bind addresses become connectable", () => {
  for (const [input, expected] of [
    ["127.0.0.1", host], [":11434", host], ["myserver", "http://myserver:11434"],
    ["0.0.0.0:11434", host], ["[::]:11434", "http://[::1]:11434"],
    ["::1", "http://[::1]:11434"], ["[::1]", "http://[::1]:11434"],
    ["http://myserver", "http://myserver"], ["https://myserver", "https://myserver"],
    ["myserver:80", "http://myserver"], ["myserver:1234/path/v1", "http://myserver:1234/path"],
  ]) expect(normalizeOllamaHost(input)).toBe(expected)
})
test("H3: disabling local integration removes and blacklists the raw provider without network access", async () => withEnv({ OPENCODE_LOCAL_DISABLE: "1" }, async () => {
  const cfg: LocalConfig = config({ host: "http://127.0.0.1:9999", apiKey: "merged-global-secret" })
  let calls = 0
  await configureOllama(cfg, config({ apiKey: "merged-global-secret" }), { fetch: async () => { calls++; throw new Error("not reached") } })
  expect((cfg.provider as Record<string, unknown>).ollama).toBeUndefined()
  expect(cfg.disabled_providers).toContain("ollama")
  expect(calls).toBe(0)
}))
test("H3/L5: a generic bind hint cannot divert an env key, but a global endpoint can bind it", async () => withEnv({ OLLAMA_HOST: "127.0.0.1:9999", OPENCODE_OLLAMA_API_KEY: "profile-key" }, () => {
  expect(resolveOllamaSettings({}).apiKey).toBeUndefined()
  const trusted = config({ host: "http://127.0.0.1:9999" })
  expect(resolveOllamaSettings(trusted, trusted).apiKey).toBe("profile-key")
}))
test("M5: keep_alive is absent by default and explicit settings survive", async () => withEnv({ OLLAMA_KEEP_ALIVE: "1h" }, () => {
  expect(resolveOllamaSettings({}).keepAlive).toBeUndefined()
  expect(resolveOllamaSettings(config({ keepAlive: "2h" })).keepAlive).toBe("2h")
}))
test("M5/M6: manual models use live show metadata and keep their requested 64K", async () => withEnv({}, async () => {
  let showCalls = 0
  const fetcher: FetchLike = async (url, init) => {
    if (String(url).endsWith("/api/show")) showCalls++
    if (String(url).endsWith("/api/tags")) throw new Error("manual discovery must not list all models")
    return fixture(url, init)
  }
  const snapshot = await discoverOllama(config({ autoDiscover: false, numCtx: 65536 }, { fixture: { limit: { context: 65536, output: 8192 } } }), undefined, { fetch: fetcher, hardware: () => hardware(1) })
  expect(showCalls).toBe(1)
  expect(snapshot?.models.fixture.limit.context).toBe(65536)
}))
test("M5: Modelfile context is the default allocation but cannot raise native maximum", async () => withEnv({}, async () => {
  const snapshot = await discoverOllama({}, undefined, { fetch: async (url, init) => String(url).endsWith("/api/show")
    ? Response.json({ capabilities: ["completion", "tools"], parameters: "num_ctx 65536", model_info: { "general.architecture": "llama", "llama.context_length": 32768 } })
    : fixture(url, init), hardware: () => hardware(1) })
  expect(snapshot?.models.fixture.limit.context).toBe(32768)
}))
test("M4: failed show excludes the model and reports the missing introspection", async () => {
  const client = new OllamaClient({ fetch: async (url, init) => String(url).endsWith("/api/show")
    ? new Response("unavailable", { status: 500 }) : fixture(url, init) })
  expect(await client.discover()).toEqual([])
  expect(client.warnings.join(" ")).toContain("/api/show")
})
test("M2: doctor does not mistake plugin-produced model limits for user overrides", async () => withEnv({}, async () => {
  const cfg: LocalConfig = {}
  const deps = { fetch: fixture, hardware: () => hardware(1) }
  await configureOllama(cfg, {}, deps)
  const report = await getDoctorReport(cfg, {}, {}, deps)
  expect(report.snapshot.models.fixture.limit.context).toBe(32768)
  expect(report.snapshot.models.fixture.context?.reasons.join(" ")).not.toContain("explicit user")
}))
test("M2: doctor with a dead override cannot reuse models from the initialized endpoint", async () => withEnv({}, async () => {
  const cfg: LocalConfig = {}
  await configureOllama(cfg, {}, { fetch: fixture, hardware: () => hardware(1) })
  await expect(getDoctorReport(cfg, {}, { host: "http://127.0.0.1:9" }, { fetch: async () => { throw new Error("offline") } })).rejects.toThrow("connection failed")
}))
test("L4: benchmark requires explicit model selection before loading anything", async () => withEnv({}, async () => {
  let calls = 0
  await expect(getDoctorReport({}, {}, { benchmark: true }, { fetch: async () => { calls++; return Response.json({}) } })).rejects.toThrow("requires --model")
  expect(calls).toBe(0)
}))
test("H1: overflow remains recognizable by the real core classifier without echoing secrets", async () => {
  const native = createOllamaNativeFetch({ host, contexts: { fixture: 16384 }, fetch: async () => Response.json({ error: "request (7342 tokens) exceeds the available context size (4096 tokens) secret-fixture" }, { status: 400 }) })
  const response = await native(endpoint, { method: "POST", body: JSON.stringify(payload()) })
  const body = await response.json()
  expect(response.status).toBe(400)
  expect(isContextOverflow(body.error.message)).toBe(true)
  expect(JSON.stringify(body)).not.toContain("secret-fixture")
})
test("H1: tool-incompatible models fail clearly before a generation request", async () => {
  let calls = 0
  const native = createOllamaNativeFetch({ host, contexts: { fixture: 16384 }, toolSupport: { fixture: false }, fetch: async () => { calls++; return Response.json({}) } })
  const response = await native(endpoint, { method: "POST", body: JSON.stringify(payload({ tools })) })
  expect((await response.json()).error.message).toContain("does not support tools")
  expect(calls).toBe(0)
})
test("H2: TimeoutError is distinct from user cancellation and never echoes the abort reason", () => {
  const timeout = new AbortController()
  timeout.abort(new DOMException("private-timeout-value", "TimeoutError"))
  try { checkAbort(timeout.signal); throw new Error("did not throw") }
  catch (error) { expect((error as Error).name).toBe("TimeoutError"); expect((error as Error).message).not.toContain("private-timeout-value") }
  const cancel = new AbortController()
  cancel.abort("private-reason")
  expect(() => checkAbort(cancel.signal)).toThrow("aborted")
})
test("H2: explicit deadline survives integration and standard core timeout controls are preserved", async () => withEnv({}, async () => {
  const cfg: LocalConfig = config({ generationTimeoutMs: 200, timeout: false, chunkTimeout: 60000, headerTimeout: 90000 })
  expect(resolveOllamaSettings(cfg).generationTimeoutMs).toBe(200)
  await configureOllama(cfg, {}, { fetch: fixture, hardware: () => hardware(1) })
  const provider = (cfg.provider as { ollama: { options: Record<string, unknown> } }).ollama
  expect(provider.options.timeout).toBe(false)
  expect(provider.options.chunkTimeout).toBe(60000)
  expect(provider.options.headerTimeout).toBe(90000)
}))
test("H2: explicit transport deadline reports a timeout on a stalled native body", async () => {
  const native = createOllamaNativeFetch({ host, contexts: { fixture: 16384 }, generationTimeoutMs: 30,
    fetch: async () => new Response(new ReadableStream<Uint8Array>()) })
  const response = await native(endpoint, { method: "POST", body: JSON.stringify(payload({ stream: true })) })
  try { await response.text(); throw new Error("did not timeout") }
  catch (error) { expect((error as Error).name).toBe("TimeoutError") }
})
test("M8: two complete calls sharing an index without ID cannot be silently merged", async () => {
  for (const name of ["read", "read_all"]) {
    const frames = [
      { message: { tool_calls: [{ function: { index: 0, name: "read", arguments: { path: "a.ts" } } }] }, done: false },
      { message: { tool_calls: [{ function: { index: 0, name, arguments: { path: "b.ts" } } }] }, done: true },
    ]
    const native = createOllamaNativeFetch({ host, contexts: { fixture: 16384 }, fetch: async () => new Response(frames.map((frame) => JSON.stringify(frame)).join("\n")) })
    const response = await native(endpoint, { method: "POST", body: JSON.stringify(payload({ stream: true, tools })) })
    await expect(response.text()).rejects.toThrow("Conflicting")
  }
})
test("M7: absent cache count does not fabricate prefill throughput", async () => {
  const client = new OllamaClient({ fetch: async () => Response.json({ message: { content: "OK" }, done: true,
    eval_count: 2, eval_duration: 1000000000, prompt_eval_count: 100, prompt_eval_duration: 1000000 }) })
  const result = await client.benchmark({ model: "fixture", contextTokens: 16384 })
  expect(result.promptTokensPerSecond).toBeUndefined()
  expect(result.outputTokensPerSecond).toBe(2)
})
test("L1/L2: terminal version controls are stripped and CUDA UMD banners are recognized", async () => {
  const client = new OllamaClient({ fetch: async () => Response.json({ version: "\u001b]0;bad\u0007v0.32.14" }) })
  expect(await client.version()).not.toContain("\u001b")
  expect(await client.version()).not.toContain("\u0007")
  expect(parseCudaVersion("NVIDIA-SMI 616.92   CUDA UMD Version: 13.4")).toBe("13.4")
})
