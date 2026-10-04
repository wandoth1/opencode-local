# Running OpenCode Local from reviewed source

This is an unofficial experimental OpenCode fork. Use this repository's default branch `dev` or a release tag, not an upstream installer. The RTX 5070 is the target, not a demonstrated acceleration claim. See [the second-audit correction ledger](REAUDIT_FIXES.md).

## Install and launch

Use Node 22 or newer and pinned Bun 1.3.14. Review install scripts before installing into a trusted checkout.

```bash
git clone https://github.com/wandoth1/opencode-local.git
cd opencode-local
bun install --frozen-lockfile --filter './' --filter './packages/opencode'
node scripts/opencode-local.mjs local doctor --json
```

**Use the Node launcher, not `bun run src/index.ts`, to open projects.** It starts Bun with `--no-env-file` and a known configuration/preload. A direct Bun source invocation can load the current project's `.env` before application code runs; a plugin cannot recover the original provenance of those variables. Do not start this launcher with a Bun parent either. `OPENCODE_BUN` may point to the trusted absolute Bun executable. Keep the checkout and executable under your control. This is not a sandbox: project tools, plugins and other upstream providers remain executable/trusted code.

To work on another directory, retain that directory as the working directory and call the launcher by absolute path:

```powershell
Set-Location C:\YourProject
node D:\githubs\opencode-local\scripts\opencode-local.mjs
```

Both installation filters are intentional: root tooling/types plus the CLI agent dependency graph. Hosted upstream web applications are not this milestone. Their preview tarballs can be unavailable; filtered installation does not modify package versions or the lockfile. It is not a whole-monorepo build.

## Low-prompt mode

Skills discovered from other tools' folders are listed in every request's system prompt. With many of them the fixed prompt grows large, and a model that is partly offloaded to CPU spends most of a cold turn just reading it. Start the launcher with `--low` as its **first** argument to leave those skills out:

```powershell
node D:\githubs\opencode-local\scripts\opencode-local.mjs --low
node D:\githubs\opencode-local\scripts\opencode-local.mjs --low run --model ollama/YOUR_MODEL "your prompt"
```

`OPENCODE_LOCAL_LOW=1` does the same without the argument. The switch is consumed by the launcher; `--low` anywhere else is passed to the agent unchanged. It sets `OPENCODE_DISABLE_EXTERNAL_SKILLS`, so skills under `~/.claude/skills` and `~/.agents/skills` are not loaded, and neither are a project's own `.claude/skills` and `.agents/skills` (from the working directory up to the workspace root). Skills in OpenCode's own locations still load, among them `~/.config/opencode/skills`, a project's `.opencode/skills`, and `skills.paths` in configuration: keep a short curated set there. Slash commands that come from the dropped skills are not available either, and their folders are no longer pre-approved for reading. Tools, agents and instructions such as `CLAUDE.md` are unchanged.

Measured on the reference machine (RTX 5070 12 GB, Ollama 0.32.14, an owner profile with 55 external skills, 32K context, one run each, not a benchmark):

| | Normal | `--low` |
| --- | --- | --- |
| Agent request size | about 17,950 tokens | about 7,360 tokens |
| `qwen3.8:27b` (17.5 GiB loaded, 43% on GPU): cold prompt processing | 132 s | 21 s |
| Same model: time to first token of the agent turn, cold | 148 s | 38 s |
| Same model: time to first token, new session right after | 59 s | 2.6 s |

Generation speed is not changed by the switch (about 5-7 tokens per second for that model in both modes), and a profile with few external skills gains little.

## Context policy

Without an explicit allocation or Modelfile `num_ctx`, the agent defaults to **32,768 tokens**, capped at the known model maximum. Transient free VRAM does not reduce this to 4K. Explicit small allocations and small native maxima are preserved, with warnings; they may be insufficient even for system instructions and tool schemas.

Precedence: CLI `--num-ctx` for doctor, provider `numCtx`, `OPENCODE_OLLAMA_NUM_CTX`, manual model `limit.context`, Modelfile `num_ctx`, then the 32K default. Persisted `limit` objects require both `context` and `output`. The current implementation does not tokenize every complete agent request or guarantee that 32K accommodates arbitrary tools, plugins or conversation history. Overflow is returned in a canonical form recognized by the core; raise context within the model maximum or reduce workload when initial system/tools already overflow.

VRAM/KV figures are advisory. Unknown/hybrid/sliding-window architectures produce unknown KV values and low confidence, not a conventional formula labeled high confidence. Conventional estimates have at most medium confidence. `OPENCODE_OLLAMA_KV_BYTES_PER_ELEMENT` changes an explicit estimate only; a client-side `OLLAMA_KV_CACHE_TYPE` is not evidence of how an already-running daemon was configured. No runtime calibration or full-GPU residency guarantee is claimed.

