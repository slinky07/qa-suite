import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  initializeLedger,
  parseJsonStrict,
  migrateLedger,
  replaceLedger,
  preflightLane,
  selectManifest,
  validateFindingRows,
  validateProject,
  validateSchemaContract,
} from "../qa-suite/scripts/finding-ledger.mjs";
import { createSpecialistEntry } from "../qa-suite/scripts/specialist-registry.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const fixtureComponents = new Set([
  "authentication",
  "grocery-export",
  "pantry-search",
  "preferences",
]);

function repositoryUrl(path) {
  return new URL(path, repositoryRoot);
}

async function readText(path) {
  return readFile(repositoryUrl(path), "utf8");
}

async function readJson(path) {
  return parseJsonStrict(await readText(path), path);
}

async function readJsonl(path) {
  const source = await readText(path);
  const lines = source.split("\n");
  if (lines.at(-1) === "") lines.pop();
  assert.ok(lines.every((line) => line.length > 0), `${path} has a blank line`);
  return lines.map((line, index) =>
    parseJsonStrict(line, `${path}:${index + 1}`),
  );
}

function fixtureContext(repoVisibility = "public") {
  return {
    components: fixtureComponents,
    repoVisibility,
  };
}

function clone(value) {
  return structuredClone(value);
}

function digest(source) {
  return createHash("sha256").update(source).digest("hex");
}

function temporaryDefinition() {
  return {
    slug: "cache-failover",
    specialist_perspective: "Cache failover QA engineer",
    primary_question:
      "Does cache failover preserve the documented recovery objective?",
    specialist_mission: "Exercise bounded cache failover on disposable state.",
    priorities: ["Recovery objective"],
    decision_rules: ["Require exercised runtime evidence."],
    evidence_requirements: ["Retain failure and recovery timestamps."],
    scope_exclusions: ["Do not use production or shared state."],
    selection_criteria: ["No shipped lane owns the cache-specific risk."],
    definition_rationale: "The risk is application-specific cache recovery.",
    time_box_minutes: 60,
  };
}

function syntheticDashToken(prefix) {
  return [
    prefix,
    "synthetic",
    "fixture",
    "not",
    "a",
    "credential",
  ].join("-");
}

function syntheticJoinedToken(prefix) {
  return `${prefix}${[
    "synthetic",
    "fixture",
    "not",
    "a",
    "credential",
  ].join("_")}`;
}

function runGit(repository, ...args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: "pipe",
  });
}

async function createTestRepository() {
  const repository = await mkdtemp(join(tmpdir(), "finding-ledger-test-"));
  runGit(repository, "init", "-q");
  await writeFile(
    join(repository, "qa-context.md"),
    `# QA Context

## Project

- **Report output folder:** QA/

## Finding ledger

- **Path:** findings.jsonl
- **Repository visibility (\`repo_visibility\`):** public
- **Named components:** authentication
`,
  );
  await writeFile(join(repository, "findings.jsonl"), "");
  await writeFile(join(repository, ".gitignore"), "QA/\n");
  runGit(
    repository,
    "add",
    ".gitignore",
    "qa-context.md",
    "findings.jsonl",
  );
  return repository;
}

async function configureTemporaryRegistry(repository, specialists) {
  const contextPath = join(repository, "qa-context.md");
  const context = await readFile(contextPath, "utf8");
  await writeFile(
    contextPath,
    context.replace(
      "- **Report output folder:** QA/",
      "- **Report output folder:** QA/\n- **Temporary specialist registry:** qa-specialists.json",
    ),
  );
  await writeFile(
    join(repository, "qa-specialists.json"),
    `${JSON.stringify({ schema_version: 1, specialists }, null, 2)}\n`,
  );
  runGit(repository, "add", "qa-context.md", "qa-specialists.json");
}

test("strict parser rejects duplicate JSON object keys", () => {
  assert.throws(
    () => parseJsonStrict('{"id":"one","id":"two"}', "duplicate.json"),
    /duplicate object key "id"/,
  );
});

test("schema and fixtures enforce every version-1 row", async () => {
  const [schema, rows] = await Promise.all([
    readJson("qa-suite/references/finding-ledger-v1.schema.json"),
    readJsonl("tests/fixtures/finding-ledger-valid.jsonl"),
  ]);

  validateSchemaContract(schema);
  assert.deepEqual(
    validateFindingRows(rows, schema, fixtureContext()),
    [],
  );
  assert.equal(new Set(rows.map(({ id }) => id)).size, rows.length);
  assert.deepEqual(
    [...new Set(
      rows
        .filter(
          ({ lane, severity }) =>
            lane === "security-qa" && ["S1", "S2"].includes(severity),
        )
        .map(({ severity }) => severity),
    )].sort(),
    ["S1", "S2"],
  );
});

