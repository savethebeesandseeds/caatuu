import path from "node:path";

import { MANDARIN_SIMPLIFIED_CONTENT_POLICY_ID } from "../policies/mandarin-simplified.mjs";
import { defineWordWorldProjectionPolicy } from "./contract.mjs";

const PREVIEW_GUIDE_SCHEMA =
  "https://caatuu.org/schemas/development/target-text-guides.preview.v1.json";
const PREVIEW_GUIDE_STATUS = "machine-assisted-preview";

export const MANDARIN_SIMPLIFIED_WORD_WORLD_PATHS = Object.freeze({
  conceptsSource: "apps/languages/shared/english-concepts/word-world-starter-v1.json",
  realizationsSource: "apps/languages/mandarin-simplified/content/word-world/starter-v1.realizations.json",
  conceptsRuntime: "apps/language-runtime/static/data/english-concepts/word-world-starter-v1.json",
  realizationsRuntime: "apps/languages/mandarin-simplified/static/data/games/word-world/starter-v1.realizations.json",
  readingGuidesRuntime: "apps/languages/mandarin-simplified/static/data/games/word-world/starter-v1.reading-guides.json",
  manifest: "apps/languages/mandarin-simplified/static/data/games/word-world/manifest.json"
});

export const mandarinSimplifiedWordWorldProjectionPolicy = defineWordWorldProjectionPolicy({
  id: "mandarin-simplified-word-world-v1",
  contentPolicyId: MANDARIN_SIMPLIFIED_CONTENT_POLICY_ID,
  defaultPaths: MANDARIN_SIMPLIFIED_WORD_WORLD_PATHS,
  supplementalOutputs: {
    readingGuideProjection: "readingGuidesRuntime"
  },
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
    },
    readingGuideProjection: {
      field: "targetTextGuide.file",
      reference: "manifest-relative"
    }
  },
  targetProjectionPolicy({ realizations }) {
    if (realizations.review?.status !== "native-review-required") {
      throw new Error(
        "Mandarin Word World projection currently supports native-review-required sources only; reviewed pronunciation needs a separate approved runtime transition."
      );
    }
    return {
      pronunciationIncluded: false,
      reason: "Pronunciation guidance is disabled until native review is complete."
    };
  },
  projectSupplemental({ realizations, paths }) {
    return {
      readingGuideProjection: {
        $schema: PREVIEW_GUIDE_SCHEMA,
        schemaVersion: 1,
        courseId: realizations.courseId,
        system: "pinyin",
        status: PREVIEW_GUIDE_STATUS,
        derivedFrom: paths.realizationsSource,
        review: clone(realizations.review),
        entries: realizations.realizations.map((realization) => ({
          conceptId: realization.conceptId,
          tokens: realization.tokens.map((token) => ({
            surface: token.surface,
            units: token.readingUnits.map((unit) => ({
              surface: unit.surface,
              notation: unit.pronunciation.notation
            }))
          }))
        }))
      }
    };
  },
  buildManifest({ concepts, realizations, paths }) {
    if (JSON.stringify(concepts.license) !== JSON.stringify(realizations.license)) {
      throw new Error("Word World concept and realization license gates must match before projection.");
    }
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
      targetTextGuide: {
        file: manifestRelativePath(paths.manifest, paths.readingGuidesRuntime),
        system: "pinyin",
        languageTag: "zh-Latn-pinyin",
        status: PREVIEW_GUIDE_STATUS,
        labels: {
          section: "Mandarin text",
          showGuide: "Show pinyin",
          colorTones: "Color tones"
        },
        defaults: {
          showGuide: true,
          colorTones: true
        }
      },
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
      license: clone(concepts.license)
    };
  },
  validate({ supplementalProjections, runtimeManifest, targetProjection, realizations, paths }) {
    const guide = supplementalProjections.readingGuideProjection;
    validateReadingGuideProjection(guide, targetProjection, realizations);
    validateManifestProjection(runtimeManifest, guide, realizations, paths);
  }
});

