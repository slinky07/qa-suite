import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dispatchMode = "concurrent";
export const endpointPaths = Object.freeze([
  "/api/route",
  "/api/weather",
  "/api/platform",
  "/api/alerts",
]);

async function requestEndpoint(origin, endpointPath, request) {
  const response = await request(new URL(endpointPath, origin));
  if (!response.ok) {
    throw new Error(`${endpointPath} returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!Number.isFinite(payload.service_time_ms)) {
    throw new Error(`${endpointPath} omitted service_time_ms`);
  }
  return {
    endpoint: endpointPath,
    payload,
    serviceTimeMs: payload.service_time_ms,
  };
}

async function dispatchSequentially(origin, request) {
  const results = [];
  for (const endpointPath of endpointPaths) {
    results.push(await requestEndpoint(origin, endpointPath, request));
  }
  return results;
}

function dispatchConcurrently(origin, request) {
  return Promise.all(
    endpointPaths.map((endpointPath) =>
      requestEndpoint(origin, endpointPath, request)
    ),
  );
}

export async function buildJourneyBrief(origin, { request = fetch } = {}) {
  const startedAt = performance.now();
  const results = dispatchMode === "sequential"
    ? await dispatchSequentially(origin, request)
    : await dispatchConcurrently(origin, request);
  const serviceTimes = results.map(({ serviceTimeMs }) => serviceTimeMs);
  return {
    critical_path_ms: dispatchMode === "sequential"
      ? serviceTimes.reduce((total, value) => total + value, 0)
      : Math.max(...serviceTimes),
    elapsed_ms: performance.now() - startedAt,
    endpoint_service_times_ms: serviceTimes,
    values: Object.fromEntries(
      results.map(({ endpoint, payload }) => [endpoint, payload]),
    ),
  };
}

async function runFromCommandLine() {
  const origin = process.argv[2];
  if (origin === undefined) {
    throw new Error("usage: node workflow.mjs <loopback-origin>");
  }
  process.stdout.write(`${JSON.stringify(await buildJourneyBrief(origin))}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runFromCommandLine().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
