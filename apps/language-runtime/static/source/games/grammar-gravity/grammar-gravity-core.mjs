import {
  GRAMMAR_JOURNEY_CONTRACT,
  buildMeaningChoices,
  containsGrammarAnchor,
  shuffledGrammarValues,
  validateGrammarFlight,
  validateGrammarStages
} from "./adjective-flight-core.mjs?v=grammar-journey-3";

export const GRAMMAR_GRAVITY_SCHEMA_VERSION = "caatuu-grammar-gravity-content-v3";

const GAME_ID = "grammar-gravity";
const REVIEW_STATES = new Set(["native-review-required", "approved"]);
const LICENSE_STATES = new Set([
  "release-review-required",
  "release-cleared",
  "legacy-review-required"
]);
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
const TOKEN_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, location) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${location} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredId(value, location) {
  const id = requiredText(value, location);
  if (!ID_PATTERN.test(id)) {
    throw new Error(`${location} must be a stable lowercase dotted or dashed ID.`);
  }
  return id;
}

function requiredToken(value, location) {
  const token = requiredText(value, location);
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error(`${location} must be a lowercase token.`);
  }
  return token;
}

function requiredRevision(value, location) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${location} must be a positive integer.`);
  }
  return value;
}

function exactKeys(value, expected, location) {
  if (!isRecord(value)) throw new Error(`${location} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${location} must contain exactly: ${wanted.join(", ")}.`);
  }
}

function canonicalLocale(value, location) {
  const locale = requiredText(value, location);
  try {
    const [canonical] = Intl.getCanonicalLocales(locale);
    if (!canonical) throw new Error("missing locale");
    return canonical;
  } catch {
    throw new Error(`${location} must be a valid BCP 47 language tag.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function normalizedText(value, locale) {
  return String(value || "").normalize("NFC").trim().toLocaleLowerCase(locale);
}

