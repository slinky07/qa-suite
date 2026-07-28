import assert from "node:assert/strict";
import { test } from "node:test";
import {
  executePreparedBobCase,
  requestsFromBobHostTranscript,
  validateBobHostTranscript,
  validateExpectedUseModel,
  validateInterfaceInventory,
  validateTaskExecution,
} from "../scripts/evaluation/bob-host-protocol.mjs";

const digest = (character) => character.repeat(64);

function preparation(overrides = {}) {
  return {
    case_id: "fx_0123456789abcdef0123456789abcdef",
    controller_commit: "a".repeat(40),
    lane: "bob-qa",
    qualification: "not-evidence",
    result: null,
    run_id: "run_0123456789abcdef0123456789abcdef",
    schema_version: 1,
    subject_commit: "b".repeat(40),
    verification_status: "unverified",
    ...overrides,
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
    results: [
      {
        control_ids: ["control_search", "control_submit"],
        disposition: "exercised",
        evidence_sha256: digest("4"),
        task_id: "task_find_item",
      },
      {
        control_ids: ["control_preferences"],
        disposition: "observed-only",
        evidence_sha256: digest("5"),
        task_id: "task_review_preferences",
      },
    ],
    ...overrides,
  };
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

test("controller withholds task capabilities until inventory and modeling complete", async () => {
  const host = adapter();
  const transcript = await executePreparedBobCase({
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
  assert.equal("controller_commit" in host.requests[0].binding, false);
  assert.equal("suite_id" in host.requests[0], false);
  assert.equal("oracle" in host.requests[0], false);

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
      executePreparedBobCase({
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
      executePreparedBobCase({
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
      executePreparedBobCase({
        adapter: host,
        preparation: preparation(),
      }),
    /violates the modeled hierarchy/u,
  );
  assert.equal(host.requests.length, 3);
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
        executePreparedBobCase({
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
          results: sparseResults,
        },
        model(),
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

  const transcript = await executePreparedBobCase({
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
  const transcript = await executePreparedBobCase({
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
  changedOutput.outputs.task_execution.results[0].disposition =
    "observed-only";
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
