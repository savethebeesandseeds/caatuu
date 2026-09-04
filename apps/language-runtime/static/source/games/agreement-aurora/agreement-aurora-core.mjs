export const AGREEMENT_AURORA_SCHEMA_VERSION = "caatuu-agreement-aurora-content-v2";

const GAME_ID = "agreement-aurora";
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
    throw new Error("Unapproved Agreement Aurora content cannot name a reviewer or review date.");
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
    throw new Error("A review-required Agreement Aurora license must keep spdxExpression null.");
  }
  if (status === "release-cleared" && license.spdxExpression === null) {
    throw new Error("A release-cleared Agreement Aurora license requires an SPDX expression.");
  }
}

function validateLesson(lesson) {
  exactKeys(lesson, [
    "kicker",
    "loadingText",
    "title",
    "instruction",
    "idea",
    "matchingTitle",
    "learnerBaseColumnLabel",
    "targetColumnLabel",
    "completeKicker"
  ], "lesson");
  Object.entries(lesson).forEach(([key, value]) => requiredText(value, `lesson.${key}`));
}

function validatePresentation(presentation) {
  exactKeys(presentation, [
    "difficultyFallback",
    "roundTitle",
    "progress",
    "initialFeedback",
    "selectTargetFeedback",
    "selectLearnerBaseFeedback",
    "retryFeedback",
    "wrongFeedback",
    "matchedFeedback",
    "completeFeedback",
    "nextRoundLabel",
    "restartLessonLabel",
    "difficultyChangedFeedback",
    "reviewRequiredLabel",
    "errorTitle",
    "errorDetail",
    "backLabel"
  ], "presentation");
  Object.entries(presentation).forEach(([key, value]) => requiredText(value, `presentation.${key}`));
  const requiredPlaceholders = {
    difficultyFallback: ["level"],
    roundTitle: ["round", "focus", "level"],
    progress: ["round", "total", "difficulty"],
    selectTargetFeedback: ["targetColumn"],
    selectLearnerBaseFeedback: ["learnerBaseColumn"],
    matchedFeedback: ["axis", "form"],
    completeFeedback: ["count"],
    difficultyChangedFeedback: ["difficulty"]
  };
  for (const [field, placeholders] of Object.entries(requiredPlaceholders)) {
    for (const placeholder of placeholders) {
      if (!presentation[field].includes(`{${placeholder}}`)) {
        throw new Error(`presentation.${field} must contain {${placeholder}}.`);
      }
    }
  }
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
      "targetText"
    ], exampleLocation);
    const id = requiredId(example.id, `${exampleLocation}.id`);
    if (exampleIds.has(id)) throw new Error(`Agreement Aurora repeats example ID ${id}.`);
    exampleIds.add(id);
    requiredRevision(example.revision, `${exampleLocation}.revision`);
    const learnerBaseText = requiredText(example.learnerBaseText, `${exampleLocation}.learnerBaseText`);
    const englishAuditText = requiredText(example.englishAuditText, `${exampleLocation}.englishAuditText`);
    const targetText = requiredText(example.targetText, `${exampleLocation}.targetText`);
    if ((learnerBaseLanguage === "en" || learnerBaseLanguage.startsWith("en-"))
        && learnerBaseText !== englishAuditText) {
      throw new Error(`${exampleLocation} must render the exact English audit text for an English-base course.`);
    }
    if (!normalizedText(targetText, locale).includes(normalizedText(displayForm, locale))) {
      throw new Error(`${exampleLocation}.targetText must contain its authored displayForm.`);
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
  if (!Array.isArray(pack.challenges) || pack.challenges.length < 4 || pack.challenges.length > 48) {
    throw new Error("challenges must contain a bounded bank of four to forty-eight authored challenges.");
  }
  const challengeIds = new Set();
  const exampleIds = new Set();
  const difficulties = new Set();
  const expectedForms = new Set(axisIds);
  pack.challenges.forEach((challenge, index) => {
    const location = `challenges[${index}]`;
    exactKeys(challenge, ["id", "revision", "difficulty", "focus", "forms"], location);
    const id = requiredId(challenge.id, `${location}.id`);
    if (challengeIds.has(id)) throw new Error(`Agreement Aurora repeats challenge ID ${id}.`);
    challengeIds.add(id);
    requiredRevision(challenge.revision, `${location}.revision`);
    if (!Number.isInteger(challenge.difficulty) || challenge.difficulty < 1 || challenge.difficulty > 3) {
      throw new Error(`${location}.difficulty must be 1, 2, or 3.`);
    }
    difficulties.add(challenge.difficulty);
    validateFocus(challenge.focus, `${location}.focus`);
    if (!isRecord(challenge.forms)) throw new Error(`${location}.forms must be an object.`);
    const actualForms = new Set(Object.keys(challenge.forms));
    if (!sameMembers(actualForms, expectedForms)) {
      throw new Error(`${location}.forms must contain exactly the content-declared axes.`);
    }
    const targetPhrases = new Set();
    const learnerBasePhrases = new Set();
    for (const axisId of axisIds) {
      const formLocation = `${location}.forms.${axisId}`;
      const form = challenge.forms[axisId];
      exactKeys(form, ["displayForm", "examples"], formLocation);
      const displayForm = requiredText(form.displayForm, `${formLocation}.displayForm`);
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
  });
  if (![1, 2, 3].every((difficulty) => difficulties.has(difficulty))) {
    throw new Error("The authored challenge bank must cover difficulties 1, 2, and 3.");
  }
}

function legacyToken(value, fallback) {
  const token = String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return token || fallback;
}

function legacyAxisLabel(value) {
  const words = String(value || "")
    .replace(/[-_]+/gu, " ")
    .trim();
  return words ? `${words[0].toLocaleUpperCase("en")}${words.slice(1)}` : "Agreement form";
}

function legacyTargetText(example, location) {
  if (!isRecord(example)) throw new Error(`${location} must be an object.`);
  const targetFields = Object.keys(example).filter((key) => key !== "english");
  if (targetFields.length !== 1) {
    throw new Error(`${location} must contain English and exactly one target-language phrase.`);
  }
  requiredText(example.english, `${location}.english`);
  return requiredText(example[targetFields[0]], `${location}.${targetFields[0]}`);
}

function normalizeLegacyAgreementAuroraPack(value, {
  courseId,
  targetLanguage,
  learnerBaseLanguage,
  targetLabel
}) {
  if (!Array.isArray(value) || !value.length) {
    throw new Error("Legacy Agreement Aurora content must be a non-empty list.");
  }
  const firstForms = value[0]?.forms;
  if (!isRecord(firstForms) || Object.keys(firstForms).length < 2) {
    throw new Error("Legacy Agreement Aurora content needs at least two authored form axes.");
  }
  const legacyAxisKeys = Object.keys(firstForms);
  const axes = legacyAxisKeys.map((key, index) => ({
    id: legacyToken(key, `axis-${index + 1}`),
    label: legacyAxisLabel(key),
    features: { "agreement-class": key }
  }));
  const axisLabels = axes.map(({ label }) => label.toLocaleLowerCase("en")).join(", ");
  const normalized = {
    schemaVersion: AGREEMENT_AURORA_SCHEMA_VERSION,
    courseId,
    gameId: GAME_ID,
    contentId: `${courseId}.agreement-aurora.legacy-v1`,
    contentRevision: 1,
    status: "legacy-development-content",
    learnerBaseLanguage,
    targetLanguage,
    englishAuditLanguage: "en",
    review: {
      status: "native-review-required",
      reviewer: null,
      reviewedAt: null,
      notes: "Legacy authored course content normalized for the shared Agreement Aurora renderer; qualified language review remains required."
    },
    license: {
      origin: "caatuu-legacy-first-party-authored",
      status: "legacy-review-required",
      spdxExpression: null,
      notes: "Preserved legacy course content; release clearance remains governed by the owning course."
    },
    lesson: {
      kicker: "Make the words agree",
      loadingText: "Preparing the first agreement pattern…",
      title: "Make the phrase agree",
      instruction: `Match each English meaning to the complete ${targetLabel} phrase.`,
      idea: "Compare how the connected word changes across the authored feature combinations.",
      matchingTitle: "Pick one phrase from each side",
      learnerBaseColumnLabel: "English meaning",
      targetColumnLabel: `${targetLabel} phrase`,
      completeKicker: `All ${axes.length} matched`
    },
    presentation: {
      difficultyFallback: "Level {level}",
      roundTitle: "Round {round} · {focus} · Level {level}",
      progress: "Round {round} of {total} · {difficulty}",
      initialFeedback: "Choose one meaning, then match it to a complete target phrase.",
      selectTargetFeedback: "Now choose the {targetColumn} with the same meaning.",
      selectLearnerBaseFeedback: "Now choose the {learnerBaseColumn} with the same meaning.",
      retryFeedback: "Try again: match two complete phrases with the same meaning.",
      wrongFeedback: "Those complete phrases have different meanings. Compare the noun and every agreeing word.",
      matchedFeedback: "Matched {axis}: {form}.",
      completeFeedback: "All {count} complete phrases matched. Compare the authored agreement forms.",
      nextRoundLabel: "Next pattern",
      restartLessonLabel: "Restart lesson",
      difficultyChangedFeedback: "Showing {difficulty} agreement patterns.",
      reviewRequiredLabel: "Development content · native review required",
      errorTitle: "Agreement Aurora could not load",
      errorDetail: "Return to the planets and try opening it again.",
      backLabel: "Back to games"
    },
    axes,
    challenges: value.map((challenge, challengeIndex) => {
      const location = `Legacy challenge ${challengeIndex + 1}`;
      if (!isRecord(challenge) || !isRecord(challenge.forms)) {
        throw new Error(`${location} must contain authored forms.`);
      }
      const actualFormKeys = new Set(Object.keys(challenge.forms));
      if (!sameMembers(actualFormKeys, new Set(legacyAxisKeys))) {
        throw new Error(`${location} must use the same form axes as the first challenge.`);
      }
      const focusText = requiredText(challenge.adjective, `${location}.adjective`);
      const challengeId = `${courseId}.agreement.${legacyToken(focusText, `focus-${challengeIndex + 1}`)}`;
      return {
        id: challengeId,
        revision: 1,
        difficulty: challenge.difficulty,
        focus: {
          kind: "adjective",
          label: `Adjective: ${focusText}`,
          targetText: focusText,
          resultTitle: `${axes.length} agreement forms of ${focusText}`,
          summary: `${focusText} changes across the authored ${axisLabels} forms.`
        },
        forms: Object.fromEntries(legacyAxisKeys.map((legacyKey, axisIndex) => {
          const legacyForm = challenge.forms[legacyKey];
          const axis = axes[axisIndex];
          if (!isRecord(legacyForm) || !Array.isArray(legacyForm.examples)) {
            throw new Error(`${location}.forms.${legacyKey} must contain authored examples.`);
          }
          return [axis.id, {
            displayForm: legacyForm.form,
            examples: legacyForm.examples.map((example, exampleIndex) => {
              const exampleLocation = `${location}.forms.${legacyKey}.examples[${exampleIndex}]`;
              const english = requiredText(example?.english, `${exampleLocation}.english`);
              return {
                id: `${challengeId}.${axis.id}.${exampleIndex + 1}`,
                revision: 1,
                learnerBaseText: english,
                englishAuditText: english,
                targetText: legacyTargetText(example, exampleLocation)
              };
            })
          }];
        }))
      };
    })
  };
  return normalized;
}

export function normalizeAgreementAuroraPack(value, options = {}) {
  const courseId = requiredToken(options.courseId, "expected courseId");
  const targetLanguage = canonicalLocale(options.targetLanguage, "expected targetLanguage");
  const learnerBaseLanguage = canonicalLocale(
    options.learnerBaseLanguage || "en",
    "expected learnerBaseLanguage"
  );
  if (Array.isArray(value) && !(
    courseId === "cz"
    && learnerBaseLanguage === "en"
    && (targetLanguage === "cs" || targetLanguage === "cs-CZ")
  )) {
    throw new Error(
      "Legacy Agreement Aurora array content is confined to the Czech English-base migration; other courses must use the explicit shared content schema."
    );
  }
  const normalized = Array.isArray(value)
    ? normalizeLegacyAgreementAuroraPack(value, {
      courseId,
      targetLanguage,
      learnerBaseLanguage,
      targetLabel: requiredText(options.targetLabel || "target-language", "targetLabel")
    })
    : value;
  return validateAgreementAuroraPack(normalized, {
    courseId,
    targetLanguage,
    learnerBaseLanguage
  });
}

export function validateAgreementAuroraPack(value, {
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
    "lesson",
    "presentation",
    "axes",
    "challenges"
  ], "Agreement Aurora pack");
  if (value.schemaVersion !== AGREEMENT_AURORA_SCHEMA_VERSION) {
    throw new Error(`Agreement Aurora requires schemaVersion ${AGREEMENT_AURORA_SCHEMA_VERSION}.`);
  }
  const actualCourseId = requiredToken(value.courseId, "courseId");
  if (courseId && actualCourseId !== courseId) {
    throw new Error(`Agreement Aurora content belongs to ${actualCourseId}, not ${courseId}.`);
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
    throw new Error(`Agreement Aurora learner base is ${actualLearnerBase}, not ${expectedLearnerBase}.`);
  }
  const actualTarget = canonicalLocale(value.targetLanguage, "targetLanguage");
  const expectedTarget = targetLanguage
    ? canonicalLocale(targetLanguage, "expected target language")
    : "";
  if (expectedTarget && actualTarget !== expectedTarget) {
    throw new Error(`Agreement Aurora target language is ${actualTarget}, not ${expectedTarget}.`);
  }
  if (value.englishAuditLanguage !== "en") {
    throw new Error("englishAuditLanguage must remain en.");
  }
  validateReview(value.review);
  validateLicense(value.license);
  validateLesson(value.lesson);
  validatePresentation(value.presentation);
  const axisIds = validateAxes(value.axes);
  validateChallenges(value, axisIds);
  return deepFreeze(value);
}

