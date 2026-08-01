const PATCH_SCHEMA = "caatuu.dictionary-patch.v1";
const PATCH_DIRECTION = "cs-en";
const PATCH_DICTIONARY_KEY = "kaikki-cs-en-2026-07-09";
const MAX_RECORDS = 512;
const MAX_FORMS = 64;
const MAX_SENSES = 24;
const MAX_LIST_VALUES = 32;
const MAX_EXAMPLES = 8;
const MAX_RESULTS = 60;
const COMPILED_PATCHES = new WeakSet();
const REVIEW_APPROVAL = new Map([
  ["codex_reviewed", false],
  ["human_approved", true]
]);

export class DictionaryPatchValidationError extends Error {
  constructor(errors) {
    const safeErrors = Array.isArray(errors) ? errors.map(String) : ["Dictionary patch is invalid."];
    super(`Dictionary patch is invalid: ${safeErrors.join("; ")}`);
    this.name = "DictionaryPatchValidationError";
    this.errors = safeErrors;
  }
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function read(value, key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function ownKeys(value) {
  try {
    return Object.keys(value);
  } catch {
    return [];
  }
}

function rejectUnknownKeys(value, allowed, path, errors) {
  if (!plainObject(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }
  for (const key of ownKeys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed.`);
  }
  return true;
}

function cleanText(value, path, errors, { max = 160, required = true } = {}) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") {
    errors.push(`${path} must be a string.`);
    return "";
  }
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (required && !normalized) errors.push(`${path} is required.`);
  if (normalized.length > max) errors.push(`${path} exceeds ${max} characters.`);
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) errors.push(`${path} contains control characters.`);
  return normalized.slice(0, max);
}

function cleanHttpsUrl(value, path, errors, { required = true } = {}) {
  const text = cleanText(value, path, errors, { max: 600, required });
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password) {
      errors.push(`${path} must be an HTTPS URL without credentials.`);
      return "";
    }
    return url.href;
  } catch {
    errors.push(`${path} must be a valid URL.`);
    return "";
  }
}

function calendarDate(value, path, errors) {
  const text = cleanText(value, path, errors, { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    errors.push(`${path} must use YYYY-MM-DD.`);
    return text;
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    errors.push(`${path} is not a real calendar date.`);
  }
  return text;
}

function cleanStringList(value, path, errors, { maxItems = MAX_LIST_VALUES, maxText = 120 } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return [];
  }
  if (value.length > maxItems) errors.push(`${path} exceeds ${maxItems} items.`);
  const seen = new Set();
  const result = [];
  for (let index = 0; index < Math.min(value.length, maxItems); index += 1) {
    const item = cleanText(value[index], `${path}[${index}]`, errors, { max: maxText });
    const key = item.toLocaleLowerCase("en-US");
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function cleanEvidence(value, path, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must contain at least one evidence item.`);
    return [];
  }
  if (value.length > 12) errors.push(`${path} exceeds 12 items.`);
  return value.slice(0, 12).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    rejectUnknownKeys(item, new Set(["label", "url", "note"]), itemPath, errors);
    return {
      label: cleanText(read(item, "label"), `${itemPath}.label`, errors, { max: 160 }),
      url: cleanHttpsUrl(read(item, "url"), `${itemPath}.url`, errors),
      note: cleanText(read(item, "note"), `${itemPath}.note`, errors, { max: 500, required: false })
    };
  });
}

