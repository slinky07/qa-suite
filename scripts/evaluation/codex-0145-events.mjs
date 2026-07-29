import {
  canonicalJson,
  parseContractJson,
  sha256,
} from "./contracts.mjs";

const THREAD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ITEM_ID = /^item_(?:0|[1-9][0-9]*)$/u;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_EVENTS = 2_048;
const MAX_CONTENT_BLOCKS = 256;
const MAX_TODO_ITEMS = 256;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const ALLOWED_ITEM_TYPES = new Set([
  "agent_message",
  "mcp_tool_call",
  "reasoning",
  "todo_list",
]);

function assertObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  assertObject(value, label);
  const observed = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(observed) !== canonicalJson(wanted)) {
    throw new Error(
      `${label} fields are ${observed.join(", ")}; expected ${wanted.join(", ")}`,
    );
  }
}

function assertDenseArray(
  value,
  label,
  { minimum = 0, maximum },
) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new Error(`${label} must contain ${minimum}-${maximum} items`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(`${label} must be a dense array`);
    }
  }
  if (Object.keys(value).length !== value.length) {
    throw new Error(`${label} must not contain named properties`);
  }
  return value;
}

function assertString(
  value,
  label,
  { maximum = 4_096, pattern, trimmed = true } = {},
) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > maximum ||
    value.includes("\0") ||
    (trimmed && value.trim() !== value) ||
    (pattern && !pattern.test(value))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function assertExpectedItemId(value, index) {
  if (value !== `item_${index}`) {
    throw new Error(`Codex item ID must equal item_${index}`);
  }
}

function validateUsage(value) {
  assertExactKeys(
    value,
    [
      "cache_write_input_tokens",
      "cached_input_tokens",
      "input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
    ],
    "Codex turn usage",
  );
  for (const [name, tokens] of Object.entries(value)) {
    assertNonnegativeInteger(tokens, `Codex turn usage.${name}`);
  }
  return structuredClone(value);
}

function validateMcpIdentity(item) {
  assertExactKeys(
    item,
    [
      "arguments",
      "error",
      "id",
      "result",
      "server",
      "status",
      "tool",
      "type",
    ],
    "Codex MCP tool call",
  );
  if (item.type !== "mcp_tool_call") {
    throw new Error("Codex MCP tool call type is invalid");
  }
  return {
    arguments: structuredClone(item.arguments),
    id: assertString(item.id, "Codex MCP tool call ID", {
      maximum: 256,
      pattern: ITEM_ID,
    }),
    server: assertString(item.server, "Codex MCP server", {
      maximum: 256,
    }),
    tool: assertString(item.tool, "Codex MCP tool", {
      maximum: 256,
    }),
  };
}

function validateMcpResult(value) {
  const fields = Object.hasOwn(value, "_meta")
    ? ["_meta", "content", "structured_content"]
    : ["content", "structured_content"];
  assertExactKeys(value, fields, "Codex MCP tool result");
  assertDenseArray(value.content, "Codex MCP tool result.content", {
    maximum: MAX_CONTENT_BLOCKS,
  });
  return structuredClone(value);
}

function validateTextItem(item) {
  assertExactKeys(item, ["id", "text", "type"], `Codex ${item.type}`);
  return {
    id: assertString(item.id, `Codex ${item.type}.id`, {
      maximum: 256,
      pattern: ITEM_ID,
    }),
    text: assertString(item.text, `Codex ${item.type}.text`, {
      maximum: MAX_TEXT_BYTES,
      trimmed: false,
    }),
    type: item.type,
  };
}

function validateTodoList(item) {
  assertExactKeys(item, ["id", "items", "type"], "Codex todo list");
  if (item.type !== "todo_list") {
    throw new Error("Codex todo list type is invalid");
  }
  const items = assertDenseArray(item.items, "Codex todo list.items", {
    maximum: MAX_TODO_ITEMS,
  }).map((todo, index) => {
    assertExactKeys(
      todo,
      ["completed", "text"],
      `Codex todo list.items[${index}]`,
    );
    if (typeof todo.completed !== "boolean") {
      throw new Error(
        `Codex todo list.items[${index}].completed must be boolean`,
      );
    }
    return {
      completed: todo.completed,
      text: assertString(
        todo.text,
        `Codex todo list.items[${index}].text`,
      ),
    };
  });
  return {
    id: assertString(item.id, "Codex todo list ID", {
      maximum: 256,
      pattern: ITEM_ID,
    }),
    items,
  };
}

function parseEvents(source) {
  assertString(source, "Codex 0.145 JSONL", {
    maximum: MAX_SOURCE_BYTES,
    trimmed: false,
  });
  if (!source.endsWith("\n")) {
    throw new Error("Codex 0.145 JSONL must end at an event boundary");
  }
  const lines = source.slice(0, -1).split("\n");
  assertDenseArray(lines, "Codex 0.145 JSONL events", {
    maximum: MAX_EVENTS,
    minimum: 4,
  });
  return lines.map((line, index) =>
    parseContractJson(line, `Codex 0.145 JSONL event ${index + 1}`)
  );
}

