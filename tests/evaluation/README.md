# Lane evaluation contracts

This directory documents the maintainer meta-testing contracts for Issue #30.
It is not an eighth QA lane, does not ship in the QA-Suite archives, and does
not change the behavior of any distributed lane.

The machine authority for the data contracts is
`scripts/evaluation/contracts.mjs`;
`scripts/evaluation/scoring.mjs` owns the explicitly non-qualifying preview
math. This README explains the trust boundary and intended delivery sequence;
it is not a second schema. The foundation is contracts-only. It exposes no
runnable evaluator or qualifying runner, and no output from this PR can be
treated as a passing evaluation.

Pure scoring functions may produce a deterministic preview for contract tests.
Every such preview must remain explicitly non-qualifying:

```json
{
  "verification_status": "unverified",
  "qualification": "not-evidence",
  "result": null
}
```

Preview objects are also marked `confidentiality: "controller-secret"`.
Detection and control shapes can imply sealed roles even though raw oracle
tokens are omitted, so previews never become lane or adapter input.

The preview can reveal schema or arithmetic defects. It cannot establish that
a lane saw the intended candidate, ran in isolation, produced the normalized
claims, or detected a practical defect.

## Question under test

The completed Issue #30 system will answer:

> Can an unchanged QA lane detect a known practical defect without being told
> the expected result, while staying within the paired control's false-positive
> budget?

This foundation defines the data and scoring contracts needed to answer that
question later. It does not answer it yet.

## Authority and trust boundary

The evaluation uses two controller inputs with different disclosure rules:

- The **public suite** contains routing-safe case metadata. It can identify the
  lane, neutral QA context, public fixture manifest, opaque case IDs, and
  unique per-case oracle commitments. It contains no role, pair identity,
  expected defect, expected classification, or control budget.
- The **sealed oracle** assigns the opaque tokens to adversarial/control roles,
  pair identity, expected defects, classification bands, flow expectations,
  and the control budget. It is controller-only input and must never be
  dispatched to a lane or its adapter.

Omitting oracle text from a prompt is not isolation. A qualifying evaluation
will also need a standalone lane root that cannot read the controller checkout,
Git object database, oracle files, prior reports, inherited development
conversation, secret environment, or non-loopback network.

The future runner must preserve this order:

1. Freeze the controller commit and QA-Suite subject commit.
2. Read the public suite and select one opaque case.
3. Export only that case's declared public fixture bytes and the exact subject
   `qa-suite/` tree into a fresh, isolated root.
4. Dispatch smoke in a fresh context.
5. Stop if smoke gates the deeper lane; otherwise dispatch the selected lane in
   a second fresh context with empty report history.
6. Close and hash every dispatch, report, evidence file, fixture byte, and
   subject byte.
7. Run the lane-specific adapter without oracle access.
8. Open the sealed oracle only inside the controller and score the closed,
  measured evidence.

Until that runner exists and verifies each step, all scoring is unverified and
not evidence.

“Public” distinguishes this suite from the sealed oracle; it does not mean the
whole suite is a lane prompt. A future runner may dispatch only a neutral
single-case envelope. Oracle commitments, other cases, and controller paths
remain controller-side and must not enter lane or adapter input.

## Public suite

Serialized inputs must pass `parseContractJson` before validation so duplicate
JSON keys fail closed. Unknown fields, unsafe paths, duplicate case IDs, and
invalid opaque identifiers also fail under the machine contract. A valid suite
contains complete adversarial/control capacity without revealing which case
has which role. This illustrative pair contains two cases; placeholder hashes
and tokens retain the contract's full required shape:

```json
{
  "schema_version": 1,
  "id": "bob-evaluation-v1",
  "lane": "bob-qa",
  "cases": [
    {
      "id": "fx_0123456789abcdef0123456789abcdef",
      "qa_context": "tests/evaluation/fixtures/fx_0123456789abcdef0123456789abcdef/qa-context.md",
      "fixture_manifest": "tests/evaluation/fixtures/fx_0123456789abcdef0123456789abcdef/fixture-manifest.json",
      "oracle_commitments": [
        "seal_1111111111111111111111111111111111111111111111111111111111111111",
        "seal_3333333333333333333333333333333333333333333333333333333333333333"
      ],
      "smoke_checks": ["check_primary"]
    },
    {
      "id": "fx_fedcba9876543210fedcba9876543210",
      "qa_context": "tests/evaluation/fixtures/fx_fedcba9876543210fedcba9876543210/qa-context.md",
      "fixture_manifest": "tests/evaluation/fixtures/fx_fedcba9876543210fedcba9876543210/fixture-manifest.json",
      "oracle_commitments": [
        "seal_4444444444444444444444444444444444444444444444444444444444444444",
        "seal_5555555555555555555555555555555555555555555555555555555555555555"
      ],
      "smoke_checks": ["check_primary"]
    }
  ]
}
```

Every public commitment is globally unique. The sealed oracle assigns each
case's commitments to its canary and expected-defect or budget ID. Pair
identity exists only in the sealed oracle, so comparing public cases cannot
reveal which fixtures form a pair.

Each referenced manifest lists only the exact neutral QA context and public
regular files. Paths are ordered and unique; modes are `100644` or `100755`;
every file has a SHA-256 declaration. For example:

```json
{
  "schema_version": 1,
  "case_id": "fx_0123456789abcdef0123456789abcdef",
  "files": [
    {
      "path": "tests/evaluation/fixtures/fx_0123456789abcdef0123456789abcdef/public/run.sh",
      "mode": "100755",
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    {
      "path": "tests/evaluation/fixtures/fx_0123456789abcdef0123456789abcdef/qa-context.md",
      "mode": "100644",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ]
}
```

