# Paused upstream automation

The owner requested stopping repetitive GitHub Actions jobs. The scheduled upstream workflows are preserved here, outside `.github/workflows`, so they cannot launch automatically in this repository.

Paused workflows: `compliance-close` (every 30 minutes), `close-issues`, `close-prs`, `stats`, and `docs-update`. Some of these scripts target the upstream repository or depend on its infrastructure.

This change does not modify application source code or merge the local-foundation PR. Do not restore these workflows to `.github/workflows` without reviewing their targets, permissions, schedules, and credentials and obtaining the owner's approval. Keep them paused when synchronizing branches or importing upstream updates.
