import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { SPANISH_SPAIN_CONTENT_POLICY_ID } from "../policies/spanish-spain.mjs";
import { defineWordWorldProjectionPolicy } from "./contract.mjs";

export const SPANISH_SPAIN_WORD_WORLD_PROJECTION_POLICY_ID =
  "spanish-spain-word-world-v1";

export const SPANISH_SPAIN_WORD_WORLD_PATHS = Object.freeze({
  conceptsSource: "apps/languages/shared/english-concepts/word-world-starter-v1.json",
  realizationsSource: "apps/languages/spanish/content/word-world/starter-v1.realizations.json",
  conceptsRuntime: "apps/language-runtime/static/data/english-concepts/word-world-starter-v1.json",
  realizationsRuntime: "apps/languages/spanish/static/data/games/word-world/starter-v1.realizations.json",
  manifest: "apps/languages/spanish/static/data/games/word-world/manifest.json"
});

export const spanishSpainWordWorldProjectionPolicy = defineWordWorldProjectionPolicy({
  id: SPANISH_SPAIN_WORD_WORLD_PROJECTION_POLICY_ID,
  contentPolicyId: SPANISH_SPAIN_CONTENT_POLICY_ID,
  defaultPaths: SPANISH_SPAIN_WORD_WORLD_PATHS,
  supplementalOutputs: {},
  manifestBindings: {
    englishProjection: {
      field: "sourceConceptCatalog",
      reference: "shared-runtime-url"
    },
    targetProjection: {
      field: "realizationFile",
      reference: "manifest-relative"
    },
    learnerBaseProjection: {
      field: "learnerBaseFile",
      reference: "manifest-relative",
      optional: true
    }
  },
  targetProjectionPolicy() {
    return {
      pronunciationIncluded: false,
      reason: "Spanish pronunciation is omitted until a separate reviewed pronunciation policy exists."
    };
  },
  projectSupplemental() {
    return {};
  },
  buildManifest({ concepts, realizations, paths }) {
    return {
      schemaVersion: "caatuu-word-world-runtime-manifest-v2",
      courseId: realizations.courseId,
      corpusVersion: "starter-v1",
      mode: "authored",
      sessionProvider: {
        kind: "authored-realizations"
      },
      features: {
        wordMeanings: true
      },
      sourceConceptCatalog: sharedRuntimePublicUrl(paths.conceptsRuntime),
      realizationFile: manifestRelativePath(paths.manifest, paths.realizationsRuntime),
      recordCount: concepts.concepts.length,
      targetLanguage: realizations.targetLanguage.languageTag,
      mediationLanguage: "en",
      tokenization: "authored",
      review: {
        status: realizations.review.status,
        pronunciationApproved: false,
        notes: realizations.review.notes
      },
      capabilities: {
        llm: false,
        generation: false,
        chat: false,
        embeddings: true,
        semanticSearch: true,
        dictionary: false,
        wordMeanings: true,
        speech: true,
        pronunciationGuides: false,
        wordWorld: true
      },
      embeddingPolicy: {
        inputLanguage: concepts.embeddingPolicy.inputLanguage,
        inputField: concepts.embeddingPolicy.inputField,
        targetTextAllowed: concepts.embeddingPolicy.targetTextAllowed,
        modelId: "all-minilm-l6-v2-qint8-v0.1",
        fallback: "deterministic-lexical"
      },
      license: clone(realizations.license)
    };
  },
  validate({ runtimeManifest, targetProjection, realizations, paths }) {
    validateManifestProjection(runtimeManifest, realizations, paths);
    if (!isDeepStrictEqual(targetProjection.license, realizations.license)) {
      throw new Error("Spanish target projection license must preserve target-content authority.");
    }
    if (Object.hasOwn(runtimeManifest, "targetTextGuide")) {
      throw new Error("Spanish Word World must not publish an unowned target-text guide.");
    }
  }
});

function validateManifestProjection(manifest, realizations, paths) {
  const expectedConceptCatalog = sharedRuntimePublicUrl(paths.conceptsRuntime);
  const expectedRealizationFile = manifestRelativePath(paths.manifest, paths.realizationsRuntime);
  if (manifest.courseId !== realizations.courseId) {
    throw new Error("Spanish Word World manifest courseId does not match the realization catalog.");
  }
  if (
    manifest.sourceConceptCatalog !== expectedConceptCatalog
    || manifest.realizationFile !== expectedRealizationFile
  ) {
    throw new Error("Spanish Word World manifest files do not match the generated runtime projections.");
  }
  if (manifest.targetLanguage !== realizations.targetLanguage.languageTag) {
    throw new Error("Spanish Word World manifest targetLanguage does not match the realization catalog.");
  }
  if (
    manifest.review?.status !== realizations.review.status
    || manifest.review?.notes !== realizations.review.notes
    || manifest.review?.pronunciationApproved !== false
  ) {
    throw new Error("Spanish Word World manifest review gate differs from its target authority.");
  }
  if (manifest.recordCount !== realizations.realizations.length) {
    throw new Error("Spanish Word World manifest recordCount does not match the realization catalog.");
  }
  if (!isDeepStrictEqual(manifest.license, realizations.license)) {
    throw new Error("Spanish Word World manifest license must preserve target-content authority.");
  }
}

function sharedRuntimePublicUrl(repositoryPath) {
  const prefix = "apps/language-runtime/static/";
  if (typeof repositoryPath !== "string" || !repositoryPath.startsWith(prefix)) {
    throw new Error("Word World English concepts runtime must stay inside the shared language runtime.");
  }
  const relativePath = repositoryPath.slice(prefix.length);
  if (
    !relativePath
    || relativePath.includes("\\")
    || relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Word World English concepts runtime path is not confined.");
  }
  return `/language-runtime/static/${relativePath}`;
}

function manifestRelativePath(manifestPath, outputPath) {
  const relativePath = path.posix.relative(path.posix.dirname(manifestPath), outputPath);
  if (
    !relativePath
    || relativePath === ".."
    || relativePath.startsWith("../")
    || path.posix.isAbsolute(relativePath)
    || relativePath.includes("\\")
  ) {
    throw new Error("Word World runtime output must remain beneath its manifest directory.");
  }
  return relativePath;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export default spanishSpainWordWorldProjectionPolicy;
