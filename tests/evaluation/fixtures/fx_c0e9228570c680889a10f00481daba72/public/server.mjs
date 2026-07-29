import { createServer } from "node:http";

const serviceTimeMs = 100;
const endpointPayloads = new Map([
  ["/api/alerts", { alerts: [] }],
  ["/api/platform", { platform: "4" }],
  ["/api/route", { route: "Harbour" }],
  ["/api/weather", { condition: "clear" }],
]);

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

const server = createServer((request, response) => {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }
  if (request.url === "/health") {
    sendJson(response, 200, { status: "ready" });
    return;
  }
  const payload = endpointPayloads.get(request.url);
  if (payload === undefined) {
    sendJson(response, 404, { error: "not found" });
    return;
  }
  setTimeout(() => {
    sendJson(response, 200, {
      ...payload,
      service_time_ms: serviceTimeMs,
    });
  }, serviceTimeMs);
});

function stopServer() {
  server.close(() => process.exit(0));
}

const requestedPort = Number(process.argv[2] ?? "4173");
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
  throw new Error("port must be an integer from 0 through 65535");
}

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server did not expose a numeric port");
  }
  process.stdout.write(`${address.port}\n`);
});
process.once("SIGINT", stopServer);
process.once("SIGTERM", stopServer);
