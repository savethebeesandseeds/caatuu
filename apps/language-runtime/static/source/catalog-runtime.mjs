const CONCEPT_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u;
const LETTER_PATTERN = /\p{L}/u;
const ASCII_LETTER_PATTERN = /[A-Za-z]/u;
const APPROVED_REVIEW_STATES = new Set(["native-reviewed"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function nonEmptyString(value, path) {
  const text = String(value ?? "").normalize("NFC").trim();
  if (!text) throw new CourseCatalogError(`${path} must be a non-empty string.`);
  return text;
}

function stableCompare(left, right) {
  return String(left).localeCompare(String(right), "en", {
    numeric: true,
    sensitivity: "base"
  });
}

function conceptId(value, path) {
  const id = nonEmptyString(value, path);
  if (!CONCEPT_ID_PATTERN.test(id)) {
    throw new CourseCatalogError(`${path} must be a stable dotted or kebab-case concept ID.`);
  }
  return id;
}

function assertNoTargetScript(value, path) {
  const text = nonEmptyString(value, path);
  // Catalog authority and the declared `language: en` establish language.
  // This conservative character rule only catches obvious cross-script leaks.
  for (const character of text) {
    if (LETTER_PATTERN.test(character) && !ASCII_LETTER_PATTERN.test(character)) {
      throw new CourseCatalogError(`${path} violates the English-authority ASCII character policy.`);
    }
  }
  if (!ASCII_LETTER_PATTERN.test(text)) {
    throw new CourseCatalogError(`${path} must contain an ASCII letter under the English-authority character policy.`);
  }
  return text;
}

function lexicalSurface(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\p{P}\p{Z}\s]/gu, "");
}

function validateAuthoredTokens(realization, path) {
  if (!Array.isArray(realization.tokens) || realization.tokens.length === 0) {
    throw new CourseCatalogError(`${path}.tokens must contain authored word boundaries.`);
  }
  const tokens = realization.tokens.map((token, index) => {
    if (!isRecord(token)) throw new CourseCatalogError(`${path}.tokens[${index}] must be an object.`);
    const surface = nonEmptyString(token.surface, `${path}.tokens[${index}].surface`);
    const gloss = nonEmptyString(token.gloss, `${path}.tokens[${index}].gloss`);
    if (token.embeddingText !== undefined || token.englishText !== undefined) {
      throw new CourseCatalogError(`${path}.tokens[${index}] cannot define embedding fields.`);
    }
    return {
      ...token,
      surface,
      gloss,
      playable: token.playable === true
    };
  });
  const authoredSurface = lexicalSurface(tokens.map(({ surface }) => surface).join(""));
  const learnerSurface = lexicalSurface(realization.text);
  if (authoredSurface !== learnerSurface) {
    throw new CourseCatalogError(`${path}.tokens must reproduce the learner-facing text in order.`);
  }
  return tokens;
}

function normalizeEnglishSearchText(value, { allowEmpty = false } = {}) {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text && allowEmpty) return "";
  return assertNoTargetScript(text, "embeddingText");
}

