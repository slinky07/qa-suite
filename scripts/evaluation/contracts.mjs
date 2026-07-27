import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { parseJsonStrict } from "../../qa-suite/scripts/finding-ledger.mjs";

const CASE_ID = /^fx_[0-9a-f]{32}$/;
const RUN_ID = /^run_[0-9a-f]{32}$/;
const SUITE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*-v1$/;
const SEAL_TOKEN = /^seal_[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FULL_COMMIT = /^[0-9a-f]{40}$/;
const SURFACE_ID = /^surface_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const FLOW_ID = /^flow_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CHECK_ID = /^check_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const FINDING_ID = /^[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*$/;

export const LANES = new Set([
  "api-qa",
  "bob-qa",
  "compatibility-qa",
  "performance-qa",
  "regression-qa",
  "security-qa",
  "smoke-qa",
]);
export const SEVERITIES = ["S1", "S2", "S3", "S4"];
export const CASE_DISCLOSURE_PATH = "evaluation-case.json";

const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const SPECIALIST_VERDICTS = new Set([
  "Blocked",
  "Go",
  "Go with findings",
  "No-Go",
]);
const SMOKE_VERDICTS = new Set(["Blocked", "Go", "No-Go"]);
const FLOW_STATES = new Set([
  "Blocked",
  "Fail",
  "Not tested",
  "Observed only",
  "Pass",
]);
const CHECK_STATES = new Set([
  "Fail",
  "Not tested",
  "Observed only",
  "Pass",
]);
const EVIDENCE_KINDS = new Set([
  "log",
  "measurement",
  "report-reference",
  "request-response",
  "screenshot",
]);
const COMPLETION_STATES = new Set([
  "completed",
  "gated-by-smoke",
  "lane-blocked",
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
  if (JSON.stringify(observed) !== JSON.stringify(wanted)) {
    throw new Error(
      `${label} fields are ${observed.join(", ")}; expected ${wanted.join(", ")}`,
    );
  }
}

function assertString(value, label, pattern) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim().length === 0
  ) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (pattern && !pattern.test(value)) {
    throw new Error(`${label} has an invalid value`);
  }
}

function assertArray(value, label, { minimum = 0, maximum } = {}) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  if (value.length < minimum) {
    throw new Error(`${label} must contain at least ${minimum} item(s)`);
  }
  if (maximum !== undefined && value.length > maximum) {
    throw new Error(`${label} must contain at most ${maximum} item(s)`);
  }
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must contain unique values`);
  }
}

function assertEnum(value, values, label) {
  if (!values.has(value)) {
    throw new Error(`${label} has unsupported value ${String(value)}`);
  }
}

function assertVersion(value, label) {
  if (value !== 1) {
    throw new Error(`${label}.schema_version must equal 1`);
  }
}

function sortedObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortedObject(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortedObject(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortedObject(value), null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseContractJson(source, label = "evaluation input") {
  return parseJsonStrict(source, label);
}

function assertSafeRelativePath(value, label) {
  assertString(value, label);
  const segments = value.split("/");
  if (
    isAbsolute(value) ||
    value.includes("\\") ||
    value.includes("\0") ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith("."),
    )
  ) {
    throw new Error(`${label} must be a normalized visible relative path`);
  }
  return value;
}

function fixtureRoot(caseId) {
  return `tests/evaluation/fixtures/${caseId}`;
}

function pathContains(parent, child) {
  return child === parent || child.startsWith(`${parent}/`);
}

export function validateCaseDisclosure(value) {
  assertExactKeys(
    value,
    [
      "case_id",
      "lane",
      "mission",
      "qa_context",
      "run_id",
      "schema_version",
      "subject_commit",
      "subject_root",
      "writable_roots",
    ],
    "case disclosure",
  );
  assertVersion(value.schema_version, "case disclosure");
  assertString(value.run_id, "case disclosure.run_id", RUN_ID);
  assertString(value.case_id, "case disclosure.case_id", CASE_ID);
  assertEnum(value.lane, LANES, "case disclosure.lane");
  if (value.mission !== "discovery") {
    throw new Error("case disclosure.mission must equal discovery");
  }
  const expectedContext = `${fixtureRoot(value.case_id)}/qa-context.md`;
  if (value.qa_context !== expectedContext) {
    throw new Error(
      `case disclosure.qa_context must equal ${expectedContext}`,
    );
  }
  assertString(
    value.subject_commit,
    "case disclosure.subject_commit",
    FULL_COMMIT,
  );
  if (value.subject_root !== "qa-suite") {
    throw new Error("case disclosure.subject_root must equal qa-suite");
  }
  assertArray(value.writable_roots, "case disclosure.writable_roots", {
    minimum: 1,
    maximum: 1,
  });
  value.writable_roots.forEach((path, index) =>
    assertSafeRelativePath(
      path,
      `case disclosure.writable_roots[${index}]`,
    ),
  );
  assertUnique(
    value.writable_roots,
    "case disclosure.writable_roots",
  );
  for (const [index, root] of value.writable_roots.entries()) {
    if (
      pathContains(root, value.qa_context) ||
      pathContains(value.qa_context, root) ||
      pathContains(root, value.subject_root) ||
      pathContains(value.subject_root, root) ||
      pathContains(root, CASE_DISCLOSURE_PATH) ||
      pathContains(CASE_DISCLOSURE_PATH, root)
    ) {
      throw new Error(
        `case disclosure.writable_roots[${index}] overlaps immutable input`,
      );
    }
  }
  return value;
}

export function createCaseDisclosure({
  runId,
  subjectCommit,
  suite,
  suiteCase,
  writableRoots,
}) {
  validateSuite(suite);
  validateSuiteCase(suiteCase, "suite case");
  const canonicalCase = suite.cases.find(({ id }) => id === suiteCase.id);
  if (
    canonicalCase === undefined ||
    canonicalJson(canonicalCase) !== canonicalJson(suiteCase)
  ) {
    throw new Error("suite case does not match the canonical suite entry");
  }
  return validateCaseDisclosure({
    case_id: suiteCase.id,
    lane: suite.lane,
    mission: "discovery",
    qa_context: suiteCase.qa_context,
    run_id: runId,
    schema_version: 1,
    subject_commit: subjectCommit,
    subject_root: "qa-suite",
    writable_roots: writableRoots,
  });
}

function validateOracleCommitments(tokens, label) {
  assertArray(tokens, label, { minimum: 2, maximum: 2 });
  tokens.forEach((token, index) =>
    assertString(token, `${label}[${index}]`, SEAL_TOKEN),
  );
  assertUnique(tokens, label);
}

function validateSuiteCase(value, label) {
  assertExactKeys(
    value,
    [
      "fixture_manifest",
      "id",
      "oracle_commitments",
      "qa_context",
      "smoke_checks",
    ],
    label,
  );
  assertString(value.id, `${label}.id`, CASE_ID);
  const root = fixtureRoot(value.id);
  const expectedContext = `${root}/qa-context.md`;
  const expectedManifest = `${root}/fixture-manifest.json`;
  if (value.qa_context !== expectedContext) {
    throw new Error(
      `${label}.qa_context must equal the opaque neutral path ${expectedContext}`,
    );
  }
  if (value.fixture_manifest !== expectedManifest) {
    throw new Error(
      `${label}.fixture_manifest must equal ${expectedManifest}`,
    );
  }
  validateOracleCommitments(
    value.oracle_commitments,
    `${label}.oracle_commitments`,
  );
  assertArray(value.smoke_checks, `${label}.smoke_checks`, {
    minimum: 1,
  });
  value.smoke_checks.forEach((id, index) =>
    assertString(id, `${label}.smoke_checks[${index}]`, CHECK_ID),
  );
  assertUnique(value.smoke_checks, `${label}.smoke_checks`);
  return value;
}

export function validateSuite(value) {
  assertExactKeys(value, ["cases", "id", "lane", "schema_version"], "suite");
  assertVersion(value.schema_version, "suite");
  assertString(value.id, "suite.id", SUITE_ID);
  assertEnum(value.lane, LANES, "suite.lane");
  assertArray(value.cases, "suite.cases", { minimum: 2 });
  value.cases.forEach((entry, index) =>
    validateSuiteCase(entry, `suite.cases[${index}]`),
  );
  assertUnique(value.cases.map(({ id }) => id), "suite case IDs");
  assertUnique(
    value.cases.map(({ qa_context }) => qa_context),
    "suite qa_context paths",
  );
  assertUnique(
    value.cases.map(({ fixture_manifest }) => fixture_manifest),
    "suite fixture manifest paths",
  );
  assertUnique(
    value.cases.flatMap(({ oracle_commitments }) => oracle_commitments),
    "suite oracle commitments",
  );
  return value;
}

function validateFixtureFile(value, caseRoot, qaContext, label) {
  assertExactKeys(value, ["mode", "path", "sha256"], label);
  assertSafeRelativePath(value.path, `${label}.path`);
  const publicPrefix = `${caseRoot}/public/`;
  if (value.path !== qaContext && !value.path.startsWith(publicPrefix)) {
    throw new Error(
      `${label}.path must be the qa-context or live under ${publicPrefix}`,
    );
  }
  if (!["100644", "100755"].includes(value.mode)) {
    throw new Error(`${label}.mode must be 100644 or 100755`);
  }
  assertString(value.sha256, `${label}.sha256`, SHA256);
  return value;
}

export function validateFixtureManifest(value, suiteCase) {
  validateSuiteCase(suiteCase, "suite case");
  assertExactKeys(value, ["case_id", "files", "schema_version"], "manifest");
  assertVersion(value.schema_version, "manifest");
  if (value.case_id !== suiteCase.id) {
    throw new Error("manifest.case_id does not match the suite case");
  }
  assertArray(value.files, "manifest.files", {
    minimum: 1,
    maximum: 512,
  });
  const root = fixtureRoot(suiteCase.id);
  value.files.forEach((entry, index) =>
    validateFixtureFile(
      entry,
      root,
      suiteCase.qa_context,
      `manifest.files[${index}]`,
    ),
  );
  assertUnique(value.files.map(({ path }) => path), "manifest file paths");
  const paths = value.files.map(({ path }) => path);
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) {
    throw new Error("manifest.files must be ordered by path");
  }
  if (!value.files.some(({ path }) => path === suiteCase.qa_context)) {
    throw new Error("manifest.files must include the exact qa-context");
  }
  return value;
}

export function fixtureManifestDeclarationDigest(manifest, suiteCase) {
  validateFixtureManifest(manifest, suiteCase);
  return {
    algorithm: "sha256",
    digest: sha256(canonicalJson(manifest)),
    qualification: "not-evidence",
    verification_status: "unverified",
  };
}

function validateEvidencePointer(value, label) {
  assertExactKeys(value, ["kind", "path"], label);
  assertEnum(value.kind, EVIDENCE_KINDS, `${label}.kind`);
  assertSafeRelativePath(value.path, `${label}.path`);
  return value;
}

function validateEvidencePointers(values, label, { minimum = 0 } = {}) {
  assertArray(values, label, { minimum, maximum: 256 });
  values.forEach((value, index) =>
    validateEvidencePointer(value, `${label}[${index}]`),
  );
  assertUnique(
    values.map(({ kind, path }) => `${kind}\0${path}`),
    label,
  );
}

function validateExpectedDefect(value, lane, label) {
  if (lane === "smoke-qa") {
    assertExactKeys(
      value,
      ["checklist_ids_any_of", "id", "required_evidence_kinds"],
      label,
    );
    assertString(value.id, `${label}.id`, SEAL_TOKEN);
    assertArray(value.checklist_ids_any_of, `${label}.checklist_ids_any_of`, {
      minimum: 1,
    });
    value.checklist_ids_any_of.forEach((id, index) =>
      assertString(id, `${label}.checklist_ids_any_of[${index}]`, CHECK_ID),
    );
    assertUnique(
      value.checklist_ids_any_of,
      `${label}.checklist_ids_any_of`,
    );
  } else {
    assertExactKeys(
      value,
      [
        "allowed_priorities",
        "allowed_severities",
        "criteria_any_of",
        "id",
        "required_evidence_kinds",
        "surface_id",
      ],
      label,
    );
    assertString(value.id, `${label}.id`, SEAL_TOKEN);
    assertString(value.surface_id, `${label}.surface_id`, SURFACE_ID);
    assertArray(value.criteria_any_of, `${label}.criteria_any_of`, {
      minimum: 1,
    });
    value.criteria_any_of.forEach((criterion, index) =>
      assertString(criterion, `${label}.criteria_any_of[${index}]`),
    );
    assertUnique(value.criteria_any_of, `${label}.criteria_any_of`);
    assertArray(value.allowed_severities, `${label}.allowed_severities`, {
      minimum: 1,
    });
    value.allowed_severities.forEach((severity) =>
      assertEnum(
        severity,
        new Set(SEVERITIES),
        `${label}.allowed_severities`,
      ),
    );
    assertUnique(value.allowed_severities, `${label}.allowed_severities`);
    assertArray(value.allowed_priorities, `${label}.allowed_priorities`, {
      minimum: 1,
    });
    value.allowed_priorities.forEach((priority) =>
      assertEnum(priority, PRIORITIES, `${label}.allowed_priorities`),
    );
    assertUnique(value.allowed_priorities, `${label}.allowed_priorities`);
  }

  assertArray(
    value.required_evidence_kinds,
    `${label}.required_evidence_kinds`,
    { minimum: 1 },
  );
  value.required_evidence_kinds.forEach((kind) =>
    assertEnum(kind, EVIDENCE_KINDS, `${label}.required_evidence_kinds`),
  );
  assertUnique(
    value.required_evidence_kinds,
    `${label}.required_evidence_kinds`,
  );
  return value;
}

function validateFlowAssertion(value, label) {
  assertExactKeys(
    value,
    [
      "allowed_effectiveness",
      "allowed_states",
      "id",
      "required_evidence_kinds",
    ],
    label,
  );
  assertString(value.id, `${label}.id`, FLOW_ID);
  assertArray(value.allowed_states, `${label}.allowed_states`, {
    minimum: 1,
  });
  value.allowed_states.forEach((state) =>
    assertEnum(state, FLOW_STATES, `${label}.allowed_states`),
  );
  assertUnique(value.allowed_states, `${label}.allowed_states`);
  assertArray(
    value.allowed_effectiveness,
    `${label}.allowed_effectiveness`,
    { minimum: 1 },
  );
  value.allowed_effectiveness.forEach((effectiveness, index) => {
    if (effectiveness !== null && typeof effectiveness !== "boolean") {
      throw new Error(
        `${label}.allowed_effectiveness[${index}] must be boolean or null`,
      );
    }
  });
  assertUnique(
    value.allowed_effectiveness.map(String),
    `${label}.allowed_effectiveness`,
  );
  assertArray(
    value.required_evidence_kinds,
    `${label}.required_evidence_kinds`,
    { minimum: 1 },
  );
  value.required_evidence_kinds.forEach((kind) =>
    assertEnum(kind, EVIDENCE_KINDS, `${label}.required_evidence_kinds`),
  );
  assertUnique(
    value.required_evidence_kinds,
    `${label}.required_evidence_kinds`,
  );
  return value;
}

function validateLimit(value, label) {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new Error(`${label} must be a non-negative integer or null`);
  }
}

function validateControlBudget(value, lane, label) {
  assertExactKeys(
    value,
    [
      "criteria_any_of",
      "id",
      "max_by_severity",
      "max_total",
      "observations",
      "surface_ids",
    ],
    label,
  );
  assertString(value.id, `${label}.id`, SEAL_TOKEN);
  assertArray(value.surface_ids, `${label}.surface_ids`);
  value.surface_ids.forEach((surface, index) =>
    assertString(surface, `${label}.surface_ids[${index}]`, SURFACE_ID),
  );
  assertUnique(value.surface_ids, `${label}.surface_ids`);
  assertArray(value.criteria_any_of, `${label}.criteria_any_of`);
  value.criteria_any_of.forEach((criterion, index) =>
    assertString(criterion, `${label}.criteria_any_of[${index}]`),
  );
  assertUnique(value.criteria_any_of, `${label}.criteria_any_of`);
  validateLimit(value.max_total, `${label}.max_total`);
  if (value.observations !== "record-only") {
    throw new Error(`${label}.observations must equal record-only`);
  }

  if (lane === "smoke-qa") {
    if (value.max_by_severity !== null || value.max_total !== 0) {
      throw new Error(
        `${label} must use max_total 0 and null max_by_severity for smoke-qa`,
      );
    }
    return value;
  }

  assertExactKeys(
    value.max_by_severity,
    SEVERITIES,
    `${label}.max_by_severity`,
  );
  const limits = [value.max_total];
  for (const severity of SEVERITIES) {
    const limit = value.max_by_severity[severity];
    validateLimit(limit, `${label}.max_by_severity.${severity}`);
    limits.push(limit);
  }
  if (limits.every((limit) => limit === null)) {
    throw new Error(`${label} must contain at least one finite limit`);
  }
  if (
    value.max_by_severity.S1 !== 0 ||
    value.max_by_severity.S2 !== 0
  ) {
    throw new Error(`${label} must reject S1 and S2 control findings`);
  }
  return value;
}

function expectedAdversarialVerdicts(defect, lane) {
  if (lane === "smoke-qa") return ["No-Go"];
  const verdicts = [];
  if (defect.allowed_severities.some((value) => ["S1", "S2"].includes(value))) {
    verdicts.push("No-Go");
  }
  if (defect.allowed_severities.some((value) => ["S3", "S4"].includes(value))) {
    verdicts.push("Go with findings");
  }
  return verdicts;
}

function expectedControlVerdicts(lane) {
  if (lane === "smoke-qa") return ["Go"];
  return ["Go", "Go with findings"];
}

export function validateOracle(value, suite, suiteCase, label = "oracle") {
  validateSuite(suite);
  validateSuiteCase(suiteCase, "suite case");
  const canonicalCase = suite.cases.find(({ id }) => id === suiteCase.id);
  if (
    canonicalCase === undefined ||
    canonicalJson(canonicalCase) !== canonicalJson(suiteCase)
  ) {
    throw new Error("suite case does not match the canonical suite entry");
  }
  assertExactKeys(
    value,
    [
      "assertions",
      "canary_token",
      "case_id",
      "pair_id",
      "role",
      "schema_version",
    ],
    label,
  );
  assertVersion(value.schema_version, label);
  if (value.case_id !== suiteCase.id) {
    throw new Error(`${label}.case_id does not match the suite case`);
  }
  assertString(value.pair_id, `${label}.pair_id`, SEAL_TOKEN);
  assertEnum(
    value.role,
    new Set(["adversarial", "control"]),
    `${label}.role`,
  );
  assertString(value.canary_token, `${label}.canary_token`, SEAL_TOKEN);
  assertExactKeys(
    value.assertions,
    [
      "allowed_verdicts",
      "control_budget",
      "expected_defects",
      "flows",
    ],
    `${label}.assertions`,
  );
  assertArray(value.assertions.flows, `${label}.assertions.flows`);
  value.assertions.flows.forEach((flow, index) =>
    validateFlowAssertion(flow, `${label}.assertions.flows[${index}]`),
  );
  assertUnique(
    value.assertions.flows.map(({ id }) => id),
    `${label}.assertions flow IDs`,
  );
  assertArray(
    value.assertions.expected_defects,
    `${label}.assertions.expected_defects`,
    {
      minimum: value.role === "adversarial" ? 1 : 0,
      maximum: value.role === "adversarial" ? 1 : 0,
    },
  );
  value.assertions.expected_defects.forEach((defect, index) =>
    validateExpectedDefect(
      defect,
      suite.lane,
      `${label}.assertions.expected_defects[${index}]`,
    ),
  );
  if (
    suite.lane === "smoke-qa" &&
    value.role === "adversarial"
  ) {
    const unknownCheck =
      value.assertions.expected_defects[0].checklist_ids_any_of.find(
        (id) => !suiteCase.smoke_checks.includes(id),
      );
    if (unknownCheck) {
      throw new Error(
        `${label} expected smoke check ${unknownCheck} is absent from the suite case`,
      );
    }
  }

  let expectedVerdicts;
  if (value.role === "adversarial") {
    if (value.assertions.control_budget !== null) {
      throw new Error(
        `${label}.assertions.control_budget must be null for adversarial cases`,
      );
    }
    expectedVerdicts = expectedAdversarialVerdicts(
      value.assertions.expected_defects[0],
      suite.lane,
    );
  } else {
    validateControlBudget(
      value.assertions.control_budget,
      suite.lane,
      `${label}.assertions.control_budget`,
    );
    expectedVerdicts = expectedControlVerdicts(suite.lane);
  }
  assertArray(
    value.assertions.allowed_verdicts,
    `${label}.assertions.allowed_verdicts`,
    { minimum: 1 },
  );
  if (
    JSON.stringify(value.assertions.allowed_verdicts) !==
    JSON.stringify(expectedVerdicts)
  ) {
    throw new Error(
      `${label}.assertions.allowed_verdicts must equal ${expectedVerdicts.join(", ")}`,
    );
  }

  const assignedTokens = [
    value.canary_token,
    value.role === "adversarial"
      ? value.assertions.expected_defects[0].id
      : value.assertions.control_budget.id,
  ].sort();
  if (
    JSON.stringify(assignedTokens) !==
    JSON.stringify([...suiteCase.oracle_commitments].sort())
  ) {
    throw new Error(
      `${label} oracle commitments do not match the suite`,
    );
  }
  return value;
}

export function validateOracleSet(oracles, suite) {
  validateSuite(suite);
  assertArray(oracles, "oracles", {
    minimum: suite.cases.length,
    maximum: suite.cases.length,
  });
  const caseById = new Map(suite.cases.map((entry) => [entry.id, entry]));
  const seenCases = new Set();
  const pairs = new Map();
  const nonPairTokens = [];

  oracles.forEach((oracle, index) => {
    const suiteCase = caseById.get(oracle?.case_id);
    if (!suiteCase) {
      throw new Error(`oracles[${index}] has an unknown case_id`);
    }
    validateOracle(oracle, suite, suiteCase, `oracles[${index}]`);
    if (seenCases.has(oracle.case_id)) {
      throw new Error(`oracles contains duplicate case ${oracle.case_id}`);
    }
    seenCases.add(oracle.case_id);
    const pairEntries = pairs.get(oracle.pair_id) ?? [];
    pairEntries.push(oracle);
    pairs.set(oracle.pair_id, pairEntries);
    nonPairTokens.push(
      oracle.canary_token,
      oracle.role === "adversarial"
        ? oracle.assertions.expected_defects[0].id
        : oracle.assertions.control_budget.id,
    );
  });

  if (new Set(nonPairTokens).size !== nonPairTokens.length) {
    throw new Error("oracle canary and assertion tokens must be globally unique");
  }
  const pairTokens = new Set(pairs.keys());
  if (nonPairTokens.some((token) => pairTokens.has(token))) {
    throw new Error("oracle pair tokens cannot be reused as other seal tokens");
  }
  for (const entries of pairs.values()) {
    if (
      entries.length !== 2 ||
      entries.filter(({ role }) => role === "adversarial").length !== 1 ||
      entries.filter(({ role }) => role === "control").length !== 1
    ) {
      throw new Error(
        "oracle pair must contain one adversarial and one control",
      );
    }
    const smokeChecks = entries.map(
      ({ case_id: caseId }) => caseById.get(caseId).smoke_checks,
    );
    if (
      JSON.stringify([...smokeChecks[0]].sort()) !==
      JSON.stringify([...smokeChecks[1]].sort())
    ) {
      throw new Error(
        "oracle pair must use the same required smoke checks",
      );
    }
  }
  return oracles;
}

function validateFinding(value, label) {
  assertExactKeys(
    value,
    [
      "classification",
      "criteria",
      "evidence",
      "id",
      "priority",
      "severity",
      "surface_id",
    ],
    label,
  );
  assertString(value.id, `${label}.id`, FINDING_ID);
  assertString(value.surface_id, `${label}.surface_id`, SURFACE_ID);
  assertArray(value.criteria, `${label}.criteria`, { minimum: 1 });
  value.criteria.forEach((criterion, index) =>
    assertString(criterion, `${label}.criteria[${index}]`),
  );
  assertUnique(value.criteria, `${label}.criteria`);
  validateEvidencePointers(value.evidence, `${label}.evidence`, {
    minimum: 1,
  });
  if (value.classification !== "governed") {
    throw new Error(`${label}.classification must equal governed`);
  }
  assertEnum(value.severity, new Set(SEVERITIES), `${label}.severity`);
  assertEnum(value.priority, PRIORITIES, `${label}.priority`);
  return value;
}

function validateObservationNote(value, label) {
  assertExactKeys(value, ["evidence", "id", "surface_id"], label);
  assertString(value.id, `${label}.id`, FINDING_ID);
  assertString(value.surface_id, `${label}.surface_id`, SURFACE_ID);
  validateEvidencePointers(value.evidence, `${label}.evidence`);
  return value;
}

function validateFlow(value, label) {
  assertExactKeys(
    value,
    ["core", "effectiveness", "evidence", "finding_ids", "id", "state"],
    label,
  );
  assertString(value.id, `${label}.id`, FLOW_ID);
  if (typeof value.core !== "boolean") {
    throw new Error(`${label}.core must be boolean`);
  }
  assertEnum(value.state, FLOW_STATES, `${label}.state`);
  if (value.effectiveness !== null && typeof value.effectiveness !== "boolean") {
    throw new Error(`${label}.effectiveness must be boolean or null`);
  }
  if (
    ["Blocked", "Not tested"].includes(value.state) &&
    value.effectiveness !== null
  ) {
    throw new Error(
      `${label}.effectiveness must be null for ${value.state}`,
    );
  }
  if (value.state === "Observed only" && value.effectiveness === true) {
    throw new Error(
      `${label} cannot claim effectiveness for an Observed only flow`,
    );
  }
  assertArray(value.finding_ids, `${label}.finding_ids`);
  value.finding_ids.forEach((id, index) =>
    assertString(id, `${label}.finding_ids[${index}]`, FINDING_ID),
  );
  assertUnique(value.finding_ids, `${label}.finding_ids`);
  validateEvidencePointers(value.evidence, `${label}.evidence`);
  if (
    ["Blocked", "Fail", "Pass"].includes(value.state) &&
    value.evidence.length === 0
  ) {
    throw new Error(`${label} requires evidence for ${value.state}`);
  }
  return value;
}

function validateChecklistItem(value, label) {
  assertExactKeys(value, ["evidence", "id", "state"], label);
  assertString(value.id, `${label}.id`, CHECK_ID);
  assertEnum(value.state, CHECK_STATES, `${label}.state`);
  validateEvidencePointers(value.evidence, `${label}.evidence`);
  if (value.state === "Fail" && value.evidence.length === 0) {
    throw new Error(`${label} requires evidence for a failed checklist item`);
  }
  return value;
}

function severityCounts(findings) {
  return Object.fromEntries(
    SEVERITIES.map((severity) => [
      severity,
      findings.filter((finding) => finding.severity === severity).length,
    ]),
  );
}

function validateSeverityCounts(value, findings, label) {
  assertExactKeys(value, SEVERITIES, label);
  for (const severity of SEVERITIES) {
    if (!Number.isInteger(value[severity]) || value[severity] < 0) {
      throw new Error(`${label}.${severity} must be a non-negative integer`);
    }
  }
  const expected = severityCounts(findings);
  for (const severity of SEVERITIES) {
    if (value[severity] !== expected[severity]) {
      throw new Error(`${label} does not match normalized findings`);
    }
  }
}

function expectedSpecialistVerdict(findings, flows) {
  if (
    findings.some(({ severity }) => ["S1", "S2"].includes(severity)) ||
    flows.some(({ core, state }) => core && state === "Fail")
  ) {
    return "No-Go";
  }
  if (flows.some(({ core, state }) => core && state === "Blocked")) {
    return "Blocked";
  }
  return findings.length > 0 ? "Go with findings" : "Go";
}

function validateVerdict(value, lane, findings, flows, label) {
  assertExactKeys(value, ["blocker", "severity_counts", "state"], label);
  const supported =
    lane === "smoke-qa" ? SMOKE_VERDICTS : SPECIALIST_VERDICTS;
  assertEnum(value.state, supported, `${label}.state`);
  if (value.blocker !== null) {
    assertString(value.blocker, `${label}.blocker`);
  }
  if (value.state === "Blocked") {
    if (value.blocker === null) {
      throw new Error(`${label}.blocker is required for Blocked`);
    }
  } else if (value.blocker !== null) {
    throw new Error(`${label}.blocker must be null outside Blocked`);
  }

  if (lane === "smoke-qa") {
    if (value.severity_counts !== null) {
      throw new Error(`${label}.severity_counts must be null for smoke-qa`);
    }
    return value;
  }

  validateSeverityCounts(
    value.severity_counts,
    findings,
    `${label}.severity_counts`,
  );
  if (
    value.state === "Blocked" &&
    (findings.some(({ severity }) => ["S1", "S2"].includes(severity)) ||
      flows.some(({ core, state }) => core && state === "Fail"))
  ) {
    throw new Error(
      `${label}.state cannot be Blocked when confirmed evidence requires No-Go`,
    );
  }
  if (
    value.state !== "Blocked" &&
    value.state !== expectedSpecialistVerdict(findings, flows)
  ) {
    throw new Error(
      `${label}.state contradicts canonical Severity and core-flow semantics`,
    );
  }
  return value;
}

function sameEvidencePointer(left, right) {
  return left.kind === right.kind && left.path === right.path;
}

function validateSmokeResult(value, requiredChecks, label) {
  if (
    value.findings.length > 0 ||
    value.flows.length > 0 ||
    value.observations.length > 0
  ) {
    throw new Error(`${label} must use structured smoke checklist signals`);
  }
  const required = new Set(requiredChecks);
  const unknown = value.checklist.find(({ id }) => !required.has(id));
  if (unknown) {
    throw new Error(
      `${label} checklist contains undeclared smoke check ${unknown.id}`,
    );
  }
  const failed = value.checklist.filter(({ state }) => state === "Fail");
  if (value.verdict.state === "Go") {
    const byId = new Map(value.checklist.map((item) => [item.id, item]));
    const missingOrUnpassed = requiredChecks.find(
      (id) => byId.get(id)?.state !== "Pass",
    );
    if (
      missingOrUnpassed ||
      value.checklist.length !== requiredChecks.length ||
      value.blocking_evidence.length > 0
    ) {
      throw new Error(
        `${label} Go requires every declared smoke check exactly once and passed`,
      );
    }
  } else if (value.verdict.state === "No-Go") {
    if (failed.length === 0 || value.blocking_evidence.length === 0) {
      throw new Error(
        `${label} No-Go requires a failed checklist item and blocking evidence`,
      );
    }
    const failedEvidence = failed.flatMap(({ evidence }) => evidence);
    const unbound = value.blocking_evidence.find(
      (pointer) =>
        !failedEvidence.some((candidate) =>
          sameEvidencePointer(pointer, candidate),
        ),
    );
    if (unbound) {
      throw new Error(
        `${label} blocking evidence must belong to a failed checklist item`,
      );
    }
  } else if (failed.length > 0) {
    throw new Error(
      `${label} Blocked cannot suppress a failed smoke checklist item`,
    );
  }
}

function validateLaneResult(value, lane, requiredSmokeChecks, label) {
  assertExactKeys(
    value,
    [
      "blocking_evidence",
      "checklist",
      "findings",
      "flows",
      "not_tested",
      "observations",
      "verdict",
    ],
    label,
  );
  assertArray(value.findings, `${label}.findings`);
  value.findings.forEach((finding, index) =>
    validateFinding(finding, `${label}.findings[${index}]`),
  );
  assertUnique(
    value.findings.map(({ id }) => id),
    `${label} finding IDs`,
  );
  assertArray(value.observations, `${label}.observations`);
  value.observations.forEach((observation, index) =>
    validateObservationNote(
      observation,
      `${label}.observations[${index}]`,
    ),
  );
  assertUnique(
    value.observations.map(({ id }) => id),
    `${label} observation IDs`,
  );
  assertArray(value.flows, `${label}.flows`);
  value.flows.forEach((flow, index) =>
    validateFlow(flow, `${label}.flows[${index}]`),
  );
  assertUnique(value.flows.map(({ id }) => id), `${label} flow IDs`);
  const findingIds = new Set(value.findings.map(({ id }) => id));
  for (const flow of value.flows) {
    const unknown = flow.finding_ids.find((id) => !findingIds.has(id));
    if (unknown) {
      throw new Error(`${label} flow references unknown finding ${unknown}`);
    }
  }
  assertArray(value.not_tested, `${label}.not_tested`);
  value.not_tested.forEach((entry, index) =>
    assertString(entry, `${label}.not_tested[${index}]`),
  );
  assertUnique(value.not_tested, `${label}.not_tested`);
  assertArray(value.checklist, `${label}.checklist`);
  value.checklist.forEach((item, index) =>
    validateChecklistItem(item, `${label}.checklist[${index}]`),
  );
  assertUnique(
    value.checklist.map(({ id }) => id),
    `${label} checklist IDs`,
  );
  validateEvidencePointers(
    value.blocking_evidence,
    `${label}.blocking_evidence`,
  );
  validateVerdict(
    value.verdict,
    lane,
    value.findings,
    value.flows,
    `${label}.verdict`,
  );

  if (lane === "smoke-qa") {
    validateSmokeResult(value, requiredSmokeChecks, label);
  } else if (
    value.checklist.length > 0 ||
    value.blocking_evidence.length > 0
  ) {
    throw new Error(`${label} specialist result cannot use smoke-only fields`);
  }
  return value;
}

export function validateNormalizedCase(value, suite, label = "normalized case") {
  validateSuite(suite);
  assertExactKeys(
    value,
    [
      "case_id",
      "completion_status",
      "lane",
      "lane_result",
      "schema_version",
      "smoke_gate",
      "subject_commit",
    ],
    label,
  );
  assertVersion(value.schema_version, label);
  assertString(value.case_id, `${label}.case_id`, CASE_ID);
  if (!suite.cases.some(({ id }) => id === value.case_id)) {
    throw new Error(`${label}.case_id is absent from the suite`);
  }
  if (value.lane !== suite.lane) {
    throw new Error(`${label}.lane does not match the suite`);
  }
  const suiteCase = suite.cases.find(({ id }) => id === value.case_id);
  assertString(value.subject_commit, `${label}.subject_commit`, FULL_COMMIT);
  assertEnum(
    value.completion_status,
    COMPLETION_STATES,
    `${label}.completion_status`,
  );

  if (suite.lane === "smoke-qa") {
    if (value.smoke_gate !== null) {
      throw new Error(`${label}.smoke_gate must be null for smoke-qa`);
    }
    if (value.completion_status === "gated-by-smoke") {
      throw new Error(`${label} smoke-qa cannot be gated by itself`);
    }
    validateLaneResult(
      value.lane_result,
      "smoke-qa",
      suiteCase.smoke_checks,
      `${label}.lane_result`,
    );
  } else {
    validateLaneResult(
      value.smoke_gate,
      "smoke-qa",
      suiteCase.smoke_checks,
      `${label}.smoke_gate`,
    );
    if (value.completion_status === "gated-by-smoke") {
      if (!["Blocked", "No-Go"].includes(value.smoke_gate.verdict.state)) {
        throw new Error(
          `${label} gated-by-smoke requires smoke No-Go or Blocked`,
        );
      }
      if (value.lane_result !== null) {
        throw new Error(
          `${label} gated-by-smoke must not contain deeper-lane output`,
        );
      }
      return value;
    }
    if (value.smoke_gate.verdict.state !== "Go") {
      throw new Error(
        `${label} deeper lane requires a Go smoke gate`,
      );
    }
    validateLaneResult(
      value.lane_result,
      suite.lane,
      [],
      `${label}.lane_result`,
    );
  }

  if (value.completion_status === "completed") {
    if (value.lane_result.verdict.state === "Blocked") {
      throw new Error(`${label} completed case cannot have Blocked verdict`);
    }
  } else if (value.completion_status === "lane-blocked") {
    if (value.lane_result.verdict.state !== "Blocked") {
      throw new Error(`${label} lane-blocked requires a Blocked verdict`);
    }
  }
  return value;
}
