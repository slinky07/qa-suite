import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPreparedBobHostBinding,
  executePreparedBobCase,
  requestsFromBobHostTranscript,
  validateBobHostPhaseRequest,
  validateBobHostTranscript,
  validateExpectedUseModel,
  validateInterfaceInventory,
  validateTaskExecution,
} from "../scripts/evaluation/bob-host-protocol.mjs";
import {
  canonicalJson,
  sha256,
} from "../scripts/evaluation/contracts.mjs";

const digest = (character) => character.repeat(64);
const CASE_ID = "fx_0123456789abcdef0123456789abcdef";
const OTHER_CASE_ID = "fx_fedcba9876543210fedcba9876543210";
const REPORT_PATH =
  "QA/2026-07-28-0415-bob-qa-primary-surface.md";
const reportIdentifiers = {
  core_flow_ids: ["flow_00112233445566778899aabbccddeeff_01"],
  surface_id: "surface_00112233445566778899aabbccddeeff",
};
const flowEvidence = [
  {
    kind: "report-reference",
    path: REPORT_PATH,
  },
];
const flowEvidenceSha256 = sha256(canonicalJson(flowEvidence));

function preparation(overrides = {}) {
  return {
    case_id: CASE_ID,
    controller_commit: "a".repeat(40),
    lane: "bob-qa",
    qualification: "not-evidence",
    result: null,
    run_id: "run_0123456789abcdef0123456789abcdef",
    schema_version: 1,
    subject_commit: "b".repeat(40),
    suite_id: "bob-evaluation-v1",
    verification_status: "unverified",
    ...overrides,
  };
}

function suite() {
  const suiteCase = (caseId, commitments, identifiers) => ({
    fixture_manifest:
      `tests/evaluation/fixtures/${caseId}/fixture-manifest.json`,
    id: caseId,
    oracle_commitments: commitments,
    qa_context: `tests/evaluation/fixtures/${caseId}/qa-context.md`,
    report_identifiers: identifiers,
    smoke_checks: ["check_primary"],
  });
  return {
    cases: [
      suiteCase(
        CASE_ID,
        [`seal_${"1".repeat(64)}`, `seal_${"2".repeat(64)}`],
        reportIdentifiers,
      ),
      suiteCase(
        OTHER_CASE_ID,
        [`seal_${"3".repeat(64)}`, `seal_${"4".repeat(64)}`],
        {
          core_flow_ids: [
            "flow_ffeeddccbbaa99887766554433221100_01",
          ],
          surface_id: "surface_ffeeddccbbaa99887766554433221100",
        },
      ),
    ],
    id: "bob-evaluation-v1",
    lane: "bob-qa",
    schema_version: 1,
  };
}

function inventory(overrides = {}) {
  return {
    surfaces: [
      {
        control_ids: ["control_search", "control_submit"],
        id: "surface_primary",
      },
      {
        control_ids: ["control_preferences"],
        id: "surface_settings",
      },
    ],
    ...overrides,
  };
}

function model(overrides = {}) {
  return {
    tasks: [
      {
        control_ids: ["control_search", "control_submit"],
        id: "task_find_item",
        parent_task_id: null,
        surface_id: "surface_primary",
      },
      {
        control_ids: ["control_preferences"],
        id: "task_review_preferences",
        parent_task_id: "task_find_item",
        surface_id: "surface_settings",
      },
    ],
    ...overrides,
  };
}

function taskExecution(overrides = {}) {
  return {
    report_output: {
      lane_result: {
        blocking_evidence: [],
        checklist: [],
        findings: [],
        flows: [
          {
            core: true,
            effectiveness: true,
            evidence: flowEvidence,
            finding_ids: [],
            id: reportIdentifiers.core_flow_ids[0],
            state: "Pass",
          },
        ],
        not_tested: [],
        observations: [],
        verdict: {
          blocker: null,
          severity_counts: {
            S1: 0,
            S2: 0,
            S3: 0,
            S4: 0,
          },
          state: "Go",
        },
      },
      report: {
        path: REPORT_PATH,
        sha256: digest("a"),
      },
    },
    results: [
      {
        control_ids: ["control_search", "control_submit"],
        disposition: "exercised",
        evidence_sha256: flowEvidenceSha256,
        flow_id: reportIdentifiers.core_flow_ids[0],
        task_id: "task_find_item",
      },
      {
        control_ids: ["control_preferences"],
        disposition: "exercised",
        evidence_sha256: flowEvidenceSha256,
        flow_id: reportIdentifiers.core_flow_ids[0],
        task_id: "task_review_preferences",
      },
    ],
    ...overrides,
  };
}

