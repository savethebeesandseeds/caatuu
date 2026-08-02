export const MORPHOLOGY_CATALOG_SCHEMA = "caatuu-morphology-developer-pilot-v1";
export const MORPHOLOGY_ROUND_SCHEMA = "caatuu-morphology-selection-round-v1";

const REVIEW_STATUSES = new Set([
  "prototype-not-human-approved",
  "human-approved",
  "rejected"
]);
const AMBIGUITY_MODES = new Set(["none", "cue-resolved"]);
const VISIBLE_CUE_PRESENTATION_FIELDS = [
  "roleTokenEn",
  "contextEn",
  "naturalTranslationEn",
  "teachingLabelEn"
];

export class MorphologyRoundError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MorphologyRoundError";
    this.code = code;
    this.details = deepFreeze(details);
  }
}

function fail(code, message, details = {}) {
  throw new MorphologyRoundError(code, message, details);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedString(value, path, { trim = true } = {}) {
  if (typeof value !== "string") {
    fail("MORPH_VALUE_INVALID", `${path} must be a string.`, { path });
  }
  const normalized = (trim ? value.trim() : value).normalize("NFC");
  if (!normalized.trim()) {
    fail("MORPH_VALUE_INVALID", `${path} must not be empty.`, { path });
  }
  return normalized;
}

function normalizedRevision(value, path) {
  if (!Number.isInteger(value) || value < 1) {
    fail("MORPH_REVISION_INVALID", `${path} must be a positive integer.`, { path });
  }
  return value;
}

function normalizeEntityRef(value, path) {
  if (!isObject(value)) {
    fail("MORPH_REF_INVALID", `${path} must be an id/revision reference.`, { path });
  }
  return deepFreeze({
    id: normalizedString(value.id, `${path}/id`),
    revision: normalizedRevision(value.revision, `${path}/revision`)
  });
}

function normalizeCatalogRef(value, path) {
  if (!isObject(value)) {
    fail("MORPH_REF_INVALID", `${path} must be an id/version reference.`, { path });
  }
  return deepFreeze({
    id: normalizedString(value.id, `${path}/id`),
    version: normalizedString(value.version, `${path}/version`)
  });
}

function sameEntityRef(left, right) {
  return left?.id === right?.id && left?.revision === right?.revision;
}

function normalizeJsonValue(value, path, ancestors = new WeakSet()) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("MORPH_PAYLOAD_INVALID", `${path} contains a non-finite number.`, { path });
    }
    return value;
  }
  if (!value || typeof value !== "object") {
    fail("MORPH_PAYLOAD_INVALID", `${path} must contain JSON-compatible values.`, { path });
  }
  if (ancestors.has(value)) {
    fail("MORPH_PAYLOAD_INVALID", `${path} contains a circular reference.`, { path });
  }
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((entry, index) => normalizeJsonValue(entry, `${path}/${index}`, ancestors));
  } else {
    const entries = [];
    const seenKeys = new Set();
    for (const [rawKey, entry] of Object.entries(value)) {
      const key = rawKey.normalize("NFC");
      if (seenKeys.has(key)) {
        fail("MORPH_PAYLOAD_INVALID", `${path} has NFC-equivalent object keys.`, { path, key });
      }
      seenKeys.add(key);
      entries.push([key, normalizeJsonValue(entry, `${path}/${key}`, ancestors)]);
    }
    result = Object.fromEntries(entries);
  }
  ancestors.delete(value);
  return deepFreeze(result);
}

