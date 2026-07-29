import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { sha256 } from "../scripts/evaluation/contracts.mjs";
import {
  parseCodex0145TurnJsonl,
} from "../scripts/evaluation/codex-0145-events.mjs";

const fixtureUrl = new URL(
  "./evaluation/fixtures/codex-0.145.0/success.jsonl",
  import.meta.url,
);
const fixtureSource = await readFile(fixtureUrl, "utf8");
const FIXTURE_SHA256 =
  "b17e45a199db1ec85250bfd8ac5889538fa1ca982683a4997bbfebcdad166450";

function fixtureEvents() {
  return fixtureSource
    .slice(0, -1)
    .split("\n")
    .map((line) => JSON.parse(line));
}

function serialize(events) {
  return `${events.map(JSON.stringify).join("\n")}\n`;
}

function expectMutation(mutator, error) {
  const events = fixtureEvents();
  mutator(events);
  assert.throws(() => parseCodex0145TurnJsonl(serialize(events)), error);
}

test("parses the retained Codex 0.145 success fixture", () => {
  const parsed = parseCodex0145TurnJsonl(fixtureSource);

  assert.equal(parsed.event_count, 6);
  assert.equal(
    parsed.source_sha256,
    FIXTURE_SHA256,
  );
  assert.equal(
    sha256(Buffer.from(fixtureSource, "utf8")),
    FIXTURE_SHA256,
  );
  assert.equal(
    parsed.thread_id,
    "01900000-0000-7000-8000-000000000145",
  );
  assert.deepEqual(parsed.mcp_calls, [
    {
      arguments: {
        marker: "codex-0145-wire",
      },
      completed_sequence: 4,
      id: "item_0",
      result: {
        content: [
          {
            text: "{\"marker\":\"codex-0145-wire\"}",
            type: "text",
          },
        ],
        structured_content: null,
      },
      server: "fixture",
      started_sequence: 3,
      tool: "emit_fixture_marker",
    },
  ]);
  assert.deepEqual(parsed.final_message, {
    completed_sequence: 5,
    id: "item_1",
    text: "{\"status\":\"ok\"}",
  });
  assert.deepEqual(parsed.reasoning, []);
  assert.deepEqual(parsed.usage, {
    cache_write_input_tokens: 0,
    cached_input_tokens: 8,
    input_tokens: 13,
    output_tokens: 5,
    reasoning_output_tokens: 2,
  });
});

test("preserves optional MCP metadata and structured content", () => {
  const events = fixtureEvents();
  events[2].item.arguments = null;
  events[3].item.arguments = null;
  events[3].item.result._meta = {
    fixture: true,
  };
  events[3].item.result.content = [];
  events[3].item.result.structured_content = {
    marker: "codex-0145-wire",
  };
  events[4].item.id = "item_2";
  events.splice(-2, 0, {
    item: {
      id: "item_1",
      text: "Checked the tool response.",
      type: "reasoning",
    },
    type: "item.completed",
  });

  const parsed = parseCodex0145TurnJsonl(serialize(events));

  assert.equal(parsed.mcp_calls[0].arguments, null);
  assert.deepEqual(parsed.mcp_calls[0].result.content, []);
  assert.deepEqual(parsed.mcp_calls[0].result._meta, {
    fixture: true,
  });
  assert.deepEqual(parsed.mcp_calls[0].result.structured_content, {
    marker: "codex-0145-wire",
  });
  assert.deepEqual(parsed.reasoning, [
    {
      completed_sequence: 5,
      id: "item_1",
      text: "Checked the tool response.",
    },
  ]);
  assert.equal(parsed.final_message.completed_sequence, 6);
});

test("accepts the exact Codex 0.145 todo-list lifecycle", () => {
  const events = fixtureEvents();
  events[2].item.id = "item_1";
  events[3].item.id = "item_1";
  events[4].item.id = "item_2";
  const todoList = {
    id: "item_0",
    items: [
      {
        completed: false,
        text: "Observe the app interface",
      },
    ],
    type: "todo_list",
  };
  events.splice(2, 0, {
    item: structuredClone(todoList),
    type: "item.started",
  });
  events.splice(3, 0, {
    item: structuredClone(todoList),
    type: "item.updated",
  });
  events.splice(-1, 0, {
    item: structuredClone(todoList),
    type: "item.completed",
  });

  const parsed = parseCodex0145TurnJsonl(serialize(events));

  assert.equal(parsed.event_count, 9);
  assert.equal(parsed.mcp_calls[0].id, "item_1");
  assert.equal(parsed.final_message.id, "item_2");
});

test("rejects incomplete and drifted top-level lifecycles", () => {
  assert.throws(
    () => parseCodex0145TurnJsonl(fixtureSource.slice(0, -1)),
    /must end at an event boundary/u,
  );
  expectMutation(
    (events) => {
      events[0].unexpected = true;
    },
    /Codex thread start fields/u,
  );
  expectMutation(
    (events) => {
      [events[0], events[1]] = [events[1], events[0]];
    },
    /Codex thread start fields|incomplete or out of order/u,
  );
  expectMutation(
    (events) => {
      events[events.length - 1] = {
        error: {
          message: "failed",
        },
        type: "turn.failed",
      };
    },
    /Codex turn completion fields/u,
  );
  expectMutation(
    (events) => {
      events.splice(2, 0, {
        type: "turn.started",
      });
    },
    /Codex item event fields/u,
  );
});

