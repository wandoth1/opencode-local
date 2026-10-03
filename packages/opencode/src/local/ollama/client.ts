import { finitePositive, type LocalModelMetadata } from "../runtime"
import { extractContextLength } from "../context-budget"
import { boundedText, checkAbort, jsonObject, object, readNdjson } from "./io"
import { daemonError, LocalRuntimeError, responseError } from "./errors"

export interface OllamaModelDetails {
  parent_model?: string
  format?: string
  family?: string
  families?: string[]
  parameter_size?: string
  quantization_level?: string
}
export interface OllamaTagModel {
  name: string
  model?: string
  modified_at?: string
  size?: number
  digest?: string
  details?: OllamaModelDetails
}
export interface OllamaTagsResponse { models?: OllamaTagModel[] }
export interface OllamaShowResponse {
  modelfile?: string
  parameters?: string
  template?: string
  system?: string
  details?: OllamaModelDetails
  model_info?: Record<string, unknown>
  capabilities?: string[]
}
export interface OllamaRunningModel extends OllamaTagModel {
  expires_at?: string
  size_vram?: number
  context_length?: number
}
export interface OllamaPsResponse { models?: OllamaRunningModel[] }
export interface OllamaVersionResponse { version?: string }
export interface OllamaDiscoveryModel {
  tag: OllamaTagModel
  show?: OllamaShowResponse
  metadata: LocalModelMetadata
}
export interface OllamaClientOptions {
  host?: string
  apiKey?: string
  headers?: Record<string, string>
  timeoutMs?: number
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}
export interface OllamaBenchmarkResult {
  model: string
  contextTokens: number
  wallDurationMs: number
  timeToFirstTokenMs?: number
  promptTokens?: number
  cachedPromptTokens?: number
  promptTokensPerSecond?: number
  outputTokens?: number
  outputTokensPerSecond?: number
  loadDurationMs?: number
  totalDurationMs?: number
  sample: string
}

export function normalizeOllamaHost(raw?: string): string {
  const source = raw?.trim() || "http://127.0.0.1:11434"
  // Ollama accepts an empty bind host, with or without a path (":11434", ":11434/v1").
  const connectableSource = /^:\d+(?:\/|$)/.test(source) ? `127.0.0.1${source}` : source
  const explicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(connectableSource)
  const input = connectableSource === "ollama.com" ? "https://ollama.com" : connectableSource
  // Bare IPv6 addresses have no unambiguous port; use brackets for an explicit port.
  const bareIpv6 = !explicitScheme && !input.startsWith("[") && (input.match(/:/g)?.length ?? 0) > 1
  let url: URL
  try {
    url = new URL(explicitScheme || input.startsWith("https://") ? input : `http://${bareIpv6 ? `[${input}]` : input}`)
  } catch {
    throw new LocalRuntimeError("Invalid Ollama endpoint. Use a hostname and optional port, or an HTTP(S) URL.")
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new LocalRuntimeError("Ollama endpoints require HTTP(S) without embedded credentials, query or fragment")
  }
  // Host() defaults bare hosts to 11434, but explicit HTTP(S) URLs use 80/443.
  if (!explicitScheme && connectableSource !== "ollama.com" && !url.port) {
    // URL normalizes an explicit :80 to an empty port; do not replace it.
    const authority = connectableSource.split("/")[0]
    if (!/\]:\d+$/.test(authority) && !(authority.split(":").length === 2 && /:\d+$/.test(authority))) url.port = "11434"
  }
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"
  if (url.hostname === "[::]") url.hostname = "[::1]"
  url.pathname = url.pathname.replace(/\/(?:v1|api)\/?$/i, "").replace(/\/+$/, "") || "/"
  return url.toString().replace(/\/$/, "")
}

export function ollamaOpenAIBaseURL(host: string) { return `${normalizeOllamaHost(host)}/v1` }
export function isLoopbackOllamaHost(host: string) {
  const name = new URL(normalizeOllamaHost(host)).hostname.toLowerCase()
  return name === "localhost" || /^127\.\d+\.\d+\.\d+$/.test(name) || name === "[::1]"
}

