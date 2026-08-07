import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

function repositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

async function repositoryJson(path) {
  return JSON.parse(await repositoryFile(path));
}

function assertStrictObject(schema, required) {
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, required);
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    [...required].sort(),
  );
}

test("reconciliation protocol ships five strict version-1 schemas", async () => {
  const [dispatch, sidecar, inventory, decisions, receipt] = await Promise.all([
    repositoryJson(
      "qa-suite/references/finding-reconciliation-dispatch-v1.schema.json",
    ),
    repositoryJson("qa-suite/references/finding-proposals-v1.schema.json"),
    repositoryJson(
      "qa-suite/references/finding-reconciliation-inventory-v1.schema.json",
    ),
    repositoryJson(
      "qa-suite/references/finding-reconciliation-decisions-v1.schema.json",
    ),
    repositoryJson(
      "qa-suite/references/finding-reconciliation-receipt-v1.schema.json",
    ),
  ]);

  for (const schema of [dispatch, sidecar, inventory, decisions, receipt]) {
    assert.equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
    );
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.schema_version.const, 1);
    assert.equal(
      schema.properties.protocol.const,
      "qa-suite-finding-reconciliation",
    );
  }

  assertStrictObject(dispatch, [
    "schema_version",
    "protocol",
    "run_id",
    "candidate",
    "frozen_at",
    "selected_executions",
  ]);
  assertStrictObject(sidecar, [
    "schema_version",
    "protocol",
    "run_id",
    "execution_id",
    "candidate",
    "lane",
    "report",
    "proposals",
  ]);
  assertStrictObject(inventory, [
    "schema_version",
    "protocol",
    "run_id",
    "candidate",
    "created_at",
    "dispatch_manifest",
    "previous_ledger",
    "reports",
    "unexecuted",
  ]);
  assertStrictObject(decisions, [
    "schema_version",
    "protocol",
    "run_id",
    "supersedes_run_id",
    "candidate",
    "inventory",
    "candidate_ledger",
    "reconciled_at",
    "decisions",
  ]);
  assertStrictObject(receipt, [
    "schema_version",
    "protocol",
    "run_id",
    "supersedes_run_id",
    "candidate",
    "dispatch_manifest",
    "inventory",
    "ledger",
    "reconciled_at",
    "decisions",
    "finding_results",
    "summary",
    "prominent_risks",
    "persistence",
  ]);

  for (const pattern of [
    dispatch.properties.run_id.pattern,
    inventory.properties.run_id.pattern,
    decisions.$defs.run_id.pattern,
    receipt.$defs.run_id.pattern,
  ]) {
    const runId = new RegExp(pattern);
    assert.equal(runId.test("run-001"), true);
    assert.equal(runId.test("run:001"), false);
    assert.equal(runId.test("run."), false);
    assert.equal(runId.test("CON"), false);
  }
});

test("decision envelope and receipt share one exact semantic decision contract", async () => {
  const [decisions, receipt] = await Promise.all([
    repositoryJson(
      "qa-suite/references/finding-reconciliation-decisions-v1.schema.json",
    ),
    repositoryJson(
      "qa-suite/references/finding-reconciliation-receipt-v1.schema.json",
    ),
  ]);
  for (const definition of [
    "sha256",
    "identifier",
    "run_id",
    "lane_identity",
    "candidate",
    "artifact_ref",
    "proposal_ref",
    "candidate_finding_ids",
    "evidence_field",
    "evidence_fields",
    "created_decision",
    "matched_decision",
    "rejected_decision",
    "blocked_decision",
    "decision",
  ]) {
    assert.deepEqual(decisions.$defs[definition], receipt.$defs[definition]);
  }
  assert.equal(decisions.properties.decisions.items.$ref, "#/$defs/decision");
  assert.deepEqual(
    decisions.properties.candidate_ledger.oneOf.map((option) =>
      option.$ref ?? option.type,
    ),
    ["#/$defs/artifact_ref", "null"],
  );
});

