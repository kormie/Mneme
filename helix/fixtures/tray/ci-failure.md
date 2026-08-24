# CI failure — helix job flake

## What happened

- The typecheck job failed once on a cold cache and passed on rerun.
- Root cause was a stale dependency restore, not the code under test.

## Follow-up

- Pin the cache to the lockfile hash so cold starts stay reproducible.
- Write the rerun policy into the team runbook so nobody guesses.
