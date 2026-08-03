import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

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

function readRepositoryFile(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function extractSection(markdown, heading) {
  const marker = `${heading}\n`;
  const start = markdown.indexOf(marker);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const contentStart = start + marker.length;
  const level = heading.match(/^#+/)[0].length;
  const remainder = markdown.slice(contentStart);
  const nextHeading = new RegExp(`^#{1,${level}}[ \\t]+`, "m").exec(
    remainder,
  );
  return nextHeading ? remainder.slice(0, nextHeading.index) : remainder;
}

test("temporary specialist has a complete fail-closed dispatch contract", async () => {
  const [reference, adapter] = await Promise.all([
    readRepositoryFile("qa-suite/references/temporary-specialist.md"),
    readRepositoryFile(".claude/agents/temporary-specialist.md"),
  ]);

  assert.match(adapter, /^name: temporary-specialist$/m);
  assert.match(adapter, /^tools: Read, Grep, Glob, Bash, Write$/m);
  assert.match(adapter, /not a\s+persistent QA lane/);
  assert.match(adapter, /Refuse direct generic invocation/);
  assert.match(adapter, /Before\s+reading other project material/);
  assert.match(adapter, /--projection dispatch/);
  assert.match(adapter, /omitted envelope/);
  assert.match(adapter, /unregistered identity/);
  assert.match(adapter, /identity digest drift/);
  assert.match(adapter, /failed\s+exact resolution/);
  assert.match(adapter, /altered time box/);
  assert.match(adapter, /unconstrained scope/);

  const envelope = extractSection(
    reference,
    "## Required orchestration envelope",
  );
  for (const field of [
    "registry_path",
    "specialist_id",
    "mission",
    "candidate",
    "platform",
    "scope",
    "report_folder",
    "time_box_minutes",
  ]) {
    assert.match(envelope, new RegExp("`" + field + "`"));
  }
  assert.match(envelope, /15 through 240/);
  assert.match(envelope, /Direct generic invocation is invalid/);
  assert.match(envelope, /refusal, not `Blocked` QA evidence/);

  const resolution = extractSection(
    reference,
    "## Resolve before reading the project",
  );
  assert.match(
    resolution,
    /resolve --id <specialist_id> --projection dispatch/,
  );
  assert.match(
    resolution,
    /Confirm `registry_path` exactly matches the `qa-context\.md` field/,
  );
  assert.match(
    resolution,
    /validates the registry, repository boundary, exact identity,\s+and content digest/,
  );
  assert.match(
    resolution,
    /resolved `id` and `time_box_minutes` exactly match/,
  );
  assert.match(resolution, /Never read sibling registry definitions/);
  assert.match(
    resolution,
    /Never put `selection_criteria` or\s+`definition_rationale` in the specialist prompt/,
  );
  assert.ok(
    reference.indexOf("## Resolve before reading the project") <
      reference.indexOf("## Execution boundary"),
  );
});

test("temporary specialist is report-folder-only and uses the exact identity", async () => {
  const reference = await readRepositoryFile(
    "qa-suite/references/temporary-specialist.md",
  );
  const execution = extractSection(reference, "## Execution boundary");
  const lifecycle = extractSection(reference, "## Lifecycle and identity");
  const reports = extractSection(reference, "## Report contract");

  assert.match(
    execution,
    /Use only `Read`, `Grep`, `Glob`, `Bash`, and `Write`/,
  );
  assert.match(
    execution,
    /Writes are limited to new\s+report and evidence files inside `report_folder`/,
  );
  assert.match(
    execution,
    /Never create, edit, replace,\s+or delete the registry, finding ledger, tracker state, source, tests,\s+configuration, git state, credentials, permissions, or network grants/,
  );
  assert.match(lifecycle, /Use the resolved `temporary-qa-\.\.\.` identity/);
  assert.match(
    lifecycle,
    /Never write `temporary-specialist` as a report identity\s+or ledger-proposal lane/,
  );
  assert.match(
    lifecycle,
    /missing.*`Blocked`.*leaves lifecycle state\s+unchanged/s,
  );
  assert.match(reports, /one report-level canonical verdict/);
  assert.match(
    reports,
    /Do not add a\s+per-finding verdict or a `confidence` field/,
  );
  assert.match(reports, /Severity, Priority/);
  assert.match(reports, /impact, recommendation, and validation/);
  assert.match(reports, /\*\*Assumptions\*\*/);
  assert.match(reports, /\*\*Not tested\*\*/);
  assert.match(reports, /default to sensitivity\s+`uncertain`/);
});

test("distribution exposes ten persistent lanes and eleven Claude adapters", async () => {
  const [
    skill,
    readme,
    plugin,
    claudeMarketplace,
    codexPlugin,
    referenceFiles,
    adapterFiles,
  ] =
    await Promise.all([
      readRepositoryFile("qa-suite/SKILL.md"),
      readRepositoryFile("README.md"),
      readRepositoryFile(".claude-plugin/plugin.json").then(JSON.parse),
      readRepositoryFile(".claude-plugin/marketplace.json").then(JSON.parse),
      readRepositoryFile(".codex-plugin/plugin.json").then(JSON.parse),
      readdir(new URL("../qa-suite/references/agents/", import.meta.url)),
      readdir(new URL("../.claude/agents/", import.meta.url)),
    ]);

  assert.deepEqual(
    referenceFiles.filter((path) => path.endsWith(".md")).sort(),
    persistentLanes.map((name) => `${name}.md`).sort(),
  );
  assert.equal(adapterFiles.filter((path) => path.endsWith(".md")).length, 11);
  assert.equal(plugin.agents.length, 11);
  assert.equal(
    claudeMarketplace.plugins[0].description,
    plugin.description,
  );
  assert.equal(codexPlugin.description, plugin.description);
  assert.match(codexPlugin.interface.longDescription, /ten persistent lanes/);
  assert.equal(
    plugin.agents.filter((path) => path.endsWith("temporary-specialist.md"))
      .length,
    1,
  );
  assert.match(
    skill,
    /ten fixed persistent-lane\s+wrappers plus one generic temporary-specialist adapter/,
  );
  assert.match(readme, /eleven Claude adapters total/);
  assert.doesNotMatch(
    extractSection(skill, "## The agents"),
    /temporary-specialist/,
  );
  assert.doesNotMatch(
    extractSection(readme, "## Agents"),
    /temporary-specialist/,
  );

  await assert.rejects(
    access(
      new URL("../.codex/agents/temporary-specialist.toml", import.meta.url),
    ),
  );
  assert.match(skill, /Codex has no temporary-specialist wrapper/);
});

test("public orchestration preserves ledger v1 compatibility and v2 authority", async () => {
  const [skill, readme] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("README.md"),
  ]);
  const ledger = extractSection(skill, "## Finding ledger");

  assert.match(
    ledger,
    /canonical `references\/finding-ledger\.schema\.json` is\s+version 2/,
  );
  assert.match(
    ledger,
    /frozen version-1 schema accepts\s+the original seven lanes/,
  );
  assert.match(ledger, /Empty ledgers start at version 2/);
  assert.match(
    ledger,
    /new persistent\s+or temporary identity stops before dispatch/,
  );
  assert.match(ledger, /exact\s+compare-and-swap migration command/);
  assert.match(
    ledger,
    /Never change schema version or owning\s+identity through an ordinary write/,
  );
  assert.match(readme, /Temporary\s+findings default to `uncertain` sensitivity/);
  assert.match(readme, /redacted or sidecar-only\s+storage/);
});
