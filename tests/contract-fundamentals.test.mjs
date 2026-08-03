import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lanePaths = [
  "qa-suite/references/agents/api-qa.md",
  "qa-suite/references/agents/bob-qa.md",
  "qa-suite/references/agents/compatibility-qa.md",
  "qa-suite/references/agents/data-integrity-qa.md",
  "qa-suite/references/agents/deployment-qa.md",
  "qa-suite/references/agents/performance-qa.md",
  "qa-suite/references/agents/regression-qa.md",
  "qa-suite/references/agents/reliability-qa.md",
  "qa-suite/references/agents/security-qa.md",
  "qa-suite/references/agents/smoke-qa.md",
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

function normalizeTriggerRows(markdown, heading) {
  return extractSection(markdown, heading)
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.includes("---"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.replaceAll("`", "").replace(/\s+/g, " ").trim())
        .join("|"),
    );
}

test("risk acceptance remains a human-controlled lifecycle contract", async () => {
  const [skill, readme, releaseCommand] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("README.md"),
    readRepositoryFile(".claude/commands/qa-release.md"),
  ]);
  const section = extractSection(skill, "### Risk acceptance");

  assert.match(section, /`accepted` and `wontfix` are finding statuses/);
  assert.match(section, /human is the only decision authority/);
  assert.match(section, /non-empty\s+`status_reason`/);
  assert.match(section, /mechanical transcription/);
  assert.match(section, /Exclude each currently valid/);
  assert.match(section, /`Known accepted risks`/);
  assert.match(section, /higher Severity voids acceptance/);
  assert.match(section, /wider\s+scope.*also voids it/s);
  assert.match(section, /equivalence.*cannot be established.*void/s);
  assert.match(section, /re-enters verdict computation/);

  const verdictVocabulary = extractSection(
    skill,
    "### Verdict vocabulary",
  );
  assert.doesNotMatch(verdictVocabulary, /`accepted`|`wontfix`/);
  assert.match(
    skill,
    /applies valid risk acceptance during final synthesis and then the\s+most-conservative-verdict rule/,
  );
  assert.match(
    readme,
    /Valid human-accepted risks are excluded during final synthesis; then the most conservative verdict wins/,
  );
  assert.match(
    releaseCommand,
    /Apply valid risk acceptance during final\s+synthesis, then apply the most conservative verdict/,
  );
});

test("P3 never grants risk acceptance", async () => {
  const matrix = await readRepositoryFile(
    "qa-suite/references/severity-priority-matrix.md",
  );

  assert.match(matrix, /\| P3 \| No planned fix this cycle \|/);
  assert.match(matrix, /`P3` is a scheduling value only/);
  assert.match(matrix, /does not set or imply `accepted` or\s+`wontfix`/);
  assert.match(matrix, /never excludes a finding from verdict computation/);
});

test("regression history labels never override impact-based Severity", async () => {
  const [skill, matrix] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("qa-suite/references/severity-priority-matrix.md"),
  ]);
  const verdictVocabulary = extractSection(skill, "### Verdict vocabulary");
  const failureClasses = extractSection(matrix, "## Failure class → severity");

  assert.match(
    verdictVocabulary,
    /failure class\s+describes what was observed; it does not set Severity/,
  );
  assert.match(
    verdictVocabulary,
    /regression, new-failure, and flaky labels describe history or repeatability,\s+not impact/,
  );
  assert.match(
    failureClasses,
    /Regression.*history or repeatability only\. They do not raise or lower impact/s,
  );
  assert.match(
    failureClasses,
    /core flow unusable, data loss, or crash → S1; major flow broken with no workaround → S2; degraded flow with a workaround or limited context → S3/,
  );
});

test("priority remains independent scheduling metadata", async () => {
  const [skill, matrix] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("qa-suite/references/severity-priority-matrix.md"),
  ]);
  const verdictVocabulary = extractSection(skill, "### Verdict vocabulary");
  const severityVerdict = extractSection(matrix, "## Severity → verdict");

  assert.match(matrix, /They are independent axes/u);
  assert.match(
    severityVerdict,
    /Severity drives the verdict; priority drives scheduling only/u,
  );
  assert.match(
    verdictVocabulary,
    /Severity drives the verdict; priority drives scheduling\s+only/su,
  );
});