function tokenizeEnglish(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
    .match(/[a-z0-9]+(?:'[a-z0-9]+)?/gu) ?? [];
}

function lexicalScore(record, queryText) {
  const queryTokens = [...new Set(tokenizeEnglish(queryText))];
  if (queryTokens.length === 0) return 0;
  const haystack = `${record.englishText} ${record.embeddingText} ${record.topic}`;
  const haystackTokens = new Set(tokenizeEnglish(haystack));
  const overlap = queryTokens.reduce((score, token) => score + (haystackTokens.has(token) ? 1 : 0), 0);
  const normalizedHaystack = tokenizeEnglish(haystack).join(" ");
  const normalizedQuery = queryTokens.join(" ");
  return overlap * 10 + (normalizedHaystack.includes(normalizedQuery) ? 5 : 0);
}

function normalizeRankerResult(result, records) {
  if (!Array.isArray(result) || result.length === 0) return null;
  const knownIds = new Set(records.map(({ conceptId: id }) => id));
  const scored = [];
  const seen = new Set();
  for (const [index, item] of result.entries()) {
    const id = typeof item === "string" ? item : item?.conceptId;
    const score = typeof item === "string" ? result.length - index : Number(item?.score);
    if (!knownIds.has(id) || seen.has(id) || !Number.isFinite(score)) return null;
    seen.add(id);
    scored.push({ conceptId: id, score });
  }
  if (scored.length !== records.length) return null;
  return scored;
}

function applyScoredOrder(records, scored) {
  const byId = new Map(records.map((record) => [record.conceptId, record]));
  return scored
    .slice()
    .sort((left, right) => right.score - left.score || stableCompare(left.conceptId, right.conceptId))
    .map(({ conceptId: id }) => byId.get(id));
}

export class CourseCatalogError extends Error {
  constructor(message) {
    super(message);
    this.name = "CourseCatalogError";
  }
}

export function validateEnglishConceptCatalog(catalog) {
  if (!isRecord(catalog)) throw new CourseCatalogError("English concept catalog must be an object.");
  if (catalog.schemaVersion !== 1) throw new CourseCatalogError("English concept catalog schemaVersion must be 1.");
  if (catalog.language !== "en") throw new CourseCatalogError("English concept catalog language must be en.");
  const policy = catalog.embeddingPolicy;
  if (!isRecord(policy)
      || policy.inputLanguage !== "en"
      || policy.inputField !== "embeddingText"
      || policy.targetTextAllowed !== false) {
    throw new CourseCatalogError("English concept catalog must declare the English-only embeddingText policy.");
  }
  if (!Array.isArray(catalog.concepts) || catalog.concepts.length === 0) {
    throw new CourseCatalogError("English concept catalog must contain concepts.");
  }
  const seen = new Set();
  for (const [index, concept] of catalog.concepts.entries()) {
    if (!isRecord(concept)) throw new CourseCatalogError(`concepts[${index}] must be an object.`);
    const id = conceptId(concept.id, `concepts[${index}].id`);
    if (seen.has(id)) throw new CourseCatalogError(`Duplicate concept ID: ${id}.`);
    seen.add(id);
    nonEmptyString(concept.englishText, `concepts[${index}].englishText`);
    assertNoTargetScript(concept.embeddingText, `concepts[${index}].embeddingText`);
    nonEmptyString(concept.topic, `concepts[${index}].topic`);
    if (!Number.isInteger(concept.difficulty) || concept.difficulty < 1) {
      throw new CourseCatalogError(`concepts[${index}].difficulty must be a positive integer.`);
    }
  }
  return catalog;
}

export function validateTargetRealizationCatalog(catalog) {
  if (!isRecord(catalog)) throw new CourseCatalogError("Target realization catalog must be an object.");
  if (catalog.schemaVersion !== 1) throw new CourseCatalogError("Target realization catalog schemaVersion must be 1.");
  nonEmptyString(catalog.courseId, "courseId");
  if (!isRecord(catalog.targetLanguage)) throw new CourseCatalogError("targetLanguage must be an object.");
  nonEmptyString(catalog.targetLanguage.languageTag, "targetLanguage.languageTag");
  if (!isRecord(catalog.review)) throw new CourseCatalogError("review must be an object.");
  nonEmptyString(catalog.review.status, "review.status");
  if (!Array.isArray(catalog.realizations) || catalog.realizations.length === 0) {
    throw new CourseCatalogError("Target realization catalog must contain realizations.");
  }
  const seen = new Set();
  for (const [index, realization] of catalog.realizations.entries()) {
    const path = `realizations[${index}]`;
    if (!isRecord(realization)) throw new CourseCatalogError(`${path} must be an object.`);
    const id = conceptId(realization.conceptId, `${path}.conceptId`);
    if (seen.has(id)) throw new CourseCatalogError(`Duplicate target realization: ${id}.`);
    seen.add(id);
    nonEmptyString(realization.text, `${path}.text`);
    if (realization.embeddingText !== undefined || realization.englishText !== undefined) {
      throw new CourseCatalogError(`${path} cannot define English embedding fields.`);
    }
    validateAuthoredTokens(realization, path);
  }
  return catalog;
}

export function joinConceptCatalogs(englishCatalog, realizationCatalog) {
  validateEnglishConceptCatalog(englishCatalog);
  validateTargetRealizationCatalog(realizationCatalog);
  const concepts = new Map(englishCatalog.concepts.map((concept) => [concept.id, concept]));
  const realizations = new Map(realizationCatalog.realizations.map((realization) => [realization.conceptId, realization]));
  const missing = [...concepts.keys()].filter((id) => !realizations.has(id));
  const extras = [...realizations.keys()].filter((id) => !concepts.has(id));
  if (missing.length || extras.length) {
    throw new CourseCatalogError([
      missing.length ? `Missing target realizations: ${missing.join(", ")}.` : "",
      extras.length ? `Unknown target realizations: ${extras.join(", ")}.` : ""
    ].filter(Boolean).join(" "));
  }
  return deepFreeze(englishCatalog.concepts.map((concept) => {
    const realization = realizations.get(concept.id);
    return {
      conceptId: concept.id,
      englishText: nonEmptyString(concept.englishText, `${concept.id}.englishText`),
      embeddingText: assertNoTargetScript(concept.embeddingText, `${concept.id}.embeddingText`),
      sceneQuery: nonEmptyString(concept.sceneQuery, `${concept.id}.sceneQuery`),
      topic: nonEmptyString(concept.topic, `${concept.id}.topic`),
      difficulty: concept.difficulty,
      target: {
        ...realization,
        text: nonEmptyString(realization.text, `${concept.id}.text`),
        tokens: validateAuthoredTokens(realization, concept.id)
      },
      review: { ...realizationCatalog.review }
    };
  }));
}

export function learnerFeaturePolicy(capabilities = {}, review = {}) {
  const reviewStatus = String(review.status || "").trim();
  const pronunciationApproved = APPROVED_REVIEW_STATES.has(reviewStatus);
  return deepFreeze({
    wordWorld: capabilities.wordWorld === true,
    semanticSearch: capabilities.embeddings === true && capabilities.semanticSearch === true,
    pronunciationGuides: capabilities.pronunciationGuides === true && pronunciationApproved,
    // Text-to-speech reads the reviewed learner text itself. It does not depend
    // on a separate, learner-visible pronunciation guide such as pinyin.
    speech: capabilities.speech === true,
    reviewRequired: !pronunciationApproved
  });
}

export function createSafeEmbeddingPayload(records, queryEmbeddingText) {
  const query = normalizeEnglishSearchText(queryEmbeddingText);
  if (!Array.isArray(records) || records.length === 0) {
    throw new CourseCatalogError("Embedding candidates must be a non-empty joined catalog.");
  }
  const candidates = records.map((record, index) => ({
    conceptId: conceptId(record.conceptId, `records[${index}].conceptId`),
    embeddingText: assertNoTargetScript(record.embeddingText, `records[${index}].embeddingText`)
  }));
  return deepFreeze({
    inputLanguage: "en",
    query: { embeddingText: query },
    candidates
  });
}

export function rankConceptsLexically(records, queryEmbeddingText = "") {
  if (!Array.isArray(records)) throw new CourseCatalogError("records must be an array.");
  const query = normalizeEnglishSearchText(queryEmbeddingText, { allowEmpty: true });
  return records
    .map((record) => ({ record, score: lexicalScore(record, query) }))
    .sort((left, right) => right.score - left.score
      || left.record.difficulty - right.record.difficulty
      || stableCompare(left.record.conceptId, right.record.conceptId))
    .map(({ record }) => record);
}

export async function rankConceptsWithStatus(records, queryEmbeddingText = "", embeddingRanker = null) {
  const query = normalizeEnglishSearchText(queryEmbeddingText, { allowEmpty: true });
  const fallback = () => rankConceptsLexically(records, query);
  if (!query) {
    return Object.freeze({ records: fallback(), mode: "lexical", reason: "empty-query" });
  }
  if (typeof embeddingRanker !== "function") {
    return Object.freeze({ records: fallback(), mode: "lexical", reason: "ranker-unavailable" });
  }
  const payload = createSafeEmbeddingPayload(records, query);
  try {
    const result = await embeddingRanker(payload);
    const normalized = normalizeRankerResult(result, records);
    if (!normalized) {
      return Object.freeze({ records: fallback(), mode: "lexical", reason: "invalid-ranker-result" });
    }
    return Object.freeze({ records: applyScoredOrder(records, normalized), mode: "embedding", reason: null });
  } catch (error) {
    console.warn(
      "English MiniLM semantic ranking failed; using deterministic lexical fallback.",
      error
    );
    return Object.freeze({ records: fallback(), mode: "lexical", reason: "ranker-error" });
  }
}

export async function rankConcepts(records, queryEmbeddingText = "", embeddingRanker = null) {
  return (await rankConceptsWithStatus(records, queryEmbeddingText, embeddingRanker)).records;
}

export function selectConceptBySeed(records, seed) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new CourseCatalogError("Cannot select from an empty concept catalog.");
  }
  const stableRecords = records.slice().sort((left, right) => stableCompare(left.conceptId, right.conceptId));
  const text = String(seed ?? "").normalize("NFC");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return stableRecords[hash % stableRecords.length];
}