export function ollamaHeaders(options: Pick<OllamaClientOptions, "apiKey" | "headers">) {
  try {
    const headers = new Headers(options.headers)
    for (const key of ["host", "content-length", "connection", "proxy-authorization", "cookie"]) headers.delete(key)
    if (options.apiKey) headers.set("Authorization", `Bearer ${options.apiKey}`)
    headers.set("Accept", "application/json")
    return headers
  } catch {
    throw new LocalRuntimeError("Invalid Ollama authentication headers")
  }
}

function signalWithTimeout(timeoutMs: number, parent?: AbortSignal) {
  return parent ? AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}
function text(value: unknown) { return typeof value === "string" ? value : undefined }
function nonnegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
function rate(count: number | undefined, ns: unknown) {
  const duration = finitePositive(ns)
  return count !== undefined && count > 0 && duration ? count * 1e9 / duration : undefined
}

export class OllamaClient {
  readonly host: string
  readonly openAIBaseURL: string
  readonly warnings: string[] = []
  private readonly fetcher: NonNullable<OllamaClientOptions["fetch"]>
  private readonly timeout: number

  constructor(private readonly options: OllamaClientOptions = {}) {
    this.host = normalizeOllamaHost(options.host)
    this.openAIBaseURL = ollamaOpenAIBaseURL(this.host)
    this.fetcher = options.fetch ?? fetch
    this.timeout = Math.min(30000, Math.max(100, Math.floor(finitePositive(options.timeoutMs) ?? 5000)))
  }