function executeCase(options) {
  return executePreparedBobCase({
    suite: suite(),
    ...options,
  });
}

function adapter(outputs = [
  inventory(),
  model(),
  taskExecution(),
]) {
  const requests = [];
  return {
    requests,
    async runPhase(request) {
      requests.push(structuredClone(request));
      return structuredClone(outputs[requests.length - 1]);
    },
  };
}

test("exposes the exact prepared binding before phase dispatch", () => {
  const dispatchId = "dispatch_0123456789abcdef0123456789abcdef";
  const selectedSuite = suite();
  const binding = createPreparedBobHostBinding({
    dispatchId,
    preparation: preparation(),
    suite: selectedSuite,
  });

  assert.deepEqual(binding, {
    case_id: CASE_ID,
    controller_commit: "a".repeat(40),
    dispatch_id: dispatchId,
    lane: "bob-qa",
    report_identifiers: reportIdentifiers,
    run_id: "run_0123456789abcdef0123456789abcdef",
    schema_version: 1,
    subject_commit: "b".repeat(40),
    suite_id: "bob-evaluation-v1",
  });

  binding.report_identifiers.core_flow_ids.push("observer_mutation");
  assert.deepEqual(
    selectedSuite.cases[0].report_identifiers,
    reportIdentifiers,
  );
});

test("controller withholds task capabilities until inventory and modeling complete", async () => {
  const host = adapter();
  const transcript = await executeCase({
    adapter: host,
    dispatchId: "dispatch_0123456789abcdef0123456789abcdef",
    preparation: preparation(),
  });

  assert.deepEqual(
    host.requests.map(({ phase }) => phase),
    [
      "interface_inventory",
      "expected_use_model",
      "task_execution",
    ],
  );
  assert.deepEqual(
    host.requests.map(({ allowed_capabilities }) => allowed_capabilities),
    [
      ["observe-interface"],
      ["observe-interface"],
      ["observe-interface", "perform-task-actions"],
    ],
  );
  assert.equal(
    host.requests[0].prior_outputs.interface_inventory,
    null,
  );
  assert.deepEqual(
    host.requests[1].prior_outputs.interface_inventory,
    inventory(),
  );
  assert.deepEqual(
    host.requests[2].prior_outputs.expected_use_model,
    model(),
  );
  assert.equal("report_identifiers" in host.requests[0], false);
  assert.equal("report_identifiers" in host.requests[1], false);
  assert.deepEqual(
    host.requests[2].report_identifiers,
    reportIdentifiers,
  );
  assert.equal("controller_commit" in host.requests[0].binding, false);
  assert.equal("suite_id" in host.requests[0], false);
  assert.equal("oracle" in host.requests[0], false);
  host.requests.forEach((request) => {
    assert.equal(
      validateBobHostPhaseRequest(request, transcript.binding),
      request,
    );
  });

  assert.equal(transcript.verification_status, "unverified");
  assert.equal(transcript.qualification, "not-evidence");
  assert.equal(transcript.result, null);
  assert.equal(transcript.claims.method_order, "not-attested");
  assert.equal(
    transcript.protocol_observation,
    "inventory-model-tasks-sequenced",
  );
  assert.deepEqual(requestsFromBobHostTranscript(transcript), host.requests);
  assert.equal(validateBobHostTranscript(transcript), transcript);
});

