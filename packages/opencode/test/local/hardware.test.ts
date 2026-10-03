import { expect, test } from "bun:test"
import { parseCudaVersion, parseNvidiaSmiCsv } from "@/local/hardware"
import { MIB } from "@/local/runtime"

test("parses nvidia-smi CSV and CUDA version", () => {
  const output = '0, NVIDIA GeForce RTX 5070, 590.12, 12282, 11000, 1282, 37\n'
  const [gpu] = parseNvidiaSmiCsv(output, "13.1")
  expect(gpu.name).toBe("NVIDIA GeForce RTX 5070")
  expect(gpu.memoryTotalBytes).toBe(12_282 * MIB)
  expect(gpu.memoryFreeBytes).toBe(11_000 * MIB)
  expect(gpu.utilizationPercent).toBe(37)
  expect(gpu.cudaVersion).toBe("13.1")
})

test("parses the CUDA version from the standard nvidia-smi banner", () => {
  expect(parseCudaVersion("NVIDIA-SMI 590.12 Driver Version: 590.12 CUDA Version: 13.1")).toBe("13.1")
})