function stableStringify(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort(compareStrings).map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(",")}}`;
}

function normalizeReview(value, path) {
  if (!isObject(value)) {
    fail("MORPH_REVIEW_INVALID", `${path} must declare a review status.`, { path });
  }
  const status = normalizedString(value.status, `${path}/status`);
  if (!REVIEW_STATUSES.has(status)) {
    fail("MORPH_REVIEW_INVALID", `${path}/status is not supported.`, { path: `${path}/status`, status });
  }
  const extra = Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "status")
    .map(([key, entry]) => [key.normalize("NFC"), normalizeJsonValue(entry, `${path}/${key}`)]));
  return deepFreeze({ status, ...extra });
}

function normalizeAmbiguity(value, path) {
  if (!isObject(value)) {
    fail(
      "MORPH_AMBIGUITY_UNDECLARED",
      `${path} must explicitly declare whether the item is ambiguous.`,
      { path }
    );
  }
  const mode = normalizedString(value.mode, `${path}/mode`);
  if (!AMBIGUITY_MODES.has(mode)) {
    fail("MORPH_AMBIGUITY_INVALID", `${path}/mode is not supported.`, { path: `${path}/mode`, mode });
  }
  if (mode === "none") {
    if (value.resolutionKey != null) {
      fail(
        "MORPH_AMBIGUITY_INVALID",
        `${path} cannot provide a resolution key when its mode is none.`,
        { path }
      );
    }
    return deepFreeze({ mode });
  }
  return deepFreeze({
    mode,
    resolutionKey: normalizedString(value.resolutionKey, `${path}/resolutionKey`)
  });
}

function normalizeAcceptedVariants(value, surface, path) {
  const variants = value == null ? [] : value;
  if (!Array.isArray(variants)) {
    fail("MORPH_VARIANTS_INVALID", `${path} must be an array.`, { path });
  }
  const normalized = variants.map((entry, index) => normalizedString(entry, `${path}/${index}`));
  const seen = new Set([surface]);
  for (const variant of normalized) {
    if (seen.has(variant)) {
      fail(
        "MORPH_VARIANT_DUPLICATE",
        `${path} contains the primary surface or an NFC-equivalent duplicate.`,
        { path, surface: variant }
      );
    }
    seen.add(variant);
  }
  return deepFreeze(normalized.sort(compareStrings));
}

function normalizeMorphologyItemAt(value, path) {
  if (!isObject(value)) {
    fail("MORPH_ITEM_INVALID", `${path} must be an object.`, { path });
  }
  const surface = normalizedString(value.surface, `${path}/surface`);
  const features = normalizeJsonValue(value.features, `${path}/features`);
  if (!isObject(features) || Object.keys(features).length === 0) {
    fail("MORPH_FEATURES_INVALID", `${path}/features must be a non-empty object.`, {
      path: `${path}/features`
    });
  }
  const normalized = {
    id: normalizedString(value.id, `${path}/id`),
    revision: normalizedRevision(value.revision, `${path}/revision`),
    familyRef: normalizeEntityRef(value.familyRef, `${path}/familyRef`),
    surface,
    acceptedVariants: normalizeAcceptedVariants(value.acceptedVariants, surface, `${path}/acceptedVariants`),
    featureKey: normalizedString(value.featureKey, `${path}/featureKey`),
    features,
    ambiguity: normalizeAmbiguity(value.ambiguity, `${path}/ambiguity`),
    review: normalizeReview(value.review, `${path}/review`)
  };
  if (value.metadata != null) normalized.metadata = normalizeJsonValue(value.metadata, `${path}/metadata`);
  return deepFreeze(normalized);
}

export function normalizeMorphologyItem(value) {
  return normalizeMorphologyItemAt(value, "/item");
}

function normalizeFamily(value, path) {
  if (!isObject(value)) {
    fail("MORPH_FAMILY_INVALID", `${path} must be an object.`, { path });
  }
  const normalized = {
    id: normalizedString(value.id, `${path}/id`),
    revision: normalizedRevision(value.revision, `${path}/revision`),
    lemmaRef: normalizeEntityRef(value.lemmaRef, `${path}/lemmaRef`),
    review: normalizeReview(value.review, `${path}/review`)
  };
  if (value.metadata != null) normalized.metadata = normalizeJsonValue(value.metadata, `${path}/metadata`);
  return deepFreeze(normalized);
}

function normalizeCue(value, path) {
  if (!isObject(value)) {
    fail("MORPH_CUE_INVALID", `${path} must be an object.`, { path });
  }
  const normalized = {
    id: normalizedString(value.id, `${path}/id`),
    revision: normalizedRevision(value.revision, `${path}/revision`),
    familyRef: normalizeEntityRef(value.familyRef, `${path}/familyRef`),
    targetItemRef: normalizeEntityRef(value.targetItemRef, `${path}/targetItemRef`),
    key: normalizedString(value.key, `${path}/key`),
    presentation: normalizeJsonValue(value.presentation, `${path}/presentation`),
    ambiguityResolutionKey: value.ambiguityResolutionKey == null
      ? null
      : normalizedString(value.ambiguityResolutionKey, `${path}/ambiguityResolutionKey`),
    review: normalizeReview(value.review, `${path}/review`)
  };
  if (value.metadata != null) normalized.metadata = normalizeJsonValue(value.metadata, `${path}/metadata`);
  return deepFreeze(normalized);
}

function duplicateId(values) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value.id)) return value.id;
    seen.add(value.id);
  }
  return null;
}

function responseDomain(item) {
  return [item.surface, ...item.acceptedVariants];
}

function visibleCuePresentationKey(presentation, path) {
  if (!isObject(presentation)) {
    fail("MORPH_CUE_PRESENTATION_INVALID", `${path} must be an object.`, { path });
  }
  const projection = {};
  for (const field of VISIBLE_CUE_PRESENTATION_FIELDS) {
    const value = presentation[field];
    if (typeof value !== "string" || !value.trim()) {
      fail(
        "MORPH_CUE_PRESENTATION_INVALID",
        `${path}/${field} is required because it is visible before the learner answers.`,
        { path: `${path}/${field}` }
      );
    }
    projection[field] = value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
  }
  return stableStringify(projection);
}

function resolveEntityRef(rows, ref, kind, path) {
  const byId = rows.find((row) => row.id === ref.id);
  if (!byId) {
    fail(`MORPH_${kind}_REF_UNKNOWN`, `${path} refers to an unknown ${kind.toLowerCase()}.`, {
      path,
      ref
    });
  }
  if (byId.revision !== ref.revision) {
    fail(`MORPH_${kind}_REF_STALE`, `${path} has a stale ${kind.toLowerCase()} revision.`, {
      path,
      ref,
      currentRevision: byId.revision
    });
  }
  return byId;
}

function validateFamilyDomains(family, items, cues) {
  if (items.length < 2) {
    fail(
      "MORPH_FAMILY_TOO_SMALL",
      `Morphology family ${family.id} requires at least two contrasting items.`,
      { familyRef: { id: family.id, revision: family.revision } }
    );
  }

  const featureOwners = new Map();
  const surfaceOwners = new Map();
  for (const item of items) {
    if (featureOwners.has(item.featureKey)) {
      fail(
        "MORPH_FEATURE_COLLISION",
        `Morphology family ${family.id} contains duplicate feature keys.`,
        { familyId: family.id, featureKey: item.featureKey, itemIds: [featureOwners.get(item.featureKey), item.id] }
      );
    }
    featureOwners.set(item.featureKey, item.id);
    for (const surface of responseDomain(item)) {
      if (surfaceOwners.has(surface)) {
        fail(
          "MORPH_SURFACE_COLLISION",
          `Morphology family ${family.id} has two answers accepting the same NFC-normalized surface.`,
          { familyId: family.id, surface, itemIds: [surfaceOwners.get(surface), item.id] }
        );
      }
      surfaceOwners.set(surface, item.id);
    }
  }

  const cueKeyOwners = new Map();
  const presentationOwners = new Map();
  const targetCounts = new Map(items.map((item) => [item.id, 0]));
  for (const cue of cues) {
    if (cueKeyOwners.has(cue.key)) {
      fail(
        "MORPH_CUE_COLLISION",
        `Morphology family ${family.id} contains duplicate cue keys.`,
        { familyId: family.id, cueKey: cue.key, cueIds: [cueKeyOwners.get(cue.key), cue.id] }
      );
    }
    cueKeyOwners.set(cue.key, cue.id);
    const presentationKey = visibleCuePresentationKey(cue.presentation, `/cues/${cue.id}/presentation`);
    if (presentationOwners.has(presentationKey)) {
      fail(
        "MORPH_CUE_COLLISION",
        `Morphology family ${family.id} contains equivalent visible cue presentations.`,
        { familyId: family.id, cueIds: [presentationOwners.get(presentationKey), cue.id] }
      );
    }
    presentationOwners.set(presentationKey, cue.id);
    targetCounts.set(cue.targetItemRef.id, Number(targetCounts.get(cue.targetItemRef.id) || 0) + 1);
    const target = items.find((item) => sameEntityRef(item, cue.targetItemRef));
    if (target.ambiguity.mode === "cue-resolved") {
      if (cue.ambiguityResolutionKey !== target.ambiguity.resolutionKey) {
        fail(
          "MORPH_AMBIGUITY_UNRESOLVED",
          `Cue ${cue.id} does not resolve the declared ambiguity of ${target.id}.`,
          { cueId: cue.id, itemId: target.id }
        );
      }
    } else if (cue.ambiguityResolutionKey !== null) {
      fail(
        "MORPH_AMBIGUITY_UNDECLARED",
        `Cue ${cue.id} declares ambiguity handling for an unambiguous item.`,
        { cueId: cue.id, itemId: target.id }
      );
    }
  }

  for (const item of items) {
    if (!targetCounts.get(item.id)) {
      fail(
        "MORPH_ITEM_UNTARGETED",
        `Morphology item ${item.id} has no cue.`,
        { familyId: family.id, itemId: item.id }
      );
    }
  }
}

function validateCrossFamilyAmbiguity(items) {
  const owners = new Map();
  for (const item of items) {
    for (const surface of responseDomain(item)) {
      const prior = owners.get(surface) || [];
      for (const other of prior) {
        if (other.familyRef.id === item.familyRef.id) continue;
        if (other.ambiguity.mode !== "cue-resolved" || item.ambiguity.mode !== "cue-resolved") {
          fail(
            "MORPH_AMBIGUITY_UNHANDLED",
            "An NFC-equivalent surface appears in multiple lemma families without explicit cue resolution.",
            { surface, itemIds: [other.id, item.id] }
          );
        }
      }
      prior.push(item);
      owners.set(surface, prior);
    }
  }
}

export function normalizeMorphologyCatalog(value) {
  if (!isObject(value)) {
    fail("MORPH_CATALOG_INVALID", "Morphology catalog must be an object.", { path: "/" });
  }
  if (value.schemaVersion !== MORPHOLOGY_CATALOG_SCHEMA) {
    fail(
      "MORPH_CATALOG_SCHEMA",
      `Morphology catalog must use ${MORPHOLOGY_CATALOG_SCHEMA}.`,
      { path: "/schemaVersion" }
    );
  }
  for (const [name, rows] of [["families", value.families], ["items", value.items], ["cues", value.cues]]) {
    if (!Array.isArray(rows) || rows.length === 0) {
      fail("MORPH_CATALOG_INVALID", `/${name} must be a non-empty array.`, { path: `/${name}` });
    }
  }

  const families = value.families.map((entry, index) => normalizeFamily(entry, `/families/${index}`));
  const items = value.items.map((entry, index) => normalizeMorphologyItemAt(entry, `/items/${index}`));
  const cues = value.cues.map((entry, index) => normalizeCue(entry, `/cues/${index}`));
  for (const [name, rows] of [["family", families], ["item", items], ["cue", cues]]) {
    const id = duplicateId(rows);
    if (id) {
      fail("MORPH_ID_DUPLICATE", `Morphology catalog contains duplicate ${name} id ${id}.`, {
        collection: `${name}s`,
        id
      });
    }
  }

  for (const item of items) {
    resolveEntityRef(families, item.familyRef, "FAMILY", `/items/${item.id}/familyRef`);
  }
  for (const cue of cues) {
    const family = resolveEntityRef(families, cue.familyRef, "FAMILY", `/cues/${cue.id}/familyRef`);
    const target = resolveEntityRef(items, cue.targetItemRef, "ITEM", `/cues/${cue.id}/targetItemRef`);
    if (target.familyRef.id !== family.id || target.familyRef.revision !== family.revision) {
      fail(
        "MORPH_CUE_TARGET_FAMILY_MISMATCH",
        `Cue ${cue.id} and its target item must belong to the same lemma family.`,
        { cueId: cue.id, targetItemId: target.id }
      );
    }
  }

  for (const family of families) {
    validateFamilyDomains(
      family,
      items.filter((item) => sameEntityRef(item.familyRef, family)),
      cues.filter((cue) => sameEntityRef(cue.familyRef, family))
    );
  }
  validateCrossFamilyAmbiguity(items);

  const normalized = {
    schemaVersion: MORPHOLOGY_CATALOG_SCHEMA,
    catalogId: normalizedString(value.catalogId, "/catalogId"),
    version: normalizedString(value.version, "/version"),
    targetLocale: normalizedString(value.targetLocale, "/targetLocale"),
    review: normalizeReview(value.review, "/review"),
    families: deepFreeze([...families].sort((left, right) => compareStrings(left.id, right.id))),
    items: deepFreeze([...items].sort((left, right) => compareStrings(left.id, right.id))),
    cues: deepFreeze([...cues].sort((left, right) => compareStrings(left.id, right.id)))
  };
  if (value.metadata != null) normalized.metadata = normalizeJsonValue(value.metadata, "/metadata");
  return deepFreeze(normalized);
}

function copyCatalogBytes(value) {
  const isArrayBuffer = typeof ArrayBuffer === "function" && value instanceof ArrayBuffer;
  const isUint8Array = typeof Uint8Array === "function" && value instanceof Uint8Array;
  if (!isArrayBuffer && !isUint8Array) {
    fail(
      "MORPH_CATALOG_BYTES_INVALID",
      "Pinned morphology catalog bytes must be an ArrayBuffer or Uint8Array."
    );
  }

  try {
    const source = isArrayBuffer ? new Uint8Array(value) : value;
    const copy = new Uint8Array(source.byteLength);
    copy.set(source);
    return copy;
  } catch {
    fail(
      "MORPH_CATALOG_BYTES_INVALID",
      "Pinned morphology catalog bytes could not be read."
    );
  }
}

function normalizeCatalogDigest(value) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail(
      "MORPH_CATALOG_DIGEST_INVALID",
      "Pinned morphology catalog digest must use lowercase sha256:<64 hex characters>."
    );
  }
  return value;
}

function digestFailureReason(error) {
  return error && typeof error.name === "string" ? error.name : "digest-failed";
}

function hexDigest(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function resolvePinnedMorphologyCatalog(catalogBytes, catalogDigest) {
  const bytes = copyCatalogBytes(catalogBytes);
  const expectedDigest = normalizeCatalogDigest(catalogDigest);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    fail(
      "MORPH_WEB_CRYPTO_UNAVAILABLE",
      "Web Crypto SHA-256 support is required to resolve a pinned morphology catalog."
    );
  }

  let digestBytes;
  try {
    digestBytes = new Uint8Array(await subtle.digest("SHA-256", bytes));
  } catch (error) {
    fail(
      "MORPH_WEB_CRYPTO_UNAVAILABLE",
      "Web Crypto could not calculate the pinned morphology catalog digest.",
      { reason: digestFailureReason(error) }
    );
  }
  if (digestBytes.byteLength !== 32) {
    fail(
      "MORPH_WEB_CRYPTO_UNAVAILABLE",
      "Web Crypto returned an invalid SHA-256 digest."
    );
  }

  const actualDigest = `sha256:${hexDigest(digestBytes)}`;
  if (actualDigest !== expectedDigest) {
    fail(
      "MORPH_CATALOG_DIGEST_MISMATCH",
      "Pinned morphology catalog bytes do not match the expected digest.",
      { expectedDigest, actualDigest }
    );
  }

  const Decoder = globalThis.TextDecoder;
  if (typeof Decoder !== "function") {
    fail(
      "MORPH_TEXT_DECODER_UNAVAILABLE",
      "Fatal UTF-8 TextDecoder support is required to resolve a pinned morphology catalog."
    );
  }

  let decoder;
  try {
    decoder = new Decoder("utf-8", { fatal: true });
  } catch {
    fail(
      "MORPH_TEXT_DECODER_UNAVAILABLE",
      "Fatal UTF-8 TextDecoder support is required to resolve a pinned morphology catalog."
    );
  }
  if (decoder.fatal !== true || typeof decoder.decode !== "function") {
    fail(
      "MORPH_TEXT_DECODER_UNAVAILABLE",
      "The available TextDecoder cannot enforce fatal UTF-8 decoding."
    );
  }

  let catalogText;
  try {
    catalogText = decoder.decode(bytes);
  } catch {
    fail(
      "MORPH_CATALOG_UTF8_INVALID",
      "Pinned morphology catalog bytes are not valid UTF-8."
    );
  }

  let parsedCatalog;
  try {
    parsedCatalog = JSON.parse(catalogText);
  } catch {
    fail(
      "MORPH_CATALOG_JSON_INVALID",
      "Pinned morphology catalog bytes do not contain valid JSON."
    );
  }
  return normalizeMorphologyCatalog(parsedCatalog);
}

function fnv1a(value, offset) {
  let hash = offset >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function deterministicToken(value) {
  const first = fnv1a(value, 0x811c9dc5).toString(16).padStart(8, "0");
  const second = fnv1a(value, 0x9e3779b9).toString(16).padStart(8, "0");
  return `${first}${second}`;
}

function seededGenerator(value) {
  let state = fnv1a(value, 0x811c9dc5) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicShuffle(values, seed) {
  const result = [...values].sort((left, right) => compareStrings(left.id, right.id));
  const random = seededGenerator(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const replacement = Math.floor(random() * (index + 1));
    [result[index], result[replacement]] = [result[replacement], result[index]];
  }
  return result;
}

function ensureContentReview(entity, entityType, releaseMode) {
  const entityId = entity.id || entity.catalogId || "catalog";
  const visit = (value, path, ancestors = new WeakSet()) => {
    if (!value || typeof value !== "object" || ancestors.has(value)) return;
    ancestors.add(value);
    if (releaseMode
        && isObject(value.releasePolicy)
        && value.releasePolicy.status === "developer-only") {
      fail(
        "MORPH_RELEASE_DEVELOPER_ONLY",
        `Developer-only ${entityType} ${entityId} can never compose a release round.`,
        { entityType, entityId, path: `${path}/releasePolicy` }
      );
    }
    if (isObject(value.review)) {
      const status = value.review.status;
      if (status === "rejected") {
        fail("MORPH_CONTENT_REJECTED", `Rejected ${entityType} ${entityId} is not playable.`, {
          entityType,
          entityId,
          path: `${path}/review`
        });
      }
      if (releaseMode && status !== "human-approved") {
        fail(
          "MORPH_RELEASE_UNREVIEWED",
          `Release round requires every selected ${entityType} dependency to be human-approved.`,
          { entityType, entityId, path: `${path}/review`, reviewStatus: status }
        );
      }
    }
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}/${index}`, ancestors));
    } else {
      for (const [key, child] of Object.entries(value)) {
        if (key !== "review" && key !== "releasePolicy") visit(child, `${path}/${key}`, ancestors);
      }
    }
    ancestors.delete(value);
  };
  visit(entity, `/${entityType}`);
}

