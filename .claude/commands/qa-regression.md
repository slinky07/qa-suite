# Regression QA

Use the `qa-suite` skill.

Orchestrate `smoke-qa` first. If smoke reports `No-Go` or `Blocked`, stop.
After a Go-family smoke verdict, run `regression-qa`. If the host supports
subagents/delegation, dispatch each lane as a separate independent QA
subagent.

Freeze smoke and regression in one dispatch manifest before smoke. Every
executed lane writes its exact report and digest-bound proposal sidecar; a
smoke gate records regression as explicit `unexecuted` input. Then run the
canonical `inventory -> review -> materialize -> reconcile -> verify` sequence,
submit only bounded draft decisions, let the helper construct the complete
candidate ledger and finalized envelope, and run `verify` before final
synthesis. Use the verifier's persistence state and exact human commit handoff.
Use the diff scope and write one report per agent.
