#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

// Invoke with Node, not `bun run`: a Bun parent can already have loaded .env
// before starting this wrapper. Keep the caller's cwd for project discovery.
const entry = fileURLToPath(new URL("../packages/opencode/src/index.ts", import.meta.url))
const require = createRequire(new URL("../packages/opencode/package.json", import.meta.url))
const preload = require.resolve("@opentui/solid/preload")
const config = fileURLToPath(new URL("./local-runtime.bunfig.toml", import.meta.url))
const executable = process.env.OPENCODE_BUN || "bun"
const child = spawn(executable, ["run", "--no-env-file", "--config", config, "--conditions=browser", "--preload", preload, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: false,
  env: { ...process.env },
})
child.on("error", () => {
  console.error("Could not start the trusted Bun executable. Install Bun 1.3.14 or set OPENCODE_BUN to its absolute path.")
  process.exitCode = 1
})
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 130 : 1)
})
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal))
}
