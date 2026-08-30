import path from "node:path";

export const SEMANTIC_INDEX_CONTRACT_NAME = "caatuu-semantic-index";
export const SEMANTIC_INDEX_CONTRACT_VERSION = 1;
export const ENGLISH_EMBEDDING_LOCALE = "en";
export const ENGLISH_EMBEDDING_TEXT_FIELD = "english_text";
export const ENGLISH_EMBEDDING_INPUT_POLICY = "english_text_only";
export const MANUAL_ENGLISH_DESCRIPTION_FIELD = "manual_english_description";
export const MANUAL_ENGLISH_DESCRIPTION_INPUT_POLICY = "manual_english_description_only";
export const TARGET_REALIZATIONS_TABLE = "target_realizations";

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const FIELD_PATTERN = /^[a-z][a-z0-9_]*$/u;
const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const LETTER_PATTERN = /\p{Letter}/u;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;
const MARK_PATTERN = /\p{Mark}/u;
const NUMBER_PATTERN = /\p{Number}/u;
const ASCII_LATIN_LETTER_PATTERN = /^[A-Za-z]$/u;
const ASCII_DIGIT_PATTERN = /^[0-9]$/u;
const CONTROL_PATTERN = /\p{Control}/u;
const NON_ASCII_PATTERN = /[^\x00-\x7f]/u;

export function defineSemanticIndexConfig(value) {
  assertPlainObject(value, "semantic index config");
  const indexId = requireMatch(value.indexId, "indexId", ID_PATTERN);
  const courseId = requireMatch(value.courseId, "courseId", ID_PATTERN);
  const target = normalizeTarget(value.target);
  const record = normalizeRecord(value.record, target);
  const storage = normalizeStorage(value.storage);
  const publishedSchema = normalizePublishedSchema(value.compatibility?.publishedSchema);

  const config = {
    contract: {
      name: SEMANTIC_INDEX_CONTRACT_NAME,
      version: SEMANTIC_INDEX_CONTRACT_VERSION,
    },
    indexId,
    courseId,
    embedding: {
      sourceLocale: ENGLISH_EMBEDDING_LOCALE,
      textField: ENGLISH_EMBEDDING_TEXT_FIELD,
      inputPolicy: ENGLISH_EMBEDDING_INPUT_POLICY,
    },
    target,
    record,
    storage,
    compatibility: { publishedSchema },
  };
  return deepFreeze(config);
}

export function semanticIndexArtifactPaths(config, modelId) {
  assertSemanticIndexConfig(config);
  const safeModelId = requireMatch(modelId, "modelId", ARTIFACT_ID_PATTERN);
  const repositoryModelRoot = posixJoin(config.storage.repositoryRoot, safeModelId);
  const routeModelRoot = posixJoin(config.storage.routeRoot, safeModelId);
  const manifestModelRoot = posixJoin(config.storage.manifestUrlRoot, safeModelId);
  return deepFreeze({
    repository: {
      catalog: posixJoin(config.storage.repositoryRoot, "models.json"),
      modelRoot: repositoryModelRoot,
      database: posixJoin(repositoryModelRoot, config.storage.databaseFile),
      manifest: posixJoin(repositoryModelRoot, "manifest.json"),
    },
    route: {
      catalog: posixJoin(config.storage.routeRoot, "models.json"),
      modelRoot: routeModelRoot,
      database: posixJoin(routeModelRoot, config.storage.databaseFile),
      manifest: posixJoin(routeModelRoot, "manifest.json"),
    },
    manifest: {
      catalog: posixJoin(config.storage.manifestUrlRoot, "models.json"),
      database: posixJoin(manifestModelRoot, config.storage.databaseFile),
    },
  });
}

export function resolveSemanticIndexArtifactPaths(config, modelId, workspaceRoot) {
  const paths = semanticIndexArtifactPaths(config, modelId);
  const root = path.resolve(requireString(workspaceRoot, "workspaceRoot"));
  const resolvedRepository = Object.fromEntries(
    Object.entries(paths.repository).map(([key, relativePath]) => [key, resolveWithin(root, relativePath)]),
  );
  return deepFreeze({ ...paths, repository: resolvedRepository });
}

