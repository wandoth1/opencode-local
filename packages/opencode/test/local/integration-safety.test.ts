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

test("environment endpoint wins over a malicious project endpoint", async () => withEnv({ OPENCODE_OLLAMA_HOST: "https://trusted.invalid", OPENCODE_OLLAMA_API_KEY: "secret-fixture" }, () => {
  const s = resolveOllamaSettings(config({ host: "https://attacker.invalid" }))
  assert.equal(s.host, "https://trusted.invalid"); assert.equal(s.apiKey, "secret-fixture")
}))
test("global endpoint credentials are bound to full origin, port and path", async () => withEnv({}, () => {
  const global = config({ host: "http://127.0.0.1:11434/prefix", apiKey: "global-secret", headers: { "x-private": "s" } })
  for (const host of ["http://127.0.0.1:8888", "http://127.0.0.1:11434/other"]) {
    const s = resolveOllamaSettings(config({ host }), global)
    assert.equal(s.apiKey, undefined); assert.equal(s.headers, undefined)
  }
  assert.equal(resolveOllamaSettings(global, global).apiKey, "global-secret")
}))
test("CLI host override does not inherit credentials from a different endpoint", async () => withEnv({ OPENCODE_OLLAMA_HOST: "https://trusted.invalid", OPENCODE_OLLAMA_API_KEY: "s" }, () => {
  const s = resolveOllamaSettings({}, {}, { host: "https://other.invalid" }); assert.equal(s.apiKey, undefined)
}))
test("project cannot inject its own resolved API key or headers", async () => withEnv({}, () => {
  const s = resolveOllamaSettings(config({ host: "http://127.0.0.1:9999", apiKey: "copied-user-key", headers: { Authorization: "bad" } }))
  assert.equal(s.apiKey, undefined); assert.equal(s.headers, undefined)
}))
test("disabled providers and global opt-out make no discovery calls", async () => withEnv({}, async () => {
  let called = false
  const fetch: FetchLike = async () => { called = true; throw new Error("unexpected") }
  for (const cfg of [{ disabled_providers: ["ollama"] }, { enabled_providers: ["openai"] }]) assert.equal(await discoverOllama(cfg as any, undefined, { fetch }), undefined)
  process.env.OPENCODE_LOCAL_DISABLE = "true"
  assert.equal(await discoverOllama({}, undefined, { fetch }), undefined); assert.equal(called, false)
}))
test("remote runtime is never budgeted against the client's GPU", async () => withEnv({ OPENCODE_OLLAMA_HOST: "https://trusted.invalid" }, async () => {
  const s = await discoverOllama({}, undefined, { fetch: fixtureFetch, hardware: () => { throw new Error("must not inspect local GPU") } })
  assert.equal(s?.hardware.platform, "remote"); assert.equal(s?.hardware.nvidiaGpus.length, 0)
}))
test("version survives /api/ps failure", async () => withEnv({}, async () => {
  const s = await discoverOllama({}, undefined, { ...deps, fetch: async (url, init) => String(url).endsWith("/api/ps") ? new Response("error", { status: 500 }) : fixtureFetch(url, init) })
  assert.equal(s?.version, "fixture-version"); assert.equal(s?.capabilities.runtimeIntrospection, false)
}))
test("configuration preserves cloud provider and applies safe manual model overrides", async () => withEnv({}, async () => {
  const cfg = config({}, { fixture: { name: "My local model", tool_call: true, limit: { context: 1000, output: 4000 }, provider: { api: "https://attacker.invalid", npm: "evil" }, options: { apiKey: "hidden" } } })
  const cloud = { options: { apiKey: "cloud-key" } }; cfg.provider.openai = cloud
  await configureOllama(cfg, {}, deps)
  assert.equal(cfg.provider.openai, cloud)
  assert.equal(cfg.provider.ollama.models.fixture.name, "My local model")
  assert.equal(cfg.provider.ollama.models.fixture.limit.context, 1000)
  assert.equal(cfg.provider.ollama.models.fixture.limit.output, 999)
  assert.equal(cfg.provider.ollama.models.fixture.provider.npm, "@ai-sdk/openai-compatible")
  assert.equal(cfg.provider.ollama.options.apiKey, "ollama")
  assert(!JSON.stringify(cfg.provider.ollama.models).includes("attacker"))
}))
test("manual context and numCtx overrides both respect native maximum", async () => withEnv({}, async () => {
  const s = await discoverOllama(config({ numCtx: 131072 }, { fixture: { limit: { context: 65536 } } }), undefined, deps)
  assert.equal(s?.models.fixture.limit.context, 2048)
}))
test("discovery creates isolated snapshots and does not retain negative results", async () => withEnv({}, async () => {
  assert.equal(await discoverOllama({}, undefined, { ...deps, fetch: async () => { throw new Error("offline") } }), undefined)
  const one = await discoverOllama({}, undefined, deps), two = await discoverOllama({}, undefined, deps)
  assert(one && two); assert.notEqual(one, two); one.models.fixture.name = "changed"; assert.notEqual(two.models.fixture.name, "changed")
}))
test("diagnostic export never serializes arbitrary settings, model options or metadata", async () => withEnv({ OPENCODE_OLLAMA_API_KEY: "secret-fixture" }, async () => {
  const s = await discoverOllama({}, undefined, deps); assert(s)
  s.models.fixture.options.customValue = "secret-fixture"; s.profiles.fixture.metadata.modelInfo.someValue = "secret-fixture"
  assert(!JSON.stringify(diagnosticSnapshot(s)).includes("secret-fixture"))
}))
test("doctor uses merged and trusted global config, then CLI context override", async () => withEnv({}, async () => {
  const global = config({ apiKey: "global-fixture", keepAlive: "2m" })
  const merged = config({ ...global.provider.ollama.options }, { fixture: { name: "User alias", limit: { context: 1800 } } })
  let authorized = 0
  const report = await getDoctorReport(merged, global, { numCtx: 999999 }, { ...deps, fetch: async (url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer global-fixture"); authorized++; return fixtureFetch(url, init)
  } })
  assert(authorized > 0); assert.equal(report.snapshot.models.fixture.name, "User alias"); assert.equal(report.snapshot.models.fixture.limit.context, 2048)
  assert(!JSON.stringify(report).includes("global-fixture"))
}))
test("doctor rejects unknown selected models and invalid numbers", async () => withEnv({}, async () => {
  await assert.rejects(getDoctorReport({}, {}, { model: "missing" }, deps))
  for (const numCtx of [0, -1, 2.5, NaN, Infinity]) await assert.rejects(getDoctorReport({}, {}, { numCtx }, deps))
}))
