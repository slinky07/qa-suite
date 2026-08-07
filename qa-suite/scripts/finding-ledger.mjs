#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertExactKeys,
  assertPlainObject,
  assertSchemaValue,
  canonicalJson,
  parseJsonStrict,
  sha256,
  validateSchemaDefinition,
  valuesEqual,
} from "./lib/json-contract.mjs";

export { parseJsonStrict };

const scriptPath = fileURLToPath(import.meta.url);
const schemaV2Path = resolve(
  dirname(scriptPath),
  "../references/finding-ledger.schema.json",
);
const schemaV1Path = resolve(
  dirname(scriptPath),
  "../references/finding-ledger-v1.schema.json",
);
const LEGACY_LANES = [
  "smoke-qa",
  "regression-qa",
  "bob-qa",
  "performance-qa",
  "security-qa",
  "api-qa",
  "compatibility-qa",
];
const SHIPPED_LANES = [
  ...LEGACY_LANES,
  "reliability-qa",
  "deployment-qa",
  "data-integrity-qa",
];
const TEMPORARY_SPECIALIST_PATTERN =
  /^temporary-qa-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{64}$/u;
const REQUIRED_FIELDS = [
  "id",
  "schema_version",
  "lane",
  "severity",
  "priority",
  "component",
  "location",
  "oracle",
  "status",
  "status_reason",
  "candidate_first_seen",
  "candidate_last_confirmed",
  "first_seen",
  "last_seen",
  "occurrences",
  "defect_record",
  "reports",
  "sensitivity",
];
const DEFECT_RECORD_FIELDS = [
  "actual_result",
  "environment",
  "expected_result",
  "repro_steps",
];
const REPORT_POINTER_FIELDS = ["candidate", "lane", "pointer"];
const SENSITIVITY_FIELDS = ["classification", "clearance", "storage"];
const CLEARANCE_FIELDS = ["at", "by", "reason"];
const SENSITIVE_CLASSES = new Set([
  "security-s1-s2",
  "uncertain",
  "human-sensitive",
]);
const SECRET_PATTERNS = [
  /-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\b(?:glpat|gloas|gldt|glrtr?|glcbt|glptt|glft|glimt|glagent|glwt|glsoat|glffct)-[A-Za-z0-9_-]{10,}\b/,
  /\b(?:xox[bapors]|xapp|xwfp|xoxe)-[A-Za-z0-9-]{10,}\b/,
  /\b_gitlab_session=\S+/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /\b(?:authorization\s*:\s*)?bearer\s+\S+/i,
  /\b(?:token|password|session(?:id)?|api[_-]?key|client[_-]?secret)\s*[:=]\s*\S+/i,
];
const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "client_secret",
  "key",
  "password",
  "refresh_token",
  "secret",
  "session",
  "session_id",
  "sessionid",
  "sharedaccesssignature",
  "sig",
  "signature",
  "token",
  "x_amz_credential",
  "x_amz_security_token",
  "x_amz_signature",
  "x_goog_credential",
  "x_goog_signature",
]);
const IMMUTABLE_FINDING_FIELDS = [
  "id",
  "schema_version",
  "lane",
  "component",
  "candidate_first_seen",
  "first_seen",
];

function assertArrayEqual(observed, expected, label) {
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(label + " does not match the version-1 contract");
  }
}

export function validateSchemaContract(schema) {
  assertPlainObject(schema, "finding ledger schema");
  validateSchemaDefinition(schema, "finding ledger schema");
  if (
    schema.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    schema.type !== "object" ||
    schema.additionalProperties !== false
  ) {
    throw new Error("finding ledger schema header is invalid");
  }
  assertArrayEqual(schema.required, REQUIRED_FIELDS, "schema required fields");
  const schemaVersion = schema.properties?.schema_version?.const;
  if (![1, 2].includes(schemaVersion)) {
    throw new Error("schema_version must be const 1 or 2");
  }
  let idPattern;
  try {
    idPattern = new RegExp(schema.properties.id.pattern);
  } catch (error) {
    throw new Error(`schema id pattern is invalid: ${error.message}`);
  }
  for (const property of ["severity", "priority", "status"]) {
    if (!Array.isArray(schema.properties?.[property]?.enum)) {
      throw new Error(`schema ${property} enum is missing`);
    }
  }
  const laneContracts = [
    [schema.properties?.lane, "schema lane"],
    [schema.$defs?.report_pointer?.properties?.lane, "schema report lane"],
  ];
  const acceptedLanes = schemaVersion === 1 ? LEGACY_LANES : SHIPPED_LANES;
  for (const [contract, label] of laneContracts) {
    if (!contract) throw new Error(`${label} contract is missing`);
    for (const lane of acceptedLanes) {
      assertSchemaValue(lane, contract, schema, label);
    }
    for (const lane of SHIPPED_LANES.filter(
      (candidate) => !acceptedLanes.includes(candidate),
    )) {
      try {
        assertSchemaValue(lane, contract, schema, label);
      } catch {
        continue;
      }
      throw new Error(
        `${label} accepts unsupported version-${schemaVersion} lane ${lane}`,
      );
    }
    const temporary =
      "temporary-qa-cache-failover-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let acceptsTemporary = true;
    try {
      assertSchemaValue(temporary, contract, schema, label);
    } catch {
      acceptsTemporary = false;
    }
    if (acceptsTemporary !== (schemaVersion === 2)) {
      throw new Error(`${label} temporary identity contract is invalid`);
    }
  }
  for (const property of ["classification", "storage"]) {
    if (
      !Array.isArray(
        schema.$defs?.sensitivity?.properties?.[property]?.enum,
      )
    ) {
      throw new Error(`schema sensitivity ${property} enum is missing`);
    }
  }
  return { idPattern, schemaVersion };
}

