import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  executeCodexBobLiveSession,
} from "../scripts/evaluation/codex-bob-live-controller.mjs";
import {
  createPreparedBobHostBinding,
} from "../scripts/evaluation/bob-host-protocol.mjs";
import {
  canonicalJson,
  sha256,
} from "../scripts/evaluation/contracts.mjs";

const RUN_ID = "run_0123456789abcdef0123456789abcdef";
const CASE_ID = "fx_0123456789abcdef0123456789abcdef";
const OTHER_CASE_ID = "fx_fedcba9876543210fedcba9876543210";
const DISPATCH_ID = "dispatch_0123456789abcdef0123456789abcdef";
const PHASE_TARGET_PATH = fileURLToPath(
  new URL("../scripts/evaluation/codex-bob-phase-target.mjs", import.meta.url),
);
const GATEWAY_PATH = fileURLToPath(
  new URL("../scripts/evaluation/browser-gateway.mjs", import.meta.url),
);
const FINDING_LEDGER_PATH = fileURLToPath(
  new URL("../qa-suite/scripts/finding-ledger.mjs", import.meta.url),
);
const SCHEMA_PATHS = Object.freeze({
  expected_use_model: fileURLToPath(
    new URL(
      "../scripts/evaluation/schemas/" +
        "codex-bob-expected-use-model-v1.schema.json",
      import.meta.url,
    ),
  ),
  interface_inventory: fileURLToPath(
    new URL(
      "../scripts/evaluation/schemas/" +
        "codex-bob-interface-inventory-v1.schema.json",
      import.meta.url,
    ),
  ),
  task_execution: fileURLToPath(
    new URL(
      "../scripts/evaluation/schemas/" +
        "codex-bob-task-execution-draft-v1.schema.json",
      import.meta.url,
    ),
  ),
});
const STATIC_SUPPORT_PATHS = Object.freeze([
  FINDING_LEDGER_PATH,
  fileURLToPath(
    new URL("../scripts/evaluation/bob-host-protocol.mjs", import.meta.url),
  ),
  GATEWAY_PATH,
  fileURLToPath(
    new URL("../scripts/evaluation/codex-0145-events.mjs", import.meta.url),
  ),
  fileURLToPath(
    new URL(
      "../scripts/evaluation/codex-bob-phase-adapter.mjs",
      import.meta.url,
    ),
  ),
  fileURLToPath(
    new URL("../scripts/evaluation/codex-host-policy.mjs", import.meta.url),
  ),
  fileURLToPath(
    new URL("../scripts/evaluation/contracts.mjs", import.meta.url),
  ),
  PHASE_TARGET_PATH,
  ...Object.values(SCHEMA_PATHS),
]);

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
        report_identifiers: {
          core_flow_ids: [
            "flow_00112233445566778899aabbccddeeff_01",
          ],
          surface_id: "surface_00112233445566778899aabbccddeeff",
        },
        smoke_checks: ["check_primary"],
      },
      {
        fixture_manifest:
          `tests/evaluation/fixtures/${OTHER_CASE_ID}/fixture-manifest.json`,
        id: OTHER_CASE_ID,
        oracle_commitments: [
          `seal_${"3".repeat(64)}`,
          `seal_${"4".repeat(64)}`,
        ],
        qa_context:
          `tests/evaluation/fixtures/${OTHER_CASE_ID}/qa-context.md`,
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

async function identity(path, version) {
  return {
    path,
    sha256: sha256(await readFile(path)),
    ...(version ? { version } : {}),
  };
}

async function harness(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "qa-suite-live-controller-")),
  );
  const laneRoot = join(root, "lanes", RUN_ID);
  const stateParent = join(root, "state");
  await Promise.all([
    mkdir(join(laneRoot, "QA"), { recursive: true, mode: 0o700 }),
    mkdir(stateParent, { mode: 0o700 }),
  ]);
  await chmod(stateParent, 0o700);
  t.after(async () => {
    await chmod(laneRoot, 0o700).catch(() => {});
    await rm(root, { force: true, recursive: true });
  });
  const fixtureServer = join(laneRoot, "server.mjs");
  const fixtureAsset = join(laneRoot, "index.html");
  const promptInput = join(laneRoot, "bob-instructions.md");
  await Promise.all([
    writeFile(fixtureServer, "/* fixture server */\n", { mode: 0o444 }),
    writeFile(fixtureAsset, "<main>fixture</main>\n", { mode: 0o444 }),
    writeFile(promptInput, "# Bob QA\n", { mode: 0o444 }),
  ]);
  const nodePath = await realpath(process.execPath);
  const selectedSuite = suite();
  const selectedPreparation = preparation();
  const binding = createPreparedBobHostBinding({
    dispatchId: DISPATCH_ID,
    preparation: selectedPreparation,
    suite: selectedSuite,
  });
  const nodeIdentity = await identity(nodePath);
  const gatewayIdentity = await identity(GATEWAY_PATH);
  const config = {
    allowed_paths: ["/", "/index.html"],
    expected_bob_binding: binding,
    fixture_assets: [await identity(fixtureAsset)],
    identities: {
      chrome: nodeIdentity,
      codex: await identity(nodePath, "codex-cli 0.145.0"),
      fixture_server: await identity(fixtureServer),
      gateway: gatewayIdentity,
      node: nodeIdentity,
    },
    lane_root: laneRoot,
    model: "gpt-5.4",
    output_schemas: Object.fromEntries(
      await Promise.all(
        Object.entries(SCHEMA_PATHS).map(async ([phase, path]) => [
          phase,
          await identity(path),
        ]),
      ),
    ),
    prompt_inputs: [await identity(promptInput)],
    reasoning_effort: "xhigh",
    report_path: "QA/2026-07-28-2300-bob-qa-live.md",
    target_path: "/",
  };
  const supportPaths = [
    ...STATIC_SUPPORT_PATHS,
    fixtureAsset,
    fixtureServer,
    promptInput,
  ];
  const supportFiles = await Promise.all(
    [...new Set(supportPaths)].map((path) => identity(path)),
  );
  const program = {
    arguments: [PHASE_TARGET_PATH, canonicalJson(config)],
    executable: nodePath,
    executable_sha256: nodeIdentity.sha256,
    support_files: supportFiles,
  };
  const confidentialValues = [
    ...selectedSuite.cases.flatMap(
      ({ oracle_commitments: commitments }) => commitments,
    ),
    OTHER_CASE_ID,
  ].sort();
  return {
    config,
    fixtureAsset,
    input: {
      confidentialValues,
      controllerStateParent: stateParent,
      dispatchId: DISPATCH_ID,
      laneRoot,
      preparation: selectedPreparation,
      program,
      suite: selectedSuite,
    },
    laneRoot,
    nodeIdentity,
    program,
    root,
    stateParent,
  };
}