test("API idempotency core-flow failure uses canonical impact and verdict rules", async () => {
  const [skill, matrix, api] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("qa-suite/references/severity-priority-matrix.md"),
    readRepositoryFile("qa-suite/references/agents/api-qa.md"),
  ]);
  const verdictVocabulary = extractSection(skill, "### Verdict vocabulary");
  const severityImpact = extractSection(
    matrix,
    "## Severity — impact if left unfixed",
  );
  const severityVerdict = extractSection(matrix, "## Severity → verdict");
  const testMethod = extractSection(api, "## Test Method");

  assert.match(api, /idempotency; real consumer\s+impact/u);
  assert.match(
    testMethod,
    /\*\*Idempotency\*\*.*confirm repeating it\s+doesn't duplicate state/su,
  );
  assert.match(
    severityImpact,
    /\| S1 \| Blocker \| Core flow unusable, data loss, crash, exposed secret, or auth bypass \|/u,
  );
  assert.match(
    severityVerdict,
    /Any confirmed S1\/S2, or a core flow demonstrably cannot be completed \| No-Go/u,
  );
  assert.match(
    verdictVocabulary,
    /No-Go.*at least one confirmed S1\/S2 finding in scope, or a core\s+flow demonstrably cannot be completed/su,
  );
  assert.match(
    severityVerdict,
    /Severity drives the verdict; priority drives scheduling only/u,
  );
});

test("supported compatibility core-flow failure uses canonical No-Go", async () => {
  const [skill, matrix] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("qa-suite/references/severity-priority-matrix.md"),
  ]);
  const verdictVocabulary = extractSection(skill, "### Verdict vocabulary");
  const failureClasses = extractSection(matrix, "## Failure class → severity");
  const severityVerdict = extractSection(matrix, "## Severity → verdict");

  assert.match(
    failureClasses,
    /Compatibility.*On a supported combination: core flow unusable → S1/s,
  );
  assert.match(
    severityVerdict,
    /Any confirmed S1\/S2, or a core flow demonstrably cannot be completed \| No-Go/,
  );
  assert.match(
    verdictVocabulary,
    /No-Go.*at least one confirmed S1\/S2 finding in scope, or a core\s+flow demonstrably cannot be completed/s,
  );
});

test("verbatim dispatch has one canonical definition", async () => {
  const skill = await readRepositoryFile("qa-suite/SKILL.md");
  const headingCount = skill
    .split("\n")
    .filter((line) => line === "### Verbatim dispatch").length;
  const section = extractSection(skill, "### Verbatim dispatch");

  assert.equal(headingCount, 1);
  assert.match(section, /explicit human request/);
  assert.match(section, /named-flow entries in `qa-context\.md`/);
  assert.match(section, /finding-ledger rows/);
  assert.match(section, /Do not paraphrase/);
  assert.match(section, /Hard boundaries override verbatim copying/);
  assert.match(section, /only normative definition/);
});

test("smoke No-Go and Blocked both gate deeper lanes", async () => {
  const [skill, readme, regressionCommand, releaseCommand] = await Promise.all(
    [
      readRepositoryFile("qa-suite/SKILL.md"),
      readRepositoryFile("README.md"),
      readRepositoryFile(".claude/commands/qa-regression.md"),
      readRepositoryFile(".claude/commands/qa-release.md"),
    ],
  );

  assert.match(skill, /If smoke reports\s+`No-Go` or `Blocked`, stop/);
  assert.match(
    skill,
    /If smoke reports `No-Go` or\s+`Blocked`, nothing else runs/,
  );
  assert.match(readme, /If smoke is `No-Go` or `Blocked`, deeper agents stop/);
  assert.match(
    regressionCommand,
    /If smoke reports `No-Go` or `Blocked`, stop/,
  );
  assert.match(
    releaseCommand,
    /If smoke reports `No-Go` or `Blocked`, stop/,
  );
  assert.match(regressionCommand, /After a Go-family smoke verdict/);
  assert.match(releaseCommand, /After a Go-family smoke verdict/);
  assert.match(skill, /After a Go-family smoke verdict/);
  assert.match(readme, /after a Go-family smoke verdict/);

  assert.doesNotMatch(skill, /If smoke reports\s+No-Go,/);
  assert.doesNotMatch(skill, /stop deeper agents on smoke No-Go/);
  assert.doesNotMatch(readme, /If smoke is No-Go,/);
});

