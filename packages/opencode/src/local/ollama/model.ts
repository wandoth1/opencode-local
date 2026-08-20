import type { HardwareSnapshot, LocalModelProfile } from "../runtime"
import { recommendContext } from "../context-budget"
import type { OllamaDiscoveryModel, OllamaRunningModel } from "./client"

const TOOL_HINTS = [
  "qwen",
  "llama3.1",
  "llama3.2",
  "llama3.3",
  "mistral",
  "mixtral",
  "command-r",
  "deepseek",
  "devstral",
  "codestral",
  "glm",
  "gpt-oss",
  "granite",
]

const REASONING_HINTS = ["deepseek-r1", "reasoner", "qwq", "qwen3", "gpt-oss", "glm-", "thinking"]
const VISION_HINTS = ["vision", "llava", "bakllava", "moondream", "qwen-vl", "qwen2.5vl", "qwen3-vl", "minicpm-v"]

export interface OllamaProviderModel {
  name: string
  family: string
  release_date: string
  status: "active"
  temperature: boolean
  reasoning: boolean
  attachment: boolean
  tool_call: boolean
  interleaved: false | { field: string }
  cost: {
    input: number
    output: number
    cache_read: number
    cache_write: number
  }
  limit: {
    context: number
    output: number
  }
  modalities: {
    input: Array<"text" | "image">
    output: ["text"]
  }
  provider: {
    npm: "@ai-sdk/openai-compatible"
    api: string
  }
  options: Record<string, unknown>
  headers: Record<string, string>
  variants: Record<string, Record<string, unknown>>
}

export interface OllamaModelBuildOptions {
  openAIBaseURL: string
  hardware?: HardwareSnapshot
  running?: OllamaRunningModel[]
  requestedContextTokens?: number
  forceToolCall?: boolean
  forceReasoning?: boolean
  forceVision?: boolean
}

function hasCapability(model: OllamaDiscoveryModel, capability: string) {
  return model.metadata.capabilities.some((item) => item.toLowerCase() === capability)
}

function hinted(id: string, hints: string[]) {
  const lower = id.toLowerCase()
  return hints.some((hint) => lower.includes(hint))
}

function loadedModel(model: OllamaDiscoveryModel, running: OllamaRunningModel[] | undefined) {
  return running?.find((item) => (item.model || item.name) === model.metadata.id)
}

export function buildOllamaModel(
  model: OllamaDiscoveryModel,
  options: OllamaModelBuildOptions,
): { model: OllamaProviderModel; profile: LocalModelProfile } {
  const id = model.metadata.id
  const running = loadedModel(model, options.running)
  const context = recommendContext({
    model: model.metadata,
    hardware: options.hardware,
    requestedContextTokens: options.requestedContextTokens,
  })

  const toolcall =
    options.forceToolCall ?? (hasCapability(model, "tools") || hasCapability(model, "tool") || hinted(id, TOOL_HINTS))
  const reasoning =
    options.forceReasoning ??
    (hasCapability(model, "thinking") || hasCapability(model, "reasoning") || hinted(id, REASONING_HINTS))
  const vision =
    options.forceVision ?? (hasCapability(model, "vision") || hasCapability(model, "image") || hinted(id, VISION_HINTS))
  const nameDetails = [model.metadata.parameterSize, model.metadata.quantization].filter(Boolean).join(" · ")
  const name = nameDetails ? `${id} (${nameDetails})` : id

  const variants: Record<string, Record<string, unknown>> = reasoning
    ? {
        none: { reasoningEffort: "none" },
        low: { reasoningEffort: "low" },
        high: { reasoningEffort: "high" },
      }
    : {}
  const interleaved: OllamaProviderModel["interleaved"] = reasoning ? { field: "reasoning" } : false

  const result: OllamaProviderModel = {
    name,
    family: model.metadata.family ?? "local",
    release_date: model.tag.modified_at?.slice(0, 10) ?? "",
    status: "active",
    temperature: true,
    reasoning,
    attachment: vision,
    tool_call: toolcall,
    interleaved,
    cost: {
      input: 0,
      output: 0,
      cache_read: 0,
      cache_write: 0,
    },
    limit: {
      context: context.recommendedContextTokens,
      output: context.recommendedOutputTokens,
    },
    modalities: {
      input: vision ? ["text", "image"] : ["text"],
      output: ["text"],
    },
    provider: {
      npm: "@ai-sdk/openai-compatible",
      api: options.openAIBaseURL,
    },
    options: {},
    headers: {},
    variants,
  }

  return {
    model: result,
    profile: {
      metadata: model.metadata,
      context,
      loaded: running
        ? {
            sizeBytes: running.size,
            sizeVramBytes: running.size_vram,
            contextLength: running.context_length,
            expiresAt: running.expires_at,
          }
        : undefined,
    },
  }
}
