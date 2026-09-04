#!/usr/bin/env node

import {
  DEFAULT_CONCEPTS_PATH,
  DEFAULT_REALIZATIONS_PATH,
  LanguageContentError,
  loadAndValidateLanguageContent
} from "./lib/content-contract.mjs";
import {
  DEFAULT_LANGUAGE_CATALOG_PATH,
  loadCatalogLanguageContentCourses
} from "./lib/course-content-catalog.mjs";
import { loadAndPrepareLanguageRoleContent } from "./lib/language-role-contract.mjs";

function usage() {
  return `Usage: node tools/language-content/validate.mjs [options]

Options:
  --all                   Validate every catalog course using language-content-v1
  --course <id>           Validate one catalog course using language-content-v1
  --catalog <path>        Course catalog (default: ${DEFAULT_LANGUAGE_CATALOG_PATH})
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
  const options = {
    all: false,
    catalogPath: DEFAULT_LANGUAGE_CATALOG_PATH,
    courseId: null,
    explicitCatalog: false,
    explicitContentPair: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
    } else if (argument === "--all") {
      if (options.courseId) throw new Error("--all cannot be combined with --course.");
      options.all = true;
    } else if (argument === "--course") {
      if (options.all) throw new Error("--course cannot be combined with --all.");
      if (options.courseId) throw new Error("--course may be provided only once.");
      options.courseId = argv[++index];
      if (!options.courseId) throw new Error("--course requires an id.");
    } else if (argument === "--catalog") {
      options.catalogPath = argv[++index];
      if (!options.catalogPath) throw new Error("--catalog requires a path.");
      options.explicitCatalog = true;
    } else if (argument === "--release") {
      options.release = true;
    } else if (argument === "--require-native-review") {
      options.requireNativeReview = true;
    } else if (argument === "--concepts") {
      options.conceptsPath = argv[++index];
      if (!options.conceptsPath) throw new Error("--concepts requires a path.");
      options.explicitContentPair = true;
    } else if (argument === "--realizations") {
      options.realizationsPath = argv[++index];
      if (!options.realizationsPath) throw new Error("--realizations requires a path.");
      options.explicitContentPair = true;
    } else if (argument === "--repo-root") {
      options.repoRoot = argv[++index];
      if (!options.repoRoot) throw new Error("--repo-root requires a path.");
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if ((options.all || options.courseId || options.explicitCatalog) && options.explicitContentPair) {
    throw new Error("Catalog selection cannot be combined with --concepts or --realizations.");
  }
  if (options.explicitCatalog && !options.courseId) options.all = true;
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

  const mode = options.requireNativeReview
    ? "native-review-required activation"
    : options.release
      ? "distributable package"
      : "development";
  if (options.all || options.courseId) {
    const records = await loadCatalogLanguageContentCourses({
      repositoryRoot: options.repoRoot,
      catalogPath: options.catalogPath,
      courseId: options.courseId
    });
    const reports = [];
    const failures = [];
    for (const record of records) {
      try {
        const loaded = await loadAndPrepareLanguageRoleContent({
          repoRoot: options.repoRoot,
          conceptsPath: record.conceptsPath,
          targetRealizationsPath: record.realizationsPath,
          learnerBaseRealizationsPath: record.learnerBaseRealizationsPath,
          sourceLanguage: record.sourceLanguage,
          release: options.release,
          requireNativeReview: options.requireNativeReview
        });
        reports.push({
          courseId: record.id,
          concepts: loaded.concepts.concepts.length,
          realizations: loaded.targetRealizations.realizations.length
        });
      } catch (error) {
        failures.push({ courseId: record.id, error });
      }
    }
    if (failures.length > 0) throw new CatalogLanguageContentError(failures);
    for (const report of reports) {
      console.log(
        `${report.courseId}: validated ${report.concepts} English concepts and `
        + `${report.realizations} target realizations for ${mode}.`
      );
    }
    console.log(`Validated ${reports.length} catalog language-content course(s).`);
    return;
  }

  const loaded = await loadAndValidateLanguageContent(options);
  const scope = options.explicitContentPair
    ? "explicit content pair"
    : "default compatibility target; use --all for catalog coverage";
  console.log(
    `Validated ${loaded.concepts.concepts.length} English concepts and `
    + `${loaded.realizations.realizations.length} target realizations for ${mode} (${scope}).`
  );
}

class CatalogLanguageContentError extends Error {
  constructor(failures) {
    const detail = failures.map(({ courseId, error }) => (
      `- ${courseId}: ${error instanceof Error ? error.message : String(error)}`
    )).join("\n");
    super(`Catalog language-content validation failed:\n${detail}`);
    this.name = "CatalogLanguageContentError";
  }
}

main().catch((error) => {
  console.error(
    error instanceof LanguageContentError || error instanceof CatalogLanguageContentError
      ? error.message
      : error.stack ?? error.message
  );
  process.exitCode = 1;
});
