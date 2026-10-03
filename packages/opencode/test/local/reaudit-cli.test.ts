import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const launcher = path.resolve(import.meta.dir, "../../../../scripts/opencode-local.mjs")

async function sandbox(run: (input: {
  project: string
  writeGlobal: (value: unknown) => Promise<void>
  command: (args: string[], environment?: Record<string, string>) => Promise<{ stdout: string; stderr: string; code: number }>
}) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-reaudit-"))
  const project = path.join(directory, "project")
  const config = path.join(directory, "config", "opencode")
  await Promise.all([fs.mkdir(project, { recursive: true }), fs.mkdir(config, { recursive: true }), fs.mkdir(path.join(directory, "home"), { recursive: true })])
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (key.startsWith("OPENCODE_OLLAMA_") || key.startsWith("OPENCODE_CONFIG") || ["OLLAMA_HOST", "OPENCODE_LOCAL_DISABLE", "BUN_OPTIONS", "OPENCODE_DISABLE_DEFAULT_PLUGINS"].includes(key)) delete environment[key]
  }
  Object.assign(environment, {
    XDG_CONFIG_HOME: path.join(directory, "config"), XDG_DATA_HOME: path.join(directory, "data"),
    XDG_CACHE_HOME: path.join(directory, "cache"), XDG_STATE_HOME: path.join(directory, "state"),
    OPENCODE_TEST_HOME: path.join(directory, "home"), OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(directory, "managed"),
    OPENCODE_DB: ":memory:", OPENCODE_BUN: process.execPath,
  })
  const node = Bun.which("node")
  if (!node) throw new Error("The source-launcher integration test requires Node")
  try {
    await run({
      project,
      writeGlobal: (value) => fs.writeFile(path.join(config, "opencode.json"), JSON.stringify(value)),
      async command(args, extra = {}) {
        const child = Bun.spawn({ cmd: [node, launcher, ...args], cwd: project,
          env: { ...environment, ...extra }, stdout: "pipe", stderr: "pipe" })
        const timer = setTimeout(() => child.kill(), 35000)
        try {
          const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
          return { stdout, stderr, code }
        } finally { clearTimeout(timer); child.kill() }
      },
    })
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
function daemon(chat?: (request: Request) => Response | Promise<Response>) {
  const requests: Array<{ path: string; authorization: string | null }> = []
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const route = new URL(request.url).pathname
    requests.push({ path: route, authorization: request.headers.get("authorization") })
    if (route === "/api/tags") return Response.json({ models: [{ name: "fixture", size: 3000000000 }] })
    if (route === "/api/show") return Response.json({ capabilities: ["completion", "tools"], model_info: {
      "general.architecture": "llama", "llama.context_length": 65536,
    } })
    if (route === "/api/ps") return Response.json({ models: [] })
    if (route === "/api/version") return Response.json({ version: "0.32.14-fixture" })
    if (route === "/api/chat" && chat) return chat(request)
    return Response.json({ error: "unexpected fixture route" }, { status: 404 })
  } })
  return { server, requests, host: `http://127.0.0.1:${server.port}` }
}

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
      expect(result.stdout).not.toContain('"models"')
    })
  } finally { good.server.stop(true) }
}, 45000)

test("CLI: Node launcher prevents project .env from selecting an endpoint or disabling safety", async () => {
  const good = daemon()
  const other = daemon()
  try {
    await sandbox(async ({ project, writeGlobal, command }) => {
      await writeGlobal({ provider: { ollama: { options: { host: good.host } } } })
      await fs.writeFile(path.join(project, ".env"), `OPENCODE_OLLAMA_HOST=${other.host}\nOPENCODE_LOCAL_DISABLE=1\n`)
      const result = await command(["local", "doctor", "--json"], { OPENCODE_OLLAMA_API_KEY: "shell-fixture-key" })
      expect({ code: result.code, stderr: result.code ? result.stderr : "" }).toEqual({ code: 0, stderr: "" })
      const report = JSON.parse(result.stdout)
      expect(report.snapshot.endpoint).toBe(good.host)
      expect(report.snapshot.models.fixture.context.reasons.join(" ")).not.toContain("explicit user")
      expect(other.requests).toHaveLength(0)
      expect(good.requests.length).toBeGreaterThan(0)
      expect(good.requests.every((request) => request.authorization === "Bearer shell-fixture-key")).toBe(true)
      expect(result.stdout + result.stderr).not.toContain("shell-fixture-key")
    })
  } finally { good.server.stop(true); other.server.stop(true) }
}, 45000)

