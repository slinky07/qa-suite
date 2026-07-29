import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
]);

const requestedPort = Number(process.argv[2] ?? "4173");
if (
  !Number.isInteger(requestedPort) ||
  requestedPort < 0 ||
  requestedPort > 65535
) {
  throw new Error("Port must be an integer from 0 through 65535.");
}

const server = createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method ?? "")) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  const pathname = new URL(
    request.url ?? "/",
    "http://fixture.invalid",
  ).pathname;
  const asset = assets.get(pathname);
  if (!asset) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const [filename, contentType] = asset;
  const body = await readFile(new URL(filename, import.meta.url));
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; base-uri 'none'; connect-src 'none'; form-action 'self'; object-src 'none'",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : body);
});

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Recovery Console did not receive a TCP port.");
  }
  process.stdout.write(`${address.port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