async function loadSchemas() {
  const [v1Source, v2Source] = await Promise.all([
    readFile(schemaV1Path, "utf8"),
    readFile(schemaV2Path, "utf8"),
  ]);
  const v1 = parseJsonStrict(v1Source, "finding-ledger-v1.schema.json");
  const v2 = parseJsonStrict(v2Source, "finding-ledger.schema.json");
  validateSchemaContract(v1);
  validateSchemaContract(v2);
  return new Map([
    [1, v1],
    [2, v2],
  ]);
}

export async function loadFindingSchema(schemaVersion) {
  const schema = (await loadSchemas()).get(schemaVersion);
  if (!schema) throw new Error(`unsupported finding ledger schema version ${schemaVersion}`);
  return schema;
}

function assertEnum(schema, property, value, label) {
  if (!schema.properties[property].enum.includes(value)) {
    throw new Error(`${label} has unsupported ${property}: ${value}`);
  }
}

function assertLane(schema, value, label) {
  assertSchemaValue(value, schema.properties.lane, schema, `${label}.lane`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function decodeUrlComponentRepeatedly(value, label) {
  let decoded = value;
  for (let pass = 0; pass < 5; pass += 1) {
    if (!/%[0-9A-Fa-f]{2}/.test(decoded)) return decoded;
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error(`${label} contains malformed URL encoding`);
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
    throw new Error(`${label} contains excessive URL encoding`);
  }
  return decoded;
}

function assertNoSecretPatterns(value, label) {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(value)) {
      throw new Error(`${label} contains secret-like material`);
    }
  }
}

function assertNoControlCharacters(value, label) {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    throw new Error(`${label} contains a control character`);
  }
}

function assertNoSensitiveAssignments(value, label) {
  const assignments =
    value.matchAll(
      /(?:^|[^A-Za-z0-9_])(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*[:=]\s*(\S+)/g,
    );
  for (const assignment of assignments) {
    const normalizedKey = assignment[2]
      .toLowerCase()
      .replaceAll("-", "_");
    if (SENSITIVE_QUERY_KEYS.has(normalizedKey)) {
      throw new Error(`${label} contains a sensitive credential assignment`);
    }
  }
}

function assertDecodedSafety(value, label) {
  assertNoControlCharacters(value, label);
  assertSafeUrls(value, label);
  assertNoSecretPatterns(value, label);
  assertNoSensitiveAssignments(value, label);
}

function assertSafeUrlParameters(parameters, location, label) {
  for (const [key, value] of parameters) {
    const decodedKey = decodeUrlComponentRepeatedly(
      key,
      `${label} URL ${location} key`,
    );
    assertNoControlCharacters(decodedKey, `${label} URL ${location} key`);
    const normalizedKey = decodedKey.toLowerCase().replaceAll("-", "_");
    if (SENSITIVE_QUERY_KEYS.has(normalizedKey)) {
      throw new Error(`${label} contains a sensitive URL ${location} key`);
    }
    const decodedValue = decodeUrlComponentRepeatedly(
      value,
      `${label} URL ${location} value`,
    );
    assertDecodedSafety(decodedValue, `${label} URL ${location} value`);
  }
}

function assertSafeUrls(value, label) {
  const urls =
    value.match(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"']+/g) ?? [];
  for (const source of urls) {
    let parsed;
    try {
      parsed = new URL(source);
    } catch {
      continue;
    }
    if (parsed.username || parsed.password) {
      throw new Error(`${label} contains a credential-bearing URL`);
    }
    assertSafeUrlParameters(parsed.searchParams, "query", label);
    if (parsed.hash.length > 1) {
      const fragment = decodeUrlComponentRepeatedly(
        parsed.hash.slice(1),
        `${label} URL fragment`,
      );
      assertNoControlCharacters(fragment, `${label} URL fragment`);
      assertNoSecretPatterns(fragment, `${label} URL fragment`);
      assertSafeUrlParameters(
        new URLSearchParams(fragment),
        "fragment",
        label,
      );
      const routedQueryIndex = fragment.indexOf("?");
      if (routedQueryIndex !== -1) {
        assertSafeUrlParameters(
          new URLSearchParams(fragment.slice(routedQueryIndex + 1)),
          "fragment",
          label,
        );
      }
      assertSafeUrls(fragment, `${label} URL fragment`);
      assertNoSensitiveAssignments(fragment, `${label} URL fragment`);
    }
  }
}

function assertSafeString(value, label) {
  assertNonEmptyString(value, label);
  assertDecodedSafety(value, label);
  if (/%[0-9A-Fa-f]{2}/.test(value)) {
    const decoded = decodeUrlComponentRepeatedly(value, label);
    if (decoded !== value) {
      assertNonEmptyString(decoded, `${label} decoded value`);
      assertDecodedSafety(decoded, `${label} decoded value`);
    }
  }
}

export function assertSafeStrings(value, label) {
  if (typeof value === "string") {
    assertSafeString(value, label);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertSafeStrings(item, `${label}[${index}]`),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertSafeStrings(item, `${label}.${key}`);
    }
  }
}

function parseTimestamp(value, label) {
  assertNonEmptyString(value, label);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(
      value,
    );
  if (!match) {
    throw new Error(`${label} must be a UTC date-time ending in Z`);
  }
  const [, year, month, day, hour, minute, second, fraction = "0"] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] =
    parts;
  const leapYear =
    yearValue % 4 === 0 &&
    (yearValue % 100 !== 0 || yearValue % 400 === 0);
  const daysByMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    yearValue < 1 ||
    monthValue < 1 ||
    monthValue > 12 ||
    dayValue < 1 ||
    dayValue > daysByMonth[monthValue - 1] ||
    hourValue > 23 ||
    minuteValue > 59 ||
    secondValue > 59
  ) {
    throw new Error(`${label} must be a valid UTC calendar date-time`);
  }
  return { fraction, parts };
}

