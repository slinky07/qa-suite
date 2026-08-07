import { createHash } from "node:crypto";

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
      this.fail("invalid literal");
    }
    this.index += source.length;
    return value;
  }

  parseNumber() {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.source.slice(this.index),
    );
    if (!match) this.fail("invalid value");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail("number must be finite");
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
  if (typeof source !== "string") {
    throw new Error(`${label} source must be a string`);
  }
  return new StrictJsonParser(source, label).parse();
}

export function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

export function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const observed = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(observed) !== JSON.stringify(wanted)) {
    throw new Error(
      `${label} fields are ${observed.join(", ")}; expected ${wanted.join(", ")}`,
    );
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("canonical JSON cannot contain undefined or unsupported values");
  }
  return serialized;
}

export function canonicalJsonDocument(value) {
  return `${canonicalJson(value)}\n`;
}

export function valuesEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
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

export function validateSchemaDefinition(contract, label, rootSchema = contract) {
  assertPlainObject(contract, label);
  for (const keyword of Object.keys(contract)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
      throw new Error(`${label} uses unsupported schema keyword ${keyword}`);
    }
  }
  for (const keyword of ["$id", "$ref", "$schema", "description", "title"]) {
    if (contract[keyword] !== undefined && typeof contract[keyword] !== "string") {
      throw new Error(`${label}.${keyword} must be a string`);
    }
  }
  if (contract.$ref !== undefined) {
    resolveSchemaReference(rootSchema, contract.$ref, label);
  }
  if (
    contract.type !== undefined &&
    !["array", "boolean", "integer", "null", "number", "object", "string"].includes(
      contract.type,
    )
  ) {
    throw new Error(`${label} uses unsupported schema type ${contract.type}`);
  }
  if (contract.format !== undefined && contract.format !== "date-time") {
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
    (typeof contract.minimum !== "number" || !Number.isFinite(contract.minimum))
  ) {
    throw new Error(`${label}.minimum must be a finite number`);
  }
  for (const keyword of ["uniqueItems", "additionalProperties"]) {
    if (contract[keyword] !== undefined && typeof contract[keyword] !== "boolean") {
      throw new Error(`${label}.${keyword} must be a boolean`);
    }
  }
  if (contract.enum !== undefined && !Array.isArray(contract.enum)) {
    throw new Error(`${label}.enum must be an array`);
  }
  if (Array.isArray(contract.enum) && contract.enum.length === 0) {
    throw new Error(`${label}.enum must not be empty`);
  }
  if (
    contract.required !== undefined &&
    (!Array.isArray(contract.required) ||
      contract.required.some((property) => typeof property !== "string") ||
      new Set(contract.required).size !== contract.required.length)
  ) {
    throw new Error(`${label}.required must contain unique strings`);
  }
  for (const collection of ["$defs", "properties"]) {
    if (contract[collection] === undefined) continue;
    assertPlainObject(contract[collection], `${label}.${collection}`);
    for (const [name, child] of Object.entries(contract[collection])) {
      validateSchemaDefinition(child, `${label}.${collection}.${name}`, rootSchema);
    }
  }
  for (const collection of ["allOf", "oneOf"]) {
    if (contract[collection] === undefined) continue;
    if (!Array.isArray(contract[collection]) || contract[collection].length === 0) {
      throw new Error(`${label}.${collection} must be a non-empty array`);
    }
    contract[collection].forEach((child, index) =>
      validateSchemaDefinition(child, `${label}.${collection}[${index}]`, rootSchema),
    );
  }
  for (const child of ["if", "items", "then"]) {
    if (contract[child] !== undefined) {
      validateSchemaDefinition(contract[child], `${label}.${child}`, rootSchema);
    }
  }
  return contract;
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

function assertUtcTimestamp(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a UTC date-time ending in Z`);
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(
      value,
    );
  if (!match) throw new Error(`${label} must be a UTC date-time ending in Z`);
  const [, year, month, day, hour, minute, second] = match;
  const values = [year, month, day, hour, minute, second].map(Number);
  const [yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] = values;
  const leapYear =
    yearValue % 4 === 0 && (yearValue % 100 !== 0 || yearValue % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
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
}

export function assertSchemaValue(value, contract, rootSchema, label) {
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
    const pattern = new RegExp(contract.pattern, "u");
    if (!pattern.test(value)) throw new Error(`${label} does not match the schema pattern`);
  }
  if (
    typeof value === "number" &&
    contract.minimum !== undefined &&
    value < contract.minimum
  ) {
    throw new Error(`${label} is below the schema minimum`);
  }
  if (contract.format !== undefined) assertUtcTimestamp(value, label);
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
        assertSchemaValue(item, contract.items, rootSchema, `${label}[${index}]`),
      );
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const property of contract.required ?? []) {
      if (!(property in value)) {
        throw new Error(`${label} is missing required property ${property}`);
      }
    }
    for (const [property, propertyContract] of Object.entries(
      contract.properties ?? {},
    )) {
      if (property in value) {
        assertSchemaValue(value[property], propertyContract, rootSchema, `${label}.${property}`);
      }
    }
    if (contract.additionalProperties === false) {
      const known = new Set(Object.keys(contract.properties ?? {}));
      const unexpected = Object.keys(value).find((property) => !known.has(property));
      if (unexpected !== undefined) {
        throw new Error(`${label} has additional property ${unexpected}`);
      }
    }
  }
  for (const member of contract.allOf ?? []) {
    assertSchemaValue(value, member, rootSchema, label);
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
  return value;
}

export function validateJsonDocument(value, schema, label) {
  validateSchemaDefinition(schema, `${label} schema`);
  assertSchemaValue(value, schema, schema, label);
  return value;
}
