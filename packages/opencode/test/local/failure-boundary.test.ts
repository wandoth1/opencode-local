import { test, expect } from "bun:test"
import { configureOllama } from "@/local/ollama/integration"
import { buildOllamaModel } from "@/local/ollama/model"
import type { OllamaDiscoveryModel } from "@/local/ollama/client"

test("initialization failure removes unsafe raw provider even after host validation", async () => {
  const saved = process.env.OPENCODE_LOCAL_DISABLE
  delete process.env.OPENCODE_LOCAL_DISABLE
  const cfg: any = { provider: { ollama: { options: { autoDiscover: false }, models: { fixture: { limit: { context: 8192 } } } } } }
  try {
    await expect(configureOllama(cfg, {}, {
      fetch: async (url) => Response.json(String(url).endsWith("/api/version") ? { version: "fixture" } : { models: [] }),
      hardware: () => { throw new Error("private failure detail") },
    })).rejects.toThrow("initialization failed safely")
    expect(cfg.provider.ollama).toBeUndefined()
  } finally { if (saved === undefined) delete process.env.OPENCODE_LOCAL_DISABLE; else process.env.OPENCODE_LOCAL_DISABLE = saved }
})

test("malformed optional metadata cannot escape into loaded-model diagnostics", () => {
  const item: OllamaDiscoveryModel = { tag: { name: "fixture", modified_at: 42 as any }, metadata: {
    id: "fixture", families: [], fileSizeBytes: 100, capabilities: ["completion"], modelInfo: {}, contextLength: 2048,
  } }
  const result = buildOllamaModel(item, { openAIBaseURL: "http://127.0.0.1:11434/v1", running: [{ name: "fixture",
    size: {} as any, size_vram: "private" as any, expires_at: { private: "secret" } as any }] })
  expect(result.model.release_date).toBe("")
  expect(result.profile.loaded?.sizeBytes).toBeUndefined()
  expect(result.profile.loaded?.sizeVramBytes).toBeUndefined()
  expect(result.profile.loaded?.expiresAt).toBeUndefined()
})