function assertTimestamp(value, label) {
  parseTimestamp(value, label);
}

function compareTimestamps(left, right) {
  const leftTimestamp = parseTimestamp(left, "left timestamp");
  const rightTimestamp = parseTimestamp(right, "right timestamp");
  for (let index = 0; index < leftTimestamp.parts.length; index += 1) {
    const difference =
      leftTimestamp.parts[index] - rightTimestamp.parts[index];
    if (difference !== 0) return Math.sign(difference);
  }
  const width = Math.max(
    leftTimestamp.fraction.length,
    rightTimestamp.fraction.length,
  );
  const leftFraction = leftTimestamp.fraction.padEnd(width, "0");
  const rightFraction = rightTimestamp.fraction.padEnd(width, "0");
  if (leftFraction === rightFraction) return 0;
  return leftFraction < rightFraction ? -1 : 1;
}

function assertDefectRecord(record, label) {
  assertExactKeys(record, DEFECT_RECORD_FIELDS, label);
  if (!Array.isArray(record.repro_steps) || record.repro_steps.length === 0) {
    throw new Error(`${label}.repro_steps must not be empty`);
  }
  record.repro_steps.forEach((step, index) =>
    assertSafeString(step, `${label}.repro_steps[${index}]`),
  );
  for (const field of [
    "expected_result",
    "actual_result",
    "environment",
  ]) {
    assertSafeString(record[field], `${label}.${field}`);
  }
}

function assertClearance(clearance, label) {
  assertExactKeys(clearance, CLEARANCE_FIELDS, label);
  assertSafeString(clearance.by, `${label}.by`);
  assertTimestamp(clearance.at, `${label}.at`);
  assertSafeString(clearance.reason, `${label}.reason`);
}

function assertSensitivity(row, schema, context, label) {
  const sensitivity = row.sensitivity;
  assertExactKeys(sensitivity, SENSITIVITY_FIELDS, `${label}.sensitivity`);
  const sensitivitySchema = schema.$defs.sensitivity.properties;
  for (const property of ["classification", "storage"]) {
    if (!sensitivitySchema[property].enum.includes(sensitivity[property])) {
      throw new Error(
        `${label}.sensitivity has unsupported ${property}: ${sensitivity[property]}`,
      );
    }
  }

  const { classification, clearance, storage } = sensitivity;
  if (classification === "standard") {
    if (storage !== "committed" || clearance !== null) {
      throw new Error(
        `${label} standard sensitivity requires committed storage and no clearance`,
      );
    }
  } else if (SENSITIVE_CLASSES.has(classification)) {
    if (!["redacted", "sidecar-local"].includes(storage) || clearance !== null) {
      throw new Error(`${label} sensitive class must remain redacted`);
    }
  } else if (classification === "human-cleared") {
    if (storage !== "committed") {
      throw new Error(`${label} human-cleared record must be committed`);
    }
    assertClearance(clearance, `${label}.sensitivity.clearance`);
  }

  const securityHigh =
    row.lane === "security-qa" && ["S1", "S2"].includes(row.severity);
  const temporarySpecialist = TEMPORARY_SPECIALIST_PATTERN.test(row.lane);
  if (
    securityHigh &&
    !["security-s1-s2", "human-cleared"].includes(classification)
  ) {
    throw new Error(
      `${label} security S1/S2 requires sensitive or human-cleared classification`,
    );
  }
  if (
    context.repoVisibility === "public" &&
    securityHigh &&
    storage === "committed"
  ) {
    throw new Error(`${label} public security S1/S2 record must be redacted`);
  }
  if (
    temporarySpecialist &&
    !["uncertain", "human-cleared"].includes(classification)
  ) {
    throw new Error(
      `${label} temporary specialist finding requires uncertain or human-cleared sensitivity`,
    );
  }

  if (storage === "committed") {
    assertDefectRecord(row.defect_record, `${label}.defect_record`);
  } else if (row.defect_record !== storage) {
    throw new Error(
      `${label}.defect_record must equal sensitivity storage ${storage}`,
    );
  }

  if (row.status === "fixed" && storage !== "committed") {
    throw new Error(`${label} fixed row needs a sanitized committed repro`);
  }
}