function validateReadingGuideProjection(guide, targetProjection, sourceRealizations) {
  if (guide.schemaVersion !== 1 || guide.courseId !== targetProjection.courseId) {
    throw new Error("Reading-guide identity does not match the target projection.");
  }
  if (guide.system !== "pinyin" || guide.status !== PREVIEW_GUIDE_STATUS) {
    throw new Error("Reading guide must remain an explicit machine-assisted pinyin preview.");
  }
  if (JSON.stringify(guide.review) !== JSON.stringify(sourceRealizations.review)) {
    throw new Error("Reading-guide review metadata must match the authoring source.");
  }
  if (guide.entries.length !== targetProjection.realizations.length) {
    throw new Error("Reading guide must cover every target realization.");
  }
  guide.entries.forEach((entry, recordIndex) => {
    const realization = targetProjection.realizations[recordIndex];
    const sourceRealization = sourceRealizations.realizations[recordIndex];
    if (entry.conceptId !== realization.conceptId || entry.tokens.length !== realization.tokens.length) {
      throw new Error(`Reading-guide coverage differs at ${entry.conceptId}.`);
    }
    entry.tokens.forEach((token, tokenIndex) => {
      const projectedToken = realization.tokens[tokenIndex];
      const sourceToken = sourceRealization.tokens[tokenIndex];
      if (
        token.surface !== projectedToken.surface
        || token.units.map((unit) => unit.surface).join("") !== token.surface
      ) {
        throw new Error(`Reading-guide units differ at ${entry.conceptId} token ${tokenIndex}.`);
      }
      if (token.units.some((unit) => !unit.notation.trim() || /\s/u.test(unit.notation.trim()))) {
        throw new Error(`Reading-guide unit notation is invalid at ${entry.conceptId} token ${tokenIndex}.`);
      }
      if (
        token.units.length !== sourceToken.readingUnits.length
        || token.units.some((unit, unitIndex) => (
          unit.surface !== sourceToken.readingUnits[unitIndex].surface
          || unit.notation !== sourceToken.readingUnits[unitIndex].pronunciation.notation
        ))
      ) {
        throw new Error(
          `Reading-guide notation differs from authoring readingUnits at ${entry.conceptId} token ${tokenIndex}.`
        );
      }
    });
  });
}

function validateManifestProjection(manifest, guide, realizations, paths) {
  const expectedConceptCatalog = sharedRuntimePublicUrl(paths.conceptsRuntime);
  const expectedRealizationFile = manifestRelativePath(paths.manifest, paths.realizationsRuntime);
  const expectedGuideFile = manifestRelativePath(paths.manifest, paths.readingGuidesRuntime);
  const guideLanguageTag = realizations.realizations[0]?.tokens[0]
    ?.readingUnits[0]?.pronunciation?.languageTag;
  if (manifest.courseId !== realizations.courseId) {
    throw new Error("Word World manifest courseId does not match the realization catalog.");
  }
  if (
    manifest.sourceConceptCatalog !== expectedConceptCatalog
    || manifest.realizationFile !== expectedRealizationFile
    || manifest.targetTextGuide?.file !== expectedGuideFile
  ) {
    throw new Error("Word World manifest files do not match the generated runtime projections.");
  }
  if (
    manifest.targetTextGuide?.system !== guide.system
    || manifest.targetTextGuide?.status !== guide.status
    || manifest.targetTextGuide?.languageTag !== guideLanguageTag
  ) {
    throw new Error(
      "Word World manifest reading-guide system, status, or language differs from the generated guide."
    );
  }
  if (manifest.targetLanguage !== realizations.targetLanguage.languageTag) {
    throw new Error("Word World manifest targetLanguage does not match the realization catalog.");
  }
  if (
    manifest.review?.status !== realizations.review.status
    || manifest.review?.notes !== realizations.review.notes
    || manifest.review?.pronunciationApproved !== false
  ) {
    throw new Error("Word World manifest review gate differs from the unreviewed authoring source.");
  }
  if (manifest.recordCount !== realizations.realizations.length) {
    throw new Error("Word World manifest recordCount does not match the realization catalog.");
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

export default mandarinSimplifiedWordWorldProjectionPolicy;
