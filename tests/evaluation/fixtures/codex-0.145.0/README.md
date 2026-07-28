# Codex CLI 0.145.0 JSONL fixture

`success.jsonl` was captured on 2026-07-28 from the installed
`codex-cli 0.145.0` using `codex exec --json --ephemeral
--ignore-user-config`. The turn used a local read-only stdio MCP server whose
only tool returned the public `codex-0145-wire` marker.

The executed `/opt/homebrew/bin/codex` binary had SHA-256
`1da3f4e0e96028b8a771814293c3033dafd1971f943f6c7e79b0897fe705f590`.
The retained `success.jsonl` has SHA-256
`b17e45a199db1ec85250bfd8ac5889538fa1ca982683a4997bbfebcdad166450`.
The accepted fields are pinned to the upstream
[`rust-v0.145.0` event types](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/exec/src/exec_events.rs)
and
[`rust-v0.145.0` JSONL mapper](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/exec/src/event_processor_with_jsonl_output.rs).

Sanitization replaced the thread UUID and token counters. Event order, item
IDs, field names, MCP server/tool names, arguments, result shape, statuses,
and final JSON text remain as emitted. The raw capture is not retained because
it contains the original generated thread UUID and token accounting.

This fixture proves compatibility with the pinned serialization shape only.
It does not authenticate a provider, model, MCP server, tool result, sandbox,
or qualifying execution.
