# Release QA

Use the `qa-suite` skill.

Orchestrate release audit order: `smoke-qa`, `bob-qa` full,
`performance-qa`, `security-qa`, `compatibility-qa`. If the host supports
subagents/delegation, dispatch each lane as a separate independent QA
subagent.

Write one report per agent and apply the most conservative verdict.
