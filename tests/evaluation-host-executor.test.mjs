import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  after,
  test,
} from "node:test";
import {
  canonicalJson,
  sha256,
} from "../scripts/evaluation/contracts.mjs";
import {
  executePreparedBobHostProgram,
  validateBobHostExecution,
} from "../scripts/evaluation/bob-host-executor.mjs";

const RUN_ID = "run_0123456789abcdef0123456789abcdef";
const CASE_ID = "fx_0123456789abcdef0123456789abcdef";
const reportIdentifiers = {
  core_flow_ids: ["flow_00112233445566778899aabbccddeeff_01"],
  surface_id: "surface_00112233445566778899aabbccddeeff",
};
const programParent = await realpath(
  await mkdtemp(join(tmpdir(), "qa-suite-host-program-")),
);
const testExecutable = join(programParent, "node-wrapper");
const nodeExecutable = (await realpath(process.execPath)).replaceAll(
  "'",
  "'\\''",
);
await writeFile(
  testExecutable,
  `#!/bin/sh\nexec '${nodeExecutable}' "$@"\n`,
  { mode: 0o555 },
);
await chmod(testExecutable, 0o555);
const testExecutableSha256 = sha256(await readFile(testExecutable));

after(async () => {
  await chmod(testExecutable, 0o700).catch(() => {});
  await rm(programParent, { force: true, recursive: true });
});

function preparation() {
  return {
    case_id: CASE_ID,
    controller_commit: "a".repeat(40),
    lane: "bob-qa",
    qualification: "not-evidence",
    result: null,
    run_id: RUN_ID,
    schema_version: 1,
    subject_commit: "b".repeat(40),
    suite_id: "bob-evaluation-v1",
    verification_status: "unverified",
  };
}

function suite() {
  const otherCaseId = "fx_fedcba9876543210fedcba9876543210";
  return {
    cases: [
      {
        fixture_manifest:
          `tests/evaluation/fixtures/${CASE_ID}/fixture-manifest.json`,
        id: CASE_ID,
        oracle_commitments: [
          `seal_${"1".repeat(64)}`,
          `seal_${"2".repeat(64)}`,
        ],
        qa_context: `tests/evaluation/fixtures/${CASE_ID}/qa-context.md`,
        report_identifiers: reportIdentifiers,
        smoke_checks: ["check_primary"],
      },
      {
        fixture_manifest:
          `tests/evaluation/fixtures/${otherCaseId}/fixture-manifest.json`,
        id: otherCaseId,
        oracle_commitments: [
          `seal_${"3".repeat(64)}`,
          `seal_${"4".repeat(64)}`,
        ],
        qa_context:
          `tests/evaluation/fixtures/${otherCaseId}/qa-context.md`,
        report_identifiers: {
          core_flow_ids: [
            "flow_ffeeddccbbaa99887766554433221100_01",
          ],
          surface_id: "surface_ffeeddccbbaa99887766554433221100",
        },
        smoke_checks: ["check_primary"],
      },
    ],
    id: "bob-evaluation-v1",
    lane: "bob-qa",
    schema_version: 1,
  };
}

const successfulAdapter = String.raw`
import { createHash } from "node:crypto";

const sorted = (value) => {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sorted(value[key])]),
    );
  }
  return value;
};
const canonical = (value) => JSON.stringify(sorted(value), null, 2) + "\n";
const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
let source = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) source += chunk;
const request = JSON.parse(source);
if (
  process.env.LANG !== "C" ||
  process.env.LC_ALL !== "C" ||
  process.env.TZ !== "UTC" ||
  ["HOME", "PATH", "NODE_OPTIONS", "NODE_PATH"].some(
    (key) => key in process.env,
  ) ||
  !process.cwd().endsWith("/" + request.binding.run_id)
) {
  process.exit(9);
}
let output;
if (request.phase === "interface_inventory") {
  output = {
    surfaces: [{
      control_ids: ["control_search", "control_submit"],
      id: "surface_primary",
    }],
  };
} else if (request.phase === "expected_use_model") {
  output = {
    tasks: [{
      control_ids: ["control_search", "control_submit"],
      id: "task_find_item",
      parent_task_id: null,
      surface_id: "surface_primary",
    }],
  };
} else {
  const flowEvidence = [{
    kind: "report-reference",
    path: "QA/2026-07-28-0415-bob-qa-primary-surface.md",
  }];
  output = {
    report_output: {
      lane_result: {
        blocking_evidence: [],
        checklist: [],
        findings: [],
        flows: [{
          core: true,
          effectiveness: true,
          evidence: flowEvidence,
          finding_ids: [],
          id: request.report_identifiers.core_flow_ids[0],
          state: "Pass",
        }],
        not_tested: [],
        observations: [],
        verdict: {
          blocker: null,
          severity_counts: { S1: 0, S2: 0, S3: 0, S4: 0 },
          state: "Go",
        },
      },
      report: {
        path: "QA/2026-07-28-0415-bob-qa-primary-surface.md",
        sha256: "a".repeat(64),
      },
    },
    results: [{
      control_ids: ["control_search", "control_submit"],
      disposition: "exercised",
      evidence_sha256: digest(canonical(flowEvidence)),
      flow_id: request.report_identifiers.core_flow_ids[0],
      task_id: "task_find_item",
    }],
  };
}
process.stdout.write(canonical({
  output,
  phase: request.phase,
  request_sha256: digest(source),
  schema_version: 1,
}));
`;