function resolveRequestedRef(rows, rawRef, type, path) {
  const ref = normalizeEntityRef(rawRef, path);
  return resolveEntityRef(rows, ref, type, path);
}

export function composeMorphologyRound(rawCatalog, request = {}) {
  const catalog = normalizeMorphologyCatalog(rawCatalog);
  if (!isObject(request)) {
    fail("MORPH_ROUND_REQUEST_INVALID", "Morphology round request must be an object.");
  }
  const catalogRef = normalizeCatalogRef(request.catalogRef, "/request/catalogRef");
  if (catalogRef.id !== catalog.catalogId || catalogRef.version !== catalog.version) {
    fail("MORPH_CATALOG_REF_STALE", "Morphology round request has a stale catalog reference.", {
      catalogRef,
      currentCatalogRef: { id: catalog.catalogId, version: catalog.version }
    });
  }
  const family = resolveRequestedRef(catalog.families, request.familyRef, "FAMILY", "/request/familyRef");
  const taskFingerprint = normalizedString(request.taskFingerprint, "/request/taskFingerprint");
  const releaseMode = request.releaseMode === true;
  if (request.releaseMode != null && typeof request.releaseMode !== "boolean") {
    fail("MORPH_ROUND_REQUEST_INVALID", "/request/releaseMode must be boolean.", {
      path: "/request/releaseMode"
    });
  }

  const familyItems = catalog.items.filter((item) => sameEntityRef(item.familyRef, family));
  const familyCues = catalog.cues.filter((cue) => sameEntityRef(cue.familyRef, family));
  const requestedCount = request.optionCount == null ? familyItems.length : request.optionCount;
  if (!Number.isInteger(requestedCount) || requestedCount < 2 || requestedCount > familyItems.length) {
    fail(
      "MORPH_OPTION_COUNT_INVALID",
      `Morphology round optionCount must be between 2 and ${familyItems.length}.`,
      { optionCount: requestedCount, familyId: family.id }
    );
  }

  let cue;
  if (request.cueRef != null) {
    cue = resolveRequestedRef(catalog.cues, request.cueRef, "CUE", "/request/cueRef");
    if (!sameEntityRef(cue.familyRef, family)) {
      fail("MORPH_CUE_FAMILY_MISMATCH", "Requested cue is not part of the requested family.", {
        cueId: cue.id,
        familyId: family.id
      });
    }
  } else {
    cue = deterministicShuffle(familyCues, `${taskFingerprint}|cue`)[0];
  }
  const target = resolveEntityRef(catalog.items, cue.targetItemRef, "ITEM", `/cues/${cue.id}/targetItemRef`);
  const distractors = deterministicShuffle(
    familyItems.filter((item) => item.id !== target.id),
    `${taskFingerprint}|${cue.id}|distractors`
  ).slice(0, requestedCount - 1);
  const selectedItems = [target, ...distractors];
  const orderedItems = deterministicShuffle(selectedItems, `${taskFingerprint}|${cue.id}|options`);

  ensureContentReview(catalog, "catalog", releaseMode);
  ensureContentReview(family, "family", releaseMode);
  ensureContentReview(cue, "cue", releaseMode);
  for (const item of selectedItems) ensureContentReview(item, "item", releaseMode);

  const roundCore = {
    catalogRef,
    familyRef: { id: family.id, revision: family.revision },
    taskFingerprint,
    cue: {
      cueRef: { id: cue.id, revision: cue.revision },
      key: cue.key,
      presentation: cue.presentation
    },
    options: orderedItems.map((item) => ({
      itemRef: { id: item.id, revision: item.revision },
      surface: item.surface
    })),
    targetItemRef: { id: target.id, revision: target.revision }
  };
  return deepFreeze({
    schemaVersion: MORPHOLOGY_ROUND_SCHEMA,
    roundId: `morph-${deterministicToken(stableStringify(roundCore))}`,
    ...roundCore
  });
}

