import {
  assertValidLanguageAdapter,
  learnerDisplay,
  learnerPronunciation
} from "../../contract.mjs";
import {
  CourseCatalogError,
  joinConceptCatalogs,
  learnerFeaturePolicy,
  rankConceptsWithStatus,
  selectConceptBySeed
} from "./catalog-runtime.mjs";

function presentationLabel(value, fallback) {
  const label = String(value ?? "").trim();
  return label || fallback;
}

export function wordWorldPresentation(course, records = []) {
  const sourceLabel = presentationLabel(course?.sourceLanguage?.label, "Source language");
  const targetLabel = presentationLabel(
    course?.targetLanguage?.label ?? course?.targetLanguage?.nativeLabel,
    "target language"
  );
  const topics = [...new Set(records.map(({ topic }) => String(topic ?? "").trim()).filter(Boolean))]
    .slice(0, 3)
    .map((topic) => topic.replaceAll("-", " "));
  return Object.freeze({
    sourceLabel,
    targetLabel,
    eyebrow: `${sourceLabel} prompt → ${targetLabel}`,
    lede: `Explore useful ${targetLabel} sentences with ${sourceLabel} learner prompts. English meanings remain the audit and retrieval authority.`,
    searchLabel: "Find by English meaning",
    searchPlaceholder: topics.length > 0 ? `Try ${topics.join(", ")}…` : "Search in English…",
    searchLanguageError: "Search is English-only. Try an English meaning."
  });
}

function assertAdapterApprovedPronunciation(records, adapter) {
  for (const record of records) {
    learnerDisplay(adapter, record.target, { conceptId: record.conceptId });
    learnerPronunciation(adapter, record.target, { conceptId: record.conceptId });
    for (const [index, token] of record.target.tokens.entries()) {
      const tokenContent = { ...token, text: token.surface };
      learnerDisplay(adapter, tokenContent, { conceptId: record.conceptId, tokenIndex: index });
      learnerPronunciation(adapter, tokenContent, { conceptId: record.conceptId, tokenIndex: index });
    }
  }
}

export function createWordWorldSession({
  course,
  conceptCatalog,
  realizationCatalog,
  adapter,
  embeddingRanker = null,
  features = {}
}) {
  if (!course || typeof course !== "object") throw new TypeError("course must be an object.");
  assertValidLanguageAdapter(adapter);
  if (course.id !== realizationCatalog?.courseId) {
    throw new CourseCatalogError("Course and realization catalog IDs do not match.");
  }
  if (course.targetLanguage?.locale !== adapter.languageTags.locale) {
    throw new CourseCatalogError("Course target locale and language adapter do not match.");
  }
  if (realizationCatalog?.targetLanguage?.languageTag !== course.targetLanguage?.locale
      || realizationCatalog.targetLanguage.languageTag !== adapter.languageTags.locale) {
    throw new CourseCatalogError("Realization target locale must match the course and language adapter.");
  }
  const records = joinConceptCatalogs(conceptCatalog, realizationCatalog);
  return createPreparedWordWorldSession({
    course,
    adapter,
    records,
    review: realizationCatalog.review,
    embeddingRanker,
    features
  });
}

/**
 * Creates the language-neutral session consumed by the one shared Word World
 * renderer. Course providers may prepare records from different catalog
 * formats, but they cannot replace the renderer or its interaction model.
 */
export function createPreparedWordWorldSession({
  course,
  adapter,
  records,
  review = {},
  embeddingRanker = null,
  features = {}
}) {
  if (!course || typeof course !== "object") throw new TypeError("course must be an object.");
  assertValidLanguageAdapter(adapter);
  if (!Array.isArray(records) || records.length === 0) {
    throw new CourseCatalogError("Word World requires at least one prepared record.");
  }
  const policy = learnerFeaturePolicy(course.capabilities, review);
  if (!policy.wordWorld) throw new CourseCatalogError("Word World is disabled for this course.");
  if (policy.pronunciationGuides) assertAdapterApprovedPronunciation(records, adapter);
  const presentation = wordWorldPresentation(course, records);
  const searchWithStatus = (queryEmbeddingText) => rankConceptsWithStatus(
    records,
    queryEmbeddingText,
    policy.semanticSearch ? embeddingRanker : null
  );
  return Object.freeze({
    course,
    adapter,
    records,
    policy,
    features: Object.freeze({
      wordMeanings: features.wordMeanings === true,
      report: features.report !== false,
      ...features
    }),
    presentation,
    search(queryEmbeddingText) {
      return searchWithStatus(queryEmbeddingText).then(({ records: ranked }) => ranked);
    },
    searchWithStatus,
    select(seed) {
      return selectConceptBySeed(records, seed);
    }
  });
}
