#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import path from "node:path"

// Use Node, not a Bun parent that may already have loaded the project's .env.
// Do not resolve Bun through PATH/current-directory on Windows.
const executable = process.env.OPENCODE_BUN || path.join(homedir(), ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun")
if (!path.isAbsolute(executable)) {
  console.error("OPENCODE_BUN must be an absolute path to a trusted Bun executable.")
  process.exit(1)
}
const entry = fileURLToPath(new URL("../packages/opencode/src/index.ts", import.meta.url))
// Resolve the conditional `bun` package export INSIDE Bun. Node's resolver
// selects the package's deliberately failing Node-only compatibility stub.
const preload = fileURLToPath(new URL("../packages/opencode/script/local-preload.ts", import.meta.url))
const config = fileURLToPath(new URL("./local-runtime.bunfig.toml", import.meta.url))
const child = spawn(executable, ["run", "--no-env-file", `--config=${config}`, "--conditions=browser", `--preload=${preload}`, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: false,
  env: { ...process.env },
})
child.on("error", () => {
  console.error("Could not start Bun from its user installation. Install Bun 1.3.14 or set OPENCODE_BUN to its trusted absolute path.")
  process.exitCode = 1
})
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 130 : 1)
})
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal))
}
