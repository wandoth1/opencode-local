import { Buffer } from "node:buffer"
/** Shared, bounded I/O. Error messages deliberately never echo server bodies or credentials. */
export const MAX_JSON_BYTES = 16 * 1024 * 1024
export const MAX_FRAME_BYTES = 2 * 1024 * 1024
export type Json = Record<string, any>
export function object(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined
}
export function jsonObject(text: string): Json {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error("Invalid Ollama JSON") }
  const result = object(value)
  if (!result) throw new Error("Ollama JSON must be an object")
  return result
}
export function checkAbort(signal?: AbortSignal | null) {
  if (signal?.aborted) throw new DOMException("Local runtime request aborted", "AbortError")
}
export async function boundedText(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal | null, limit = MAX_JSON_BYTES) {
  if (!body) throw new Error("Ollama returned an empty response body")
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  const abort = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener("abort", abort, { once: true })
  try {
    checkAbort(signal)
    while (true) {
      const next = await reader.read()
      checkAbort(signal)
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) throw new Error("Local runtime JSON exceeds its size limit")
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
    catch { throw new Error("Invalid UTF-8 from local runtime") }
  } finally {
    signal?.removeEventListener("abort", abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
export async function* readNdjson(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal | null): AsyncGenerator<Json> {
  if (!body) throw new Error("Ollama returned an empty response body")
  const reader = body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let pending = ""
  const abort = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener("abort", abort, { once: true })
  try {
    checkAbort(signal)
    while (true) {
      const { done, value } = await reader.read()
      checkAbort(signal)
      try { pending += done ? decoder.decode() : decoder.decode(value, { stream: true }) }
      catch { throw new Error("Invalid UTF-8 from Ollama") }
      let newline: number
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) throw new Error("Ollama frame exceeds its size limit")
        if (line.trim()) yield jsonObject(line)
      }
      if (Buffer.byteLength(pending, "utf8") > MAX_FRAME_BYTES) throw new Error("Ollama frame exceeds its size limit")
      if (done) break
    }
    if (pending.trim()) yield jsonObject(pending)
  } finally {
    signal?.removeEventListener("abort", abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