The pure helper can derive a deterministic identity for this declaration, but
that identity is not proof of fixture bytes. Exact measurement of exported
fixture bytes and the QA-Suite subject tree used by the lane is deferred to
the isolated runner.

## Sealed oracle

Schema version 1 permits one known practical defect in an adversarial case and
no expected defect in its paired control. The following abbreviated objects
show one complete pair; `contracts.mjs` remains authoritative for exact keys
and validation:

```json
[
  {
    "schema_version": 1,
    "case_id": "fx_0123456789abcdef0123456789abcdef",
    "pair_id": "seal_2222222222222222222222222222222222222222222222222222222222222222",
    "role": "adversarial",
    "canary_token": "seal_1111111111111111111111111111111111111111111111111111111111111111",
    "assertions": {
      "allowed_verdicts": ["Go with findings"],
      "expected_defects": [
        {
          "id": "seal_3333333333333333333333333333333333333333333333333333333333333333",
          "surface_id": "surface_configuration",
          "criteria_any_of": ["IA-01", "IA-06", "H8"],
          "allowed_severities": ["S3", "S4"],
          "allowed_priorities": ["P1", "P2"],
          "required_evidence_kinds": ["screenshot"]
        }
      ],
      "flows": [],
      "control_budget": null
    }
  },
  {
    "schema_version": 1,
    "case_id": "fx_fedcba9876543210fedcba9876543210",
    "pair_id": "seal_2222222222222222222222222222222222222222222222222222222222222222",
    "role": "control",
    "canary_token": "seal_4444444444444444444444444444444444444444444444444444444444444444",
    "assertions": {
      "allowed_verdicts": ["Go", "Go with findings"],
      "expected_defects": [],
      "control_budget": {
        "id": "seal_5555555555555555555555555555555555555555555555555555555555555555",
        "surface_ids": ["surface_configuration"],
        "criteria_any_of": ["IA-01", "IA-06", "H8"],
        "max_total": null,
        "max_by_severity": {
          "S1": 0,
          "S2": 0,
          "S3": 0,
          "S4": null
        },
        "observations": "record-only"
      },
      "flows": []
    }
  }
]
```

The control budget is independent of statistical precision. `null` means an
unbounded count; it is not risk acceptance and does not remove a finding from
the canonical verdict. For example, an allowed Bob S4 control finding can stay
within budget while still reducing finding precision. Severity-free
observations are recorded separately and never enter verdict, detection, or
precision arithmetic.

## Smoke gating and incomplete coverage

Smoke always runs first. Its canonical outcome controls whether a deeper lane
may run:

- `Go` permits the deeper lane dispatch only after every smoke check declared
  by the public case is present exactly once and passed.
- `No-Go` gates the deeper lane only when the closed smoke evidence contains
  the structured failed-check signal required by the smoke contract.
- `Blocked` gates the deeper lane because environment or tooling prevented
  exercising scope. It is incomplete coverage, not a defect detection.

A gated observation must not fabricate a deeper-lane dispatch, report,
candidate measurement, finding, or denominator. `Blocked` contributes neither
a detection success nor a detection miss. `No-Go` by itself is also
insufficient evidence: the future adapter and runner must bind it to the
structured failed check and its closed evidence.

## Canonical verdict consistency

Evaluation consumes the existing QA-Suite verdict contract; it does not define
a competing one:

- any confirmed S1/S2 finding, or a demonstrably failed core flow, requires
  `No-Go`;
- only S3/S4 findings require `Go with findings`, including canonical counts;
- no findings requires `Go`;
- `Blocked` is reserved for an environment or tooling blocker and is never
  derived from missing coverage alone; and
- Priority controls scheduling, not the verdict.

A normalized claim that contradicts the closed report or this mapping is
invalid. A blocked core flow requires the lane's `Blocked` verdict and
incomplete coverage unless stronger evidence requires `No-Go`. `Observed only`
remains a coverage qualifier and cannot be promoted to a pass or an effective
flow. A scored `Pass`, `Fail`, or `Blocked` flow requires evidence, and each
oracle flow assertion names the evidence kinds it accepts.

## Pure scoring preview

Detection and classification are separate assertions:

```text
detected =
  finding.surface_id == expected.surface_id
  AND finding.criteria intersects expected.criteria_any_of

classified =
  the same finding satisfies allowed Severity and Priority
  AND carries every required evidence kind
```

One finding must satisfy the complete assertion; fields cannot be assembled
from multiple findings. For a complete adversarial/control pair, pure scoring
may preview:

```text
detection = matched expected defects / expected defects
finding precision = matched expected defects /
                    (matched expected defects + scoped control findings)
control budget = independent comparison with max_total and Severity limits
```

Budget scope controls only false-positive accounting. It never narrows the
canonical verdict: an out-of-scope S3/S4 finding still requires
`Go with findings`, even though it does not consume the scoped control budget.

Zero denominators remain `null`. Aggregate ratios use summed counts instead of
averaging percentages. Regardless of the arithmetic, foundation output retains
`verification_status: "unverified"`, `qualification: "not-evidence"`, and
`result: null`.

## Deferred Issue #30 delivery

The following are deliberately outside this contracts-only PR:

- real adversarial/control fixture applications and their public inventories;
- the isolated runner and closed-root file inventory;
- exact fixture-byte and subject-tree measurement;
- lane-specific adapters that parse canonical report tables by stable finding
  ID without using oracle prose;
- baseline runs and retained baseline evidence;
- remediation, before/after comparison, and retained remediation evidence; and
- CI scheduling for recurring or release-gated evaluation.

Those capabilities must land through later Issue #30 branches and PRs. Until
they do, contract tests and scoring previews are maintainer verification aids,
not QA findings, release certification, issue proposals, or proof that a lane
passes its evaluation.
