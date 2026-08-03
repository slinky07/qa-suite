import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function readDeploymentDefinition() {
  return readFile(
    new URL("../qa-suite/references/agents/deployment-qa.md", import.meta.url),
    "utf8",
  );
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

test("deployment QA declares the complete specialist contract", async () => {
  const markdown = await readDeploymentDefinition();
  const contract = extractSection(markdown, "## Specialist contract");

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
      `deployment-qa needs exactly one ${field} field`,
    );
  }

  assert.equal(
    extractField(contract, "Specialist perspective"),
    "Simulate a deployment QA engineer.",
  );
  assert.equal(
    extractField(contract, "Primary question"),
    "Can the system be configured, deployed, verified, and rolled back safely and repeatedly?",
  );
  assert.match(extractField(contract, "Priorities"), /packaging/);
  assert.match(extractField(contract, "Priorities"), /upgrade/);
  assert.match(extractField(contract, "Priorities"), /migration/);
  assert.match(extractField(contract, "Priorities"), /rollback/);
  assert.match(extractField(contract, "Decision rules"), /Static inspection/);
  assert.match(extractField(contract, "Decision rules"), /cannot prove/);
  assert.match(extractField(contract, "Decision rules"), /verdict-neutral/);
  assert.match(
    extractField(contract, "Evidence requirements"),
    /artifact digest or\s+equivalent immutable identity/,
  );
  assert.match(
    extractField(contract, "Evidence requirements"),
    /sanitized configuration digest/,
  );
  assert.match(
    extractField(contract, "Evidence requirements"),
    /pre-deployment state/,
  );
  assert.match(
    extractField(contract, "Evidence requirements"),
    /post-rollback identity and health result/,
  );
});

test("deployment QA has a bounded explicit time-box override", async () => {
  const markdown = await readDeploymentDefinition();
  const timeBox = extractSection(markdown, "## Time box");
  const selection = extractSection(markdown, "## Selection");
  const normalizedSelection = selection.replace(/\s+/g, " ");

  assert.match(timeBox, /default wall-clock time box is 60 minutes/);
  assert.match(timeBox, /explicit recorded override from 15 through 240 minutes/);
  assert.match(timeBox, /Reject a value outside that range before dispatch/);
  assert.match(timeBox, /`Not tested`/);

  for (const trigger of [
    "packaging",
    "environment configuration",
    "delivery automation",
    "upgrade",
    "migration execution",
    "deployment verification",
    "rollback",
  ]) {
    assert.match(normalizedSelection, new RegExp(trigger));
  }
  assert.match(normalizedSelection, /optional/);
  assert.match(normalizedSelection, /affected material risk/);
  assert.match(normalizedSelection, /smoke-qa first/);
  assert.match(normalizedSelection, /existence does not trigger it/);
});

test("deployment QA fails closed around targets and evidence", async () => {
  const markdown = await readDeploymentDefinition();
  const safety = extractSection(markdown, "## Safety limits");
  const method = extractSection(markdown, "## Method");
  const normalizedSafety = safety.replace(/\s+/g, " ");

  assert.match(normalizedSafety, /Disposable test target/);
  assert.match(normalizedSafety, /Never deploy to or roll back production or shared infrastructure/);
  assert.match(normalizedSafety, /Never delete a volume, database, backup/);
  assert.match(normalizedSafety, /sanitized configuration digests/);
  assert.match(normalizedSafety, /Mark each such flow `Observed only`/);
  assert.match(normalizedSafety, /never report it as deployed, verified, repeatable, or rolled back/);

  assert.match(method, /artifact digest or strongest equivalent\s+immutable identity/);
  assert.match(method, /pre-deployment artifact/);
  assert.match(method, /post-state only; it does not replace the\s+smoke-qa/);
  assert.match(method, /Route stored-data invariant checks to data-integrity-qa/);
  assert.match(method, /Static inspection alone cannot support\s+a claim/);
});

test("deployment QA keeps sibling ownership explicit", async () => {
  const markdown = await readDeploymentDefinition();
  const contract = extractSection(markdown, "## Specialist contract");
  const exclusions = extractField(contract, "Scope exclusions and escalation");

  for (const boundary of [
    /Smoke owns startup and the critical-flow gate/,
    /reliability owns failure, degradation, recovery, and alerting/,
    /data-integrity owns stored-state correctness/,
    /security owns unauthorized exposure or modification/,
    /regression owns historical and change attribution/,
  ]) {
    assert.match(exclusions, boundary);
  }
});

test("deployment QA uses the current report and lifecycle contract", async () => {
  const markdown = await readDeploymentDefinition();
  const isolation = extractSection(markdown, "## Isolation");
  const reports = extractSection(markdown, "## Reports");
  const normalizedIsolation = isolation.replace(/\s+/g, " ");
  const normalizedReports = reports.replace(/\s+/g, " ");

  assert.match(normalizedIsolation, /Specialist dispatch envelope/);
  assert.match(normalizedIsolation, /Mission modes/);
  assert.match(normalizedIsolation, /Lane identity never changes its visibility/);

  assert.match(normalizedReports, /one report-level state from the canonical vocabulary/);
  assert.match(normalizedReports, /time box or explicit override/);
  assert.match(normalizedReports, /\*\*Assumptions\*\*/);
  assert.match(normalizedReports, /Assumptions are not findings/);
  assert.match(normalizedReports, /supplied ledger ID/);
  assert.match(normalizedReports, /Confirmation dispositions/);
  assert.match(normalizedReports, /Apply `Blocked` as defined there/);
  assert.match(normalizedReports, /N\/A — discovery mission/);
  assert.match(normalizedReports, /report-local proposal ID/);
  assert.match(normalizedReports, /severity \| priority/);
  assert.match(normalizedReports, /safe evidence reference/);
  assert.match(normalizedReports, /sensitivity classification proposal/);
  assert.match(
    normalizedReports,
    /demonstrated deployment impact \| recommendation \| validation/,
  );
  assert.match(normalizedReports, /does not read or write the finding ledger/);
  assert.match(normalizedReports, /assigns stable IDs and statuses/);
  assert.match(normalizedReports, /\*\*Not tested\*\*/);
  assert.doesNotMatch(normalizedReports, /confidence/i);
  assert.doesNotMatch(normalizedReports, /per-finding verdict/i);
});
