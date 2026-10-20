import { learnerItemState } from "./learner-state.mjs";
import { fetchDeclaredCourseGameJson } from "./games/course-game-content.mjs?v=course-game-content-1";
import { extractCoreVerbPairs } from "./games/verb-nebula/verb-nebula-core.mjs?v=verb-nebula-core-15";
import { validateConjugationCometCatalog, buildConjugationHelixRound } from "./games/conjugation-comet/conjugation-comet-core.mjs?v=conjugation-comet-core-5";
import { validateGrammarGravityPack, buildGrammarGravityRounds } from "./games/grammar-gravity/grammar-gravity-core.mjs?v=grammar-gravity-core-9";
import { normalizeNounLandingPack, createNounLandingSession } from "./games/grammar-gravity/noun-landing-core.mjs?v=noun-landing-core-12";
import { validateSoundQuasarCatalog, buildSoundQuasarRound } from "./games/sound-quasar/sound-quasar-core.mjs?v=sound-quasar-12";
import { validateMemoryMoonCatalog } from "./games/memory-moon/memory-moon-core.mjs?v=memory-moon-4";
import { joinConceptCatalogs } from "./catalog-runtime.mjs";
import "./shell-policy.js?v=shell-policy-18";

const DAY_MS = 24 * 60 * 60 * 1000;
const record = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && Boolean(value.trim());
const pathKey = (gameId, bankId) => JSON.stringify([gameId, bankId]);
const canonicalGame = id => id === "word-net" ? "word-world" : id === "verb-lab" ? "verb-nebula"
  : ["agreement-aurora", "triangular-thermosphere"].includes(id) ? "grammar-gravity" : id;

// Product heuristics for an invitation to try another content band. These do
// not estimate mastery, independent accuracy, or a probability of recall.
export const BADGE_RECOMMENDATION_POLICY = Object.freeze({
  version: "badge-recommendation-1", calibrated: false,
  independentItems: 12, spacedItems: 6, independentDays: 2, recentDays: 30
});

/** Read-only decision over resolved current-course catalog identities.
 * items: { identity:{courseId,gameId,bankId,itemId}, difficulty, groupId?, history }
 * nextPlayable: [{gameId,bankId,playable:boolean}] for actual next-band tasks.
 * groupId collapses directions/helix forms for breadth, never their evidence.
 */
