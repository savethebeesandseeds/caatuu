export const CONJUGATION_COMET_CATALOG_SCHEMA = "caatuu-conjugation-comet-catalog-v1";

const CONTENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const REVIEW_STATUSES = new Set([
  "native-review-required",
  "native-reviewed-development",
  "release-approved",
  "legacy-review-required"
]);
const LICENSE_STATUSES = new Set([
  "release-review-required",
  "release-cleared",
  "legacy-review-required"
]);
const LEGACY_COPY = Object.freeze({
  title: "Conjugation Comet",
  meaningKicker: "Meaning check",
  meaningInstruction: "Choose the authored base-language meaning.",
  formsKicker: "Form matching",
  formsInstruction: "Match each target-language form to its base-language cue.",
  meaningTargetHeading: "Target-language verb",
  meaningChoicesHeading: "Meaning choices",
  targetFormsHeading: "Target-language forms",
  baseCuesHeading: "Base-language cues",
  meaningBoardLabel: "Meaning matching board",
  formsBoardLabel: "Form matching board",
  infinitiveLabel: "Infinitive",
  hintLabel: "Show pattern",
  nextLabel: "Next verb",
  hearVerbTemplate: "Hear {verb}",
  hearFormTemplate: "Hear {form}",
  playingTemplate: "Playing {text}",
  matchedStateLabel: "matched",
  audioUnavailableTemplate: "{language} audio is unavailable on this device.",
  meaningStartFeedback: "Choose the base-language meaning before matching the forms.",
  wrongMeaningFeedback: "That is a different verb. Try another meaning.",
  correctMeaningTemplate: "Correct: {meaning}.",
  formsStartFeedback: "You may select either column first.",
  pairSelectedFeedback: "Now choose the matching card in the other column.",
  pairMatchedFeedback: "Matched. Keep going.",
  wrongPairFeedback: "Those cards use different person or number. Try again.",
  roundCompleteTemplate: "All forms matched for {verb}.",
  meaningProgressTemplate: "Verb {number} · meaning",
  formsProgressTemplate: "{matched} of {total} matched",
  progressLabel: "Round progress"
});
const COPY_TEMPLATE_TOKENS = Object.freeze({
  hearVerbTemplate: ["verb"],
  hearFormTemplate: ["form"],
  playingTemplate: ["text"],
  audioUnavailableTemplate: ["language"],
  correctMeaningTemplate: ["meaning"],
  roundCompleteTemplate: ["verb"],
  meaningProgressTemplate: ["number"],
  formsProgressTemplate: ["matched", "total"]
});

function catalogError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, location, { maximum = 1_000 } = {}) {
  const text = String(value ?? "").normalize("NFC").trim();
  if (!text) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location} must be a non-empty string.`
    );
  }
  if (text.length > maximum) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location} exceeds ${maximum} characters.`
    );
  }
  return text;
}

function optionalText(value, location, options) {
  if (value === undefined || value === null || value === "") return "";
  return requiredText(value, location, options);
}

function contentId(value, location) {
  const id = requiredText(value, location, { maximum: 160 });
  if (!CONTENT_ID_PATTERN.test(id)) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location} must be a lowercase, hyphen-separated stable identifier.`
    );
  }
  return id;
}

function positiveInteger(value, location) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location} must be a positive integer.`
    );
  }
  return number;
}

function boundedDifficulty(value, location) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 3) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location} must be an integer from 1 to 3.`
    );
  }
  return number;
}

function languageTag(value, location) {
  const tag = requiredText(value, location, { maximum: 64 });
  if (!LANGUAGE_TAG_PATTERN.test(tag)) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location} must be a valid language tag.`
    );
  }
  return tag;
}

