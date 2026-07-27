#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

const scriptPath = fileURLToPath(import.meta.url);
const schemaPath = resolve(
  dirname(scriptPath),
  "../references/finding-ledger.schema.json",
);
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
const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$defs",
  "$id",
  "$ref",
  "$schema",
  "additionalProperties",
  "allOf",
  "const",
  "description",
  "enum",
  "format",
  "if",
  "items",
  "minimum",
  "minItems",
  "minLength",
  "oneOf",
  "pattern",
  "properties",
  "required",
  "then",
  "title",
  "type",
  "uniqueItems",
]);
const IMMUTABLE_FINDING_FIELDS = [
  "id",
  "schema_version",
  "lane",
  "component",
  "candidate_first_seen",
  "first_seen",
];

class StrictJsonParser {
  constructor(source, label) {
    this.source = source;
    this.label = label;
    this.index = 0;
  }

  parse() {
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      this.fail("unexpected trailing content");
    }
    return value;
  }

  parseValue() {
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === '"') return this.parseString();
    if (character === "t") return this.parseLiteral("true", true);
    if (character === "f") return this.parseLiteral("false", false);
    if (character === "n") return this.parseLiteral("null", null);
    return this.parseNumber();
  }

  parseObject() {
    const result = Object.create(null);
    const keys = new Set();
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }

    while (this.index < this.source.length) {
      if (this.source[this.index] !== '"') {
        this.fail("object key must be a string");
      }
      const key = this.parseString();
      if (keys.has(key)) {
        this.fail(`duplicate object key ${JSON.stringify(key)}`);
      }
      keys.add(key);
      this.skipWhitespace();
      this.expect(":");
      result[key] = this.parseValue();
      this.skipWhitespace();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return result;
      }
      this.expect(",");
      this.skipWhitespace();
    }
    this.fail("unterminated object");
  }

  parseArray() {
    const result = [];
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }

    while (this.index < this.source.length) {
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return result;
      }
      this.expect(",");
    }
    this.fail("unterminated array");
  }

  parseString() {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (!escaped && character === '"') {
        this.index += 1;
        try {
          return JSON.parse(this.source.slice(start, this.index));
        } catch (error) {
          this.fail(`invalid string: ${error.message}`);
        }
      }
      if (!escaped && character === "\\") {
        escaped = true;
      } else {
        escaped = false;
      }
      this.index += 1;
    }
    this.fail("unterminated string");
  }

  parseLiteral(source, value) {
    if (!this.source.startsWith(source, this.index)) {
      this.fail(`invalid literal`);
    }
    this.index += source.length;
    return value;
  }

  parseNumber() {
    const match =
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
        this.source.slice(this.index),
      );
    if (!match) {
      this.fail("invalid value");
    }
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      this.fail("number must be finite");
    }
    return value;
  }

  expect(character) {
    if (this.source[this.index] !== character) {
      this.fail(`expected ${JSON.stringify(character)}`);
    }
    this.index += 1;
  }

  skipWhitespace() {
    while (/[ \t\r\n]/.test(this.source[this.index] ?? "")) {
      this.index += 1;
    }
  }

  fail(message) {
    throw new Error(`${this.label}: ${message} at byte ${this.index}`);
  }
}

export function parseJsonStrict(source, label = "JSON") {
  return new StrictJsonParser(source, label).parse();
}

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const observed = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(observed) !== JSON.stringify(wanted)) {
    throw new Error(
      `${label} fields are ${observed.join(", ")}; expected ${wanted.join(", ")}`,
    );
  }
}

