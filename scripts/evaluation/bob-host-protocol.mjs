import { randomBytes } from "node:crypto";
import {
  canonicalJson,
  isCanonicalBobReportPath,
  parseContractJson,
  sha256,
  validateBobLaneResult,
  validateBobReportIdentifiers,
  validateSuite,
} from "./contracts.mjs";

const CASE_ID = /^fx_[0-9a-f]{32}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const CONTROL_ID = /^control_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const DISPATCH_ID = /^dispatch_[0-9a-f]{32}$/;
const RUN_ID = /^run_[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SUITE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*-v1$/;
const SURFACE_ID = /^surface_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const TASK_ID = /^task_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const ZERO_DIGEST = "0".repeat(64);

const PHASES = [
  "interface_inventory",
  "expected_use_model",
  "task_execution",
];

const UNATTESTED_CLAIMS = Object.freeze({
  command_environment: "not-attested",
  command_network: "not-attested",
  context_isolation: "not-attested",
  execution_isolation: "not-attested",
  filesystem_isolation: "not-attested",
  method_order: "not-attested",
  state_authentication: "not-attested",
  tool_inventory: "not-attested",
});

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
  if (canonicalJson(observed) !== canonicalJson(wanted)) {
    throw new Error(
      `${label} fields are ${observed.join(", ")}; expected ${wanted.join(", ")}`,
    );
  }
}

