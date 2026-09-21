import { learnerItemState } from "./learner-state.mjs";
import { embedSharedEnglishTexts, normalizeSharedEnglishText, peekSharedEnglishVector,
  sharedEnglishEmbeddingOwner } from "./english-image-search.mjs?v=english-image-search-4";
import { fetchDeclaredCourseGameJson } from "./games/course-game-content.mjs?v=course-game-content-1";
import { extractCoreVerbPairs } from "./games/verb-nebula/verb-nebula-core.mjs?v=verb-nebula-core-14";
import { validateConjugationCometCatalog } from "./games/conjugation-comet/conjugation-comet-core.mjs?v=conjugation-comet-core-2";
import { buildGrammarGravityRounds } from "./games/grammar-gravity/grammar-gravity-core.mjs?v=grammar-gravity-core-7";
import { normalizeNounLandingPack } from "./games/grammar-gravity/noun-landing-core.mjs?v=noun-landing-core-11";
import { validateSoundQuasarCatalog } from "./games/sound-quasar/sound-quasar-core.mjs?v=sound-quasar-8";
import { joinConceptCatalogs } from "./catalog-runtime.mjs";

// Topics, order, and arithmetic are shared by every course. UI labels live in
// the interface catalogs. Probes describe meanings, never a learner's ability.
export const sharedPracticeAxes = Object.freeze([
  ["people", "people", false, "People, relationships, feelings, greetings, help, and personal needs."],
  ["home-school", "home", false, "Home objects, school activities, learning, play, and everyday technology."],
  ["food-shopping", "food", true, "Food and meals, shopping, money and prices, choices, and polite requests."],
  ["places-travel", "journey", false, "Places, directions, movement, journeys, transport, and travel safety."],
  ["actions-abilities", "actions", false, "Actions, abilities, instructions, and what people or things are doing."],
  ["time-plans", "time", true, "Time, daily routines, sequences, schedules, and future plans."],
  ["world-description", "world", false, "Animals, nature, weather, clothing, colors, and descriptive qualities."]
].map(([id, emblem, chartLabelBelow, text]) => Object.freeze({ id, emblem, chartLabelBelow,
  probe: Object.freeze({ locale: "en", revision: "1", text }) })));

const identityKey = identity => JSON.stringify([identity.courseId, identity.gameId, identity.bankId, identity.itemId]);
const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const mappingStatuses = ["identity-unresolved", "english-unavailable", "evidence-unavailable", "pending", "vector-unavailable", "unmatched", "matched"];

function compareTopics(vector, axes) {
  return axes.map(axis => vector && axis.vector?.length === vector.length
    ? vector.reduce((sum, value, index) => sum + value * axis.vector[index], 0) : null);
}

function unitVector(value) {
  if (!value || !Number.isInteger(value.length) || !value.length) return null;
  const vector = Array.from(value);
  if (!vector.every(Number.isFinite)) return null;
  const norm = Math.hypot(...vector);
  return norm > 0 && Number.isFinite(norm) ? vector.map(number => number / norm) : null;
}

function itemEvidence(courseId, item) {
  const identity = item?.identity;
  if (!identity || identity.courseId !== courseId
    || ["courseId", "gameId", "bankId", "itemId"].some(field => typeof identity[field] !== "string" || !identity[field].trim())) {
    throw new TypeError("Every compass item needs its explicit current course/game/bank/item identity.");
  }
  const safeIdentity = Object.fromEntries(["courseId", "gameId", "bankId", "itemId"].map(field => [field, identity[field]]));
  if (!isRecord(item.history)) return { identity: safeIdentity, independent: false, reason: "history-unavailable" };
  const state = learnerItemState({ ...safeIdentity, history: { [identity.itemId]: item.history } });
  return { identity: safeIdentity, independent: state.evidence.independentlyAssessed,
    reason: state.evidenceStatus === "unassessed" ? "no-recorded-evidence" : null };
}

/**
 * Read-only projection of unique task identities. Both radii measure evidence
 * mass, not accuracy, mastery, recall probability, or curriculum completion.
 * A repeated encounter never increases an identity's contribution above one.
 * Missing mapping is explicit; a missing axis is not rendered as a zero score.
 */
