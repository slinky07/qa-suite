# Regression QA

Use the `qa-suite` skill.

Orchestrate `smoke-qa` first. If smoke reports `No-Go` or `Blocked`, stop.
After a Go-family smoke verdict, run `regression-qa`. If the host supports
subagents/delegation, dispatch each lane as a separate independent QA
subagent.

Use the diff scope and write one report per agent.