  private async request(path: string, body?: unknown, parent?: AbortSignal) {
    const signal = signalWithTimeout(this.timeout, parent)
    const headers = ollamaHeaders(this.options)
    if (body !== undefined) headers.set("Content-Type", "application/json")
    let response: Response
    try {
      response = await this.fetcher(`${this.host}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal,
      })
    } catch {
      checkAbort(signal)
      throw new LocalRuntimeError("Ollama connection failed. Check the endpoint and that the daemon is running; redirects are not allowed.")
    }
    if (!response.ok) throw await responseError(response, signal)
    return jsonObject(await boundedText(response.body, signal))
  }

  async version(): Promise<string | undefined> {
    const version = text((await this.request("/api/version")).version)
    return version?.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, 128)
  }
  async available() {
    try { return Boolean(await this.version()) } catch { return false }
  }
  async tags(): Promise<OllamaTagModel[]> {
    const raw = await this.request("/api/tags")
    if (!Array.isArray(raw.models)) throw new LocalRuntimeError("Invalid Ollama model list")
    if (raw.models.length > 256) throw new LocalRuntimeError("Ollama discovery supports at most 256 models; configure a selection manually")
    return raw.models.map((value: unknown) => {
      const tag = object(value)
      if (!tag || typeof tag.name !== "string" || !tag.name || (tag.model !== undefined && typeof tag.model !== "string")) {
        throw new LocalRuntimeError("Invalid Ollama model entry")
      }
      return tag as OllamaTagModel
    })
  }
  async show(model: string, signal?: AbortSignal): Promise<OllamaShowResponse> {
    const response = await this.request("/api/show", { model }, signal)
    if (response.capabilities !== undefined && (!Array.isArray(response.capabilities) || response.capabilities.some((entry: unknown) => typeof entry !== "string"))) {
      throw new LocalRuntimeError("Invalid Ollama model capabilities")
    }
    return response
  }
  async running(): Promise<OllamaRunningModel[]> {
    const raw = await this.request("/api/ps")
    if (!Array.isArray(raw.models)) throw new LocalRuntimeError("Invalid Ollama running-model list")
    return raw.models.filter((value: unknown) => typeof object(value)?.name === "string") as OllamaRunningModel[]
  }

  async describe(tag: OllamaTagModel, signal?: AbortSignal): Promise<OllamaDiscoveryModel> {
    const id = tag.model || tag.name
    const show = await this.show(id, signal)
    const details = { ...object(tag.details), ...object(show.details) }
    const info = object(show.model_info) ?? {}
    return {
      tag,
      show,
      metadata: {
        id,
        family: text(details.family),
        families: strings(details.families),
        format: text(details.format),
        parameterSize: text(details.parameter_size),
        quantization: text(details.quantization_level),
        fileSizeBytes: finitePositive(tag.size) ?? 0,
        contextLength: extractContextLength(info, text(show.parameters)),
        capabilities: strings(show.capabilities),
        modelInfo: info,
      },
    }
  }

  async discover(concurrency = 4, selected?: OllamaTagModel[]): Promise<OllamaDiscoveryModel[]> {
    const tags = selected ?? await this.tags()
    const result: OllamaDiscoveryModel[] = []
    const deadline = signalWithTimeout(15000)
    let cursor = 0
    const worker = async () => {
      while (cursor < tags.length) {
        const tag = tags[cursor++]
        try {
          checkAbort(deadline)
          result.push(await this.describe(tag, deadline))
        } catch {
          // Never advertise guessed capabilities when introspection failed.
          this.warnings.push("A model was omitted because /api/show failed or timed out. Increase discoveryTimeoutMs or inspect it explicitly.")
        }
      }
    }
    const workers = Math.min(8, Math.max(1, Math.floor(finitePositive(concurrency) ?? 4)), tags.length)
    await Promise.all(Array.from({ length: workers }, worker))
    return result.sort((a, b) => a.metadata.id.localeCompare(b.metadata.id))
  }

  async benchmark(input: {
    model: string
    contextTokens: number
    outputTokens?: number
    prompt?: string
    keepAlive?: string
    signal?: AbortSignal
  }): Promise<OllamaBenchmarkResult> {
    if (!Number.isSafeInteger(input.contextTokens) || input.contextTokens < 2) throw new LocalRuntimeError("Benchmark context must be at least 2 tokens")
    const output = input.outputTokens ?? 96
    if (!Number.isSafeInteger(output) || output < 1) throw new LocalRuntimeError("Benchmark output must be a positive integer")
    const started = performance.now()
    let first: number | undefined
    let sample = ""
    let final: Record<string, unknown> | undefined
    const signal = input.signal
    const headers = ollamaHeaders(this.options)
    headers.set("Content-Type", "application/json")
    const init: RequestInit & { timeout: false } = {
      method: "POST",
      redirect: "error",
      headers,
      signal,
      timeout: false,
      body: JSON.stringify({
        model: input.model,
        stream: true,
        keep_alive: input.keepAlive,
        truncate: false,
        shift: false,
        messages: [{ role: "user", content: input.prompt ?? "Return a compact TypeScript function that adds two numbers. Do not call tools." }],
        options: { num_ctx: input.contextTokens, num_predict: Math.min(output, input.contextTokens - 1), temperature: 0 },
      }),
    }
    let response: Response
    try { response = await this.fetcher(`${this.host}/api/chat`, init) }
    catch {
      checkAbort(signal)
      throw new LocalRuntimeError("Ollama benchmark connection failed")
    }
    if (!response.ok) throw await responseError(response, signal)
    for await (const chunk of readNdjson(response.body, signal)) {
      if (chunk.error !== undefined) throw daemonError(chunk.error)
      const message = object(chunk.message)
      const emitted = [message?.thinking, message?.content]
        .filter((value): value is string => typeof value === "string" && value.length > 0).join("")
      if (emitted && first === undefined) first = performance.now()
      if (sample.length < 500) sample += emitted.slice(0, 500 - sample.length)
      if (chunk.done === true) { final = chunk; break }
    }
    if (!final || first === undefined || !sample || !finitePositive(final.eval_count)) {
      throw new LocalRuntimeError("Benchmark produced no valid completed output")
    }
    const total = nonnegative(final.total_duration)
    const load = nonnegative(final.load_duration)
    const prompt = nonnegative(final.prompt_eval_count)
    const cached = nonnegative(final.prompt_eval_cached_count)
    // Ollama 0.32.14 does not emit a cache count. Unknown is not zero.
    const evaluated = prompt === undefined || cached === undefined || cached > prompt ? undefined : prompt - cached
    const tokens = nonnegative(final.eval_count)
    if (!tokens) throw new LocalRuntimeError("Benchmark returned an invalid output token count")
    return {
      model: input.model,
      contextTokens: input.contextTokens,
      wallDurationMs: performance.now() - started,
      timeToFirstTokenMs: first - started,
      promptTokens: prompt,
      cachedPromptTokens: cached,
      promptTokensPerSecond: rate(evaluated, final.prompt_eval_duration),
      outputTokens: tokens,
      outputTokensPerSecond: rate(tokens, final.eval_duration),
      loadDurationMs: load === undefined ? undefined : load / 1e6,
      totalDurationMs: total === undefined ? undefined : total / 1e6,
      sample,
    }
  }
}
