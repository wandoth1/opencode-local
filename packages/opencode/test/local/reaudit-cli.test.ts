import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const launcher = path.resolve(import.meta.dir, "../../../../scripts/opencode-local.mjs")

type CommandResult = { stdout: string; stderr: string; code: number }
type Sandbox = {
  project: string
  writeGlobal: (value: unknown) => Promise<void>
  command: (args: string[], environment?: Record<string, string>) => Promise<CommandResult>
}

async function sandbox(run: (input: Sandbox) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-reaudit-"))
  const project = path.join(directory, "project")
  const config = path.join(directory, "config", "opencode")
  await Promise.all([
    fs.mkdir(project, { recursive: true }),
    fs.mkdir(config, { recursive: true }),
    fs.mkdir(path.join(directory, "home"), { recursive: true }),
  ])
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith("OPENCODE_OLLAMA_") ||
      key.startsWith("OPENCODE_CONFIG") ||
      ["OLLAMA_HOST", "OPENCODE_LOCAL_DISABLE", "BUN_OPTIONS", "OPENCODE_DISABLE_DEFAULT_PLUGINS"].includes(key)
    ) delete environment[key]
  }
  Object.assign(environment, {
    XDG_CONFIG_HOME: path.join(directory, "config"),
    XDG_DATA_HOME: path.join(directory, "data"),
    XDG_CACHE_HOME: path.join(directory, "cache"),
    XDG_STATE_HOME: path.join(directory, "state"),
    OPENCODE_TEST_HOME: path.join(directory, "home"),
    OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(directory, "managed"),
    OPENCODE_DB: ":memory:",
    // Keep the child off the network: a fresh cache directory would refresh the model catalog.
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_BUN: process.execPath,
  })
  const node = Bun.which("node")
  if (!node) throw new Error("The source-launcher integration test requires Node")
  const git = Bun.spawnSync({ cmd: ["git", "init", "--quiet"], cwd: project, stdout: "ignore", stderr: "pipe" })
  if (git.exitCode !== 0) {
    throw new Error(`Could not initialize isolated git fixture: ${git.stderr.toString()}`)
  }
  try {
    await run({
      project,
      writeGlobal: (value) => fs.writeFile(path.join(config, "opencode.json"), JSON.stringify(value)),
      async command(args, extra = {}) {
        const child = Bun.spawn({
          cmd: [node, launcher, ...args],
          cwd: project,
          env: { ...environment, ...extra },
          stdout: "pipe",
          stderr: "pipe",
        })
        const timer = setTimeout(() => child.kill(), 35000)
        try {
          const [stdout, stderr, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
          ])
          return { stdout, stderr, code }
        } finally {
          clearTimeout(timer)
          child.kill()
        }
      },
    })
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

function daemon(chat?: (request: Request) => Response | Promise<Response>) {
  const requests: Array<{ path: string; authorization: string | null }> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const route = new URL(request.url).pathname
      requests.push({ path: route, authorization: request.headers.get("authorization") })
      if (route === "/api/tags") return Response.json({ models: [{ name: "fixture", size: 3000000000 }] })
      if (route === "/api/show") return Response.json({
        capabilities: ["completion", "tools"],
        model_info: { "general.architecture": "llama", "llama.context_length": 65536 },
      })
      if (route === "/api/ps") return Response.json({ models: [] })
      if (route === "/api/version") return Response.json({ version: "0.32.14-fixture" })
      if (route === "/api/chat" && chat) return chat(request)
      return Response.json({ error: "unexpected fixture route" }, { status: 404 })
    },
  })
  return { server, requests, host: `http://127.0.0.1:${server.port}` }
}

test("CLI: Node source launcher actually reaches the registered doctor command", async () => {
  await sandbox(async ({ command }) => {
    const result = await command(["local", "doctor", "--help"])
    expect(result.code).toBe(0)
    // src/index.ts deliberately prints help on stderr via show().
    expect(result.stderr).toContain("diagnose the configured Ollama runtime")
    expect(result.stderr).toContain("--benchmark-timeout-ms")
    expect(result.stderr).not.toContain("Bun-only")
    expect(result.stderr).not.toContain("Could not start Bun")
  })
}, 45000)

test("CLI: closed host override fails instead of reporting models from the original daemon", async () => {
  const good = daemon()
  const unused = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("unused") })
  const dead = `http://127.0.0.1:${unused.port}`
  unused.stop(true)
  try {
    await sandbox(async ({ writeGlobal, command }) => {
      await writeGlobal({ provider: { ollama: { options: { host: good.host } } } })
      const result = await command(["local", "doctor", "--host", dead, "--json"])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("Ollama connection failed")
      expect(result.stdout).not.toContain('"models"')
      expect(good.requests.some((request) => request.path === "/api/tags")).toBe(true)
    })
  } finally {
    good.server.stop(true)
  }
}, 45000)