test("invalid schema, row, version, and duplicate ID fail loudly", async () => {
  const [schema, rows] = await Promise.all([
    readJson("qa-suite/references/finding-ledger-v1.schema.json"),
    readJsonl("tests/fixtures/finding-ledger-valid.jsonl"),
  ]);

  const invalidSchema = clone(schema);
  invalidSchema.properties.id.pattern = "[";
  assert.throws(
    () => validateSchemaContract(invalidSchema),
    /schema pattern is invalid/,
  );

  const incompatibleSchema = clone(schema);
  incompatibleSchema.properties.id.type = "number";
  assert.throws(
    () => validateFindingRows(rows, incompatibleSchema, fixtureContext()),
    /finding row 1\.id must be a number/,
  );

  const unsupportedSchema = clone(schema);
  unsupportedSchema.properties.id.maxLength = 100;
  assert.throws(
    () => validateFindingRows(rows, unsupportedSchema, fixtureContext()),
    /unsupported schema keyword maxLength/,
  );

  const unsupportedFormat = clone(schema);
  unsupportedFormat.properties.id.format = "email";
  assert.throws(
    () => validateSchemaContract(unsupportedFormat),
    /unsupported schema format email/,
  );

  const invalidConditional = clone(schema);
  invalidConditional.allOf[0].if.properties.status.pattern = "[";
  assert.throws(
    () => validateSchemaContract(invalidConditional),
    /schema pattern is invalid/,
  );

  for (const applicator of ["allOf", "oneOf"]) {
    const emptyApplicator = clone(schema);
    emptyApplicator[applicator] = [];
    assert.throws(
      () => validateSchemaContract(emptyApplicator),
      new RegExp(`${applicator} must be a non-empty array`),
    );
  }

  const invalidId = clone(rows);
  invalidId[0].id = "bad id";
  assert.throws(
    () => validateFindingRows(invalidId, schema, fixtureContext()),
    /id does not match the schema/,
  );

  const unsupportedVersion = clone(rows);
  unsupportedVersion[0].schema_version = 2;
  assert.throws(
    () => validateFindingRows(unsupportedVersion, schema, fixtureContext()),
    /schema_version must equal 1/,
  );

  const duplicateId = clone(rows);
  duplicateId[1].id = duplicateId[0].id;
  assert.throws(
    () => validateFindingRows(duplicateId, schema, fixtureContext()),
    /duplicate finding id/,
  );

  const reorderedDuplicateReport = clone(rows[0]);
  const report = reorderedDuplicateReport.reports[0];
  reorderedDuplicateReport.reports.push({
    candidate: report.candidate,
    pointer: report.pointer,
    lane: report.lane,
  });
  assert.throws(
    () =>
      validateFindingRows(
        [reorderedDuplicateReport],
        schema,
        fixtureContext(),
      ),
    /must contain unique items/,
  );

  const missingCurrentCandidateProvenance = clone(rows[0]);
  missingCurrentCandidateProvenance.reports.forEach((pointer) => {
    pointer.candidate = "different-candidate";
  });
  assert.throws(
    () =>
      validateFindingRows(
        [missingCurrentCandidateProvenance],
        schema,
        fixtureContext(),
      ),
    /needs report provenance for candidate_last_confirmed/,
  );
});

test("report pointers remain bound to one exact candidate across rows", async () => {
  const [v1Schema, v2Schema, rows] = await Promise.all([
    readJson("qa-suite/references/finding-ledger-v1.schema.json"),
    readJson("qa-suite/references/finding-ledger.schema.json"),
    readJsonl("tests/fixtures/finding-ledger-valid.jsonl"),
  ]);

  for (const [schemaVersion, schema] of [
    [1, v1Schema],
    [2, v2Schema],
  ]) {
    const first = clone(rows[0]);
    const second = clone(rows[0]);
    first.schema_version = schemaVersion;
    second.schema_version = schemaVersion;
    second.id = `FND-shared-report-v${schemaVersion}`;
    second.reports = [clone(first.reports[0])];
    second.reports[0].lane = "api-qa";

    assert.doesNotThrow(() =>
      validateFindingRows([first, second], schema, fixtureContext()),
    );

    second.candidate_first_seen = "different-candidate";
    second.candidate_last_confirmed = "different-candidate";
    second.reports[0].candidate = "different-candidate";
    assert.throws(
      () => validateFindingRows([first, second], schema, fixtureContext()),
      /report.*pointer is already bound to a different candidate/,
    );
  }
});

test("lifecycle visibility yields confirmation and regression inputs", async () => {
  const rows = await readJsonl("tests/fixtures/finding-ledger-valid.jsonl");
  const confirmationIds = selectManifest(rows, "confirmation")
    .map(({ id }) => id)
    .sort();
  const regressionRows = selectManifest(rows, "regression");

  assert.deepEqual(confirmationIds, [
    "FND-export-header-regression",
    "FND-login-empty-response",
    "FND-security-reset-enumeration",
    "FND-security-session-bypass",
  ]);
  assert.deepEqual(
    regressionRows.map(({ id }) => id),
    ["FND-pantry-filter-reset"],
  );
  assert.ok(
    regressionRows.every(
      ({ defect_record: record, sensitivity }) =>
        typeof record === "object" &&
        record.repro_steps.length > 0 &&
        sensitivity.storage === "committed",
    ),
  );
  assert.deepEqual(selectManifest(rows, "discovery"), []);
});

test("context-aware redaction rejects unsafe public and private rows", async () => {
  const [schema, rows] = await Promise.all([
    readJson("qa-suite/references/finding-ledger-v1.schema.json"),
    readJsonl("tests/fixtures/finding-ledger-valid.jsonl"),
  ]);
  const securityRow = rows.find(({ severity }) => severity === "S1");
  const unsafe = clone(securityRow);
  unsafe.defect_record = clone(rows[0].defect_record);
  unsafe.sensitivity = {
    classification: "standard",
    storage: "committed",
    clearance: null,
  };

  assert.throws(
    () => validateFindingRows([unsafe], schema, fixtureContext("public")),
    /security S1\/S2 requires sensitive or human-cleared classification/,
  );
  assert.throws(
    () => validateFindingRows([unsafe], schema, fixtureContext("private")),
    /security S1\/S2 requires sensitive or human-cleared classification/,
  );

  const uncertain = clone(rows[0]);
  uncertain.sensitivity = {
    classification: "uncertain",
    storage: "committed",
    clearance: null,
  };
  assert.throws(
    () => validateFindingRows([uncertain], schema, fixtureContext("private")),
    /sensitive class must remain redacted/,
  );

  const cleared = clone(securityRow);
  cleared.defect_record = clone(rows[0].defect_record);
  cleared.sensitivity = {
    classification: "human-cleared",
    storage: "committed",
    clearance: {
      by: "repository owner",
      at: "2026-07-25T12:00:00Z",
      reason: "The repro was sanitized and contains no exploit details.",
    },
  };
  assert.doesNotThrow(() =>
    validateFindingRows([cleared], schema, fixtureContext("private")),
  );
  assert.throws(
    () => validateFindingRows([cleared], schema, fixtureContext("public")),
    /public security S1\/S2 record must be redacted/,
  );
});