test("every shipped lane declares a numeric time box", async () => {
  const lanes = await Promise.all(
    lanePaths.map(async (path) => ({
      path,
      markdown: await readRepositoryFile(path),
    })),
  );

  for (const { path, markdown } of lanes) {
    const section = extractSection(markdown, "## Time box");
    const minuteValues = [
      ...section.matchAll(/(?<![-\d])([1-9]\d*)[- ]minutes?\b/g),
    ].map((match) => Number(match[1]));

    assert.doesNotMatch(section, /-\d+\s+minutes?\b/);
    assert.ok(minuteValues.length > 0, `${path} needs a numeric minute limit`);
    assert.ok(
      minuteValues.every((value) => value > 0),
      `${path} time boxes must be positive`,
    );

    if (path.endsWith("/smoke-qa.md")) {
      assert.match(section, /does not accept a dispatch\s+time-box override/);
    } else if (
      path.endsWith("/reliability-qa.md") ||
      path.endsWith("/deployment-qa.md") ||
      path.endsWith("/data-integrity-qa.md")
    ) {
      assert.match(section, /default wall-clock time box is 60 minutes/);
      assert.match(section, /15 through 240\s+minutes/);
      assert.match(section, /explicit recorded/);
    } else {
      assert.match(section, /different\s+positive limit/);
    }
  }

  const bob = lanes.find(({ path }) => path.endsWith("/bob-qa.md")).markdown;
  assert.match(extractSection(bob, "## Time box"), /15-minute.*60-minute/s);

  const skill = await readRepositoryFile("qa-suite/SKILL.md");
  assert.match(
    skill,
    /effective time box\s+is a valid positive dispatch override permitted by the lane when one is\s+supplied; otherwise it is the lane file's default/,
  );
  assert.match(
    skill,
    /Reject a zero, negative, or non-numeric\s+override before dispatch/,
  );
  assert.match(
    skill,
    /supplied invalid\s+override stops dispatch until corrected; it never falls back silently/,
  );
});

test("Bob preserves an IA-01 task-boundary failure through execution", async () => {
  const bob = await readRepositoryFile(
    "qa-suite/references/agents/bob-qa.md",
  );
  const reasoning = extractSection(
    bob,
    "### Fresh-user reasoning sequence",
  );
  const iaPass = extractSection(
    bob,
    "### Information architecture and comprehension pass",
  );
  const taskBoundaryContract = `${reasoning}\n${iaPass}`.replace(/\s+/g, " ");

  assert.match(
    taskBoundaryContract,
    /visible order[\s\S]+first required input or starting control[\s\S]+`Separated` or `Interleaved`[\s\S]+distinct secondary job[\s\S]+failed IA-01 probe before task execution[\s\S]+Later task completion cannot convert that pre-action failure into a pass[\s\S]+`Interleaved` span[\s\S]+commit action inside the initial viewport[\s\S]+later successful task completion do not disprove it/,
  );
});

test("broad triggers are impact-scoped and mirrored publicly", async () => {
  const [skill, readme, releaseCommand, qaContext] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("README.md"),
    readRepositoryFile(".claude/commands/qa-release.md"),
    readRepositoryFile("qa-context.md"),
  ]);
  const triggerRows = normalizeTriggerRows(skill, "## When to run what");

  assert.deepEqual(normalizeTriggerRows(readme, "## Usage"), triggerRows);

  const rowsByEvent = new Map(
    triggerRows.slice(1).map((row) => {
      const [event, run, skip] = row.split("|");
      return [event, { run, skip }];
    }),
  );

  assert.match(rowsByEvent.get("Every PR / merge candidate").run, /when shipped/);
  assert.match(
    rowsByEvent.get("Backend/API-touching change").run,
    /user-facing consumer/,
  );
  assert.match(rowsByEvent.get("Before a release").run, /every applicable/);
  assert.match(rowsByEvent.get("Before a release").run, /api-qa for an API/);
  assert.match(rowsByEvent.get("Before a release").skip, /primary risk is absent/);
  assert.match(rowsByEvent.get("Dependency updates").run, /when the dependency/);
  assert.match(rowsByEvent.get("Reliability-risk change").run, /material retry/);
  assert.match(rowsByEvent.get("Deployment-risk change").run, /material packaging/);
  assert.match(rowsByEvent.get("Persistent-data change").run, /material write/);
  assert.match(rowsByEvent.get("Before a release").run, /reliability-qa/);
  assert.match(rowsByEvent.get("Before a release").run, /deployment-qa/);
  assert.match(rowsByEvent.get("Before a release").run, /data-integrity-qa/);
  assert.match(rowsByEvent.get("First run on a new project").run, /only for/);
  assert.match(releaseCommand, /canonical trigger table/);
  assert.match(releaseCommand, /do not run a lane only\s+because it exists/);
  assert.match(
    qaContext,
    /routine QA validates tracked\s+source and plugin metadata with the declared commands/,
  );
  assert.match(
    qaContext,
    /Release preparation\s+generates ignored archives outside QA/,
  );
  assert.match(
    qaContext,
    /explicitly scoped release audit\s+validates the prebuilt archives/,
  );
  assert.match(
    qaContext,
    /During an explicitly scoped release audit, validate the prebuilt/,
  );
});