function cleanReview(value, path, errors) {
  rejectUnknownKeys(
    value,
    new Set(["status", "reviewer", "reviewedOn", "humanApproved", "evidence", "sourceLicense"]),
    path,
    errors
  );
  const status = cleanText(read(value, "status"), `${path}.status`, errors, { max: 24 });
  const humanApproved = read(value, "humanApproved");
  if (!REVIEW_APPROVAL.has(status)) {
    errors.push(`${path}.status must be "codex_reviewed" or "human_approved".`);
  }
  if (typeof humanApproved !== "boolean") {
    errors.push(`${path}.humanApproved must be a boolean.`);
  } else if (REVIEW_APPROVAL.has(status) && humanApproved !== REVIEW_APPROVAL.get(status)) {
    errors.push(`${path}.humanApproved is inconsistent with status "${status}".`);
  }

  const license = read(value, "sourceLicense");
  rejectUnknownKeys(license, new Set(["name", "url", "attribution"]), `${path}.sourceLicense`, errors);
  return {
    status,
    reviewer: cleanText(read(value, "reviewer"), `${path}.reviewer`, errors, { max: 120 }),
    reviewedOn: calendarDate(read(value, "reviewedOn"), `${path}.reviewedOn`, errors),
    humanApproved: typeof humanApproved === "boolean" ? humanApproved : false,
    evidence: cleanEvidence(read(value, "evidence"), `${path}.evidence`, errors),
    sourceLicense: {
      name: cleanText(read(license, "name"), `${path}.sourceLicense.name`, errors, { max: 120 }),
      url: cleanHttpsUrl(read(license, "url"), `${path}.sourceLicense.url`, errors),
      attribution: cleanText(
        read(license, "attribution"),
        `${path}.sourceLicense.attribution`,
        errors,
        { max: 500 }
      )
    }
  };
}

function cleanForm(value, path, errors) {
  rejectUnknownKeys(value, new Set(["form", "tags"]), path, errors);
  return {
    form: cleanText(read(value, "form"), `${path}.form`, errors, { max: 120 }),
    tags: cleanStringList(read(value, "tags"), `${path}.tags`, errors)
  };
}

function cleanExample(value, path, errors) {
  rejectUnknownKeys(value, new Set(["text", "english", "tags"]), path, errors);
  return {
    text: cleanText(read(value, "text"), `${path}.text`, errors, { max: 500 }),
    english: cleanText(read(value, "english"), `${path}.english`, errors, { max: 500, required: false }),
    tags: cleanStringList(read(value, "tags"), `${path}.tags`, errors)
  };
}

function cleanSense(value, path, errors) {
  rejectUnknownKeys(
    value,
    new Set(["gloss", "rawGloss", "tags", "topics", "synonyms", "antonyms", "examples"]),
    path,
    errors
  );
  const examples = read(value, "examples");
  if (examples !== undefined && !Array.isArray(examples)) errors.push(`${path}.examples must be an array.`);
  if (Array.isArray(examples) && examples.length > MAX_EXAMPLES) {
    errors.push(`${path}.examples exceeds ${MAX_EXAMPLES} items.`);
  }
  return {
    gloss: cleanText(read(value, "gloss"), `${path}.gloss`, errors, { max: 500 }),
    rawGloss: cleanText(read(value, "rawGloss"), `${path}.rawGloss`, errors, { max: 700, required: false }),
    tags: cleanStringList(read(value, "tags"), `${path}.tags`, errors),
    topics: cleanStringList(read(value, "topics"), `${path}.topics`, errors),
    synonyms: cleanStringList(read(value, "synonyms"), `${path}.synonyms`, errors, { maxText: 160 }),
    antonyms: cleanStringList(read(value, "antonyms"), `${path}.antonyms`, errors, { maxText: 160 }),
    examples: Array.isArray(examples)
      ? examples.slice(0, MAX_EXAMPLES).map((item, index) => cleanExample(item, `${path}.examples[${index}]`, errors))
      : []
  };
}

function exactKey(value) {
  return String(value || "").normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("cs-CZ");
}

export function normalizeCzechPatchSearch(value) {
  return exactKey(value).normalize("NFD").replace(/\p{M}/gu, "");
}

