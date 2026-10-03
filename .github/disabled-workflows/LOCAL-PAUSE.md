# Local hardening automation paused

The owner requested stopping repetitive Actions jobs. Both temporary hardening workflows are preserved outside `.github/workflows` so neither push nor pull-request events can run them.

`local-foundation-verify.yml` currently materializes an archive, edits files, and pushes commits; despite its filename, it is not a read-only verification workflow. It must not be restored as the permanent CI pipeline. Resume development with direct, reviewable source changes and a read-only validation workflow only after the owner requests resuming.

No application source, tests, archive chunks, PR state, or commits have been deleted by this pause. Scheduled upstream workflows are separately paused on `dev`, the default branch. Do not reintroduce their automatic triggers when synchronizing branches.