export function curriculumEnglishEmbeddingInput(record, options = {}) {
  assertPlainObject(record, "curriculum record");
  assertPlainObject(options, "curriculum embedding options");
  const recordField = options.recordField ?? ENGLISH_EMBEDDING_TEXT_FIELD;
  if (recordField !== ENGLISH_EMBEDDING_TEXT_FIELD) {
    throw new Error(
      `Refusing curriculum embedding field ${JSON.stringify(recordField)}; ${ENGLISH_EMBEDDING_INPUT_POLICY} requires ${ENGLISH_EMBEDDING_TEXT_FIELD}.`,
    );
  }
  const targetTextFields = options.targetTextFields ?? [];
  assertNotTargetField(recordField, targetTextFields);
  return englishInput(record, {
    recordField,
    declaredField: ENGLISH_EMBEDDING_TEXT_FIELD,
    inputPolicy: ENGLISH_EMBEDDING_INPUT_POLICY,
    targetTextFields,
  });
}

export function manualEnglishDescriptionEmbeddingInput(record, options = {}) {
  assertPlainObject(record, "asset record");
  assertPlainObject(options, "asset embedding options");
  const recordField = options.recordField ?? "description";
  if (recordField !== "description" && recordField !== MANUAL_ENGLISH_DESCRIPTION_FIELD) {
    throw new Error(
      `Refusing asset embedding field ${JSON.stringify(recordField)}; ${MANUAL_ENGLISH_DESCRIPTION_INPUT_POLICY} requires a manual English description.`,
    );
  }
  const targetTextFields = options.targetTextFields ?? [];
  assertNotTargetField(recordField, targetTextFields);
  return englishInput(record, {
    recordField,
    declaredField: MANUAL_ENGLISH_DESCRIPTION_FIELD,
    inputPolicy: MANUAL_ENGLISH_DESCRIPTION_INPUT_POLICY,
    targetTextFields,
  });
}

export function validateAuthoredEnglishEmbeddingText(value, label = "embedding text") {
  const text = requireString(value, label).trim();
  if (text !== text.normalize("NFC")) {
    throw new Error(`${label} must use normalized authored-English text (NFC).`);
  }
  if (CONTROL_PATTERN.test(text)) {
    throw new Error(`${label} must not contain control characters.`);
  }

  let hasLatinLetter = false;
  for (const character of text) {
    if (!LETTER_PATTERN.test(character)) continue;
    if (!LATIN_LETTER_PATTERN.test(character)) {
      throw new Error(`${label} contains non-Latin script and cannot be embedded as English.`);
    }
    if (!ASCII_LATIN_LETTER_PATTERN.test(character)) {
      throw new Error(`${label} contains non-ASCII Latin text and cannot be embedded as English.`);
    }
    hasLatinLetter = true;
  }
  for (const character of text) {
    if (NUMBER_PATTERN.test(character) && !ASCII_DIGIT_PATTERN.test(character)) {
      throw new Error(`${label} contains non-ASCII numerals and cannot be embedded as English.`);
    }
  }
  if (!hasLatinLetter) {
    throw new Error(`${label} must contain authored English Latin text.`);
  }
  if (MARK_PATTERN.test(text.normalize("NFD"))) {
    throw new Error(`${label} contains diacritics or combining marks and cannot be embedded as English.`);
  }
  if (NON_ASCII_PATTERN.test(text)) {
    throw new Error(`${label} contains non-ASCII characters and cannot be embedded as English.`);
  }
  return text;
}