## Diagnose and benchmark

Start Ollama separately. Doctor refreshes live endpoint information and fails rather than listing stale models when an override is unreachable. Failed `/api/show` introspection omits the affected model and reports a warning. Manual models also require live `/api/show`; `autoDiscover:false` disables listing, not introspection.

```powershell
node scripts/opencode-local.mjs local doctor --json
node scripts/opencode-local.mjs local doctor --model "YOUR_INSTALLED_MODEL" --benchmark --output-tokens 96 --json
```

A benchmark requires `--model` or an explicit `ollama/…` model in configuration. It never loads the alphabetically first model implicitly. `--host`, `--num-ctx`, `--output-tokens`, `--benchmark-timeout-ms` and `--json` are supported. The optional benchmark deadline is milliseconds; zero disables it. Without a benchmark, doctor requests metadata, not a generation.

TTFT includes reasoning. Prefill throughput is unknown when the daemon omits a cache counter (including the reviewed Ollama 0.32.14 responses); unknown cache use is not treated as zero. Output throughput remains based on daemon counters. Empty/incomplete output fails. Review diagnostic JSON before sharing: credentials and samples are excluded, but endpoint, model names and hardware remain visible.

## Endpoints, secrets and timeouts

Bare hostnames default to port 11434; explicit HTTP/HTTPS URLs retain standard 80/443 defaults. Unspecified bind addresses `0.0.0.0` and `::` become loopback destinations. Remote endpoints require global user configuration, trusted shell environment or an explicit CLI override. Use HTTPS for authenticated remote services.

Credentials are bound to the complete normalized endpoint, including port and path. `OPENCODE_OLLAMA_API_KEY` binds to `OPENCODE_OLLAMA_HOST` when explicitly set, otherwise the global endpoint or default loopback. `OLLAMA_HOST` alone cannot redirect a profile key. Project keys/headers and per-model endpoint/npm/fetch overrides are not copied. Redirects are disabled. `OPENCODE_LOCAL_DISABLE=1` removes and blacklists Ollama instead of returning to the raw merged upstream provider. Disabling all built-in plugins or loading arbitrary external plugins is outside that guarantee.

No hidden 300-second total generation deadline is imposed. Existing `provider.ollama.options.timeout`, `headerTimeout` and `chunkTimeout` controls are preserved for the core. An optional explicit `generationTimeoutMs` (or `OPENCODE_OLLAMA_GENERATION_TIMEOUT_MS`) sets a total limit; zero/false means none. Configured timeouts remain `TimeoutError`, distinct from user cancellation. An expired `generationTimeoutMs`, or a provider `timeout` that expires through the native transport, fails the turn once; it is not retried, because the same deadline would expire again. The error names `generationTimeoutMs` only when that limit fired. A `headerTimeout` surfaces as the core's own header-timeout error rather than as a cancellation. Choose a suitable operational timeout for your workload. Benchmark uses its optional CLI/total limit, not the core's stream inactivity wrapper.

`keep_alive` is omitted unless `keepAlive` or `OPENCODE_OLLAMA_KEEP_ALIVE` explicitly overrides it, preserving the daemon's own policy. Native mode sends `num_ctx`, `truncate:false` and `shift:false`; old daemon behavior may differ. Compatibility mode does not guarantee these native-only controls. Models without tools fail clearly before a native tool-generation request rather than pretending to be coding agents.

Error bodies are read with bounded size/time and classified into safe known errors; arbitrary server text is not echoed. Base64 data images are supported, external URLs are not fetched. The 16 MiB JSON and 2 MiB frame limits remain deliberate resource bounds; split/reduce large attachments.

## Verification

From `packages/opencode`:

```bash
bun run typecheck
bun test test/local --timeout 30000
bun test test/provider/provider.test.ts test/plugin/modal-models.test.ts --timeout 30000
```

The local suite includes a real-wall-time **305-second loopback HTTP stream**, so it intentionally takes over five minutes. It also starts the actual CLI through the Node launcher against disposable daemon fixtures, exercising project `.env`, disabled-provider credential isolation, dead-host diagnostics and a file-read tool round trip. These are not physical GPU/model tests.

Require exact-revision green CI and independent review, then repeat the auditor's real default-context run with the RTX 5070 both idle and busy. Compare against the same model/quantization/context baseline before claiming acceleration. PR #1 remains draft; no merge or binary release is implied.
