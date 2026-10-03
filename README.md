# OpenCode Local

**Unofficial experimental fork of OpenCode, focused on Ollama compatibility and NVIDIA GeForce RTX 5070 local inference.**

[Español](README.es.md) · [Development branch](https://github.com/wandoth1/opencode-local/tree/feature/local-foundation) · [Draft PR #1](https://github.com/wandoth1/opencode-local/pull/1)

The original codebase and agent belong to the contributors to [anomalyco/opencode](https://github.com/anomalyco/opencode). [wandoth1](https://github.com/wandoth1) maintains this separate development effort; it is not developed, supported or endorsed by the original team. The [MIT license and copyright](LICENSE) are retained. FX is an architectural reference, not an integrated Zig runtime.

## Status

Experimental source, not a production release or measured GPU acceleration. The physical re-audit of `0b4b6fc` found material issues despite green unit tests. Corrections and their limits are documented in [REAUDIT_FIXES.md](docs/local-foundation/REAUDIT_FIXES.md). Require checks for the exact current revision, independent review and repeated real-hardware tests before merge.

`dev` is the protected default branch; `feature/local-foundation` contains the unmerged local work in PR #1. Imported upstream baseline: `b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`. This is an independent import; "fork" describes provenance, not necessarily GitHub fork-network membership. Other RTX 50-series GPUs are not claimed tested.

## Run reviewed source

Use Node 22+ and Bun 1.3.14 in a trusted checkout; start Ollama separately.

```bash
git clone --single-branch --branch feature/local-foundation https://github.com/wandoth1/opencode-local.git
cd opencode-local
bun install --frozen-lockfile --filter './' --filter './packages/opencode'
node scripts/opencode-local.mjs local doctor --json
```

**Launch with Node as shown, not direct `bun run src/index.ts`: the launcher prevents a project's `.env` from being auto-loaded into the agent.** For another working directory use the launcher's absolute path. See [USAGE.md](docs/local-foundation/USAGE.md) for model selection, credentials, timeouts and benchmarks.

The default agent context is 32K, capped by the model maximum; transient VRAM no longer forces a 4K context. Memory estimates are advisory and unsupported architectures are reported unknown. This does not promise every model or workload will fit in GPU memory.

Official OpenCode installers, npm `opencode-ai` and upstream releases install the original, not this branch. The root `install` script refuses to download those binaries. Historical translated upstream documents may still describe the original; use these English/Spanish pages for this fork.

## Collaboration and safety

Use this repository's issues and PRs for fork-specific changes. The active Linux/Windows validation is read-only, with no schedule, automatic commits or deployment. The suite includes a bounded 305-second streaming regression, not a recurring job. Retired upstream maintenance stays archived. No merge or release is automatic.

Keep credentials in trusted user configuration or documented shell variables. Tools/plugins retain user privileges; this is not a sandbox for arbitrary repositories. No performance claim should be made without equivalent model, quantization, context, prompt and hardware measurements.
