#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import path from "node:path"

// A Bun parent may already have loaded the project's .env before this file runs.
if (process.versions.bun) {
  console.error("Start OpenCode Local with Node, not Bun: node /path/to/scripts/opencode-local.mjs")
  process.exit(1)
}

const executable = process.env.OPENCODE_BUN || path.join(
  homedir(), ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun",
)
if (!path.isAbsolute(executable)) {
  console.error("OPENCODE_BUN must be an absolute path to a trusted Bun executable.")
  process.exit(1)
}

const cwd = process.cwd()
const entry = fileURLToPath(new URL("../packages/opencode/src/index.ts", import.meta.url))
// Resolve the conditional Bun export inside Bun, not through Node's resolver.
const preload = fileURLToPath(new URL("../packages/opencode/script/local-preload.ts", import.meta.url))
const config = fileURLToPath(new URL("./local-runtime.bunfig.toml", import.meta.url))
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !["PWD", "BUN_OPTIONS"].includes(key.toUpperCase())),
)
// Upstream `run` uses PWD for its local server. A subprocess cwd does not update
// inherited PWD; carrying the parent's value can select the wrong project.
environment.PWD = cwd

const child = spawn(executable, [
  "run",
  "--no-env-file",
  `--cwd=${cwd}`,
  `--config=${config}`,
  "--conditions=browser",
  `--preload=${preload}`,
  entry,
  ...process.argv.slice(2),
], {
  cwd,
  stdio: "inherit",
  shell: false,
  windowsHide: true,
  env: environment,
})
child.on("error", () => {
  console.error("Could not start Bun from its user installation. Install Bun 1.3.14 or set OPENCODE_BUN to its trusted absolute path.")
  process.exitCode = 1
})
child.on("close", (code, signal) => {
  process.exitCode = code ?? (signal ? 130 : 1)
})
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal))
}