export function validateFindingRows(rows, schema, context) {
  const { idPattern, schemaVersion } = validateSchemaContract(schema);
  if (!Array.isArray(rows)) {
    throw new Error("finding rows must be an array");
  }
  const ids = new Set();
  const reportCandidates = new Map();
  const unknownComponents = new Set();

  rows.forEach((row, index) => {
    const label = `finding row ${index + 1}`;
    assertSchemaValue(row, schema, schema, label);
    assertExactKeys(row, REQUIRED_FIELDS, label);
    if (row.schema_version !== schemaVersion) {
      throw new Error(`${label} has unsupported schema_version`);
    }
    assertNonEmptyString(row.id, `${label}.id`);
    if (!idPattern.test(row.id)) {
      throw new Error(`${label}.id does not match the schema`);
    }
    if (ids.has(row.id)) {
      throw new Error(`duplicate finding id: ${row.id}`);
    }
    ids.add(row.id);
    assertLane(schema, row.lane, label);
    for (const property of ["severity", "priority", "status"]) {
      assertEnum(schema, property, row[property], label);
    }
    for (const property of [
      "component",
      "location",
      "oracle",
      "candidate_first_seen",
      "candidate_last_confirmed",
    ]) {
      assertSafeString(row[property], `${label}.${property}`);
    }
    if (!context.components.has(row.component)) {
      unknownComponents.add(row.component);
    }
    assertTimestamp(row.first_seen, `${label}.first_seen`);
    assertTimestamp(row.last_seen, `${label}.last_seen`);
    if (compareTimestamps(row.last_seen, row.first_seen) < 0) {
      throw new Error(`${label}.last_seen cannot be before first_seen`);
    }
    if (!Number.isInteger(row.occurrences) || row.occurrences < 1) {
      throw new Error(`${label}.occurrences must be a positive integer`);
    }
    if (["accepted", "wontfix"].includes(row.status)) {
      assertSafeString(row.status_reason, `${label}.status_reason`);
    } else if (row.status_reason !== null) {
      throw new Error(`${label}.status_reason must be null for ${row.status}`);
    }
    if (!Array.isArray(row.reports) || row.reports.length === 0) {
      throw new Error(`${label}.reports must not be empty`);
    }
    const reportPointers = new Set();
    row.reports.forEach((report, reportIndex) => {
      const reportLabel = `${label}.reports[${reportIndex}]`;
      assertExactKeys(report, REPORT_POINTER_FIELDS, reportLabel);
      assertSchemaValue(
        report.lane,
        schema.$defs.report_pointer.properties.lane,
        schema,
        `${reportLabel}.lane`,
      );
      assertSafeString(report.pointer, `${reportLabel}.pointer`);
      assertSafeString(report.candidate, `${reportLabel}.candidate`);
      if (reportPointers.has(report.pointer)) {
        throw new Error(`${label} has a duplicate report pointer`);
      }
      reportPointers.add(report.pointer);
      if (
        reportCandidates.has(report.pointer) &&
        reportCandidates.get(report.pointer) !== report.candidate
      ) {
        throw new Error(
          `${reportLabel}.pointer is already bound to a different candidate`,
        );
      }
      reportCandidates.set(report.pointer, report.candidate);
    });
    if (
      !row.reports.some(
        (report) => report.candidate === row.candidate_last_confirmed,
      )
    ) {
      throw new Error(
        `${label} needs report provenance for candidate_last_confirmed`,
      );
    }
    assertSensitivity(row, schema, context, label);
    assertSafeStrings(row, label);
  });

  return [...unknownComponents].sort();
}

function parseJsonl(source, label) {
  if (source.length === 0) return [];
  const lines = source.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.some((line) => line.length === 0)) {
    throw new Error(`${label} contains a blank line`);
  }
  return lines.map((line, index) =>
    parseJsonStrict(line, `${label}:${index + 1}`),
  );
}


function runGit(repositoryRoot, args, acceptedStatuses = [0]) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (!acceptedStatuses.includes(result.status)) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

function extractSection(markdown, heading) {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start === -1) throw new Error(`qa-context.md is missing ${marker}`);
  const remainder = markdown.slice(start + marker.length);
  const next = /^##[ \t]+/m.exec(remainder);
  return next ? remainder.slice(0, next.index) : remainder;
}

function extractField(markdown, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `^- \\*\\*${escaped}:\\*\\*[ \\t]*(.+)$`,
    "m",
  ).exec(markdown);
  if (!match) throw new Error(`qa-context.md is missing ${label}`);
  return match[1].replace(/[ \t]*<!--.*$/, "").trim();
}

function extractOptionalField(markdown, label) {
  try {
    return extractField(markdown, label);
  } catch (error) {
    if (error.message === `qa-context.md is missing ${label}`) return undefined;
    throw error;
  }
}

function insideRepository(repositoryRoot, path, label) {
  const relativePath = relative(repositoryRoot, path);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must resolve inside the repository`);
  }
  return relativePath.split(sep).join("/");
}

async function assertRegularInRepository(repositoryRoot, path, label) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, not a symlink`);
  }
  const canonical = await realpath(path);
  insideRepository(repositoryRoot, canonical, label);
}

async function assertCreationParentInRepository(
  repositoryRoot,
  targetPath,
  label,
) {
  let existingParent = dirname(targetPath);
  while (true) {
    try {
      const canonicalParent = await realpath(existingParent);
      const relativeParent = relative(repositoryRoot, canonicalParent);
      if (
        relativeParent === ".." ||
        relativeParent.startsWith(`..${sep}`) ||
        isAbsolute(relativeParent)
      ) {
        throw new Error(`${label} parent must resolve inside the repository`);
      }
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(existingParent);
      if (parent === existingParent) throw error;
      existingParent = parent;
    }
  }
}