test("CLI: Node launcher prevents project .env and bunfig from changing the trusted runtime", async () => {
  const good = daemon()
  const other = daemon()
  try {
    await sandbox(async ({ project, writeGlobal, command }) => {
      await writeGlobal({ provider: { ollama: { options: { host: good.host } } } })
      await fs.writeFile(path.join(project, ".env"), `OPENCODE_OLLAMA_HOST=${other.host}\nOPENCODE_LOCAL_DISABLE=1\n`)
      await fs.writeFile(path.join(project, "bunfig.toml"), 'preload = ["./untrusted-preload.ts"]\n')
      await fs.writeFile(path.join(project, "untrusted-preload.ts"), 'throw new Error("UNTRUSTED_PRELOAD_EXECUTED")\n')
      const result = await command(["local", "doctor", "--json"], { OPENCODE_OLLAMA_API_KEY: "shell-fixture-key" })
      expect({ code: result.code, stderr: result.code ? result.stderr : "" }).toEqual({ code: 0, stderr: "" })
      const report = JSON.parse(result.stdout)
      expect(report.snapshot.endpoint).toBe(good.host)
      expect(report.snapshot.models.fixture.context.reasons.join(" ")).not.toContain("explicit user")
      expect(other.requests).toHaveLength(0)
      expect(good.requests.length).toBeGreaterThan(0)
      expect(good.requests.every((request) => request.authorization === "Bearer shell-fixture-key")).toBe(true)
      expect(result.stdout + result.stderr).not.toContain("shell-fixture-key")
      expect(result.stdout + result.stderr).not.toContain("UNTRUSTED_PRELOAD_EXECUTED")
    })
  } finally {
    good.server.stop(true)
    other.server.stop(true)
  }
}, 45000)

test("CLI: disabled local provider never sends a merged global key to a project endpoint", async () => {
  const other = daemon()
  try {
    await sandbox(async ({ project, writeGlobal, command }) => {
      await writeGlobal({ provider: { ollama: {
        options: { apiKey: "global-fixture-key" },
        models: { fixture: { name: "fixture", limit: { context: 16384, output: 4096 } } },
      } } })
      await fs.writeFile(path.join(project, "opencode.json"), JSON.stringify({ provider: {
        ollama: { npm: "@ai-sdk/openai-compatible", options: { baseURL: `${other.host}/v1` } },
      } }))
      const disabled = { OPENCODE_LOCAL_DISABLE: "1" }
      const result = await command(["run", "--model", "ollama/fixture", "Reply OK"], disabled)
      expect(result.code).not.toBe(0)
      // Upstream may wrap a missing model in UnknownError. Verify that startup
      // succeeded and the dedicated doctor diagnoses the disabled provider too.
      expect(result.stderr.toLowerCase()).toContain("error")
      expect(result.stderr).not.toContain("Bun-only")
      expect(result.stderr).not.toContain("Could not start Bun")
      const doctor = await command(["local", "doctor", "--json"], disabled)
      expect(doctor.code).not.toBe(0)
      expect(doctor.stderr).toContain("Ollama is disabled")
      expect(other.requests).toHaveLength(0)
      expect(result.stdout + result.stderr + doctor.stdout + doctor.stderr).not.toContain("global-fixture-key")
    })
  } finally {
    other.server.stop(true)
  }
}, 60000)

