# Independent re-audit ledger

## Scope and history

Imported upstream: `b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`. The first independent audit examined `a3a05dd538d4bf84b7921c8464950a74622c394b` statically; it did not run Bun. Subsequent failed archive-based attempts are not evidence of fixes. Current changes are direct source on `feature/local-foundation`. Record the exact HEAD, base and CI synthetic merge commit before reviewing.

## Corrective coverage

| Area | Implementation and tests to challenge |
| --- | --- |
| Credential diversion | Separately loaded global config, complete-endpoint credential binding, rejection of unauthorized remote hosts, removal of unsafe provider on initialization failure. |
| Small context maxima | Native maximum preserved, overrides capped, bounded output/history, tiny/pathological declarations tested. |
| Lost tool calls | Bounded ID/index accumulator, multiple/fragmented/sparse calls, late names, repeated indexed object snapshots and conflicting identities. Tools released only after valid completion. |
| Premature EOF | Protocol error, not invented success or execution of incomplete tools. |
| Doctor configuration | Real Config service and subprocess CLI test using global credential plus project model limits against a loopback HTTP fixture. |
| False benchmark success | Completed nonempty output required; thinking contributes to TTFT, cache-aware prefill and zero load duration tested. |
| Lost request options | top_k and max_completion_tokens mapped; forced tool choices and external images explicitly rejected; omitted stream is non-streaming. |
| Cancellation hangs | No Request.clone/unused tee; source cancellation not awaited indefinitely; abort discards already buffered NDJSON frames. |
| Global state | Removed module-global discovery cache and latestSnapshot. |
| Secrets/errors | Redirects disabled, embedded URL credentials rejected, header/read/connection errors sanitized, diagnostics use an allowlist. |
| Memory telemetry | No summed multi-GPU capacity, bounded loaded-allocation reclaim, no client GPU sizing for a remote daemon. |
| NVIDIA executable | Known absolute Windows/Linux/WSL paths; no PATH/current-directory fallback. |
| Repository automation | Retired schedules/self-modifying jobs archived, chunks removed/ignored; only read-only PR/manual validation is active. |

## Reproduce exactly

Use pinned Bun 1.3.14 and a disposable clone without real credentials. Review install scripts first. At the repository root:

```bash
bun install --frozen-lockfile --filter './' --filter './packages/opencode'
git diff --exit-code -- bun.lock
cd packages/opencode
bun run typecheck
bun test test/local --timeout 30000
bun test test/provider/provider.test.ts test/plugin/modal-models.test.ts --timeout 30000
bun run --conditions=browser src/index.ts local doctor --help
```

The two filters install root development tooling and the agent dependency graph. Agent-only installation omits root type/SDK links used by core; unfiltered installation depends on an unavailable SolidStart preview tarball for hosted applications. Neither package versions nor the lockfile are changed to conceal this. This CI scope is the CLI agent, not the entire upstream monorepo/web products.

Inspect the `Local runtime validation` run tied to the reviewed head and record the actual tested merge SHA. Tests/typecheck must run, not merely be skipped after failed install. The workflow has no schedule, commits, pushes, deploys or diagnostic-artifact upload. It checks that the lockfile stays unchanged. Formatting validation and full distributable builds are not implied by these checks.

## Deliberate choices and limitations

`bun test --only-failures` controls output, not test selection. Tool IDs are not names. Truncated streams fail instead of emitting successful stop. External images are not fetched. Missing capabilities are not guessed from a model's name.

Text/reasoning stream immediately; tools are held until done. Indexed object snapshots and indexed string deltas are supported, not arbitrary ambiguous cumulative strings. Forced tool_choice is rejected rather than silently ignored.

VRAM/KV math is heuristic, not an architecture-general allocator or GPU residency guarantee. Concurrent daemon requests, other GPU workloads, hybrid/MLA/MoE architectures and model templates need real testing. `recommendedHistoryTokens` is diagnostic guidance, not a replacement compaction algorithm. `truncate:false` and `shift:false` are version-dependent requests; old daemons may ignore them. Cache counters, when absent, cannot establish cache-independent prefill speed. No minimum universally compatible Ollama version or acceleration figure is claimed.

Before merge: independent adversarial re-audit, green checks for the revised commit, owner activation of branch protection and a real Windows/Ollama/RTX 5070 smoke test. `.github/protect-dev.ruleset.json` is a proposal, not proof of active protection. Direct llama.cpp integration, continuous GPU monitoring and distributable releases remain outside this milestone. Keep PR #1 in draft until those review gates are satisfied.
