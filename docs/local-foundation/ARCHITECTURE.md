# Local-first foundation

This branch adds a local-runtime layer to OpenCode without replacing its mature UI, sessions, tools, MCP, skills, provider catalogue, or cloud backends.

The design borrows the useful boundary from `vercel-labs/fx`—agent, provider, transport—while keeping the implementation independent and TypeScript-native. No FX source code is copied.

## Runtime flow

```text
OpenCode agent / tools / sessions
             |
      provider configuration
             |
       Ollama integration
       |               |
 model discovery   native transport
 /api/tags         /api/chat (NDJSON)
 /api/show              |
 /api/ps           OpenAI SSE adapter
             \          /
              context budget
                    |
          NVIDIA telemetry / VRAM
                    |
              local model
```

## Main components

- `src/local/hardware.ts` reads conservative NVIDIA telemetry through `nvidia-smi`.
- `src/local/context-budget.ts` estimates model residency and KV-cache bytes per token from GGUF metadata.
- `src/local/ollama/client.ts` provides bounded native Ollama discovery, introspection, and benchmarking.
- `src/local/ollama/model.ts` maps native model metadata into OpenCode provider configuration.
- `src/local/ollama/transport.ts` translates OpenAI-compatible requests to `/api/chat` and converts Ollama NDJSON back to incremental OpenAI SSE. This preserves time-to-first-token and enables request-specific `num_ctx`.
- `src/local/ollama/integration.ts` injects the provider at runtime only when Ollama is reachable or explicitly configured.
- `src/plugin/ollama.ts` is the built-in plugin entry point.
- `opencode local doctor` exposes diagnostics and an optional benchmark.

## Safety and compatibility

- `dev` remains untouched; all development is isolated on `feature/local-foundation`.
- Existing providers and the default OpenCode request pipeline are unchanged.
- Automatic detection defaults to loopback only. Remote hosts must be explicitly configured.
- Native transport can be disabled with `OPENCODE_OLLAMA_NATIVE_TRANSPORT=0`.
- Local integration can be disabled with `OPENCODE_LOCAL_DISABLE=1` or `disabled_providers: ["ollama"]`.
- The transport sets `truncate: false`; OpenCode must compact context rather than silently losing system or tool history.
- Context estimates are conservative recommendations, not claims that every backend build or quantization will use identical memory.

## Context policy

The recommendation takes the minimum of model capability and estimated hardware capacity:

```text
currently free VRAM
- estimated quantized model residency
- runtime overhead
- safety reserve
= KV-cache budget
```

When architecture metadata is available, KV bytes per token are estimated as:

```text
2 (K + V)
* block count
* KV head count
* head dimension
* cache bytes per element
```

The result is rounded down to a stable context step. The agent-history recommendation follows the conservative FX-style principle of reserving output capacity and assigning only a fraction of the remaining window to durable history.

## Scope of this milestone

Implemented:

- automatic Ollama detection and model discovery;
- model capabilities and metadata mapping;
- request-specific native context control;
- streaming native transport;
- NVIDIA/VRAM diagnostics;
- adaptive context recommendation;
- short reproducible benchmark;
- unit tests and documentation.

Deferred deliberately:

- direct `llama.cpp-server` backend;
- AMD/Intel GPU telemetry;
- automatic runtime selection between Ollama and llama.cpp;
- UI panels beyond the CLI doctor command;
- empirical tuning from the target RTX 5070, which requires running the doctor command on the actual machine.
