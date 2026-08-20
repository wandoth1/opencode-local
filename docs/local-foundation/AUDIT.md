# Independent audit notes

## Baseline

- Upstream repository: `anomalyco/opencode`
- Upstream branch: `dev`
- Baseline commit: `b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`
- Working branch: `feature/local-foundation`
- Review surface: draft pull request `#1`

## Reproducible verification

From the repository root:

```bash
bun install --frozen-lockfile
cd packages/opencode
bun run typecheck
bun test test/local --timeout 30000 --only-failures
```

The pull-request workflow runs the same locked install, formatting check, package typecheck, and focused test suite directly against the committed implementation. No generated wiring or bootstrap step is required.

## Audit priorities

An independent reviewer should verify:

1. OpenCode provider initialization still works when Ollama is absent.
2. The built-in plugin mutates only the in-memory parsed configuration.
3. Automatic network access is loopback-only unless the user explicitly supplies a host.
4. Remote API keys are not printed, persisted by this implementation, or included in diagnostic JSON.
5. OpenAI-to-Ollama message conversion preserves system, user, assistant, tool-call, and tool-result semantics.
6. NDJSON-to-SSE conversion streams incrementally rather than buffering the full response.
7. Tool-call argument encoding remains valid across fragmented and non-fragmented responses.
8. Cancellation and abort signals propagate through the custom fetch.
9. Context sizing cannot exceed the model-declared maximum except through an explicit user override.
10. Static `provider.ollama.models` configuration still overrides auto-discovered entries.
11. Existing providers, model transforms, tests, and CLI commands have no behavior change.
12. The implementation contains no copied FX source and introduces no Apache-2.0 licensing obligation.

## Known limitations to challenge

- Older Ollama releases that return no capability list fall back to conservative model-name hints; unusual custom models may still need explicit capability overrides.
- VRAM estimation assumes a conventional quantized model layout and a two-byte KV cache unless metadata says otherwise.
- Multi-GPU memory is aggregated even though Ollama placement may not use every GPU equally.
- The first milestone does not monitor VRAM continuously during a long agent session.
- Native transport currently ignores OpenAI `tool_choice`; it preserves tools and lets Ollama/model selection decide.
- Remote Ollama deployments behind unusual authentication proxies need explicit testing.