export function projectPracticeCompass({ courseId, items = [], axisVectors = {}, partial = false, diagnostics = false } = {}) {
  if (typeof courseId !== "string" || !courseId.trim() || !Array.isArray(items)) throw new TypeError("A course and item list are required.");
  const axes = sharedPracticeAxes.map(axis => ({ id: axis.id, vector: unitVector(own(axisVectors, axis.id)),
    practiceWeight: 0, independentWeight: 0, mappedItems: 0, independentItems: 0 }));
  const counts = { encounteredItems: 0, independentItems: 0, mappedItems: 0, mappedIndependentItems: 0, unmappedItems: 0 };
  const mappingCounts = Object.fromEntries(mappingStatuses.map(status => [status, 0]));
  const seen = new Set(), unmapped = [], records = [];
  let vectorItems = 0;
  for (const item of items) {
    const evidence = itemEvidence(courseId, item);
    const key = identityKey(evidence.identity);
    if (seen.has(key)) continue;
    seen.add(key);
    counts.encounteredItems++;
    counts.independentItems += Number(evidence.independent);
    const vector = unitVector(item.vector);
    const topics = diagnostics ? axes.map(axis => ({ id: axis.id, similarity: null, weight: null })) : null;
    // Facade comparisons are retained only for its immutable model/topics and
    // current authored text. They contain no learner evidence or inferred score.
    const retained = Array.isArray(item.topicSimilarities) && item.topicSimilarities.length === axes.length
      && item.topicSimilarities.every(Number.isFinite) ? item.topicSimilarities : null;
    const similarities = retained || compareTopics(vector, axes);
    const complete = axes.every(axis => axis.vector) && similarities.every(Number.isFinite);
    let reason = evidence.reason || item.unmappedReason || (!vector && !retained ? "vector-unavailable" : null);
    let mapped = false;
    if (!reason) {
      if (!complete) reason = "axis-vectors-unavailable";
      else {
        vectorItems++;
        for (const [index, axis] of axes.entries()) {
          const cosine = similarities[index];
          const kernel = Math.max(0, Math.min(1, (cosine - 0.3) / 0.7)) ** 2;
          if (topics) Object.assign(topics.find(topic => topic.id === axis.id), { similarity: cosine, weight: kernel });
          if (!kernel) continue;
          mapped = true;
          axis.practiceWeight += kernel;
          axis.independentWeight += evidence.independent ? kernel : 0;
          axis.mappedItems++;
          axis.independentItems += Number(evidence.independent);
        }
        if (!mapped) reason = "outside-shared-topics";
      }
    }
    if (mapped) {
      counts.mappedItems++;
      counts.mappedIndependentItems += Number(evidence.independent);
    } else {
      counts.unmappedItems++;
      unmapped.push({ identity: evidence.identity, reason });
    }
    const status = ["item-not-in-catalog", "unsupported-bank", "catalog-unavailable"].includes(reason) ? "identity-unresolved"
        : reason === "english-text-unavailable" ? "english-unavailable"
        : reason === "no-recorded-evidence" || reason === "history-unavailable" ? "evidence-unavailable"
        : !complete ? (["not-attempted", "queued", "cancelled"].includes(item.mappingState) ? "pending" : "vector-unavailable")
        : mapped ? "matched" : "unmatched";
    mappingCounts[status]++;
    if (diagnostics) {
      const ordered = topics.map(topic => topic.similarity).filter(Number.isFinite).sort((a, b) => b - a);
      records.push({ identity: evidence.identity, englishText: item.text ?? null, englishIssue: item.englishIssue ?? null,
        independentEvidence: evidence.independent, status, reason, mappingState: item.mappingState ?? null,
        comparisonComplete: topics.every(topic => Number.isFinite(topic.similarity)), topics, maxSimilarity: ordered[0] ?? null,
        secondSimilarity: ordered[1] ?? null, positiveTopics: topics.filter(topic => topic.weight > 0).length });
    }
  }
  const missingAxes = axes.some(axis => !axis.vector);
  const status = !counts.encounteredItems ? (partial ? "unavailable" : "empty")
    : !vectorItems ? "unavailable" : partial || counts.encounteredItems > vectorItems || missingAxes ? "partial" : "ready";
  return { courseId, status, counts, mappingCounts, unmapped, ...(diagnostics ? { records } : {}), axes: axes.map(({ vector, ...axis }) => ({ ...axis,
    practice: !counts.encounteredItems && !partial ? 0 : vector && vectorItems ? 1 - Math.exp(-axis.practiceWeight / 2) : null,
    independent: !counts.encounteredItems && !partial ? 0 : vector && vectorItems ? 1 - Math.exp(-axis.independentWeight / 2) : null
  })) };
}

