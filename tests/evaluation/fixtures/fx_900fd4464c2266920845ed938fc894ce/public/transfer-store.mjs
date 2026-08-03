import { createHash } from "node:crypto";

const recoverInterruptedWrite = false;
const expectedTotal = 100;
const transferAmount = 10;

function freshRecords() {
  return [
    { balance: 70, id: "reserve" },
    { balance: 30, id: "settlement" },
  ];
}

function findRecord(records, id) {
  const record = records.find((candidate) => candidate.id === id);
  if (record === undefined) throw new Error(`missing record ${id}`);
  return record;
}

export function stateProof(records) {
  const canonicalRecords = [...records]
    .sort(({ id: left }, { id: right }) => left.localeCompare(right))
    .map(({ balance, id }) => ({ balance, id }));
  const total = canonicalRecords.reduce(
    (sum, { balance }) => sum + balance,
    0,
  );
  return {
    digest_sha256: createHash("sha256")
      .update(JSON.stringify(canonicalRecords))
      .digest("hex"),
    invariant: {
      actual: total,
      expected: expectedTotal,
      holds: total === expectedTotal,
    },
    record_count: canonicalRecords.length,
    records: canonicalRecords,
  };
}

function applyDebit(records) {
  findRecord(records, "reserve").balance -= transferAmount;
}

function applyCredit(records) {
  findRecord(records, "settlement").balance += transferAmount;
}

function completedStateProof() {
  const records = freshRecords();
  applyDebit(records);
  applyCredit(records);
  return stateProof(records);
}

export function runAcknowledgedTransfer({ interruptAfterDebit = false } = {}) {
  const records = freshRecords();
  const before = stateProof(records);
  applyDebit(records);

  let interruptionPoint = null;
  if (interruptAfterDebit) {
    interruptionPoint = "after-debit-before-credit";
    if (recoverInterruptedWrite) applyCredit(records);
  } else {
    applyCredit(records);
  }

  const after = stateProof(records);
  const expected = completedStateProof();
  return {
    acknowledged: true,
    after,
    before,
    interruption_point: interruptionPoint,
    state_matches_acknowledged_write:
      after.record_count === expected.record_count &&
      after.digest_sha256 === expected.digest_sha256 &&
      after.invariant.holds,
    expected,
  };
}
