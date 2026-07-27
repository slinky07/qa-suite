#!/usr/bin/env node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertVersionContract,
  buildArtifacts,
  compareBuilds,
  copyGeneratedFiles,
  verifyArtifactSet,
} from "./lib.mjs";

function parseArguments(argv) {
  const options = { ref: "HEAD" };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--ref" || argument === "--output" || argument === "--tag") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a value`);
      }
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const versionContract = assertVersionContract(options.ref, options.tag);
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "qa-suite-release-builds-"),
  );
  const firstBuild = join(temporaryDirectory, "first");
  const secondBuild = join(temporaryDirectory, "second");

  try {
    await buildArtifacts(options.ref, firstBuild);
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    await buildArtifacts(options.ref, secondBuild);
    const verifiedBuild = await verifyArtifactSet(options.ref, firstBuild);
    await verifyArtifactSet(options.ref, secondBuild);
    await compareBuilds(firstBuild, secondBuild);

    if (options.output) {
      await copyGeneratedFiles(firstBuild, options.output);
    }

    console.log("Release integrity check passed");
    console.log(`Version: ${versionContract.version}`);
    console.log(`Commit: ${versionContract.commit}`);
    console.log(`SHA-256: ${verifiedBuild.digest}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
