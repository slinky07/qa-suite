#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { canonicalJson } from "./contracts.mjs";
import { closeCaseRun, prepareCaseRun } from "./runner.mjs";

const PREPARE_OPTIONS = new Map([
  ["--case", "caseId"],
  ["--controller-ref", "controllerRef"],
  ["--lane-parent", "laneParent"],
  ["--repository", "repositoryPath"],
  ["--state-parent", "stateParent"],
  ["--subject-ref", "subjectRef"],
  ["--suite", "suitePath"],
  ["--writable-root", "writableRoots"],
]);
const SEALED_CONTROLLER_VALUE = /seal_[0-9a-f]{64}/gu;

export function redactControllerSecrets(value) {
  return String(value).replace(
    SEALED_CONTROLLER_VALUE,
    "<redacted-controller-value>",
  );
}

function usage() {
  return [
    "Usage:",
    "  node scripts/evaluation/run-case.mjs prepare \\",
    "    --repository <path> --controller-ref <ref> --subject-ref <ref> \\",
    "    --suite <path> --case <case-id> \\",
    "    --state-parent <path> --lane-parent <path> \\",
    "    --writable-root <relative-report-path>",
    "  node scripts/evaluation/run-case.mjs close --state <absolute-state-path>",
  ].join("\n");
}

function requireValue(arguments_, index, option) {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parsePrepare(arguments_) {
  const values = { writableRoots: [] };
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const field = PREPARE_OPTIONS.get(option);
    if (!field) {
      throw new Error(`unknown prepare option ${String(option)}`);
    }
    const value = requireValue(arguments_, index, option);
    if (field === "writableRoots") {
      if (values.writableRoots.length > 0) {
        throw new Error("--writable-root may be provided only once");
      }
      values.writableRoots.push(value);
      continue;
    }
    if (values[field] !== undefined) {
      throw new Error(`${option} may be provided only once`);
    }
    values[field] = value;
  }
  const missing = [...PREPARE_OPTIONS.entries()]
    .filter(([, field]) =>
      field === "writableRoots"
        ? values.writableRoots.length === 0
        : values[field] === undefined,
    )
    .map(([option]) => option);
  if (missing.length > 0) {
    throw new Error(`missing required option(s): ${missing.join(", ")}`);
  }
  return { command: "prepare", values };
}

function parseClose(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== "--state") {
    throw new Error("close requires exactly --state <absolute-state-path>");
  }
  return {
    command: "close",
    values: {
      statePath: requireValue(arguments_, 0, "--state"),
    },
  };
}

export function parseArguments(arguments_) {
  if (!Array.isArray(arguments_) || arguments_.length === 0) {
    throw new Error("a command is required");
  }
  const [command, ...options] = arguments_;
  if (command === "prepare") return parsePrepare(options);
  if (command === "close") return parseClose(options);
  throw new Error(`unknown command ${String(command)}`);
}

export async function main(arguments_ = process.argv.slice(2)) {
  const parsed = parseArguments(arguments_);
  const result =
    parsed.command === "prepare"
      ? await prepareCaseRun(parsed.values)
      : await closeCaseRun(parsed.values);
  process.stdout.write(canonicalJson(result));
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `${redactControllerSecrets(error.message)}\n\n${usage()}\n`,
    );
    process.exitCode = 1;
  });
}