test("proposal schemas bind candidate, report, proposal, and safe comparison data", async () => {
  const [sidecar, inventory] = await Promise.all([
    repositoryJson("qa-suite/references/finding-proposals-v1.schema.json"),
    repositoryJson(
      "qa-suite/references/finding-reconciliation-inventory-v1.schema.json",
    ),
  ]);

  const sidecarProposal = sidecar.properties.proposals.items;
  const inventoryProposal =
    inventory.properties.reports.items.properties.proposals.items;

  assertStrictObject(sidecarProposal, [
    "local_id",
    "title",
    "source_content_sha256",
    "component",
    "location",
    "oracle",
    "severity",
    "priority",
    "sensitivity_classification",
    "comparison",
  ]);
  assertStrictObject(inventoryProposal, [
    "local_id",
    "source_content_sha256",
    "content_sha256",
    "component",
    "severity",
    "priority",
    "sensitivity_classification",
    "comparison",
  ]);

  for (const proposal of [sidecarProposal, inventoryProposal]) {
    assert.deepEqual(
      proposal.properties.severity.enum,
      ["S1", "S2", "S3", "S4"],
    );
    assert.deepEqual(
      proposal.properties.priority.enum,
      ["P0", "P1", "P2", "P3"],
    );

    assert.ok(
      !proposal.properties.sensitivity_classification.enum.includes(
        "human-cleared",
      ),
    );
  }

  assert.deepEqual(
    sidecarProposal.properties.comparison.oneOf.map(
      ({ properties }) => properties.storage.const,
    ),
    ["sanitized", "sensitive-local"],
  );
  assert.deepEqual(
    inventoryProposal.properties.comparison.oneOf.map(
      ({ properties }) => properties.storage.const,
    ),
    ["sanitized", "withheld"],
  );
  assert.equal(
    inventoryProposal.properties.comparison.oneOf[1].properties.reason_code
      .const,
    "sensitive-manual-handling",
  );

  assert.equal(sidecar.properties.proposals.minItems, undefined);
  assert.equal(sidecar.properties.proposals.uniqueItems, true);
  assert.equal(inventory.properties.reports.uniqueItems, true);
  assert.equal(
    inventory.properties.reports.items.properties.proposals.uniqueItems,
    true,
  );
  assert.deepEqual(
    Object.keys(inventory.properties.reports.items.properties).sort(),
    ["execution_id", "lane", "proposals", "report", "sidecar"],
  );
  assert.equal(inventory.properties.unexecuted.uniqueItems, true);
});

test("dispatch manifest is the frozen selected-run completeness authority", async () => {
  const [dispatch, inventory] = await Promise.all([
    repositoryJson(
      "qa-suite/references/finding-reconciliation-dispatch-v1.schema.json",
    ),
    repositoryJson(
      "qa-suite/references/finding-reconciliation-inventory-v1.schema.json",
    ),
  ]);
  const execution = dispatch.properties.selected_executions.items;

  assert.equal(dispatch.properties.selected_executions.minItems, 1);
  assert.equal(dispatch.properties.selected_executions.uniqueItems, true);
  assertStrictObject(execution, [
    "execution_id",
    "lane",
    "report_pointer",
    "sidecar_pointer",
  ]);
  assertStrictObject(inventory.properties.dispatch_manifest, [
    "path",
    "sha256",
  ]);
  assert.deepEqual(
    inventory.properties.unexecuted.items.properties.state.enum,
    ["gated", "blocked"],
  );
});