test("phase request authority rejects capability, disclosure, and claim drift", async () => {
  const host = adapter();
  const transcript = await executeCase({
    adapter: host,
    dispatchId: "dispatch_0123456789abcdef0123456789abcdef",
    preparation: preparation(),
  });
  const [inventoryRequest, modelRequest, taskRequest] = host.requests;
  const taskWithoutReportIdentifiers = structuredClone(taskRequest);
  delete taskWithoutReportIdentifiers.report_identifiers;
  const wrongReportIdentifiers = structuredClone(taskRequest);
  wrongReportIdentifiers.report_identifiers.core_flow_ids = [
    "flow_ffeeddccbbaa99887766554433221100_01",
  ];
  const substitutedReportIdentifiers = structuredClone(taskRequest);
  substitutedReportIdentifiers.report_identifiers =
    structuredClone(suite().cases[1].report_identifiers);
  const capabilitiesWithClaim = [
    ...inventoryRequest.allowed_capabilities,
  ];
  capabilitiesWithClaim.claimed_isolation = "verified";

  const invalidRequests = [
    {
      error: /capabilities do not match/u,
      value: {
        ...inventoryRequest,
        allowed_capabilities: ["perform-task-actions"],
      },
    },
    {
      error: /must not contain named properties/u,
      value: {
        ...inventoryRequest,
        allowed_capabilities: capabilitiesWithClaim,
      },
    },
    {
      error: /inventory request must not disclose prior outputs/u,
      value: {
        ...inventoryRequest,
        prior_outputs: {
          ...inventoryRequest.prior_outputs,
          interface_inventory: inventory(),
        },
      },
    },
    {
      error: /modeling request must not disclose a later output/u,
      value: {
        ...modelRequest,
        prior_outputs: {
          ...modelRequest.prior_outputs,
          expected_use_model: model(),
        },
      },
    },
    {
      error: /fields are/u,
      value: {
        ...modelRequest,
        report_identifiers: reportIdentifiers,
      },
    },
    {
      error: /fields are/u,
      value: taskWithoutReportIdentifiers,
    },
    {
      error: /must use the selected surface token/u,
      value: wrongReportIdentifiers,
    },
    {
      error: /do not match the selected controller identifiers/u,
      value: substitutedReportIdentifiers,
    },
    {
      error: /fields are/u,
      value: {
        ...inventoryRequest,
        claimed_isolation: "verified",
      },
    },
    {
      error: /must remain non-qualifying/u,
      value: {
        ...inventoryRequest,
        verification_status: "verified",
      },
    },
    {
      error: /binding fields are/u,
      value: {
        ...inventoryRequest,
        binding: {
          ...inventoryRequest.binding,
          controller_commit: "a".repeat(40),
        },
      },
    },
    {
      error: /does not match the selected controller binding/u,
      value: {
        ...inventoryRequest,
        binding: {
          ...inventoryRequest.binding,
          run_id: "run_fedcba9876543210fedcba9876543210",
        },
      },
    },
  ];

  invalidRequests.forEach(({ error, value }) => {
    assert.throws(
      () => validateBobHostPhaseRequest(value, transcript.binding),
      error,
    );
  });
});

test("phase request authority permits modeled control reuse", async () => {
  const host = adapter();
  const transcript = await executeCase({
    adapter: host,
    dispatchId: "dispatch_0123456789abcdef0123456789abcdef",
    preparation: preparation(),
  });
  const request = structuredClone(host.requests[2]);
  request.prior_outputs.interface_inventory = {
    surfaces: [
      {
        control_ids: ["control_search", "control_submit"],
        id: "surface_primary",
      },
    ],
  };
  request.prior_outputs.expected_use_model = {
    tasks: [
      {
        control_ids: ["control_search"],
        id: "task_search",
        parent_task_id: null,
        surface_id: "surface_primary",
      },
      {
        control_ids: ["control_search", "control_submit"],
        id: "task_submit",
        parent_task_id: "task_search",
        surface_id: "surface_primary",
      },
    ],
  };

  assert.equal(
    validateBobHostPhaseRequest(request, transcript.binding),
    request,
  );
});

test("invalid inventory prevents modeling and task dispatch", async () => {
  const host = adapter([
    inventory({
      surfaces: [
        {
          control_ids: ["control_duplicate", "control_duplicate"],
          id: "surface_primary",
        },
      ],
    }),
  ]);

  await assert.rejects(
    () =>
      executeCase({
        adapter: host,
        preparation: preparation(),
      }),
    /control_ids must be unique/u,
  );
  assert.equal(host.requests.length, 1);
  assert.deepEqual(
    host.requests[0].allowed_capabilities,
    ["observe-interface"],
  );
});

test("invalid expected-use model prevents task capabilities", async () => {
  const invalidModel = model({
    tasks: [
      {
        control_ids: ["control_missing"],
        id: "task_find_item",
        parent_task_id: null,
        surface_id: "surface_primary",
      },
    ],
  });
  const host = adapter([inventory(), invalidModel]);

  await assert.rejects(
    () =>
      executeCase({
        adapter: host,
        preparation: preparation(),
      }),
    /non-inventoried control/u,
  );
  assert.equal(host.requests.length, 2);
  assert.equal(
    host.requests.some(({ allowed_capabilities }) =>
      allowed_capabilities.includes("perform-task-actions"),
    ),
    false,
  );
});

