import { expect, test } from "bun:test"
import { createOllamaNativeFetch } from "@/local/ollama/transport"

// Real loopback HTTP and wall time. This intentionally takes over five minutes
// and regresses the former production 300s cutoff without a fake clock.
test("healthy native HTTP stream survives the former 300-second deadline", async () => {
  let count = 0
  let interval: ReturnType<typeof setInterval> | undefined
  let finish: ReturnType<typeof setTimeout> | undefined
  const encoder = new TextEncoder()
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch: () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = () => { count++; controller.enqueue(encoder.encode('{"message":{"content":"x"},"done":false}\n')) }
        emit()
        interval = setInterval(emit, 1000)
        finish = setTimeout(() => {
          clearInterval(interval)
          controller.enqueue(encoder.encode('{"message":{"content":"OK"},"done":true,"eval_count":305}\n'))
          controller.close()
        }, 305000)
      },
      cancel() { clearInterval(interval); clearTimeout(finish) },
    })
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } })
  } })
  try {
    const host = `http://127.0.0.1:${server.port}`
    const native = createOllamaNativeFetch({ host, contexts: { fixture: 16384 } })
    const started = performance.now()
    const response = await native(`${host}/v1/chat/completions`, { method: "POST", body: JSON.stringify({
      model: "fixture", stream: true, messages: [{ role: "user", content: "test" }],
    }) })
    const body = await response.text()
    expect(performance.now() - started).toBeGreaterThan(300000)
    expect(count).toBeGreaterThan(290)
    expect(body).toContain("[DONE]")
    expect(body).toContain('"content":"OK"')
  } finally {
    clearInterval(interval)
    clearTimeout(finish)
    server.stop(true)
  }
}, 330000)
