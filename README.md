# OpenCode Local

**An unofficial, experimental fork of OpenCode focused on Ollama integration and local-inference optimization for NVIDIA RTX 5070 hardware.**

[Español](README.es.md) · [Development branch](https://github.com/wandoth1/opencode-local/tree/feature/local-foundation) · [Draft PR #1](https://github.com/wandoth1/opencode-local/pull/1)

> **Attribution and independence:** This project is derived from [OpenCode](https://github.com/anomalyco/opencode), created by the OpenCode contributors. The fork-specific work is maintained by [wandoth1](https://github.com/wandoth1). OpenCode Local is not developed, supported, or endorsed by the OpenCode team and is not affiliated with it.
>
> **Experimental status:** Runtime corrections and independent re-audit remain pending. The local-runtime branch is not production-ready. No performance improvement on a physical RTX 5070 has been demonstrated by this project yet.

## What this project is

OpenCode Local is a separate development effort on top of OpenCode's existing codebase, not an agent written from scratch and not an official OpenCode release. It retains the inherited product, tools, sessions, configuration, and provider infrastructure while exploring a more hardware-aware local runtime.

The initial target is **Windows with an NVIDIA GeForce RTX 5070 and Ollama**. Work on other RTX 50-series cards or inference backends is a possible future extension, not a claim of tested support.

The development objectives are:

- More reliable Ollama discovery, model metadata, native transport, streaming, and tool calling.
- Context and KV-cache budgeting informed by available VRAM, with diagnostics that distinguish estimates from measurements.
- Reproducible benchmarks before making claims about speed, memory use, or CPU offload.

[vercel-labs/fx](https://github.com/vercel-labs/fx) is an architectural reference for separating the agent, provider, and transport. This does not mean that FX's Zig runtime is integrated into this fork.

## Where development happens

| Branch | Purpose |
| --- | --- |
| [`dev`](https://github.com/wandoth1/opencode-local/tree/dev) | Default landing branch: imported OpenCode baseline, fork presentation, and repository automation housekeeping. It does not contain the unmerged local-runtime implementation. |
| [`feature/local-foundation`](https://github.com/wandoth1/opencode-local/tree/feature/local-foundation) | Experimental Ollama, hardware diagnostics, and context-management work. Review and corrections take place here. |

The imported upstream baseline is `anomalyco/opencode@b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`. It is a historical starting point, not a claim of synchronization with the latest upstream revision.

The repository was imported as a separate copy. Here, **fork** describes its code lineage; it does not imply that GitHub displays it as a fork in the upstream repository network. PR #1 belongs to `wandoth1/opencode-local`, not to the upstream repository.

## Status and installation

The local-runtime changes are under development in [draft PR #1](https://github.com/wandoth1/opencode-local/pull/1), not merged into `dev`. Earlier audit findings and failed hardening attempts must not be mistaken for completed fixes or successful validation of the current HEAD.

The inherited scheduled maintenance jobs and temporary hardening jobs that were paused must remain paused. Their archived YAML files are kept under `.github/disabled-workflows/` on the applicable branch. This README change does not restart them or launch a new build.

To inspect the experimental source:

```bash
git clone --single-branch --branch feature/local-foundation https://github.com/wandoth1/opencode-local.git
cd opencode-local
```

**The official OpenCode installer, the `opencode-ai` npm package, and downloads from `anomalyco/opencode` install upstream OpenCode, not this experimental branch.** Do not treat upstream packages, releases, version badges, or CI badges as evidence that this fork has been built or validated.

Branch-specific technical documents are available in [docs/local-foundation](https://github.com/wandoth1/opencode-local/tree/feature/local-foundation/docs/local-foundation). They describe implementation intent; current source, audit findings, and checks for the exact commit take precedence over older status claims.

## Upstream attribution and license

The original [MIT license and copyright notice](LICENSE) are retained unchanged. OpenCode names inside source packages, commands, configuration keys, historical documents, and inherited assets identify the upstream software or preserve compatibility; they do not imply official endorsement of this fork.

The [original upstream README at the imported baseline](https://github.com/anomalyco/opencode/blob/b155b15694dbcc6768f11d2f25cc2bdd1f738ab4/README.md) remains the reference for the original project. Other inherited README translations may still describe upstream OpenCode; the English and Spanish READMEs in this repository describe OpenCode Local.

Please discuss fork-specific issues and changes in [wandoth1/opencode-local](https://github.com/wandoth1/opencode-local/issues), without assuming that the upstream maintainers support this branch.
