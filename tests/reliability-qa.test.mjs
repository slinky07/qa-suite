import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reliabilityPath = "qa-suite/references/agents/reliability-qa.md";

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

function extractField(section, field) {
  const marker = `- **${field}:**`;
  const start = section.indexOf(marker);

  assert.notEqual(start, -1, `missing field: ${field}`);

  const remainder = section.slice(start + marker.length);
  const nextField = /^\s*-\s+\*\*[^*]+:\*\*/m.exec(remainder);
  const value = nextField ? remainder.slice(0, nextField.index) : remainder;

  return value.replace(/\s+/g, " ").trim();
}

test("reliability QA declares the bounded specialist contract", async () => {
  const reliability = await readRepositoryFile(reliabilityPath);
  const contract = extractSection(reliability, "## Specialist contract");

  for (const field of [
    "Specialist perspective",
    "Primary question",
    "Specialist mission",
    "Priorities",
    "Decision rules",
    "Evidence requirements",
    "Scope exclusions and escalation",
  ]) {
    assert.equal(
      contract.split(`**${field}:**`).length - 1,
      1,
      `Reliability QA needs exactly one ${field} field`,
    );
  }

  assert.equal(
    extractField(contract, "Specialist perspective"),
    "Simulate a reliability QA engineer.",
  );
  assert.equal(
    extractField(contract, "Primary question"),
    "Does the system fail, degrade, recover, and alert safely under its documented operating conditions?",
  );
  assert.match(
    extractField(contract, "Specialist mission"),
    /one bounded set.*deterministic failure and recovery.*isolated disposable target/i,
  );
  assert.match(contract, /assumptions explicit and\s+verdict-neutral/);
  assert.match(
    contract,
    /Static inspection.*cannot prove runtime resilience or recovery/s,
  );
});

test("reliability QA is optional, bounded, and runtime-evidence based", async () => {
  const reliability = await readRepositoryFile(reliabilityPath);
  const triggers = extractSection(reliability, "## Selection triggers");
  const normalizedTriggers = triggers.replace(/\s+/g, " ");
  const timeBox = extractSection(reliability, "## Time box");
  const method = extractSection(reliability, "## Test method");

  for (const trigger of [
    "retries",
    "degraded modes",
    "external dependencies",
    "failover",
    "recovery objectives",
    "resilience",
    "alerting",
  ]) {
    assert.match(normalizedTriggers, new RegExp(trigger));
  }

  assert.match(normalizedTriggers, /optional/);
  assert.match(
    normalizedTriggers,
    /Do not select it only because the lane exists/,
  );
  assert.match(timeBox, /default wall-clock time box is 60 minutes/);
  assert.match(timeBox, /15 through 240 minutes only.*explicit recorded/s);
  assert.match(method, /one deterministic and reversible fault/);
  assert.match(reliability, /fault and\s+restoration timestamps/i);
  assert.match(method, /Do not infer successful recovery from source/);
  assert.match(method, /Never use a\s+production, public, or shared target/);
  assert.match(method, /`Observed only`/);
  assert.match(method, /never report resilience.*as passed or effective/s);
});

test("reliability QA preserves ownership seams and current report semantics", async () => {
  const reliability = await readRepositoryFile(reliabilityPath);
  const boundaries = extractSection(reliability, "## Ownership boundaries");
  const reports = extractSection(reliability, "## Reports");
  const isolation = extractSection(reliability, "## Isolation");

  assert.match(boundaries, /smoke-qa.*startup.*critical-flow response/s);
  assert.match(boundaries, /performance-qa.*latency, throughput.*CPU or memory/s);
  assert.match(boundaries, /regression-qa.*prior candidate/s);
  assert.match(boundaries, /deployment-qa.*artifact and configuration identity/s);
  assert.match(boundaries, /data-integrity-qa.*stored-state invariants/s);

  assert.match(isolation, /Specialist dispatch envelope/);
  assert.match(isolation, /Mission modes/);
  assert.match(isolation, /Lane\s+identity never changes its visibility/);

  assert.match(reports, /one report-level state.*first line/s);
  assert.match(reports, /\*\*Assumptions\*\*/);
  assert.match(reports, /Assumptions are not findings/);
  assert.match(reports, /Confirmation\s+dispositions/);
  assert.match(reports, /finding proposal\s+linked to the supplied ledger ID/);
  assert.match(reports, /Every finding carries both Severity and Priority/);
  assert.match(
    reports.replace(/\s+/g, " "),
    /demonstrated reliability impact \| recommendation \| validation/,
  );
  assert.match(reports, /does not read or write the\s+finding ledger/);
  assert.doesNotMatch(reports, /per-finding verdict/i);
  assert.doesNotMatch(reports, /\bconfidence\b/i);
});