function randomIndex(length, random) {
  const value = Number(random());
  const bounded = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999999) : 0;
  return Math.floor(bounded * length);
}

export function buildAgreementAuroraRounds(pack, difficulty, random = Math.random) {
  const level = Number(difficulty);
  if (!Number.isInteger(level) || level < 1 || level > 3) {
    throw new Error("Agreement Aurora difficulty must be 1, 2, or 3.");
  }
  const rounds = pack.challenges
    .filter((challenge) => challenge.difficulty <= level)
    .sort((left, right) => left.difficulty - right.difficulty || left.id.localeCompare(right.id))
    .map((challenge) => ({
      id: challenge.id,
      revision: challenge.revision,
      difficulty: challenge.difficulty,
      focus: challenge.focus,
      matches: pack.axes.map((axis) => {
        const form = challenge.forms[axis.id];
        const example = form.examples[randomIndex(form.examples.length, random)];
        return {
          id: example.id,
          revision: example.revision,
          axisId: axis.id,
          axisLabel: axis.label,
          features: axis.features,
          displayForm: form.displayForm,
          learnerBaseText: example.learnerBaseText,
          targetText: example.targetText
        };
      })
    }));
  if (!rounds.length) throw new Error("Agreement Aurora has no challenge at this difficulty.");
  return deepFreeze(rounds);
}

export function derangeAgreementAuroraMatches(matches, random = Math.random) {
  const original = Array.from(matches || []);
  if (original.length < 2) return original;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = [...original];
    for (let index = candidate.length - 1; index > 0; index -= 1) {
      const target = randomIndex(index + 1, random);
      [candidate[index], candidate[target]] = [candidate[target], candidate[index]];
    }
    if (candidate.every((match, index) => match.id !== original[index].id)) return candidate;
  }
  return [...original.slice(1), original[0]];
}

export function agreementAuroraPairMatches(learnerBaseId, targetId) {
  return Boolean(learnerBaseId && targetId && learnerBaseId === targetId);
}

export function agreementAuroraRoundComplete(matches, matchedIds) {
  const round = Array.from(matches || []);
  const completed = matchedIds instanceof Set ? matchedIds : new Set(matchedIds || []);
  return Boolean(round.length) && round.every(({ id }) => completed.has(id));
}
