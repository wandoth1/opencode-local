import { expect, test } from "bun:test"
import { readNdjson } from "@/local/ollama/io"

test("abort discards frames buffered after a yielded token", async () => {
  const abort = new AbortController()
  const body = new Response('{"message":{"content":"a"},"done":false}\n{"done":true}\n').body
  const iterator = readNdjson(body, abort.signal)
  expect((await iterator.next()).value.done).toBe(false)
  abort.abort()
  await expect(iterator.next()).rejects.toThrow("aborted")
  expect(body?.locked).toBe(false)
})
