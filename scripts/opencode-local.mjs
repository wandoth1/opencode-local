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

// Launcher-only switch, consumed here and never passed to the agent. `--low` as the
// first argument (or OPENCODE_LOCAL_LOW=1) starts with a smaller base prompt for large
// or partially offloaded local models: skills discovered from other tools' folders
// (.claude/skills and .agents/skills, in the home directory and inside the project)
// are not listed. Skills in OpenCode's own locations still load, so a short curated
// set can be kept there.
const args = process.argv.slice(2)
const lowFlag = args[0] === "--low"
if (lowFlag) args.shift()
const low = lowFlag || ["1", "true", "yes", "on"].includes((process.env.OPENCODE_LOCAL_LOW ?? "").trim().toLowerCase())

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
if (low) environment.OPENCODE_DISABLE_EXTERNAL_SKILLS = "1"

const child = spawn(executable, [
  "run",
  "--no-env-file",
  `--cwd=${cwd}`,
  `--config=${config}`,
  "--conditions=browser",
  `--preload=${preload}`,
  entry,
  ...args,
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