function hash32(value, seed) {
  let hash = seed >>> 0;
  for (const character of value) {
    const code = character.codePointAt(0);
    hash ^= code;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function canonicalRecordKey(record, dictionaryKey) {
  const kind = read(record, "kind");
  if (kind === "add-entry") {
    const lemma = exactKey(read(record, "lemma"));
    const pos = exactKey(read(record, "pos"));
    return lemma && pos ? [PATCH_SCHEMA, dictionaryKey, kind, lemma, pos].join("|") : "";
  }
  if (kind === "form-alias") {
    const target = read(record, "target");
    const form = exactKey(read(record, "form"));
    const lemma = exactKey(read(target, "lemma"));
    const pos = exactKey(read(target, "pos"));
    return form && lemma && pos ? [PATCH_SCHEMA, dictionaryKey, kind, form, lemma, pos].join("|") : "";
  }
  return "";
}

export function stableDictionaryPatchRecordId(record, dictionaryKey) {
  const key = canonicalRecordKey(record, exactKey(dictionaryKey));
  if (!key) return "";
  const kind = read(record, "kind") === "form-alias" ? "alias" : "entry";
  return `dp1-${kind}-${hash32(key, 0x811c9dc5)}${hash32(key, 0x9e3779b9)}`;
}

function cleanAddEntry(record, path, dictionaryKey, errors) {
  rejectUnknownKeys(record, new Set(["kind", "lemma", "pos", "sourceUrl", "forms", "senses", "review"]), path, errors);
  const forms = read(record, "forms");
  const senses = read(record, "senses");
  if (forms !== undefined && !Array.isArray(forms)) errors.push(`${path}.forms must be an array.`);
  if (Array.isArray(forms) && forms.length > MAX_FORMS) errors.push(`${path}.forms exceeds ${MAX_FORMS} items.`);
  if (!Array.isArray(senses) || senses.length === 0) errors.push(`${path}.senses must contain at least one sense.`);
  if (Array.isArray(senses) && senses.length > MAX_SENSES) errors.push(`${path}.senses exceeds ${MAX_SENSES} items.`);

  const result = {
    kind: "add-entry",
    lemma: cleanText(read(record, "lemma"), `${path}.lemma`, errors, { max: 120 }),
    pos: cleanText(read(record, "pos"), `${path}.pos`, errors, { max: 60 }),
    sourceUrl: cleanHttpsUrl(read(record, "sourceUrl"), `${path}.sourceUrl`, errors),
    forms: Array.isArray(forms)
      ? forms.slice(0, MAX_FORMS).map((item, index) => cleanForm(item, `${path}.forms[${index}]`, errors))
      : [],
    senses: Array.isArray(senses)
      ? senses.slice(0, MAX_SENSES).map((item, index) => cleanSense(item, `${path}.senses[${index}]`, errors))
      : [],
    review: cleanReview(read(record, "review"), `${path}.review`, errors)
  };
  result.id = stableDictionaryPatchRecordId(result, dictionaryKey);
  return result;
}

function cleanAlias(record, path, dictionaryKey, errors) {
  rejectUnknownKeys(record, new Set(["kind", "form", "tags", "target", "review"]), path, errors);
  const target = read(record, "target");
  rejectUnknownKeys(target, new Set(["lemma", "pos"]), `${path}.target`, errors);
  const result = {
    kind: "form-alias",
    form: cleanText(read(record, "form"), `${path}.form`, errors, { max: 120 }),
    tags: cleanStringList(read(record, "tags"), `${path}.tags`, errors),
    target: {
      lemma: cleanText(read(target, "lemma"), `${path}.target.lemma`, errors, { max: 120 }),
      pos: cleanText(read(target, "pos"), `${path}.target.pos`, errors, { max: 60 })
    },
    review: cleanReview(read(record, "review"), `${path}.review`, errors)
  };
  result.id = stableDictionaryPatchRecordId(result, dictionaryKey);
  return result;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function parsePatch(raw) {
  const errors = [];
  if (!rejectUnknownKeys(raw, new Set(["schema", "dictionaryKey", "direction", "records"]), "$", errors)) {
    return { errors, patch: null };
  }
  const schema = cleanText(read(raw, "schema"), "$.schema", errors, { max: 80 });
  const dictionaryKey = cleanText(read(raw, "dictionaryKey"), "$.dictionaryKey", errors, { max: 120 });
  const direction = cleanText(read(raw, "direction"), "$.direction", errors, { max: 24 });
  if (schema !== PATCH_SCHEMA) errors.push(`$.schema must be "${PATCH_SCHEMA}".`);
  if (dictionaryKey !== PATCH_DICTIONARY_KEY) {
    errors.push(`$.dictionaryKey must be "${PATCH_DICTIONARY_KEY}".`);
  }
  if (direction !== PATCH_DIRECTION) errors.push(`$.direction must be "${PATCH_DIRECTION}".`);

  const records = read(raw, "records");
  if (!Array.isArray(records)) errors.push("$.records must be an array.");
  if (Array.isArray(records) && records.length > MAX_RECORDS) errors.push(`$.records exceeds ${MAX_RECORDS} items.`);
  const entries = [];
  const aliases = [];
  const seenIds = new Map();
  for (let index = 0; index < Math.min(Array.isArray(records) ? records.length : 0, MAX_RECORDS); index += 1) {
    const record = records[index];
    const path = `$.records[${index}]`;
    if (!plainObject(record)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    const kind = read(record, "kind");
    const compiled = kind === "add-entry"
      ? cleanAddEntry(record, path, dictionaryKey, errors)
      : kind === "form-alias"
        ? cleanAlias(record, path, dictionaryKey, errors)
        : null;
    if (!compiled) {
      errors.push(`${path}.kind must be "add-entry" or "form-alias".`);
      continue;
    }
    if (!compiled.id) errors.push(`${path} could not receive a stable ID.`);
    const previous = seenIds.get(compiled.id);
    if (previous) errors.push(`${path} duplicates ${previous}.`);
    else seenIds.set(compiled.id, path);
    if (compiled.kind === "add-entry") entries.push(compiled);
    else aliases.push(compiled);
  }

  entries.sort((left, right) => left.id.localeCompare(right.id));
  aliases.sort((left, right) => left.id.localeCompare(right.id));
  return {
    errors,
    patch: { schema, dictionaryKey, direction, entries, aliases }
  };
}

export function tryCompileDictionaryPatch(raw) {
  try {
    const { errors, patch } = parsePatch(raw);
    if (errors.length || !patch) return { ok: false, errors: [...errors] };
    deepFreeze(patch);
    COMPILED_PATCHES.add(patch);
    return { ok: true, patch, errors: [] };
  } catch {
    return { ok: false, errors: ["Dictionary patch could not be read safely."] };
  }
}

export function compileDictionaryPatch(raw) {
  const result = tryCompileDictionaryPatch(raw);
  if (!result.ok) throw new DictionaryPatchValidationError(result.errors);
  return result.patch;
}

function clampLimit(value, fallback = 30) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(MAX_RESULTS, Math.max(1, number)) : fallback;
}

function matchingTerm(entry, query, { prefix = true } = {}) {
  const foldedQuery = normalizeCzechPatchSearch(query);
  const exactQuery = exactKey(query);
  if (!foldedQuery) return null;
  const terms = [
    { kind: "lemma", value: entry.lemma },
    ...entry.forms.map((form) => ({ kind: "form", value: form.form }))
  ];
  let best = null;
  for (const term of terms) {
    const folded = normalizeCzechPatchSearch(term.value);
    const exact = exactKey(term.value);
    let rank = -1;
    if (exact === exactQuery) rank = term.kind === "lemma" ? 0 : 1;
    else if (folded === foldedQuery) rank = term.kind === "lemma" ? 2 : 3;
    else if (prefix && exact.startsWith(exactQuery)) rank = term.kind === "lemma" ? 4 : 5;
    else if (prefix && folded.startsWith(foldedQuery)) rank = term.kind === "lemma" ? 6 : 7;
    if (rank >= 0 && (!best || rank < best.rank)) best = { ...term, rank };
  }
  return best;
}

function apiSense(sense, index, patchId) {
  return {
    sourceSenseId: `${patchId}-sense-${index + 1}`,
    position: index + 1,
    gloss: sense.gloss,
    rawGloss: sense.rawGloss || sense.gloss,
    tags: [...sense.tags],
    topics: [...sense.topics],
    synonyms: [...sense.synonyms],
    antonyms: [...sense.antonyms],
    examples: sense.examples.map((example) => ({
      text: example.text,
      english: example.english,
      tags: [...example.tags]
    }))
  };
}

function materializeAddedEntry(entry, match) {
  return {
    id: entry.id,
    patchId: entry.id,
    lemma: entry.lemma,
    pos: entry.pos,
    sourceUrl: entry.sourceUrl,
    matchedBy: match.kind,
    matchedTerm: match.value,
    forms: entry.forms.map((form) => ({ form: form.form, tags: [...form.tags] })),
    senses: entry.senses.map((sense, index) => apiSense(sense, index, entry.id))
  };
}

export function searchDictionaryPatch(patch, query, { limit = 30, prefix = true } = {}) {
  const safeLimit = clampLimit(limit);
  const safeQuery = String(query || "").normalize("NFC").trim().slice(0, 120);
  if (!COMPILED_PATCHES.has(patch) || !normalizeCzechPatchSearch(safeQuery)) {
    return { query: safeQuery, normalizedQuery: normalizeCzechPatchSearch(safeQuery), direction: PATCH_DIRECTION, returned: 0, limit: safeLimit, results: [] };
  }
  const results = patch.entries
    .map((entry) => ({ entry, match: matchingTerm(entry, safeQuery, { prefix }) }))
    .filter((candidate) => candidate.match)
    .sort((left, right) => left.match.rank - right.match.rank || left.entry.id.localeCompare(right.entry.id))
    .slice(0, safeLimit)
    .map(({ entry, match }) => materializeAddedEntry(entry, match));
  return {
    query: safeQuery,
    normalizedQuery: normalizeCzechPatchSearch(safeQuery),
    direction: patch.direction,
    returned: results.length,
    limit: safeLimit,
    results
  };
}

function matchingAliases(patch, query, { prefix = true } = {}) {
  if (!COMPILED_PATCHES.has(patch)) return [];
  const foldedQuery = normalizeCzechPatchSearch(query);
  const exactQuery = exactKey(query);
  if (!foldedQuery) return [];
  return patch.aliases
    .map((alias) => {
      const exact = exactKey(alias.form);
      const folded = normalizeCzechPatchSearch(alias.form);
      let rank = -1;
      if (exact === exactQuery) rank = 0;
      else if (folded === foldedQuery) rank = 1;
      else if (prefix && exact.startsWith(exactQuery)) rank = 2;
      else if (prefix && folded.startsWith(foldedQuery)) rank = 3;
      return { alias, rank };
    })
    .filter((candidate) => candidate.rank >= 0)
    .sort((left, right) => left.rank - right.rank || left.alias.id.localeCompare(right.alias.id));
}

export function discoverDictionaryAliasTargets(patch, query, { prefix = true } = {}) {
  const grouped = new Map();
  for (const { alias } of matchingAliases(patch, query, { prefix })) {
    const key = `${exactKey(alias.target.lemma)}|${exactKey(alias.target.pos)}`;
    if (!grouped.has(key)) {
      grouped.set(key, { lemma: alias.target.lemma, pos: alias.target.pos, aliasIds: [], forms: [] });
    }
    const target = grouped.get(key);
    target.aliasIds.push(alias.id);
    target.forms.push({ form: alias.form, tags: [...alias.tags] });
  }
  return [...grouped.values()];
}

function sourceEntries(payloads) {
  const queue = Array.isArray(payloads) ? payloads : [payloads];
  const entries = [];
  for (const value of queue) {
    if (Array.isArray(value)) entries.push(...value);
    else if (Array.isArray(read(value, "results"))) entries.push(...read(value, "results"));
    else if (plainObject(value) && read(value, "lemma")) entries.push(value);
  }
  return entries;
}

function safeApiString(value, max = 700) {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, max);
}

function safeApiList(value, max = MAX_LIST_VALUES) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => safeApiString(item, 160)).filter(Boolean);
}

