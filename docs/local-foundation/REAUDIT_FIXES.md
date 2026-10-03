# Second re-audit: corrections and remaining verification

## Baseline and evidence

The physical re-audit examined `0b4b6fc76b1636760c9fa795f01e6490604adad6` and reported B1, H1-H3, M1-M8 and L1-L10. Its 84 local and 102 provider tests passed, but the real default-context agent failed. That previous green run does not validate these fixes.

The supplied ZIP contained the report and logs, not the original `repro`, `harness`, `real` or `sandbox` directories. The new regression tests are independently authored from the reported scenarios. They must not be described as re-execution of the auditor's original reproductions or as fresh RTX 5070 measurements.

## Changes to examine

| Finding | Implementation |
| --- | --- |
| B1 unusable 4K default | Default 32K capped at native maximum. Free VRAM is advisory and never silently shrinks the agent window. Explicit/Modelfile requests are preserved. A second consecutive Ollama overflow after compaction stops with an actionable ContextOverflowError instead of compacting forever. |
| H1 error information lost | Bounded canonical classification preserves core-recognizable context overflow, missing models, memory, auth and tool incompatibility without exposing arbitrary daemon bodies. Tool-incompatible models fail before native generation. |
| H2 hidden 300s deadline | Removed implicit generation/benchmark totals, preserved optional explicit totals and core timeout controls, TimeoutError distinct from AbortError. Real HTTP/wall-time regression runs for 305 seconds. |
| H3 disable/env diversion | Disable removes and blacklists Ollama. Generic OLLAMA_HOST cannot move an environment key. Node source launcher disables Bun .env loading before imports; raw direct Bun invocation is not the supported secure launch path. |
| M1 host parsing | Bare-host 11434, explicit HTTP(S) ports, wildcard connectable addresses, IPv6 cases; invalid credentials/query/fragment rejected. |
| M2 stale doctor models | Per-config nonserialized original-provider provenance; strict live diagnostic discovery, no stale static fallback after network failure. |
| M3 misleading KV confidence | Unknown for hybrid/sliding-window/missing-KV metadata; conventional estimate at most medium confidence. No claim of calibration. |
| M4 failed show downgrade | Failed introspection excludes model and produces warning instead of fabricating capabilities. |
| M5 user daemon policy | No default keep_alive override; Modelfile num_ctx treated as requested allocation, separate from known model maximum. |
| M6 manual 32K cap | Explicitly selected models use live /api/show metadata even without automatic listing. |
| M7 false prefill speed | Missing cache counter means unknown prefill throughput; no invented zero-cache assumption. |
| M8 conflicting full tool calls | Complete differing objects on same identity rejected; recognized names cannot silently change to another function. |
| L1-L7 | Version/terminal controls sanitized, CUDA UMD banner recognized, safe actionable CLI errors, explicit benchmark selection, global-host env-key binding, explicit size-limit message, linear fragment accumulation. |
| L8 installer confusion | Root install script no longer downloads upstream binaries. English/Spanish guides identify the fork and safe source launcher. Historical translated upstream documents are not comprehensively rewritten. |
| L9 maintainability | Existing code conventions and duplicated older fixtures still need cleanup; this is not claimed fully resolved by functional corrections. |
| L10 protection | Owner activated ruleset 24417142 after the earlier report snapshot. Administrative state must be queried live, not inferred from an old document. Retired YAML remains archived; registry cleanup requires administrative access. |

## Tests and acceptance

Read current CI rather than assuming a count or result from this file. New `reaudit-regression.test.ts`, `reaudit-cli.test.ts` and `long-stream.test.ts` are added. The six original context tests are retained but policy expectations deliberately change from forced 4K/high-confidence allocation to viable-default/advisory memory behavior. Other original tests must still pass; no skips or permissive CI are added.

The permanent CI remains read-only with no schedule, automated commits or deployments. Test source is ordinary reviewed text, never reconstructed archives. The long-stream test consumes about five minutes per platform intentionally; it is bounded, not a recurring job.

Before merge, repeat real E5 with the supported Node launcher and no context override, then with busy/idle GPU. Independently test error classification, explicit timeout handling and disabled-provider/.env attacks through the whole core. Keep PR #1 in draft.

## Limits not solved by this patch

32K is a practical default, not a tokenizer-based admission guarantee for arbitrary tools/plugins/history. Deliberately configured smaller windows can still be unusable and large allocations can offload/fail. KV is not calibrated against actual /api/ps deltas; unknown architectures remain unknown. Client environment variables do not prove daemon settings. No multi-GPU placement optimizer, llama.cpp backend, continuous VRAM manager, fresh physical benchmark, packaged binary or speedup claim is delivered.

The agent is not a sandbox. External plugins and other inherited provider configuration can execute or send data with user privileges. A plugin cannot sanitize environment variables already loaded by an unsafe parent; use the Node launcher from a trusted checkout with trusted executable/configuration.