function adapterSource(responseStatement) {
  return String.raw`
import { createHash } from "node:crypto";
let source = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) source += chunk;
const request = JSON.parse(source);
const requestDigest =
  createHash("sha256").update(source).digest("hex");
${responseStatement}
`;
}

async function harness(t) {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), "qa-suite-host-executor-")),
  );
  const laneRoot = join(parent, RUN_ID);
  await mkdir(laneRoot, { mode: 0o700 });
  await chmod(laneRoot, 0o555);
  t.after(async () => {
    await chmod(laneRoot, 0o700).catch(() => {});
    await rm(parent, { force: true, recursive: true });
  });
  return {
    executable: testExecutable,
    executableSha256: testExecutableSha256,
    laneRoot,
    program(source = successfulAdapter) {
      return {
        arguments: ["--input-type=module", "--eval", source],
        executable: testExecutable,
        executable_sha256: testExecutableSha256,
      };
    },
  };
}

async function execute(harnessValue, overrides = {}) {
  return executePreparedBobHostProgram({
    laneRoot: harnessValue.laneRoot,
    preparation: preparation(),
    program: harnessValue.program(),
    suite: suite(),
    ...overrides,
  });
}

test("runs each Bob phase in a fresh, policy-locked direct child", async (t) => {
  const setup = await harness(t);

  const execution = await execute(setup);

  assert.equal(validateBobHostExecution(execution), execution);
  assert.equal(execution.execution_observation, "three-direct-processes-completed");
  assert.equal(execution.verification_status, "unverified");
  assert.equal(execution.qualification, "not-evidence");
  assert.equal(execution.result, null);
  assert.deepEqual(
    execution.process_receipts.map(({ phase }) => phase),
    [
      "interface_inventory",
      "expected_use_model",
      "task_execution",
    ],
  );
  for (const claim of Object.values(execution.transcript.claims)) {
    assert.equal(claim, "not-attested");
  }
});

test("rejects executable and lane-root drift before dispatch", async (t) => {
  const setup = await harness(t);

  await assert.rejects(
    () =>
      execute(setup, {
        program: {
          ...setup.program(),
          executable_sha256: "0".repeat(64),
        },
      }),
    /does not match the executable/u,
  );

  const symbolicExecutable = join(
    await realpath(join(setup.laneRoot, "..")),
    "node-link",
  );
  await symlink(setup.executable, symbolicExecutable);
  await assert.rejects(
    () =>
      execute(setup, {
        program: {
          ...setup.program(),
          executable: symbolicExecutable,
        },
      }),
    /must not use a symbolic path/u,
  );

  await chmod(setup.laneRoot, 0o755);
  await assert.rejects(
    () => execute(setup),
    /sealed root/u,
  );
});

test("rejects malformed, cross-request, and non-canonical responses", async (t) => {
  const setup = await harness(t);
  const invalidPrograms = [
    adapterSource(
      'process.stdout.write(\'{"output":{},"output":{},"phase":"interface_inventory","request_sha256":"\' + requestDigest + \'","schema_version":1}\\n\');',
    ),
    adapterSource(
      `process.stdout.write(JSON.stringify({
        output: {},
        phase: request.phase,
        request_sha256: "0".repeat(64),
        schema_version: 1,
      }));`,
    ),
    adapterSource(
      `process.stdout.write(JSON.stringify({
        schema_version: 1,
        request_sha256: requestDigest,
        phase: request.phase,
        output: {},
      }, null, 4) + "\\n");`,
    ),
  ];

  for (const source of invalidPrograms) {
    await assert.rejects(
      () => execute(setup, { program: setup.program(source) }),
    );
  }
});

