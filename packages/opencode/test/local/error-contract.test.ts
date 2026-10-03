import { expect, test } from "bun:test"
import { APICallError } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { ProviderError } from "@/provider/error"
import { createOllamaNativeFetch } from "@/local/ollama/transport"

for (const stream of [false, true]) {
  test(`daemon overflow reaches the real SDK and core classifier (stream=${stream})`, async () => {
    const wire = createOllamaNativeFetch({
      host: "http://127.0.0.1:11434",
      contexts: { fixture: 16384 },
      fetch: async () => Response.json({
        error: "request (7342 tokens) exceeds the available context size (4096 tokens) PRIVATE_FIXTURE_SECRET",
      }, { status: 400 }),
    })
    const provider = createOpenAICompatible({
      name: "ollama",
      baseURL: "http://127.0.0.1:11434/v1",
      fetch: Object.assign(wire, { preconnect: fetch.preconnect }),
    })
    const model = provider.chatModel("fixture")
    const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "Hello" }] }]
    let failure: unknown
    try {
      if (stream) await model.doStream({ prompt })
      else await model.doGenerate({ prompt })
    } catch (error) {
      failure = error
    }
    expect(APICallError.isInstance(failure)).toBe(true)
    if (!APICallError.isInstance(failure)) throw new Error("The SDK did not return an APICallError")
    const result = ProviderError.parseAPICallError({
      providerID: "ollama" as Parameters<typeof ProviderError.parseAPICallError>[0]["providerID"],
      error: failure,
    })
    expect(result.type).toBe("context_overflow")
    expect(result.message).toContain("exceeds the available context size")
    expect(result.message).toContain("numCtx")
    expect(JSON.stringify(result)).not.toContain("PRIVATE_FIXTURE_SECRET")
    expect(failure.responseBody).not.toContain("PRIVATE_FIXTURE_SECRET")
  })
}
