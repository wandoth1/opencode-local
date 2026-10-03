# OpenCode Local runtime architecture

This is an unofficial experimental fork of `anomalyco/opencode`, maintained separately by `wandoth1`. The first hardware target is Windows and NVIDIA RTX 5070. FX is a conceptual reference for separation of agent, provider and transport, not an embedded Zig runtime. The original MIT license is unchanged.

## Boundaries

- `runtime.ts`: backend-neutral metadata and diagnostic types.
- `hardware.ts`: bounded NVIDIA telemetry collection; no CUDA/kernel changes.
- `context-budget.ts`: estimated memory/context budgets, not empirical GPU-fit guarantees.
- `ollama/client.ts`: native discovery and a small benchmark.
- `ollama/io.ts`: byte-bounded JSON/NDJSON with strict UTF-8 and cancellation.
- `ollama/model.ts`: reported capabilities and explicit user overrides, without guessing support from names.
- `ollama/integration.ts`: separately trusted global configuration, credential binding and in-memory provider construction.
- `ollama/transport.ts`: endpoint-bound OpenAI-compatible adapter to native Ollama chat.
- `doctor.ts` and the CLI: real user/project configuration, explicit flags and an allowlisted report.

The existing OpenCode agent/tool permission machinery is retained. Local inference does not sandbox a project's commands, plugins or configuration.

## Transport contract

Text and thinking are streamed incrementally with pull-based backpressure. Native tool calls are accumulated by ID/index and validated as JSON objects before being released at the native `done` frame. This intentionally delays tools, not text, to avoid executing partial calls. Unindexed calls are independent: identical unindexed calls cannot safely be deduplicated without an identity supplied by the backend.

Premature EOF, invalid UTF-8/JSON, unknown tools and length-truncated tool calls are errors, not successful completion. Cancellation releases the upstream reader. Native requests support `tool_choice` auto/none; required/named choices fail explicitly instead of being silently ignored. Images must be data URIs; the adapter never downloads external image URLs.

## Trust and credentials

Remote endpoints must originate from an explicit environment host, separately loaded global user configuration or a CLI override. Credentials are bound to the entire normalized endpoint, including port and path. Project credentials/headers and model-level network overrides are not inherited. Redirects and embedded URL credentials are rejected. The SDK receives a placeholder key; real credentials live in the endpoint-bound transport closure.

There is no global snapshot/cache shared between projects. Diagnostics serialize only selected fields and exclude raw config, headers, arbitrary model metadata and generated benchmark samples.

## Memory estimates

The conventional KV estimate uses layer count, KV heads, explicit key/value dimensions when available and bytes per element. Model size, runtime overhead and a safety reserve are also considered. Loaded memory is reclaimed only within physical limits on a single observed GPU. Multi-GPU allocations are not pooled without placement evidence. A remote endpoint is never sized using the client's GPU.

Unknown metadata lowers confidence. A context override cannot raise a declared native maximum. Output and history remain inside the final context. An estimate does not prove hardware residency, throughput or correctness of every model architecture. A direct llama.cpp provider, continuous monitoring and measured RTX 5070 tuning remain outside this milestone.

## Repository automation

Validation is read-only on committed source. Archive reconstruction, automatic source edits, automatic commits, upstream maintenance schedules and publishing are not part of this fork's CI. Old commits remain in Git history for accountability, but archive chunks are removed from the current tree.