test("whitespace-only strings and invalid calendar timestamps fail", async () => {
  const [schema, rows] = await Promise.all([
    readJson("qa-suite/references/finding-ledger-v1.schema.json"),
    readJsonl("tests/fixtures/finding-ledger-valid.jsonl"),
  ]);

  const whitespaceRepro = clone(rows[0]);
  whitespaceRepro.defect_record.repro_steps[0] = " \t ";
  assert.throws(
    () => validateFindingRows([whitespaceRepro], schema, fixtureContext()),
    /must be a non-empty string/,
  );

  const whitespaceReason = clone(rows[0]);
  whitespaceReason.status = "accepted";
  whitespaceReason.status_reason = " ";
  assert.throws(
    () => validateFindingRows([whitespaceReason], schema, fixtureContext()),
    /must be a non-empty string/,
  );

  const invalidDate = clone(rows[0]);
  invalidDate.first_seen = "2026-02-30T00:00:00Z";
  assert.throws(
    () => validateFindingRows([invalidDate], schema, fixtureContext()),
    /valid UTC calendar date-time/,
  );

  const malformedDate = clone(rows[0]);
  malformedDate.first_seen = "1Z";
  assert.throws(
    () => validateFindingRows([malformedDate], schema, fixtureContext()),
    /UTC date-time ending in Z/,
  );

  const whitespaceClearance = clone(
    rows.find(({ severity }) => severity === "S1"),
  );
  whitespaceClearance.defect_record = clone(rows[0].defect_record);
  whitespaceClearance.sensitivity = {
    classification: "human-cleared",
    storage: "committed",
    clearance: {
      by: "repository owner",
      at: "2026-07-25T12:00:00Z",
      reason: " ",
    },
  };
  assert.throws(
    () =>
      validateFindingRows(
        [whitespaceClearance],
        schema,
        fixtureContext("private"),
      ),
    /must be a non-empty string/,
  );

  const validLeapDate = clone(rows[0]);
  validLeapDate.first_seen = "2028-02-29T00:00:00.1234Z";
  validLeapDate.last_seen = "2028-02-29T00:00:00.12340Z";
  assert.doesNotThrow(() =>
    validateFindingRows([validLeapDate], schema, fixtureContext()),
  );

  const impossibleChronology = clone(rows[0]);
  impossibleChronology.first_seen = "2026-07-21T00:00:00Z";
  impossibleChronology.last_seen = "2026-07-20T23:59:59.9999Z";
  assert.throws(
    () =>
      validateFindingRows(
        [impossibleChronology],
        schema,
        fixtureContext(),
      ),
    /last_seen cannot be before first_seen/,
  );
});

test("secret-like material and credential URLs are rejected", async () => {
  const [schema, rows] = await Promise.all([
    readJson("qa-suite/references/finding-ledger-v1.schema.json"),
    readJsonl("tests/fixtures/finding-ledger-valid.jsonl"),
  ]);
  const unsafePointers = [
    [
      "https://ci.example/run?token=secret-value",
      /secret-like material|sensitive URL query key/,
    ],
    ["https://alice:sup3rsecret@example.com/run", /credential-bearing URL/],
    ["postgres://alice:sup3rsecret@db.example/app", /credential-bearing URL/],
    [
      "postgres%3A%2F%2Falice%3Asup3rsecret%40db.example%2Fapp",
      /credential-bearing URL/,
    ],
    [
      "https://ci.example/run?access_token=secret-value",
      /sensitive URL query key/,
    ],
    [
      ["Authorization:", "Bearer", "synthetic-fixture-value"].join(" "),
      /secret-like material/,
    ],
    [syntheticJoinedToken("github_pat_"), /secret-like material/],
    [syntheticDashToken("glpat"), /secret-like material/],
    [syntheticDashToken("gldt"), /secret-like material/],
    [syntheticDashToken("glrt"), /secret-like material/],
    [syntheticDashToken("glcbt"), /secret-like material/],
    [syntheticDashToken("xoxb"), /secret-like material/],
    [syntheticDashToken("xapp"), /secret-like material/],
    [syntheticDashToken("xwfp"), /secret-like material/],
    [syntheticDashToken("xoxe"), /secret-like material/],
    [syntheticDashToken("xoxo"), /secret-like material/],
    [
      ["_gitlab_session", "synthetic-fixture-value"].join("="),
      /secret-like material/,
    ],
    ["access_token=opaquevalue", /sensitive credential assignment/],
    ["refresh_token: opaquevalue", /sensitive credential assignment/],
    ["session_id=opaquevalue", /sensitive credential assignment/],
    ['{"access_token":"opaquevalue"}', /sensitive credential assignment/],
    ["'refresh_token': 'opaquevalue'", /sensitive credential assignment/],
    ['"session_id": "opaquevalue"', /sensitive credential assignment/],
    [
      "%7B%22access_token%22%3A%22opaquevalue%22%7D",
      /sensitive credential assignment/,
    ],
    [
      "client-secret=opaquevalue",
      /secret-like material|sensitive credential assignment/,
    ],
    [syntheticJoinedToken("sk-proj-"), /secret-like material/],
    [
      "https://storage.example/object?X-Amz-Signature=abcdef123456",
      /sensitive URL query key/,
    ],
    [
      "https://auth.example/callback#access_token=abcdef1234567890",
      /sensitive URL fragment key/,
    ],
    [
      `https://example.test/?foo=${syntheticDashToken("xoxb").replace("x", "%78")}`,
      /secret-like material/,
    ],
    [
      `https://example.test/#foo=${syntheticDashToken("glpat").replace("g", "%67")}`,
      /secret-like material/,
    ],
    [
      "https://example.test/?%2561ccess_token=abcdef1234567890",
      /sensitive URL query key/,
    ],
    [
      "https://example.test/#/callback?access_token=abcdef1234567890",
      /sensitive URL fragment key/,
    ],
    ["safe%00text", /control character/],
    ["safe\u0085text", /control character/],
    ["safe%C2%85text", /control character/],
    [
      "https://example.test/?note=safe%250Atext",
      /control character/,
    ],
  ];
  for (const [pointer, error] of unsafePointers) {
    const unsafe = clone(rows[0]);
    unsafe.reports[0].pointer = pointer;
    assert.throws(
      () => validateFindingRows([unsafe], schema, fixtureContext()),
      error,
      pointer,
    );
  }

  const benignPercent = clone(rows[0]);
  benignPercent.reports[0].pointer = "https://example.test/?q=100%25";
  assert.doesNotThrow(() =>
    validateFindingRows([benignPercent], schema, fixtureContext()),
  );
});