test("fails closed on timeout, nonzero exit, and bounded output", async (t) => {
  const setup = await harness(t);
  const inheritedPipeSource = adapterSource(`
const { spawn } = await import("node:child_process");
spawn(
  process.execPath,
  ["--eval", "setTimeout(() => {}, 750)"],
  { stdio: ["ignore", "inherit", "inherit"] },
);
setTimeout(() => {}, 10_000);
`);
  const startedAt = Date.now();
  await assert.rejects(
    () =>
      execute(setup, {
        limits: { timeout_ms: 200 },
        program: setup.program(inheritedPipeSource),
      }),
    /controller deadline/u,
  );
  assert.ok(Date.now() - startedAt < 700);

  const failures = [
    {
      source: adapterSource("process.exit(7);"),
    },
    {
      limits: { output_bytes: 4096 },
      source: adapterSource('process.stdout.write("x".repeat(16 * 1024));'),
    },
  ];

  for (const failure of failures) {
    await assert.rejects(
      () =>
        execute(setup, {
          limits: failure.limits,
          program: setup.program(failure.source),
        }),
      /did not complete successfully/u,
    );
  }
});

test("scans complete stdout and stderr without reproducing confidential data", async (t) => {
  const setup = await harness(t);
  const confidentialValue = `seal_${"c".repeat(64)}`;
  const source = adapterSource(`
process.stderr.write("seal_");
setImmediate(() => {
  process.stderr.write("c".repeat(64));
  process.stdout.write("{}\\n");
});
`);

  await assert.rejects(
    () =>
      execute(setup, {
        confidentialValues: [confidentialValue],
        program: setup.program(source),
      }),
    (error) => {
      assert.match(error.message, /controller-confidential data/u);
      assert.doesNotMatch(error.message, new RegExp(confidentialValue, "u"));
      return true;
    },
  );
  await assert.rejects(
    () =>
      execute(setup, {
        confidentialValues: ['seal_"escaped"'],
      }),
    /opaque evaluation token/u,
  );
});

test("execution validation rejects promoted claims and receipt tampering", async (t) => {
  const setup = await harness(t);
  const execution = await execute(setup);
  const promoted = structuredClone(execution);
  promoted.transcript.claims.method_order = "verified";
  assert.throws(
    () => validateBobHostExecution(promoted),
    /was promoted/u,
  );

  const tampered = structuredClone(execution);
  tampered.process_receipts[0].output_sha256 = "0".repeat(64);
  assert.throws(
    () => validateBobHostExecution(tampered),
    /not bound to the transcript/u,
  );

  const requestTampered = structuredClone(execution);
  requestTampered.process_receipts[0].request_sha256 = "0".repeat(64);
  const unsigned = structuredClone(requestTampered);
  delete unsigned.execution_sha256;
  requestTampered.execution_sha256 = sha256(canonicalJson(unsigned));
  assert.throws(
    () => validateBobHostExecution(requestTampered),
    /not bound to the transcript/u,
  );

  const responseTampered = structuredClone(execution);
  responseTampered.process_receipts[0].response_bytes += 1;
  responseTampered.process_receipts[0].response_sha256 = "0".repeat(64);
  const responseUnsigned = structuredClone(responseTampered);
  delete responseUnsigned.execution_sha256;
  responseTampered.execution_sha256 = sha256(canonicalJson(responseUnsigned));
  assert.throws(
    () => validateBobHostExecution(responseTampered),
    /not bound to the transcript/u,
  );

  const sparse = structuredClone(execution);
  delete sparse.process_receipts[1];
  assert.throws(
    () => validateBobHostExecution(sparse),
    /dense array/u,
  );
  const named = structuredClone(execution);
  named.process_receipts.note = "not a receipt";
  assert.throws(
    () => validateBobHostExecution(named),
    /named properties/u,
  );

  const rehashed = structuredClone(execution);
  rehashed.policy_sha256 = "0".repeat(64);
  assert.throws(
    () => validateBobHostExecution(rehashed),
    /execution_sha256 does not match/u,
  );
});

test("successful execution leaves the sealed lane-root identity unchanged", async (t) => {
  const setup = await harness(t);
  const before = await lstat(setup.laneRoot);

  await execute(setup);

  const after = await lstat(setup.laneRoot);
  assert.equal(after.ino, before.ino);
  assert.equal(after.dev, before.dev);
  assert.equal(after.mode & 0o777, 0o555);
});
