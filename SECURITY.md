# Security — OpenCode Local

This is an unofficial experimental fork, not a supported release of upstream OpenCode. Local-runtime changes require independent review and hardware validation before production use.

Do not attach API keys, environment dumps, authentication files or private source code to public issues. Use a minimal reproduction with synthetic credentials. Report vulnerabilities privately through GitHub's private vulnerability reporting feature when the repository owner has enabled it; otherwise contact the maintainer privately before disclosure.

Only configure remote Ollama endpoints in trusted user configuration, environment variables or an explicit CLI override. Do not treat local inference as a security sandbox: OpenCode can execute configured tools, commands and plugins. Opening or executing an untrusted repository requires reviewing its configuration and scripts.

The original MIT license and OpenCode attribution remain unchanged. Issues introduced by this fork belong to its maintainer, not automatically to the upstream team.