test("match fixtures merge cross-lane identity and split distinct defects", async () => {
  const fixtures = await readJson(
    "qa-suite/references/finding-match-fixtures.json",
  );
  const merge = fixtures.cases.find(({ expected }) => expected === "merge");
  const split = fixtures.cases.find(({ expected }) => expected === "split");

  assert.equal(merge.id, "cross-lane-same-login-defect");
  assert.notEqual(merge.left.lane, merge.right.lane);
  assert.notEqual(merge.left.location, merge.right.location);
  assert.equal(merge.left.component, merge.right.component);
  assert.equal(split.id, "same-component-distinct-auth-defects");
  assert.equal(split.left.component, split.right.component);
  assert.equal(split.left.location, split.right.location);
  assert.notEqual(
    split.left.defect_record.actual_result,
    split.right.defect_record.actual_result,
  );
});

test("configured ledger is canonical, tracked, valid, and non-ignored", async () => {
  const project = await validateProject({
    repository: fileURLToPath(repositoryRoot),
    context: "qa-context.md",
  });
  assert.equal(project.ledgerGitPath, "findings.jsonl");
  assert.equal(project.schemaVersion, 2);
  assert.deepEqual(project.unknownComponents, []);
});

test("symlink ledger and tracked sidecar fail the file boundary", async (t) => {
  const repository = await createTestRepository();
  const outsideDirectory = await mkdtemp(
    join(tmpdir(), "finding-ledger-outside-"),
  );
  t.after(() => rm(repository, { recursive: true, force: true }));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const outside = join(outsideDirectory, "findings.jsonl");
  await writeFile(outside, "");
  await unlink(join(repository, "findings.jsonl"));
  await symlink(outside, join(repository, "findings.jsonl"));
  await assert.rejects(
    validateProject({ repository }),
    /regular file, not a symlink/,
  );

  await unlink(join(repository, "findings.jsonl"));
  await writeFile(join(repository, "findings.jsonl"), "");
  await mkdir(join(repository, "QA"));
  await writeFile(join(repository, ".gitignore"), "QA/\n");
  await writeFile(join(repository, "QA/findings-sensitive.jsonl"), "{}\n");
  runGit(repository, "add", ".gitignore", "findings.jsonl");
  assert.equal(
    (await validateProject({ repository })).ledgerGitPath,
    "findings.jsonl",
  );
  runGit(repository, "add", "-f", "QA/findings-sensitive.jsonl");
  await assert.rejects(
    validateProject({ repository }),
    /sensitive sidecar must not be tracked/,
  );
  runGit(
    repository,
    "-c",
    "user.name=QA Suite Tests",
    "-c",
    "user.email=qa-suite-tests@example.invalid",
    "commit",
    "-qm",
    "test fixture",
  );
  runGit(repository, "rm", "--cached", "QA/findings-sensitive.jsonl");
  await assert.rejects(
    validateProject({ repository }),
    /sensitive sidecar must not be tracked/,
  );
  runGit(
    repository,
    "-c",
    "user.name=QA Suite Tests",
    "-c",
    "user.email=qa-suite-tests@example.invalid",
    "commit",
    "-qm",
    "remove sensitive fixture",
  );
  await assert.rejects(
    validateProject({ repository }),
    /sensitive sidecar must never appear in reachable Git history/,
  );
});

test("prospective sensitive sidecar must be ignored before it exists", async (t) => {
  const repository = await createTestRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  await writeFile(join(repository, ".gitignore"), "");
  await assert.rejects(
    validateProject({ repository }),
    /sensitive sidecar path must be ignored/,
  );
});

