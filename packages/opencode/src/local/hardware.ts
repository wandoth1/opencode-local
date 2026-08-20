import os from "os"
import { spawnSync } from "child_process"
import { MIB, type HardwareSnapshot, type NvidiaGpuSnapshot } from "./runtime"

const NVIDIA_QUERY = [
  "--query-gpu=index,name,driver_version,memory.total,memory.free,memory.used,utilization.gpu",
  "--format=csv,noheader,nounits",
]

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ""
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
        continue
      }
      quoted = !quoted
      continue
    }
    if (character === "," && !quoted) {
      values.push(current.trim())
      current = ""
      continue
    }
    current += character
  }

  values.push(current.trim())
  return values
}

function numberOrUndefined(raw: string | undefined): number | undefined {
  if (!raw || raw === "N/A" || raw === "[Not Supported]") return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

export function parseNvidiaSmiCsv(output: string, cudaVersion?: string): NvidiaGpuSnapshot[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [indexRaw, name, driverVersion, totalRaw, freeRaw, usedRaw, utilizationRaw] = parseCsvLine(line)
      const index = numberOrUndefined(indexRaw)
      const total = numberOrUndefined(totalRaw)
      const free = numberOrUndefined(freeRaw)
      const used = numberOrUndefined(usedRaw)
      if (index === undefined || !name || total === undefined || free === undefined || used === undefined) return []
      return [
        {
          index,
          name,
          driverVersion: driverVersion || undefined,
          cudaVersion,
          memoryTotalBytes: total * MIB,
          memoryFreeBytes: free * MIB,
          memoryUsedBytes: used * MIB,
          utilizationPercent: numberOrUndefined(utilizationRaw),
        },
      ]
    })
}

export function parseCudaVersion(output: string): string | undefined {
  return /CUDA Version:\s*([0-9.]+)/i.exec(output)?.[1]
}

function runNvidiaSmi(args: string[]) {
  const result = spawnSync("nvidia-smi", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 3_000,
  })
  if (result.error || result.status !== 0) return undefined
  return String(result.stdout ?? "")
}

export function detectNvidiaGpus(): NvidiaGpuSnapshot[] {
  const summary = runNvidiaSmi([])
  const csv = runNvidiaSmi(NVIDIA_QUERY)
  if (!csv) return []
  return parseNvidiaSmiCsv(csv, summary ? parseCudaVersion(summary) : undefined)
}

export function detectHardware(): HardwareSnapshot {
  const cpus = os.cpus()
  return {
    platform: process.platform,
    architecture: process.arch,
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    systemMemoryTotalBytes: os.totalmem(),
    systemMemoryFreeBytes: os.freemem(),
    nvidiaGpus: detectNvidiaGpus(),
  }
}
