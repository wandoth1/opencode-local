#!/usr/bin/env python3
"""Wire the isolated local runtime into OpenCode's built-in plugin and CLI registries.

The script is intentionally narrow and idempotent. It fails loudly when the
expected upstream anchors are missing so a future upstream change cannot produce
an ambiguous partial edit.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> bool:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if new in text:
        return False
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one anchor in {path}, found {count}: {old!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")
    return True


def main() -> None:
    changed = []

    if replace_once(
        "packages/opencode/src/plugin/index.ts",
        'import { ModalPlugin } from "./modal/modal"\n',
        'import { ModalPlugin } from "./modal/modal"\nimport { OllamaPlugin } from "./ollama"\n',
    ):
        changed.append("packages/opencode/src/plugin/index.ts: import OllamaPlugin")

    if replace_once(
        "packages/opencode/src/plugin/index.ts",
        "    ModalPlugin,\n    GitlabAuthPlugin,\n",
        "    ModalPlugin,\n    OllamaPlugin,\n    GitlabAuthPlugin,\n",
    ):
        changed.append("packages/opencode/src/plugin/index.ts: register OllamaPlugin")

    if replace_once(
        "packages/opencode/src/index.ts",
        'import { ModelsCommand } from "./cli/cmd/models"\n',
        'import { ModelsCommand } from "./cli/cmd/models"\nimport { LocalCommand } from "./cli/cmd/local"\n',
    ):
        changed.append("packages/opencode/src/index.ts: import LocalCommand")

    if replace_once(
        "packages/opencode/src/index.ts",
        "  .command(ModelsCommand)\n  .command(StatsCommand)\n",
        "  .command(ModelsCommand)\n  .command(LocalCommand)\n  .command(StatsCommand)\n",
    ):
        changed.append("packages/opencode/src/index.ts: register LocalCommand")

    if changed:
        print("Applied local foundation wiring:")
        for item in changed:
            print(f"- {item}")
    else:
        print("Local foundation wiring already present.")


if __name__ == "__main__":
    main()