async function loadContext(repositoryRoot, contextPath) {
  const resolvedContext = resolve(repositoryRoot, contextPath);
  await assertRegularInRepository(
    repositoryRoot,
    resolvedContext,
    "qa-context.md",
  );
  const markdown = await readFile(resolvedContext, "utf8");
  const ledgerSection = extractSection(markdown, "Finding ledger");
  const configuredPath = extractField(ledgerSection, "Path");
  if (!configuredPath || isAbsolute(configuredPath)) {
    throw new Error("finding ledger path must be repo-relative");
  }
  const ledgerPath = resolve(repositoryRoot, configuredPath);
  const ledgerGitPath = insideRepository(
    repositoryRoot,
    ledgerPath,
    "finding ledger",
  );
  const reportPath = resolve(
    repositoryRoot,
    extractField(markdown, "Report output folder"),
  );
  const reportRelative = relative(reportPath, ledgerPath);
  if (
    reportRelative === "" ||
    (!reportRelative.startsWith(`..${sep}`) && !isAbsolute(reportRelative))
  ) {
    throw new Error("finding ledger must not resolve inside the report folder");
  }
  const repoVisibility = extractField(
    ledgerSection,
    "Repository visibility (`repo_visibility`)",
  );
  if (!["public", "private"].includes(repoVisibility)) {
    throw new Error("repo_visibility must be public or private");
  }
  const componentValues = extractField(ledgerSection, "Named components")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (componentValues.length === 0) {
    throw new Error("Named components must not be empty");
  }
  const components = new Set(componentValues);
  if (components.size !== componentValues.length) {
    throw new Error("Named components must be unique");
  }
  const configuredRegistry = extractOptionalField(
    markdown,
    "Temporary specialist registry",
  );
  let registryGitPath;
  let registryPath;
  if (configuredRegistry && configuredRegistry !== "N/A") {
    if (isAbsolute(configuredRegistry)) {
      throw new Error("temporary specialist registry path must be repo-relative");
    }
    registryPath = resolve(repositoryRoot, configuredRegistry);
    registryGitPath = insideRepository(
      repositoryRoot,
      registryPath,
      "temporary specialist registry",
    );
    const registryReportRelative = relative(reportPath, registryPath);
    if (
      registryReportRelative === "" ||
      (!registryReportRelative.startsWith(`..${sep}`) &&
        !isAbsolute(registryReportRelative))
    ) {
      throw new Error(
        "temporary specialist registry must not resolve inside the report folder",
      );
    }
  }
  return {
    components,
    contextPath: resolvedContext,
    ledgerGitPath,
    ledgerPath,
    registryGitPath,
    registryPath,
    repoVisibility,
  };
}

function assertNotIgnored(repositoryRoot, gitPath, label) {
  const result = runGit(
    repositoryRoot,
    ["check-ignore", "--no-index", "--", gitPath],
    [0, 1],
  );
  if (result.status === 0) {
    throw new Error(`${label} is ignored: ${gitPath}`);
  }
}

function assertTracked(repositoryRoot, gitPath, label) {
  const result = runGit(
    repositoryRoot,
    ["ls-files", "--error-unmatch", "--", gitPath],
    [0, 1],
  );
  if (result.status !== 0) {
    throw new Error(`${label} is not tracked: ${gitPath}`);
  }
}

