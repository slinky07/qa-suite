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

test("candidate identity is configured and visible in every lane report", async () => {
  const [
    skill,
    template,
    example,
    repositoryContext,
    claudeSmokeTemplate,
    codexSmokeTemplate,
    ...lanes
  ] =
    await Promise.all([
      readRepositoryFile("qa-suite/SKILL.md"),
      readRepositoryFile("qa-suite/assets/qa-context-template.md"),
      readRepositoryFile("examples/qa-context.example.md"),
      readRepositoryFile("qa-context.md"),
      readRepositoryFile(
        "qa-suite/assets/project-agent-smoke-qa.claude.md",
      ),
      readRepositoryFile(
        "qa-suite/assets/project-agent-smoke-qa.codex.toml",
      ),
      ...lanePaths.map(readRepositoryFile),
    ]);

  for (const context of [template, example, repositoryContext]) {
    assert.match(context, /\*\*Candidate identity check:\*\*/);
  }

  const reportRules = extractSection(skill, "## Reports");
  assert.match(reportRules, /Candidate identity is visible/);
  assert.match(reportRules, /strongest available candidate identifier/);
  assert.match(reportRules, /identity\s+check result/);

  for (const smokeTemplate of [claudeSmokeTemplate, codexSmokeTemplate]) {
    assert.match(smokeTemplate, /Environment section/);
    assert.match(smokeTemplate, /declared candidate/);
    assert.match(smokeTemplate, /Candidate identity check/);
  }

  lanes.forEach((lane, index) => {
    const reports = extractSection(lane, "## Reports");
    assert.match(reports, /\*\*Environment\*\*/, lanePaths[index]);
    assert.match(reports, /declared candidate/, lanePaths[index]);
    assert.match(reports, /candidate\s+identity check/, lanePaths[index]);
  });
});