test("receipt schema makes every disposition explicit and auditable", async () => {
  const receipt = await repositoryJson(
    "qa-suite/references/finding-reconciliation-receipt-v1.schema.json",
  );
  const variants = receipt.$defs.decision.oneOf.map(({ $ref }) =>
    receipt.$defs[$ref.split("/").at(-1)],
  );
  const byDisposition = new Map(
    variants.map((variant) => [
      variant.properties.disposition.const,
      variant,
    ]),
  );

  assert.deepEqual(
    [...byDisposition.keys()],
    ["created", "matched", "rejected", "blocked"],
  );
  assert.equal(receipt.properties.decisions.uniqueItems, true);
  assert.equal(receipt.properties.finding_results.uniqueItems, true);
  assert.equal(receipt.properties.prominent_risks.uniqueItems, true);
  assert.equal(
    receipt.properties.dispatch_manifest.$ref,
    "#/$defs/artifact_ref",
  );
  assertStrictObject(receipt.$defs.artifact_ref, ["path", "sha256"]);
  assert.deepEqual(receipt.$defs.proposal_ref.required, [
    "execution_id",
    "lane",
    "report_pointer",
    "report_sha256",
    "local_id",
    "source_content_sha256",
    "content_sha256",
  ]);

  for (const disposition of ["created", "matched"]) {
    assert.ok(
      byDisposition.get(disposition).required.includes("stable_finding_id"),
    );
  }
  for (const disposition of ["rejected", "blocked"]) {
    assert.ok(
      !byDisposition.get(disposition).required.includes("stable_finding_id"),
    );
  }

  assert.deepEqual(
    byDisposition.get("rejected").properties.reason_code.enum,
    [
      "unsupported-evidence",
      "tooling-or-environment-failure",
      "assumption-as-finding",
      "duplicate-of-named-stable-finding",
      "candidate-mismatch",
      "malformed-or-incomplete-proposal",
    ],
  );
  assert.deepEqual(
    byDisposition.get("blocked").properties.reason_code.enum,
    [
      "sensitive-manual-handling",
      "candidate-drift",
      "report-drift",
      "proposal-drift",
      "ledger-drift",
      "manual-semantic-review-required",
    ],
  );
  assert.ok(
    byDisposition.get("blocked").required.includes("unblock_condition"),
  );

  assertStrictObject(receipt.$defs.summary, [
    "inventoried",
    "created",
    "matched",
    "rejected",
    "blocked",
    "unresolved",
  ]);
  assert.deepEqual(
    receipt.$defs.persistence.properties.publication_state.enum,
    ["blocked-not-published", "pending-human-commit"],
  );
  for (const artifact of [
    "dispatch_manifest",
    "inventory",
    "receipt",
    "ledger",
  ]) {
    assert.ok(
      receipt.$defs.persistence.required.includes(`${artifact}_tracked`),
    );
    assert.ok(
      receipt.$defs.persistence.required.includes(
        `${artifact}_differs_from_head`,
      ),
    );
  }
  assert.equal(receipt.allOf.length, 2);
});

test("contract defines completeness, crash recovery, persistence, and compatibility", async () => {
  const [contract, ledger] = await Promise.all([
    repositoryFile("qa-suite/references/finding-reconciliation.md"),
    repositoryFile("qa-suite/references/finding-ledger.md"),
  ]);

  assert.match(
    contract,
    /qa-reconciliation\/<run-id>\/dispatch-manifest\.json/,
  );
  assert.match(
    contract,
    /qa-reconciliation\/<run-id>\/proposal-inventory\.json/,
  );
  assert.match(
    contract,
    /qa-reconciliation\/<run-id>\/reconciliation-receipt\.json/,
  );
  assert.match(
    contract,
    /schema-valid ledger without a\s+verified reconciliation receipt does not prove proposal completeness/,
  );
  assert.match(contract, /Lane agents remain blind to the complete ledger/);
  assert.match(contract, /Titles never establish identity/);
  assert.match(
    contract,
    /Uncertainty favors a separate finding over a\s+false merge/,
  );
  assert.match(contract, /exactly one decision for each inventoried proposal/);
  assert.match(
    contract,
    /complete selected-execution set.*disjoint union/s,
  );
  assert.match(contract, /source_content_sha256.*before any redaction/s);
  assert.match(contract, /Durable proposal projections omit lane-authored titles/);
  assert.match(contract, /Lane proposals cannot claim human-cleared sensitivity/);
  assert.match(contract, /Set-like arrays have one canonical order/);
  assert.match(contract, /Verification is linear.*O\(n\)/s);
  assert.match(contract, /transaction journal/);
  assert.match(contract, /It never rolls back or guesses/);
  assert.match(
    contract,
    /Ledger reconciled; persistence pending human commit/,
  );
  assert.match(contract, /durable-committed/);
  assert.match(contract, /all four exact artifacts in the same reachable commit/);
  assert.match(contract, /ledger schema\s+version 1 or 2/);
  assert.match(contract, /R1 defines and schema-lints the data contracts/);
  assert.match(contract, /R2 implements behavioral\s+validation/);
  assert.match(contract, /finding-reconciliation-decisions-v1\.schema\.json/);
  assert.match(contract, /canonical helper commands are `dispatch`, `inventory`,/);

  assert.match(
    ledger,
    /Machine-verifiable proposal completeness is defined by\s+`finding-reconciliation\.md`/,
  );
  assert.match(
    ledger,
    /valid candidate ledger\s+alone does not prove that every report-local proposal/,
  );
});