function assertString(value, label, pattern) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !pattern.test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function assertBoundedArray(
  value,
  label,
  { minimum = 0, maximum },
) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new Error(`${label} must contain ${minimum}-${maximum} items`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new Error(`${label} must be a dense array`);
    }
  }
  if (Object.keys(value).length !== value.length) {
    throw new Error(`${label} must not contain named properties`);
  }
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be unique`);
  }
}

function validateSha256(value, label) {
  assertString(value, label, SHA256);
}

function bindingFromPreparation(
  preparation,
  dispatchId,
  reportIdentifiers,
) {
  assertObject(preparation, "preparation");
  if (
    preparation.schema_version !== 1 ||
    preparation.verification_status !== "unverified" ||
    preparation.qualification !== "not-evidence" ||
    preparation.result !== null
  ) {
    throw new Error("preparation must remain explicitly non-qualifying");
  }
  if (preparation.lane !== "bob-qa") {
    throw new Error("Bob host protocol requires a bob-qa preparation");
  }
  assertString(preparation.case_id, "preparation.case_id", CASE_ID);
  assertString(preparation.run_id, "preparation.run_id", RUN_ID);
  assertString(
    preparation.controller_commit,
    "preparation.controller_commit",
    COMMIT,
  );
  assertString(
    preparation.subject_commit,
    "preparation.subject_commit",
    COMMIT,
  );
  assertString(preparation.suite_id, "preparation.suite_id", SUITE_ID);
  validateBobReportIdentifiers(
    reportIdentifiers,
    preparation.case_id,
    "report identifiers",
  );
  const selectedDispatchId =
    dispatchId ?? `dispatch_${randomBytes(16).toString("hex")}`;
  assertString(selectedDispatchId, "dispatch_id", DISPATCH_ID);
  return {
    case_id: preparation.case_id,
    controller_commit: preparation.controller_commit,
    dispatch_id: selectedDispatchId,
    lane: preparation.lane,
    report_identifiers: structuredClone(reportIdentifiers),
    run_id: preparation.run_id,
    schema_version: 1,
    subject_commit: preparation.subject_commit,
    suite_id: preparation.suite_id,
  };
}

function selectedCaseContract(suite, preparation) {
  const snapshot = parseContractJson(canonicalJson(suite), "Bob suite");
  validateSuite(snapshot);
  if (
    snapshot.id !== preparation.suite_id ||
    snapshot.lane !== "bob-qa"
  ) {
    throw new Error("Bob suite does not match the preparation");
  }
  const suiteCase = snapshot.cases.find(
    ({ id }) => id === preparation.case_id,
  );
  if (suiteCase === undefined) {
    throw new Error("Bob suite does not contain the prepared case");
  }
  return {
    reportIdentifiers: structuredClone(suiteCase.report_identifiers),
  };
}

export function validateInterfaceInventory(value) {
  assertExactKeys(
    value,
    ["surfaces"],
    "interface inventory",
  );
  assertBoundedArray(value.surfaces, "interface inventory.surfaces", {
    minimum: 1,
    maximum: 64,
  });
  const surfaceIds = [];
  const controlIds = [];
  value.surfaces.forEach((surface, index) => {
    const label = `interface inventory.surfaces[${index}]`;
    assertExactKeys(surface, ["control_ids", "id"], label);
    assertString(surface.id, `${label}.id`, SURFACE_ID);
    assertBoundedArray(surface.control_ids, `${label}.control_ids`, {
      minimum: 1,
      maximum: 128,
    });
    surface.control_ids.forEach((controlId, controlIndex) =>
      assertString(
        controlId,
        `${label}.control_ids[${controlIndex}]`,
        CONTROL_ID,
      ),
    );
    assertUnique(surface.control_ids, `${label}.control_ids`);
    surfaceIds.push(surface.id);
    controlIds.push(...surface.control_ids);
  });
  assertUnique(surfaceIds, "interface inventory surface IDs");
  assertUnique(controlIds, "interface inventory control IDs");
  return value;
}

export function validateExpectedUseModel(value, inventory) {
  validateInterfaceInventory(inventory);
  assertExactKeys(
    value,
    ["tasks"],
    "expected-use model",
  );
  assertBoundedArray(value.tasks, "expected-use model.tasks", {
    minimum: 1,
    maximum: 256,
  });
  const surfaces = new Map(
    inventory.surfaces.map((surface) => [surface.id, new Set(surface.control_ids)]),
  );
  const inventoriedControls = new Set(
    inventory.surfaces.flatMap(({ control_ids: controlIds }) => controlIds),
  );
  const modeledControls = new Set();
  const seenTasks = new Set();
  value.tasks.forEach((task, index) => {
    const label = `expected-use model.tasks[${index}]`;
    assertExactKeys(
      task,
      ["control_ids", "id", "parent_task_id", "surface_id"],
      label,
    );
    assertString(task.id, `${label}.id`, TASK_ID);
    if (seenTasks.has(task.id)) {
      throw new Error("expected-use model task IDs must be unique");
    }
    if (task.parent_task_id !== null) {
      assertString(task.parent_task_id, `${label}.parent_task_id`, TASK_ID);
      if (!seenTasks.has(task.parent_task_id)) {
        throw new Error(
          `${label}.parent_task_id must reference an earlier task`,
        );
      }
    }
    assertString(task.surface_id, `${label}.surface_id`, SURFACE_ID);
    const controls = surfaces.get(task.surface_id);
    if (!controls) {
      throw new Error(`${label}.surface_id was not inventoried`);
    }
    assertBoundedArray(task.control_ids, `${label}.control_ids`, {
      minimum: 1,
      maximum: 128,
    });
    task.control_ids.forEach((controlId, controlIndex) => {
      assertString(
        controlId,
        `${label}.control_ids[${controlIndex}]`,
        CONTROL_ID,
      );
      if (!controls.has(controlId)) {
        throw new Error(`${label} references a non-inventoried control`);
      }
    });
    assertUnique(task.control_ids, `${label}.control_ids`);
    task.control_ids.forEach((controlId) => modeledControls.add(controlId));
    seenTasks.add(task.id);
  });
  const unmodeledControl = [...inventoriedControls].find(
    (controlId) => !modeledControls.has(controlId),
  );
  if (unmodeledControl) {
    throw new Error("expected-use model must cover every inventoried control");
  }
  return value;
}

function validateReportOutput(
  value,
  reportIdentifiers,
  caseId,
) {
  assertExactKeys(
    value,
    ["lane_result", "report"],
    "task execution.report_output",
  );
  assertExactKeys(
    value.report,
    ["path", "sha256"],
    "task execution.report_output.report",
  );
  if (!isCanonicalBobReportPath(value.report.path)) {
    throw new Error(
      "task execution.report_output.report.path must be a canonical Bob report path",
    );
  }
  validateSha256(
    value.report.sha256,
    "task execution.report_output.report.sha256",
  );
  validateBobLaneResult(
    value.lane_result,
    reportIdentifiers,
    caseId,
    "task execution.report_output.lane_result",
  );
  return value;
}

export function validateTaskExecution(
  value,
  model,
  reportIdentifiers,
  caseId,
) {
  assertExactKeys(
    value,
    ["report_output", "results"],
    "task execution",
  );
  assertBoundedArray(value.results, "task execution.results", {
    minimum: 1,
    maximum: 256,
  });
  if (value.results.length !== model.tasks.length) {
    throw new Error("task execution must cover every modeled task once");
  }
  value.results.forEach((result, index) => {
    const label = `task execution.results[${index}]`;
    const task = model.tasks[index];
    assertExactKeys(
      result,
      ["control_ids", "disposition", "evidence_sha256", "task_id"],
      label,
    );
    if (result.task_id !== task.id) {
      throw new Error(`${label}.task_id violates the modeled hierarchy`);
    }
    validateSha256(
      result.evidence_sha256,
      `${label}.evidence_sha256`,
    );
    if (
      !["exercised", "not-tested", "observed-only"].includes(
        result.disposition,
      )
    ) {
      throw new Error(`${label}.disposition is invalid`);
    }
    assertBoundedArray(result.control_ids, `${label}.control_ids`, {
      minimum: task.control_ids.length,
      maximum: task.control_ids.length,
    });
    result.control_ids.forEach((controlId, controlIndex) => {
      assertString(
        controlId,
        `${label}.control_ids[${controlIndex}]`,
        CONTROL_ID,
      );
      if (!task.control_ids.includes(controlId)) {
        throw new Error(`${label} references a control outside its task`);
      }
    });
    assertUnique(result.control_ids, `${label}.control_ids`);
    if (
      canonicalJson([...result.control_ids].sort()) !==
      canonicalJson([...task.control_ids].sort())
    ) {
      throw new Error(`${label} must account for every modeled control`);
    }
  });
  validateReportOutput(
    value.report_output,
    reportIdentifiers,
    caseId,
  );
  return value;
}

function phaseRequest(binding, phase, priorOutputs) {
  const interactive = phase === "task_execution";
  return {
    allowed_capabilities: interactive
      ? ["observe-interface", "perform-task-actions"]
      : ["observe-interface"],
    binding: {
      case_id: binding.case_id,
      dispatch_id: binding.dispatch_id,
      lane: binding.lane,
      run_id: binding.run_id,
      schema_version: binding.schema_version,
      subject_commit: binding.subject_commit,
    },
    phase,
    prior_outputs: structuredClone(priorOutputs),
    ...(phase === "task_execution"
      ? {
          report_identifiers: structuredClone(
            binding.report_identifiers,
          ),
        }
      : {}),
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  };
}

function eventHash(value) {
  const unsigned = { ...value };
  delete unsigned.sha256;
  return sha256(canonicalJson(unsigned));
}

function appendEvent(events, binding, phase, output) {
  const previous = events.at(-1);
  const event = {
    binding_sha256: sha256(canonicalJson(binding)),
    dispatch_id: binding.dispatch_id,
    output_sha256: sha256(canonicalJson(output)),
    phase,
    previous_sha256: previous?.sha256 ?? ZERO_DIGEST,
    run_id: binding.run_id,
    schema_version: 1,
    sequence: events.length + 1,
  };
  return [
    ...events,
    {
      ...event,
      sha256: eventHash(event),
    },
  ];
}

export function validateBobHostTranscript(value) {
  assertExactKeys(
    value,
    [
      "binding",
      "claims",
      "event_chain_sha256",
      "events",
      "outputs",
      "protocol_observation",
      "qualification",
      "result",
      "schema_version",
      "verification_status",
    ],
    "Bob host transcript",
  );
  if (
    value.schema_version !== 1 ||
    value.verification_status !== "unverified" ||
    value.qualification !== "not-evidence" ||
    value.result !== null
  ) {
    throw new Error("Bob host transcript must remain non-qualifying");
  }
  assertExactKeys(value.binding, [
    "case_id",
    "controller_commit",
    "dispatch_id",
    "lane",
    "report_identifiers",
    "run_id",
    "schema_version",
    "subject_commit",
    "suite_id",
  ], "Bob host transcript.binding");
  if (value.binding.schema_version !== 1) {
    throw new Error("Bob host transcript.binding.schema_version must equal 1");
  }
  bindingFromPreparation({
    ...value.binding,
    qualification: "not-evidence",
    result: null,
    verification_status: "unverified",
  }, value.binding.dispatch_id, value.binding.report_identifiers);
  assertExactKeys(
    value.claims,
    Object.keys(UNATTESTED_CLAIMS),
    "Bob host transcript.claims",
  );
  for (const [name, expected] of Object.entries(UNATTESTED_CLAIMS)) {
    if (value.claims[name] !== expected) {
      throw new Error(`Bob host transcript.claims.${name} was promoted`);
    }
  }
  assertBoundedArray(value.events, "Bob host transcript.events", {
    minimum: 3,
    maximum: 3,
  });
  let previousDigest = ZERO_DIGEST;
  value.events.forEach((event, index) => {
    const label = `Bob host transcript.events[${index}]`;
    assertExactKeys(event, [
      "binding_sha256",
      "dispatch_id",
      "output_sha256",
      "phase",
      "previous_sha256",
      "run_id",
      "schema_version",
      "sequence",
      "sha256",
    ], label);
    if (
      event.dispatch_id !== value.binding.dispatch_id ||
      event.binding_sha256 !== sha256(canonicalJson(value.binding)) ||
      event.run_id !== value.binding.run_id ||
      event.phase !== PHASES[index] ||
      event.sequence !== index + 1 ||
      event.schema_version !== 1 ||
      event.previous_sha256 !== previousDigest ||
      eventHash(event) !== event.sha256
    ) {
      throw new Error(`${label} breaks the controller sequence`);
    }
    validateSha256(event.output_sha256, `${label}.output_sha256`);
    previousDigest = event.sha256;
  });
  if (
    value.event_chain_sha256 !== previousDigest ||
    value.protocol_observation !== "inventory-model-tasks-sequenced"
  ) {
    throw new Error("Bob host transcript completion is inconsistent");
  }
  assertExactKeys(
    value.outputs,
    ["expected_use_model", "interface_inventory", "task_execution"],
    "Bob host transcript.outputs",
  );
  validateInterfaceInventory(value.outputs.interface_inventory);
  validateExpectedUseModel(
    value.outputs.expected_use_model,
    value.outputs.interface_inventory,
  );
  validateTaskExecution(
    value.outputs.task_execution,
    value.outputs.expected_use_model,
    value.binding.report_identifiers,
    value.binding.case_id,
  );
  PHASES.forEach((phase, index) => {
    if (
      value.events[index].output_sha256 !==
      sha256(canonicalJson(value.outputs[phase]))
    ) {
      throw new Error(`Bob host transcript ${phase} output is unbound`);
    }
  });
  return value;
}

export function requestsFromBobHostTranscript(value) {
  const transcript = validateBobHostTranscript(value);
  return PHASES.map((phase) =>
    phaseRequest(transcript.binding, phase, {
      expected_use_model:
        phase === "task_execution"
          ? transcript.outputs.expected_use_model
          : null,
      interface_inventory:
        phase === "interface_inventory"
          ? null
          : transcript.outputs.interface_inventory,
    }),
  );
}

export async function executePreparedBobCase({
  adapter,
  dispatchId,
  preparation,
  suite,
}) {
  if (
    adapter === null ||
    typeof adapter !== "object" ||
    typeof adapter.runPhase !== "function"
  ) {
    throw new Error("adapter must provide runPhase(request)");
  }
  const { reportIdentifiers } = selectedCaseContract(
    suite,
    preparation,
  );
  const binding = bindingFromPreparation(
    preparation,
    dispatchId,
    reportIdentifiers,
  );
  const outputs = {};
  let events = [];

  for (const phase of PHASES) {
    const request = phaseRequest(binding, phase, {
      expected_use_model:
        phase === "task_execution" ? outputs.expected_use_model : null,
      interface_inventory:
        phase === "interface_inventory" ? null : outputs.interface_inventory,
    });
    const output = structuredClone(await adapter.runPhase(request));
    if (phase === "interface_inventory") {
      outputs.interface_inventory = validateInterfaceInventory(output);
    } else if (phase === "expected_use_model") {
      outputs.expected_use_model = validateExpectedUseModel(
        output,
        outputs.interface_inventory,
      );
    } else {
      outputs.task_execution = validateTaskExecution(
        output,
        outputs.expected_use_model,
        binding.report_identifiers,
        binding.case_id,
      );
    }
    events = appendEvent(events, binding, phase, output);
  }

  return validateBobHostTranscript({
    binding,
    claims: { ...UNATTESTED_CLAIMS },
    event_chain_sha256: events.at(-1).sha256,
    events,
    outputs,
    protocol_observation: "inventory-model-tasks-sequenced",
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  });
}
