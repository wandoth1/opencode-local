import { normalizeOllamaHost } from "./client"

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface OllamaNativeTransportOptions {
  host: string
  contexts: Record<string, number>
  keepAlive?: string
  enabled?: boolean
  fetch?: FetchLike
}

type JsonRecord = Record<string, any>

function asObject(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== "string" || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return asObject(parsed) ?? {}
  } catch {
    return { value }
  }
}

function extractImage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const match = /^data:[^;]+;base64,(.+)$/i.exec(value)
  return match?.[1]
}

function convertContent(content: unknown) {
  if (typeof content === "string") return { content, images: [] as string[] }
  if (!Array.isArray(content)) return { content: content == null ? "" : String(content), images: [] as string[] }

  const text: string[] = []
  const images: string[] = []
  for (const part of content) {
    const item = asObject(part)
    if (!item) continue
    if (item.type === "text" || item.type === "input_text") {
      if (typeof item.text === "string") text.push(item.text)
      continue
    }
    if (item.type === "image_url") {
      const url = typeof item.image_url === "string" ? item.image_url : item.image_url?.url
      const image = extractImage(url)
      if (image) images.push(image)
      continue
    }
    if (item.type === "input_image" || item.type === "image") {
      const image = extractImage(item.image_url ?? item.image ?? item.data)
      if (image) images.push(image)
    }
  }
  return { content: text.join("\n"), images }
}

function messageThinking(message: JsonRecord) {
  return [message.thinking, message.reasoning, message.reasoning_content].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
}

function convertMessages(messages: unknown): JsonRecord[] {
  if (!Array.isArray(messages)) return []
  return messages.flatMap((raw) => {
    const message = asObject(raw)
    if (!message || typeof message.role !== "string") return []
    const converted = convertContent(message.content)
    const thinking = messageThinking(message)
    const result: JsonRecord = {
      role: message.role,
      content: converted.content,
      ...(thinking && message.role === "assistant" ? { thinking } : {}),
      ...(converted.images.length ? { images: converted.images } : {}),
    }

    if (typeof message.tool_call_id === "string") result.tool_call_id = message.tool_call_id
    if (typeof message.name === "string") result.tool_name = message.name
    if (Array.isArray(message.tool_calls)) {
      const calls = message.tool_calls.flatMap((rawCall: unknown, index: number) => {
        const call = asObject(rawCall)
        const fn = asObject(call?.function)
        if (!fn || typeof fn.name !== "string") return []
        return [
          {
            id: typeof call?.id === "string" ? call.id : `call_${index}`,
            function: {
              index,
              name: fn.name,
              arguments: parseArguments(fn.arguments),
            },
          },
        ]
      })
      if (calls.length) result.tool_calls = calls
    }
    return [result]
  })
}

function reasoningSetting(body: JsonRecord): boolean | string | undefined {
  const effort =
    (typeof body.reasoning_effort === "string" ? body.reasoning_effort : undefined) ??
    (typeof body.reasoning?.effort === "string" ? body.reasoning.effort : undefined)
  if (!effort) return undefined
  if (effort === "none") return false
  if (effort === "minimal") return "low"
  if (["low", "medium", "high"].includes(effort)) return effort
  return true
}

function convertResponseFormat(value: unknown): unknown {
  const format = asObject(value)
  if (!format) return undefined
  if (format.type === "json_object") return "json"
  if (format.type === "json_schema") return format.json_schema?.schema ?? format.schema
  return undefined
}

function requestTools(body: JsonRecord) {
  if (body.tool_choice === "none") return undefined
  return Array.isArray(body.tools) && body.tools.length > 0 ? body.tools : undefined
}

