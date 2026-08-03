# Release Slot deployment contract

DEPLOY-01 applies to a candidate rollout after healthy v1 preflight.

- Capture the raw v1 artifact and configuration SHA-256 identities before replacement.
- Replace the slot with the declared v2 artifact and configuration.
- Treat v2's declared failed health result as a failed candidate verification.
- After that failure, rollback must restore the exact pre-rollout artifact and configuration identities.
- The declared health verification must report ready after rollback.
- Evidence must include pre-rollout, candidate, and post-rollback identities and health results.

The rehearsal uses only an isolated in-memory slot. It never deploys to or
changes production or shared infrastructure.
