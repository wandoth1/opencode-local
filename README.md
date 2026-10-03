# OpenCode Local

**Unofficial, experimental OpenCode fork focused on Ollama compatibility and local inference on NVIDIA GeForce RTX 5070 hardware.**

[Español](README.es.md) · [Development branch](https://github.com/wandoth1/opencode-local/tree/feature/local-foundation) · [Draft PR #1](https://github.com/wandoth1/opencode-local/pull/1)

> OpenCode's original codebase and agent were created by the contributors to [anomalyco/opencode](https://github.com/anomalyco/opencode). This fork is maintained independently by [wandoth1](https://github.com/wandoth1); it is not developed, supported or endorsed by the OpenCode team.
>
> Experimental: this is a source-level local-runtime milestone, not a production release or a demonstrated RTX 5070 speedup. Independent re-audit and physical GPU testing remain required.

## Purpose

Keep OpenCode's existing sessions, tools, configuration, UI and provider infrastructure while developing a more reliable local Ollama integration. The initial target is Windows with an RTX 5070. Other RTX 50-series hardware is not presented as already tested.

Work on `feature/local-foundation` includes native Ollama discovery and chat transport, incremental text/reasoning, tool-call validation, NVIDIA diagnostics, context/KV-cache estimates, and a reproducible doctor/benchmark command. [vercel-labs/fx](https://github.com/vercel-labs/fx) is an architectural reference for separating agent, provider and transport; its Zig runtime is not integrated here.

## Branches and status

| Branch | Role |
| --- | --- |
| `dev` | Default branch: imported application baseline, fork presentation and repository housekeeping. Local-runtime changes have not been merged. |
| `feature/local-foundation` | Experimental implementation and audit corrections proposed in this repository's draft PR #1. |

Imported baseline: `anomalyco/opencode@b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`. This is a historical reference, not a claim to track the latest upstream commit. The repository was imported independently; "fork" describes its code provenance rather than membership in GitHub's fork network.

The first static audit found material defects. Its corrections are now represented by direct, reviewable source changes, not bootstrap archives. Review the [audit ledger](https://github.com/wandoth1/opencode-local/blob/feature/local-foundation/docs/local-foundation/AUDIT.md), current diff and checks for the exact revision; older completion claims and old green runs are not evidence for a new HEAD.

Inherited scheduled maintenance and self-modifying hardening jobs remain archived. The replacement validation workflow checks Linux and Windows on PR changes or manual invocation, with read-only repository permissions, no schedule, no automatic commits and no deployment.

## Inspect and run the experimental source

```bash
git clone --single-branch --branch feature/local-foundation https://github.com/wandoth1/opencode-local.git
cd opencode-local
bun install --frozen-lockfile
cd packages/opencode
bun run --conditions=browser src/index.ts local doctor --json
```

Use the pinned Bun version from `package.json` and start Ollama separately. See the [usage guide](https://github.com/wandoth1/opencode-local/blob/feature/local-foundation/docs/local-foundation/USAGE.md) before benchmarking. GPU memory values are estimates; a unit test or mock server is not a real-model performance test.

**Official OpenCode installers, the npm package `opencode-ai`, and upstream releases install the original application, not this branch.** No fork binary release is promised by this README.

## Collaboration and safety

Contribute through [this repository's issues and pull requests](https://github.com/wandoth1/opencode-local/issues). Keep changes on reviewable branches and never re-enable retired workflows without owner approval. Repository rules must be activated in GitHub Settings; a ruleset JSON file alone does not protect a branch.

Place remote Ollama endpoints and credentials in trusted user configuration or the documented environment variables, not a shared project config. This fork is still a coding agent that can execute tools/plugins: it is not a sandbox for arbitrary repositories.

## Attribution and license

The original [MIT license and copyright notice](LICENSE) are preserved. OpenCode references in inherited packages, commands, historical documents and assets retain attribution or compatibility; they are not an endorsement of this fork. Other inherited README translations may still describe upstream OpenCode; these English and Spanish pages describe OpenCode Local.
