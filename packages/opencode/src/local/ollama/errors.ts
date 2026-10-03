import { boundedText, checkAbort, jsonObject } from "./io"

/** Only canonical messages leave this boundary: daemon text can contain secrets. */
export class LocalRuntimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LocalRuntimeError"
  }
}

export function daemonError(value: unknown, status?: number): LocalRuntimeError {
  const message = typeof value === "string" ? value.slice(0, 8192) : ""
  if (/exceeds (?:the )?available context size|context[_ ]length[_ ]exceeded|prompt (?:is )?too long|exceeds (?:the )?(?:maximum )?context (?:length|window)|input length.*exceeds.*context/i.test(message)) {
    return new LocalRuntimeError(
      "Request exceeds the available context size. Compact the conversation or raise provider.ollama.options.numCtx / OPENCODE_OLLAMA_NUM_CTX within the model maximum; additional CPU offload may be necessary.",
    )
  }
  if (/(?:does not|doesn't|do not|not) support.*tools|tools?.*(?:not supported|unsupported)/i.test(message)) {
    return new LocalRuntimeError("This Ollama model does not support tools. Select a tool-capable model for the coding agent.")
  }
  if (/out of memory|not enough.*memory|insufficient.*memory|requires more.*memory|unable to allocate|failed to allocate/i.test(message)) {
    return new LocalRuntimeError("Ollama could not allocate enough memory. Free GPU/RAM resources or select a smaller model; do not shrink context below the agent's needs.")
  }
  if (/model.*(?:not found|does not exist)|pull.*model first/i.test(message) || status === 404) {
    return new LocalRuntimeError("The requested Ollama model or endpoint was not found. Check the model name and installed models.")
  }
  if (status === 401 || status === 403) {
    return new LocalRuntimeError("Ollama authentication failed. Check the credentials bound to this endpoint in global configuration.")
  }
  if (status === 429) return new LocalRuntimeError("Ollama is busy or rate limited. Retry after the current request completes.")
  return new LocalRuntimeError(status ? `Ollama returned HTTP ${status}` : "Ollama reported a generation error")
}

/** Bound both size and time; a malicious error body must not stall error handling. */
export async function responseError(response: Response, parent?: AbortSignal): Promise<LocalRuntimeError> {
  const signal = AbortSignal.any([AbortSignal.timeout(500), ...(parent ? [parent] : [])])
  try {
    const body = jsonObject(await boundedText(response.body, signal, 8192))
    return daemonError(body.error, response.status)
  } catch {
    checkAbort(parent)
    return daemonError(undefined, response.status)
  }
}

export function diagnosticError(error: unknown) {
  if (error instanceof LocalRuntimeError) return error.message
  if (error instanceof Error && error.name === "TimeoutError") return "Ollama request timed out. Increase the configured timeout or check the daemon."
  if (error instanceof Error && error.name === "AbortError") return "Ollama request was cancelled."
  return "Local diagnosis failed. Check the trusted endpoint, model configuration and daemon availability."
}