test("task execution must follow the modeled hierarchy", async () => {
  const reversed = taskExecution({
    results: [...taskExecution().results].reverse(),
  });
  const host = adapter([inventory(), model(), reversed]);

  await assert.rejects(
    () =>
      executeCase({
        adapter: host,
        preparation: preparation(),
      }),
    /violates the modeled hierarchy/u,
  );
  assert.equal(host.requests.length, 3);
});

test("task execution binds task disposition and evidence to its core flow", () => {
  const notExercised = taskExecution();
  notExercised.results[0].disposition = "not-tested";
  assert.throws(
    () =>
      validateTaskExecution(
        notExercised,
        model(),
        reportIdentifiers,
        CASE_ID,
      ),
    /Pass requires exercised tasks/u,
  );

  const wrongFlow = taskExecution();
  wrongFlow.results[0].flow_id =
    "flow_ffeeddccbbaa99887766554433221100_01";
  assert.throws(
    () =>
      validateTaskExecution(
        wrongFlow,
        model(),
        reportIdentifiers,
        CASE_ID,
      ),
    /flow_id is not a selected core flow/u,
  );

  const wrongEvidence = taskExecution();
  wrongEvidence.results[0].evidence_sha256 = digest("4");
  assert.throws(
    () =>
      validateTaskExecution(
        wrongEvidence,
        model(),
        reportIdentifiers,
        CASE_ID,
      ),
    /evidence digest does not match/u,
  );
});

test("task execution maps reordered flows and preserves coverage semantics", () => {
  const multipleIdentifiers = {
    core_flow_ids: [
      "flow_00112233445566778899aabbccddeeff_01",
      "flow_00112233445566778899aabbccddeeff_02",
    ],
    surface_id: reportIdentifiers.surface_id,
  };
  const secondaryEvidence = [
    {
      kind: "screenshot",
      path: "QA/evidence/preferences.png",
    },
  ];
  const output = taskExecution();
  output.report_output.lane_result.flows = [
    {
      core: true,
      effectiveness: null,
      evidence: secondaryEvidence,
      finding_ids: [],
      id: multipleIdentifiers.core_flow_ids[1],
      state: "Observed only",
    },
    output.report_output.lane_result.flows[0],
  ];
  output.results[1] = {
    ...output.results[1],
    disposition: "observed-only",
    evidence_sha256: sha256(canonicalJson(secondaryEvidence)),
    flow_id: multipleIdentifiers.core_flow_ids[1],
  };
  assert.equal(
    validateTaskExecution(
      output,
      model(),
      multipleIdentifiers,
      CASE_ID,
    ),
    output,
  );

  const partiallyUntested = structuredClone(output);
  partiallyUntested.report_output.lane_result.flows[1] = {
    ...partiallyUntested.report_output.lane_result.flows[1],
    effectiveness: null,
    evidence: [],
    state: "Not tested",
  };
  partiallyUntested.results[0] = {
    ...partiallyUntested.results[0],
    disposition: "not-tested",
    evidence_sha256: sha256(canonicalJson([])),
  };
  assert.equal(
    validateTaskExecution(
      partiallyUntested,
      model(),
      multipleIdentifiers,
      CASE_ID,
    ),
    partiallyUntested,
  );

  const blockedAfterAttempt = taskExecution();
  blockedAfterAttempt.report_output.lane_result.flows[0] = {
    ...blockedAfterAttempt.report_output.lane_result.flows[0],
    effectiveness: null,
    state: "Blocked",
  };
  blockedAfterAttempt.report_output.lane_result.verdict = {
    ...blockedAfterAttempt.report_output.lane_result.verdict,
    blocker: "browser became unavailable after task actions",
    state: "Blocked",
  };
  assert.equal(
    validateTaskExecution(
      blockedAfterAttempt,
      model(),
      reportIdentifiers,
      CASE_ID,
    ),
    blockedAfterAttempt,
  );
});

