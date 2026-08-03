import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const resumesAfterRestoration = true;
const retryLimit = 2;
const dependencyRestoredAtMs = 50;
const recoveryObjectiveMs = 100;

export function runHealthyOperation() {
  return {
    alert_state: "clear",
    dependency_state: "available",
    dispatch_summary_available: true,
    service_state: "ready",
  };
}

export function runDependencyRecoveryScenario() {
  const timeline = [
    {
      alert_state: "clear",
      at_ms: 0,
      dependency_state: "available",
      dispatch_summary_available: true,
      event: "healthy-operation",
      service_state: "ready",
    },
    {
      alert_state: "firing",
      at_ms: 10,
      dependency_state: "unavailable",
      dispatch_summary_available: false,
      event: "dependency-unavailable",
      service_state: "degraded",
    },
    {
      alert_state: "firing",
      at_ms: 20,
      dependency_state: "unavailable",
      dispatch_summary_available: false,
      event: "retry-attempt-1",
      service_state: "degraded",
    },
    {
      alert_state: "firing",
      at_ms: 40,
      dependency_state: "unavailable",
      dispatch_summary_available: false,
      event: "retry-attempt-2",
      service_state: "degraded",
    },
    {
      alert_state: "firing",
      at_ms: dependencyRestoredAtMs,
      dependency_state: "available",
      dispatch_summary_available: false,
      event: "dependency-restored",
      service_state: "degraded",
    },
  ];

  if (resumesAfterRestoration) {
    timeline.push({
      alert_state: "resolved",
      at_ms: 70,
      dependency_state: "available",
      dispatch_summary_available: true,
      event: "service-recovered",
      service_state: "ready",
    });
  } else {
    timeline.push(
      {
        alert_state: "firing",
        at_ms: 70,
        dependency_state: "available",
        dispatch_summary_available: false,
        event: "recovery-probe-1",
        service_state: "degraded",
      },
      {
        alert_state: "firing",
        at_ms: 160,
        dependency_state: "available",
        dispatch_summary_available: false,
        event: "recovery-probe-2",
        service_state: "degraded",
      },
    );
  }

  const final = timeline.at(-1);
  const recoveryAtMs = final.dispatch_summary_available ? final.at_ms : null;
  const elapsedAfterRestorationMs = recoveryAtMs === null
    ? final.at_ms - dependencyRestoredAtMs
    : recoveryAtMs - dependencyRestoredAtMs;
  return {
    alert_state: final.alert_state,
    dependency_restored_at_ms: dependencyRestoredAtMs,
    dispatch_summary_available: final.dispatch_summary_available,
    elapsed_after_restoration_ms: elapsedAfterRestorationMs,
    recovery_at_ms: recoveryAtMs,
    recovery_objective_met:
      final.dispatch_summary_available &&
      elapsedAfterRestorationMs <= recoveryObjectiveMs,
    recovery_objective_ms: recoveryObjectiveMs,
    retries: retryLimit,
    retry_limit: retryLimit,
    service_state: final.service_state,
    timeline,
  };
}

function resultFor(command) {
  if (command === "healthy") return runHealthyOperation();
  if (command === "recovery") return runDependencyRecoveryScenario();
  throw new Error("usage: node recovery-scenario.mjs <healthy|recovery>");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.stdout.write(`${JSON.stringify(resultFor(process.argv[2]))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