export function prepareSemanticCurriculumRecord(record, config) {
  assertSemanticIndexConfig(config);
  assertPlainObject(record, "curriculum record");
  const conceptId = requireMatch(record[config.record.idField], config.record.idField, RECORD_ID_PATTERN);
  const embeddingInput = curriculumEnglishEmbeddingInput(record, {
    targetTextFields: targetOwnedFields(config),
  });
  const targetText = requireString(record[config.target.textField], config.target.textField).trim();
  if (!targetText) throw new Error(`${config.target.textField} must not be blank for ${conceptId}.`);

  const documentId = `curriculum-en-${conceptId}`;
  const pronunciation = config.target.pronunciationField === null
    ? null
    : cloneJson(record[config.target.pronunciationField] ?? null, config.target.pronunciationField);
  const semanticMetadata = pickFields(record, config.record.semanticMetadataFields);
  const linguisticMetadata = pickFields(record, config.record.linguisticMetadataFields);
  const reviewMetadata = pickFields(record, config.record.reviewMetadataFields);

  return deepFreeze({
    conceptId,
    embeddingInput,
    embeddingDocument: {
      id: documentId,
      sourceKind: "curriculum",
      sourceId: conceptId,
      locale: ENGLISH_EMBEDDING_LOCALE,
      body: embeddingInput.text,
      metadata: semanticMetadata,
    },
    targetRealization: {
      id: `${config.courseId}:${config.target.locale}:${conceptId}`,
      conceptId,
      semanticDocumentId: documentId,
      courseId: config.courseId,
      locale: config.target.locale,
      targetText,
      pronunciation,
      linguisticMetadata,
      reviewMetadata,
    },
  });
}

export function prepareSemanticCurriculumRows(rows, config) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("curriculum rows must be a non-empty array.");
  const prepared = rows.map((record) => prepareSemanticCurriculumRecord(record, config));
  assertUnique(prepared.map((item) => item.conceptId), "concept id");
  assertUnique(prepared.map((item) => item.embeddingDocument.id), "embedding document id");
  assertUnique(prepared.map((item) => item.targetRealization.id), "target realization id");
  return deepFreeze(prepared);
}

export function validateSemanticIndexManifest(manifest, config, { modelId } = {}) {
  assertSemanticIndexConfig(config);
  assertPlainObject(manifest, "semantic index manifest");
  const acceptedSchemaNames = new Set([
    SEMANTIC_INDEX_CONTRACT_NAME,
    config.compatibility.publishedSchema.name,
  ]);
  if (!acceptedSchemaNames.has(manifest.schema_name)) {
    throw new Error(`Unsupported semantic index schema_name ${JSON.stringify(manifest.schema_name)}.`);
  }
  if (!Number.isInteger(manifest.schema_version) || manifest.schema_version < 1) {
    throw new Error("semantic index manifest schema_version must be a positive integer.");
  }
  const expectedSchemaVersion = manifest.schema_name === SEMANTIC_INDEX_CONTRACT_NAME
    ? SEMANTIC_INDEX_CONTRACT_VERSION
    : config.compatibility.publishedSchema.version;
  if (manifest.schema_version !== expectedSchemaVersion) {
    throw new Error(
      `semantic index manifest schema_version must be ${expectedSchemaVersion} for ${manifest.schema_name}.`,
    );
  }
  if (manifest.embedding_text_field !== ENGLISH_EMBEDDING_TEXT_FIELD) {
    throw new Error(`semantic index manifest must embed ${ENGLISH_EMBEDDING_TEXT_FIELD}.`);
  }
  if (manifest.embedding_input_policy !== ENGLISH_EMBEDDING_INPUT_POLICY) {
    throw new Error(`semantic index manifest must use ${ENGLISH_EMBEDDING_INPUT_POLICY}.`);
  }
  if (manifest.file !== config.storage.databaseFile) {
    throw new Error(`semantic index manifest file must be ${config.storage.databaseFile}.`);
  }
  if (modelId !== undefined) {
    const paths = semanticIndexArtifactPaths(config, modelId);
    if (manifest.url !== paths.manifest.database) {
      throw new Error(`semantic index manifest url must be ${paths.manifest.database}.`);
    }
  }
  return true;
}