export function evaluateBadgeRecommendation({ courseId, difficulty, stageComplete = false,
  items = [], nextPlayable = [], partial = false, issues = [], now = Date.now(),
  policy = BADGE_RECOMMENDATION_POLICY } = {}) {
  if (!text(courseId) || ![0, 1, 2, 3].includes(difficulty) || !Number.isFinite(now)
    || !Number.isFinite(new Date(now).getTime()) || !Array.isArray(items) || !Array.isArray(nextPlayable)) {
    throw new TypeError("A course, exact difficulty, valid time, and resolved evidence arrays are required.");
  }
  if (["independentItems", "spacedItems", "independentDays", "recentDays"].some(field => !Number.isSafeInteger(policy[field]) || policy[field] < 1)) {
    throw new TypeError("Recommendation requirements must be positive integers.");
  }
  const result = { courseId, difficulty, suggestedDifficulty: difficulty < 3 ? difficulty + 1 : null,
    status: "evidence-needed", recommended: false, heuristicVersion: policy.version, calibrated: false,
    interpretation: "Invitation to try a harder authored band; not a mastery or completion assessment.",
    requirements: { ...policy }, counts: { resolvedItems: 0, independentItems: 0, spacedItems: 0, unresolvedItems: 0 },
    reasons: [], issues: [...issues] };
  if (difficulty === 3) return { ...result, status: "max-level", reasons: ["highest-authored-badge"] };
  if (stageComplete !== true) return { ...result, status: "practice-needed", reasons: ["practice-stage-incomplete"] };
  const seen = new Set(), groups = new Map(), qualifyingPaths = new Set();
  for (const item of items) {
    const identity = item?.identity;
    if (!identity || identity.courseId !== courseId || ["gameId", "bankId", "itemId"].some(field => !text(identity[field]))
      || ![0, 1, 2, 3].includes(item.difficulty)) {
      result.counts.unresolvedItems++; result.issues.push("identity-or-difficulty-unresolved"); continue;
    }
    if (item.difficulty !== difficulty) continue;
    const identityId = JSON.stringify([identity.gameId, identity.bankId, identity.itemId]);
    if (seen.has(identityId)) continue;
    seen.add(identityId);
    const key = JSON.stringify([identity.gameId, item.groupId || identity.itemId]);
    if (!groups.has(key)) groups.set(key, { independent: false, spaced: false });
    if (!record(item.history)) { result.counts.unresolvedItems++; result.issues.push("history-unavailable"); continue; }
    let state;
    try { state = learnerItemState({ ...identity, history: { [identity.itemId]: item.history }, now }); }
    catch { result.counts.unresolvedItems++; result.issues.push("history-invalid"); continue; }
    if (state.uncertainty.reasons.includes("history-ahead-of-clock")) {
      result.counts.unresolvedItems++; result.issues.push("history-ahead-of-clock"); continue;
    }
    const assessment = state.evidence.latestAssessment;
    const at = Date.parse(assessment?.at);
    const independent = state.evidence.independentSuccesses > 0 && assessment?.evidence === "independent"
      && assessment.correct === true && Number.isFinite(at) && at <= now && now - at <= policy.recentDays * DAY_MS;
    if (!independent) continue;
    const group = groups.get(key);
    group.independent = true;
    group.spaced ||= state.evidence.spacedSuccesses > 0 && state.evidence.independentDays >= policy.independentDays;
    qualifyingPaths.add(pathKey(identity.gameId, identity.bankId));
  }
  result.counts.resolvedItems = groups.size;
  result.counts.independentItems = [...groups.values()].filter(group => group.independent).length;
  result.counts.spacedItems = [...groups.values()].filter(group => group.spaced).length;
  if (partial || result.counts.unresolvedItems || result.issues.length) {
    return { ...result, status: "unknown", reasons: ["evidence-or-catalog-incomplete"] };
  }
  if (result.counts.independentItems < policy.independentItems) result.reasons.push("more-recent-independent-items-needed");
  if (result.counts.spacedItems < policy.spacedItems) result.reasons.push("more-spaced-independent-items-needed");
  const overlap = nextPlayable.some(path => path.playable === true && qualifyingPaths.has(pathKey(path.gameId, path.bankId)));
  if (!overlap) result.reasons.push("next-band-not-playable-on-practiced-path");
  if (result.reasons.length) return result;
  return { ...result, status: "ready", recommended: true, reasons: ["practice-stage-and-retained-evidence-support-trying-next-badge"] };
}

const resourceNames = Object.freeze({ "word-world": "wordWorldManifest", "verb-nebula": "verbNebulaCatalog",
  "conjugation-comet": "conjugationCometCatalog", "grammar-gravity": "grammarGravityCatalog",
  "sound-quasar": "soundQuasarCatalog", "case-cosmos": "caseCosmosCatalog", "naturalization-nucleus": "naturalizationNucleusCatalog",
  "memory-moon": "memoryMoonCatalog" });