async function assertSidecarBoundary(repositoryRoot) {
  const sidecarGitPath = "QA/findings-sensitive.jsonl";
  const sidecarPath = resolve(repositoryRoot, sidecarGitPath);
  const ignored = runGit(
    repositoryRoot,
    ["check-ignore", "--no-index", "--", sidecarGitPath],
    [0, 1],
  );
  if (ignored.status !== 0) {
    throw new Error("sensitive sidecar path must be ignored");
  }
  const trackedInIndex = runGit(
    repositoryRoot,
    ["ls-files", "--error-unmatch", "--", sidecarGitPath],
    [0, 1],
  );
  const trackedInHead = runGit(
    repositoryRoot,
    ["cat-file", "-e", `HEAD:${sidecarGitPath}`],
    [0, 1, 128],
  );
  if (trackedInIndex.status === 0 || trackedInHead.status === 0) {
    throw new Error("sensitive sidecar must not be tracked");
  }
  const reachableHistory = runGit(
    repositoryRoot,
    ["log", "--all", "--format=%H", "--", sidecarGitPath],
    [0, 128],
  );
  if (reachableHistory.status === 0 && reachableHistory.stdout.trim()) {
    throw new Error(
      "sensitive sidecar must never appear in reachable Git history",
    );
  }
  try {
    await lstat(sidecarPath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await assertRegularInRepository(repositoryRoot, sidecarPath, "sensitive sidecar");
}

function schemaVersionForRows(rows) {
  if (rows.length === 0) return 2;
  const versions = new Set(rows.map((row) => row?.schema_version));
  if (versions.size !== 1) {
    throw new Error("finding ledger cannot mix schema versions");
  }
  const [version] = versions;
  if (![1, 2].includes(version)) {
    throw new Error(`unsupported finding ledger schema_version: ${version}`);
  }
  return version;
}

function temporaryIdentities(rows) {
  return new Set(
    rows.flatMap((row) => [row.lane, ...row.reports.map(({ lane }) => lane)])
      .filter((lane) => TEMPORARY_SPECIALIST_PATTERN.test(lane)),
  );
}

async function resolveTemporaryIdentities(
  rows,
  contextContract,
  { allowMissing = false } = {},
) {
  const identities = temporaryIdentities(rows);
  if (identities.size === 0) return [];
  if (!contextContract.registryGitPath) {
    if (allowMissing) return [...identities].sort();
    throw new Error(
      "temporary specialist findings require Temporary specialist registry in qa-context.md",
    );
  }
  const { validateRegistryProject } = await import("./specialist-registry.mjs");
  let registry;
  try {
    registry = await validateRegistryProject({
      repository: contextContract.repositoryRoot,
      context: relative(
        contextContract.repositoryRoot,
        contextContract.contextPath,
      ),
      registry: contextContract.registryGitPath,
    });
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") {
      return [...identities].sort();
    }
    throw error;
  }
  const registered = new Set(
    registry.registry.specialists.map(({ id }) => id),
  );
  const missing = [...identities].filter((id) => !registered.has(id)).sort();
  if (missing.length > 0 && !allowMissing) {
    throw new Error(
      `temporary specialist identities are not registered: ${missing.join(", ")}`,
    );
  }
  return missing;
}

export async function validateProject({
  repository = ".",
  context = "qa-context.md",
  allowMissingTemporary = false,
}) {
  const repositoryRoot = await realpath(resolve(repository));
  const contextContract = await loadContext(repositoryRoot, context);
  contextContract.repositoryRoot = repositoryRoot;
  await assertRegularInRepository(
    repositoryRoot,
    contextContract.ledgerPath,
    "finding ledger",
  );
  assertNotIgnored(
    repositoryRoot,
    contextContract.ledgerGitPath,
    "finding ledger",
  );
  assertTracked(
    repositoryRoot,
    contextContract.ledgerGitPath,
    "finding ledger",
  );
  await assertSidecarBoundary(repositoryRoot);
  const source = await readFile(contextContract.ledgerPath, "utf8");
  const rows = parseJsonl(source, contextContract.ledgerGitPath);
  const schemaVersion = schemaVersionForRows(rows);
  const schemas = await loadSchemas();
  const schema = schemas.get(schemaVersion);
  const unknownComponents = validateFindingRows(
    rows,
    schema,
    contextContract,
  );
  const missingTemporarySpecialists = await resolveTemporaryIdentities(
    rows,
    contextContract,
    { allowMissing: allowMissingTemporary },
  );
  return {
    ...contextContract,
    digest: sha256(source),
    repositoryRoot,
    rows,
    schema,
    schemaVersion,
    missingTemporarySpecialists,
    unknownComponents,
  };
}

export async function initializeLedger({
  repository = ".",
  context = "qa-context.md",
}) {
  const repositoryRoot = await realpath(resolve(repository));
  const contextContract = await loadContext(repositoryRoot, context);
  await assertCreationParentInRepository(
    repositoryRoot,
    contextContract.ledgerPath,
    "finding ledger",
  );
  assertNotIgnored(
    repositoryRoot,
    contextContract.ledgerGitPath,
    "finding ledger",
  );
  await mkdir(dirname(contextContract.ledgerPath), { recursive: true });
  try {
    const file = await open(contextContract.ledgerPath, "wx", 0o644);
    await file.close();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await assertRegularInRepository(
    repositoryRoot,
    contextContract.ledgerPath,
    "finding ledger",
  );
  await assertSidecarBoundary(repositoryRoot);
  return contextContract;
}

export function selectManifest(rows, mode) {
  if (mode === "discovery") return [];
  if (mode === "confirmation") {
    return rows.filter(({ status }) =>
      ["open", "regressed"].includes(status),
    );
  }
  if (mode === "regression") {
    return rows.filter(({ status }) => status === "fixed");
  }
  throw new Error("mode must be discovery, confirmation, or regression");
}

export async function preflightLane({
  repository = ".",
  context = "qa-context.md",
  lane,
}) {
  assertNonEmptyString(lane, "lane");
  const project = await validateProject({ repository, context });
  const schemas = await loadSchemas();
  const v2Schema = schemas.get(2);
  assertSchemaValue(
    lane,
    v2Schema.properties.lane,
    v2Schema,
    "dispatch lane",
  );
  if (TEMPORARY_SPECIALIST_PATTERN.test(lane)) {
    if (!project.registryGitPath) {
      throw new Error(
        "temporary specialist dispatch requires Temporary specialist registry in qa-context.md",
      );
    }
    const { resolveSpecialist } = await import("./specialist-registry.mjs");
    await resolveSpecialist({
      repository: project.repositoryRoot,
      context: relative(project.repositoryRoot, project.contextPath),
      registry: project.registryGitPath,
      id: lane,
    });
  }
  if (project.schemaVersion === 1 && !LEGACY_LANES.includes(lane)) {
    const contextPath = relative(
      project.repositoryRoot,
      project.contextPath,
    );
    throw new Error(
      `finding ledger schema version 1 cannot record ${lane}; run node ${JSON.stringify(scriptPath)} migrate --repo ${JSON.stringify(project.repositoryRoot)} --context ${JSON.stringify(contextPath)} --to 2 --expected-sha256 ${project.digest}`,
    );
  }
  return { ...project, lane };
}

export function assertLedgerTransition(currentRows, candidateRows) {
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const candidateById = new Map(candidateRows.map((row) => [row.id, row]));
  for (const candidate of candidateRows) {
    if (currentById.has(candidate.id)) continue;
    if (candidate.occurrences !== 1) {
      throw new Error(
        `new finding ${candidate.id} occurrences must start at 1`,
      );
    }
    if (
      candidate.candidate_first_seen !== candidate.candidate_last_confirmed
    ) {
      throw new Error(
        `new finding ${candidate.id} must start on one candidate cycle`,
      );
    }
  }
  for (const current of currentRows) {
    const candidate = candidateById.get(current.id);
    if (!candidate) {
      throw new Error(
        `finding ${current.id} cannot be deleted by write; deletion requires an explicit governed migration`,
      );
    }
    for (const field of IMMUTABLE_FINDING_FIELDS) {
      if (!valuesEqual(candidate[field], current[field])) {
        throw new Error(
          `finding ${current.id} cannot change immutable field ${field}`,
        );
      }
    }
    if (candidate.occurrences < current.occurrences) {
      throw new Error(`finding ${current.id} occurrences cannot decrease`);
    }
    if (compareTimestamps(candidate.last_seen, current.last_seen) < 0) {
      throw new Error(`finding ${current.id} last_seen cannot move backward`);
    }
    if (
      candidate.occurrences === current.occurrences &&
      candidate.candidate_last_confirmed !== current.candidate_last_confirmed
    ) {
      throw new Error(
        `finding ${current.id} candidate_last_confirmed requires an occurrence increase`,
      );
    }
    if (candidate.occurrences > current.occurrences) {
      if (candidate.occurrences !== current.occurrences + 1) {
        throw new Error(
          `finding ${current.id} occurrences must advance one cycle per write`,
        );
      }
      if (
        candidate.candidate_last_confirmed ===
        current.candidate_last_confirmed
      ) {
        throw new Error(
          `finding ${current.id} occurrence increase requires a new candidate`,
        );
      }
      if (compareTimestamps(candidate.last_seen, current.last_seen) <= 0) {
        throw new Error(
          `finding ${current.id} occurrence increase requires a later last_seen`,
        );
      }
      const hasNewCandidateProvenance = candidate.reports.some(
        (report) =>
          report.candidate === candidate.candidate_last_confirmed &&
          !current.reports.some(
            (currentReport) => currentReport.pointer === report.pointer,
          ),
      );
      if (!hasNewCandidateProvenance) {
        throw new Error(
          `finding ${current.id} occurrence increase requires new candidate provenance`,
        );
      }
    }
    for (const report of current.reports) {
      if (!candidate.reports.some((candidateReport) =>
        valuesEqual(candidateReport, report),
      )) {
        throw new Error(`finding ${current.id} report provenance cannot be removed`);
      }
    }
  }
}

export async function replaceLedger({
  repository = ".",
  context = "qa-context.md",
  candidatePath,
  expectedDigest,
}) {
  assertNonEmptyString(candidatePath, "candidatePath");
  assertNonEmptyString(expectedDigest, "expectedDigest");
  const project = await validateProject({ repository, context });
  const candidateSource = await readFile(resolve(candidatePath), "utf8");
  const candidateRows = parseJsonl(candidateSource, candidatePath);
  validateFindingRows(candidateRows, project.schema, project);
  await resolveTemporaryIdentities(candidateRows, project);
  const lockPath = `${project.ledgerPath}.lock`;
  const temporaryPath = `${project.ledgerPath}.${process.pid}.${Date.now()}.tmp`;
  let lock;
  let temporary;
  try {
    lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        created_at: new Date().toISOString(),
        expected_digest: expectedDigest,
      })}\n`,
    );
    await lock.sync();

    await assertRegularInRepository(
      project.repositoryRoot,
      project.ledgerPath,
      "finding ledger",
    );
    const currentSource = await readFile(project.ledgerPath, "utf8");
    const currentDigest = sha256(currentSource);
    if (currentDigest !== expectedDigest) {
      throw new Error(
        `finding ledger changed concurrently: expected ${expectedDigest}, observed ${currentDigest}`,
      );
    }
    const currentRows = parseJsonl(currentSource, project.ledgerGitPath);
    validateFindingRows(currentRows, project.schema, project);
    validateFindingRows(candidateRows, project.schema, project);
    await resolveTemporaryIdentities(currentRows, project);
    await resolveTemporaryIdentities(candidateRows, project);
    assertLedgerTransition(currentRows, candidateRows);

    temporary = await open(temporaryPath, "wx", 0o644);
    await temporary.writeFile(candidateSource);
    await temporary.sync();
    await temporary.close();
    temporary = undefined;
    await rename(temporaryPath, project.ledgerPath);
  } finally {
    if (temporary) await temporary.close();
    await unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (lock) {
      await lock.close();
      await unlink(lockPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  return validateProject({ repository, context });
}

export async function migrateLedger({
  repository = ".",
  context = "qa-context.md",
  toVersion,
  expectedDigest,
}) {
  if (String(toVersion) !== "2") {
    throw new Error("finding ledger migration target must be 2");
  }
  assertNonEmptyString(expectedDigest, "expectedDigest");
  if (!/^[0-9a-f]{64}$/u.test(expectedDigest)) {
    throw new Error("expectedDigest must be a lowercase SHA-256 digest");
  }
  const project = await validateProject({ repository, context });
  if (project.rows.length === 0) {
    throw new Error("an empty finding ledger starts at schema version 2; migration is not required");
  }
  if (project.schemaVersion !== 1) {
    throw new Error(`finding ledger is already schema version ${project.schemaVersion}`);
  }
  const schemas = await loadSchemas();
  const v1Schema = schemas.get(1);
  const v2Schema = schemas.get(2);
  const lockPath = `${project.ledgerPath}.lock`;
  const temporaryPath = `${project.ledgerPath}.${process.pid}.${Date.now()}.tmp`;
  let lock;
  let temporary;
  try {
    lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        created_at: new Date().toISOString(),
        expected_digest: expectedDigest,
        migration: "1-to-2",
      })}\n`,
    );
    await lock.sync();

    await assertRegularInRepository(
      project.repositoryRoot,
      project.ledgerPath,
      "finding ledger",
    );
    const currentSource = await readFile(project.ledgerPath, "utf8");
    const currentDigest = sha256(currentSource);
    if (currentDigest !== expectedDigest) {
      throw new Error(
        `finding ledger changed concurrently: expected ${expectedDigest}, observed ${currentDigest}`,
      );
    }
    const currentRows = parseJsonl(currentSource, project.ledgerGitPath);
    if (schemaVersionForRows(currentRows) !== 1) {
      throw new Error("finding ledger schema version changed during migration");
    }
    validateFindingRows(currentRows, v1Schema, project);
    const candidateRows = currentRows.map((row) => ({
      ...row,
      schema_version: 2,
    }));
    validateFindingRows(candidateRows, v2Schema, project);
    for (let index = 0; index < currentRows.length; index += 1) {
      const current = currentRows[index];
      const candidate = candidateRows[index];
      for (const field of REQUIRED_FIELDS.filter(
        (property) => property !== "schema_version",
      )) {
        if (!valuesEqual(current[field], candidate[field])) {
          throw new Error(
            `migration changed finding ${current.id} field ${field}`,
          );
        }
      }
    }
    const candidateSource = `${candidateRows
      .map((row) => JSON.stringify(row))
      .join("\n")}\n`;
    temporary = await open(temporaryPath, "wx", 0o644);
    await temporary.writeFile(candidateSource);
    await temporary.sync();
    await temporary.close();
    temporary = undefined;
    await rename(temporaryPath, project.ledgerPath);
  } finally {
    if (temporary) await temporary.close();
    await unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (lock) {
      await lock.close();
      await unlink(lockPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  return validateProject({ repository, context });
}

function parseArguments(argv) {
  const [command, ...argumentsList] = argv;
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    options[argument.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const common = {
    repository: options.repo ?? ".",
    context: options.context ?? "qa-context.md",
  };
  if (command === "init") {
    const result = await initializeLedger(common);
    console.log(
      `Initialized ${result.ledgerGitPath}; the human must commit it with qa-context.md`,
    );
    return;
  }
  if (command === "validate") {
    const result = await validateProject(common);
    console.log(
      JSON.stringify({
        ledger: result.ledgerGitPath,
        schema_version: result.schemaVersion,
        rows: result.rows.length,
        sha256: result.digest,
        unknown_components: result.unknownComponents,
      }),
    );
    return;
  }
  if (command === "preflight") {
    const result = await preflightLane({
      ...common,
      lane: options.lane,
    });
    console.log(
      JSON.stringify({
        lane: result.lane,
        ledger: result.ledgerGitPath,
        schema_version: result.schemaVersion,
        sha256: result.digest,
      }),
    );
    return;
  }
  if (command === "manifest") {
    const result = await validateProject({
      ...common,
      allowMissingTemporary: true,
    });
    const missing = new Set(result.missingTemporarySpecialists);
    for (const row of selectManifest(result.rows, options.mode)) {
      const unresolved = [...temporaryIdentities([row])]
        .filter((id) => missing.has(id))
        .sort();
      if (unresolved.length > 0) {
        console.log(
          JSON.stringify({
            type: "blocked",
            disposition: "Blocked",
            finding_id: row.id,
            lane: row.lane,
            blocker: `Exact temporary specialist contract is unavailable: ${unresolved.join(", ")}`,
          }),
        );
      } else {
        console.log(JSON.stringify(row));
      }
    }
    return;
  }
  if (command === "write") {
    const result = await replaceLedger({
      ...common,
      candidatePath: options.candidate,
      expectedDigest: options["expected-sha256"],
    });
    console.log(
      JSON.stringify({
        ledger: result.ledgerGitPath,
        rows: result.rows.length,
        sha256: result.digest,
        unknown_components: result.unknownComponents,
      }),
    );
    return;
  }
  if (command === "migrate") {
    const result = await migrateLedger({
      ...common,
      toVersion: options.to,
      expectedDigest: options["expected-sha256"],
    });
    console.log(
      JSON.stringify({
        ledger: result.ledgerGitPath,
        schema_version: result.schemaVersion,
        rows: result.rows.length,
        sha256: result.digest,
        unknown_components: result.unknownComponents,
      }),
    );
    return;
  }
  throw new Error(
    "command must be init, validate, preflight, manifest, write, or migrate",
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
