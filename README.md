# OpenCode Local

**Unofficial, experimental OpenCode fork focused on Ollama compatibility and local inference on NVIDIA GeForce RTX 5070 hardware.**

[Español](README.es.md) · [Development branch](https://github.com/wandoth1/opencode-local/tree/feature/local-foundation) · [Draft PR #1](https://github.com/wandoth1/opencode-local/pull/1)

> OpenCode's original codebase and agent were created by the contributors to [anomalyco/opencode](https://github.com/anomalyco/opencode). This fork is maintained independently by [wandoth1](https://github.com/wandoth1); it is not developed, supported or endorsed by the OpenCode team.
>
> Experimental: this source-level local-runtime milestone is not a production release or a demonstrated RTX 5070 speedup. Independent re-audit and physical GPU testing remain required.

## Purpose and development

Keep OpenCode's existing sessions, tools, configuration, UI and provider infrastructure while developing a more reliable local Ollama integration. The initial target is Windows with RTX 5070. Other RTX 50-series hardware is not presented as already tested.

Work includes native Ollama discovery/chat transport, incremental text and reasoning, validated tool calls, NVIDIA diagnostics, context/KV-cache estimates and a doctor/benchmark command. [vercel-labs/fx](https://github.com/vercel-labs/fx) is an architectural reference for agent/provider/transport separation; its Zig runtime is not integrated here.

| Branch | Role |
| --- | --- |
| `dev` | Default branch: imported application baseline, fork presentation and repository housekeeping. Local-runtime changes are not merged. |
| `feature/local-foundation` | Experimental implementation and audit corrections proposed in this repository's draft PR #1. |

Imported baseline: `anomalyco/opencode@b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`, not a claim to track the latest upstream commit. The repository was imported independently; "fork" describes code provenance, not necessarily membership in GitHub's fork network.

The first static audit found material defects. Corrections now exist as direct source changes, not bootstrap archives. Review the [audit ledger](https://github.com/wandoth1/opencode-local/blob/feature/local-foundation/docs/local-foundation/AUDIT.md), current diff and checks for the exact revision. Older completion claims or green runs do not validate a new HEAD.

## Run the experimental source

```bash
git clone --single-branch --branch feature/local-foundation https://github.com/wandoth1/opencode-local.git
cd opencode-local
bun install --frozen-lockfile --filter './' --filter './packages/opencode'
cd packages/opencode
bun run --conditions=browser src/index.ts local doctor --json
```

Use the pinned Bun version in `package.json` and start Ollama separately. This scoped install includes root development tooling plus the agent and its dependencies. It excludes unrelated hosted applications whose SolidStart preview tarball returned 404. The original lockfile and package versions remain unchanged; this is not validation of the entire upstream monorepo. See the [usage guide](https://github.com/wandoth1/opencode-local/blob/feature/local-foundation/docs/local-foundation/USAGE.md) before benchmarking.

**Official OpenCode installers, the npm package `opencode-ai`, and upstream releases install the original application, not this branch.** No fork binary release is promised here.

## Collaboration and safety

Use [this repository's issues and pull requests](https://github.com/wandoth1/opencode-local/issues) for fork-specific work. Inherited scheduled maintenance and self-modifying jobs remain archived. The replacement Linux/Windows validation has read-only repository permissions, no schedule, no commits, no deployment and bounded job duration.

Repository protection must be activated in GitHub Settings; `.github/protect-dev.ruleset.json` alone does not protect `dev`. Remote Ollama endpoints and credentials belong in trusted user configuration or documented environment variables, not shared project config. This remains an agent capable of executing tools/plugins, not a sandbox for arbitrary repositories.

## Attribution and license

The original [MIT license and copyright notice](LICENSE) are preserved. OpenCode references in inherited packages, commands, historical documents and assets retain attribution or compatibility, not endorsement. Other inherited translations may still describe upstream OpenCode; these English and Spanish pages describe OpenCode Local. GPU estimates and mock tests do not establish measured hardware acceleration.