export function evaluateMorphologySelection(round, selection = {}) {
  if (!isObject(round) || round.schemaVersion !== MORPHOLOGY_ROUND_SCHEMA || !Array.isArray(round.options)) {
    fail("MORPH_ROUND_INVALID", "Selection evaluation requires a composed morphology round.");
  }
  if (!isObject(selection)) {
    fail("MORPH_SELECTION_INVALID", "Morphology selection must be an object.");
  }
  const selectedRef = normalizeEntityRef(selection.itemRef, "/selection/itemRef");
  const optionWithId = round.options.find((option) => option?.itemRef?.id === selectedRef.id);
  if (!optionWithId) {
    fail("MORPH_SELECTION_NOT_IN_ROUND", "Selected morphology item is not an option in this round.", {
      selectedItemRef: selectedRef
    });
  }
  if (optionWithId.itemRef.revision !== selectedRef.revision) {
    fail("MORPH_SELECTION_REF_STALE", "Selected morphology item revision is stale.", {
      selectedItemRef: selectedRef,
      currentRevision: optionWithId.itemRef.revision
    });
  }
  const targetRef = normalizeEntityRef(round.targetItemRef, "/round/targetItemRef");
  if (!round.options.some((option) => sameEntityRef(option.itemRef, targetRef))) {
    fail("MORPH_ROUND_INVALID", "Morphology round target is not one of its options.");
  }
  const correct = sameEntityRef(selectedRef, targetRef);
  return deepFreeze({
    correct,
    score: correct ? 1 : 0,
    cueRef: normalizeEntityRef(round.cue?.cueRef, "/round/cue/cueRef"),
    selectedItemRef: selectedRef,
    targetItemRef: targetRef
  });
}
