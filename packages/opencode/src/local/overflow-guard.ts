export const MAX_OLLAMA_OVERFLOW_RECOVERIES = 2

export function ollamaOverflowRecovery(providerID: string, current: number, overflow: boolean) {
  if (providerID !== "ollama" || !overflow) return { count: 0, stop: false }
  const count = current + 1
  return { count, stop: count >= MAX_OLLAMA_OVERFLOW_RECOVERIES }
}