const resourceNames = Object.freeze({
  "verb-nebula": "verbNebulaCatalog", "word-world": "wordWorldManifest",
  "conjugation-comet": "conjugationCometCatalog", "grammar-gravity": "grammarGravityCatalog",
  "sound-quasar": "soundQuasarCatalog", "case-cosmos": "caseCosmosCatalog",
  "naturalization-nucleus": "naturalizationNucleusCatalog"
});
const menuIds = Object.freeze({ "verb-nebula": "verb-lab", "word-world": "word-net" });

function requireCourseDocument(document, course) {
  if (!document || typeof document !== "object") throw new Error("Catalog is not an object.");
  if (document.courseId !== undefined && document.courseId !== course.id) throw new Error("Catalog belongs to another course.");
  return document;
}

function englishRows(rows, id = row => row.id, english = row => row.englishAuditText) {
  if (!Array.isArray(rows)) throw new Error("Catalog has no readable item collection.");
  const result = new Map();
  result.rejections = new Map();
  for (const row of rows) {
    const itemId = id(row);
    if (typeof itemId !== "string" || !itemId) throw new Error("Catalog item has no stable identity.");
    if (result.has(itemId)) throw new Error("Catalog repeats an item identity.");
    let text = null;
    const authored = english(row);
    try { text = normalizeSharedEnglishText(authored); } catch (error) {
      result.rejections.set(itemId, { reason: typeof authored === "string" && authored.trim() ? "english-input-rejected" : "english-input-missing",
        authoredText: typeof authored === "string" ? authored : null, detail: error.message });
    }
    result.set(itemId, text);
  }
  return result;
}

function abortError() { const error = new Error("Practice compass mapping was cancelled."); error.name = "AbortError"; return error; }
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
async function abortable(promise, signal) {
  checkAbort(signal);
  if (!signal) return promise;
  let abort;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    abort = () => reject(abortError()); signal.addEventListener("abort", abort, { once: true });
  })]); } finally { signal.removeEventListener("abort", abort); }
}

/**
 * One facade belongs to one immutable course/profile. Only encountered item
 * meanings are embedded; full catalogs are read solely to resolve their IDs.
 * Repeated calls reuse bounded caches and can fill a previous partial result.
 * Caller cancellation does not release the shared model's serialization lock.
 */
