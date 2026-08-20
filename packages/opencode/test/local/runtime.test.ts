import { expect, test } from "bun:test"
import { redactSecrets } from "@/local/runtime"

test("recursively redacts credentials without hiding ordinary timeout fields", () => {
  const report = redactSecrets({
    settings: {
      apiKey: "sk-secret",
      headerTimeout: 1500,
      headers: { Authorization: "Bearer secret", "X-Visible": "value" },
    },
    nested: {
      refresh_token: "refresh-secret",
      password: "password-secret",
      model: "qwen3-coder:8b",
    },
  })

  expect(report.settings.apiKey).toBe("[redacted]")
  expect(report.settings.headers).toBe("[redacted]")
  expect(report.settings.headerTimeout).toBe(1500)
  expect(report.nested.refresh_token).toBe("[redacted]")
  expect(report.nested.password).toBe("[redacted]")
  expect(report.nested.model).toBe("qwen3-coder:8b")
})