test("lane reports propose ledger rows without reading the ledger", async () => {
  const lanes = await Promise.all(lanePaths.map(readRepositoryFile));

  lanes.forEach((lane, index) => {
    const reports = extractSection(lane, "## Reports");
    const normalized = reports.replace(/\s+/g, " ");

    for (const field of [
      "report-local proposal ID",
      "component",
      "location",
      "oracle",
      "severity",
      "priority",
      "sanitized ordered repro(?:duction)? steps",
      "expected result",
      "actual result",
      "environment",
      "safe evidence reference",
      "sensitivity classification proposal",
    ]) {
      assert.match(normalized, new RegExp(field), lanePaths[index]);
    }

    assert.match(normalized, /supplied ledger ID/, lanePaths[index]);
    assert.match(
      normalized,
      /confirmation missions.*Confirmation dispositions/,
      lanePaths[index],
    );
    assert.match(
      normalized,
      /Apply `Blocked` as defined there, including its mutation-dependent rule/,
      lanePaths[index],
    );
    assert.doesNotMatch(normalized, /Blocked` only/, lanePaths[index]);
    assert.match(
      normalized,
      /regression missions: supplied ledger ID \| candidate \| lane result \| evidence/,
      lanePaths[index],
    );
    assert.match(normalized, /N\/A — discovery mission/, lanePaths[index]);
    assert.match(
      normalized,
      /recurrence.*finding proposal linked to the supplied ledger ID.*orchestrator matches it.*`regressed` transition/,
      lanePaths[index],
    );
    assert.match(
      normalized,
      /Only newly observed different behavior is a separate finding proposal/,
      lanePaths[index],
    );
    assert.match(
      normalized,
      /does not read or write the finding ledger/,
      lanePaths[index],
    );
    assert.match(
      normalized,
      /orchestrator validates and matches proposals, assigns stable IDs and statuses, and reconciles the ledger/,
      lanePaths[index],
    );
    assert.match(normalized, /\*\*Not tested\*\*/, lanePaths[index]);
  });

  const smokeReports = extractSection(lanes.at(-1), "## Reports");
  assert.doesNotMatch(smokeReports, /no severity\/priority matrix/);
  assert.match(
    smokeReports.replace(/\s+/g, " "),
    /confirmed product failure.*references\/severity-priority-matrix\.md/,
  );
});

test("mission modes preserve discovery isolation and lifecycle visibility", async () => {
  const skill = await readRepositoryFile("qa-suite/SKILL.md");
  const lifecycle = extractSection(skill, "## Post-fix lifecycle");
  const missions = extractSection(lifecycle, "### Mission modes");

  assert.match(lifecycle, /inert unless.*`open` or\s+`regressed`/s);
  assert.match(lifecycle, /Routine runs\s+remain discovery missions/);
  assert.match(missions, /`discovery` \(default\)/);
  assert.match(missions, /Inject\s+no finding manifest/);
  assert.match(missions, /no graduated regression corpus/);
  assert.match(missions, /`confirmation`.*unresolved finding manifest/s);
  assert.match(missions, /`regression`.*fixed findings/s);
  assert.match(missions, /Mission mode, not lane identity/);
});

test("post-fix confirmation is candidate-bound and neutrally dispatched", async () => {
  const skill = await readRepositoryFile("qa-suite/SKILL.md");
  const lifecycle = extractSection(skill, "## Post-fix lifecycle");
  const candidate = extractSection(
    lifecycle,
    "### Candidate identity and freeze",
  );
  const confirmation = extractSection(
    lifecycle,
    "### Confirmation missions",
  );

  assert.match(candidate, /freeze one revision or artifact/);
  assert.match(candidate, /rebuild or restart/);
  assert.match(candidate, /Candidate identity check/);
  assert.match(candidate, /full commit SHA plus worktree state/);
  assert.match(candidate, /cannot be tied.*`Blocked`/s);
  assert.match(candidate, /moved `HEAD`.*invalid/s);

  for (const field of [
    "finding ID",
    "current frozen candidate",
    "recorded environment",
    "recorded reproduction steps",
    "original expected result",
    "original actual result",
    "recorded evidence reference",
  ]) {
    assert.match(confirmation, new RegExp(field));
  }

  assert.match(confirmation, /originating lane/);
  assert.match(confirmation, /Do not create\s+a confirmation lane/);
  assert.match(confirmation, /development conversation/);
  assert.match(confirmation, /fix\s+explanation/);
  assert.match(confirmation, /fix\s+diff/);
  assert.match(confirmation, /expected verdict/);
  assert.match(confirmation, /steering language/);
  assert.match(
    confirmation,
    /What is the present disposition of finding X on\s+candidate C\?/,
  );
  assert.match(confirmation, /new ledger entry/);
  assert.match(confirmation, /never folds\s+new behavior.*disposition/s);
});

test("four dispositions map into the canonical verdict system", async () => {
  const skill = await readRepositoryFile("qa-suite/SKILL.md");
  const lifecycle = extractSection(skill, "## Post-fix lifecycle");
  const dispositions = extractSection(
    lifecycle,
    "### Confirmation dispositions",
  );
  const synthesis = extractSection(
    lifecycle,
    "### Disposition synthesis",
  );

  for (const disposition of [
    "`Fixed`",
    "`Still present`",
    "`Partial`",
    "`Blocked`",
  ]) {
    assert.ok(dispositions.includes(disposition));
  }

  assert.match(dispositions, /There is no `Cannot reproduce` disposition/);
  assert.match(dispositions, /any recurrence is not `Fixed`/);
  assert.match(dispositions, /Hard boundaries/);
  assert.match(dispositions, /without a Disposable test target.*`Blocked`/s);
  assert.match(dispositions, /sets a row to `fixed` only from a `Fixed`/);
  assert.match(dispositions, /`Blocked` does not change/);
  assert.match(dispositions, /enters\s+the ledger as `regressed`/);

  assert.match(synthesis, /S1\/S2.*`Still present` or `Partial`.*`No-Go`/s);
  assert.match(synthesis, /only `Blocked` S1\/S2.*`Blocked`/s);
  assert.match(synthesis, /only S3\/S4.*`Go with findings`/s);
  assert.match(synthesis, /every in-scope finding is `Fixed`.*`Go`/s);
  assert.match(synthesis, /canonical verdict vocabulary/);
  assert.match(synthesis, /`accepted` and `wontfix`/);
  assert.match(synthesis, /`Known accepted risks`/);
});

test("candidate supersession gates impact-scoped post-fix synthesis", async () => {
  const [skill, readme] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("README.md"),
  ]);
  const lifecycle = extractSection(skill, "## Post-fix lifecycle");
  const supersession = extractSection(
    lifecycle,
    "### Supersession and impact scope",
  );

  assert.match(
    supersession,
    /Never combine evidence from different candidate identifiers/,
  );
  assert.match(supersession, /Mark older candidate evidence `Superseded`/);
  assert.match(supersession, /freeze and rebuild or restart/);
  assert.match(supersession, /run smoke, always/);
  assert.match(supersession, /one confirmation mission per unresolved finding/);
  assert.match(supersession, /auditable change-impact analysis/);
  assert.match(supersession, /every lane that was skipped/);
  assert.match(supersession, /Full recertification.*explicit release-audit/s);
  assert.match(
    supersession,
    /`Finding \| Candidate \| Disposition \| Evidence`/,
  );
  assert.match(supersession, /`Finding` contains the ledger finding ID/);
  assert.match(
    supersession,
    /`Evidence` contains a safe\s+lane-report or evidence reference/,
  );
  assert.match(supersession, /does not repeat the lane evidence/);
  assert.match(supersession, /`Fixed` finding gets one row and no added narrative/);
  assert.match(
    supersession,
    /Detailed prose is reserved for `Still present`, `Partial`, `Blocked`, or a\s+material limitation/,
  );

  const freeze = supersession.indexOf("freeze and rebuild or restart");
  const smoke = supersession.indexOf("run smoke, always");
  const confirmation = supersession.indexOf(
    "one confirmation mission per unresolved finding",
  );
  const regression = supersession.indexOf(
    "run regression lanes selected by an auditable",
  );
  assert.ok(freeze < smoke && smoke < confirmation && confirmation < regression);

  assert.match(readme, /Post-fix cycle with unresolved findings/);
  assert.match(readme, /Routine discovery runs receive no finding manifest/);
});

test("temporary confirmation retains the exact historical identity", async () => {
  const [skill, readme] = await Promise.all([
    readRepositoryFile("qa-suite/SKILL.md"),
    readRepositoryFile("README.md"),
  ]);
  const confirmations = extractSection(
    extractSection(skill, "## Post-fix lifecycle"),
    "### Confirmation missions",
  );

  assert.match(confirmations, /originating identity is temporary/);
  assert.match(confirmations, /resolve that exact historical ID/);
  assert.match(confirmations, /Blocked — missing temporary\s+specialist <exact-id>/);
  assert.match(confirmations, /leave lifecycle state unchanged/);
  assert.match(confirmations, /never substitute.*same slug/s);
  assert.match(readme, /same exact historical\s+identity/);
  assert.match(readme, /lifecycle row stays unchanged/);
});
