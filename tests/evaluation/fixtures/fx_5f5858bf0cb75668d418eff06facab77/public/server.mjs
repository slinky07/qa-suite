import { createServer } from "node:http";

const reuseDeliveryOnRetry = true;
const deliveries = [];
const deliveryByRequest = new Map();
const requestedPort = Number(process.argv[2] ?? "4311");

if (
  !Number.isInteger(requestedPort) ||
  requestedPort < 0 ||
  requestedPort > 65535
) {
  throw new Error("Port must be an integer from 0 through 65535.");
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let source = "";
  for await (const chunk of request) {
    source += chunk;
    if (Buffer.byteLength(source, "utf8") > 8_192) {
      throw new Error("Request body is too large.");
    }
  }
  return JSON.parse(source);
}

const server = createServer(async (request, response) => {
  const pathname = new URL(
    request.url ?? "/",
    "http://fixture.invalid",
  ).pathname;

  if (request.method === "GET" && pathname === "/api/deliveries") {
    sendJson(response, 200, { deliveries });
    return;
  }

  if (request.method === "POST" && pathname === "/api/deliveries") {
    try {
      const idempotencyKey = request.headers["idempotency-key"];
      const body = await readJson(request);
      if (
        typeof idempotencyKey !== "string" ||
        idempotencyKey.length === 0 ||
        typeof body.recipient !== "string" ||
        body.recipient.length === 0
      ) {
        sendJson(response, 400, { error: "Invalid delivery request." });
        return;
      }

      const requestKey = `${idempotencyKey}\u0000${body.recipient}`;
      const existingDelivery = deliveryByRequest.get(requestKey);
      if (existingDelivery && reuseDeliveryOnRetry) {
        sendJson(response, 200, { delivery: existingDelivery });
        return;
      }

      const delivery = {
        id: `delivery-${String(deliveries.length + 1).padStart(2, "0")}`,
        recipient: body.recipient,
        state: "queued",
      };
      deliveries.push(delivery);
      deliveryByRequest.set(requestKey, delivery);
      sendJson(response, existingDelivery ? 200 : 201, { delivery });
    } catch {
      sendJson(response, 400, { error: "Invalid JSON request." });
    }
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Delivery Queue API did not receive a TCP port.");
  }
  process.stdout.write(`${address.port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
