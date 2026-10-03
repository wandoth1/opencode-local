# Re-audit ledger

## Scope and history

- Original upstream baseline: `b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`.
- First independent audit examined `a3a05dd538d4bf84b7921c8464950a74622c394b`. It was static-only; the auditor did not run Bun.
- Failed archive-based hardening attempts are not evidence of implemented fixes or validation.
- The replacement implementation is ordinary, reviewable source on `feature/local-foundation`. Record the exact current HEAD and CI test commit, not only a branch name.

## Corrections to inspect

| Area | Implementation and regression coverage |
| --- | --- |
| Project config leaks credentials | Separately loaded global config, complete-endpoint credential binding, rejection of unauthorized remote hosts before network access and removal of unsafe fallback provider on initialization failure. |
| Context below 4K inflated | Native maximum preserved, explicit override capped, output/history invariants including tiny declarations tested. |
| Lost or invalid tool calls | Bounded ID/index accumulator, multiple and fragmented calls, late names, sparse indices, repeated indexed object snapshots, and conflicting identities tested. Tools are released only after valid completion. |
| Premature EOF | Protocol error, never an invented successful stop or execution of incomplete tools. |
| Doctor config differs from runtime | Real Config service path plus subprocess CLI test with a loopback HTTP fixture, global credential and project-specific model limits. |
| Benchmark false success | Completed nonempty output required; thinking counts for TTFT; empty/partial/error responses fail. Cache-aware prefill and zero load duration are covered. |
| Options silently lost | `top_k` and `max_completion_tokens` mapped; unsupported tool choices/external images explicitly rejected; omitted stream is non-streaming. |
| Request/response cancellation hangs | No Request clone/unused tee; cleanup does not wait indefinitely for source cancellation; abort also discards already-buffered NDJSON frames. |
| Shared cache/snapshot contamination | No process-global discovery cache or latestSnapshot. |
| Error messages and diagnostics | No embedded URL credentials/query, no redirects, sanitized header/read/connection failures, and allowlisted diagnostic serialization. |
| GPU estimates | No summed multi-GPU capacity, bounded reclaim of observed loaded allocation, no local GPU sizing of remote daemon. |
| Hardware command lookup | Absolute known NVIDIA paths only, including WSL. No bare-command/PATH/current-directory fallback. |
| Repository automation | Old schedules and self-modifying jobs remain archived. Only read-only PR/manual Linux and Windows validation is active. No archive chunks are required. |

## Deliberate decisions

`bun test --only-failures` controls reporting, not selection; the workflow omits it for readable logs. Tool IDs are not function names. External image URLs are not fetched. Capabilities are not guessed solely from model names. A failed/truncated native stream must fail rather than be marked successful.

Tool payloads are held until `done` while text/reasoning remain incremental. Indexed object snapshots and indexed string deltas are supported; ambiguous unindexed fragments and conflicting identities fail. Forced `tool_choice` is rejected because this adapter cannot guarantee its semantics.

## Reproduce

At repository root: `bun install --frozen-lockfile` with the pinned Bun version. Then in `packages/opencode`:

```bash
bun run typecheck
bun test test/local --timeout 30000
bun test test/provider/provider.test.ts test/plugin/modal-models.test.ts --timeout 30000
bun run --conditions=browser src/index.ts local doctor --help
```

Inspect the `Local runtime validation` run associated with the reviewed HEAD. PR CI normally checks GitHub's synthetic merge commit; record both that SHA and the PR head/base. The workflow does not commit, push, deploy, upload diagnostic artifacts or run on a schedule.

## Remaining gates and limits

CI exercises mock HTTP/SDK contracts and a real CLI process, not a physical RTX 5070 or a real model generation. Before merge: independent re-audit, passing checks for the revised commit, owner activation of branch protection, and a Windows/Ollama/RTX 5070 smoke test.

The ruleset JSON in `.github/protect-dev.ruleset.json` is a proposal, not proof that protection is active. Confirm rules in GitHub Settings. It requires PRs and both platform checks without requiring another reviewer while the owner works alone.

VRAM/KV sizing is heuristic, not an architecture-general allocator or proof of GPU residency. `recommendedHistoryTokens` is diagnostic guidance, not a replacement agent compaction algorithm. The fork requests `truncate:false` and `shift:false`; daemon versions that ignore these fields are not thereby proven safe. No universal minimum compatible Ollama version or performance improvement is claimed. A missing cached-token counter is distinguishable from observed zero; compare equivalent cold/warm measurements and inspect the raw metrics. Direct llama.cpp integration, continuous GPU monitoring and a distributable release remain outside this milestone.
