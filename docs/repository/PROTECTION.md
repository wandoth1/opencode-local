# Repository protection

This is an unofficial OpenCode fork maintained by `wandoth1`. Changes to the local runtime belong on `feature/local-foundation` and are reviewed in PR #1 before merging into `dev`.

## Owner action required

The checked-in `.github/protect-dev.ruleset.json` is a proposal, not an activated rule. Committing JSON does not configure GitHub branch protection. The available connector can edit source, but cannot perform the required repository administration operation.

After the two validation jobs have passed, use repository **Settings > Rules > Rulesets > New ruleset > Import a ruleset**, select the JSON, review the target `dev`, and save it with enforcement **Active**. Alternatively, an authenticated repository administrator can use:

```bash
gh api --method POST repos/wandoth1/opencode-local/rulesets --input .github/protect-dev.ruleset.json
```

Review existing rulesets first; do not repeatedly POST and create duplicates.

The proposal blocks branch deletion and force pushes, requires a pull request, resolution of review conversations, and successful `local-runtime-linux` and `local-runtime-windows` checks on an up-to-date branch. It has no bypass actors. It requires zero approving reviews because a sole maintainer cannot approve their own PR; increase this to one when an independent collaborator with write access is available. The PR/check requirements still apply.

`CODEOWNERS` assigns this fork to `@wandoth1`; it does not itself activate protection. Leave PR #1 in draft until re-audit and Windows/RTX 5070 testing are complete.

## Actions

The only active workflow is read-only local-runtime validation for pull requests or manual invocation. No cron, workflow_run chain, repository secret, publish step or automatic commit is used. It runs on GitHub-hosted Linux and Windows runners. Checkout does not persist credentials. Prior upstream workflows are retained outside `.github/workflows` and must not be restored without reviewing their targets and permissions.

For public contributions, review GitHub's workflow-approval settings for outside collaborators. Do not use self-hosted GPU runners for untrusted pull requests.
