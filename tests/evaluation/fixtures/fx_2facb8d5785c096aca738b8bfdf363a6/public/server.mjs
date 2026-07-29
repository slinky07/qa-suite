import { createServer } from "node:http";

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Status Board</title>
  </head>
  <body>
    <main><h1>Status Board</h1><p>All systems ready.</p></main>
  </body>
</html>
`;

const securityHeaders = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function send(response, status, body, contentType) {
  response.writeHead(status, {
    ...securityHeaders,
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": contentType,
  });
  response.end(body);
}

const server = createServer((request, response) => {
  if (request.method !== "GET") {
    send(response, 405, "method not allowed\n", "text/plain; charset=utf-8");
    return;
  }
  if (request.url === "/") {
    send(response, 200, page, "text/html; charset=utf-8");
    return;
  }
  if (request.url === "/health") {
    send(
      response,
      200,
      '{"status":"ready"}\n',
      "application/json; charset=utf-8",
    );
    return;
  }
  send(response, 404, "not found\n", "text/plain; charset=utf-8");
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