const menuIds = Object.freeze({ "word-world": "word-net", "verb-nebula": "verb-lab" });
const shellPolicy = globalThis.CaatuuShellPolicy;
function abortCheck(signal) {
  if (signal?.aborted) { const error = new Error("Badge recommendation was cancelled."); error.name = "AbortError"; throw error; }
}
function indexRows(rows, groupId = row => row.id) {
  if (!Array.isArray(rows)) throw new Error("Catalog rows are unavailable.");
  const indexed = new Map();
  for (const row of rows) {
    if (!text(row?.id) || indexed.has(row.id) || ![0, 1, 2, 3].includes(row.difficulty ?? 1)) throw new Error("Catalog identity or difficulty is invalid.");
    indexed.set(row.id, { difficulty: row.difficulty ?? 1, groupId: groupId(row) });
  }
  return indexed;
}
function catalogBank(gameId, bankId) {
  if (gameId === "word-world" && ["sentences", "reconstruct-target", "reconstruct-source"].includes(bankId)) return "sentences";
  if (gameId === "grammar-gravity" && /^phrases-(?:sequence|meaning|nouns|forms)$/u.test(bankId)) return "phrases";
  if (gameId === "naturalization-nucleus" && ["default", "recognize-hanzi-pinyin", "recognize-pinyin-hanzi", "recognize-target-reading", "recognize-reading-target"].includes(bankId)) return "default";
  return bankId;
}

