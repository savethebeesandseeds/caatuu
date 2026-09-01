#!/usr/bin/env node

import {
  DEFAULT_CONCEPTS_PATH,
  DEFAULT_REALIZATIONS_PATH,
  LanguageContentError,
  loadAndValidateLanguageContent
} from "./lib/content-contract.mjs";

function usage() {
  return `Usage: node tools/language-content/validate.mjs [options]

Options:
  --concepts <path>       English concept catalog (default: ${DEFAULT_CONCEPTS_PATH})
  --realizations <path>   Target realization catalog (default: ${DEFAULT_REALIZATIONS_PATH})
  --repo-root <path>      Repository root (defaults to this checkout)
  --release               Enforce licensing gates for distributable packages
  --require-native-review Enforce native review for course activation/pronunciation
  --help                  Show this help

Pending native review remains recorded and withholds approved pronunciation,
but it does not block APK publication. Licensing marked release-review-required
is accepted only without --release. No action writes files.`;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
    } else if (argument === "--release") {
      options.release = true;
    } else if (argument === "--require-native-review") {
      options.requireNativeReview = true;
    } else if (argument === "--concepts") {
      options.conceptsPath = argv[++index];
      if (!options.conceptsPath) throw new Error("--concepts requires a path.");
    } else if (argument === "--realizations") {
      options.realizationsPath = argv[++index];
      if (!options.realizationsPath) throw new Error("--realizations requires a path.");
    } else if (argument === "--repo-root") {
      options.repoRoot = argv[++index];
      if (!options.repoRoot) throw new Error("--repo-root requires a path.");
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.requireNativeReview && !options.release) {
    throw new Error("--require-native-review must be combined with --release for activation readiness.");
  }

  const loaded = await loadAndValidateLanguageContent(options);
  const mode = options.requireNativeReview
    ? "native-review-required activation"
    : options.release
      ? "distributable package"
      : "development";
  console.log(
    `Validated ${loaded.concepts.concepts.length} English concepts and `
    + `${loaded.realizations.realizations.length} target realizations for ${mode}.`
  );
}

main().catch((error) => {
  console.error(error instanceof LanguageContentError ? error.message : error.stack ?? error.message);
  process.exitCode = 1;
});