function normalizeTarget(value) {
  assertPlainObject(value, "target");
  const locale = canonicalLocale(value.locale, "target.locale");
  if (locale.toLowerCase().split("-", 1)[0] === ENGLISH_EMBEDDING_LOCALE) {
    throw new Error("target.locale must differ from the English embedding locale.");
  }
  const textField = requireMatch(value.textField, "target.textField", FIELD_PATTERN);
  if (textField === ENGLISH_EMBEDDING_TEXT_FIELD) {
    throw new Error("target.textField cannot be english_text.");
  }
  const pronunciationField = value.pronunciationField === undefined || value.pronunciationField === null
    ? null
    : requireMatch(value.pronunciationField, "target.pronunciationField", FIELD_PATTERN);
  if (pronunciationField === textField || pronunciationField === ENGLISH_EMBEDDING_TEXT_FIELD) {
    throw new Error("target pronunciation must use its own non-embedding field.");
  }
  return { locale, textField, pronunciationField };
}

function normalizeRecord(value, target) {
  assertPlainObject(value, "record");
  const idField = requireMatch(value.idField ?? "id", "record.idField", FIELD_PATTERN);
  const semanticMetadataFields = normalizeFieldList(value.semanticMetadataFields, "record.semanticMetadataFields");
  const linguisticMetadataFields = normalizeFieldList(value.linguisticMetadataFields, "record.linguisticMetadataFields");
  const reviewMetadataFields = normalizeFieldList(value.reviewMetadataFields, "record.reviewMetadataFields");
  const targetFields = new Set([target.textField, target.pronunciationField].filter(Boolean));
  for (const field of semanticMetadataFields) {
    if (targetFields.has(field)) {
      throw new Error(`Target-owned field ${field} cannot be stored in embedding document metadata.`);
    }
  }
  assertDisjoint(semanticMetadataFields, linguisticMetadataFields, "semantic", "linguistic");
  assertDisjoint(semanticMetadataFields, reviewMetadataFields, "semantic", "review");
  assertDisjoint(linguisticMetadataFields, reviewMetadataFields, "linguistic", "review");
  return { idField, semanticMetadataFields, linguisticMetadataFields, reviewMetadataFields };
}

function normalizeStorage(value) {
  assertPlainObject(value, "storage");
  const repositoryRoot = relativePosixPath(value.repositoryRoot, "storage.repositoryRoot");
  const routeRoot = absolutePosixPath(value.routeRoot, "storage.routeRoot");
  const manifestUrlRoot = relativePosixPath(value.manifestUrlRoot, "storage.manifestUrlRoot");
  const databaseFile = requireString(value.databaseFile, "storage.databaseFile");
  if (databaseFile !== path.posix.basename(databaseFile) || !databaseFile.endsWith(".sqlite")) {
    throw new Error("storage.databaseFile must be a SQLite basename.");
  }
  return { repositoryRoot, routeRoot, manifestUrlRoot, databaseFile };
}

function normalizePublishedSchema(value) {
  if (value === undefined) {
    return { name: SEMANTIC_INDEX_CONTRACT_NAME, version: SEMANTIC_INDEX_CONTRACT_VERSION };
  }
  assertPlainObject(value, "compatibility.publishedSchema");
  const name = requireString(value.name, "compatibility.publishedSchema.name");
  const version = value.version;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("compatibility.publishedSchema.version must be a positive integer.");
  }
  return { name, version };
}

function assertSemanticIndexConfig(config) {
  assertPlainObject(config, "semantic index config");
  if (config.contract?.name !== SEMANTIC_INDEX_CONTRACT_NAME
    || config.contract?.version !== SEMANTIC_INDEX_CONTRACT_VERSION) {
    throw new Error(`Expected ${SEMANTIC_INDEX_CONTRACT_NAME} v${SEMANTIC_INDEX_CONTRACT_VERSION} config.`);
  }
  if (config.embedding?.sourceLocale !== ENGLISH_EMBEDDING_LOCALE
    || config.embedding?.textField !== ENGLISH_EMBEDDING_TEXT_FIELD
    || config.embedding?.inputPolicy !== ENGLISH_EMBEDDING_INPUT_POLICY) {
    throw new Error(
      `Semantic index config must declare ${ENGLISH_EMBEDDING_LOCALE}/${ENGLISH_EMBEDDING_TEXT_FIELD}/${ENGLISH_EMBEDDING_INPUT_POLICY}.`,
    );
  }
}