function textList(value, location, { maximumItems = 24 } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location} must be an array with at most ${maximumItems} strings.`
    );
  }
  const normalized = value.map((item, index) => (
    requiredText(item, `${location}[${index}]`, { maximum: 160 })
  ));
  if (new Set(normalized).size !== normalized.length) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location} must not repeat a value.`
    );
  }
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function boundedStatus(value, location, allowed) {
  const status = requiredText(value, location, { maximum: 160 });
  if (!allowed.has(status)) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location} uses unsupported state ${status}.`
    );
  }
  return status;
}

function normalizeLicense(value, { legacy = false } = {}) {
  if (!legacy && !isRecord(value)) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      "Conjugation Comet requires explicit license metadata."
    );
  }
  const status = boundedStatus(
    legacy ? "legacy-review-required" : value.status,
    "license.status",
    LICENSE_STATUSES
  );
  const spdx = legacy ? null : value.spdx;
  if (spdx !== null && (typeof spdx !== "string" || !spdx.trim())) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      "license.spdx must be null while clearance is pending or a non-empty SPDX expression."
    );
  }
  if (status !== "release-cleared" && spdx !== null) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      "A review-required license state must keep license.spdx null."
    );
  }
  if (status === "release-cleared" && spdx === null) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      "A release-cleared catalog requires an SPDX expression."
    );
  }
  return {
    origin: contentId(
      legacy ? "legacy-course-content" : value.origin,
      "license.origin"
    ),
    status,
    spdx: spdx === null ? null : spdx.trim(),
    noteEnglish: requiredText(
      legacy
        ? "The existing Czech catalog remains subject to its course-level review and licensing authority during migration."
        : value.noteEnglish,
      "license.noteEnglish"
    )
  };
}

function normalizedCopyTemplate(value, location, requiredTokens) {
  const template = requiredText(value, location);
  const tokens = [...template.matchAll(/\{([a-z]+)\}/gu)].map((match) => match[1]);
  const allowed = new Set(requiredTokens);
  if (
    tokens.some((token) => !allowed.has(token))
    || requiredTokens.some((token) => !tokens.includes(token))
    || /[{}]/u.test(template.replace(/\{[a-z]+\}/gu, ""))
  ) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location} must use exactly the supported placeholders: ${requiredTokens.map((token) => `{${token}}`).join(", ")}.`
    );
  }
  return template;
}

function normalizeCopy(value, { legacy = false } = {}) {
  if (!legacy && !isRecord(value)) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      "A v1 Conjugation Comet catalog requires complete learner-facing copy."
    );
  }
  const copy = isRecord(value) ? value : {};
  return Object.fromEntries(Object.entries(LEGACY_COPY).map(([key, fallback]) => {
    const raw = legacy
      ? optionalText(copy[key], `copy.${key}`) || fallback
      : requiredText(copy[key], `copy.${key}`);
    const tokens = COPY_TEMPLATE_TOKENS[key];
    return [key, tokens ? normalizedCopyTemplate(raw, `copy.${key}`, tokens) : raw];
  }));
}

function legacyContentId(value, prefix, fallbackIndex) {
  const ascii = String(value || "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
  if (ascii) return `${prefix}-${ascii}`;
  let hash = 2166136261;
  for (const character of String(value || fallbackIndex)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16)}`;
}

function normalizeForm(form, verbLocation, formIndex, { legacy = false } = {}) {
  const location = `${verbLocation}.forms[${formIndex}]`;
  if (!isRecord(form)) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location} must be an object.`
    );
  }
  const targetText = requiredText(
    form.targetText ?? form.form,
    `${location}.targetText`,
    { maximum: 240 }
  );
  const englishAuditText = requiredText(
    legacy ? form.englishAuditText ?? form.cue : form.englishAuditText,
    `${location}.englishAuditText`,
    { maximum: 320 }
  );
  const learnerBaseCueText = requiredText(
    legacy ? form.learnerBaseCueText ?? form.cue : form.learnerBaseCueText,
    `${location}.learnerBaseCueText`,
    { maximum: 320 }
  );
  return {
    id: contentId(
      legacy
        ? legacyContentId(form.id ?? form.label, "form", formIndex + 1)
        : form.id ?? form.label,
      `${location}.id`
    ),
    revision: positiveInteger(legacy ? form.revision ?? 1 : form.revision, `${location}.revision`),
    subjectTargetText: requiredText(
      legacy ? form.subjectTargetText ?? form.subject ?? form.label : form.subjectTargetText,
      `${location}.subjectTargetText`,
      { maximum: 160 }
    ),
    targetText,
    learnerBaseCueText,
    englishAuditText,
    acceptedTargetTexts: textList(
      form.acceptedTargetTexts ?? form.accepted,
      `${location}.acceptedTargetTexts`
    )
  };
}