test("structured phase contracts reject unknown fields and invalid references", () => {
  assert.throws(
    () =>
      validateInterfaceInventory({
        ...inventory(),
        artifact_sha256: digest("1"),
      }),
    /fields are/u,
  );
  assert.throws(
    () =>
      validateExpectedUseModel(
        model({
          tasks: [
            {
              ...model().tasks[0],
              parent_task_id: "task_later",
            },
          ],
        }),
        inventory(),
      ),
    /must reference an earlier task/u,
  );
  assert.throws(
    () =>
      validateExpectedUseModel(
        model({
          tasks: [model().tasks[0]],
        }),
        inventory(),
      ),
    /cover every inventoried control/u,
  );
  assert.throws(
    () =>
      validateTaskExecution(
        taskExecution({
          results: [taskExecution().results[0]],
        }),
        model(),
        reportIdentifiers,
        CASE_ID,
      ),
    /cover every modeled task/u,
  );
  assert.throws(
    () =>
      validateTaskExecution(
        taskExecution({
          results: [
            {
              ...taskExecution().results[0],
              control_ids: ["control_search"],
            },
            taskExecution().results[1],
          ],
        }),
        model(),
        reportIdentifiers,
        CASE_ID,
      ),
    /account for every modeled control|must contain 2-2 items/u,
  );
});

test("only non-qualifying Bob preparations can enter the protocol", async () => {
  const host = adapter();
  for (const invalid of [
    preparation({ lane: "smoke-qa" }),
    preparation({ qualification: "evidence" }),
    preparation({ result: {} }),
    preparation({ schema_version: 2 }),
    preparation({ verification_status: "verified" }),
  ]) {
    await assert.rejects(
      () =>
        executeCase({
          adapter: host,
          preparation: invalid,
        }),
      /bob-qa preparation|explicitly non-qualifying/u,
    );
  }
  assert.equal(host.requests.length, 0);
});

test("sparse phase arrays cannot satisfy required coverage", () => {
  const sparseTasks = new Array(2);
  const sparseResults = new Array(2);
  assert.throws(
    () =>
      validateExpectedUseModel(
        {
          tasks: sparseTasks,
        },
        inventory(),
      ),
    /dense array/u,
  );
  assert.throws(
    () =>
      validateTaskExecution(
        {
          report_output: taskExecution().report_output,
          results: sparseResults,
        },
        model(),
        reportIdentifiers,
        CASE_ID,
      ),
    /dense array/u,
  );
});

test("adapter-owned objects are cloned before later phases receive them", async () => {
  const retainedInventory = inventory();
  const requests = [];
  const mutatingAdapter = {
    async runPhase(request) {
      requests.push(request);
      if (request.phase === "interface_inventory") {
        return retainedInventory;
      }
      if (request.phase === "expected_use_model") {
        retainedInventory.surfaces[0].control_ids.push("control_injected");
        request.prior_outputs.interface_inventory.surfaces.length = 0;
        return model();
      }
      return taskExecution();
    },
  };

  const transcript = await executeCase({
    adapter: mutatingAdapter,
    preparation: preparation(),
  });
  assert.deepEqual(
    transcript.outputs.interface_inventory,
    inventory(),
  );
  assert.deepEqual(
    requests[2].prior_outputs.interface_inventory,
    inventory(),
  );
});

test("event-chain or phase-output tampering invalidates the transcript", async () => {
  const transcript = await executeCase({
    adapter: adapter(),
    preparation: preparation(),
  });

  const changedSequence = structuredClone(transcript);
  changedSequence.events[1].sequence = 7;
  assert.throws(
    () => validateBobHostTranscript(changedSequence),
    /breaks the controller sequence/u,
  );

  const changedOutput = structuredClone(transcript);
  changedOutput.outputs.task_execution.report_output.report.path =
    "QA/2026-07-28-0416-bob-qa-primary-surface.md";
  assert.throws(
    () => validateBobHostTranscript(changedOutput),
    /output is unbound/u,
  );

  const promoted = structuredClone(transcript);
  promoted.claims.method_order = "verified";
  assert.throws(
    () => validateBobHostTranscript(promoted),
    /was promoted/u,
  );

  for (const field of [
    "case_id",
    "controller_commit",
    "subject_commit",
  ]) {
    const relabeled = structuredClone(transcript);
    relabeled.binding[field] =
      field === "case_id"
        ? "fx_fedcba9876543210fedcba9876543210"
        : "c".repeat(40);
    assert.throws(
      () => validateBobHostTranscript(relabeled),
      /breaks the controller sequence/u,
    );
  }

  const wrongBindingVersion = structuredClone(transcript);
  wrongBindingVersion.binding.schema_version = 2;
  assert.throws(
    () => validateBobHostTranscript(wrongBindingVersion),
    /schema_version must equal 1/u,
  );
});