function englishInput(record, { recordField, declaredField, inputPolicy, targetTextFields }) {
  const text = validateAuthoredEnglishEmbeddingText(record[recordField], recordField);
  assertEmbeddingTextDiffersFromTargets(record, recordField, text, targetTextFields);
  return deepFreeze({
    text,
    locale: ENGLISH_EMBEDDING_LOCALE,
    textField: declaredField,
    inputPolicy,
  });
}

function assertEmbeddingTextDiffersFromTargets(record, recordField, text, targetTextFields) {
  const englishIdentity = normalizedTextIdentity(text);
  for (const targetField of targetTextFields) {
    const targetValue = record[targetField];
    if (typeof targetValue !== "string" || !targetValue.trim()) continue;
    if (normalizedTextIdentity(targetValue) === englishIdentity) {
      throw new Error(
        `Refusing to embed ${recordField}; authored English text matches target-owned field ${targetField}.`,
      );
    }
  }
}

function normalizedTextIdentity(value) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
}

function assertNotTargetField(recordField, targetTextFields) {
  if (!Array.isArray(targetTextFields)) throw new Error("targetTextFields must be an array.");
  if (new Set(targetTextFields.filter(Boolean)).has(recordField)) {
    throw new Error(`Refusing to embed target-language field ${recordField}.`);
  }
}

function targetOwnedFields(config) {
  return [
    config.target.textField,
    config.target.pronunciationField,
    ...config.record.linguisticMetadataFields,
    ...config.record.reviewMetadataFields,
  ].filter(Boolean);
}

function pickFields(record, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(record, field))
      .map((field) => [field, cloneJson(record[field], field)]),
  );
}

function cloneJson(value, label) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new Error(`${label} must be JSON-serializable: ${error.message}`);
  }
}

function normalizeFieldList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const fields = value.map((field, index) => requireMatch(field, `${label}[${index}]`, FIELD_PATTERN));
  assertUnique(fields, label);
  return fields;
}

function assertDisjoint(left, right, leftLabel, rightLabel) {
  const rightSet = new Set(right);
  const overlap = left.find((field) => rightSet.has(field));
  if (overlap) throw new Error(`${overlap} cannot be both ${leftLabel} and ${rightLabel} metadata.`);
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}.`);
    seen.add(value);
  }
}

function canonicalLocale(value, label) {
  const locale = requireString(value, label);
  let canonical;
  try {
    [canonical] = Intl.getCanonicalLocales(locale);
  } catch {
    throw new Error(`${label} must be a valid BCP 47 language tag.`);
  }
  if (canonical !== locale) throw new Error(`${label} must use canonical BCP 47 spelling (${canonical}).`);
  return locale;
}

function relativePosixPath(value, label) {
  const input = requireString(value, label);
  if (input.includes("\\") || input.startsWith("/") || input.endsWith("/") || hasUnsafePathSegment(input)) {
    throw new Error(`${label} must be a normalized repository-relative POSIX path.`);
  }
  return input;
}

function absolutePosixPath(value, label) {
  const input = requireString(value, label);
  if (!input.startsWith("/") || input === "/" || input.endsWith("/") || input.includes("\\") || hasUnsafePathSegment(input)) {
    throw new Error(`${label} must be a normalized absolute route without a trailing slash.`);
  }
  return input;
}

function hasUnsafePathSegment(value) {
  return value.split("/").some((segment, index) => (index > 0 || segment) && (segment === "" || segment === "." || segment === ".."));
}

function posixJoin(...parts) {
  const absolute = String(parts[0]).startsWith("/");
  const joined = path.posix.join(...parts);
  return absolute && !joined.startsWith("/") ? `/${joined}` : joined;
}

function resolveWithin(root, relativePath) {
  const candidate = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Resolved path leaves workspace root: ${relativePath}.`);
  }
  return candidate;
}

function requireMatch(value, label, pattern) {
  const input = requireString(value, label);
  if (!pattern.test(input)) throw new Error(`${label} has an invalid value: ${JSON.stringify(input)}.`);
  return input;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}