export function createPracticeCompass({ course, learning, runtimeHref = globalThis.location?.href,
  fetchImpl = globalThis.fetch, owner = sharedEnglishEmbeddingOwner(), encoder, maxNewTexts = 96 } = {}) {
  if (!course?.id || typeof learning?.practiceSummary !== "function" || typeof learning?.contentHistory !== "function") {
    throw new TypeError("A course and its learning profile are required.");
  }
  if (!Number.isInteger(maxNewTexts) || maxNewTexts < 7 || maxNewTexts > 512) throw new TypeError("maxNewTexts must be 7 to 512.");
  const catalogs = new Map(), vectors = new Map(), comparisons = new Map(), attempts = new Map(), mappingStates = new Map();
  const anchorTexts = new Set(sharedPracticeAxes.map(axis => axis.probe.text));
  // Keep seven similarities per current meaning, not 384 floats per identity.
  // Raw vectors are bounded; completed evidence mass survives their eviction.
  const maximumCachedTexts = 256;
  function retainComparisons() {
    const axes = sharedPracticeAxes.map(axis => ({ vector: unitVector(vectors.get(axis.probe.text)) }));
    if (axes.every(axis => axis.vector)) for (const [text, vector] of vectors) {
      if (anchorTexts.has(text)) continue;
      const values = compareTopics(unitVector(vector), axes);
      if (values.every(Number.isFinite)) { comparisons.set(text, values); vectors.delete(text); }
    }
    while (vectors.size > maximumCachedTexts) vectors.delete([...vectors.keys()].find(text => !anchorTexts.has(text)));
  }
  let tail = Promise.resolve();
  const declaredCourse = { ...course, gameContent: { ...course.gameContent,
    ...Object.fromEntries(Object.entries(menuIds).map(([game, menu]) => [game, course.gameContent?.[game] || course.gameContent?.[menu]])) } };

  async function load(gameId, resourceName, signal, resourcePath) {
    checkAbort(signal);
    const profile = resourcePath ? { ...declaredCourse,
      gameContent: { ...declaredCourse.gameContent, [gameId]: { ...declaredCourse.gameContent?.[gameId], [resourceName]: resourcePath } }
    } : declaredCourse;
    const result = await abortable(fetchDeclaredCourseGameJson(profile, { gameId, resourceName, runtimeHref,
      fetchImpl: (url, options) => fetchImpl(url, { ...options, signal }) }), signal);
    requireCourseDocument(result.document, course);
    return result;
  }

  async function wordWorld(signal) {
    const { document: manifest, url } = await load("word-world", resourceNames["word-world"], signal);
    const child = async file => {
      // Pass the declared manifest child back through the existing confined
      // resource resolver. No target text or arbitrary URL can supply vectors.
      if (typeof file !== "string" || !/^[a-zA-Z0-9._-]+\.json(?:\?[a-zA-Z0-9._~=&%-]+)?$/u.test(file)) {
        throw new Error("Word World manifest child is not a confined JSON file.");
      }
      return (await load("word-world", "compassContent", signal, `data/games/word-world/${file}`)).document;
    };
    if (manifest.schemaVersion === "caatuu-word-world-runtime-manifest-v1") {
      const pack = await child(manifest.runtimeFile);
      if (pack.schemaVersion !== "caatuu-word-world-runtime-v1") throw new Error("Unknown standard Word World schema.");
      return englishRows(pack.records, row => row.id, row => row.en);
    }
    if (manifest.schemaVersion !== "caatuu-word-world-runtime-manifest-v2") throw new Error("Unknown Word World manifest schema.");
    const path = manifest.sourceConceptCatalog;
    if (typeof path !== "string" || !/^\/language-runtime\/static\/data\/english-concepts\/[a-z0-9-]+\.json(?:\?[a-zA-Z0-9._~=&%-]+)?$/u.test(path)) {
      throw new Error("Word World English authority must be a declared shared catalog.");
    }
    const response = await abortable(fetchImpl(new URL(path, url).href,
      { cache: "reload", credentials: "same-origin", headers: { Accept: "application/json" }, signal }), signal);
    if (!response?.ok) throw new Error("Word World English authority is unavailable.");
    const concepts = await abortable(response.json(), signal);
    const realizations = await child(manifest.realizationFile);
    return englishRows(joinConceptCatalogs(concepts, realizations), row => row.conceptId, row => row.englishText);
  }

  async function catalogFor(gameId, bankId, signal) {
    const kind = gameId === "grammar-gravity" && bankId === "nouns" ? "nouns" : gameId;
    if (catalogs.has(kind)) return catalogs.get(kind);
    let result;
    if (gameId === "word-world") result = { sentences: await wordWorld(signal) };
    else {
      const name = kind === "nouns" ? "grammarGravityNouns" : resourceNames[gameId];
      if (!name) throw new Error("No catalog adapter for this game.");
      const { document } = await load(gameId, name, signal);
      if (gameId === "verb-nebula") result = { default: englishRows(extractCoreVerbPairs(document,
        { learnerBaseLanguage: course.sourceLanguage?.locale })) };
      else if (gameId === "conjugation-comet") {
        const pack = validateConjugationCometCatalog(document, { expectedCourseId: course.id,
          expectedTargetLanguageId: course.targetLanguage.id, expectedLearnerBaseLanguageId: course.sourceLanguage.id,
          expectedTargetLocale: course.targetLanguage.locale });
        result = { default: englishRows(pack.verbs), forms: englishRows(pack.verbs.flatMap(verb =>
          verb.forms.map(form => ({ ...form, id: `${verb.id}.${form.id}` })))) };
      } else if (kind === "nouns") result = { nouns: englishRows(normalizeNounLandingPack(document, {
        courseId: course.id, targetLanguage: course.targetLanguage.locale, learnerBaseLanguage: course.sourceLanguage.locale
      }).items, row => row.id, row => row.english) };
      else if (gameId === "grammar-gravity") result = { phrases: englishRows(buildGrammarGravityRounds(document, 3, () => 0.5)) };
      else if (gameId === "sound-quasar") {
        const pack = validateSoundQuasarCatalog(document, { courseId: course.id, targetLanguageId: course.targetLanguage.id,
          learnerBaseLanguage: course.sourceLanguage.locale });
        result = { words: englishRows(pack.items), sentences: englishRows(pack.sentences) };
      } else if (gameId === "case-cosmos") {
        if (document.schemaVersion !== "caatuu-case-cosmos-content-v2") throw new Error("Unsupported case-context schema.");
        // The game retains old noun/case identities alongside authored context
        // IDs. Resolve their authored English without inferring any case skill.
        const legacy = (document.legacyNouns || []).flatMap(noun => Object.entries(noun.cases || {}).map(([name, row]) => ({
          id: `legacy-${Array.from(noun.noun).map(character => character.codePointAt(0).toString(16)).join("-")}-${name.toLowerCase()}`,
          english: row.english
        })));
        result = { default: englishRows([...legacy, ...document.contexts], row => row.id, row => row.english) };
      } else if (gameId === "naturalization-nucleus") {
        if (document.schemaVersion !== 1 || document.gameId !== gameId) throw new Error("Unsupported recognition schema.");
        result = { default: englishRows(document.challenges, row => row.id,
          row => row.englishAuditText ?? (course.sourceLanguage.id === "en" ? row.translation : undefined)) };
      }
    }
    checkAbort(signal);
    catalogs.set(kind, result);
    return result;
  }

  function bankCatalog(gameId, bankId, catalog) {
    if (gameId === "word-world" && ["sentences", "reconstruct-target", "reconstruct-source"].includes(bankId)) return catalog.sentences;
    if (gameId === "grammar-gravity" && /^phrases-(?:sequence|meaning|nouns|forms)$/u.test(bankId)) return catalog.phrases;
    if (gameId === "naturalization-nucleus" && ["default", "recognize-hanzi-pinyin", "recognize-pinyin-hanzi"].includes(bankId)) return catalog.default;
    return own(catalog, bankId);
  }

  async function resolveItems({ signal, onProgress = () => {} } = {}) {
    checkAbort(signal);
    const generation = learning.contentGeneration?.();
    const summary = learning.practiceSummary();
    if (summary?.courseId !== course.id || !Array.isArray(summary.games)) throw new Error("Practice summary belongs to another or unavailable course.");
    const items = [], issues = [];
    let partial = summary.status !== "ready", completed = 0;
    const banks = summary.games.flatMap(game => (game.banks || []).map(bank => ({ gameId: game.gameId, bankId: bank.bankId })));
    for (const { gameId, bankId } of banks) {
      checkAbort(signal);
      let history;
      try { history = learning.contentHistory(gameId, bankId); } catch { partial = true; issues.push("history-unavailable"); continue; }
      if (!isRecord(history)) { partial = true; issues.push("history-unavailable"); continue; }
      let catalog, reason;
      try { catalog = bankCatalog(gameId, bankId, await catalogFor(gameId, bankId, signal));
        if (!catalog) reason = "unsupported-bank";
      } catch (error) { if (error?.name === "AbortError") throw error; reason = "catalog-unavailable"; }
      for (const [itemId, entry] of Object.entries(history)) {
        const text = catalog?.get(itemId);
        items.push({ identity: { courseId: course.id, gameId, bankId, itemId }, history: entry,
          text, englishIssue: catalog?.rejections?.get(itemId),
          unmappedReason: reason || (text ? null : catalog?.has(itemId) ? "english-text-unavailable" : "item-not-in-catalog") });
      }
      onProgress({ phase: "catalogs", completed: ++completed, total: banks.length });
    }
    if (summary.totals?.encounteredItems !== items.length) { partial = true; issues.push("history-incomplete"); }
    return { items, partial, issues, summary, generation };
  }

  async function run({ signal, onProgress = () => {}, diagnostics = false } = {}) {
    const { items, summary, generation, issues, partial: readPartial } = await resolveItems({ signal, onProgress });
    let partial = readPartial, completed = 0;
    const issueDetails = [];
    items.sort((left, right) => String(right.history?.lastSeenAt || "").localeCompare(String(left.history?.lastSeenAt || ""))
      || identityKey(left.identity).localeCompare(identityKey(right.identity)));
    const meanings = items.filter(item => !item.unmappedReason).map(item => item.text);
    const texts = meanings.length ? [...new Set([...sharedPracticeAxes.map(axis => axis.probe.text), ...meanings])] : [];
    const active = new Set(texts);
    for (const map of [vectors, comparisons, attempts, mappingStates]) for (const text of map.keys()) if (!active.has(text)) map.delete(text);
    const available = text => anchorTexts.has(text) ? vectors.has(text) : comparisons.has(text);
    for (const text of texts) if (!available(text) && !vectors.has(text)) {
      const cached = peekSharedEnglishVector(text, { owner, individualInputs: true });
      if (cached) { vectors.set(text, cached); retainComparisons(); }
    }
    retainComparisons();
    const missing = texts.filter(text => !available(text));
    missing.forEach(text => { if (!mappingStates.has(text)) mappingStates.set(text, "not-attempted"); });
    // Failed texts must not monopolize every request's prefix.
    const requested = missing.filter(text => !vectors.has(text)).sort((a, b) => (attempts.get(a) || 0) - (attempts.get(b) || 0)).slice(0, maxNewTexts);
    completed = texts.length - missing.length;
    onProgress({ phase: "embedding", completed, total: texts.length });
    for (let offset = 0; offset < requested.length;) {
      checkAbort(signal);
      // A failing item batch must not prevent the common anchors from loading.
      const isAnchor = anchorTexts.has(requested[offset]);
      const batch = [];
      while (offset < requested.length && batch.length < 24 && anchorTexts.has(requested[offset]) === isAnchor) batch.push(requested[offset++]);
      batch.forEach(text => { mappingStates.set(text, "queued"); attempts.set(text, (attempts.get(text) || 0) + 1); });
      try {
        const values = await abortable(embedSharedEnglishTexts(batch, { owner, encoder, timeoutMs: 5000, individualInputs: true }), signal);
        checkAbort(signal);
        batch.forEach((text, index) => { vectors.set(text, values[index]); mappingStates.set(text, "completed"); });
        retainComparisons();
        completed += batch.length;
        onProgress({ phase: "embedding", completed, total: texts.length });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        batch.forEach(text => mappingStates.set(text, "failed"));
        issueDetails.push({ phase: "embedding", detail: error.message, texts: [...batch] });
        issues.push("embedding-unavailable"); partial = true;
      }
    }
    checkAbort(signal);
    if (learning.contentGeneration?.() !== generation) throw abortError();
    const result = projectPracticeCompass({ courseId: course.id, partial, diagnostics,
      items: items.map(item => ({ ...item, vector: vectors.get(item.text), topicSimilarities: comparisons.get(item.text),
        mappingState: available(item.text) ? "completed" : mappingStates.get(item.text) })),
      axisVectors: Object.fromEntries(sharedPracticeAxes.map(axis => [axis.id, vectors.get(axis.probe.text)])) });
    // A readable summary can know how many identities exist even when a later
    // bank read fails. Retain those counts as unmapped, never fabricate IDs or
    // silently turn unavailable history into an empty learner.
    const unavailableItems = Math.max(0, (summary.totals?.encounteredItems || 0) - result.counts.encounteredItems);
    if (unavailableItems) {
      result.counts.encounteredItems += unavailableItems;
      result.counts.unmappedItems += unavailableItems;
      result.mappingCounts["evidence-unavailable"] += unavailableItems;
      // Only a count is known: never invent identities for unreadable history.
      if (diagnostics) result.unavailableIdentityCount = unavailableItems;
      if (Number.isSafeInteger(summary.totals?.independentItems)) {
        result.counts.independentItems = Math.max(result.counts.independentItems, summary.totals.independentItems);
      }
      result.status = result.counts.mappedItems ? "partial" : "unavailable";
    }
    return { ...result, issues: [...new Set(issues)], ...(diagnostics ? { issueDetails } : {}), pendingTexts: texts.filter(text => !available(text)).length };
  }

  return Object.freeze({ resolve: resolveItems, project(options) {
    const result = tail.then(() => run(options));
    tail = result.catch(() => {});
    return result;
  } });
}