function normalizeVerb(verb, index, { legacy = false } = {}) {
  const location = `verbs[${index}]`;
  if (!isRecord(verb)) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location} must be an object.`
    );
  }
  if (!Array.isArray(verb.forms) || verb.forms.length < 2 || verb.forms.length > 12) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location}.forms must contain 2 to 12 authored forms.`
    );
  }
  const forms = verb.forms.map((form, formIndex) => (
    normalizeForm(form, location, formIndex, { legacy })
  ));
  const formIds = forms.map((form) => form.id);
  if (new Set(formIds).size !== formIds.length) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      `${location}.forms repeats a stable form id.`
    );
  }
  const targetText = requiredText(
    verb.targetText ?? verb.verb,
    `${location}.targetText`,
    { maximum: 160 }
  );
  const englishAuditText = requiredText(
    legacy ? verb.englishAuditText ?? verb.meaning : verb.englishAuditText,
    `${location}.englishAuditText`,
    { maximum: 320 }
  );
  const learnerBaseText = requiredText(
    legacy ? verb.learnerBaseText ?? verb.meaning : verb.learnerBaseText,
    `${location}.learnerBaseText`,
    { maximum: 320 }
  );
  return {
    id: contentId(
      legacy
        ? legacyContentId(verb.id ?? targetText, "verb", index + 1)
        : verb.id,
      `${location}.id`
    ),
    revision: positiveInteger(legacy ? verb.revision ?? 1 : verb.revision, `${location}.revision`),
    targetText,
    learnerBaseText,
    englishAuditText,
    meaningChoiceBaseText: optionalText(
      verb.meaningChoiceBaseText,
      `${location}.meaningChoiceBaseText`,
      { maximum: 320 }
    ) || learnerBaseText,
    difficulty: boundedDifficulty(legacy ? verb.difficulty ?? 1 : verb.difficulty, `${location}.difficulty`),
    family: requiredText(
      legacy ? verb.family ?? verb.hint ?? "Authored paradigm" : verb.family,
      `${location}.family`,
      { maximum: legacy ? 1_000 : 160 }
    ),
    lessonId: contentId(
      legacy ? verb.lessonId ?? "legacy-authored-paradigms" : verb.lessonId,
      `${location}.lessonId`
    ),
    teachingNoteBaseText: requiredText(
      legacy
        ? verb.teachingNoteBaseText ?? verb.hint ?? "Compare the authored person and number forms."
        : verb.teachingNoteBaseText,
      `${location}.teachingNoteBaseText`
    ),
    tags: textList(verb.tags, `${location}.tags`),
    forms
  };
}

/**
 * Validate and normalize a finite, authored Conjugation Comet catalog.
 *
 * English audit values remain explicit and independent of the learner base.
 * The runtime never derives forms, calls a dictionary, or generates a
 * translation between either language role.
 */
