# Using the local runtime

## Zero-configuration Ollama

Start Ollama normally. OpenCode probes the loopback server and adds installed models under the `ollama` provider:

```text
ollama/<model-name>
```

No fake model catalogue entry or API key is required. The compatibility key `ollama` is supplied internally because Ollama ignores it.

## Diagnostics

```powershell
opencode local doctor
```

Machine-readable output:

```powershell
opencode local doctor --json
```

Run a short benchmark against a selected model:

```powershell
opencode local doctor --model qwen3-coder:8b --benchmark
```

The benchmark reports time to first token, prompt processing speed, output speed, load duration, and the context used.

## Useful environment variables

```powershell
$env:OPENCODE_OLLAMA_HOST = "http://127.0.0.1:11434"
$env:OPENCODE_OLLAMA_NUM_CTX = "24576"
$env:OPENCODE_OLLAMA_KEEP_ALIVE = "10m"
```

Disable the native request adapter and fall back to Ollama's `/v1` compatibility endpoint:

```powershell
$env:OPENCODE_OLLAMA_NATIVE_TRANSPORT = "0"
```

Disable automatic detection:

```powershell
$env:OPENCODE_OLLAMA_AUTODETECT = "0"
```

Disable all local-runtime integration:

```powershell
$env:OPENCODE_LOCAL_DISABLE = "1"
```

## Explicit configuration

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "options": {
        "host": "http://127.0.0.1:11434",
        "numCtx": 24576,
        "keepAlive": "10m",
        "nativeTransport": true,
        "autoDiscover": true
      }
    }
  }
}
```

Advanced capability overrides are available for older Ollama versions that do not report model capabilities reliably:

```jsonc
{
  "provider": {
    "ollama": {
      "options": {
        "forceToolCall": true,
        "forceReasoning": false,
        "forceVision": false
      }
    }
  }
}
```

## First RTX 5070 validation

Run:

```powershell
opencode local doctor --model <installed-model> --benchmark --json > opencode-local-doctor.json
```

The report contains no API credentials. Review it before sharing because GPU, CPU, driver, model names, and machine capacity are included.