// Wire fields are pinned to Codex CLI 0.145.0. A Codex upgrade requires a
// deliberate contract and retained-fixture update before this parser changes.
export function parseCodex0145TurnJsonl(source) {
  const events = parseEvents(source);
  assertExactKeys(events[0], ["thread_id", "type"], "Codex thread start");
  assertExactKeys(events[1], ["type"], "Codex turn start");
  assertExactKeys(
    events.at(-1),
    ["type", "usage"],
    "Codex turn completion",
  );
  if (
    events[0].type !== "thread.started" ||
    events[1].type !== "turn.started" ||
    events.at(-1).type !== "turn.completed"
  ) {
    throw new Error("Codex 0.145 JSONL lifecycle is incomplete or out of order");
  }
  const threadId = assertString(
    events[0].thread_id,
    "Codex thread ID",
    {
      maximum: 64,
      pattern: THREAD_ID,
    },
  );
  const usage = validateUsage(events.at(-1).usage);
  const itemEvents = events.slice(2, -1);
  const completedIds = new Set();
  const mcpCalls = [];
  const reasoning = [];
  let activeCall = null;
  let activeTodoList = null;
  let completedTodoList = false;
  let finalMessage = null;
  let nextItemIndex = 0;

  itemEvents.forEach((event, index) => {
    const sequence = index + 3;
    assertExactKeys(event, ["item", "type"], "Codex item event");
    if (
      !["item.started", "item.updated", "item.completed"].includes(event.type)
    ) {
      throw new Error(`Codex JSONL event ${event.type} is unsupported`);
    }
    assertObject(event.item, "Codex JSONL item");
    if (!ALLOWED_ITEM_TYPES.has(event.item.type)) {
      throw new Error(`Codex item type ${event.item.type} is unsupported`);
    }

    if (event.item.type === "todo_list") {
      const todoList = validateTodoList(event.item);
      if (activeCall !== null) {
        throw new Error("Codex MCP tool call lifecycle was interleaved");
      }
      if (event.type === "item.started") {
        if (
          activeTodoList !== null ||
          completedTodoList ||
          finalMessage !== null ||
          completedIds.has(todoList.id)
        ) {
          throw new Error("Codex todo list start is invalid");
        }
        assertExpectedItemId(todoList.id, nextItemIndex);
        nextItemIndex += 1;
        activeTodoList = {
          ...todoList,
          started_sequence: sequence,
        };
        return;
      }
      if (
        activeTodoList === null ||
        todoList.id !== activeTodoList.id
      ) {
        throw new Error("Codex todo list has no matching start");
      }
      if (event.type === "item.updated") {
        if (finalMessage !== null) {
          throw new Error(
            "Codex agent message must be the only final completed item",
          );
        }
        activeTodoList.items = todoList.items;
        return;
      }
      if (
        finalMessage === null ||
        index !== itemEvents.length - 1 ||
        canonicalJson(todoList.items) !==
          canonicalJson(activeTodoList.items)
      ) {
        throw new Error("Codex todo list completion is invalid");
      }
      completedIds.add(todoList.id);
      completedTodoList = true;
      activeTodoList = null;
      return;
    }

    if (event.type === "item.updated") {
      throw new Error(`Codex ${event.item.type} cannot be updated`);
    }
    if (finalMessage !== null) {
      throw new Error(
        "Codex agent message must be the only final completed item",
      );
    }
    if (event.item.type === "mcp_tool_call") {
      const identity = validateMcpIdentity(event.item);
      if (event.type === "item.started") {
        if (activeCall !== null) {
          throw new Error("Codex MCP tool calls must not overlap");
        }
        if (
          event.item.status !== "in_progress" ||
          event.item.error !== null ||
          event.item.result !== null ||
          completedIds.has(identity.id)
        ) {
          throw new Error("Codex MCP tool call start is invalid");
        }
        assertExpectedItemId(identity.id, nextItemIndex);
        nextItemIndex += 1;
        activeCall = {
          ...identity,
          started_sequence: sequence,
        };
        return;
      }
      if (activeCall === null) {
        throw new Error("Codex MCP tool call has no matching start");
      }
      if (
        event.item.status !== "completed" ||
        event.item.error !== null ||
        event.item.result === null
      ) {
        throw new Error("Codex MCP tool call did not complete successfully");
      }
      const startedIdentity = {
        arguments: activeCall.arguments,
        id: activeCall.id,
        server: activeCall.server,
        tool: activeCall.tool,
      };
      if (canonicalJson(startedIdentity) !== canonicalJson(identity)) {
        throw new Error("Codex MCP tool call does not match its start");
      }
      mcpCalls.push({
        ...startedIdentity,
        completed_sequence: sequence,
        result: validateMcpResult(event.item.result),
        started_sequence: activeCall.started_sequence,
      });
      completedIds.add(identity.id);
      activeCall = null;
      return;
    }

    if (activeCall !== null) {
      throw new Error("Codex MCP tool call lifecycle was interleaved");
    }
    if (event.type !== "item.completed") {
      throw new Error(`Codex ${event.item.type} must be emitted completed`);
    }
    const item = validateTextItem(event.item);
    if (completedIds.has(item.id)) {
      throw new Error("Codex item IDs must be unique");
    }
    assertExpectedItemId(item.id, nextItemIndex);
    nextItemIndex += 1;
    completedIds.add(item.id);
    if (item.type === "reasoning") {
      if (item.text.trim().length === 0) {
        throw new Error("Codex reasoning text must not be whitespace-only");
      }
      reasoning.push({
        completed_sequence: sequence,
        id: item.id,
        text: item.text,
      });
      return;
    }
    const expectedFinalIndex = activeTodoList === null
      ? itemEvents.length - 1
      : itemEvents.length - 2;
    if (index !== expectedFinalIndex) {
      throw new Error(
        "Codex agent message must be the only final completed item",
      );
    }
    finalMessage = {
      completed_sequence: sequence,
      id: item.id,
      text: item.text,
    };
  });

  if (
    activeCall !== null ||
    activeTodoList !== null ||
    finalMessage === null
  ) {
    throw new Error(
      "Codex turn requires closed MCP calls, closed todo list, and one final agent message",
    );
  }
  return {
    event_count: events.length,
    final_message: finalMessage,
    mcp_calls: mcpCalls,
    reasoning,
    source_sha256: sha256(Buffer.from(source, "utf8")),
    thread_id: threadId,
    usage,
  };
}
