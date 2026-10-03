# Running the experimental local branch

Use `feature/local-foundation`, not the upstream installer or npm package. This is a source-level experimental fork and is not a measured RTX 5070 performance release.

```bash
git clone --single-branch --branch feature/local-foundation https://github.com/wandoth1/opencode-local.git
cd opencode-local
bun install --frozen-lockfile
cd packages/opencode
bun run --conditions=browser src/index.ts local doctor --json
```

The repository pins Bun 1.3.14. The command loads the actual OpenCode global and project configuration. Standard OpenCode project configuration can contain executable tools/plugins: review untrusted repositories before opening them.

## Local Ollama

Start Ollama separately. Installed chat models are discovered on loopback. Missing capabilities are not guessed; older Ollama or custom models may need explicit `tool_call`, `reasoning` or `attachment` declarations under `provider.ollama.models`.

```powershell
$env:OPENCODE_OLLAMA_HOST = "http://127.0.0.1:11434"
bun run --conditions=browser src/index.ts local doctor --model "YOUR_INSTALLED_MODEL" --num-ctx 8192 --benchmark --output-tokens 96 --json > doctor.json
```

Replace `YOUR_INSTALLED_MODEL` with an actual installed tag. The benchmark loads the model and can use substantial VRAM. Do not publish private model names or system details without reviewing the report. No API keys, raw config, headers or generated sample text are included.

`--host`, `--model`, `--num-ctx`, `--benchmark`, `--output-tokens` and `--json` are supported. Context is capped at a known model maximum. A configuration limit is a request, not proof the allocation will fit the GPU. The reported CUDA banner is driver compatibility, not the installed CUDA toolkit.

## Remote and authenticated deployments

Use a trusted global user config, `OPENCODE_OLLAMA_HOST`/`OLLAMA_HOST`, or explicit `--host` for remote servers. Configure secrets only in the trusted user scope or `OPENCODE_OLLAMA_API_KEY`. Credentials are not transferred when a project/CLI changes to another endpoint, including another port or path on the same host. HTTP redirects are disabled.

Project API keys/headers and per-model endpoint/npm/fetch overrides are intentionally ignored by the built-in integration. Custom proxy headers must be in global user configuration. Use HTTPS for remote authenticated services; HTTP is suitable for trusted local loopback, not an untrusted network.

Set `OPENCODE_LOCAL_DISABLE=1` to opt out. `disabled_providers` and `enabled_providers` are respected. `OPENCODE_OLLAMA_AUTODETECT=0` disables discovery and requires manually configured models. `numCtx`, `keepAlive`, `discoveryTimeoutMs`, `nativeTransport` and capability overrides remain supported as safe runtime settings.

The client cannot inspect Ollama's server environment. KV estimation defaults to two bytes per element. `OPENCODE_OLLAMA_KV_BYTES_PER_ELEMENT` is an explicit estimation override only; it does not configure Ollama or prove its cache precision. Use measured server settings and allow for quantization block overhead.

## Verification

From `packages/opencode`:

```bash
bun run typecheck
bun test test/local --timeout 30000
bun test test/provider/provider.test.ts test/plugin/modal-models.test.ts --timeout 30000
```

Linux and Windows CI must pass on the exact revision being reviewed. Mock/SDK contract tests are not a physical RTX 5070 test. Before production use, perform an independent re-audit and compare native Ollama against this agent with the same installed model, quantization, context and prompt. Record cold/warm runs, load time, TTFT, prompt/generation tokens per second, VRAM and whether the server reports CPU offload.