export function validateConjugationCometCatalog(value, {
  expectedCourseId = "",
  expectedTargetLanguageId = "",
  expectedLearnerBaseLanguageId = "",
  expectedTargetLocale = ""
} = {}) {
  if (!isRecord(value)) {
    throw catalogError(
      "CONJUGATION_COMET_CATALOG_INVALID",
      "The Conjugation Comet catalog must be an object."
    );
  }
  const legacy = value.schemaVersion === undefined
    && typeof value.language === "string"
    && Array.isArray(value.verbs);
  if (legacy && (
    expectedCourseId !== "cz"
    || expectedTargetLanguageId !== "cs"
    || expectedLearnerBaseLanguageId !== "en"
    || expectedTargetLocale !== "cs-CZ"
    || value.language.trim() !== "cs"
  )) {
    throw catalogError(
      "CONJUGATION_COMET_LEGACY_SCOPE_INVALID",
      "Schema-less Conjugation Comet content is confined to the Czech cs-CZ migration boundary."
    );
  }
  if (!legacy && value.schemaVersion !== CONJUGATION_COMET_CATALOG_SCHEMA) {
    throw catalogError(
      "CONJUGATION_COMET_SCHEMA_UNSUPPORTED",
      `Unsupported Conjugation Comet catalog schema: ${String(value.schemaVersion || "<missing>")}.`
    );
  }
  const courseId = contentId(
    legacy ? expectedCourseId || value.language : value.courseId,
    "courseId"
  );
  const targetLanguageId = contentId(
    legacy ? value.language : value.targetLanguageId,
    "targetLanguageId"
  );
  if (expectedCourseId && courseId !== expectedCourseId) {
    throw catalogError(
      "CONJUGATION_COMET_COURSE_MISMATCH",
      `Catalog course ${courseId} cannot be used by course ${expectedCourseId}.`
    );
  }
  if (expectedTargetLanguageId && targetLanguageId !== expectedTargetLanguageId) {
    throw catalogError(
      "CONJUGATION_COMET_LANGUAGE_MISMATCH",
      `Catalog language ${targetLanguageId} cannot be used for ${expectedTargetLanguageId}.`
    );
  }
  const learnerBaseLanguageId = contentId(
    legacy ? "en" : value.learnerBaseLanguageId,
    "learnerBaseLanguageId"
  );
  if (
    expectedLearnerBaseLanguageId
    && learnerBaseLanguageId !== expectedLearnerBaseLanguageId
  ) {
    throw catalogError(
      "CONJUGATION_COMET_LEARNER_BASE_MISMATCH",
      `Catalog learner base ${learnerBaseLanguageId} cannot be used for ${expectedLearnerBaseLanguageId}.`
    );
  }
  if (!legacy && value.auditLanguageId !== "en") {
    throw catalogError(
      "CONJUGATION_COMET_ENGLISH_AUDIT_REQUIRED",
      "Conjugation Comet requires a distinct English audit-language declaration."
    );
  }
  if (!legacy && (
    !isRecord(value.variety)
    || !isRecord(value.review)
    || !isRecord(value.authority)
    || !isRecord(value.license)
  )) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      "Conjugation Comet requires variety, review, license, and authority metadata."
    );
  }
  if (!legacy && (
    value.authority.kind !== "authored-finite-catalog"
    || value.authority.dictionaryLookup !== false
    || value.authority.runtimeGeneration !== false
    || value.authority.englishAuditRequired !== true
  )) {
    throw catalogError(
      "CONJUGATION_COMET_AUTHORITY_INVALID",
      "Conjugation Comet content must be an authored finite catalog with no dictionary lookup or runtime generation."
    );
  }
  if (!Array.isArray(value.verbs) || value.verbs.length < 4) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      "Conjugation Comet needs at least four authored verbs."
    );
  }
  const verbs = value.verbs.map((verb, index) => normalizeVerb(verb, index, { legacy }));
  const targetLocale = languageTag(
    legacy ? expectedTargetLocale : value.targetLocale,
    "targetLocale"
  );
  if (
    expectedTargetLocale
    && targetLocale.toLocaleLowerCase("en") !== expectedTargetLocale.toLocaleLowerCase("en")
  ) {
    throw catalogError(
      "CONJUGATION_COMET_LOCALE_MISMATCH",
      `Catalog locale ${targetLocale} cannot be used for ${expectedTargetLocale}.`
    );
  }
  const verbIds = verbs.map((verb) => verb.id);
  if (new Set(verbIds).size !== verbIds.length) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      "Conjugation Comet verb ids must be unique."
    );
  }
  const meaningChoices = verbs.map((verb) => meaningKey(verb.meaningChoiceBaseText));
  if (!legacy && new Set(meaningChoices).size !== meaningChoices.length) {
    throw catalogError(
      "CONJUGATION_COMET_CONTENT_INVALID",
      "Meaning choices must be distinct so the meaning gate has one defensible answer."
    );
  }

  return deepFreeze({
    schemaVersion: CONJUGATION_COMET_CATALOG_SCHEMA,
    id: contentId(
      legacy ? `${courseId}-conjugation-comet-legacy` : value.id,
      "id"
    ),
    contentRevision: positiveInteger(legacy ? 1 : value.contentRevision, "contentRevision"),
    courseId,
    targetLanguageId,
    targetLocale,
    learnerBaseLanguageId,
    auditLanguageId: "en",
    variety: {
      id: requiredText(
        legacy ? targetLanguageId : value.variety.id,
        "variety.id",
        { maximum: 64 }
      ),
      label: requiredText(
        legacy ? "Existing authored course content" : value.variety.label,
        "variety.label",
        { maximum: 240 }
      ),
      policyNoteEnglish: requiredText(
        legacy
          ? "Legacy course content retains its existing authored language policy."
          : value.variety.policyNoteEnglish,
        "variety.policyNoteEnglish"
      )
    },
    review: {
      status: boundedStatus(
        legacy ? "legacy-review-required" : value.review.status,
        "review.status",
        REVIEW_STATUSES
      ),
      noteEnglish: requiredText(
        legacy
          ? "Preserved from the existing course catalog; migrate metadata without changing its forms."
          : value.review.noteEnglish,
        "review.noteEnglish"
      )
    },
    license: normalizeLicense(value.license, { legacy }),
    authority: {
      kind: "authored-finite-catalog",
      dictionaryLookup: false,
      runtimeGeneration: false,
      englishAuditRequired: true
    },
    copy: normalizeCopy(value.copy, { legacy }),
    verbs
  });
}

