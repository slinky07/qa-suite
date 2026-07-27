import {
  SEVERITIES,
  validateNormalizedCase,
  validateOracle,
  validateOracleSet,
  validateSuite,
} from "./contracts.mjs";

function intersection(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function scoreFlowAssertions(assertions, flows) {
  const byId = new Map(flows.map((flow) => [flow.id, flow]));
  return assertions.map((assertion) => {
    const flow = byId.get(assertion.id);
    if (!flow) {
      return {
        effectiveness: "not_met",
        evidence: "not_met",
        id: assertion.id,
        state: "not_met",
        status: "not_met",
      };
    }
    const stateMet = assertion.allowed_states.includes(flow.state);
    const effectivenessMet = assertion.allowed_effectiveness.some(
      (value) => value === flow.effectiveness,
    );
    const evidenceMet = evidenceKindsMeet(
      flow.evidence,
      assertion.required_evidence_kinds,
    );
    return {
      effectiveness: effectivenessMet ? "met" : "not_met",
      evidence: evidenceMet ? "met" : "not_met",
      id: assertion.id,
      state: stateMet ? "met" : "not_met",
      status:
        stateMet && effectivenessMet && evidenceMet
          ? "met"
          : "not_met",
    };
  });
}

function evidenceKindsMeet(pointers, requiredKinds) {
  const kinds = new Set(pointers.map(({ kind }) => kind));
  return requiredKinds.every((kind) => kinds.has(kind));
}

function scoreSmokeDetection(oracle, result) {
  const expected = oracle.assertions.expected_defects[0];
  const matches = result.checklist.filter(
    (item) =>
      item.state === "Fail" &&
      expected.checklist_ids_any_of.includes(item.id),
  );
  const completeMatch = matches.some((item) =>
    evidenceKindsMeet(item.evidence, expected.required_evidence_kinds),
  );
  return {
    classification: "not_applicable_by_lane_contract",
    complete_match: completeMatch ? "met" : "not_met",
    evidence: completeMatch ? "met" : "not_met",
    signal_ids: matches.map(({ id }) => id).sort(),
    status: matches.length > 0 ? "matched" : "missed",
  };
}

function scoreSpecialistDetection(oracle, result) {
  const expected = oracle.assertions.expected_defects[0];
  const matches = result.findings.filter(
    (finding) =>
      finding.surface_id === expected.surface_id &&
      intersection(finding.criteria, expected.criteria_any_of).length > 0,
  );
  const classificationMet = (finding) =>
    expected.allowed_severities.includes(finding.severity) &&
    expected.allowed_priorities.includes(finding.priority);
  const evidenceMet = (finding) =>
    evidenceKindsMeet(finding.evidence, expected.required_evidence_kinds);
  const completeMatch = matches.some(
    (finding) => classificationMet(finding) && evidenceMet(finding),
  );
  return {
    classification: {
      priority: matches.some((finding) =>
        expected.allowed_priorities.includes(finding.priority),
      )
        ? "met"
        : "not_met",
      severity: matches.some((finding) =>
        expected.allowed_severities.includes(finding.severity),
      )
        ? "met"
        : "not_met",
    },
    complete_match: completeMatch ? "met" : "not_met",
    evidence: matches.some(evidenceMet) ? "met" : "not_met",
    finding_ids: matches.map(({ id }) => id).sort(),
    status: matches.length > 0 ? "matched" : "missed",
  };
}

function scoreDetection(oracle, result, lane) {
  if (oracle.role !== "adversarial") return null;
  return lane === "smoke-qa"
    ? scoreSmokeDetection(oracle, result)
    : scoreSpecialistDetection(oracle, result);
}

function findingIsInControlScope(finding, budget) {
  const surfaceMatches =
    budget.surface_ids.length === 0 ||
    budget.surface_ids.includes(finding.surface_id);
  const criterionMatches =
    budget.criteria_any_of.length === 0 ||
    intersection(finding.criteria, budget.criteria_any_of).length > 0;
  return surfaceMatches && criterionMatches;
}

function scoreControl(oracle, result, lane) {
  if (oracle.role !== "control") return null;
  const budget = oracle.assertions.control_budget;
  if (lane === "smoke-qa") {
    const failedChecks = result.checklist.filter(
      ({ state }) => state === "Fail",
    );
    return {
      budget_met: failedChecks.length <= budget.max_total,
      observation_count: 0,
      positive_count: failedChecks.length,
      positive_ids: failedChecks.map(({ id }) => id).sort(),
      positives_by_severity: "not_applicable_by_lane_contract",
    };
  }

  const findings = result.findings.filter((finding) =>
    findingIsInControlScope(finding, budget),
  );
  const countsBySeverity = Object.fromEntries(
    SEVERITIES.map((severity) => [
      severity,
      findings.filter((finding) => finding.severity === severity).length,
    ]),
  );
  const totalMet =
    budget.max_total === null || findings.length <= budget.max_total;
  const severitiesMet = SEVERITIES.every((severity) => {
    const limit = budget.max_by_severity[severity];
    return limit === null || countsBySeverity[severity] <= limit;
  });
  const surfaceScope = new Set(budget.surface_ids);
  const observationCount = result.observations.filter(
    (entry) =>
      surfaceScope.size === 0 || surfaceScope.has(entry.surface_id),
  ).length;
  return {
    budget_met: totalMet && severitiesMet,
    observation_count: observationCount,
    positive_count: findings.length,
    positive_ids: findings.map(({ id }) => id).sort(),
    positives_by_severity: countsBySeverity,
  };
}

function incompletePreview(suite, suiteCase, normalizedCase) {
  return {
    case_id: suiteCase.id,
    completion_status: "incomplete",
    confidentiality: "controller-secret",
    control: null,
    detection: null,
    flow_assertions: [],
    lane: suite.lane,
    preview_assertions: null,
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    source_completion_status: normalizedCase.completion_status,
    subject_commit: normalizedCase.subject_commit,
    verdict:
      normalizedCase.lane_result?.verdict.state ??
      normalizedCase.smoke_gate?.verdict.state ??
      null,
    verdict_assertion: null,
    verification_status: "unverified",
  };
}

export function previewCase({
  normalizedCase,
  oracle,
  suite,
  suiteCase,
}) {
  validateSuite(suite);
  validateOracle(oracle, suite, suiteCase);
  validateNormalizedCase(normalizedCase, suite);
  if (normalizedCase.case_id !== suiteCase.id) {
    throw new Error("normalized case does not match suiteCase");
  }
  if (normalizedCase.completion_status !== "completed") {
    return incompletePreview(suite, suiteCase, normalizedCase);
  }

  const result = normalizedCase.lane_result;
  const verdictMet = oracle.assertions.allowed_verdicts.includes(
    result.verdict.state,
  );
  const flowAssertions = scoreFlowAssertions(
    oracle.assertions.flows,
    result.flows,
  );
  const detection = scoreDetection(oracle, result, suite.lane);
  const control = scoreControl(oracle, result, suite.lane);
  const assertionsMet =
    verdictMet &&
    flowAssertions.every(({ status }) => status === "met") &&
    (detection === null || detection.complete_match === "met") &&
    (control === null || control.budget_met);

  return {
    case_id: suiteCase.id,
    completion_status: "complete",
    confidentiality: "controller-secret",
    control,
    detection,
    flow_assertions: flowAssertions,
    lane: suite.lane,
    preview_assertions: assertionsMet ? "met" : "not_met",
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    source_completion_status: normalizedCase.completion_status,
    subject_commit: normalizedCase.subject_commit,
    verdict: result.verdict.state,
    verdict_assertion: verdictMet ? "met" : "not_met",
    verification_status: "unverified",
  };
}

function previewPair(entries) {
  if (entries.length !== 2) {
    throw new Error("oracle pair must contain exactly two cases");
  }
  const adversarialEntry = entries.find(
    ({ oracle }) => oracle.role === "adversarial",
  );
  const controlEntry = entries.find(
    ({ oracle }) => oracle.role === "control",
  );
  if (!adversarialEntry || !controlEntry) {
    throw new Error("oracle pair must contain one adversarial and one control");
  }
  const adversarial = adversarialEntry.preview;
  const control = controlEntry.preview;
  if (
    adversarial.lane !== control.lane ||
    adversarial.subject_commit !== control.subject_commit
  ) {
    throw new Error("oracle pair mixes lanes or subject commits");
  }
  if (
    adversarial.completion_status !== "complete" ||
    control.completion_status !== "complete"
  ) {
    return {
      adversarial_case: adversarial.case_id,
      completion_status: "incomplete",
      confidentiality: "controller-secret",
      control_budget_met: null,
      control_case: control.case_id,
      control_observations: null,
      control_positives: null,
      detection: null,
      finding_precision: null,
      preview_assertions: null,
      qualification: "not-evidence",
      result: null,
      schema_version: 1,
      verification_status: "unverified",
    };
  }

  const truePositives =
    adversarial.detection?.status === "matched" ? 1 : 0;
  const expected = adversarial.detection === null ? 0 : 1;
  const falsePositives = control.control.positive_count;
  const precisionDenominator = truePositives + falsePositives;
  const assertionsMet =
    adversarial.preview_assertions === "met" &&
    control.preview_assertions === "met";
  return {
    adversarial_case: adversarial.case_id,
    completion_status: "complete",
    confidentiality: "controller-secret",
    control_budget_met: control.control.budget_met,
    control_case: control.case_id,
    control_observations: control.control.observation_count,
    control_positives: falsePositives,
    detection: {
      denominator: expected,
      numerator: truePositives,
    },
    finding_precision:
      precisionDenominator === 0
        ? null
        : {
            denominator: precisionDenominator,
            numerator: truePositives,
          },
    preview_assertions: assertionsMet ? "met" : "not_met",
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    verification_status: "unverified",
  };
}

function previewPairs(cases, oracles) {
  const previewByCase = new Map(cases.map((entry) => [entry.case_id, entry]));
  const pairs = new Map();
  for (const oracle of oracles) {
    const values = pairs.get(oracle.pair_id) ?? [];
    values.push({
      oracle,
      preview: previewByCase.get(oracle.case_id),
    });
    pairs.set(oracle.pair_id, values);
  }
  return [...pairs]
    .map(([, entries]) => previewPair(entries))
    .sort((left, right) =>
      left.adversarial_case.localeCompare(right.adversarial_case),
    );
}

function sumRatio(pairs, field) {
  const ratios = pairs
    .map((pair) => pair[field])
    .filter((value) => value !== null);
  const denominator = ratios.reduce(
    (total, value) => total + value.denominator,
    0,
  );
  if (denominator === 0) return null;
  return {
    denominator,
    numerator: ratios.reduce(
      (total, value) => total + value.numerator,
      0,
    ),
  };
}

function aggregatePreviews(cases, pairs) {
  const completePairs = pairs.filter(
    ({ completion_status }) => completion_status === "complete",
  );
  return {
    confidentiality: "controller-secret",
    complete_cases: cases.filter(
      ({ completion_status }) => completion_status === "complete",
    ).length,
    complete_pairs: completePairs.length,
    control_budget_met_rate:
      completePairs.length === 0
        ? null
        : {
            denominator: completePairs.length,
            numerator: completePairs.filter(
              ({ control_budget_met }) => control_budget_met,
            ).length,
          },
    control_observations: completePairs.reduce(
      (total, pair) => total + pair.control_observations,
      0,
    ),
    control_positives: completePairs.reduce(
      (total, pair) => total + pair.control_positives,
      0,
    ),
    detection: sumRatio(completePairs, "detection"),
    finding_precision: sumRatio(completePairs, "finding_precision"),
    incomplete_cases: cases
      .filter(({ completion_status }) => completion_status === "incomplete")
      .map(({ case_id }) => case_id)
      .sort(),
    planned_cases: cases.length,
    planned_pairs: pairs.length,
    qualification: "not-evidence",
    result: null,
    verification_status: "unverified",
  };
}

export function previewSuite({ normalizedCases, oracles, suite }) {
  validateSuite(suite);
  validateOracleSet(oracles, suite);
  if (!Array.isArray(normalizedCases)) {
    throw new Error("normalizedCases must be an array");
  }
  if (normalizedCases.length !== suite.cases.length) {
    throw new Error("normalizedCases must contain every suite case exactly once");
  }
  const normalizedById = new Map();
  for (const normalizedCase of normalizedCases) {
    validateNormalizedCase(normalizedCase, suite);
    if (normalizedById.has(normalizedCase.case_id)) {
      throw new Error(
        `normalizedCases contains duplicate case ${normalizedCase.case_id}`,
      );
    }
    normalizedById.set(normalizedCase.case_id, normalizedCase);
  }
  const oracleById = new Map(oracles.map((oracle) => [oracle.case_id, oracle]));
  const cases = suite.cases.map((suiteCase) => {
    const normalizedCase = normalizedById.get(suiteCase.id);
    if (!normalizedCase) {
      throw new Error(`normalizedCases is missing ${suiteCase.id}`);
    }
    return previewCase({
      normalizedCase,
      oracle: oracleById.get(suiteCase.id),
      suite,
      suiteCase,
    });
  });
  cases.sort((left, right) => left.case_id.localeCompare(right.case_id));
  const pairs = previewPairs(cases, oracles);
  const aggregate = aggregatePreviews(cases, pairs);
  const completionStatus =
    aggregate.incomplete_cases.length === 0 ? "complete" : "incomplete";
  return {
    aggregate,
    cases,
    completion_status: completionStatus,
    confidentiality: "controller-secret",
    pairs,
    preview_assertions:
      completionStatus === "complete"
        ? pairs.every(({ preview_assertions }) => preview_assertions === "met")
          ? "met"
          : "not_met"
        : null,
    qualification: "not-evidence",
    result: null,
    schema_version: 1,
    suite_id: suite.id,
    verification_status: "unverified",
  };
}