function assertArrayEqual(observed, expected, label) {
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the version-1 contract`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function assertSupportedSchemaKeywords(contract, label, rootSchema = contract) {
  assertPlainObject(contract, label);
  for (const keyword of Object.keys(contract)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
      throw new Error(`${label} uses unsupported schema keyword ${keyword}`);
    }
  }
  for (const keyword of ["$id", "$ref", "$schema", "description", "title"]) {
    if (
      contract[keyword] !== undefined &&
      typeof contract[keyword] !== "string"
    ) {
      throw new Error(`${label}.${keyword} must be a string`);
    }
  }
  if (contract.$ref !== undefined) {
    resolveSchemaReference(rootSchema, contract.$ref, label);
  }
  if (
    contract.type !== undefined &&
    ![
      "array",
      "boolean",
      "integer",
      "null",
      "number",
      "object",
      "string",
    ].includes(contract.type)
  ) {
    throw new Error(`${label} uses unsupported schema type ${contract.type}`);
  }
  if (
    contract.format !== undefined &&
    contract.format !== "date-time"
  ) {
    throw new Error(`${label} uses unsupported schema format ${contract.format}`);
  }
  if (contract.pattern !== undefined) {
    if (typeof contract.pattern !== "string") {
      throw new Error(`${label}.pattern must be a string`);
    }
    try {
      new RegExp(contract.pattern, "u");
    } catch (error) {
      throw new Error(`${label} schema pattern is invalid: ${error.message}`);
    }
  }
  for (const keyword of ["minItems", "minLength"]) {
    if (
      contract[keyword] !== undefined &&
      (!Number.isInteger(contract[keyword]) || contract[keyword] < 0)
    ) {
      throw new Error(`${label}.${keyword} must be a non-negative integer`);
    }
  }
  if (
    contract.minimum !== undefined &&
    (typeof contract.minimum !== "number" ||
      !Number.isFinite(contract.minimum))
  ) {
    throw new Error(`${label}.minimum must be a finite number`);
  }
  if (
    contract.uniqueItems !== undefined &&
    typeof contract.uniqueItems !== "boolean"
  ) {
    throw new Error(`${label}.uniqueItems must be a boolean`);
  }
  if (
    contract.additionalProperties !== undefined &&
    typeof contract.additionalProperties !== "boolean"
  ) {
    throw new Error(`${label}.additionalProperties must be a boolean`);
  }
  if (contract.enum !== undefined && !Array.isArray(contract.enum)) {
    throw new Error(`${label}.enum must be an array`);
  }
  if (Array.isArray(contract.enum) && contract.enum.length === 0) {
    throw new Error(`${label}.enum must not be empty`);
  }
  if (contract.required !== undefined) {
    if (
      !Array.isArray(contract.required) ||
      contract.required.some((property) => typeof property !== "string") ||
      new Set(contract.required).size !== contract.required.length
    ) {
      throw new Error(`${label}.required must contain unique strings`);
    }
  }
  for (const collection of ["$defs", "properties"]) {
    if (contract[collection] !== undefined) {
      assertPlainObject(contract[collection], `${label}.${collection}`);
      for (const [name, child] of Object.entries(contract[collection])) {
        assertSupportedSchemaKeywords(
          child,
          `${label}.${collection}.${name}`,
          rootSchema,
        );
      }
    }
  }
  for (const collection of ["allOf", "oneOf"]) {
    if (contract[collection] !== undefined) {
      if (
        !Array.isArray(contract[collection]) ||
        contract[collection].length === 0
      ) {
        throw new Error(`${label}.${collection} must be a non-empty array`);
      }
      contract[collection].forEach((child, index) =>
        assertSupportedSchemaKeywords(
          child,
          `${label}.${collection}[${index}]`,
          rootSchema,
        ),
      );
    }
  }
  for (const child of ["if", "items", "then"]) {
    if (contract[child] !== undefined) {
      assertSupportedSchemaKeywords(
        contract[child],
        `${label}.${child}`,
        rootSchema,
      );
    }
  }
}

function resolveSchemaReference(rootSchema, reference, label) {
  if (!reference.startsWith("#/")) {
    throw new Error(`${label} uses unsupported schema reference ${reference}`);
  }
  let value = rootSchema;
  for (const encodedPart of reference.slice(2).split("/")) {
    const part = encodedPart.replaceAll("~1", "/").replaceAll("~0", "~");
    if (value === null || typeof value !== "object" || !(part in value)) {
      throw new Error(`${label} has unresolved schema reference ${reference}`);
    }
    value = value[part];
  }
  return value;
}

function schemaTypeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function assertSchemaValue(value, contract, rootSchema, label) {
  assertPlainObject(contract, `${label} schema`);
  if (contract.$ref !== undefined) {
    assertSchemaValue(
      value,
      resolveSchemaReference(rootSchema, contract.$ref, label),
      rootSchema,
      label,
    );
  }
  if (contract.oneOf !== undefined) {
    if (!Array.isArray(contract.oneOf) || contract.oneOf.length === 0) {
      throw new Error(`${label} schema oneOf must not be empty`);
    }
    const matches = contract.oneOf.filter((option) => {
      try {
        assertSchemaValue(value, option, rootSchema, label);
        return true;
      } catch {
        return false;
      }
    }).length;
    if (matches !== 1) {
      throw new Error(`${label} must match exactly one schema alternative`);
    }
  }
  if (contract.const !== undefined && !valuesEqual(value, contract.const)) {
    throw new Error(`${label} must equal ${JSON.stringify(contract.const)}`);
  }
  if (
    contract.enum !== undefined &&
    !contract.enum.some((member) => valuesEqual(value, member))
  ) {
    throw new Error(`${label} is not in the schema enum`);
  }
  if (contract.type !== undefined && !schemaTypeMatches(value, contract.type)) {
    const article = contract.type === "integer" ? "an" : "a";
    throw new Error(`${label} must be ${article} ${contract.type}`);
  }
  if (
    typeof value === "string" &&
    contract.minLength !== undefined &&
    [...value].length < contract.minLength
  ) {
    throw new Error(`${label} is shorter than schema minLength`);
  }
  if (typeof value === "string" && contract.pattern !== undefined) {
    let pattern;
    try {
      pattern = new RegExp(contract.pattern, "u");
    } catch (error) {
      throw new Error(`${label} schema pattern is invalid: ${error.message}`);
    }
    if (!pattern.test(value)) {
      throw new Error(`${label} does not match the schema pattern`);
    }
  }
  if (
    typeof value === "number" &&
    contract.minimum !== undefined &&
    value < contract.minimum
  ) {
    throw new Error(`${label} is below the schema minimum`);
  }
  if (contract.format !== undefined) {
    assertTimestamp(value, label);
  }
  if (Array.isArray(value)) {
    if (contract.minItems !== undefined && value.length < contract.minItems) {
      throw new Error(`${label} has fewer than the schema minItems`);
    }
    if (contract.uniqueItems === true) {
      const serialized = value.map((item) => canonicalJson(item));
      if (new Set(serialized).size !== value.length) {
        throw new Error(`${label} must contain unique items`);
      }
    }
    if (contract.items !== undefined) {
      value.forEach((item, index) =>
        assertSchemaValue(
          item,
          contract.items,
          rootSchema,
          `${label}[${index}]`,
        ),
      );
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (contract.required !== undefined) {
      for (const property of contract.required) {
        if (!(property in value)) {
          throw new Error(`${label} is missing required property ${property}`);
        }
      }
    }
    if (contract.properties !== undefined) {
      for (const [property, propertyContract] of Object.entries(
        contract.properties,
      )) {
        if (property in value) {
          assertSchemaValue(
            value[property],
            propertyContract,
            rootSchema,
            `${label}.${property}`,
          );
        }
      }
    }
    if (contract.additionalProperties === false) {
      const known = new Set(Object.keys(contract.properties ?? {}));
      const unexpected = Object.keys(value).find(
        (property) => !known.has(property),
      );
      if (unexpected !== undefined) {
        throw new Error(`${label} has additional property ${unexpected}`);
      }
    }
  }
  if (contract.allOf !== undefined) {
    if (!Array.isArray(contract.allOf)) {
      throw new Error(`${label} schema allOf must be an array`);
    }
    contract.allOf.forEach((member) =>
      assertSchemaValue(value, member, rootSchema, label),
    );
  }
  if (contract.if !== undefined) {
    let conditionMatches = true;
    try {
      assertSchemaValue(value, contract.if, rootSchema, label);
    } catch {
      conditionMatches = false;
    }
    if (conditionMatches && contract.then !== undefined) {
      assertSchemaValue(value, contract.then, rootSchema, label);
    }
  }
}

export function validateSchemaContract(schema) {
  assertPlainObject(schema, "finding ledger schema");
  assertSupportedSchemaKeywords(schema, "finding ledger schema");
  if (
    schema.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    schema.type !== "object" ||
    schema.additionalProperties !== false
  ) {
    throw new Error("finding ledger schema header is invalid");
  }
  assertArrayEqual(schema.required, REQUIRED_FIELDS, "schema required fields");
  if (schema.properties?.schema_version?.const !== 1) {
    throw new Error("schema_version must be const 1");
  }
  let idPattern;
  try {
    idPattern = new RegExp(schema.properties.id.pattern);
  } catch (error) {
    throw new Error(`schema id pattern is invalid: ${error.message}`);
  }
  for (const property of [
    "lane",
    "severity",
    "priority",
    "status",
  ]) {
    if (!Array.isArray(schema.properties?.[property]?.enum)) {
      throw new Error(`schema ${property} enum is missing`);
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
  return { idPattern };
}

async function loadSchema() {
  const source = await readFile(schemaPath, "utf8");
  const schema = parseJsonStrict(source, "finding-ledger.schema.json");
  return { schema, ...validateSchemaContract(schema) };
}

function assertEnum(schema, property, value, label) {
  if (!schema.properties[property].enum.includes(value)) {
    throw new Error(`${label} has unsupported ${property}: ${value}`);
  }
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

function assertSafeStrings(value, label) {
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
  const { idPattern } = validateSchemaContract(schema);
  if (!Array.isArray(rows)) {
    throw new Error("finding rows must be an array");
  }
  const ids = new Set();
  const unknownComponents = new Set();

  rows.forEach((row, index) => {
    const label = `finding row ${index + 1}`;
    assertSchemaValue(row, schema, schema, label);
    assertExactKeys(row, REQUIRED_FIELDS, label);
    if (row.schema_version !== 1) {
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
    for (const property of ["lane", "severity", "priority", "status"]) {
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
      assertEnum(schema, "lane", report.lane, reportLabel);
      assertSafeString(report.pointer, `${reportLabel}.pointer`);
      assertSafeString(report.candidate, `${reportLabel}.candidate`);
      if (reportPointers.has(report.pointer)) {
        throw new Error(`${label} has a duplicate report pointer`);
      }
      reportPointers.add(report.pointer);
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

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
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
  return {
    components,
    contextPath: resolvedContext,
    ledgerGitPath,
    ledgerPath,
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

export async function validateProject({
  repository = ".",
  context = "qa-context.md",
}) {
  const repositoryRoot = await realpath(resolve(repository));
  const contextContract = await loadContext(repositoryRoot, context);
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
  const { schema } = await loadSchema();
  const rows = parseJsonl(source, contextContract.ledgerGitPath);
  const unknownComponents = validateFindingRows(
    rows,
    schema,
    contextContract,
  );
  return {
    ...contextContract,
    digest: sha256(source),
    repositoryRoot,
    rows,
    schema,
    unknownComponents,
  };
}

export async function initializeLedger({
  repository = ".",
  context = "qa-context.md",
}) {
  const repositoryRoot = await realpath(resolve(repository));
  const contextContract = await loadContext(repositoryRoot, context);
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

function assertLedgerTransition(currentRows, candidateRows) {
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
        schema_version: 1,
        rows: result.rows.length,
        sha256: result.digest,
        unknown_components: result.unknownComponents,
      }),
    );
    return;
  }
  if (command === "manifest") {
    const result = await validateProject(common);
    for (const row of selectManifest(result.rows, options.mode)) {
      console.log(JSON.stringify(row));
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
  throw new Error("command must be init, validate, manifest, or write");
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
