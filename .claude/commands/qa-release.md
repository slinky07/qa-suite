# Release QA

Use the `qa-suite` skill.

Orchestrate `smoke-qa` first. If smoke reports `No-Go` or `Blocked`, stop.
After a Go-family smoke verdict, select every applicable release lane from
the canonical trigger table in `qa-suite/SKILL.md`; do not run a lane only
because it exists. If the host supports subagents/delegation, dispatch each
selected lane as a separate independent QA subagent.

Write one report per agent. Apply valid risk acceptance during final
synthesis, then apply the most conservative verdict.
