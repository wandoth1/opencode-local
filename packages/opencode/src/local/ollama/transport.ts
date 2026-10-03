import { Buffer } from "node:buffer"
import { normalizeOllamaHost, ollamaHeaders } from "./client"
import { boundedText, checkAbort, jsonObject, object, readNdjson, MAX_FRAME_BYTES, type Json } from "./io"
import { daemonError, responseError } from "./errors"

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export interface OllamaNativeTransportOptions {
  host: string
  contexts: Record<string, number>
  toolSupport?: Record<string, boolean>
  keepAlive?: string
  enabled?: boolean
  fetch?: FetchLike
  apiKey?: string
  headers?: Record<string, string>
  /** Explicit total deadline only. By default, honor the core's cancellation/timeouts. */
  generationTimeoutMs?: number
}

function argumentsObject(value: unknown): Json {
  if (value === undefined || value === "") return {}
  if (typeof value === "string") return jsonObject(value)
  const result = object(value)
  if (!result) throw new Error("Tool arguments must be a JSON object")
  return result
}
function contentParts(value: unknown): { content: string; images: string[] } {
  if (value === null || value === undefined) return { content: "", images: [] }
  if (typeof value === "string") return { content: value, images: [] }
  if (!Array.isArray(value)) throw new Error("Unsupported message content")
  const text: string[] = []
  const images: string[] = []
  for (const raw of value) {
    const part = object(raw)
    if (!part) throw new Error("Invalid content part")
    if (part.type === "text" || part.type === "input_text") {
      if (typeof part.text !== "string") throw new Error("Invalid text part")
      text.push(part.text)
    } else if (["image_url", "input_image", "image"].includes(part.type)) {
      const source = part.image_url ?? part.image ?? part.data
      const url = typeof source === "string" ? source : object(source)?.url
      const match = typeof url === "string" && /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/]+={0,2})$/i.exec(url)
      if (!match) throw new Error("Native Ollama images must be base64 data URIs; external URLs are not fetched")
      images.push(match[1])
    } else throw new Error("Unsupported content part in native Ollama transport")
  }
  return { content: text.join("\n"), images }
}
function convertMessages(raw: unknown): Json[] {
  if (!Array.isArray(raw)) throw new Error("messages must be an array")
  const names = new Map<string, string>()
  return raw.map((value) => {
    const message = object(value)
    if (!message || !["system", "developer", "user", "assistant", "tool"].includes(message.role)) throw new Error("Unsupported message role")
    const parts = contentParts(message.content)
    const result: Json = { role: message.role === "developer" ? "system" : message.role, content: parts.content }
    if (parts.images.length) result.images = parts.images
    const thinking = [message.thinking, message.reasoning, message.reasoning_content].find((item) => typeof item === "string" && item.length)
    if (message.role === "assistant" && thinking) result.thinking = thinking
    if (message.tool_calls !== undefined) {
      if (!Array.isArray(message.tool_calls) || message.role !== "assistant") throw new Error("Invalid assistant tool calls")
      result.tool_calls = message.tool_calls.map((item: unknown, index: number) => {
        const call = object(item)
        const fn = object(call?.function)
        if (!fn || typeof fn.name !== "string" || !fn.name) throw new Error("Invalid tool function name")
        if (typeof call?.id === "string") names.set(call.id, fn.name)
        return {
          ...(typeof call?.id === "string" ? { id: call.id } : {}),
          function: { index, name: fn.name, arguments: argumentsObject(fn.arguments) },
        }
      })
    }
    if (message.role === "tool") {
      const id = typeof message.tool_call_id === "string" ? message.tool_call_id : undefined
      const name = (id ? names.get(id) : undefined) ?? message.name
      if (typeof name !== "string" || !name) throw new Error("Tool result cannot be correlated with an assistant call")
      result.tool_name = name
      if (id) result.tool_call_id = id
    }
    return result
  })
}
function thinking(body: Json): boolean | string | undefined {
  const effort = body.reasoning_effort ?? object(body.reasoning)?.effort
  if (effort === undefined) return undefined
  if (!["none", "minimal", "low", "medium", "high", "max"].includes(effort)) throw new Error("Unsupported reasoning effort")
  if (/gpt[-_]?oss/i.test(String(body.model))) {
    if (effort === "none") throw new Error("GPT-OSS cannot disable thinking")
    return effort === "minimal" ? "low" : effort === "max" ? "high" : effort
  }
  return effort !== "none"
}
function responseFormat(value: unknown) {
  if (value === undefined) return undefined
  const format = object(value)
  if (format?.type === "text") return undefined
  if (format?.type === "json_object") return "json"
  if (format?.type === "json_schema") {
    const schema = object(format.json_schema)?.schema ?? format.schema
    if (object(schema)) return schema
  }
  throw new Error("Unsupported structured output format")
}

