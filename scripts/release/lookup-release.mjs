#!/usr/bin/env node

import {
  assertReleaseTag,
  assertRepository,
  fetchReleaseByTag,
} from "./lib.mjs";

function parseArguments(argv) {
  const options = {
    allowMissing: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-missing") {
      options.allowMissing = true;
      continue;
    }
    if (argument === "--repo" || argument === "--tag") {
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

  if (!options.repo) {
    throw new Error("--repo is required");
  }
  if (!options.tag) {
    throw new Error("--tag is required");
  }

  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  assertRepository(options.repo);
  assertReleaseTag(options.tag);
  const release = fetchReleaseByTag(options.repo, options.tag, {
    allowMissing: options.allowMissing,
  });
  console.log(JSON.stringify(release));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