function sameMembers(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function validateReview(review) {
  exactKeys(review, ["status", "reviewer", "reviewedAt", "notes"], "review");
  if (!REVIEW_STATES.has(review.status)) {
    throw new Error("review.status must be native-review-required or approved.");
  }
  requiredText(review.notes, "review.notes");
  if (review.status === "approved") {
    requiredText(review.reviewer, "review.reviewer");
    requiredText(review.reviewedAt, "review.reviewedAt");
  } else if (review.reviewer !== null || review.reviewedAt !== null) {
    throw new Error("Unapproved Grammar Gravity content cannot name a reviewer or review date.");
  }
}

function validateLicense(license) {
  exactKeys(license, ["origin", "status", "spdxExpression", "notes"], "license");
  requiredToken(license.origin, "license.origin");
  const status = requiredText(license.status, "license.status");
  if (!LICENSE_STATES.has(status)) {
    throw new Error(
      "license.status must be release-review-required, release-cleared, or legacy-review-required."
    );
  }
  requiredText(license.notes, "license.notes");
  if (license.spdxExpression !== null && (typeof license.spdxExpression !== "string" || !license.spdxExpression.trim())) {
    throw new Error("license.spdxExpression must be null or a non-empty string.");
  }
  if (status !== "release-cleared" && license.spdxExpression !== null) {
    throw new Error("A review-required Grammar Gravity license must keep spdxExpression null.");
  }
  if (status === "release-cleared" && license.spdxExpression === null) {
    throw new Error("A release-cleared Grammar Gravity license requires an SPDX expression.");
  }
}

function validatePresentation(presentation) {
  exactKeys(presentation, ["errorTitle", "errorDetail", "backLabel"], "presentation");
  Object.entries(presentation).forEach(([key, value]) => requiredText(value, `presentation.${key}`));
}

function validateGameplay(gameplay, axes) {
  exactKeys(gameplay, ["contract", "stages", "categoryFeature", "categoryOptions"], "gameplay");
  if (gameplay.contract !== GRAMMAR_JOURNEY_CONTRACT) {
    throw new Error(`gameplay.contract must be ${GRAMMAR_JOURNEY_CONTRACT}.`);
  }
  validateGrammarStages(gameplay.stages);
  requiredToken(gameplay.categoryFeature, "gameplay.categoryFeature");
  if (!Array.isArray(gameplay.categoryOptions) || gameplay.categoryOptions.length < 2 || gameplay.categoryOptions.length > 6) {
    throw new Error("gameplay.categoryOptions must declare between two and six categories.");
  }
  const ids = new Set();
  const labels = new Set();
  gameplay.categoryOptions.forEach((option, index) => {
    const location = `gameplay.categoryOptions[${index}]`;
    exactKeys(option, ["id", "label", ...(Object.hasOwn(option, "image") ? ["image"] : [])], location);
    const id = requiredToken(option.id, `${location}.id`);
    const label = requiredText(option.label, `${location}.label`);
    if (ids.has(id) || labels.has(label)) throw new Error("gameplay categories must have distinct IDs and labels.");
    ids.add(id);
    labels.add(label);
    if (Object.hasOwn(option, "image")) {
      const image = requiredText(option.image, `${location}.image`);
      if (!/^\/(?!\/)[a-zA-Z0-9/_-]+\.(?:png|webp|svg)$/u.test(image)) throw new Error(`${location}.image must be an absolute local image asset path.`);
    }
  });
  const used = new Set(axes.map((axis) => axis.features[gameplay.categoryFeature]));
  if (!sameMembers(used, ids)) throw new Error("Every axis must map to one declared gameplay category and every category must be used.");
}
function validateAxes(axes) {
  if (!Array.isArray(axes) || axes.length < 2 || axes.length > 6) {
    throw new Error("axes must contain between two and six authored feature combinations.");
  }
  const ids = new Set();
  axes.forEach((axis, index) => {
    const location = `axes[${index}]`;
    exactKeys(axis, ["id", "label", "features"], location);
    const id = requiredToken(axis.id, `${location}.id`);
    if (ids.has(id)) throw new Error(`axes repeats ${id}.`);
    ids.add(id);
    requiredText(axis.label, `${location}.label`);
    if (!isRecord(axis.features) || !Object.keys(axis.features).length) {
      throw new Error(`${location}.features must declare at least one language-owned feature.`);
    }
    for (const [feature, value] of Object.entries(axis.features)) {
      requiredToken(feature, `${location}.features key`);
      requiredText(value, `${location}.features.${feature}`);
    }
  });
  return ids;
}

export function validateGrammarGravityCategories(pack, nounLanes) {
  if (!pack.gameplay.stages.includes("category")) return pack;
  if (!Array.isArray(nounLanes) || nounLanes.length !== pack.gameplay.categoryOptions.length) {
    throw new Error("Grammar journey categories must exactly match the noun catalog lanes.");
  }
  const lanes = new Map(nounLanes.map((lane) => [lane?.id, lane]));
  if (lanes.size !== nounLanes.length) throw new Error("Grammar journey noun catalog lanes must have unique IDs.");
  for (const option of pack.gameplay.categoryOptions) {
    const lane = lanes.get(option.id);
    if (!lane || lane.label !== option.label || lane.image !== option.image) {
      throw new Error(`Grammar journey category ${option.id} must use the noun catalog's exact label and image.`);
    }
  }
  return pack;
}

function validateFocus(focus, location) {
  exactKeys(focus, [
    "kind",
    "label",
    "targetText",
    "resultTitle",
    "summary"
  ], location);
  requiredToken(focus.kind, `${location}.kind`);
  for (const field of ["label", "targetText", "resultTitle", "summary"]) {
    requiredText(focus[field], `${location}.${field}`);
  }
}

function validateExamples(examples, {
  location,
  displayForm,
  locale,
  learnerBaseLanguage,
  exampleIds,
  targetPhrases,
  learnerBasePhrases
}) {
  if (!Array.isArray(examples) || examples.length < 2) {
    throw new Error(`${location} must contain at least two complete reviewed phrase pairs.`);
  }
  examples.forEach((example, index) => {
    const exampleLocation = `${location}[${index}]`;
    exactKeys(example, [
      "id",
      "revision",
      "learnerBaseText",
      "englishAuditText",
      "targetText",
      "anchor",
      "slot"
    ], exampleLocation);
    const id = requiredId(example.id, `${exampleLocation}.id`);
    if (exampleIds.has(id)) throw new Error(`Grammar Gravity repeats example ID ${id}.`);
    exampleIds.add(id);
    requiredRevision(example.revision, `${exampleLocation}.revision`);
    const learnerBaseText = requiredText(example.learnerBaseText, `${exampleLocation}.learnerBaseText`);
    const englishAuditText = requiredText(example.englishAuditText, `${exampleLocation}.englishAuditText`);
    const targetText = requiredText(example.targetText, `${exampleLocation}.targetText`);
    exactKeys(example.anchor, ["targetText", "learnerBaseText", "englishAuditText"], `${exampleLocation}.anchor`);
    const anchor = requiredText(example.anchor.targetText, `${exampleLocation}.anchor.targetText`);
    const anchorBase = requiredText(example.anchor.learnerBaseText, `${exampleLocation}.anchor.learnerBaseText`);
    const anchorAudit = requiredText(example.anchor.englishAuditText, `${exampleLocation}.anchor.englishAuditText`);
    if (anchor !== example.anchor.targetText) throw new Error(`${exampleLocation}.anchor.targetText cannot have surrounding whitespace.`);
    if ((learnerBaseLanguage === "en" || learnerBaseLanguage.startsWith("en-")) && anchorBase !== anchorAudit) {
      throw new Error(`${exampleLocation}.anchor must render the exact English audit text for an English-base course.`);
    }
    exactKeys(example.slot, ["beforeText", "afterText"], `${exampleLocation}.slot`);
    const { beforeText, afterText } = example.slot;
    if (typeof beforeText !== "string" || typeof afterText !== "string"
        || beforeText + displayForm + afterText !== example.targetText) {
      throw new Error(`${exampleLocation}.slot must reproduce the exact authored targetText with its displayForm.`);
    }
    if (!containsGrammarAnchor(beforeText, anchor, "", displayForm + afterText)
        && !containsGrammarAnchor(afterText, anchor, beforeText + displayForm, "")) {
      throw new Error(`${exampleLocation}.anchor must occur as complete tokens outside its form slot.`);
    }
    if ((learnerBaseLanguage === "en" || learnerBaseLanguage.startsWith("en-"))
        && learnerBaseText !== englishAuditText) {
      throw new Error(`${exampleLocation} must render the exact English audit text for an English-base course.`);
    }
    const normalizedTarget = normalizedText(targetText, locale);
    const normalizedBase = normalizedText(learnerBaseText, learnerBaseLanguage);
    if (targetPhrases.has(normalizedTarget) || learnerBasePhrases.has(normalizedBase)) {
      throw new Error(`${exampleLocation} must be distinct within its challenge in both language roles.`);
    }
    targetPhrases.add(normalizedTarget);
    learnerBasePhrases.add(normalizedBase);
  });
}

function validateChallenges(pack, axisIds) {
  if (!Array.isArray(pack.challenges) || pack.challenges.length < 4) {
    throw new Error("challenges must contain at least four authored challenges.");
  }
  const challengeIds = new Set();
  const exampleIds = new Set();
  const difficulties = new Set();
  pack.challenges.forEach((challenge, index) => {
    const location = `challenges[${index}]`;
    const scoped = Object.hasOwn(challenge, "axes") || Object.hasOwn(challenge, "gameplay");
    exactKeys(challenge, ["id", "revision", "difficulty", "focus", "forms", ...(scoped ? ["axes", "gameplay"] : [])], location);
    const familyAxisIds = scoped ? validateAxes(challenge.axes) : axisIds;
    if (scoped) validateGameplay(challenge.gameplay, challenge.axes);
    const id = requiredId(challenge.id, `${location}.id`);
    if (challengeIds.has(id)) throw new Error(`Grammar Gravity repeats challenge ID ${id}.`);
    challengeIds.add(id);
    requiredRevision(challenge.revision, `${location}.revision`);
    if (!Number.isInteger(challenge.difficulty) || challenge.difficulty < 1 || challenge.difficulty > 3) {
      throw new Error(`${location}.difficulty must be 1, 2, or 3.`);
    }
    difficulties.add(challenge.difficulty);
    validateFocus(challenge.focus, `${location}.focus`);
    if (!isRecord(challenge.forms)) throw new Error(`${location}.forms must be an object.`);
    const actualForms = new Set(Object.keys(challenge.forms));
    if (!sameMembers(actualForms, new Set(familyAxisIds))) {
      throw new Error(`${location}.forms must contain exactly the content-declared axes.`);
    }
    const targetPhrases = new Set();
    const learnerBasePhrases = new Set();
    const formOptions = new Set();
    const formSpellings = new Map();
    for (const axisId of familyAxisIds) {
      const formLocation = `${location}.forms.${axisId}`;
      const form = challenge.forms[axisId];
      exactKeys(form, ["displayForm", "examples"], formLocation);
      const displayForm = requiredText(form.displayForm, `${formLocation}.displayForm`);
      if (displayForm !== form.displayForm) throw new Error(`${formLocation}.displayForm cannot have surrounding whitespace.`);
      formOptions.add(normalizedText(displayForm, pack.targetLanguage));
      const spelling = normalizedText(displayForm, pack.targetLanguage);
      if (formSpellings.has(spelling) && formSpellings.get(spelling) !== displayForm) {
        throw new Error(`${location} cannot distinguish form options using only letter case or Unicode normalization.`);
      }
      formSpellings.set(spelling, displayForm);
      validateExamples(form.examples, {
        location: `${formLocation}.examples`,
        displayForm,
        locale: pack.targetLanguage,
        learnerBaseLanguage: pack.learnerBaseLanguage,
        exampleIds,
        targetPhrases,
        learnerBasePhrases
      });
    }
    if (formOptions.size < 2) throw new Error(`${location} must offer at least two distinct authored form options.`);
  });
  if (![1, 2, 3].every((difficulty) => difficulties.has(difficulty))) {
    throw new Error("The authored challenge bank must cover difficulties 1, 2, and 3.");
  }
  if (pack.gameplay.stages.includes("meaning")) {
    for (const difficulty of [1, 2, 3]) {
      const meanings = new Set(pack.challenges.filter((challenge) => challenge.difficulty <= difficulty)
        .flatMap((challenge) => Object.values(challenge.forms).flatMap((form) => form.examples
          .map((example) => normalizedText(example.anchor.learnerBaseText, pack.learnerBaseLanguage)))));
      if (meanings.size < 2) throw new Error(`Difficulty ${difficulty} must provide at least two distinct authored anchor meanings.`);
    }
  }
}

// Kept as the course-loading entry point; it accepts only the current explicit contract.
export function normalizeGrammarGravityPack(value, options = {}) {
  return validateGrammarGravityPack(value, options);
}
export function validateGrammarGravityPack(value, {
  courseId = "",
  targetLanguage = "",
  learnerBaseLanguage = ""
} = {}) {
  exactKeys(value, [
    "schemaVersion",
    "courseId",
    "gameId",
    "contentId",
    "contentRevision",
    "status",
    "learnerBaseLanguage",
    "targetLanguage",
    "englishAuditLanguage",
    "review",
    "license",
    "gameplay",
    "presentation",
    "axes",
    "challenges"
  ], "Grammar Gravity pack");
  if (value.schemaVersion !== GRAMMAR_GRAVITY_SCHEMA_VERSION) {
    throw new Error(`Grammar Gravity requires schemaVersion ${GRAMMAR_GRAVITY_SCHEMA_VERSION}.`);
  }
  const actualCourseId = requiredToken(value.courseId, "courseId");
  if (courseId && actualCourseId !== courseId) {
    throw new Error(`Grammar Gravity content belongs to ${actualCourseId}, not ${courseId}.`);
  }
  if (value.gameId !== GAME_ID) throw new Error(`gameId must be ${GAME_ID}.`);
  requiredId(value.contentId, "contentId");
  requiredRevision(value.contentRevision, "contentRevision");
  requiredText(value.status, "status");
  const actualLearnerBase = canonicalLocale(value.learnerBaseLanguage, "learnerBaseLanguage");
  const expectedLearnerBase = learnerBaseLanguage
    ? canonicalLocale(learnerBaseLanguage, "expected learner-base language")
    : "";
  if (expectedLearnerBase && actualLearnerBase !== expectedLearnerBase) {
    throw new Error(`Grammar Gravity learner base is ${actualLearnerBase}, not ${expectedLearnerBase}.`);
  }
  const actualTarget = canonicalLocale(value.targetLanguage, "targetLanguage");
  const expectedTarget = targetLanguage
    ? canonicalLocale(targetLanguage, "expected target language")
    : "";
  if (expectedTarget && actualTarget !== expectedTarget) {
    throw new Error(`Grammar Gravity target language is ${actualTarget}, not ${expectedTarget}.`);
  }
  if (value.englishAuditLanguage !== "en") {
    throw new Error("englishAuditLanguage must remain en.");
  }
  validateReview(value.review);
  validateLicense(value.license);

  validatePresentation(value.presentation);
  const axisIds = validateAxes(value.axes);
  validateGameplay(value.gameplay, value.axes);
  validateChallenges(value, axisIds);
  return deepFreeze(value);
}

export function buildGrammarGravityRounds(pack, difficulty, random = Math.random, previousAnchor = "") {
  validateGrammarGravityPack(pack);
  const level = Number(difficulty);
  if (!Number.isInteger(level) || level < 1 || level > 3) throw new Error("Grammar Gravity difficulty must be 1, 2, or 3.");
  const challenges = pack.challenges.filter((challenge) => challenge.difficulty <= level);
  const meaningPool = [...new Set(challenges.flatMap((challenge) => Object.values(challenge.forms).flatMap((form) =>
    form.examples.map((example) => example.anchor.learnerBaseText))))];
  const rounds = challenges.flatMap((challenge) => {
    const axes = challenge.axes || pack.axes;
    const gameplay = challenge.gameplay || pack.gameplay;
    const options = [...new Set(axes.map((axis) => challenge.forms[axis.id].displayForm))];
    return axes.flatMap((axis) => {
      const form = challenge.forms[axis.id];
      return form.examples.map((example) => {
        const flight = validateGrammarFlight({
          id: example.id,
          anchorText: example.anchor.targetText,
          anchorMeaning: example.anchor.learnerBaseText,
          anchorEnglishAuditText: example.anchor.englishAuditText,
          targetText: example.targetText,
          learnerBaseText: example.learnerBaseText,
          beforeText: example.slot.beforeText,
          afterText: example.slot.afterText,
          answer: form.displayForm,
          options: shuffledGrammarValues(options, random),
          categoryId: axis.features[gameplay.categoryFeature],
          categoryOptions: gameplay.categoryOptions,
          stages: gameplay.stages,
          meaningPool,
          meaningOptions: gameplay.stages.includes("meaning")
            ? buildMeaningChoices(example.anchor.learnerBaseText, meaningPool, 3, random) : []
        });
        return {
          id: example.id,
          revision: example.revision,
          challengeId: challenge.id,
          challengeRevision: challenge.revision,
          difficulty: challenge.difficulty,
          focus: challenge.focus,
          stages: gameplay.stages,
          flights: [flight]
        };
      });
    });
  });
  if (!rounds.length) throw new Error("Grammar Gravity has no challenge at this difficulty.");
  // Distribute authored examples by word, rather than letting several forms of
  // the same word cluster together. Keep every example and respect cycle edges.
  const groups = new Map();
  for (const round of shuffledGrammarValues(rounds, random)) {
    const key = round.flights[0].anchorEnglishAuditText;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(round);
  }
  const ordered = [];
  while (groups.size) {
    const candidates = [...groups].filter(([key]) => key !== previousAnchor);
    const [key, remaining] = (candidates.length ? candidates : [...groups])
      .sort((left, right) => right[1].length - left[1].length)[0];
    ordered.push(remaining.pop());
    previousAnchor = key;
    if (!remaining.length) groups.delete(key);
  }
  return deepFreeze(ordered);
}
