import type { Argv } from "yargs"
import { Effect } from "effect"
import { effectCmd, CliError } from "../effect-cmd"
import { Config } from "../../config/config"
import { formatBytes } from "../../local/runtime"
import { getDoctorReport, type DoctorArgs } from "../../local/doctor"
const printable = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, "")
const metric = (value?: number) => value !== undefined && Number.isFinite(value) ? value.toFixed(1) : "unknown"
const DoctorCommand = effectCmd({
  command: "doctor",
  describe: "diagnose the configured Ollama runtime, GPU and context budget",
  instance: true,
  builder: (yargs: Argv) => yargs
    .option("host", { type: "string", describe: "explicit Ollama endpoint override (does not inherit credentials for another endpoint)" })
    .option("model", { type: "string", describe: "model to inspect or benchmark" })
    .option("num-ctx", { type: "number", describe: "requested context, capped at the known model maximum" })
    .option("benchmark", { type: "boolean", default: false, describe: "load the model and measure a short generation" })
    .option("output-tokens", { type: "number", default: 96, describe: "maximum benchmark output tokens" })
    .option("json", { type: "boolean", default: false, describe: "print allowlisted, credential-free diagnostic JSON" }),
  handler: Effect.fn("Cli.local.doctor")(function* (args: DoctorArgs) {
    const service = yield* Config.Service
    const config = yield* service.get()
    const globalConfig = yield* service.getGlobal()
    const report = yield* Effect.tryPromise({
      try: () => getDoctorReport(config, globalConfig, args),
      catch: () => new CliError({ message: "Local diagnosis failed. Check the model, numeric options, trusted Ollama endpoint and daemon availability.", exitCode: 1 }),
    })
    if (args.json) { console.log(JSON.stringify(report, null, 2)); return }
    const snapshot = report.snapshot
    console.log(`Ollama ${snapshot.version ?? "(version unknown)"} at ${printable(snapshot.endpoint)}`)
    console.log(`Native transport: ${snapshot.nativeTransport ? "enabled" : "disabled"}`)
    console.log(`Hardware: ${snapshot.hardware.platform}/${snapshot.hardware.architecture}`)
    if (!snapshot.hardware.nvidiaGpus.length) console.log("NVIDIA telemetry unavailable; remote endpoints are not sized using this computer's GPU.")
    for (const gpu of snapshot.hardware.nvidiaGpus) {
      console.log(`GPU ${gpu.index}: ${printable(gpu.name)} | free ${formatBytes(gpu.memoryFreeBytes)} / ${formatBytes(gpu.memoryTotalBytes)}`)
      console.log(`Driver ${gpu.driverVersion ?? "unknown"}; driver CUDA compatibility ${gpu.cudaVersion ?? "unknown"}`)
    }
    for (const [id, model] of Object.entries(snapshot.models)) {
      console.log(`${id === report.selectedModel ? "*" : " "} ${printable(id)} | context ${model.limit.context} | tools ${model.tools}`)
      if (model.context) for (const reason of model.context.reasons) console.log(`  ${reason}`)
    }
    if (report.benchmark) {
      console.log(`TTFT ${metric(report.benchmark.timeToFirstTokenMs)} ms | prompt ${metric(report.benchmark.promptTokensPerSecond)} tok/s | generation ${metric(report.benchmark.outputTokensPerSecond)} tok/s`)
      console.log(`Wall ${metric(report.benchmark.wallDurationMs)} ms | model load ${metric(report.benchmark.loadDurationMs)} ms`)
    }
  }),
})
export const LocalCommand = effectCmd({
  command: "local", describe: "OpenCode Local runtime tools", instance: false,
  builder: (yargs: Argv) => yargs.command(DoctorCommand).demandCommand(),
  handler: Effect.fn("Cli.local")(function* () {}),
})