test("ledger initialization rejects escaping parents before creation", async (t) => {
  const escapingRepository = await createTestRepository();
  const nestedRepository = await createTestRepository();
  const outsideDirectory = await mkdtemp(
    join(tmpdir(), "finding-ledger-init-outside-"),
  );
  t.after(() => rm(escapingRepository, { recursive: true, force: true }));
  t.after(() => rm(nestedRepository, { recursive: true, force: true }));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));

  const escapingContextPath = join(escapingRepository, "qa-context.md");
  await writeFile(
    escapingContextPath,
    (await readFile(escapingContextPath, "utf8")).replace(
      "- **Path:** findings.jsonl",
      "- **Path:** linked/findings.jsonl",
    ),
  );
  await symlink(outsideDirectory, join(escapingRepository, "linked"), "dir");
  await assert.rejects(
    initializeLedger({ repository: escapingRepository }),
    /finding ledger parent must resolve inside the repository/,
  );
  await assert.rejects(
    readFile(join(outsideDirectory, "findings.jsonl")),
    (error) => error.code === "ENOENT",
  );

  const nestedContextPath = join(nestedRepository, "qa-context.md");
  await writeFile(
    nestedContextPath,
    (await readFile(nestedContextPath, "utf8")).replace(
      "- **Path:** findings.jsonl",
      "- **Path:** state/ledger/findings.jsonl",
    ),
  );
  await initializeLedger({ repository: nestedRepository });
  const nestedLedger = join(nestedRepository, "state/ledger/findings.jsonl");
  assert.equal(await readFile(nestedLedger, "utf8"), "");

  await writeFile(nestedLedger, "existing ledger content\n");
  await initializeLedger({ repository: nestedRepository });
  assert.equal(
    await readFile(nestedLedger, "utf8"),
    "existing ledger content\n",
  );
});

test("ordinary writes enforce report candidate bindings without data loss", async (t) => {
  const repository = await createTestRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const rows = await readJsonl("tests/fixtures/finding-ledger-valid.jsonl");
  const first = clone(rows[0]);
  const second = clone(rows[0]);
  first.schema_version = 2;
  first.component = "authentication";
  second.schema_version = 2;
  second.id = "FND-shared-report-write";
  second.component = "authentication";
  second.reports = [clone(first.reports[0])];
  second.reports[0].lane = "api-qa";
  const acceptedCandidatePath = join(repository, "candidate-shared.jsonl");
  await writeFile(
    acceptedCandidatePath,
    `${[first, second].map((row) => JSON.stringify(row)).join("\n")}\n`,
  );

  const emptyDigest =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const written = await replaceLedger({
    repository,
    candidatePath: acceptedCandidatePath,
    expectedDigest: emptyDigest,
  });
  assert.equal(written.rows.length, 2);

  const conflicting = clone(first);
  conflicting.id = "FND-conflicting-report-write";
  conflicting.candidate_first_seen = "different-candidate";
  conflicting.candidate_last_confirmed = "different-candidate";
  conflicting.reports = [
    { ...clone(first.reports[0]), candidate: "different-candidate" },
  ];
  const rejectedCandidatePath = join(repository, "candidate-conflicting.jsonl");
  await writeFile(
    rejectedCandidatePath,
    `${[first, second, conflicting]
      .map((row) => JSON.stringify(row))
      .join("\n")}\n`,
  );
  const beforeFailure = await readFile(
    join(repository, "findings.jsonl"),
    "utf8",
  );
  await assert.rejects(
    replaceLedger({
      repository,
      candidatePath: rejectedCandidatePath,
      expectedDigest: written.digest,
    }),
    /report.*pointer is already bound to a different candidate/,
  );
  const afterFailure = await readFile(
    join(repository, "findings.jsonl"),
    "utf8",
  );
  assert.equal(afterFailure, beforeFailure);
  assert.equal((await validateProject({ repository })).digest, written.digest);
});

test("exclusive CAS prevents competing writers from losing findings", async (t) => {
  const repository = await createTestRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const rows = await readJsonl("tests/fixtures/finding-ledger-valid.jsonl");
  const firstCandidate = join(repository, "candidate-first.jsonl");
  const secondCandidate = join(repository, "candidate-second.jsonl");
  const firstRow = clone(rows[0]);
  const secondRow = clone(rows[0]);
  firstRow.schema_version = 2;
  secondRow.schema_version = 2;
  firstRow.component = "authentication";
  secondRow.id = "FND-competing-writer";
  secondRow.component = "authentication";
  await writeFile(firstCandidate, `${JSON.stringify(firstRow)}\n`);
  await writeFile(secondCandidate, `${JSON.stringify(secondRow)}\n`);
  const emptyDigest =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  const results = await Promise.allSettled([
    replaceLedger({
      repository,
      candidatePath: firstCandidate,
      expectedDigest: emptyDigest,
    }),
    replaceLedger({
      repository,
      candidatePath: secondCandidate,
      expectedDigest: emptyDigest,
    }),
  ]);
  assert.equal(
    results.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter(({ status }) => status === "rejected").length,
    1,
  );

  const finalProject = await validateProject({ repository });
  assert.equal(finalProject.rows.length, 1);
  await assert.rejects(
    replaceLedger({
      repository,
      candidatePath: secondCandidate,
      expectedDigest: emptyDigest,
    }),
    /changed concurrently/,
  );
});

