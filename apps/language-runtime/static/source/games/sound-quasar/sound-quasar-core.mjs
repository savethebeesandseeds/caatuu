const GAME_ID = "sound-quasar";
const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SOURCE_ID_PATTERN = /^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*|\/(?:0|[1-9][0-9]*))$/u;
const validatedCatalogs = new WeakSet();

function requireCondition(condition, message) {
  if (!condition) throw new TypeError(`Sounds Quasar: ${message}`);
}

function record(value, label) {
  requireCondition(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  return value;
}

function text(value, label, maxLength = 180) {
  requireCondition(typeof value === "string", `${label} must be plain text.`);
  const normalized = value.normalize("NFC").trim();
  requireCondition(normalized.length > 0 && normalized.length <= maxLength, `${label} must contain 1–${maxLength} characters.`);
  requireCondition(!/[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(normalized), `${label} contains markup or control characters.`);
  return normalized;
}

function identifier(value, label) {
  const id = text(value, label, 100);
  requireCondition(ID_PATTERN.test(id), `${label} must be a stable lowercase identifier.`);
  return id;
}

function languageLocale(value, label) {
  const locale = text(value, label, 40);
  let canonical;
  try { [canonical] = Intl.getCanonicalLocales(locale); } catch { /* Rejected below. */ }
  requireCondition(canonical === locale, `${label} must be a canonical language locale.`);
  return canonical;
}

function integer(value, label, minimum, maximum) {
  requireCondition(Number.isSafeInteger(value) && value >= minimum && value <= maximum, `${label} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}

function shuffled(values, random) {
  requireCondition(typeof random === "function", "random must be a function.");
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const value = random();
    requireCondition(typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1, "random must return a number from 0 (inclusive) to 1 (exclusive).");
    const other = Math.floor(value * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function readingGuide(value, target, targetLanguageId, label) {
  if (value === undefined) return undefined;
  const reading = record(value, label);
  requireCondition(targetLanguageId === "zh" && reading.system === "pinyin", `${label} must use the target language's reading system.`);
  requireCondition(reading.status === "machine-assisted-preview", `${label} must preserve the source reading-guide status.`);
  const sourcePath = text(reading.sourcePath, `${label}.sourcePath`, 220);
  requireCondition(sourcePath === "apps/languages/mandarin-simplified/static/data/games/word-world/reading-guides.json", `${label} must name the existing reading-guide file.`);
  requireCondition(Array.isArray(reading.tokens) && reading.tokens.length > 0 && reading.tokens.length <= 100, `${label} must contain reading tokens.`);
  let cursor = 0;
  const tokens = reading.tokens.map((value, tokenIndex) => {
    const token = record(value, `${label}.tokens[${tokenIndex}]`);
    const surface = text(token.surface, `${label}.tokens[${tokenIndex}].surface`, 80);
    const offset = target.indexOf(surface, cursor);
    requireCondition(offset >= cursor && /^[\p{P}\p{Z}\s]*$/u.test(target.slice(cursor, offset)), `${label} tokens must follow the target text exactly.`);
    cursor = offset + surface.length;
    requireCondition(Array.isArray(token.units) && token.units.length > 0 && token.units.length <= 80, `${label} token must contain reading units.`);
    const units = token.units.map((value, unitIndex) => {
      const unit = record(value, `${label}.tokens[${tokenIndex}].units[${unitIndex}]`);
      return Object.freeze({
        surface: text(unit.surface, `${label} unit surface`, 80),
        notation: text(unit.notation, `${label} unit notation`, 80)
      });
    });
    requireCondition(units.map(({ surface }) => surface).join("") === surface, `${label} units must reproduce their token.`);
    return Object.freeze({ surface, units: Object.freeze(units) });
  });
  requireCondition(/^[\p{P}\p{Z}\s]*$/u.test(target.slice(cursor)), `${label} must cover every target word.`);
  return Object.freeze({
    system: "pinyin",
    status: reading.status,
    sourcePath,
    sourceId: identifier(reading.sourceId, `${label}.sourceId`),
    tokens: Object.freeze(tokens)
  });
}

function editorialReview(value, label, { authored = false } = {}) {
  const review = record(value, label);
  const pending = authored ? ["ai-editorial-pending"] : ["pending", "ai-editorial-pending"];
  const reviewed = review.status === "ai-editorial-reviewed";
  requireCondition(reviewed || pending.includes(review.status), `${label} must retain a pending or AI editorial status.`);
  if (reviewed) {
    text(review.reviewer, `${label}.reviewer`, 180);
    requireCondition(typeof review.reviewedAt === "string" && /^\d{4}-\d{2}-\d{2}(?:T[^\s]+Z)?$/u.test(review.reviewedAt)
      && Number.isFinite(Date.parse(review.reviewedAt)), `${label}.reviewedAt must be an ISO date.`);
  } else {
    requireCondition(review.reviewer === null && review.reviewedAt === null,
      `${label} must not name a reviewer or date while pending.`);
  }
  return Object.freeze({ status: review.status, reviewer: reviewed ? review.reviewer.trim() : null,
    reviewedAt: reviewed ? review.reviewedAt : null, notes: text(review.notes, `${label}.notes`, 1000) });
}

/** Validate and copy course-owned practice content without upgrading its review status. */
export function validateSoundQuasarCatalog(document, { courseId, targetLanguageId, learnerBaseLanguage } = {}) {
  const source = record(document, "catalog");
  requireCondition(source.schemaVersion === 1 && source.gameId === GAME_ID, "catalog must use the sound-quasar schemaVersion 1 contract.");
  requireCondition(source.mode === "practice", "only listening practice content is supported; this is not pronunciation assessment evidence.");
  const actualCourseId = identifier(source.courseId, "courseId");
  const actualTargetId = identifier(source.targetLanguageId, "targetLanguageId");
  if (courseId !== undefined) requireCondition(actualCourseId === courseId, "catalog belongs to a different course.");
  if (targetLanguageId !== undefined) requireCondition(actualTargetId === targetLanguageId, "catalog belongs to a different target language.");

  // Existing English-base catalogs predate the explicit presentation role.
  // A non-English course must supply its own locale and learner-facing meanings.
  const actualBaseLocale = languageLocale(source.learnerBaseLanguage ?? "en", "learnerBaseLanguage");
  if (learnerBaseLanguage !== undefined) {
    const expectedBaseLocale = languageLocale(learnerBaseLanguage, "expected learnerBaseLanguage");
    requireCondition(actualBaseLocale === expectedBaseLocale, "catalog belongs to a different learner-base language.");
  }
  requireCondition((source.auditLanguage ?? "en") === "en", "auditLanguage must remain English.");
  if (actualBaseLocale.split("-")[0] !== "en") {
    requireCondition(source.auditLanguage === "en", "non-English learner bases must explicitly declare auditLanguage en.");
  }

  const audio = record(source.audio, "audio");
  requireCondition(audio.kind === "device-speech" && audio.reviewStatus === "unreviewed" && audio.purpose === "listening-practice", "audio must explicitly declare unreviewed device speech for listening practice.");
  const locale = text(audio.locale, "audio.locale", 40);
  requireCondition(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(locale) && locale.split("-")[0] === actualTargetId.split("-")[0], "audio locale must match the target language.");

  const provenance = record(source.provenance, "provenance");
  const sourcePath = text(provenance.sourcePath, "provenance.sourcePath", 220);
  requireCondition(/^apps\/languages\/[a-z0-9]+(?:-[a-z0-9]+)*\/static\/data\/games\/verb-nebula\/content\.json$/u.test(sourcePath), "provenance must name the existing course vocabulary file.");
  let authoredProvenance;
  if (source.authoredProvenance !== undefined) {
    const authored = record(source.authoredProvenance, "authoredProvenance");
    requireCondition(authored.kind === "first-party-authored", "authoredProvenance.kind must be first-party-authored.");
    const review = editorialReview({ ...authored, status: authored.reviewStatus }, "authoredProvenance", { authored: true });
    authoredProvenance = Object.freeze({ kind: authored.kind, reviewStatus: review.status,
      reviewer: review.reviewer, reviewedAt: review.reviewedAt, notes: review.notes });
  }
  const itemIds = new Set();
  function collection(values, label, maxLength) {
    requireCondition(Array.isArray(values) && values.length >= 4 && values.length <= 500, `${label} must contain 4–500 entries.`);
    const sourceIds = new Set();
    const targetWords = new Set();
    return Object.freeze(values.map((value, index) => {
      const item = record(value, `${label}[${index}]`);
      const id = identifier(item.id, `${label}[${index}].id`);
      const target = text(item.target, `${label}[${index}].target`, maxLength);
      const spokenTarget = label === "sentences" ? target.replace(/\p{P}/gu, "") : target;
      const identity = spokenTarget.toLocaleLowerCase(locale).replace(/\s+/gu, " ").trim();
      requireCondition(!itemIds.has(id) && !targetWords.has(identity), "item IDs and targets must be unique, including Unicode, case, and sentence-punctuation equivalents.");
      requireCondition(!/[\/|]/u.test(target), "targets cannot contain alternative answers.");
      const sourceId = text(item.sourceId, `${label}[${index}].sourceId`, 100);
      requireCondition(SOURCE_ID_PATTERN.test(sourceId) && !sourceIds.has(sourceId), "source item references must be stable and unique.");
      const sourceReviewStatus = text(item.sourceReviewStatus, `${label}[${index}].sourceReviewStatus`, 80);
      requireCondition(/^[a-z]+(?:[-_][a-z]+)*$/u.test(sourceReviewStatus), "sourceReviewStatus must preserve an explicit source status or not-declared.");
      if (item.sourceKind !== undefined) {
        requireCondition(item.sourceKind === "authored-listening", `${label}[${index}].sourceKind is unsupported.`);
        requireCondition(authoredProvenance && sourceId === id,
          `${label}[${index}] authored listening needs provenance and sourceId equal to its stable item ID.`);
        requireCondition(sourceReviewStatus === authoredProvenance.reviewStatus,
          `${label}[${index}] must preserve its authored editorial review status.`);
      }
      itemIds.add(id);
      targetWords.add(identity);
      sourceIds.add(sourceId);
      const difficulty = item.difficulty === undefined ? undefined
        : integer(item.difficulty, `${label}[${index}].difficulty`, 1, 3);
      return Object.freeze({
        id,
        revision: identifier(item.revision, `${label}[${index}].revision`),
        target,
        meaning: text(item.meaning, `${label}[${index}].meaning`, 300),
        englishAuditText: text(item.englishAuditText, `${label}[${index}].englishAuditText`, 300),
        sourceId,
        sourceReviewStatus,
        ...(difficulty === undefined ? {} : { difficulty }),
        ...(item.sourceKind ? { sourceKind: item.sourceKind } : {}),
        ...(item.reading === undefined ? {} : { reading: readingGuide(item.reading, target, actualTargetId, `${label}[${index}].reading`) })
      });
    }));
  }
  const items = collection(source.items, "items", 80);
  requireCondition(Array.isArray(provenance.sourceItemIds) && provenance.sourceItemIds.length === items.length && provenance.sourceItemIds.every((id, index) => id === items[index].sourceId), "provenance.sourceItemIds must exactly identify the selected source records in order.");

  let sentences = Object.freeze([]);
  let sentenceProvenance;
  if (source.sentences !== undefined || source.sentenceProvenance !== undefined) {
    sentences = collection(source.sentences, "sentences", 240);
    const declared = record(source.sentenceProvenance, "sentenceProvenance");
    const sentenceSourcePath = text(declared.sourcePath, "sentenceProvenance.sourcePath", 220);
    const courseDirectory = sourcePath.split("/")[2];
    requireCondition([
      `apps/languages/${courseDirectory}/static/data/games/word-world/content.json`,
      `apps/languages/${courseDirectory}/static/data/games/word-world/content.json`
    ].includes(sentenceSourcePath), "sentence provenance must name the course's existing Word World content.");
    const englishSourcePath = text(declared.englishSourcePath, "sentenceProvenance.englishSourcePath", 220);
    requireCondition(englishSourcePath === sentenceSourcePath || englishSourcePath === "apps/languages/shared/english-concepts/word-world-starter-v1.json", "sentence English provenance must name the existing English authority.");
    requireCondition(Array.isArray(declared.sourceItemIds) && declared.sourceItemIds.length === sentences.length && declared.sourceItemIds.every((id, index) => id === sentences[index].sourceId), "sentenceProvenance.sourceItemIds must exactly identify the selected source records in order.");
    sentenceProvenance = Object.freeze({
      sourcePath: sentenceSourcePath,
      englishSourcePath,
      sourceItemIds: Object.freeze([...declared.sourceItemIds]),
      selection: text(declared.selection, "sentenceProvenance.selection", 300)
    });
  }

  const catalog = Object.freeze({
    schemaVersion: 1,
    gameId: GAME_ID,
    courseId: actualCourseId,
    targetLanguageId: actualTargetId,
    learnerBaseLanguage: actualBaseLocale,
    auditLanguage: "en",
    id: identifier(source.id, "id"),
    contentRevision: identifier(source.contentRevision, "contentRevision"),
    mode: "practice",
    audio: Object.freeze({ kind: "device-speech", locale, reviewStatus: "unreviewed", purpose: "listening-practice" }),
    provenance: Object.freeze({
      sourcePath,
      sourceItemIds: Object.freeze([...provenance.sourceItemIds]),
      selection: text(provenance.selection, "provenance.selection", 300)
    }),
    items,
    sentences,
    ...(authoredProvenance ? { authoredProvenance } : {}),
    ...(sentenceProvenance ? { sentenceProvenance } : {})
  });
  validatedCatalogs.add(catalog);
  return catalog;
}

function asCatalog(catalog) {
  return validatedCatalogs.has(catalog) ? catalog : validateSoundQuasarCatalog(catalog);
}

function modeItems(catalog, mode) {
  requireCondition(mode === "words" || mode === "sentences", "mode must be words or sentences.");
  const items = mode === "words" ? catalog.items : catalog.sentences;
  requireCondition(items.length >= 4, `catalog does not contain ${mode} content.`);
  return items;
}

function makeRound(items, answer, random, choiceCount, mode) {
  integer(choiceCount, "choiceCount", 2, items.length);
  const distractors = shuffled(items.filter(({ id }) => id !== answer.id), random).slice(0, choiceCount - 1);
  const choices = shuffled([answer, ...distractors], random).map(({ id, target, meaning, reading }) => Object.freeze({ id, target, meaning, ...(reading ? { reading } : {}) }));
  return Object.freeze({
    id: answer.id,
    revision: answer.revision,
    sourceId: answer.sourceId,
    mode,
    target: answer.target,
    meaning: answer.meaning,
    ...(answer.reading ? { reading: answer.reading } : {}),
    choices: Object.freeze(choices),
    answerId: answer.id
  });
}

export function soundQuasarItemsForDifficulty(catalog, { mode = "words", difficulty = 3 } = {}) {
  integer(difficulty, "difficulty", 1, 3);
  return modeItems(asCatalog(catalog), mode).filter(item => item.difficulty === undefined || item.difficulty <= difficulty);
}

export function buildSoundQuasarRound(catalog, { index = 0, random = Math.random, choiceCount = 4, mode = "words", difficulty = 3 } = {}) {
  const validated = asCatalog(catalog);
  integer(choiceCount, "choiceCount", 2, modeItems(validated, mode).length);
  const items = soundQuasarItemsForDifficulty(validated, { mode, difficulty });
  requireCondition(items.length >= 2, "difficulty needs at least two eligible listening items.");
  integer(index, "index", 0, Number.MAX_SAFE_INTEGER);
  return makeRound(items, items[index % items.length], random, Math.min(choiceCount, items.length), mode);
}

/** A finite session never repeats an answer. The host owns playback and progress. */
export function createSoundQuasarSession(catalog, { random = Math.random, roundLength = 5, choiceCount = 4, mode = "words", difficulty = 3 } = {}) {
  const validated = asCatalog(catalog);
  const items = soundQuasarItemsForDifficulty(validated, { mode, difficulty });
  requireCondition(items.length >= 2, "difficulty needs at least two eligible listening items.");
  integer(choiceCount, "choiceCount", 2, modeItems(validated, mode).length);
  integer(roundLength, "roundLength", 1, 500);
  const answers = shuffled(items, random).slice(0, Math.min(roundLength, items.length));
  return Object.freeze(answers.map((answer) => makeRound(items, answer, random, Math.min(choiceCount, items.length), mode)));
}

export function evaluateSoundQuasarChoice(round, choiceId) {
  record(round, "round");
  requireCondition(Array.isArray(round.choices) && round.choices.some(({ id }) => id === round.answerId), "round must contain its answer.");
  requireCondition(typeof choiceId === "string" && round.choices.some(({ id }) => id === choiceId), "choiceId is not an option in this round.");
  return choiceId === round.answerId;
}
