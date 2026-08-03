import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runAcknowledgedTransfer } from "./transfer-store.mjs";

function resultFor(command) {
  if (command === "normal") return runAcknowledgedTransfer();
  if (command === "interrupted") {
    return runAcknowledgedTransfer({ interruptAfterDebit: true });
  }
  throw new Error("usage: node probe.mjs <normal|interrupted>");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const result = resultFor(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.state_matches_acknowledged_write) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