test("write preserves stable IDs, immutable identity, and provenance", async (t) => {
  const repository = await createTestRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const rows = await readJsonl("tests/fixtures/finding-ledger-valid.jsonl");
  const original = clone(rows[0]);
  original.schema_version = 2;
  original.component = "authentication";
  original.occurrences = 1;
  const initialCandidate = join(repository, "candidate-initial.jsonl");
  await writeFile(initialCandidate, `${JSON.stringify(original)}\n`);
  const emptyDigest =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const inflatedNewFinding = clone(original);
  inflatedNewFinding.occurrences = 50;
  const inflatedCandidate = join(repository, "candidate-inflated.jsonl");
  await writeFile(
    inflatedCandidate,
    `${JSON.stringify(inflatedNewFinding)}\n`,
  );
  await assert.rejects(
    replaceLedger({
      repository,
      candidatePath: inflatedCandidate,
      expectedDigest: emptyDigest,
    }),
    /new finding .* occurrences must start at 1/,
  );
  const multiCycleNewFinding = clone(original);
  multiCycleNewFinding.candidate_last_confirmed = "candidate-next";
  multiCycleNewFinding.reports.at(-1).candidate = "candidate-next";
  const multiCycleCandidate = join(repository, "candidate-multi-cycle.jsonl");
  await writeFile(
    multiCycleCandidate,
    `${JSON.stringify(multiCycleNewFinding)}\n`,
  );
  await assert.rejects(
    replaceLedger({
      repository,
      candidatePath: multiCycleCandidate,
      expectedDigest: emptyDigest,
    }),
    /new finding .* must start on one candidate cycle/,
  );
  const written = await replaceLedger({
    repository,
    candidatePath: initialCandidate,
    expectedDigest: emptyDigest,
  });

  const candidates = [
    {
      name: "deletion",
      rows: [],
      error: /cannot be deleted.*governed migration/,
    },
    {
      name: "identity change",
      rows: [{ ...clone(original), component: "preferences" }],
      error: /cannot change immutable field component/,
    },
    {
      name: "provenance removal",
      rows: [{ ...clone(original), reports: [] }],
      error: /fewer than the schema minItems/,
    },
  ];
  const extraReport = {
    lane: "regression-qa",
    pointer: "QA/2026-07-26-regression.md",
    candidate: original.candidate_last_confirmed,
  };
  const evolved = clone(original);
  evolved.reports.push(extraReport);
  evolved.last_seen = "2028-02-29T00:00:00Z";
  candidates.push({
    name: "occurrence without candidate",
    rows: [{ ...clone(evolved), occurrences: evolved.occurrences + 1 }],
    error: /occurrence increase requires a new candidate/,
  });
  candidates.push({
    name: "multiple occurrences in one write",
    rows: [{ ...clone(evolved), occurrences: evolved.occurrences + 2 }],
    error: /occurrences must advance one cycle per write/,
  });
  const occurrenceWithoutTime = clone(evolved);
  occurrenceWithoutTime.occurrences += 1;
  occurrenceWithoutTime.candidate_last_confirmed = "candidate-next";
  occurrenceWithoutTime.reports.push({
    lane: "smoke-qa",
    pointer: "QA/2028-02-29-smoke.md",
    candidate: "candidate-next",
  });
  candidates.push({
    name: "occurrence without time",
    rows: [occurrenceWithoutTime],
    error: /occurrence increase requires a later last_seen/,
  });
  const occurrenceWithoutProvenance = clone(evolved);
  occurrenceWithoutProvenance.occurrences += 1;
  occurrenceWithoutProvenance.candidate_last_confirmed = "candidate-next";
  occurrenceWithoutProvenance.last_seen = "2028-03-01T00:00:00Z";
  candidates.push({
    name: "occurrence without provenance",
    rows: [occurrenceWithoutProvenance],
    error: /needs report provenance for candidate_last_confirmed/,
  });
  const occurrenceWithReusedPointer = clone(evolved);
  occurrenceWithReusedPointer.occurrences += 1;
  occurrenceWithReusedPointer.candidate_last_confirmed = "candidate-next";
  occurrenceWithReusedPointer.last_seen = "2028-03-01T00:00:00Z";
  occurrenceWithReusedPointer.reports.at(-1).candidate = "candidate-next";
  candidates.push({
    name: "occurrence with reused pointer",
    rows: [occurrenceWithReusedPointer],
    error: /occurrence increase requires new candidate provenance/,
  });
  const evolvedCandidate = join(repository, "candidate-evolved.jsonl");
  await writeFile(evolvedCandidate, `${JSON.stringify(evolved)}\n`);
  const evolvedProject = await replaceLedger({
    repository,
    candidatePath: evolvedCandidate,
    expectedDigest: written.digest,
  });

  for (const candidate of candidates) {
    const path = join(
      repository,
      `candidate-${candidate.name.replace(" ", "-")}.jsonl`,
    );
    await writeFile(
      path,
      candidate.rows.map((row) => JSON.stringify(row)).join("\n") +
        (candidate.rows.length > 0 ? "\n" : ""),
    );
    await assert.rejects(
      replaceLedger({
        repository,
        candidatePath: path,
        expectedDigest: evolvedProject.digest,
      }),
      candidate.error,
      candidate.name,
    );
  }

  const nextCycle = clone(evolved);
  nextCycle.occurrences += 1;
  nextCycle.candidate_last_confirmed = "candidate-next";
  nextCycle.last_seen = "2028-03-01T00:00:00Z";
  nextCycle.reports.push({
    lane: "smoke-qa",
    pointer: "QA/2028-03-01-smoke.md",
    candidate: "candidate-next",
  });
  const nextCyclePath = join(repository, "candidate-next-cycle.jsonl");
  await writeFile(nextCyclePath, `${JSON.stringify(nextCycle)}\n`);
  const nextCycleProject = await replaceLedger({
    repository,
    candidatePath: nextCyclePath,
    expectedDigest: evolvedProject.digest,
  });

  const occurrenceRegression = clone(nextCycle);
  occurrenceRegression.occurrences -= 1;
  const occurrenceRegressionPath = join(
    repository,
    "candidate-occurrence-regression.jsonl",
  );
  await writeFile(
    occurrenceRegressionPath,
    `${JSON.stringify(occurrenceRegression)}\n`,
  );
  await assert.rejects(
    replaceLedger({
      repository,
      candidatePath: occurrenceRegressionPath,
      expectedDigest: nextCycleProject.digest,
    }),
    /occurrences cannot decrease/,
  );

  const removedProvenance = clone(nextCycle);
  removedProvenance.reports = nextCycle.reports.slice(1);
  const removedProvenancePath = join(
    repository,
    "candidate-removed-provenance.jsonl",
  );
  await writeFile(
    removedProvenancePath,
    `${JSON.stringify(removedProvenance)}\n`,
  );
  await assert.rejects(
    replaceLedger({
      repository,
      candidatePath: removedProvenancePath,
      expectedDigest: nextCycleProject.digest,
    }),
    /report provenance cannot be removed/,
  );
});