export function openAIToOllamaRequest(body: Json, contextTokens?: number, keepAlive?: string) {
  if (typeof body.model !== "string" || !body.model) throw new Error("A model name is required")
  if (body.stream !== undefined && typeof body.stream !== "boolean") throw new Error("stream must be boolean")
  if (body.n !== undefined && body.n !== 1) throw new Error("Native Ollama supports one completion per request")
  if (body.tool_choice !== undefined && !["auto", "none"].includes(body.tool_choice)) throw new Error("Native Ollama only supports tool_choice auto or none")
  const tools = body.tool_choice === "none" ? undefined : body.tools
  if (tools !== undefined) {
    if (!Array.isArray(tools) || tools.length > 128) throw new Error("Native Ollama accepts at most 128 function tools")
    for (const tool of tools) {
      const fn = object(object(tool)?.function)
      if (!fn || tool.type !== "function" || typeof fn.name !== "string" || !fn.name || fn.name.length > 256) throw new Error("Only named function tools are supported")
    }
  }
  const options: Json = {}
  if (contextTokens !== undefined) {
    if (!Number.isSafeInteger(contextTokens) || contextTokens < 2) throw new Error("Context must contain at least two tokens")
    options.num_ctx = contextTokens
  }
  const output = body.max_completion_tokens ?? body.max_tokens
  if (output !== undefined) {
    if (!Number.isSafeInteger(output) || output <= 0) throw new Error("Output token limit must be a positive integer")
    options.num_predict = contextTokens ? Math.min(output, contextTokens - 1) : output
  }
  for (const key of ["temperature", "top_p", "top_k", "seed", "frequency_penalty", "presence_penalty"]) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== "number" || !Number.isFinite(body[key])) throw new Error("Invalid numeric generation option")
    options[key] = body[key]
  }
  if (body.stop != null) {
    const stop = typeof body.stop === "string" ? [body.stop] : body.stop
    if (!Array.isArray(stop) || stop.some((item) => typeof item !== "string")) throw new Error("stop must contain strings")
    options.stop = stop
  }
  return {
    model: body.model,
    messages: convertMessages(body.messages),
    stream: body.stream === true,
    tools: tools?.length ? tools : undefined,
    format: responseFormat(body.response_format),
    keep_alive: keepAlive,
    options,
    think: thinking(body),
    truncate: false,
    shift: false,
  }
}

interface ToolState {
  index: number
  id: string
  nativeId?: string
  name: string
  fragments: string[]
  snapshot?: string
}
class ToolAccumulator {
  private readonly states: ToolState[] = []
  private readonly aliases = new Map<string, ToolState>()
  private bytes = 0
  constructor(private readonly allowed: Set<string>) {}

