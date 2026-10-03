import type { Argv } from "yargs"
import { Effect } from "effect"
import { effectCmd, CliError } from "../effect-cmd"
import { Config } from "../../config/config"
import { formatBytes } from "../../local/runtime"
import { getDoctorReport, type DoctorArgs } from "../../local/doctor"
import { diagnosticError } from "../../local/ollama/errors"

const printable = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
const metric = (value?: number) => value !== undefined && Number.isFinite(value) ? value.toFixed(1) : "unknown"
const DoctorCommand = effectCmd({
  command: "doctor",
  describe: "diagnose the configured Ollama runtime, GPU and context budget",
  instance: true,
  builder: (yargs: Argv) => yargs
    .option("host", { type: "string", describe: "explicit endpoint override; credentials stay bound to their original endpoint" })
    .option("model", { type: "string", describe: "model to inspect; required for benchmark unless configured explicitly" })
    .option("num-ctx", { type: "number", describe: "requested context, capped at the known model maximum" })
    .option("benchmark", { type: "boolean", default: false, describe: "load the explicitly selected model and measure a short generation" })
    .option("output-tokens", { type: "number", default: 96, describe: "maximum benchmark output tokens" })
    .option("benchmark-timeout-ms", { type: "number", describe: "optional total benchmark deadline in milliseconds; zero disables it" })
    .option("json", { type: "boolean", default: false, describe: "print allowlisted, credential-free diagnostic JSON" }),
  handler: Effect.fn("Cli.local.doctor")(function* (args: DoctorArgs) {
    const service = yield* Config.Service
    const config = yield* service.get()
    const globalConfig = yield* service.getGlobal()
    const report = yield* Effect.tryPromise({
      try: () => getDoctorReport(config, globalConfig, args),
      catch: (error) => new CliError({ message: diagnosticError(error), exitCode: 1 }),
    })
    if (args.json) { console.log(JSON.stringify(report, null, 2)); return }
    const snapshot = report.snapshot
    console.log(`Ollama ${printable(snapshot.version ?? "(version unknown)")} at ${printable(snapshot.endpoint)}`)
    console.log(`Native transport: ${snapshot.nativeTransport ? "enabled" : "disabled"}`)
    console.log(`Hardware: ${printable(snapshot.hardware.platform)}/${printable(snapshot.hardware.architecture)}`)
    if (!snapshot.hardware.nvidiaGpus.length) console.log("NVIDIA telemetry unavailable; remote endpoints are not sized using this computer's GPU.")
    for (const gpu of snapshot.hardware.nvidiaGpus) {
      console.log(`GPU ${gpu.index}: ${printable(gpu.name)} | free ${formatBytes(gpu.memoryFreeBytes)} / ${formatBytes(gpu.memoryTotalBytes)}`)
      console.log(`Driver ${printable(gpu.driverVersion ?? "unknown")}; driver CUDA compatibility ${printable(gpu.cudaVersion ?? "unknown")}`)
    }
    for (const warning of snapshot.warnings) console.log(`Warning: ${printable(warning)}`)
    for (const [id, model] of Object.entries(snapshot.models)) {
      console.log(`${id === report.selectedModel ? "*" : " "} ${printable(id)} | context ${model.limit.context} | tools ${model.tools}`)
      if (model.context) for (const reason of model.context.reasons) console.log(`  ${printable(reason)}`)
    }
    if (report.benchmark) {
      console.log(`TTFT ${metric(report.benchmark.timeToFirstTokenMs)} ms | prompt ${metric(report.benchmark.promptTokensPerSecond)} tok/s | generation ${metric(report.benchmark.outputTokensPerSecond)} tok/s`)
      if (report.benchmark.cachedPromptTokens === undefined) console.log("Prompt throughput is unknown: the daemon did not provide a cache count. Unknown is not zero.")
      console.log(`Wall ${metric(report.benchmark.wallDurationMs)} ms | model load ${metric(report.benchmark.loadDurationMs)} ms`)
    }
  }),
})
export const LocalCommand = effectCmd({
  command: "local", describe: "OpenCode Local runtime tools", instance: false,
  builder: (yargs: Argv) => yargs.command(DoctorCommand).demandCommand(),
  handler: Effect.fn("Cli.local")(function* () {}),
})