test("version 2 accepts ten shipped lanes and registry-shaped identities", async () => {
  const [v1Schema, v2Schema, rows] = await Promise.all([
    readJson("qa-suite/references/finding-ledger-v1.schema.json"),
    readJson("qa-suite/references/finding-ledger.schema.json"),
    readJsonl("tests/fixtures/finding-ledger-valid.jsonl"),
  ]);
  const base = clone(rows[0]);
  base.schema_version = 2;
  for (const lane of ["reliability-qa", "deployment-qa", "data-integrity-qa"]) {
    const row = clone(base);
    row.lane = lane;
    row.reports[0].lane = lane;
    assert.doesNotThrow(() =>
      validateFindingRows([row], v2Schema, fixtureContext()),
    );
    assert.throws(
      () => validateFindingRows([row], v1Schema, fixtureContext()),
      /schema_version must equal 1|schema alternative/,
    );
  }

  const temporary = createSpecialistEntry(temporaryDefinition());
  const temporaryRow = clone(base);
  temporaryRow.lane = temporary.id;
  temporaryRow.reports[0].lane = temporary.id;
  temporaryRow.defect_record = "redacted";
  temporaryRow.sensitivity = {
    classification: "uncertain",
    storage: "redacted",
    clearance: null,
  };
  assert.doesNotThrow(() =>
    validateFindingRows([temporaryRow], v2Schema, fixtureContext()),
  );
  const unsafe = clone(temporaryRow);
  unsafe.defect_record = clone(base.defect_record);
  unsafe.sensitivity = {
    classification: "standard",
    storage: "committed",
    clearance: null,
  };
  assert.throws(
    () => validateFindingRows([unsafe], v2Schema, fixtureContext()),
    /temporary specialist finding requires uncertain or human-cleared sensitivity/,
  );
});

