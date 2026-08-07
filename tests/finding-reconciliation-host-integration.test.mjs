import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

function repositoryFile(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const persistentLanes = [
  "api-qa",
  "bob-qa",
  "compatibility-qa",
  "data-integrity-qa",
  "deployment-qa",
  "performance-qa",
  "regression-qa",
  "reliability-qa",
  "security-qa",
  "smoke-qa",
];

test("distributed skill closes the host-neutral reconciliation sequence", async () => {
  const [skill, readme, protocol] = await Promise.all([
    repositoryFile("qa-suite/SKILL.md"),
    repositoryFile("README.md"),
    repositoryFile("qa-suite/references/finding-reconciliation.md"),
  ]);

  const ordered = [
    "finding-reconciliation.mjs dispatch",
    "helper's `inventory` command",
    "call `review`",
    "Call `materialize`",
    "`reconcile`, then `verify`",
  ].map((value) => skill.indexOf(value));
  assert.ok(ordered.every((index) => index >= 0));
  assert.deepEqual(ordered, [...ordered].sort((left, right) => left - right));
  assert.match(skill, /never add deeper lanes after\s+smoke/);
  assert.match(skill, /explicit\s+`unexecuted` records/);
  assert.match(skill, /exact-component\s+stable candidates/);
  assert.match(skill, /never\s+reads, copies, or authors the full ledger/);
  assert.match(skill, /does not\s+calculate completeness, ledger evolution, receipt totals, publication, or\s+persistence/);
  assert.match(skill, /Ledger reconciled; persistence pending human commit/);
  assert.match(readme, /Codex, Claude Code, Claude\.ai, and fallback hosts\s+transport the same canonical task bytes/);
  assert.match(protocol, /`review` also requires the frozen\s+inventory and one exact component/);
});

test("all lane contracts emit immutable report-bound sidecars", async () => {
  const lanes = await Promise.all(
    persistentLanes.map((lane) =>
      repositoryFile(`qa-suite/references/agents/${lane}.md`),
    ),
  );
  for (const [index, lane] of lanes.entries()) {
    const name = persistentLanes[index];
    assert.match(lane, /finding-proposals-v1\.schema\.json/, name);
    assert.match(lane, /report SHA-256/, name);
    assert.match(lane, /explicit empty `proposals` array/, name);
    assert.match(lane, /never reads sibling reports/, name);
    assert.match(lane, /never writes any of\s+them/, name);
  }
});

test("Claude adapters transport identities without redefining semantics", async () => {
  const adapterNames = (await readdir(new URL("../.claude/agents/", import.meta.url)))
    .filter((name) => name.endsWith(".md"));
  assert.equal(adapterNames.length, 11);
  const adapters = await Promise.all(
    adapterNames.map((name) => repositoryFile(`.claude/agents/${name}`)),
  );
  for (const [index, adapter] of adapters.entries()) {
    const name = adapterNames[index];
    assert.match(adapter, /protocol\s+version/, name);
    assert.match(adapter, /run\s+ID/, name);
    assert.match(adapter, /execution\s+ID/, name);
    assert.match(adapter, /candidate object/, name);
    assert.match(adapter, /sidecar/, name);
    assert.match(adapter, /inventory/, name);
    assert.match(adapter, /receipt/, name);
    assert.match(adapter, /ledger/, name);
  }
});

test("Claude commands preserve dispatch, gating, and verified handoff", async () => {
  const commands = await Promise.all([
    repositoryFile(".claude/commands/qa-smoke.md"),
    repositoryFile(".claude/commands/qa-regression.md"),
    repositoryFile(".claude/commands/qa-release.md"),
  ]);
  for (const command of commands) {
    assert.match(command, /dispatch manifest/);
    assert.match(command, /proposal sidecar/);
    assert.match(command, /inventory -> review -> materialize/);
    assert.match(command, /reconcile/);
    assert.match(command, /verify/);
    assert.match(command, /human commit\s+handoff/);
  }
  assert.match(commands[1], /explicit `unexecuted` input/);
  assert.match(commands[2], /explicit\s+`unexecuted` inventory inputs/);
});

test("generated smoke agents fail closed between orchestrated and standalone modes", async () => {
  const templates = await Promise.all([
    repositoryFile("qa-suite/assets/project-agent-smoke-qa.claude.md"),
    repositoryFile("qa-suite/assets/project-agent-smoke-qa.codex.toml"),
  ]);
  for (const template of templates) {
    assert.match(template, /all-or-none/i);
    assert.match(template, /Refuse a partial envelope/);
    assert.match(template, /exact adjacent sidecar pointer/);
    assert.match(template, /explicit empty array/);
    assert.match(template, /remain report-only/);
    assert.match(template, /never invent transport fields/);
  }
});
