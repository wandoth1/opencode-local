import { expect, test } from "bun:test"
import { estimateKvBytesPerToken, extractContextLength, recommendContext } from "@/local/context-budget"
import { GIB, type HardwareSnapshot, type LocalModelMetadata } from "@/local/runtime"

const model: LocalModelMetadata = {
  id: "qwen-coder:8b", family: "llama", families: ["llama"], format: "gguf",
  parameterSize: "8B", quantization: "Q4_K_M", fileSizeBytes: 8 * GIB, contextLength: 131072,
  capabilities: ["completion", "tools"],
  modelInfo: {
    "general.architecture": "llama", "llama.block_count": 32, "llama.embedding_length": 4096,
    "llama.attention.head_count": 32, "llama.attention.head_count_kv": 8, "llama.context_length": 131072,
  },
}
function hardware(freeGiB: number, totalGiB = 12): HardwareSnapshot {
  return {
    platform: "win32", architecture: "x64", cpuModel: "test", cpuCount: 16,
    systemMemoryTotalBytes: 64 * GIB, systemMemoryFreeBytes: 32 * GIB,
    nvidiaGpus: [{ index: 0, name: "RTX 5070", memoryTotalBytes: totalGiB * GIB,
      memoryFreeBytes: freeGiB * GIB, memoryUsedBytes: (totalGiB - freeGiB) * GIB }],
  }
}
test("extracts native and configured context lengths", () => {
  expect(extractContextLength(model.modelInfo)).toBe(131072)
  expect(extractContextLength(model.modelInfo, "temperature 0.2\nnum_ctx 32768")).toBe(131072)
  expect(extractContextLength({}, "num_ctx 24576")).toBe(24576)
})
test("estimates grouped-query KV cache bytes per token", () => {
  expect(estimateKvBytesPerToken(model)).toBe(131072)
})
test("retains agent context and warns when the advisory 12 GiB budget is exceeded", () => {
  const recommendation = recommendContext({ model, hardware: hardware(11.5) })
  expect(recommendation.recommendedContextTokens).toBe(16384)
  expect(recommendation.recommendedContextTokens).toBeLessThan(model.contextLength!)
  expect(recommendation.expectedCpuOffload).toBe(true)
  expect(recommendation.confidence).toBe("medium")
})
test("does not subtract an already-loaded model twice from free VRAM", () => {
  const recommendation = recommendContext({ model, hardware: hardware(2.5), loadedSizeVramBytes: 9 * GIB })
  const unloaded = recommendContext({ model, hardware: hardware(11.5) })
  expect(recommendation.recommendedContextTokens).toBe(16384)
  expect(recommendation.availableVramBytes).toBe(unloaded.availableVramBytes)
  expect(recommendation.expectedCpuOffload).toBe(unloaded.expectedCpuOffload)
  expect(recommendation.reasons.some((reason) => reason.includes("already loaded"))).toBe(true)
})
test("flags expected offload without silently making the agent context unusable", () => {
  const recommendation = recommendContext({ model, hardware: hardware(7) })
  expect(recommendation.recommendedContextTokens).toBe(16384)
  expect(recommendation.expectedCpuOffload).toBe(true)
})
test("honors an explicit context override but records the risk", () => {
  const recommendation = recommendContext({ model, hardware: hardware(11.5), requestedContextTokens: 65536 })
  expect(recommendation.recommendedContextTokens).toBe(65536)
  expect(recommendation.reasons.some((reason) => reason.includes("override exceeds"))).toBe(true)
})