test("explicit migration changes only version and gates new lane dispatch", async (t) => {
  const repository = await createTestRepository();
  const emptyRepository = await createTestRepository();
  const mixedRepository = await createTestRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  t.after(() => rm(emptyRepository, { recursive: true, force: true }));
  t.after(() => rm(mixedRepository, { recursive: true, force: true }));
  const rows = await readJsonl("tests/fixtures/finding-ledger-valid.jsonl");
  const v1Row = clone(rows[0]);
  v1Row.component = "authentication";
  const v1Source = `${JSON.stringify(v1Row)}\n`;
  await writeFile(join(repository, "findings.jsonl"), v1Source);

  const before = await validateProject({ repository });
  assert.equal(before.schemaVersion, 1);
  assert.equal((await preflightLane({ repository, lane: "smoke-qa" })).lane, "smoke-qa");
  await assert.rejects(
    preflightLane({ repository, lane: "reliability-qa" }),
    new RegExp(`migrate.*--to 2.*${before.digest}`),
  );
  await assert.rejects(
    preflightLane({ repository, lane: "reliabilty-qa" }),
    (error) =>
      /dispatch lane/.test(error.message) &&
      !error.message.includes("migrate"),
  );
  const temporary = createSpecialistEntry(temporaryDefinition());
  await configureTemporaryRegistry(repository, [temporary]);
  await assert.rejects(
    preflightLane({ repository, lane: temporary.id }),
    new RegExp(`migrate.*--to 2.*${before.digest}`),
  );

  const migrated = await migrateLedger({
    repository,
    toVersion: 2,
    expectedDigest: before.digest,
  });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.rows[0].schema_version, 2);
  const semanticV1 = clone(v1Row);
  const semanticV2 = clone(migrated.rows[0]);
  delete semanticV1.schema_version;
  delete semanticV2.schema_version;
  assert.deepEqual(semanticV2, semanticV1);
  assert.equal(
    (await preflightLane({ repository, lane: "reliability-qa" })).lane,
    "reliability-qa",
  );
  await assert.rejects(
    migrateLedger({
      repository,
      toVersion: 2,
      expectedDigest: migrated.digest,
    }),
    /already schema version 2/,
  );
  await assert.rejects(
    migrateLedger({
      repository: emptyRepository,
      toVersion: 2,
      expectedDigest:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    }),
    /empty finding ledger starts at schema version 2/,
  );

  const mixedRows = [v1Row, { ...clone(v1Row), id: "FND-v2", schema_version: 2 }];
  await writeFile(
    join(mixedRepository, "findings.jsonl"),
    `${mixedRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  await assert.rejects(
    validateProject({ repository: mixedRepository }),
    /cannot mix schema versions/,
  );
});

test("version-1 ledgers remain writable by legacy lanes and reject ordinary version changes", async (t) => {
  const repository = await createTestRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const rows = await readJsonl("tests/fixtures/finding-ledger-valid.jsonl");
  const original = clone(rows[0]);
  original.component = "authentication";
  await writeFile(
    join(repository, "findings.jsonl"),
    `${JSON.stringify(original)}\n`,
  );
  const project = await validateProject({ repository });

  const appended = clone(original);
  appended.id = "FND-legacy-api-contract";
  appended.lane = "api-qa";
  appended.reports = [
    {
      lane: "api-qa",
      pointer: "QA/2026-08-03-legacy-api.md",
      candidate: appended.candidate_first_seen,
    },
  ];
  const candidatePath = join(repository, "candidate-v1.jsonl");
  await writeFile(
    candidatePath,
    `${[original, appended].map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  const written = await replaceLedger({
    repository,
    candidatePath,
    expectedDigest: project.digest,
  });
  assert.equal(written.schemaVersion, 1);
  assert.equal(written.rows.length, 2);

  const ordinaryUpgradePath = join(repository, "candidate-v2.jsonl");
  await writeFile(
    ordinaryUpgradePath,
    `${written.rows
      .map((row) => JSON.stringify({ ...row, schema_version: 2 }))
      .join("\n")}\n`,
  );
  await assert.rejects(
    replaceLedger({
      repository,
      candidatePath: ordinaryUpgradePath,
      expectedDigest: written.digest,
    }),
    /schema_version must equal 1|schema alternative/,
  );

  const migrated = await migrateLedger({
    repository,
    toVersion: 2,
    expectedDigest: written.digest,
  });
  await assert.rejects(
    replaceLedger({
      repository,
      candidatePath,
      expectedDigest: migrated.digest,
    }),
    /schema_version must equal 2|schema alternative/,
  );
});

test("temporary ledger provenance resolves exactly and blocks missing confirmation", async (t) => {
  const repository = await createTestRepository();
  t.after(() => rm(repository, { recursive: true, force: true }));
  const entry = createSpecialistEntry(temporaryDefinition());
  await configureTemporaryRegistry(repository, [entry]);
  const rows = await readJsonl("tests/fixtures/finding-ledger-valid.jsonl");
  const row = clone(rows[0]);
  row.schema_version = 2;
  row.component = "authentication";
  row.lane = entry.id;
  row.reports[0].lane = entry.id;
  row.defect_record = "redacted";
  row.sensitivity = {
    classification: "uncertain",
    storage: "redacted",
    clearance: null,
  };
  await writeFile(join(repository, "findings.jsonl"), `${JSON.stringify(row)}\n`);

  const valid = await validateProject({ repository });
  assert.equal(valid.schemaVersion, 2);
  assert.deepEqual(valid.missingTemporarySpecialists, []);
  assert.equal(
    (await preflightLane({ repository, lane: entry.id })).lane,
    entry.id,
  );

  await writeFile(
    join(repository, "qa-specialists.json"),
    `${JSON.stringify({ schema_version: 1, specialists: [] }, null, 2)}\n`,
  );
  await assert.rejects(
    validateProject({ repository }),
    /temporary specialist identities are not registered/,
  );
  const relaxed = await validateProject({
    repository,
    allowMissingTemporary: true,
  });
  assert.deepEqual(relaxed.missingTemporarySpecialists, [entry.id]);

  const helper = fileURLToPath(
    new URL("qa-suite/scripts/finding-ledger.mjs", repositoryRoot),
  );
  const output = execFileSync(
    process.execPath,
    [helper, "manifest", "--repo", repository, "--mode", "confirmation"],
    { encoding: "utf8" },
  ).trim();
  const blocked = JSON.parse(output);
  assert.equal(blocked.type, "blocked");
  assert.equal(blocked.disposition, "Blocked");
  assert.equal(blocked.finding_id, row.id);
  assert.equal(blocked.lane, entry.id);
  assert.match(blocked.blocker, new RegExp(entry.id));
  assert.equal(
    digest(await readFile(join(repository, "findings.jsonl"), "utf8")),
    relaxed.digest,
  );
});

test("context and orchestrator contracts name the enforced workflow", async () => {
  const [template, example, context, skill, contract] = await Promise.all([
    readText("qa-suite/assets/qa-context-template.md"),
    readText("examples/qa-context.example.md"),
    readText("qa-context.md"),
    readText("qa-suite/SKILL.md"),
    readText("qa-suite/references/finding-ledger.md"),
  ]);

  for (const source of [template, example, context]) {
    assert.match(source, /^## Finding ledger$/m);
    assert.match(source, /^- \*\*Path:\*\*/m);
    assert.match(
      source,
      /^- \*\*Repository visibility \(`repo_visibility`\):\*\*/m,
    );
    assert.match(source, /^- \*\*Named components:\*\*/m);
  }
  assert.match(skill, /dependency-free `scripts\/finding-ledger\.mjs` helper/);
  assert.match(skill, /locked compare-and-swap/);
  assert.match(skill, /Lanes never write the ledger/);
  assert.match(skill, /never stages,\s+commits, or otherwise touches git state/);
  assert.match(contract, /exclusive lock plus compare-and-swap/);
  assert.match(contract, /duplicate JSON object keys and IDs/);
  assert.match(contract, /optional sidecar is ignored and\s+untracked/);
  assert.match(contract, /False merges destroy signal/);
  assert.match(contract, /`location`.*never participates in matching/s);
  assert.match(contract, /\| discovery \| None \|/);
  assert.match(contract, /\| confirmation \| `open` and `regressed` rows/);
  assert.match(contract, /\| regression \| `fixed` rows/);
  assert.match(contract, /Absence from a report never implies\s+`fixed`/);
});