function replaceConfig(input, config) {
  input.program.arguments[1] = canonicalJson(config);
}

test("rejects omitted or substituted confidential controller values", async (t) => {
  const setup = await harness(t);
  const omitted = structuredClone(setup.input);
  delete omitted.confidentialValues;
  await assert.rejects(
    executeCodexBobLiveSession(omitted),
    /exact derived set/u,
  );

  const substituted = structuredClone(setup.input);
  substituted.confidentialValues[0] = `seal_${"f".repeat(64)}`;
  await assert.rejects(
    executeCodexBobLiveSession(substituted),
    /sorted oracle commitments and non-selected case IDs/u,
  );
});

test("rejects a substituted Node executable or phase-target source", async (t) => {
  const setup = await harness(t);
  const fakeExecutable = join(setup.root, "fake-node");
  await writeFile(fakeExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o555 });
  await chmod(fakeExecutable, 0o555);
  const fakeIdentity = await identity(fakeExecutable);

  const nodeSubstitution = structuredClone(setup.input);
  const nodeConfig = structuredClone(setup.config);
  nodeConfig.identities.node = fakeIdentity;
  nodeSubstitution.program.executable = fakeExecutable;
  nodeSubstitution.program.executable_sha256 = fakeIdentity.sha256;
  replaceConfig(nodeSubstitution, nodeConfig);
  await assert.rejects(
    executeCodexBobLiveSession(nodeSubstitution),
    /exact measured Node phase-target source/u,
  );

  const targetSubstitution = structuredClone(setup.input);
  targetSubstitution.program.arguments[0] = setup.fixtureAsset;
  await assert.rejects(
    executeCodexBobLiveSession(targetSubstitution),
    /exact measured Node phase-target source/u,
  );
});

test("requires the complete exact target support-file set", async (t) => {
  const setup = await harness(t);
  const missing = structuredClone(setup.input);
  missing.program.support_files = missing.program.support_files.filter(
    ({ path }) => path !== setup.fixtureAsset,
  );
  await assert.rejects(
    executeCodexBobLiveSession(missing),
    /complete measured phase-target support set/u,
  );

  const missingTransitive = structuredClone(setup.input);
  missingTransitive.program.support_files =
    missingTransitive.program.support_files.filter(
      ({ path }) => path !== FINDING_LEDGER_PATH,
    );
  await assert.rejects(
    executeCodexBobLiveSession(missingTransitive),
    /complete measured phase-target support set/u,
  );

  const extra = structuredClone(setup.input);
  const extraPath = join(setup.root, "extra-support.json");
  await writeFile(extraPath, "{}\n", { mode: 0o444 });
  extra.program.support_files.push(await identity(extraPath));
  await assert.rejects(
    executeCodexBobLiveSession(extra),
    /complete measured phase-target support set/u,
  );
});

test("rejects binding and gateway substitutions before dispatch", async (t) => {
  const setup = await harness(t);
  const bindingSubstitution = structuredClone(setup.input);
  const bindingConfig = structuredClone(setup.config);
  bindingConfig.expected_bob_binding.dispatch_id =
    "dispatch_ffffffffffffffffffffffffffffffff";
  replaceConfig(bindingSubstitution, bindingConfig);
  await assert.rejects(
    executeCodexBobLiveSession(bindingSubstitution),
    /phase-target Bob binding/u,
  );

  const gatewaySubstitution = structuredClone(setup.input);
  const gatewayConfig = structuredClone(setup.config);
  gatewayConfig.identities.gateway = setup.nodeIdentity;
  replaceConfig(gatewaySubstitution, gatewayConfig);
  await assert.rejects(
    executeCodexBobLiveSession(gatewaySubstitution),
    /production browser gateway/u,
  );
});

test("exports only the live-session entry point", async () => {
  const module = await import(
    "../scripts/evaluation/codex-bob-live-controller.mjs"
  );
  assert.deepEqual(Object.keys(module), ["executeCodexBobLiveSession"]);
});
