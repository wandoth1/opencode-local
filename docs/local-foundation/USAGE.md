# Running the experimental local branch

Use `feature/local-foundation`, not an upstream installer/npm package. This source-level milestone is not a measured RTX 5070 performance release.

## Install the agent

At the repository root, using Bun 1.3.14:

```bash
git clone --single-branch --branch feature/local-foundation https://github.com/wandoth1/opencode-local.git
cd opencode-local
bun install --frozen-lockfile --filter './' --filter './packages/opencode'
cd packages/opencode
bun run --conditions=browser src/index.ts local doctor --json
```

Both filters matter: the root provides development types and SDK links needed by the core source; the agent filter includes its dependency graph. This avoids unrelated hosted console/stats/enterprise applications whose upstream SolidStart preview URL returned 404. The lockfile and pinned dependencies are unchanged. An unfiltered install or full upstream web build may still encounter that external dependency. This milestone validates the CLI agent, not all products in the monorepo.

Start Ollama separately. The CLI loads actual global and project configuration. Review untrusted repositories before opening them: standard OpenCode configuration can load executable tools/plugins.

## Diagnose and benchmark

Installed chat models are discovered on loopback. Missing capabilities are not guessed from names; older/custom models may require `tool_call`, `reasoning` or `attachment` overrides. Persisted model `limit` configuration requires both `context` and `output` fields.

From `packages/opencode` in PowerShell:

```powershell
$env:OPENCODE_OLLAMA_HOST = "http://127.0.0.1:11434"
bun run --conditions=browser src/index.ts local doctor --model "YOUR_INSTALLED_MODEL" --num-ctx 8192 --benchmark --output-tokens 96 --json > doctor.json
```

Use an actual installed tag. `--host`, `--model`, `--num-ctx`, `--benchmark`, `--output-tokens`, and `--json` are supported. The benchmark loads a model and consumes VRAM; without `--benchmark`, doctor does not request a generation. Public diagnostics omit API keys, headers, arbitrary config/raw metadata and generated sample text, but still contain model names and hardware details. Review them before sharing.

Context is capped at the known model maximum; a user override does not prove GPU fit. The CUDA banner reports driver compatibility, not an installed toolkit. NVIDIA lookup uses known absolute Windows/Linux/WSL locations, never a bare command in the current project or PATH. A nonstandard driver installation may yield unavailable telemetry.

TTFT includes thinking. If Ollama reports `prompt_eval_cached_count`, prefill throughput uses uncached tokens; a completely cached prompt cannot establish prefill speed. On older daemons without this counter, compare equivalent cold/warm runs rather than treating reported prefill throughput as a hardware guarantee. Observed zero load duration is retained. Empty/incomplete generation is an error.

## Configuration and trust

Remote endpoints require trusted global user config, `OPENCODE_OLLAMA_HOST`/`OLLAMA_HOST`, or an explicit `--host`. Secrets must be in the trusted user scope or `OPENCODE_OLLAMA_API_KEY`. Credentials do not transfer when project/CLI config changes the normalized endpoint, including path or port. Redirects are disabled. Use HTTPS for authenticated remote services.

Project API keys/headers and per-model endpoint/npm/fetch overrides are intentionally ignored. Proxy headers belong in global configuration. `OPENCODE_LOCAL_DISABLE=1`, `disabled_providers`, and `enabled_providers` are respected. `OPENCODE_OLLAMA_AUTODETECT=0` requires manual model configuration. Safe settings include `numCtx`, `keepAlive`, `discoveryTimeoutMs`, `nativeTransport`, and capability overrides.

KV estimation defaults to two bytes per element. `OPENCODE_OLLAMA_KV_BYTES_PER_ELEMENT` changes the estimate only: the client cannot inspect or set the daemon's cache precision. Allow for block overhead and validate real memory use. Native mode applies `num_ctx`; compatibility mode does not promise native-only controls. `truncate:false` and `shift:false` are daemon-version-dependent, not a client tokenizer or a guarantee for older Ollama versions.

## Verification and remaining gates

From `packages/opencode`:

```bash
bun run typecheck
bun test test/local --timeout 30000
bun test test/provider/provider.test.ts test/plugin/modal-models.test.ts --timeout 30000
bun run --conditions=browser src/index.ts local doctor --help
```

The read-only PR/manual workflow runs these checks on Linux and Windows. PR runs normally test a synthetic merge commit; record it and the head/base SHAs. There are no scheduled runs, automatic commits or deployments. Mock/SDK and real-CLI-with-mock-server tests do not replace a physical RTX 5070/Ollama/model test. Before merge, require an independent re-audit, activated branch protection and real-hardware smoke testing with equivalent model, quantization, context and prompts. No binary release or universal speedup is claimed.
