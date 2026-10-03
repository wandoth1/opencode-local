import type { HardwareSnapshot, LocalModelProfile } from "../runtime"
import { recommendContext } from "../context-budget"
import type { OllamaDiscoveryModel, OllamaRunningModel } from "./client"
export interface OllamaProviderModel {
  name: string; family: string; release_date: string; status: "active"; temperature: boolean
  reasoning: boolean; attachment: boolean; tool_call: boolean; interleaved: false | { field: string }
  cost: { input: number; output: number; cache_read: number; cache_write: number }
  limit: { context: number; output: number }
  modalities: { input: Array<"text" | "image">; output: ["text"] }
  provider: { npm: "@ai-sdk/openai-compatible"; api: string }
  options: Record<string, unknown>; headers: Record<string, string>; variants: Record<string, Record<string, unknown>>
}
export interface OllamaModelBuildOptions {
  openAIBaseURL: string; hardware?: HardwareSnapshot; running?: OllamaRunningModel[]; requestedContextTokens?: number
  kvCacheBytesPerElement?: number; forceToolCall?: boolean; forceReasoning?: boolean; forceVision?: boolean
}
export function buildOllamaModel(item: OllamaDiscoveryModel, options: OllamaModelBuildOptions): { model: OllamaProviderModel; profile: LocalModelProfile } {
  const meta = item.metadata
  const running = options.running?.find((entry) => (entry.model || entry.name) === meta.id &&
    (!item.tag.digest || !entry.digest || item.tag.digest === entry.digest))
  const context = recommendContext({ model: meta, hardware: options.hardware,
    requestedContextTokens: options.requestedContextTokens, loadedSizeVramBytes: running?.size_vram,
    kvCacheBytesPerElement: options.kvCacheBytesPerElement })
  const capabilities = new Set(meta.capabilities.map((value) => value.toLowerCase()))
  // A family name is not evidence of a model's tool/vision/reasoning support.
  const toolCall = options.forceToolCall ?? capabilities.has("tools")
  const reasoning = options.forceReasoning ?? capabilities.has("thinking")
  const vision = options.forceVision ?? capabilities.has("vision")
  const levels = /gpt[-_]?oss/i.test(meta.id)
  const variants: Record<string, Record<string, unknown>> = !reasoning ? {} : levels
    ? { low: { reasoningEffort: "low" }, medium: { reasoningEffort: "medium" }, high: { reasoningEffort: "high" } }
    : { none: { reasoningEffort: "none" }, enabled: { reasoningEffort: "high" } }
  const date = item.tag.modified_at?.slice(0, 10) ?? ""
  const model: OllamaProviderModel = {
    name: [meta.id, [meta.parameterSize, meta.quantization].filter(Boolean).join(" · ")].filter(Boolean).join(" · "),
    family: meta.family ?? "local", release_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "", status: "active", temperature: true,
    reasoning, attachment: vision, tool_call: toolCall, interleaved: reasoning ? { field: "reasoning" } : false,
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, limit: { context: context.recommendedContextTokens, output: context.recommendedOutputTokens },
    modalities: { input: vision ? ["text", "image"] : ["text"], output: ["text"] },
    provider: { npm: "@ai-sdk/openai-compatible", api: options.openAIBaseURL }, options: {}, headers: {}, variants,
  }
  return { model, profile: { metadata: meta, context, loaded: running ? { sizeBytes: running.size, sizeVramBytes: running.size_vram,
    contextLength: running.context_length, expiresAt: running.expires_at } : undefined } }
}
