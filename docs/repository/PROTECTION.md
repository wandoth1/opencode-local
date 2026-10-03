# Activate protection for dev

The checked-in `.github/protect-dev.ruleset.json` is an importable proposal, not an active GitHub setting. The connector cannot perform repository-administration writes.

After the two CI jobs pass, the owner should open **Settings > Rules > Rulesets > New ruleset > Import a ruleset**, select the JSON and save it as **Active** for `dev`. Existing rulesets should be reviewed first to avoid duplicates.

It blocks deletion/force pushes, requires a PR and resolved review conversations, and requires `local-runtime-linux` and `local-runtime-windows` on an up-to-date branch, with no bypass actors. Zero required approvals avoids locking out a sole maintainer who cannot approve their own PR. Increase to one once an independent writer/reviewer joins. `CODEOWNERS` alone does not enforce any of these requirements.

The only active workflow validates committed code read-only, on a PR or explicit manual run. There is no schedule, publishing, automatic source edit or automatic commit. Do not restore archived upstream or hardening workflows. For public contributions, require approval of outside contributors' workflow runs and never expose a self-hosted GPU runner to untrusted PR code.

No application changes from PR #1 have been merged into `dev` by this repository setup.