export function openAIToOllamaRequest(body: JsonRecord, contextTokens: number | undefined, keepAlive?: string) {
  const options: JsonRecord = {
    ...(contextTokens ? { num_ctx: contextTokens } : {}),
    ...(typeof body.max_tokens === "number" ? { num_predict: body.max_tokens } : {}),
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(typeof body.top_p === "number" ? { top_p: body.top_p } : {}),
    ...(typeof body.seed === "number" ? { seed: body.seed } : {}),
    ...(typeof body.frequency_penalty === "number" ? { frequency_penalty: body.frequency_penalty } : {}),
    ...(typeof body.presence_penalty === "number" ? { presence_penalty: body.presence_penalty } : {}),
    ...(body.stop !== undefined
      ? { stop: Array.isArray(body.stop) ? body.stop : typeof body.stop === "string" ? [body.stop] : body.stop }
      : {}),
  }

  return {
    model: body.model,
    messages: convertMessages(body.messages),
    stream: body.stream !== false,
    tools: requestTools(body),
    format: convertResponseFormat(body.response_format),
    keep_alive: keepAlive,
    options,
    think: reasoningSetting(body),
    truncate: false,
  }
}

function createdSeconds(createdAt: unknown) {
  const parsed = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000)
}

function toolCalls(raw: unknown) {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value, index) => {
    const call = asObject(value)
    const fn = asObject(call?.function)
    if (!fn || typeof fn.name !== "string") return []
    return [
      {
        index: typeof fn.index === "number" ? fn.index : index,
        id: typeof call?.id === "string" && call.id ? call.id : `call_${index}`,
        type: "function",
        function: {
          name: fn.name,
          arguments: JSON.stringify(asObject(fn.arguments) ?? fn.arguments ?? {}),
        },
      },
    ]
  })
}

function finishReason(doneReason: unknown, sawTools: boolean) {
  if (sawTools) return "tool_calls"
  if (doneReason === "length") return "length"
  return "stop"
}

function chunkPayload(input: {
  id: string
  model: string
  created: number
  delta: JsonRecord
  finishReason: string | null
  usage?: JsonRecord
}) {
  return {
    id: input.id,
    object: "chat.completion.chunk",
    created: input.created,
    model: input.model,
    choices: [
      {
        index: 0,
        delta: input.delta,
        finish_reason: input.finishReason,
      },
    ],
    ...(input.usage ? { usage: input.usage } : {}),
  }
}

function completionPayload(chunk: JsonRecord, request: JsonRecord) {
  const calls = toolCalls(chunk.message?.tool_calls)
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: createdSeconds(chunk.created_at),
    model: String(chunk.model ?? request.model ?? ""),
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: String(chunk.message?.content ?? ""),
          ...(chunk.message?.thinking ? { reasoning: String(chunk.message.thinking) } : {}),
          ...(calls.length ? { tool_calls: calls } : {}),
        },
        finish_reason: finishReason(chunk.done_reason, calls.length > 0),
      },
    ],
    usage: {
      prompt_tokens: Number(chunk.prompt_eval_count ?? 0),
      completion_tokens: Number(chunk.eval_count ?? 0),
      total_tokens: Number(chunk.prompt_eval_count ?? 0) + Number(chunk.eval_count ?? 0),
    },
  }
}

function openAIError(status: number, body: string) {
  let message = body
  try {
    const parsed = JSON.parse(body)
    message = parsed.error ?? parsed.message ?? body
  } catch {}
  return new Response(
    JSON.stringify({
      error: {
        message: String(message || `Ollama request failed with status ${status}`),
        type: "ollama_error",
        param: null,
        code: null,
      },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  )
}

async function bodyText(input: RequestInfo | URL, init: RequestInit | undefined) {
  const body = init?.body
  if (typeof body === "string") return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof Blob) return body.text()
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body))
  if (input instanceof Request) {
    try {
      return await input.clone().text()
    } catch {
      return undefined
    }
  }
  return undefined
}

function requestHeaders(input: RequestInfo | URL, init: RequestInit | undefined) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
  headers.delete("content-length")
  headers.delete("host")
  headers.set("Content-Type", "application/json")
  headers.set("Accept", "application/x-ndjson")
  return headers
}

