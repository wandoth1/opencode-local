import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/** Exercise the actual effectCmd/Config.Service path, not just the report helper. */
test("doctor CLI reads global credentials and project model configuration", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-local-doctor-"))
  const seen: Array<{ pathname: string; authorized: boolean }> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      seen.push({ pathname, authorized: request.headers.get("authorization") === "Bearer local-test-credential" })
      if (pathname === "/api/tags") return Response.json({ models: [{ name: "fixture", size: 1000000000 }] })
      if (pathname === "/api/show") return Response.json({ capabilities: ["completion", "tools"], model_info: { "general.architecture": "llama", "llama.context_length": 2048 } })
      if (pathname === "/api/ps") return Response.json({ models: [] })
      if (pathname === "/api/version") return Response.json({ version: "test-runtime" })
      return new Response("unexpected route", { status: 404 })
    },
  })
  let stopChild: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const configDirectory = path.join(directory, "config", "opencode")
    const projectDirectory = path.join(directory, "project")
    await fs.mkdir(configDirectory, { recursive: true })
    await fs.mkdir(projectDirectory, { recursive: true })
    await fs.mkdir(path.join(directory, "home"), { recursive: true })
    await fs.writeFile(path.join(configDirectory, "opencode.json"), JSON.stringify({
      provider: { ollama: { options: { host: `http://127.0.0.1:${server.port}`, apiKey: "local-test-credential", keepAlive: "2m" } } },
    }))
    // Core's persisted-config schema requires BOTH fields when limit is present.
    await fs.writeFile(path.join(projectDirectory, "opencode.json"), JSON.stringify({
      model: "ollama/fixture",
      provider: { ollama: { models: { fixture: { name: "Project model", limit: { context: 1000, output: 250 } } } } },
    }))
    const environment = { ...process.env }
    for (const key of Object.keys(environment)) {
      if (key.startsWith("OPENCODE_OLLAMA_") || key === "OLLAMA_HOST" || key === "OPENCODE_LOCAL_DISABLE" || key.startsWith("OPENCODE_CONFIG")) delete environment[key]
    }
    Object.assign(environment, {
      XDG_CONFIG_HOME: path.join(directory, "config"),
      XDG_DATA_HOME: path.join(directory, "data"),
      XDG_CACHE_HOME: path.join(directory, "cache"),
      XDG_STATE_HOME: path.join(directory, "state"),
      OPENCODE_TEST_HOME: path.join(directory, "home"),
      OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(directory, "managed"),
      OPENCODE_DB: ":memory:",
    })
    const child = Bun.spawn({
      cmd: [process.execPath, "run", "--conditions=browser", "--preload", Bun.resolveSync("@opentui/solid/preload", path.resolve(import.meta.dir, "../..")), path.resolve(import.meta.dir, "../../src/index.ts"), "local", "doctor", "--json"],
      cwd: projectDirectory,
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    })
    stopChild = () => { child.kill() }
    timer = setTimeout(stopChild, 20000)
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" })
    const report = JSON.parse(stdout)
    expect(report.selectedModel).toBe("fixture")
    expect(report.snapshot.models.fixture.name).toBe("Project model")
    expect(report.snapshot.models.fixture.limit.context).toBe(1000)
    expect(report.snapshot.models.fixture.limit.output).toBe(250)
    expect(report.snapshot.version).toBe("test-runtime")
    expect(seen.length).toBeGreaterThanOrEqual(4)
    expect(seen.every((item) => item.authorized)).toBe(true)
    expect(stdout).not.toContain("local-test-credential")
    expect(stderr).not.toContain("local-test-credential")
  } finally {
    clearTimeout(timer)
    stopChild?.()
    server.stop(true)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}, 30000)
