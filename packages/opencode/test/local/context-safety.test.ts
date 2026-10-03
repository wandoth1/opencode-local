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

test("context invariants hold for tiny, normal and malformed maxima", () => {
  for (const maximum of [1, 2, 3, 64, 255, 512, 1024, 2048, 4096, 32768, NaN, Infinity, -1]) {
    for (const asked of [undefined, 1, 64, 1000, 16384, 1e7]) {
      const r = recommendContext({ model: { ...model, contextLength: maximum }, hardware: hardware(), requestedContextTokens: asked })
      assert(r.recommendedContextTokens > 0 && r.recommendedContextTokens <= r.modelMaxContextTokens)
      assert(r.recommendedOutputTokens >= 0 && r.recommendedOutputTokens < r.recommendedContextTokens)
      assert(r.recommendedHistoryTokens <= r.recommendedContextTokens - r.recommendedOutputTokens)
      assert(Number.isFinite(r.estimatedModelVramBytes))
      assert((r.availableVramBytes ?? 0) >= 0 && (r.availableVramBytes ?? 0) <= 12 * GIB)
    }
  }
  assert.equal(recommendContext({ model: { ...model, contextLength: 2048 } }).recommendedContextTokens, 2048)
})
test("explicit small context is not rounded upward", () => assert.equal(recommendContext({ model, requestedContextTokens: 1000 }).recommendedContextTokens, 1000))
test("Modelfile does not increase a native context maximum", () => assert.equal(extractContextLength({ "llama.context_length": 2048 }, "num_ctx 65536"), 2048))
test("explicit key/value dimensions affect KV estimates", () => {
  assert.equal(estimateKvBytesPerToken({ ...model, modelInfo: { ...model.modelInfo, "llama.attention.key_length": 256, "llama.attention.value_length": 128 } }), 196608)
  assert.equal(estimateKvBytesPerToken(model, 34 / 32), 69632)
  assert.equal(estimateKvBytesPerToken(model, NaN), undefined)
})
test("loaded VRAM cannot inflate effective memory beyond physical capacity", () => {
  const r = recommendContext({ model, hardware: hardware(2), loadedSizeVramBytes: 200 * GIB })
  assert((r.availableVramBytes ?? 0) < 12 * GIB)
  assert(r.recommendedContextTokens <= model.contextLength!)
})
test("multi-GPU is not aggregated or credited an unknown model placement", () => {
  const hw = hardware(2); hw.nvidiaGpus.push({ ...hw.nvidiaGpus[0], index: 1 })
  const r = recommendContext({ model, hardware: hw, loadedSizeVramBytes: 20 * GIB })
  assert.equal(r.availableVramBytes, 0); assert(r.expectedCpuOffload)
})
test("KV estimate is recomputed for the final explicit context", () => {
  const r = recommendContext({ model, hardware: hardware(), requestedContextTokens: 32768 })
  assert.equal(r.estimatedKvVramBytes, r.recommendedContextTokens * r.estimatedKvBytesPerToken!)
  assert(r.expectedCpuOffload)
})
test("numeric helpers reject booleans and objects", () => { assert.equal(finitePositive(true), undefined); assert.equal(finitePositive([]), undefined) })
test("NVIDIA CSV handles quoted names, N/A and invalid memory", () => {
  const r = parseNvidiaSmiCsv('0,"RTX, test",999,12000,11000,1000,N/A\n1,bad,999,100,200,1,0\n2,missing,999,N/A,N/A,N/A,N/A')
  assert.equal(r.length, 1); assert.equal(r[0].name, "RTX, test"); assert.equal(r[0].utilizationPercent, undefined)
})
test("redaction covers credential/auth/bearer and cyclic structures", () => {
  const value: any = { credential: "s", auth: "s", bearer: "s", nested: { password: "s" }, text: "safe" }; value.self = value
  const clean = JSON.stringify(redactSecrets(value)); assert(!clean.includes('"s"')); assert(clean.includes("safe")); assert(clean.includes("circular"))
})
test("reject URL credentials, query, fragment and non-HTTP schemes", () => {
  for (const url of ["http://u:p@localhost", "http://localhost?secret=x", "http://localhost/#x", "file:///tmp/test", "ftp://localhost"]) assert.throws(() => normalizeOllamaHost(url))
  assert(isLoopbackOllamaHost("http://[::1]:11434")); assert(!isLoopbackOllamaHost("http://localhost.example"))
})
test("project remote endpoint is blocked before any key is used", async () => withEnv({ OPENCODE_OLLAMA_API_KEY: "secret-fixture" }, async () => {
  let calls = 0
  const cfg = config({ host: "https://attacker.invalid" })
  await assert.rejects(configureOllama(cfg, {}, { fetch: async () => { calls++; throw new Error("should not connect") } }))
  assert.equal(calls, 0); assert.equal(cfg.provider.ollama, undefined)
}))