// Match the legacy hosts' playable task construction rather than assuming
// that one catalog row can form a valid question or domino board. These checks
// resolve task identity and feasibility, not language review or proficiency.
function caseCatalog(document) {
  if (document.schemaVersion !== "caatuu-case-cosmos-content-v2" || !Array.isArray(document.contexts)
    || !Array.isArray(document.paradigms) || !Array.isArray(document.legacyNouns)) throw new Error("Unsupported Case Cosmos catalog.");
  const names = ["Nominative", "Genitive", "Dative", "Accusative", "Vocative", "Locative", "Instrumental"];
  const nounForm = value => text(value) && value === value.normalize("NFC") && /^[\p{Script=Latin}\p{M}]+$/u.test(value);
  const targetSpan = (sentence, form) => {
    if (!text(sentence) || !nounForm(form)) throw new Error("Missing case sentence or form.");
    const matches = [...sentence.matchAll(/[\p{L}\p{M}\p{N}_]+(?:[-’'][\p{L}\p{M}\p{N}_]+)*/gu)]
      .filter(([token]) => token.toLocaleLowerCase("cs-CZ") === form.toLocaleLowerCase("cs-CZ"));
    if (matches.length !== 1) throw new Error("Case task requires exactly one whole-word target.");
  };
  const paradigms = new Map();
  for (const paradigm of document.paradigms) {
    if (!text(paradigm.id) || paradigms.has(paradigm.id) || !nounForm(paradigm.noun) || !["singular", "plural"].includes(paradigm.number)
      || !Array.isArray(paradigm.forms) || paradigm.forms.length < 2 || paradigm.forms.some(form => !nounForm(form))
      || new Set(paradigm.forms).size !== paradigm.forms.length) throw new Error("Invalid case paradigm.");
    paradigms.set(paradigm.id, paradigm);
  }
  const rows = [], sentences = new Set(), nouns = new Set();
  const checkSentence = (row, pool, accepted) => {
    targetSpan(row.czech, row.form);
    if (!text(row.english) || accepted.some(form => !pool.includes(form))
      || new Set(accepted).size !== accepted.length || !pool.some(form => !accepted.includes(form))) throw new Error("Case task has no genuine contrast.");
    const sentence = row.czech.toLocaleLowerCase("cs-CZ");
    if (sentences.has(sentence)) throw new Error("Repeated case sentence.");
    sentences.add(sentence);
  };
  for (const noun of document.legacyNouns) {
    if (!text(noun.noun) || nouns.has(noun.noun.toLocaleLowerCase("cs-CZ")) || !record(noun.cases)
      || Object.keys(noun.cases).length !== 7 || names.some(name => !record(noun.cases[name]))) throw new Error("Invalid legacy case noun.");
    nouns.add(noun.noun.toLocaleLowerCase("cs-CZ"));
    const pool = [...new Set(names.map(name => noun.cases[name].form))];
    for (const name of names) {
      const row = noun.cases[name]; checkSentence(row, pool, [row.form]);
      rows.push({ id: `legacy-${Array.from(noun.noun).map(character => character.codePointAt(0).toString(16)).join("-")}-${name.toLowerCase()}`,
        difficulty: noun.difficulty });
    }
  }
  for (const context of document.contexts) {
    const paradigm = paradigms.get(context.paradigmId);
    if (!paradigm || !names.includes(context.case) || !Array.isArray(context.acceptedForms)) throw new Error("Invalid authored case context.");
    checkSentence(context, paradigm.forms, [context.form, ...context.acceptedForms]);
    rows.push(context);
  }
  const index = indexRows(rows);
  return { banks: { default: index }, playable: level => rows.some(row => row.difficulty === level) };
}

function nucleusCatalog(document) {
  if (![1, 2].includes(document.schemaVersion) || document.gameId !== "naturalization-nucleus"
    || !Array.isArray(document.challenges)) throw new Error("Unsupported domino catalog.");
  const settings = document.roundSettings;
  if (!record(settings) || !Array.isArray(settings.pieceCounts) || settings.pieceCounts.length !== 2
    || !settings.pieceCounts.includes(5) || !settings.pieceCounts.includes(9)
    || !settings.pieceCounts.includes(settings.defaultPieceCount) || !Array.isArray(settings.artwork)
    || !settings.artwork.length || settings.artwork.some(path => typeof path !== "string"
      || !/^\/assets\/ships\/[A-Za-z0-9%._()-]+\.png$/u.test(path))) throw new Error("Invalid domino board settings.");
  const word = document.schemaVersion === 2, targets = new Set();
  for (const row of document.challenges) {
    const target = word ? row.target : row.hanzi, reading = word ? row.reading : row.pinyin;
    const targetKey = `${row.difficulty === 0 ? "zero:" : ""}${target}`;
    if (!text(target) || !text(reading) || !text(row.translation) || targets.has(targetKey)) throw new Error("Invalid or duplicate domino target.");
    targets.add(targetKey);
    if (word) {
      if (!/^ar\.reading\.[a-z0-9-]+$/u.test(row.id) || !text(row.englishAuditText)
        || !/^[\u0621-\u063a\u0641-\u0652\u0670]+$/u.test(target) || !/[\u064b-\u0652]/u.test(target)
        || !/^[a-zāīūḥṣḍṭẓʿʾ]+(?:-[a-zāīūḥṣḍṭẓʿʾ]+)*$/u.test(reading)) throw new Error("Invalid word-reading domino task.");
    } else if (!/^zh\.hanzi\.[a-z0-9-]+$/u.test(row.id) || !/^[\u3400-\u9fff\uf900-\ufaff]$/u.test(target)
      || !/^[A-Za-z\u00c0-\u024f]+$/u.test(reading) || ![1, 2, 3, 4, 5].includes(row.tone)) throw new Error("Invalid Hanzi-reading domino task.");
    if (!word) {
      const toneMarks = [null, /[āēīōūǖ]/iu, /[áéíóúǘ]/iu, /[ǎěǐǒǔǚ]/iu, /[àèìòùǜ]/iu];
      if (row.tone === 5 ? toneMarks.slice(1).some(mark => mark.test(reading)) : !toneMarks[row.tone].test(reading)) throw new Error("Domino reading disagrees with its tone.");
    }
    const sources = word ? row.sourceItemIds : row.sourceConceptIds;
    if (!Array.isArray(sources) || !sources.length || sources.some(id => !text(id))
      || new Set(sources).size !== sources.length) throw new Error("Domino task has no source identity.");
  }
  const index = indexRows(document.challenges);
  const readingKey = row => `${(row.reading ?? row.pinyin).normalize("NFC").toLowerCase()}:${row.tone ?? "word"}`;
  const required = Math.max(...settings.pieceCounts);
  const playable = level => new Set(document.challenges.filter(row => row.difficulty === level).map(readingKey)).size >= (level === 0 ? 3 : required);
  if ([0, 1, 2, 3].some(level => !playable(level))) throw new Error("Domino pack cannot form its supported boards at every difficulty.");
  return { banks: { default: index }, playable };
}

/** Course-local catalog loader, no embeddings, persistence writes, or selection changes. */
export function createBadgeRecommendation({ course, learning, runtimeHref = globalThis.location?.href,
  fetchImpl = globalThis.fetch } = {}) {
  if (!text(course?.id) || typeof learning?.practiceSummary !== "function" || typeof learning?.contentHistory !== "function") {
    throw new TypeError("A course and readable learning profile are required.");
  }
  const declared = { ...course, gameContent: { ...course.gameContent,
    ...Object.fromEntries(Object.entries(menuIds).map(([game, menu]) => [game, course.gameContent?.[game] || course.gameContent?.[menu]])) } };
  const catalogs = new Map();
  const gameAvailable = gameId => shellPolicy.isGameAvailable(menuIds[gameId] || gameId, course);
  async function load(gameId, resourceName, signal, resourcePath) {
    abortCheck(signal);
    const profile = resourcePath ? { ...declared, gameContent: { ...declared.gameContent,
      [gameId]: { ...declared.gameContent[gameId], [resourceName]: resourcePath } } } : declared;
    const result = await fetchDeclaredCourseGameJson(profile, { gameId, resourceName, runtimeHref,
      fetchImpl: (url, options) => fetchImpl(url, { ...options, signal }) });
    abortCheck(signal);
    if (!record(result.document) && !Array.isArray(result.document)) throw new Error("Catalog is unavailable.");
    if (result.document.courseId !== undefined && result.document.courseId !== course.id) throw new Error("Catalog belongs to another course.");
    return result;
  }
  async function wordCatalog(signal) {
    const { document: manifest, url } = await load("word-world", "wordWorldManifest", signal);
    const child = async file => {
      if (typeof file !== "string" || !/^[a-zA-Z0-9._-]+\.json(?:\?[a-zA-Z0-9._~=&%-]+)?$/u.test(file)) throw new Error("Unsafe Word World child.");
      return (await load("word-world", "badgeContent", signal, `data/games/word-world/${file}`)).document;
    };
    let rows;
    if (manifest.schemaVersion === "caatuu-word-world-runtime-manifest-v1") {
      const pack = await child(manifest.runtimeFile);
      if (pack.schemaVersion !== "caatuu-word-world-runtime-v1") throw new Error("Unsupported Word World runtime.");
      rows = pack.records;
      if (!Array.isArray(rows) || rows.some(row => !text(row.cs) || !text(row.en))) throw new Error("Word World has no playable sentence text.");
    } else if (manifest.schemaVersion === "caatuu-word-world-runtime-manifest-v2") {
      if (typeof manifest.sourceConceptCatalog !== "string"
        || !/^\/language-runtime\/static\/data\/english-concepts\/[a-z0-9-]+\.json(?:\?[a-zA-Z0-9._~=&%-]+)?$/u.test(manifest.sourceConceptCatalog)) throw new Error("Unsafe English concept authority.");
      const response = await fetchImpl(new URL(manifest.sourceConceptCatalog, url).href,
        { cache: "reload", credentials: "same-origin", headers: { Accept: "application/json" }, signal });
      if (!response?.ok) throw new Error("English concepts unavailable.");
      const concepts = await response.json();
      const realizations = await child(manifest.realizationFile);
      rows = joinConceptCatalogs(concepts, realizations).map(row => ({ ...row, id: row.conceptId }));
    } else throw new Error("Unsupported Word World manifest.");
    return { banks: { sentences: indexRows(rows) }, playable: level => rows.some(row => (row.difficulty ?? 1) === level
      && /[\p{L}\p{N}]/u.test(row.cs ?? row.target?.text ?? "") && /[\p{L}\p{N}]/u.test(row.en ?? row.englishText ?? "")) };
  }
  async function buildCatalog(gameId, bankId, signal) {
    if (gameId === "word-world") return wordCatalog(signal);
    const nouns = gameId === "grammar-gravity" && bankId === "nouns";
    const { document } = await load(gameId, nouns ? "grammarGravityNouns" : resourceNames[gameId], signal);
    if (gameId === "verb-nebula") {
      const rows = extractCoreVerbPairs(document, { learnerBaseLanguage: course.sourceLanguage?.locale });
      if (!rows.length) throw new Error("No validated matching pairs.");
      return { banks: { default: indexRows(rows) }, playable: level => rows.filter(row => row.difficulty === level).length >= 2 };
    }
    if (gameId === "conjugation-comet") {
      const pack = validateConjugationCometCatalog(document, { expectedCourseId: course.id,
        expectedTargetLanguageId: course.targetLanguage.id, expectedLearnerBaseLanguageId: course.sourceLanguage.id,
        expectedTargetLocale: course.targetLanguage.locale });
      return { banks: { default: indexRows(pack.verbs), forms: indexRows(pack.verbs.flatMap(verb => verb.forms.map(form =>
        ({ id: `${verb.id}.${form.id}`, difficulty: verb.difficulty, parentId: verb.id }))), row => row.parentId) },
      playable: level => pack.verbs.filter(verb => verb.difficulty === level).some(verb => {
        try { return buildConjugationHelixRound(pack, verb.id, { rng: () => .5 }).subjects.length >= 2; } catch { return false; }
      }) };
    }
    if (nouns) {
      const pack = normalizeNounLandingPack(document, { courseId: course.id, targetLanguage: course.targetLanguage.locale,
        learnerBaseLanguage: course.sourceLanguage.locale });
      return { banks: { nouns: indexRows(pack.items) }, playable: level => {
        try { return createNounLandingSession(pack, { difficulty: level, random: () => .5 }).total > 0; } catch { return false; }
      } };
    }
    if (gameId === "grammar-gravity") {
      const pack = validateGrammarGravityPack(document, { courseId: course.id, targetLanguage: course.targetLanguage.locale,
        learnerBaseLanguage: course.sourceLanguage.locale });
      const rounds = new Map([0, 1, 2, 3].map(level => [level, pack.challenges.some(row => row.difficulty === level)
        ? buildGrammarGravityRounds(pack, level, () => .5) : []]));
      return { banks: { phrases: indexRows([...rounds.values()].flat()) }, playable: level => rounds.get(level).length > 0 };
    }
    if (gameId === "sound-quasar") {
      const pack = validateSoundQuasarCatalog(document, { courseId: course.id, targetLanguageId: course.targetLanguage.id,
        learnerBaseLanguage: course.sourceLanguage.locale });
      return { banks: { words: indexRows(pack.items), sentences: indexRows(pack.sentences) }, playable: (level, bank) => {
        try { return buildSoundQuasarRound(pack, { difficulty: level, mode: bank, choiceCount: 2, random: () => .5 }).choices.length === 2; }
        catch { return false; }
      } };
    }
    if (gameId === "memory-moon") {
      const pack = validateMemoryMoonCatalog(document, { course });
      return { banks: { translations: indexRows(pack.challenges, row => row.familyId) },
        playable: level => pack.challenges.filter(row => row.difficulty === level).length >= 6 };
    }
    if (gameId === "case-cosmos") return caseCatalog(document);
    if (gameId === "naturalization-nucleus") return nucleusCatalog(document);
    throw new Error("Unsupported catalog adapter.");
  }
  async function catalog(gameId, bankId, signal) {
    const key = gameId === "grammar-gravity" && bankId === "nouns" ? "grammar-nouns" : gameId;
    if (catalogs.has(key)) return catalogs.get(key);
    const value = await buildCatalog(gameId, bankId, signal);
    abortCheck(signal);
    catalogs.set(key, value);
    return value;
  }
  async function evaluate({ difficulty = learning.difficulty?.(), stageComplete = false, now = Date.now(), signal,
    policy = BADGE_RECOMMENDATION_POLICY } = {}) {
    abortCheck(signal);
    let generation;
    try { generation = learning.contentGeneration?.(); } catch { generation = null; }
    if (!text(generation) || generation === "unknown") return { ...evaluateBadgeRecommendation({
      courseId: course.id, difficulty, stageComplete: true, partial: true,
      issues: ["content-generation-unavailable"], now, policy
    }), status: "unknown", reasons: ["evidence-or-catalog-incomplete"] };
    if (!stageComplete || difficulty === 3) return evaluateBadgeRecommendation({ courseId: course.id, difficulty, stageComplete, now, policy });
    const initialDifficulty = learning.difficulty?.();
    const summary = learning.practiceSummary({ now });
    if (summary?.courseId !== course.id || !Array.isArray(summary.games)) {
      return evaluateBadgeRecommendation({ courseId: course.id, difficulty, stageComplete, partial: true, issues: ["summary-unavailable"], now, policy });
    }
    const items = [], nextPlayable = [], issues = [], authorities = new Map();
    let partial = summary.status !== "ready";
    for (const game of summary.games) for (const bank of game.banks || []) {
      abortCheck(signal);
      const gameId = canonicalGame(game.gameId), bankId = bank.bankId;
      if (!gameAvailable(gameId)) { partial = true; issues.push("unsupported-game"); continue; }
      try {
        const before = learning.contentHistory(gameId, bankId);
        if (!record(before)) throw new Error("History unavailable.");
        if (!Object.keys(before).length) continue;
        const authority = await catalog(gameId, bankId, signal);
        const key = catalogBank(gameId, bankId), index = authority.banks[key];
        if (!index) throw new Error("Unsupported practice bank.");
        const playable = authority.playable(difficulty + 1, key);
        nextPlayable.push({ gameId, bankId, playable });
        if (playable === null) { partial = true; issues.push("next-task-validation-unavailable"); }
        authorities.set(pathKey(gameId, bankId), index);
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        partial = true; issues.push("catalog-or-history-unavailable");
      }
    }
    abortCheck(signal);
    // Read all learner evidence synchronously after catalog loading. A new
    // mistake during fetch must not leave an earlier correct response eligible.
    const fresh = learning.practiceSummary({ now });
    if (fresh?.courseId !== course.id || !Array.isArray(fresh.games)) {
      partial = true; issues.push("summary-unavailable");
    } else {
      partial ||= fresh.status !== "ready";
      for (const game of fresh.games) for (const bank of game.banks || []) {
        const gameId = canonicalGame(game.gameId), bankId = bank.bankId;
        try {
          const history = learning.contentHistory(gameId, bankId);
          if (!record(history)) throw new Error("History unavailable.");
          if (!Object.keys(history).length) continue;
          if (!gameAvailable(gameId)) { partial = true; issues.push("unsupported-game"); }
          const index = authorities.get(pathKey(gameId, bankId));
          if (!index) { partial = true; issues.push("bank-changed-or-unavailable"); }
          for (const [itemId, entry] of Object.entries(history)) items.push({
            identity: { courseId: course.id, gameId, bankId, itemId }, history: entry, ...index?.get(itemId)
          });
        } catch { partial = true; issues.push("history-unavailable"); }
      }
      if (fresh.totals?.encounteredItems !== items.length) { partial = true; issues.push("history-incomplete"); }
    }
    let currentGeneration;
    try { currentGeneration = learning.contentGeneration?.(); } catch { currentGeneration = null; }
    if (currentGeneration !== generation || learning.difficulty?.() !== initialDifficulty) {
      partial = true; issues.push("profile-changed-during-evaluation");
    }
    return evaluateBadgeRecommendation({ courseId: course.id, difficulty, stageComplete, items, nextPlayable, partial, issues: [...new Set(issues)], now, policy });
  }
  return Object.freeze({ evaluate });
}