function meaningKey(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en");
}

export function shuffleConjugationItems(values, random = Math.random) {
  const items = Array.from(values || []);
  for (let index = items.length - 1; index > 0; index -= 1) {
    const value = Number(random());
    const bounded = Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0;
    const other = Math.floor(bounded * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

/**
 * Build one catalog pass without discarding its authored progression.
 *
 * Every difficulty tier is shuffled independently, then the tiers are joined
 * from easiest to hardest. When a refill would immediately repeat the previous
 * verb, rotate only the first tier so the progression boundary remains intact.
 */
export function buildConjugationVerbQueue(values, {
  previousVerbId = "",
  random = Math.random
} = {}) {
  const tiers = new Map();
  for (const verb of Array.from(values || [])) {
    const difficulty = Number(verb?.difficulty);
    if (!tiers.has(difficulty)) tiers.set(difficulty, []);
    tiers.get(difficulty).push(verb);
  }

  const shuffledTiers = [...tiers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, verbs]) => shuffleConjugationItems(verbs, random));
  const firstTier = shuffledTiers[0] || [];
  if (
    previousVerbId
    && firstTier.length > 1
    && firstTier[0]?.id === previousVerbId
    && firstTier.some((verb) => verb?.id !== previousVerbId)
  ) {
    firstTier.push(firstTier.shift());
  }
  return shuffledTiers.flat();
}

function derangeById(values, random) {
  if (values.length < 2) return Array.from(values);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = shuffleConjugationItems(values, random);
    if (candidate.every((item, index) => item.id !== values[index]?.id)) return candidate;
  }
  return values.map((_, index) => values[(index + 1) % values.length]);
}

export function buildConjugationMeaningRound(catalog, verbId, {
  optionCount = 4,
  random = Math.random
} = {}) {
  const count = Number(optionCount);
  if (!Number.isInteger(count) || count < 2) {
    throw catalogError(
      "CONJUGATION_COMET_ROUND_INVALID",
      "A meaning round requires at least two choices."
    );
  }
  const current = catalog?.verbs?.find((verb) => verb.id === verbId);
  if (!current) {
    throw catalogError(
      "CONJUGATION_COMET_ROUND_INVALID",
      `Unknown Conjugation Comet verb: ${String(verbId || "<missing>")}.`
    );
  }
  const usedMeaningKeys = new Set([meaningKey(current.meaningChoiceBaseText)]);
  const distractors = [];
  for (const candidate of shuffleConjugationItems(
    catalog.verbs.filter((verb) => verb.id !== current.id),
    random
  )) {
    const key = meaningKey(candidate.meaningChoiceBaseText);
    if (usedMeaningKeys.has(key)) continue;
    usedMeaningKeys.add(key);
    distractors.push(candidate);
    if (distractors.length === count - 1) break;
  }
  if (distractors.length !== count - 1) {
    throw catalogError(
      "CONJUGATION_COMET_ROUND_INVALID",
      `The catalog needs at least ${count} verbs for a ${count}-choice meaning round.`
    );
  }
  const options = shuffleConjugationItems([current, ...distractors], random).map((verb) => ({
    id: verb.id,
    learnerBaseText: verb.meaningChoiceBaseText
  }));
  return deepFreeze({
    roundId: `${catalog.id}:${catalog.contentRevision}:${current.id}:meaning`,
    verbId: current.id,
    targetText: current.targetText,
    options,
    answerId: current.id
  });
}

export function buildConjugationFormRound(catalog, verbId, {
  random = Math.random
} = {}) {
  const current = catalog?.verbs?.find((verb) => verb.id === verbId);
  if (!current) {
    throw catalogError(
      "CONJUGATION_COMET_ROUND_INVALID",
      `Unknown Conjugation Comet verb: ${String(verbId || "<missing>")}.`
    );
  }
  const playableForms = current.forms.map((form) => ({
    id: form.id,
    revision: form.revision,
    subjectTargetText: form.subjectTargetText,
    targetText: form.targetText,
    learnerBaseCueText: form.learnerBaseCueText,
    acceptedTargetTexts: [...form.acceptedTargetTexts]
  }));
  const targetForms = shuffleConjugationItems(playableForms, random);
  const baseCues = derangeById(targetForms, random);
  return deepFreeze({
    roundId: `${catalog.id}:${catalog.contentRevision}:${current.id}:forms`,
    verbId: current.id,
    targetForms,
    baseCues
  });
}
