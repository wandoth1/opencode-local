# Independent re-audit ledger

## Revision history

Imported upstream: `b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`. The first static audit examined `a3a05dd538d4bf84b7921c8464950a74622c394b`. The second audit ran the real agent on Windows/Ollama/RTX 5070 against `0b4b6fc76b1636760c9fa795f01e6490604adad6`. Although that revision passed 84 local tests and 102 provider tests, the physical audit found material defects. Those green results are not evidence that the current corrections work.

The failed archive-based attempts are historical failures, not implemented fixes. All current corrections are ordinary source files on `feature/local-foundation`. Record the exact HEAD, base and actual CI checkout before reviewing. PR #1 remains draft and must not be merged on the strength of an old report.

## Current correction ledger

Read [REAUDIT_FIXES.md](REAUDIT_FIXES.md) for the second audit's B1, H1-H3, M1-M8 and lower-priority findings. Review the implementation, not just that table. Important acceptance boundaries:

- The default agent context is 16K capped at the native model maximum, not a transient-VRAM-driven 4K allocation. Explicit small windows remain small and may be unusable. This is not tokenizer-based admission control.
- Error bodies are bounded and classified into canonical messages. Test the real AI SDK error and `ProviderError.parseAPICallError`, not merely the regular expression, to establish context-overflow propagation.
- There is no hidden 300-second total generation timeout. Explicit timeouts remain distinguishable from user cancellation. The long-stream test uses a real loopback HTTP stream for 305 seconds.
- Disabling Ollama removes and blacklists its raw provider. The supported source launcher is Node, which starts Bun without project `.env` loading and with an explicit trusted preload/configuration. Direct Bun source execution is not the safe entrypoint.
- The launcher derives both cwd and PWD from the actual working directory instead of inheriting stale PWD. The read-tool regression uses the absolute path required by the tool schema and verifies a random marker returned by actual file execution.
- Doctor uses pre-hook provider provenance and strict live discovery. It cannot report another daemon's models as proof that a closed override endpoint is alive.
- Failed model introspection omits models instead of guessing capabilities. Manual selections also require live introspection. No default keep-alive override is injected.
- Unknown/hybrid/sliding-window architectures have unknown KV estimates and low confidence. Conventional formulas have at most medium confidence. No runtime allocator calibration is claimed.
- Text/reasoning stream immediately. Tool calls are withheld until valid completion; conflicting full arguments or identities fail rather than silently merge.

The supplied audit ZIP did not include the original `repro`, `harness`, `real` and `sandbox` directories. New tests are independent reproductions of the report's scenarios, not execution of the auditor's missing scripts or fresh GPU measurements.

## Reproduce

Use a disposable trusted checkout without real credentials. Review install scripts first. Install Bun 1.3.14 and Node 22 or newer. At the repository root:

```bash
bun install --frozen-lockfile --filter './' --filter './packages/opencode'
git diff --exit-code -- bun.lock
node scripts/opencode-local.mjs local doctor --help
cd packages/opencode
bun run typecheck
bun test test/local --timeout 30000
bun test test/provider/provider.test.ts test/plugin/modal-models.test.ts --timeout 30000
```

The local suite deliberately takes more than five minutes due to the 305-second stream. It includes actual subprocess CLI/Node-launcher tests with isolated profiles and loopback fixtures: help, dead endpoint, untrusted `.env`/bunfig, disabled-provider credentials, and a full file-read tool turn. The SDK contract tests also use the real pinned SDK.

The two installation filters select root tooling/types and the CLI agent dependency graph. An earlier unfiltered install hit a temporary 404 for a hosted application's preview tarball; availability can change. This scope does not validate hosted web applications or the entire upstream monorepo. Do not change the lockfile, disable tests or suppress failures to obtain a green run.

Inspect the `Local runtime validation` run tied to the reviewed revision. Record both the PR head SHA and synthetic merge SHA actually checked out; the latter is not a merge of PR #1. Require both Linux and Windows jobs to finish successfully, with installation, typecheck, local tests, provider tests and CLI checks executed rather than skipped. A formatting check and distributable build are not implied by these checks.

## Administrative state and merge gates

The owner activated the `Protect dev - OpenCode Local` ruleset (ID `24417142`) after the audit's administrative snapshot. Verify current effective rules in GitHub, not an old document or the JSON proposal. Keep `dev` protected; do not modify its protection, force-push or merge this PR during an audit.

The active verification workflow is read-only with no schedule, commits, pushes or deployment. Retired source-writing/scheduled workflows stay archived. Historical workflow registry entries are not active source and registry cleanup requires administrative access.

Before merge: independent adversarial review, green revised-commit checks, and a repeated physical default-context agent test with Ollama and the RTX 5070. Do not load arbitrary large models, close unrelated applications or change daemon settings without the owner's consent.

## Deliberate limits

A 16K default is not enough for every prompt/toolset/history. Modelfile or explicit allocations can still exceed available memory or be too small for the agent. Unknown architectures stay unknown; /api/ps measurements are not converted into a universal KV model. The client environment does not prove the daemon's cache settings. Prefill throughput is unknown when cache counters are missing.

Native `truncate:false`/`shift:false` behavior is version dependent. The 16 MiB request and 2 MiB frame bounds are intentional; external images are not fetched. Forced tool choice is rejected. Tool IDs are not names; premature EOF never becomes a successful stop. There is no general sandbox for project tools, plugins or other inherited providers.

No fresh physical RTX 5070 benchmark, acceleration claim, direct llama.cpp backend, continuous VRAM controller or packaged release is delivered by this corrective milestone. Historical translated upstream READMEs and some older duplicated fixtures still need separate cleanup.