test("CLI: disabled local provider never sends a merged global key to a project endpoint", async () => {
  const other = daemon()
  try {
    await sandbox(async ({ project, writeGlobal, command }) => {
      await writeGlobal({ provider: { ollama: { options: { apiKey: "global-fixture-key" }, models: {
        fixture: { name: "fixture", limit: { context: 16384, output: 4096 } },
      } } } })
      await fs.writeFile(path.join(project, "opencode.json"), JSON.stringify({ provider: {
        ollama: { npm: "@ai-sdk/openai-compatible", options: { baseURL: `${other.host}/v1` } },
      } }))
      const result = await command(["run", "--model", "ollama/fixture", "Reply OK"], { OPENCODE_LOCAL_DISABLE: "1" })
      expect(result.code).not.toBe(0)
      expect(other.requests).toHaveLength(0)
      expect(result.stdout + result.stderr).not.toContain("global-fixture-key")
    })
  } finally { other.server.stop(true) }
}, 45000)

test("CLI: actual agent completes a file-read tool turn within its default context", async () => {
  const generated: Array<{ context: number; estimatedPrompt: number; result: boolean }> = []
  const good = daemon(async (request) => {
    const body = await request.json()
    const messages = body.messages as Array<{ role: string; content: string }>
    const estimatedPrompt = Math.ceil(JSON.stringify({ messages, tools: body.tools }).length / 4)
    const context = body.options.num_ctx as number
    const result = messages.some((message) => message.role === "tool" && message.content.includes("LOCAL_FIXTURE_VALUE"))
    generated.push({ context, estimatedPrompt, result })
    if (context < Math.max(7342, estimatedPrompt) || generated.length > 4) {
      return Response.json({ error: "request exceeds the available context size" }, { status: 400 })
    }
    const message = result ? { role: "assistant", content: "OK" } : {
      role: "assistant", content: "", tool_calls: [{ id: "read-fixture", function: {
        index: 0, name: "read", arguments: { filePath: "proof.txt" },
      } }],
    }
    if (!body.stream) return Response.json({ message, done: true, eval_count: 2, prompt_eval_count: estimatedPrompt })
    return new Response(JSON.stringify({ message, done: false }) + "\n" + JSON.stringify({
      message: { role: "assistant", content: "" }, done: true, done_reason: "stop", eval_count: 2, prompt_eval_count: estimatedPrompt,
    }) + "\n", { headers: { "Content-Type": "application/x-ndjson" } })
  })
  try {
    await sandbox(async ({ project, writeGlobal, command }) => {
      await writeGlobal({ model: "ollama/fixture", small_model: "ollama/fixture", provider: { ollama: { options: { host: good.host } } } })
      await fs.writeFile(path.join(project, "proof.txt"), "LOCAL_FIXTURE_VALUE\n")
      const result = await command(["run", "--model", "ollama/fixture", "Read proof.txt with the read tool, then reply with the single word OK."])
      expect({ code: result.code, stderr: result.code ? result.stderr : "" }).toEqual({ code: 0, stderr: "" })
      expect(result.stdout).toContain("OK")
      expect(generated.some((request) => request.result)).toBe(true)
      expect(generated.every((request) => request.context === 16384)).toBe(true)
    })
  } finally { good.server.stop(true) }
}, 45000)
