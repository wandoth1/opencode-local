# Re-audit ledger

## Scope and history

- Original upstream baseline: `b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`.
- First independent audit examined `a3a05dd538d4bf84b7921c8464950a74622c394b`; it was static-only because the auditor had no Bun.
- Earlier archive-based hardening attempts failed and must not be counted as implemented fixes or successful validation.
- The replacement implementation is committed as ordinary source files. Review the current `feature/local-foundation` HEAD and PR #1; record exact SHAs, not just branch names.

## Corrections to inspect

| Audit area | Implementation / regression coverage |
| --- | --- |
| Project host leaks user credentials | Full-endpoint credential binding; separately trusted global config; malicious endpoint rejection before network access; provider removed on trust failure. |
| Context smaller than 4K inflated | Native maximum preserved, final override capped, output/history invariants, pathological tiny contexts tested. |
| Tool calls lost after first frame | Bounded ID/index accumulator; multiple/sparse/fragmented calls, repeated indexed object snapshots and independent unindexed calls tested. |
| EOF without native done | Protocol error; no invented successful stop and no execution of incomplete tools. |
| Doctor invents config | CLI obtains real project/global Config service values; pure report helper tests trust/flags/static models. |
| Empty benchmark reports success | Requires completed output; thinking counts for TTFT; empty/error/partial streams fail. |
| Dropped API options | top_k and max_completion_tokens mapped; unsupported tool choices/images rejected explicitly; omitted stream means non-streaming. |
| ReadableStream body ignored | Bounded request-body conversion and regression test. |
| Global cache/snapshot contamination | Removed process-global cache and latestSnapshot. |
| Secrets and redirects | Trusted closure, no embedded credentials/query, redirect:error, safe HTTP errors, allowlisted diagnostic serialization. |
| Multi-GPU/loaded VRAM | No summed GPU capacity; physical cap on reclaim; no local-GPU sizing for a remote daemon. |
| Repository artifacts/jobs | Removed 15 archive chunks; ignored retired paths; replaced active workflows with read-only Linux/Windows validation. |

## Deliberate differences from first audit suggestions

`bun test --only-failures` controls reporting, not which tests execute; removing it here is for readable audit logs. A truncated native stream must fail, not be labelled successful. Tool IDs are not function names. The adapter must not fetch arbitrary external image URLs. Missing capabilities must not be advertised solely from model-name heuristics.

## Evidence and gates

An isolated Node 22/TypeScript check exercised 54 local tests before publication. This is not a full Bun/OpenCode build, not the real AI SDK contract run and not GPU validation. Read GitHub Actions results for the current commit to establish full package typecheck, Bun tests, existing-provider regressions and CLI registration on Linux/Windows. Do not infer success from this document or from older green runs.

Before merge: independent adversarial re-audit, exact-HEAD CI, repository owner activation of branch protection and a real Windows/Ollama/RTX 5070 smoke test. Keep PR #1 in draft and do not publish an acceleration claim before measurements.

## Limits to challenge

Conventional KV math is not an architecture-general allocator. File size is only an approximation of GPU-resident weights/buffers. Concurrent server requests, external GPU usage and Ollama version/model templates affect behavior. Custom tool-fragment dialects without stable identity are ambiguous; indexed object snapshots and indexed string deltas are supported, not arbitrary cumulative-string protocols. No llama.cpp server integration or continuous VRAM manager is claimed.