const overflow = () => Response.json(
  { error: "request (40000 tokens) exceeds the available context size (32768 tokens), try increasing it" },
  { status: 400 },
)
const frames = (message: Record<string, unknown>) => new Response([
  JSON.stringify({ message, done: false }),
  JSON.stringify({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop", eval_count: 2, prompt_eval_count: 50 }),
  "",
].join("\n"), { headers: { "Content-Type": "application/x-ndjson" } })
type ChatBody = { tools?: Array<{ function: { name: string } }> }

// The guard lives in the upstream session loop (src/session/prompt.ts), so the
// counter's unit test cannot notice it being moved or dropped. Agent turns carry
// tool schemas; title and compaction requests do not.
test("CLI: repeated Ollama overflow stops after one compaction instead of looping", async () => {
  await sandbox(async ({ writeGlobal, command }) => {
    const seen = { agent: 0, other: 0 }
    const good = daemon(async (request) => {
      const body = await request.json() as ChatBody
      if (!body.tools?.length) { seen.other++; return frames({ role: "assistant", content: "summary" }) }
      seen.agent++
      return overflow()
    })
    try {
      await writeGlobal({ model: "ollama/fixture", small_model: "ollama/fixture", provider: { ollama: { options: { host: good.host } } } })
      const result = await command(["run", "--model", "ollama/fixture", "Reply OK"])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("after overflow compaction")
      expect(result.stderr).toContain("numCtx")
      expect(result.stderr).toContain("skills/tools")
      // First overflow, one compaction, second overflow, stop. Never a third agent turn:
      // every further compaction would be followed by another agent turn.
      expect(seen.agent).toBe(2)
      // The compaction did run; how many title requests the core sends is not asserted.
      expect(seen.other).toBeGreaterThanOrEqual(1)
    } finally {
      good.server.stop(true)
    }
  })
}, 45000)

test("CLI: a successful turn resets the Ollama overflow counter", async () => {
  await sandbox(async ({ project, writeGlobal, command }) => {
    const proof = path.join(project, "proof.txt")
    let agent = 0
    const good = daemon(async (request) => {
      const body = await request.json() as ChatBody
      if (!body.tools?.length) return frames({ role: "assistant", content: "summary" })
      agent++
      // overflow, real tool call, overflow, answer: only reachable when turn 2 clears the counter.
      if (agent === 1 || agent === 3) return overflow()
      if (agent === 2) return frames({ role: "assistant", content: "", tool_calls: [{ id: "read-fixture", function: {
        index: 0, name: "read", arguments: { filePath: proof },
      } }] })
      return frames({ role: "assistant", content: "RECOVERED_AFTER_SECOND_OVERFLOW" })
    })
    try {
      await writeGlobal({ model: "ollama/fixture", small_model: "ollama/fixture", provider: { ollama: { options: { host: good.host } } } })
      await fs.writeFile(proof, "fixture\n")
      const result = await command(["run", "--model", "ollama/fixture", `Read ${JSON.stringify(proof)} with the read tool, then reply.`])
      // Upstream `run` exits non-zero after any reported overflow, even a recovered one.
      expect(result.stdout).toContain("RECOVERED_AFTER_SECOND_OVERFLOW")
      expect(result.stderr).not.toContain("after overflow compaction")
      expect(agent).toBe(4)
    } finally {
      good.server.stop(true)
    }
  })
}, 45000)

test("CLI: actual agent reads the selected project's file despite a stale inherited PWD", async () => {
  await sandbox(async ({ project, writeGlobal, command }) => {
    const proof = path.join(project, "proof.txt")
    const marker = `LOCAL_FIXTURE_${crypto.randomUUID()}`
    const generated: Array<{ context: number; estimatedPrompt: number; result: boolean }> = []
    const good = daemon(async (request) => {
      const body = await request.json()
      const messages = body.messages as Array<{ role: string; content: string }>
      const estimatedPrompt = Math.ceil(JSON.stringify({ messages, tools: body.tools }).length / 4)
      const context = body.options.num_ctx as number
      const result = messages.some((message) => message.role === "tool" && message.content.includes(marker))
      const canRead = body.tools?.some((tool: { function: { name: string } }) => tool.function.name === "read")
      generated.push({ context, estimatedPrompt, result })
      if (context < Math.max(7342, estimatedPrompt) || generated.length > 12) {
        return Response.json({ error: "request exceeds the available context size" }, { status: 400 })
      }
      // The real read-tool schema requires an absolute path. The result below
      // must come from executing that tool, not a response invented by the mock.
      const message = result || !canRead ? { role: "assistant", content: "OK" } : {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "read-fixture", function: {
          index: 0, name: "read", arguments: { filePath: proof },
        } }],
      }
      if (!body.stream) return Response.json({ message, done: true, eval_count: 2, prompt_eval_count: estimatedPrompt })
      return new Response([
        JSON.stringify({ message, done: false }),
        JSON.stringify({
          message: { role: "assistant", content: "" }, done: true, done_reason: "stop",
          eval_count: 2, prompt_eval_count: estimatedPrompt,
        }),
        "",
      ].join("\n"), { headers: { "Content-Type": "application/x-ndjson" } })
    })
    try {
      await writeGlobal({
        model: "ollama/fixture", small_model: "ollama/fixture",
        provider: { ollama: { options: { host: good.host } } },
      })
      await fs.writeFile(proof, `${marker}\n`)
      const result = await command([
        "run", "--model", "ollama/fixture", `Read ${JSON.stringify(proof)} with the read tool, then reply OK.`,
      ], { PWD: path.dirname(launcher) })
      expect({ code: result.code, stderr: result.code ? result.stderr : "" }).toEqual({ code: 0, stderr: "" })
      expect(result.stdout).toContain("OK")
      expect(generated.some((request) => request.result)).toBe(true)
      expect(generated.every((request) => request.context === 32768)).toBe(true)
      expect(generated.length).toBeLessThan(12)
    } finally {
      good.server.stop(true)
    }
  })
}, 45000)
