import { expect, test } from "bun:test"
import { MAX_OLLAMA_OVERFLOW_RECOVERIES, ollamaOverflowRecovery } from "@/local/overflow-guard"

test("Ollama overflow recovery stops after the second consecutive overflow", () => {
  let count = 0
  let decision = ollamaOverflowRecovery("ollama", count, true)
  count = decision.count
  expect(decision.stop).toBe(false)
  expect(count).toBe(1)

  decision = ollamaOverflowRecovery("ollama", count, true)
  expect(decision.stop).toBe(true)
  expect(decision.count).toBe(MAX_OLLAMA_OVERFLOW_RECOVERIES)
})

test("successful or non-Ollama turns reset the overflow recovery counter", () => {
  expect(ollamaOverflowRecovery("ollama", 1, false)).toEqual({ count: 0, stop: false })
  expect(ollamaOverflowRecovery("test", 1, true)).toEqual({ count: 0, stop: false })
})
