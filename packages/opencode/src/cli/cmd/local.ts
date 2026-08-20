import type { Argv } from "yargs"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { formatBytes, redactSecrets } from "@/local/runtime"
import { contextRiskLabel } from "@/local/context-budget"
import { OllamaClient } from "@/local/ollama/client"
import { OllamaIntegration } from "@/local/ollama/integration"

interface DoctorArgs {
  host?: string
  model?: string
  numCtx?: number
  json?: boolean
  benchmark?: boolean
  outputTokens?: number
}

function number(value: number | undefined, digits = 1) {
  return value === undefined || !Number.isFinite(value) ? "unknown" : value.toFixed(digits)
}

function printDoctor(snapshot: NonNullable<Awaited<ReturnType<typeof OllamaIntegration.discover>>>, modelID?: string) {
  console.log("Local runtime")
  console.log(`  Backend:           Ollama ${snapshot.version ?? "unknown version"}`)
  console.log(`  Endpoint:          ${snapshot.settings.host}`)
  console.log(`  Native transport: ${snapshot.settings.nativeTransport ? "enabled" : "disabled"}`)
  console.log("")

  console.log("Hardware")
  console.log(`  Platform:          ${snapshot.hardware.platform}/${snapshot.hardware.architecture}`)
  console.log(`  CPU:               ${snapshot.hardware.cpuModel} (${snapshot.hardware.cpuCount} logical cores)`)
  console.log(
    `  RAM:               ${formatBytes(snapshot.hardware.systemMemoryFreeBytes)} free / ${formatBytes(snapshot.hardware.systemMemoryTotalBytes)} total`,
  )
  if (snapshot.hardware.nvidiaGpus.length === 0) {
    console.log("  NVIDIA:            not detected")
  } else {
    for (const gpu of snapshot.hardware.nvidiaGpus) {
      console.log(`  GPU ${gpu.index}:             ${gpu.name}`)
      console.log(
        `    VRAM:            ${formatBytes(gpu.memoryFreeBytes)} free / ${formatBytes(gpu.memoryTotalBytes)} total`,
      )
      console.log(`    Driver/CUDA:     ${gpu.driverVersion ?? "unknown"} / ${gpu.cudaVersion ?? "unknown"}`)
      console.log(`    Utilization:     ${gpu.utilizationPercent ?? "unknown"}%`)
    }
  }
  console.log("")

  console.log("Models")
  const entries = Object.entries(snapshot.models)
  for (const [id, model] of entries) {
    const profile = snapshot.profiles[id]
    const selected = modelID === id ? "*" : " "
    if (!profile) {
      console.log(`${selected} ${id}: configured manually (${model.limit?.context ?? "unknown"} context)`)
      continue
    }
    const loaded = profile.loaded?.sizeVramBytes ? ` · loaded ${formatBytes(profile.loaded.sizeVramBytes)}` : ""
    console.log(
      `${selected} ${id}: ${profile.metadata.parameterSize ?? "?"} ${profile.metadata.quantization ?? ""} · context ${profile.context.recommendedContextTokens} · ${contextRiskLabel(profile.context)}${loaded}`,
    )
    if (profile.context.expectedCpuOffload) console.log("    warning: CPU offload is expected with current VRAM capacity")
  }
}

const DoctorCommand = effectCmd({
  command: "doctor",
  describe: "diagnose local Ollama, GPU, VRAM, models, and context sizing",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("host", {
        type: "string",
        describe: "Ollama host (defaults to OPENCODE_OLLAMA_HOST, OLLAMA_HOST, or localhost)",
      })
      .option("model", {
        type: "string",
        describe: "model to highlight or benchmark",
      })
      .option("num-ctx", {
        type: "number",
        describe: "override context tokens for the recommendation and benchmark",
      })
      .option("benchmark", {
        type: "boolean",
        default: false,
        describe: "run a short generation benchmark (loads the selected model)",
      })
      .option("output-tokens", {
        type: "number",
        default: 96,
        describe: "maximum output tokens used by --benchmark",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "emit machine-readable JSON",
      }),
  handler: Effect.fn("Cli.local.doctor")(function* (args: DoctorArgs) {
    if (args.numCtx !== undefined && (!Number.isInteger(args.numCtx) || args.numCtx <= 0)) {
      return yield* fail("--num-ctx must be a positive integer")
    }
    if (args.outputTokens !== undefined && (!Number.isInteger(args.outputTokens) || args.outputTokens <= 0)) {
      return yield* fail("--output-tokens must be a positive integer")
    }

    const config = {
      provider: {
        ollama: {
          options: {
            ...(args.host ? { host: args.host } : {}),
            ...(args.numCtx ? { numCtx: args.numCtx } : {}),
          },
        },
      },
    } as any
    const settings = OllamaIntegration.resolveSettings(config)
    const snapshot = yield* Effect.promise(() => OllamaIntegration.discover(config, settings))
    if (!snapshot) return yield* fail(`Ollama was not reachable at ${settings.host}, or it has no local models.`)

    const modelID = args.model ?? Object.keys(snapshot.models)[0]
    let benchmark
    if (args.benchmark) {
      if (!modelID || !snapshot.models[modelID]) return yield* fail(`Model not found: ${args.model ?? "(none)"}`)
      const context =
        args.numCtx ??
        snapshot.profiles[modelID]?.context.recommendedContextTokens ??
        snapshot.models[modelID].limit?.context ??
        16_384
      const client = new OllamaClient({
        host: snapshot.settings.host,
        apiKey: snapshot.settings.apiKey,
        headers: snapshot.settings.headers,
        timeoutMs: snapshot.settings.timeoutMs,
      })
      benchmark = yield* Effect.promise(() =>
        client.benchmark({
          model: modelID,
          contextTokens: context,
          outputTokens: args.outputTokens,
          keepAlive: snapshot.settings.keepAlive,
        }),
      )
    }

    if (args.json) {
      console.log(
        JSON.stringify(
          redactSecrets({
            generatedAt: new Date().toISOString(),
            snapshot,
            benchmark,
          }),
          null,
          2,
        ),
      )
      return
    }

    printDoctor(snapshot, modelID)
    if (!benchmark) return
    console.log("")
    console.log("Benchmark")
    console.log(`  Model/context:     ${benchmark.model} / ${benchmark.contextTokens}`)
    console.log(`  Time to first:     ${number(benchmark.timeToFirstTokenMs)} ms`)
    console.log(`  Prompt speed:      ${number(benchmark.promptTokensPerSecond)} tok/s`)
    console.log(`  Generation speed:  ${number(benchmark.outputTokensPerSecond)} tok/s`)
    console.log(`  Wall duration:     ${number(benchmark.wallDurationMs)} ms`)
    console.log(`  Load duration:     ${number(benchmark.loadDurationMs)} ms`)
    if (benchmark.sample) console.log(`  Sample:            ${benchmark.sample.replace(/\s+/g, " ").trim()}`)
  }),
})

export const LocalCommand = effectCmd({
  command: "local",
  describe: "local model runtime tools",
  instance: false,
  builder: (yargs: Argv) => yargs.command(DoctorCommand).demandCommand(),
  handler: Effect.fn("Cli.local")(function* () {}),
})
