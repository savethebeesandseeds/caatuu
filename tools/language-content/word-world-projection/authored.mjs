import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { defineWordWorldProjectionPolicy } from "./contract.mjs";

// Reusable policy for authored targets with no approved pronunciation or
// supplementary outputs. Paths still come from the owning course manifest.
export function defineAuthoredWordWorldProjectionPolicy({ id, contentPolicyId, defaultPaths, pronunciationNote, speechEnabled = true }) {
  const englishUrl = file => {
    const prefix = "apps/language-runtime/static/";
    if (!file.startsWith(prefix) || file.split("/").some(segment => !segment || segment === "." || segment === "..")) {
      throw new Error("English runtime authority must stay within the shared runtime.");
    }
    return `/language-runtime/static/${file.slice(prefix.length)}`;
  };
  const relative = (manifest, file) => {
    const result = path.posix.relative(path.posix.dirname(manifest), file);
    if (!result || result === ".." || result.startsWith("../") || path.posix.isAbsolute(result) || result.includes("\\")) {
      throw new Error("Target output must remain beneath its manifest directory.");
    }
    return result;
  };
  return defineWordWorldProjectionPolicy({
    id, contentPolicyId, defaultPaths, supplementalOutputs: {},
    manifestBindings: {
      englishProjection: { field: "sourceConceptCatalog", reference: "shared-runtime-url" },
      targetProjection: { field: "realizationFile", reference: "manifest-relative" },
      learnerBaseProjection: { field: "learnerBaseFile", reference: "manifest-relative", optional: true }
    },
    targetProjectionPolicy() { return { pronunciationIncluded: false, reason: pronunciationNote }; },
    projectSupplemental() { return {}; },
    buildManifest({ concepts, realizations, paths }) {
      return {
        schemaVersion: "caatuu-word-world-runtime-manifest-v2", courseId: realizations.courseId,
        corpusVersion: "starter-v1", mode: "authored", sessionProvider: { kind: "authored-realizations" },
        features: { wordMeanings: true }, sourceConceptCatalog: englishUrl(paths.conceptsRuntime),
        realizationFile: relative(paths.manifest, paths.realizationsRuntime), recordCount: concepts.concepts.length,
        targetLanguage: realizations.targetLanguage.languageTag, mediationLanguage: "en", tokenization: "authored",
        review: { status: realizations.review.status, pronunciationApproved: false, notes: realizations.review.notes },
        capabilities: { llm: false, generation: false, chat: false, embeddings: true, semanticSearch: true,
          dictionary: false, wordMeanings: true, speech: speechEnabled, pronunciationGuides: false, wordWorld: true },
        embeddingPolicy: { inputLanguage: concepts.embeddingPolicy.inputLanguage,
          inputField: concepts.embeddingPolicy.inputField, targetTextAllowed: concepts.embeddingPolicy.targetTextAllowed,
          modelId: "all-minilm-l6-v2-qint8-v0.1", fallback: "deterministic-lexical" },
        license: structuredClone(realizations.license)
      };
    },
    validate({ runtimeManifest, targetProjection, realizations, paths }) {
      if (runtimeManifest.courseId !== realizations.courseId
        || runtimeManifest.targetLanguage !== realizations.targetLanguage.languageTag
        || runtimeManifest.sourceConceptCatalog !== englishUrl(paths.conceptsRuntime)
        || runtimeManifest.realizationFile !== relative(paths.manifest, paths.realizationsRuntime)
        || runtimeManifest.recordCount !== realizations.realizations.length
        || runtimeManifest.review?.status !== realizations.review.status
        || runtimeManifest.review?.notes !== realizations.review.notes
        || runtimeManifest.review?.pronunciationApproved !== false
        || runtimeManifest.capabilities?.speech !== speechEnabled
        || !isDeepStrictEqual(runtimeManifest.license, realizations.license)
        || !isDeepStrictEqual(targetProjection.license, realizations.license)
        || Object.hasOwn(runtimeManifest, "targetTextGuide")) {
        throw new Error("Authored Word World projection must preserve its course, content, review, licensing, and exact path authorities.");
      }
    }
  });
}
