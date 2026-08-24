# PR review notes — scheduler branch

## What I checked

- Edge routing only fires declared edges; no invented wiring anywhere.
- Guards evaluate over port values, not prompt text. Good.

## Asks before approving

- Add a test for the cyclic-edge fuel path.
- Rename the emitter helper so it reads as a trace sink, not a logger.

## Verdict

Solid direction. Requesting changes for the two asks above, nothing
structural.
