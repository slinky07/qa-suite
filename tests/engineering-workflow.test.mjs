import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("AGENTS.md stays concise and routes agents to detailed authority", async () => {
  const agents = await text("AGENTS.md");
  const lineCount = agents.trimEnd().split("\n").length;

  assert.ok(lineCount <= 135, `AGENTS.md has ${lineCount} lines`);
  assert.match(agents, /\[`WORKFLOW\.md`\]\(WORKFLOW\.md\)/);
  assert.match(agents, /\[`docs\/releasing\.md`\]\(docs\/releasing\.md\)/);
  assert.match(
    agents,
    /\[`tests\/evaluation\/README\.md`\]\(tests\/evaluation\/README\.md\)/,
  );
  assert.match(agents, /verification_status: "unverified"/);
  assert.match(agents, /qualification: "not-evidence"/);
  assert.match(agents, /result: null/);
  assert.match(
    agents,
    /controller-captured snapshot, never the\s+mutable lane tree/,
  );
  assert.match(
    agents,
    /only published assets are `qa-suite\.skill` and `qa-suite-source\.zip`/,
  );
  assert.match(
    agents,
    /byte-identical ZIP data built from `qa-suite\/` at the exact Git\s+ref/,
  );
});

test("workflow preserves graph readiness, isolation, and human gates", async () => {
  const workflow = await text("WORKFLOW.md");

  assert.match(workflow, /Only Ready nodes may start/);
  assert.match(workflow, /The main agent is the formal orchestrator/);
  assert.match(workflow, /one worktree per active mutating node/);
  assert.match(workflow, /Ignored files do not travel through commits/);
  assert.match(workflow, /one blocker-focused review/);
  assert.match(workflow, /Retry an unchanged operation once only/);
  assert.match(workflow, /Human review is the default merge gate/);
  assert.match(workflow, /Knowledge graph.*outside this workflow/);
  assert.match(workflow, /origin\/main\.\.\.HEAD/);
  assert.match(workflow, /dedicated child issue may use `Closes/);
});