function safeApiEntry(value) {
  if (!plainObject(value)) return null;
  const lemma = safeApiString(read(value, "lemma"), 120);
  const pos = safeApiString(read(value, "pos"), 60);
  if (!lemma || !pos) return null;
  const rawId = read(value, "id");
  const id = typeof rawId === "string" || (typeof rawId === "number" && Number.isFinite(rawId)) ? rawId : "";
  const patchId = safeApiString(read(value, "patchId"), 160);
  const forms = Array.isArray(read(value, "forms")) ? read(value, "forms") : [];
  const senses = Array.isArray(read(value, "senses")) ? read(value, "senses") : [];
  return {
    id,
    ...(patchId ? { patchId } : {}),
    lemma,
    pos,
    sourceUrl: safeApiString(read(value, "sourceUrl"), 600),
    matchedBy: safeApiString(read(value, "matchedBy"), 24),
    matchedTerm: safeApiString(read(value, "matchedTerm"), 120),
    forms: forms.slice(0, MAX_FORMS).map((form) => ({
      form: safeApiString(read(form, "form"), 120),
      tags: safeApiList(read(form, "tags"))
    })).filter((form) => form.form),
    senses: senses.slice(0, MAX_SENSES).map((sense, index) => ({
      sourceSenseId: safeApiString(read(sense, "sourceSenseId"), 160),
      position: Number.isFinite(Number(read(sense, "position"))) ? Math.floor(Number(read(sense, "position"))) : index + 1,
      gloss: safeApiString(read(sense, "gloss"), 500),
      rawGloss: safeApiString(read(sense, "rawGloss"), 700),
      tags: safeApiList(read(sense, "tags")),
      topics: safeApiList(read(sense, "topics")),
      synonyms: safeApiList(read(sense, "synonyms")),
      antonyms: safeApiList(read(sense, "antonyms")),
      examples: (Array.isArray(read(sense, "examples")) ? read(sense, "examples") : [])
        .slice(0, MAX_LIST_VALUES)
        .map((example) => ({
          text: safeApiString(read(example, "text"), 500),
          english: safeApiString(read(example, "english"), 500),
          tags: safeApiList(read(example, "tags"))
        }))
        .filter((example) => example.text)
    })).filter((sense) => sense.gloss)
  };
}

