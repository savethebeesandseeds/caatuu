import { normalizeCurriculum, normalizeCurriculumItem } from "../curriculum-progression.mjs";
import { normalizeContentProgression, selectContentItems, matchesContentDifficulty } from "../adaptive-practice.mjs";

/** One declared case system; no language or script is implicitly selected. */
export function normalizeCaseSystem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "cases,contrasts,sourceLocale,targetLocale") {
    throw new Error("Case Cosmos requires explicit locales, cases and contrasts.");
  }
  for (const field of ["targetLocale", "sourceLocale"]) {
    if (typeof value[field] !== "string" || Intl.getCanonicalLocales(value[field])[0] !== value[field]) {
      throw new Error("Case Cosmos needs canonical " + field + ".");
    }
  }
  if (!Array.isArray(value.cases) || value.cases.length < 2 || value.cases.length > 32) {
    throw new Error("Case Cosmos needs 2 to 32 declared cases.");
  }
  const names = new Set();
  const cases = value.cases.map(row => {
    if (!row || Object.keys(row).sort().join(",") !== "case,meaning,question"
        || ["case", "meaning", "question"].some(key => typeof row[key] !== "string" || !row[key].trim()
          || row[key] !== row[key].normalize("NFC") || row[key].length > 200 || /[\p{Cc}\p{Cf}<>]/u.test(row[key]))
        || names.has(row.case)) throw new Error("Invalid or repeated case definition.");
    names.add(row.case);
    return Object.freeze({ case: row.case, meaning: row.meaning, question: row.question });
  });
  if (!value.contrasts || Object.keys(value.contrasts).length !== names.size) throw new Error("Case contrasts must cover every case.");
  const contrasts = Object.fromEntries(cases.map(row => {
    const alternatives = value.contrasts[row.case];
    if (!Array.isArray(alternatives) || !alternatives.length || new Set(alternatives).size !== alternatives.length
        || alternatives.some(name => !names.has(name) || name === row.case)) throw new Error("Case contrasts must name other declared cases.");
    return [row.case, Object.freeze([...alternatives])];
  }));
  return Object.freeze({ targetLocale: value.targetLocale, sourceLocale: value.sourceLocale,
    cases: Object.freeze(cases), contrasts: Object.freeze(contrasts) });
}