  add(raw: unknown) {
    if (raw === undefined) return
    if (!Array.isArray(raw)) throw new Error("Invalid native tool calls")
    for (const value of raw) {
      const call = object(value)
      const fn = object(call?.function)
      if (!fn) throw new Error("Invalid native tool function")
      const rawIndex = call?.index ?? fn.index
      if (rawIndex !== undefined && (!Number.isSafeInteger(rawIndex) || rawIndex < 0)) throw new Error("Invalid native tool index")
      const id = typeof call?.id === "string" && call.id ? call.id : undefined
      if (id && id.length > 256) throw new Error("Native tool ID too long")
      const indexKey = rawIndex !== undefined ? `index:${rawIndex}` : undefined
      const idKey = id ? `id:${id}` : undefined
      let state = (idKey && this.aliases.get(idKey)) || (indexKey && this.aliases.get(indexKey)) || undefined
      if (!state) {
        if (this.states.length >= 128) throw new Error("Too many native tool calls")
        if (typeof fn.arguments === "string" && !idKey && !indexKey) throw new Error("Fragmented tool arguments require an ID or index")
        state = { index: this.states.length, id: id ?? `call_${crypto.randomUUID()}`, nativeId: id, name: "", fragments: [] }
        this.states.push(state)
      }
      for (const alias of [idKey, indexKey]) {
        if (!alias) continue
        const previous = this.aliases.get(alias)
        if (previous && previous !== state) throw new Error("Conflicting native tool identity")
        this.aliases.set(alias, state)
      }
      if (id) {
        if (state.nativeId && state.nativeId !== id) throw new Error("Conflicting native tool identity")
        state.id = id
        state.nativeId = id
        this.bytes += Buffer.byteLength(id)
      }
      if (fn.name !== undefined) {
        if (typeof fn.name !== "string" || fn.name.length > 256) throw new Error("Invalid native tool name")
        if (state.name && this.allowed.has(state.name) && fn.name !== state.name) throw new Error("Conflicting native tool name")
        state.name = !state.name || fn.name.startsWith(state.name) ? fn.name : state.name === fn.name ? state.name : state.name + fn.name
        if (state.name.length > 256) throw new Error("Native tool name too long")
        this.bytes += Buffer.byteLength(fn.name)
      }
      if (fn.arguments !== undefined) {
        if (typeof fn.arguments === "string") {
          if (state.snapshot !== undefined) throw new Error("Mixed native tool argument encodings")
          state.fragments.push(fn.arguments)
          this.bytes += Buffer.byteLength(fn.arguments) + 16
        } else {
          if (state.fragments.length) throw new Error("Mixed native tool argument encodings")
          const encoded = JSON.stringify(argumentsObject(fn.arguments))
          // A full argument object closes the call. Different full objects at the
          // same index are conflicting invocations, not incremental field updates.
          if (state.snapshot !== undefined && state.snapshot !== encoded) throw new Error("Conflicting complete native tool arguments")
          state.snapshot = encoded
          this.bytes += Buffer.byteLength(encoded)
        }
      }
      if (this.bytes > MAX_FRAME_BYTES) throw new Error("Native tool payload exceeds its size limit")
    }
  }
  finish() {
    const ids = new Set<string>()
    return this.states.map((state) => {
      if (!this.allowed.has(state.name) || ids.has(state.id)) throw new Error("Unknown or duplicate native tool call")
      ids.add(state.id)
      return {
        index: state.index, id: state.id, type: "function" as const,
        function: { name: state.name, arguments: JSON.stringify(argumentsObject(state.snapshot ?? state.fragments.join(""))) },
      }
    })
  }
}
function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, type: "ollama_error", param: null, code: null } }), {
    status, headers: { "Content-Type": "application/json" },
  })
}
function usage(chunk: Json) {
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0
  const prompt = count(chunk.prompt_eval_count)
  const completion = count(chunk.eval_count)
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
}
function allowedTools(request: Json) {
  return new Set<string>((request.tool_choice === "none" ? [] : request.tools ?? []).map((tool: Json) => tool.function.name))
}
function finishReason(chunk: Json, hasTools: boolean) {
  if (chunk.done_reason === "length") return "length"
  return hasTools ? "tool_calls" : "stop"
}
function delta(chunk: Json): Json {
  if (chunk.error !== undefined) throw daemonError(chunk.error)
  const message = object(chunk.message) ?? {}
  for (const key of ["content", "thinking"]) {
    if (message[key] !== undefined && typeof message[key] !== "string") throw new Error("Invalid native message")
  }
  return {
    ...(message.content ? { content: message.content } : {}),
    ...(message.thinking ? { reasoning: message.thinking } : {}),
  }
}
function streamResponse(response: Response, request: Json, signal: AbortSignal, abort: AbortController) {
  const iterator = readNdjson(response.body, signal)
  const encoder = new TextEncoder()
  const id = `chatcmpl-${crypto.randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  const tools = new ToolAccumulator(allowedTools(request))
  let roleSent = false
  let cancelled = false
  let finished = false
  const frame = (content: Json, reason: string | null = null, stats?: Json) => ({
    id, object: "chat.completion.chunk", created, model: request.model,
    choices: [{ index: 0, delta: content, finish_reason: reason }], ...(stats ? { usage: stats } : {}),
  })
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished || cancelled) return
      const emit = (payload: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      try {
        while (!cancelled) {
          const next = await iterator.next()
          if (cancelled) return
          if (next.done) throw new Error("Ollama stream ended without a done frame")
          const chunk = next.value
          const content = delta(chunk)
          tools.add(object(chunk.message)?.tool_calls)
          if (!roleSent) { content.role = "assistant"; roleSent = true }
          if (Object.keys(content).length) emit(frame(content))
          if (chunk.done === true) {
            const calls = tools.finish()
            if (calls.length && chunk.done_reason === "length") throw new Error("Ollama truncated a tool-call response")
            if (calls.length) emit(frame({ tool_calls: calls }))
            emit(frame({}, finishReason(chunk, calls.length > 0), usage(chunk)))
            controller.enqueue(encoder.encode("data: [DONE]\n\n"))
            finished = true
            controller.close()
            await iterator.return(undefined)
            return
          }
          if (Object.keys(content).length) return
        }
      } catch (error) {
        finished = true
        abort.abort()
        await iterator.return(undefined).catch(() => undefined)
        if (!cancelled) controller.error(error instanceof Error ? error : new Error("Ollama stream failed"))
      }
    },
    async cancel() {
      cancelled = true
      abort.abort()
      await iterator.return(undefined).catch(() => undefined)
    },
  })
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" } })
}

export function createOllamaNativeFetch(options: OllamaNativeTransportOptions): FetchLike {
  const host = normalizeOllamaHost(options.host)
  const base = `${host}/v1/`
  const fetcher = options.fetch ?? fetch
  const timeout = options.generationTimeoutMs
  if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 2147483647)) throw new Error("Invalid explicit Ollama generation timeout")
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!url.href.startsWith(base) || url.username || url.password || url.search || url.hash) return errorResponse(400, "Ollama transport refused a different endpoint")
    const abort = new AbortController()
    const parent = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const signal = AbortSignal.any([
      abort.signal, ...(parent ? [parent] : []), ...(timeout ? [AbortSignal.timeout(timeout)] : []),
    ])
    checkAbort(signal)
    let headers: Headers
    try { headers = ollamaHeaders(options) }
    catch { return errorResponse(400, "Invalid Ollama authentication headers") }
    headers.set("Content-Type", "application/json")
    if (options.enabled === false || url.href !== `${base}chat/completions`) return fetcher(input, { ...init, headers, signal, redirect: "error" })
    let request: Json
    let native: ReturnType<typeof openAIToOllamaRequest>
    try {
      const body = init?.body ?? (input instanceof Request ? input.body : undefined)
      if (!body) throw new Error("A JSON request body is required")
      request = jsonObject(await boundedText(new Response(body).body, signal))
      native = openAIToOllamaRequest(request, options.contexts[request.model], options.keepAlive)
      if (native.tools?.length && options.toolSupport?.[request.model] === false) {
        throw daemonError("model does not support tools")
      }
    } catch (error) {
      checkAbort(signal)
      return errorResponse(400, error instanceof Error ? error.message : "Invalid native request")
    }
    let response: Response
    const nativeInit: RequestInit & { timeout: false } = {
      method: "POST", headers, body: JSON.stringify(native), signal, redirect: "error", timeout: false,
    }
    try { response = await fetcher(`${host}/api/chat`, nativeInit) }
    catch {
      checkAbort(signal)
      return errorResponse(502, "Ollama connection failed (redirects are not allowed)")
    }
    if (!response.ok) {
      const error = await responseError(response, signal)
      return errorResponse(response.status >= 400 ? response.status : 502, error.message)
    }
    if (native.stream) return streamResponse(response, request, signal, abort)
    try {
      const chunk = jsonObject(await boundedText(response.body, signal))
      const content = delta(chunk)
      if (chunk.done !== true) throw new Error("Ollama completion has no done frame")
      const tools = new ToolAccumulator(allowedTools(request))
      tools.add(object(chunk.message)?.tool_calls)
      const calls = tools.finish()
      if (calls.length && chunk.done_reason === "length") throw new Error("Ollama truncated a tool-call response")
      return Response.json({
        id: `chatcmpl-${crypto.randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: request.model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: content.content ?? "", ...(content.reasoning ? { reasoning: content.reasoning } : {}),
            ...(calls.length ? { tool_calls: calls.map(({ index: _index, ...call }) => call) } : {}),
          },
          finish_reason: finishReason(chunk, calls.length > 0),
        }],
        usage: usage(chunk),
      })
    } catch (error) {
      checkAbort(signal)
      return errorResponse(502, error instanceof Error ? error.message : "Invalid Ollama completion")
    }
  }
}