function entryIdentity(entry) {
  if (entry.id !== "") return `${typeof entry.id}:${entry.id}`;
  return `lexical:${exactKey(entry.lemma)}|${exactKey(entry.pos)}|${exactKey(entry.sourceUrl)}`;
}

export function dedupeDictionaryResults(results, { limit = MAX_RESULTS } = {}) {
  const safeLimit = clampLimit(limit, MAX_RESULTS);
  const seen = new Set();
  const deduped = [];
  for (const raw of sourceEntries(results)) {
    const entry = safeApiEntry(raw);
    if (!entry) continue;
    const key = entryIdentity(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
    if (deduped.length >= safeLimit) break;
  }
  return deduped;
}

function aliasTargetMatches(entry, alias, foldedFallback) {
  if (exactKey(entry.pos) !== exactKey(alias.target.pos)) return false;
  return foldedFallback
    ? normalizeCzechPatchSearch(entry.lemma) === normalizeCzechPatchSearch(alias.target.lemma)
    : exactKey(entry.lemma) === exactKey(alias.target.lemma);
}

export function materializeDictionaryAliasResults(patch, query, basePayloads, { limit = MAX_RESULTS, prefix = true } = {}) {
  const safeLimit = clampLimit(limit, MAX_RESULTS);
  const baseEntries = dedupeDictionaryResults(basePayloads, { limit: MAX_RESULTS });
  const results = [];
  for (const { alias } of matchingAliases(patch, query, { prefix })) {
    let targets = baseEntries.filter((entry) => aliasTargetMatches(entry, alias, false));
    if (!targets.length) targets = baseEntries.filter((entry) => aliasTargetMatches(entry, alias, true));
    for (const target of targets) {
      const forms = [...target.forms];
      if (!forms.some((item) => exactKey(item.form) === exactKey(alias.form))) {
        forms.push({ form: alias.form, tags: [...alias.tags] });
      }
      results.push({
        ...target,
        patchId: alias.id,
        matchedBy: "form",
        matchedTerm: alias.form,
        forms
      });
    }
  }
  return dedupeDictionaryResults(results, { limit: safeLimit }).map((entry, index) => {
    const source = results.find((candidate) => entryIdentity(candidate) === entryIdentity(entry));
    return source ? { ...entry, patchId: source.patchId } : entry;
  });
}

export function mergeDictionarySearchPayload(basePayload, overlayPayload, { limit } = {}) {
  const baseLimit = clampLimit(read(basePayload, "limit"), 30);
  const safeLimit = clampLimit(limit, baseLimit);
  const overlayResults = sourceEntries(overlayPayload);
  const baseResults = sourceEntries(basePayload);
  const results = dedupeDictionaryResults([...overlayResults, ...baseResults], { limit: safeLimit });
  const query = safeApiString(read(basePayload, "query") || read(overlayPayload, "query"), 120);
  return {
    query,
    normalizedQuery: normalizeCzechPatchSearch(query),
    direction: safeApiString(read(basePayload, "direction") || read(overlayPayload, "direction"), 24) || PATCH_DIRECTION,
    returned: results.length,
    limit: safeLimit,
    results
  };
}

export { PATCH_SCHEMA as DICTIONARY_PATCH_SCHEMA };