test("rejects orphaned, drifted, failed, and overlapping MCP calls", () => {
  expectMutation(
    (events) => {
      events.splice(2, 1);
    },
    /has no matching start/u,
  );
  expectMutation(
    (events) => {
      events[3].item.tool = "other_tool";
    },
    /does not match its start/u,
  );
  expectMutation(
    (events) => {
      events[2].item.result = {
        content: [],
        structured_content: null,
      };
    },
    /start is invalid/u,
  );
  expectMutation(
    (events) => {
      events[3].item.error = {
        message: "failed",
      };
      events[3].item.result = null;
      events[3].item.status = "failed";
    },
    /did not complete successfully/u,
  );
  expectMutation(
    (events) => {
      const overlapping = structuredClone(events[2]);
      overlapping.item.id = "item_9";
      events.splice(3, 0, overlapping);
    },
    /must not overlap/u,
  );
  expectMutation(
    (events) => {
      events[3].item.result.unexpected = true;
    },
    /Codex MCP tool result fields/u,
  );
});

test("rejects interleaved, unsupported, and non-final items", () => {
  expectMutation(
    (events) => {
      events.splice(3, 0, {
        item: {
          id: "item_9",
          text: "interleaved",
          type: "reasoning",
        },
        type: "item.completed",
      });
    },
    /lifecycle was interleaved/u,
  );
  expectMutation(
    (events) => {
      events[2] = {
        item: {
          aggregated_output: "",
          command: "true",
          exit_code: 0,
          id: "item_0",
          status: "completed",
          type: "command_execution",
        },
        type: "item.completed",
      };
    },
    /item type command_execution is unsupported/u,
  );
  expectMutation(
    (events) => {
      events[4].type = "item.started";
    },
    /must be emitted completed/u,
  );
  expectMutation(
    (events) => {
      const earlyMessage = structuredClone(events[4]);
      earlyMessage.item.id = "item_0";
      events[2].item.id = "item_1";
      events[3].item.id = "item_1";
      events[4].item.id = "item_2";
      events.splice(2, 0, earlyMessage);
    },
    /only final completed item/u,
  );
  expectMutation(
    (events) => {
      events.splice(4, 1);
    },
    /one final agent message/u,
  );
  expectMutation(
    (events) => {
      events[4].item.id = "item_2";
      events.splice(-2, 0, {
        item: {
          id: "item_1",
          text: "   ",
          type: "reasoning",
        },
        type: "item.completed",
      });
    },
    /reasoning text must not be whitespace-only/u,
  );
  expectMutation(
    (events) => {
      events[4].type = "item.updated";
    },
    /agent_message cannot be updated/u,
  );
});

test("rejects drifted and incomplete todo-list lifecycles", () => {
  const todoList = {
    id: "item_0",
    items: [
      {
        completed: false,
        text: "Observe the app interface",
      },
    ],
    type: "todo_list",
  };

  expectMutation(
    (events) => {
      events.splice(2, 0, {
        item: structuredClone(todoList),
        type: "item.updated",
      });
    },
    /has no matching start/u,
  );
  expectMutation(
    (events) => {
      events[2].item.id = "item_1";
      events[3].item.id = "item_1";
      events[4].item.id = "item_2";
      events.splice(2, 0, {
        item: structuredClone(todoList),
        type: "item.started",
      });
    },
    /only final completed item|closed todo list/u,
  );
  expectMutation(
    (events) => {
      events[2].item.id = "item_1";
      events[3].item.id = "item_1";
      events[4].item.id = "item_2";
      events.splice(2, 0, {
        item: structuredClone(todoList),
        type: "item.started",
      });
      const completion = structuredClone(todoList);
      completion.items[0].completed = true;
      events.splice(-1, 0, {
        item: completion,
        type: "item.completed",
      });
    },
    /completion is invalid/u,
  );
  expectMutation(
    (events) => {
      events[2].item.id = "item_1";
      events[3].item.id = "item_1";
      events[4].item.id = "item_2";
      const invalid = structuredClone(todoList);
      invalid.items[0].completed = "false";
      events.splice(2, 0, {
        item: invalid,
        type: "item.started",
      });
    },
    /completed must be boolean/u,
  );
});

test("requires canonical contiguous Codex item IDs", () => {
  expectMutation(
    (events) => {
      events[2].item.id = "item_9";
      events[3].item.id = "item_9";
    },
    /item ID must equal item_0/u,
  );
  expectMutation(
    (events) => {
      events[2].item.id = "item_00";
      events[3].item.id = "item_00";
    },
    /MCP tool call ID is invalid/u,
  );
  expectMutation(
    (events) => {
      events[4].item.id = "item_0";
    },
    /item IDs must be unique/u,
  );
});

test("rejects invalid usage and excessive event counts", () => {
  expectMutation(
    (events) => {
      delete events.at(-1).usage.reasoning_output_tokens;
    },
    /Codex turn usage fields/u,
  );
  expectMutation(
    (events) => {
      events.at(-1).usage.input_tokens = -1;
    },
    /non-negative safe integer/u,
  );
  expectMutation(
    (events) => {
      events.at(-1).usage.output_tokens = 1.5;
    },
    /non-negative safe integer/u,
  );

  const events = fixtureEvents();
  const final = events.splice(-2, 1)[0];
  for (let index = 0; events.length < 2_048; index += 1) {
    events.splice(-1, 0, {
      item: {
        id: `item_${index + 10}`,
        text: "bounded reasoning",
        type: "reasoning",
      },
      type: "item.completed",
    });
  }
  events.splice(-1, 0, final);
  assert.equal(events.length, 2_049);
  assert.throws(
    () => parseCodex0145TurnJsonl(serialize(events)),
    /must contain 4-2048 items/u,
  );
});

test("rejects duplicate JSON keys before lifecycle validation", () => {
  const source = fixtureSource.replace(
    '{"type":"turn.started"}',
    '{"type":"turn.started","type":"turn.started"}',
  );

  assert.throws(
    () => parseCodex0145TurnJsonl(source),
    /duplicate object key/u,
  );
});
