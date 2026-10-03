import os from "node:os"
import path from "node:path"
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { MIB, type HardwareSnapshot, type NvidiaGpuSnapshot } from "./runtime"

const QUERY = [
  "--query-gpu=index,name,driver_version,memory.total,memory.free,memory.used,utilization.gpu",
  "--format=csv,noheader,nounits",
]

function csvLine(line: string): string[] {
  const values: string[] = []
  let value = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"'
        i++
      } else quoted = !quoted
    } else if (line[i] === "," && !quoted) {
      values.push(value.trim())
      value = ""
    } else value += line[i]
  }
  if (quoted) return []
  values.push(value.trim())
  return values
}

function numeric(raw?: string) {
  if (!raw?.trim()) return undefined
  const number = Number(raw)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

export function parseNvidiaSmiCsv(output: string, cudaVersion?: string): NvidiaGpuSnapshot[] {
  return output.replace(/^\uFEFF/, "").split(/\r?\n/).flatMap((line) => {
    const [indexRaw, name, driver, totalRaw, freeRaw, usedRaw, utilizationRaw] = csvLine(line)
    const index = numeric(indexRaw)
    const total = numeric(totalRaw)
    const free = numeric(freeRaw)
    const used = numeric(usedRaw)
    if (index === undefined || !Number.isSafeInteger(index) || !name || !total || free === undefined || used === undefined) {
      return []
    }
    if (free > total || used > total || total * MIB > Number.MAX_SAFE_INTEGER) return []
    const utilization = numeric(utilizationRaw)
    return [{
      index,
      name,
      driverVersion: driver && !/N\/A|not supported/i.test(driver) ? driver : undefined,
      cudaVersion,
      memoryTotalBytes: total * MIB,
      memoryFreeBytes: free * MIB,
      memoryUsedBytes: used * MIB,
      utilizationPercent: utilization !== undefined && utilization <= 100 ? utilization : undefined,
    }]
  })
}

export function parseCudaVersion(output: string) {
  return /CUDA Version:\s*([0-9.]+)/i.exec(output)?.[1]
}

/** Never search PATH or the working directory for a program while opening an untrusted project. */
export function resolveNvidiaSmiExecutable(
  platform: string = process.platform,
  environment: Record<string, string | undefined> = process.env,
  exists: (candidate: string) => boolean = existsSync,
): string | undefined {
  if (platform === "win32") {
    const root = environment.SystemRoot ?? environment.SYSTEMROOT ?? "C:\\Windows"
    const programs = environment.ProgramFiles ?? environment.PROGRAMFILES ?? "C:\\Program Files"
    const candidates = [
      /^[a-z]:[\\/]/i.test(root) ? path.win32.join(root, "System32", "nvidia-smi.exe") : undefined,
      /^[a-z]:[\\/]/i.test(programs) ? path.win32.join(programs, "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe") : undefined,
    ]
    return candidates.find((candidate): candidate is string => candidate !== undefined && exists(candidate))
  }
  if (platform === "linux") {
    return ["/usr/bin/nvidia-smi", "/usr/local/bin/nvidia-smi", "/usr/lib/wsl/lib/nvidia-smi"].find(exists)
  }
  return undefined
}

function run(executable: string, args: string[]) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 3000,
    maxBuffer: 1024 * 1024,
    shell: false,
  })
  return result.error || result.status !== 0 ? undefined : String(result.stdout ?? "")
}

export function detectNvidiaGpus(): NvidiaGpuSnapshot[] {
  const executable = resolveNvidiaSmiExecutable()
  if (!executable) return []
  const csv = run(executable, QUERY)
  if (!csv) return []
  return parseNvidiaSmiCsv(csv, parseCudaVersion(run(executable, []) ?? ""))
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
