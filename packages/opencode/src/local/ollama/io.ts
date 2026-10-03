import { Buffer } from "node:buffer"

export const MAX_JSON_BYTES = 16 * 1024 * 1024
export const MAX_FRAME_BYTES = 2 * 1024 * 1024
export type Json = Record<string, any>
export function object(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined
}
export function jsonObject(text: string): Json {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error("Invalid Ollama JSON") }
  const result = object(value)
  if (!result) throw new Error("Ollama JSON must be an object")
  return result
}
// Both messages are worded to stay outside the core's retryable-message patterns
// (session/retry.ts): a total deadline that expired would expire again on every
// retry. Do not interpolate the millisecond value; digits such as 500 match them.
export const GENERATION_DEADLINE_MESSAGE =
  "Ollama generation deadline reached (generationTimeoutMs): the model did not finish within the configured limit. Raise or disable the limit."
export const REQUEST_DEADLINE_MESSAGE =
  "Ollama request deadline reached: a configured timeout expired before the daemon finished."
export function checkAbort(signal?: AbortSignal | null) {
  if (!signal?.aborted) return
  const reason: unknown = signal.reason
  if (reason instanceof Error) {
    // The core's own header-timeout error keeps its identity so the core handles it as usual.
    if (reason.name === "ProviderHeaderTimeoutError") throw reason
    // Only the transport's own timer may name generationTimeoutMs; any other
    // timeout (provider `timeout`, discovery, benchmark) gets the generic text.
    if (reason.name === "TimeoutError") {
      throw new DOMException(
        reason.message === GENERATION_DEADLINE_MESSAGE ? GENERATION_DEADLINE_MESSAGE : REQUEST_DEADLINE_MESSAGE,
        "TimeoutError",
      )
    }
  }
  throw new DOMException("Local runtime request aborted", "AbortError")
}
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal | null) {
  checkAbort(signal)
  const read = reader.read()
  if (!signal) {
    try { return await read } catch { throw new Error("Local runtime response stream failed") }
  }

  let onAbort: (() => void) | undefined
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      try { checkAbort(signal) } catch (error) { reject(error) }
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener("abort", onAbort, { once: true })
  })

  try {
    const result = await Promise.race([read, interrupted])
    checkAbort(signal)
    return result
  } catch {
    checkAbort(signal)
    throw new Error("Local runtime response stream failed")
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort)
    // Bun/Windows can leave reader.read() pending after cancel(). If abort won the
    // race, detach any later read rejection so it cannot surface as unhandled.
    if (signal.aborted) void read.catch(() => undefined)
  }
}
function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) { void reader.cancel().catch(() => undefined) }
export async function boundedText(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal | null, limit = MAX_JSON_BYTES) {
  if (!body) throw new Error("Ollama returned an empty response body")
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  const abort = () => cancelReader(reader)
  signal?.addEventListener("abort", abort, { once: true })
  try {
    checkAbort(signal)
    while (true) {
      const next = await readChunk(reader, signal)
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) throw new Error(`Local runtime JSON exceeds its ${limit}-byte size limit; reduce or split attachments`)
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
    catch { throw new Error("Invalid UTF-8 from local runtime") }
  } finally {
    signal?.removeEventListener("abort", abort)
    cancelReader(reader)
    try { reader.releaseLock() } catch {
      // Some Bun/Windows streams keep a read pending briefly after cancellation.
      // Do not replace the original timeout/cancellation with a releaseLock error.
    }
  }
}
export async function* readNdjson(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal | null): AsyncGenerator<Json> {
  if (!body) throw new Error("Ollama returned an empty response body")
  const reader = body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let pending = ""
  const abort = () => cancelReader(reader)
  signal?.addEventListener("abort", abort, { once: true })
  try {
    checkAbort(signal)
    while (true) {
      const { done, value } = await readChunk(reader, signal)
      try { pending += done ? decoder.decode() : decoder.decode(value, { stream: true }) }
      catch { throw new Error("Invalid UTF-8 from Ollama") }
      let newline: number
      while ((newline = pending.indexOf("\n")) >= 0) {
        checkAbort(signal)
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) throw new Error("Ollama frame exceeds its size limit")
        if (line.trim()) yield jsonObject(line)
      }
      checkAbort(signal)
      if (Buffer.byteLength(pending, "utf8") > MAX_FRAME_BYTES) throw new Error("Ollama frame exceeds its size limit")
      if (done) break
    }
    checkAbort(signal)
    if (pending.trim()) yield jsonObject(pending)
  } finally {
    signal?.removeEventListener("abort", abort)
    cancelReader(reader)
    try { reader.releaseLock() } catch {
      // Some Bun/Windows streams keep a read pending briefly after cancellation.
      // Do not replace the original timeout/cancellation with a releaseLock error.
    }
  }
}