function isChatCompletions(input: RequestInfo | URL) {
  const raw = input instanceof Request ? input.url : String(input)
  try {
    return new URL(raw).pathname.endsWith("/chat/completions")
  } catch {
    return raw.includes("/chat/completions")
  }
}

function streamResponse(response: Response, request: JsonRecord) {
  if (!response.body) return response
  const id = `chatcmpl-${crypto.randomUUID()}`
  let roleSent = false
  let sawTools = false
  let emittedTools = false
  let pending = ""
  let cancelled = false
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      reader = response.body!.getReader()
      const emit = (payload: unknown) => {
        if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }
      const processLine = (line: string) => {
        if (!line.trim()) return
        const chunk = JSON.parse(line) as JsonRecord
        if (chunk.error) throw new Error(String(chunk.error))
        const calls = toolCalls(chunk.message?.tool_calls)
        if (calls.length) sawTools = true
        const delta: JsonRecord = {
          ...(!roleSent ? { role: "assistant" } : {}),
          ...(chunk.message?.content ? { content: String(chunk.message.content) } : {}),
          ...(chunk.message?.thinking ? { reasoning: String(chunk.message.thinking) } : {}),
          ...(calls.length && !emittedTools ? { tool_calls: calls } : {}),
        }
        if (calls.length) emittedTools = true
        if (Object.keys(delta).length) {
          roleSent = true
          emit(
            chunkPayload({
              id,
              model: String(chunk.model ?? request.model ?? ""),
              created: createdSeconds(chunk.created_at),
              delta,
              finishReason: null,
            }),
          )
        }
        if (chunk.done) {
          emit(
            chunkPayload({
              id,
              model: String(chunk.model ?? request.model ?? ""),
              created: createdSeconds(chunk.created_at),
              delta: {},
              finishReason: finishReason(chunk.done_reason, sawTools),
              usage: {
                prompt_tokens: Number(chunk.prompt_eval_count ?? 0),
                completion_tokens: Number(chunk.eval_count ?? 0),
                total_tokens: Number(chunk.prompt_eval_count ?? 0) + Number(chunk.eval_count ?? 0),
              },
            }),
          )
          if (!cancelled) controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        }
      }

      void (async () => {
        try {
          while (!cancelled) {
            const { done, value } = await reader!.read()
            if (done) break
            pending += decoder.decode(value, { stream: true })
            const lines = pending.split("\n")
            pending = lines.pop() ?? ""
            for (const line of lines) processLine(line)
          }
          pending += decoder.decode()
          if (!cancelled && pending.trim()) processLine(pending)
          if (!cancelled) controller.close()
        } catch (error) {
          if (!cancelled) controller.error(error)
        } finally {
          reader?.releaseLock()
        }
      })()
    },
    async cancel(reason) {
      cancelled = true
      await reader?.cancel(reason).catch(() => undefined)
    },
  })

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

export function createOllamaNativeFetch(options: OllamaNativeTransportOptions): FetchLike {
  const host = normalizeOllamaHost(options.host)
  const fetchFn: FetchLike = options.fetch ?? fetch
  if (options.enabled === false) return fetchFn

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isChatCompletions(input)) return fetchFn(input, init)
    const rawBody = await bodyText(input, init)
    if (!rawBody) return fetchFn(input, init)

    let request: JsonRecord
    try {
      request = JSON.parse(rawBody) as JsonRecord
    } catch {
      return fetchFn(input, init)
    }

    const native = openAIToOllamaRequest(request, options.contexts[String(request.model)], options.keepAlive)
    const response = await fetchFn(`${host}/api/chat`, {
      ...init,
      method: "POST",
      headers: requestHeaders(input, init),
      body: JSON.stringify(native),
      signal: init?.signal ?? (input instanceof Request ? input.signal : undefined),
    })

    if (!response.ok) return openAIError(response.status, await response.text())
    if (request.stream === false) {
      const chunk = (await response.json()) as JsonRecord
      return new Response(JSON.stringify(completionPayload(chunk, request)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    return streamResponse(response, request)
  }
}