export function createCaseCosmosContent({ courseId, caseSystem: declaration } = {}) {
  if (typeof courseId !== "string" || !courseId.trim()) throw new Error("Case Cosmos requires an explicit course ID.");
  const caseSystem = normalizeCaseSystem(declaration);
  const targetLocale = caseSystem.targetLocale;
  const CASE_DEFINITIONS = caseSystem.cases;
  const CASE_CONTRASTS = caseSystem.contrasts;
function requiredText(value, location, maxLength) {
  if (typeof value !== "string" || !value || value !== value.trim()
      || value !== value.normalize("NFC") || value.length > maxLength
      || /[\p{Cc}\p{Cf}<>]/u.test(value)) {
    throw new Error(`${location} needs bounded, normalized plain text without controls or markup.`);
  }
}

function exactKeys(value, keys, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${location} may contain only ${keys.join(", ")}.`);
  }
}

function contentKeys(value, keys, location) {
  exactKeys(value, [...keys, ...["usefulness", "complexity", "urgency", "subdifficulty"].filter(key => Object.hasOwn(value || {}, key))], location);
  normalizeContentProgression(value, location);
}

// The JSON catalog owns vocabulary, sentences, translations and form pools.
// These checks validate the contract, not membership in a second content bank.
function identifier(value, location) {
  requiredText(value, location, 160);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(value)) throw new Error(`${location} needs a stable lowercase ID.`);
}

function nounForm(value) {
  requiredText(value, "Noun form", 48);
  if (!/^[\p{L}\p{M}]+$/u.test(value)) throw new Error("The target must be one target-language word.");
}

function validateParadigm(paradigm) {
  contentKeys(paradigm, ["id", "noun", "number", "forms"], "Paradigm");
  identifier(paradigm.id, "Paradigm ID");
  nounForm(paradigm.noun);
  if (!["singular", "plural"].includes(paradigm.number)) throw new Error("A paradigm needs singular or plural number.");
  if (!Array.isArray(paradigm.forms) || !paradigm.forms.length) throw new Error("A paradigm needs a nonempty form pool.");
  paradigm.forms.forEach(nounForm);
  if (new Set(paradigm.forms).size !== paradigm.forms.length) throw new Error("A paradigm repeats a form.");
}

function validateContext(item) {
  contentKeys(item, ["id", "revision", "paradigmId", "case", "form", "acceptedForms", "czech", "english",
    "difficulty", "objectiveId", "phase", "context", "explanation",
    ...(Object.hasOwn(item || {}, "semanticBankId") ? ["semanticBankId"] : [])], "Context");
  if (Object.hasOwn(item, "semanticBankId") && (typeof item.semanticBankId !== "string"
      || !/^sb\.case-cosmos\.\d{6}$/u.test(item.semanticBankId))) {
    throw new Error("A Case Cosmos semanticBankId must name its case-cosmos bank row.");
  }
  identifier(item.id, "Context ID");
  identifier(item.paradigmId, "Context paradigm ID");
  if (!Number.isInteger(item.revision) || item.revision < 1) throw new Error("A context needs a positive revision.");
  if (!CASE_DEFINITIONS.some(({ case: name }) => name === item.case)) throw new Error("Unknown declared case.");
  targetSpan(item.czech, item.form);
  requiredText(item.english, "Source-language translation", 200);
  if (!Array.isArray(item.acceptedForms)) throw new Error("A context needs an accepted-forms list.");
  item.acceptedForms.forEach(nounForm);
}

function validateContextForms(item, paradigm) {
  const accepted = new Set([item.form, ...item.acceptedForms]);
  if (accepted.size !== item.acceptedForms.length + 1 || [...accepted].some((form) => !paradigm.forms.includes(form))) {
    throw new Error(`${item.id} has an undeclared or repeated accepted form.`);
  }
  if (!paradigm.forms.some((form) => !accepted.has(form))) throw new Error(`${item.id} needs a genuine contrast form.`);
}

function targetSpan(czech, form) {
  requiredText(czech, "Target sentence", 160);
  nounForm(form);
  const target = form.toLocaleLowerCase(targetLocale);
  const tokens = [...czech.matchAll(/[\p{L}\p{M}\p{N}_]+(?:[-’'][\p{L}\p{M}\p{N}_]+)*/gu)];
  const matches = tokens.filter(([text]) => text.toLocaleLowerCase(targetLocale) === target);
  if (matches.length !== 1) throw new Error("The sentence must contain exactly one whole-word target, never a substring or repeated target.");
  return Object.freeze({ start: matches[0].index, end: matches[0].index + matches[0][0].length });
}

function validateLegacyPack(value) {
  if (!Array.isArray(value) || !value.length) throw new Error("The noun bank must be a nonempty list.");
  const nouns = new Set();
  const difficulties = new Set();
  const allSentences = new Set();
  const result = value.map((entry) => {
    contentKeys(entry, ["noun", "difficulty", "cases"], "Noun record");
    requiredText(entry.noun, "Noun", 48);
    const nounKey = entry.noun.toLocaleLowerCase(targetLocale);
    if (nouns.has(nounKey)) throw new Error(`The noun bank repeats ${entry.noun}.`);
    nouns.add(nounKey);
    if (!Number.isInteger(entry.difficulty) || entry.difficulty < 0 || entry.difficulty > 3) throw new Error(`${entry.noun} needs difficulty 0, 1, 2, or 3.`);
    difficulties.add(entry.difficulty);
    exactKeys(entry.cases, CASE_DEFINITIONS.map(({ case: name }) => name), entry.noun);
    const cases = Object.fromEntries(CASE_DEFINITIONS.map(({ case: name }) => {
      const example = entry.cases[name];
      contentKeys(example, ["form", "english", "czech"], `${entry.noun}, ${name}`);
      requiredText(example.english, "Source-language translation", 200);
      targetSpan(example.czech, example.form);
      const sentenceKey = example.czech.toLocaleLowerCase(targetLocale);
      if (allSentences.has(sentenceKey)) throw new Error(`Repeated Target sentence: ${example.czech}`);
      allSentences.add(sentenceKey);
      return [name, Object.freeze({ form: example.form, english: example.english, czech: example.czech,
        ...normalizeContentProgression({ ...entry, ...example }, `${entry.noun}, ${name}`) })];
    }));
    if (new Set(Object.values(cases).map(({ form }) => form)).size < 2) throw new Error(`${entry.noun} needs a genuine contrast form.`);
    return Object.freeze({ noun: entry.noun, difficulty: entry.difficulty, ...normalizeContentProgression(entry), cases: Object.freeze(cases) });
  });
  if (![1, 2, 3].every(level => difficulties.has(level))) throw new Error("The noun bank must support all three difficulty levels.");
  return Object.freeze(result);
}

function sentenceFields(row) {
  if (!row || typeof row !== "object" || !Object.hasOwn(row, "target") || !Object.hasOwn(row, "source")) return row;
  if (Object.hasOwn(row, "czech") || Object.hasOwn(row, "english")) throw new Error("Case text fields must not be ambiguous.");
  const { target, source, ...rest } = row;
  // Legacy names are normalized output aliases for the retained host/history API.
  return { ...rest, czech: target, english: source };
}

function nounFields(row) {
  return row?.cases ? { ...row, cases: Object.fromEntries(Object.entries(row.cases).map(([name, sentence]) => [name, sentenceFields(sentence)])) } : row;
}

function validatePack(value) {
  if (Array.isArray(value)) return validateLegacyPack(value.map(nounFields));
  if (value && Array.isArray(value.contexts) && value.contexts.length && value.contexts.every(item => item?.reviewStatus === "untranslated")) {
    return Object.freeze({ ...value, legacyNouns: Object.freeze([]), contexts: Object.freeze(value.contexts) });
  }
  if (value && typeof value === "object") value = { ...value,
    contexts: Array.isArray(value.contexts) ? value.contexts.map(sentenceFields) : value.contexts,
    legacyNouns: Array.isArray(value.legacyNouns) ? value.legacyNouns.map(nounFields) : value.legacyNouns };
  exactKeys(value, ["schemaVersion", "courseId", "contentRevision", "caseSystem", "curriculum", "legacyNouns", "paradigms", "contexts"], "Case Cosmos content");
  if (value.schemaVersion !== "caatuu-case-cosmos-content-v3" || value.courseId !== courseId
      || !Number.isInteger(value.contentRevision) || value.contentRevision < 1) {
    throw new Error("Case Cosmos needs its versioned course-owned content contract.");
  }
  if (JSON.stringify(normalizeCaseSystem(value.caseSystem)) !== JSON.stringify(caseSystem)) {
    throw new Error("Case Cosmos content disagrees with its declared case system.");
  }
  const legacyNouns = value.legacyNouns.length ? validateLegacyPack(value.legacyNouns) : Object.freeze([]);
  const curriculum = normalizeCurriculum(value.curriculum);
  if (!curriculum) throw new Error("Case Cosmos needs a declared curriculum.");
  if (!Array.isArray(value.paradigms) || !value.paradigms.length
      || !Array.isArray(value.contexts) || !value.contexts.length) {
    throw new Error("Case Cosmos needs nonempty checked paradigms and authored contexts.");
  }
  const byId = new Map();
  const paradigms = value.paradigms.map((paradigm) => {
    validateParadigm(paradigm);
    if (byId.has(paradigm.id)) throw new Error("Case Cosmos repeats a paradigm ID.");
    const frozen = Object.freeze({ ...paradigm, ...normalizeContentProgression(paradigm), forms: Object.freeze([...paradigm.forms]) });
    byId.set(frozen.id, frozen);
    return frozen;
  });
  const ids = new Set();
  const sentences = new Set(legacyNouns.flatMap(({ cases }) => Object.values(cases).map(({ czech }) => czech.toLocaleLowerCase(targetLocale))));
  const contexts = value.contexts.map((item) => {
    validateContext(item);
    if (ids.has(item.id)) throw new Error("Case Cosmos repeats a stable context ID.");
    ids.add(item.id);
    const paradigm = byId.get(item.paradigmId);
    if (!paradigm) throw new Error(`${item.id} has no declared paradigm.`);
    validateContextForms(item, paradigm);
    const sentence = item.czech.toLocaleLowerCase(targetLocale);
    if (sentences.has(sentence)) throw new Error(`Repeated Target sentence: ${item.czech}`);
    sentences.add(sentence);
    const metadata = normalizeCurriculumItem(item, curriculum, item.id);
    return Object.freeze({ ...item, ...metadata, ...normalizeContentProgression(item), acceptedForms: Object.freeze([...item.acceptedForms]) });
  });
  for (const objective of curriculum.objectives) {
    const owned = contexts.filter(({ objectiveId }) => objectiveId === objective.id);
    const practiceNouns = new Set(owned.filter(({ phase }) => phase === "practice").map(({ paradigmId }) => byId.get(paradigmId).noun));
    if (practiceNouns.size < 3 || !owned.some(({ phase }) => phase === "transfer")) {
      throw new Error(`${objective.id} needs three lexical practice contexts and reserved transfer.`);
    }
  }
  return Object.freeze({ schemaVersion: value.schemaVersion, courseId: value.courseId,
    contentRevision: value.contentRevision, caseSystem, curriculum, legacyNouns,
    paradigms: Object.freeze(paradigms), contexts: Object.freeze(contexts) });
}

function buildRounds(pack, difficulty) {
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 3) throw new Error("Invalid Case Cosmos difficulty.");
  const checked = validatePack(pack);
  if (!Array.isArray(checked)) {
    const paradigms = new Map(checked.paradigms.map((paradigm) => [paradigm.id, paradigm]));
    const contexts = checked.contexts.filter((item) => item.reviewStatus !== "untranslated" && matchesContentDifficulty(item, difficulty)).map((item) => {
      const paradigm = paradigms.get(item.paradigmId);
      const definition = CASE_DEFINITIONS.find(({ case: name }) => name === item.case);
      return Object.freeze({ ...item, noun: paradigm.noun, number: paradigm.number,
        formPool: paradigm.forms, contextItem: item,
        matches: Object.freeze([Object.freeze({ ...definition, ...item })]) });
    });
    return Object.freeze([...(checked.legacyNouns.length ? buildRounds(checked.legacyNouns, difficulty) : []), ...contexts]);
  }
  return Object.freeze(checked.filter((entry) => matchesContentDifficulty(entry, difficulty))
    .sort((a, b) => a.difficulty - b.difficulty)
    .map((entry) => Object.freeze({ noun: entry.noun, difficulty: entry.difficulty, ...normalizeContentProgression(entry),
      matches: Object.freeze(CASE_DEFINITIONS.map((definition) => Object.freeze({ ...definition, ...entry.cases[definition.case] })))
    })));
}

/** Schedule individual authored sentences while keeping each noun's checked contrasts. */
function casePracticeItems(pack, difficulty, random = Math.random) {
  return Object.freeze(buildRounds(pack, difficulty).flatMap(round => buildQuestions(round, random).map(question => {
    const nounKey = Array.from(round.noun).map(char => char.codePointAt(0).toString(16)).join("-");
    const id = question.id || `legacy-${nounKey}-${question.case.toLowerCase()}`;
    return Object.freeze({ ...round, id, ...normalizeContentProgression({ ...round, ...question }),
      practiceQuestions: Object.freeze([Object.freeze({ ...question, id })]) });
  })));
}

function buildCasePracticeRounds(pack, difficulty, { history = {}, random = Math.random, policy = null } = {}) {
  const items = casePracticeItems(pack, difficulty, random);
  return Object.freeze(selectContentItems(items, { difficulty, history, minimumPool: 4, random, policy }));
}

function randomIndex(length, random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Question randomness must be a number in [0, 1).");
  return Math.floor(value * length);
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomIndex(index + 1, random);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function buildQuestions(round, random = Math.random) {
  if (round?.contextItem) {
    const item = round.contextItem;
    validateContext(item);
    const paradigm = { id: item.paradigmId, noun: round.noun, number: round.number, forms: round.formPool };
    validateParadigm(paradigm);
    validateContextForms(item, paradigm);
    const definition = CASE_DEFINITIONS.find(({ case: name }) => name === item.case);
    const target = targetSpan(item.czech, item.form);
    const accepted = new Set([item.form, ...item.acceptedForms]);
    // Accepted syncretic/alternative forms never become false answers.
    const alternatives = shuffled(round.formPool.filter((form) => !accepted.has(form)), random)
      .slice(0, 1 + randomIndex(3, random));
    const candidates = shuffled([...alternatives, item.form], random).map((form) => {
      const visible = target.start === 0 ? form[0].toLocaleUpperCase(targetLocale) + form.slice(1) : form;
      const czech = item.czech.slice(0, target.start) + visible + item.czech.slice(target.end);
      return Object.freeze({ ...definition, form, czech, english: item.english,
        target: targetSpan(czech, form), matches: accepted.has(form) });
    });
    return Object.freeze([Object.freeze({ ...definition, ...item, target, candidates: Object.freeze(candidates) })]);
  }
  if (!round || round.matches?.length !== CASE_DEFINITIONS.length || new Set(round.matches.map((entry) => entry.case)).size !== CASE_DEFINITIONS.length
      || round.matches.some((entry) => !Object.hasOwn(CASE_CONTRASTS, entry.case))) {
    throw new Error("A noun round must contain exactly one example of each declared case.");
  }
  for (const example of round.matches) {
    requiredText(example.english, "Source-language translation", 200);
    targetSpan(example.czech, example.form);
  }
  if (new Set(round.matches.map(({ form }) => form)).size < 2) throw new Error("A noun round needs a genuine contrast form.");
  return Object.freeze(shuffled(round.matches, random).map((example) => {
    const actualCase = CASE_DEFINITIONS.find((entry) => entry.case === example.case);
    const target = targetSpan(example.czech, example.form);
    const preferred = CASE_CONTRASTS[example.case].map((name) => round.matches.find((entry) => entry.case === name).form);
    const forms = [...new Set([...preferred, ...shuffled(round.matches, random).map((entry) => entry.form)])]
      .filter((form) => form !== example.form);
    const alternatives = forms.slice(0, 1 + randomIndex(3, random));
    const candidates = shuffled([...alternatives, example.form], random).map((form) => {
      const visible = target.start === 0 ? form[0].toLocaleUpperCase(targetLocale) + form.slice(1) : form;
      const czech = example.czech.slice(0, target.start) + visible + example.czech.slice(target.end);
      return Object.freeze({ ...actualCase, form, czech, english: example.english,
        target: targetSpan(czech, form), matches: form === example.form });
    });
    return Object.freeze({ ...actualCase, ...normalizeContentProgression(example), form: example.form, czech: example.czech,
      english: example.english, target, candidates: Object.freeze(candidates) });
  }));
}

  return Object.freeze({ caseSystem, validatePack, targetSpan, buildRounds, buildQuestions, casePracticeItems, buildCasePracticeRounds });
}

export function caseCosmosContentForCourse(document, course) {
  const caseSystem = normalizeCaseSystem(document?.caseSystem);
  if (caseSystem.targetLocale !== course?.targetLanguage?.locale
      || caseSystem.sourceLocale !== course?.sourceLanguage?.locale) {
    throw new Error("Case Cosmos locales do not match the selected course.");
  }
  return createCaseCosmosContent({ courseId: course.id, caseSystem });
}
