import assert from "node:assert/strict";
import test from "node:test";
import { REPORTING_POLICY, REPORTING_POLICY_HEADER, DICTIONARY_OUTBOX_KEY, SENTENCE_OUTBOX_KEY,
  buildSentenceFeedbackReport, buildDictionaryGapReport, clearAuthorizedOutbox,
  reportingStorageKeys, resolveReportingConfiguration, installPagesReporting } from "../templates/pages-reporting.mjs";
import { FeedbackOutbox } from "../../../language-runtime/static/source/feedback-outbox.mjs";
import { createBrowserHarness } from "../../../language-runtime/tests/helpers/fake-browser.mjs";
import { REPORTING_COURSE_CATALOG } from "../../../reporting-worker/src/course-catalog.mjs";
import { validateSentenceReportV2, validateDictionaryGapV2 } from "../../../reporting-worker/src/contracts-v2.mjs";

const clientReportId = "8a3ab972-c925-4d31-a9b8-0e339d32c88a";
const payload = { kind: "word_world_sentence_feedback", title: "discard", message: "discard", device: { discard: true },
  feedback: { clientReportId, reportedAt: "discard", sentence: "q\u0301 العربية עברית čeština",
    translation: "This is a sentence.", reason: "wrong_translation", comment: "First line.\r\nSecond line.",
    targetWord: "discard", entryId: "fixture-1", contentMode: "standard", corpusVersion: "fixture-v1",
    recentSentences: ["discard"], sentenceModelKey: "discard" } };
const asCourse = declaration => ({ id: declaration.courseId, sourceLanguage: { locale: declaration.sourceLanguage },
  targetLanguage: { locale: declaration.targetLanguage } });
const dictionaryDeclaration = REPORTING_COURSE_CATALOG.courses.find(course => course.dictionary);
const defaultCourse = asCourse(dictionaryDeclaration);
const dictionaryGap = (word = "Příklad") => ({ ...dictionaryDeclaration.dictionary, targetWord: word,
  normalizedWord: word.toLocaleLowerCase(dictionaryDeclaration.targetLanguage), lookupOutcome: "no_results", lookupReturned: 0 });

function memoryStorage(entries = []) {
  const values = new Map(entries), fail = {};
  const check = kind => { if (fail[kind]) throw new Error("Storage " + kind + " blocked."); };
  return { values, fail, get length() { check("length"); return values.size; },
    key(index) { check("key"); return [...values.keys()][index] ?? null; },
    getItem(key) { check("get"); return values.get(key) ?? null; },
    setItem(key, value) { check("set"); values.set(key, String(value)); },
    removeItem(key) { check("remove"); values.delete(key); } };
}
async function harness({ course = defaultCourse, configuration = REPORTING_COURSE_CATALOG, storage = memoryStorage(),
  maintenance = {}, fetchImpl, origin = "https://caatuu.waajacu.com" } = {}) {
  const browser = createBrowserHarness({ course, location: { origin }, runtime: { maintenance } });
  const { window, document } = browser;
  window.CaatuuRuntime = Object.freeze({ ...window.CaatuuRuntime, maintenance: Object.freeze(maintenance) });
  window.localStorage = storage;
  window.CaatuuI18n = { t: key => key };
  const timers = new Map(); let timerId = 0;
  window.setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
  window.clearTimeout = id => timers.delete(id);
  document.createTextNode = text => { const node = document.createElement("span"); node.textContent = text; return node; };
  const area = document.createElement("section"); area.className = "word-net-feedback"; document.body.append(area);
  const form = document.createElement("form"); form.id = "wordNetFeedbackForm"; area.append(form);
  const actions = document.createElement("div"); actions.className = "word-net-feedback-actions"; form.append(actions);
  const submit = document.createElement("button"); submit.id = "wordNetFeedbackSubmit"; actions.append(submit);
  const status = document.createElement("p"); status.id = "wordNetFeedbackStatus"; form.append(status);
  const requests = [];
  const result = await installPagesReporting({ windowObject: window, documentObject: document, configuration,
    importOutbox: async () => ({ FeedbackOutbox }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options, payload: JSON.parse(options.body) });
      return fetchImpl ? fetchImpl(url, options) : { ok: true, json: async () => ({ ok: true, stored: true }) };
    } });
  return { ...browser, result, storage, timers, requests, originalMaintenance: maintenance,
    maintenance: window.CaatuuRuntime.maintenance, consent: document.getElementById("wordNetFeedbackConsent") };
}

test("all declared course tuples and Unicode reports agree with Worker v2 and discard diagnostic envelopes", () => {
  for (const declaration of REPORTING_COURSE_CATALOG.courses) {
    const course = asCourse(declaration);
    const report = buildSentenceFeedbackReport(payload, { course });
    assert.deepEqual(validateSentenceReportV2(report), report);
    assert.equal(report.courseId, course.id);
    assert.equal(report.targetLanguage, course.targetLanguage.locale);
    assert.equal(report.comment, "First line. Second line.");
    assert.equal(report.sentence, payload.feedback.sentence.normalize("NFC"));
    for (const key of ["title", "device", "reportedAt", "targetWord", "sentenceModelKey", "recentSentences"]) assert.equal(key in report, false);
    const legacyReason = buildSentenceFeedbackReport({ ...payload, feedback: { ...payload.feedback, reason: "unnatural_czech" } }, { course });
    assert.equal(legacyReason.reason, "unnatural_target_language");
    assert.deepEqual(validateSentenceReportV2(legacyReason), legacyReason);
  }
});

test("sentence bounds count Unicode code points and reject unsafe or unsupported values", () => {
  const make = patch => buildSentenceFeedbackReport({ ...payload, ...patch,
    feedback: { ...payload.feedback, ...patch.feedback } }, { course: defaultCourse });
  const edge = make({ feedback: { sentence: "😀".repeat(360), translation: "", comment: "q\u0301" } });
  assert.deepEqual(validateSentenceReportV2(edge), edge);
  for (const patch of [{ kind: "setup_attention" }, { feedback: { sentence: "😀".repeat(361) } },
    { feedback: { sentence: "bad\u0000text" } }, { feedback: { comment: "x".repeat(401) } },
    { feedback: { reason: "arbitrary" } }, { feedback: { contentMode: "unknown" } }]) assert.equal(make(patch), null);
  assert.equal(buildSentenceFeedbackReport(payload), null);
  const multiline = make({ feedback: { sentence: "one\ttwo\nthree" } });
  assert.equal(multiline.sentence, "one two three");
  assert.deepEqual(validateSentenceReportV2(multiline), multiline);
});

test("configuration fails closed on mismatched, missing and duplicate course tuples", async () => {
  assert.equal(resolveReportingConfiguration({ ...defaultCourse, targetLanguage: { locale: "ar" } }, REPORTING_COURSE_CATALOG), null);
  assert.equal(resolveReportingConfiguration({ ...defaultCourse, id: "unknown" }, REPORTING_COURSE_CATALOG), null);
  assert.equal(resolveReportingConfiguration(defaultCourse, { schemaVersion: 2, courses: [dictionaryDeclaration, dictionaryDeclaration] }), null);
  const browser = await harness({ configuration: { schemaVersion: 2, courses: [] } });
  assert.equal(browser.result.installed, false);
  assert.equal(browser.window.CaatuuRuntime.maintenance, browser.originalMaintenance);
});

test("actual FeedbackOutbox works with frozen maintenance and requires the per-report checkbox", async () => {
  const browser = await harness();
  assert.equal(browser.result.installed, true);
  assert.ok(Object.isFrozen(browser.originalMaintenance));
  assert.notEqual(browser.maintenance, browser.originalMaintenance);
  assert.equal(browser.consent.checked, false);
  assert.equal((await browser.maintenance.enqueueReport(payload)).consentRequired, true);
  assert.equal(browser.storage.values.size, 0);
  assert.equal(browser.requests.length, 0);
  browser.consent.checked = true;
  const queued = await browser.maintenance.enqueueReport(payload);
  assert.equal(queued.queued, true);
  assert.equal(queued.authorized, true);
  const flushed = await browser.maintenance.flushReports();
  assert.deepEqual(flushed.sent, [clientReportId]);
  assert.equal(browser.requests.length, 1);
  const request = browser.requests[0];
  assert.equal(request.url, "/api/v2/sentence-reports");
  assert.deepEqual(validateSentenceReportV2(request.payload), request.payload);
  assert.equal(request.options.headers[REPORTING_POLICY_HEADER], REPORTING_POLICY);
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.referrerPolicy, "no-referrer");
  assert.equal(request.options.cache, "no-store");
});

test("course queues are isolated even when the same report ID and browser storage are reused", async () => {
  const storage = memoryStorage();
  const [first, second] = REPORTING_COURSE_CATALOG.courses;
  const a = await harness({ course: asCourse(first), storage });
  const b = await harness({ course: asCourse(second), storage });
  a.consent.checked = b.consent.checked = true;
  await a.maintenance.enqueueReport(payload);
  await b.maintenance.enqueueReport(payload);
  assert.notEqual(reportingStorageKeys(first.courseId).sentence, reportingStorageKeys(second.courseId).sentence);
  assert.equal([...storage.values.keys()].filter(key => key.includes(".item.")).length, 2);
  await a.maintenance.flushReports();
  assert.equal(a.requests[0].payload.courseId, first.courseId);
  assert.equal(b.requests.length, 0);
  await b.maintenance.flushReports();
  assert.equal(b.requests[0].payload.courseId, second.courseId);
});

test("legacy queues are never read or uploaded and unchecked consent cannot enqueue", async () => {
  const oldItem = { id: clientReportId, payload: buildSentenceFeedbackReport(payload, { course: defaultCourse }) };
  const legacy = ["caatuu.feedbackOutbox.v1", "caatuu.sentenceFeedbackAuthorizedOutbox.v2",
    SENTENCE_OUTBOX_KEY, "caatuu.dictionaryGapOutbox.v1", DICTIONARY_OUTBOX_KEY];
  const storage = memoryStorage(legacy.flatMap(key => [[key, JSON.stringify([oldItem])], [key + ".item.old", JSON.stringify(oldItem)]]));
  const browser = await harness({ storage });
  await browser.maintenance.flushReports();
  await browser.maintenance.setDictionaryGapSharing(true);
  await browser.maintenance.flushDictionaryGaps();
  assert.equal(browser.requests.length, 0);
  assert.equal((await browser.maintenance.enqueueReport(payload)).consentRequired, true);
  for (const key of legacy) assert.ok(storage.values.has(key));
});

test("dictionary payloads bind declared providers and normalize identically to Worker v2", () => {
  const configuration = resolveReportingConfiguration(defaultCourse, REPORTING_COURSE_CATALOG);
  const report = buildDictionaryGapReport(dictionaryGap(), { course: defaultCourse, configuration });
  assert.deepEqual(validateDictionaryGapV2(report), report);
  for (const patch of [{ dictionaryKey: "other" }, { dictionaryDirection: "es-en" }, { normalizedWord: "OTHER" },
    { lookupReturned: 1 }, { targetWord: "bad\u0000word" }]) {
    assert.equal(buildDictionaryGapReport({ ...dictionaryGap(), ...patch }, { course: defaultCourse, configuration }), null);
  }
});

test("dictionary consent is isolated by course and independent of sentence consent", async () => {
  const alias = { ...dictionaryDeclaration, courseId: "dictionary-fixture" };
  const configuration = { schemaVersion: 2, courses: [dictionaryDeclaration, alias] }, storage = memoryStorage();
  const a = await harness({ storage, configuration }), b = await harness({ storage, configuration, course: asCourse(alias) });
  a.consent.checked = true;
  assert.equal((await a.maintenance.enqueueDictionaryGap(dictionaryGap())).consentRequired, true);
  await a.maintenance.setDictionaryGapSharing(true);
  assert.equal(a.maintenance.dictionaryGapSharing().enabled, true);
  assert.equal(b.maintenance.dictionaryGapSharing().enabled, false);
  assert.equal((await b.maintenance.enqueueDictionaryGap(dictionaryGap())).consentRequired, true);
  assert.equal((await a.maintenance.enqueueDictionaryGap(dictionaryGap())).authorized, true);
  await a.maintenance.flushDictionaryGaps();
  assert.equal(a.requests.length, 1);
  assert.equal(a.requests[0].url, "/api/v2/dictionary-gaps");
  assert.deepEqual(validateDictionaryGapV2(a.requests[0].payload, configuration), a.requests[0].payload);
  assert.equal((await b.maintenance.enqueueReport(payload)).consentRequired, true);
});

test("revocation removes only the selected course's authorized dictionary rows", async () => {
  const browser = await harness(), keys = reportingStorageKeys(defaultCourse.id);
  browser.consent.checked = true;
  await browser.maintenance.enqueueReport(payload);
  await browser.maintenance.setDictionaryGapSharing(true);
  await browser.maintenance.enqueueDictionaryGap(dictionaryGap());
  browser.storage.setItem("caatuu.dictionaryGapOutbox.v1.item.legacy", "retained");
  const revoked = await browser.maintenance.setDictionaryGapSharing(false);
  assert.equal(revoked.enabled, false);
  assert.equal(revoked.storageError, false);
  assert.equal(browser.storage.getItem(keys.consent), null);
  assert.equal([...browser.storage.values.keys()].some(key => key.startsWith(keys.dictionary + ".item.")), false);
  assert.equal([...browser.storage.values.keys()].some(key => key.startsWith(keys.sentence + ".item.")), true);
  assert.equal(browser.storage.getItem("caatuu.dictionaryGapOutbox.v1.item.legacy"), "retained");
  assert.equal(clearAuthorizedOutbox(browser.storage, keys.dictionary), 0);
  await browser.maintenance.flushDictionaryGaps();
  assert.equal(browser.requests.length, 0);
});

for (const failure of ["remove", "key", "length"]) test("revocation remains effective and exposes failed storage " + failure, async () => {
  const browser = await harness();
  await browser.maintenance.setDictionaryGapSharing(true);
  await browser.maintenance.enqueueDictionaryGap(dictionaryGap("Starý"));
  browser.storage.fail[failure] = true;
  const revoked = await browser.maintenance.setDictionaryGapSharing(false);
  assert.equal(revoked.enabled, false);
  assert.equal(revoked.storageError, true);
  assert.equal(revoked.messageKey, "reporting.dictionary.storageerror");
  assert.equal(browser.maintenance.dictionaryGapSharing().enabled, false);
  await browser.maintenance.flushDictionaryGaps();
  assert.equal(browser.requests.length, 0);
  browser.storage.fail[failure] = false;
  await browser.maintenance.setDictionaryGapSharing(true);
  const queued = await browser.maintenance.enqueueDictionaryGap(dictionaryGap("Nový"));
  assert.equal(queued.persisted, false, "uncertain cleanup requires a fresh session-only queue");
  await browser.maintenance.flushDictionaryGaps();
  assert.deepEqual(browser.requests.map(request => request.payload.targetWord), ["Nový"]);
});

test("revocation during delivery retires the rest of an actual multi-item outbox", async () => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const browser = await harness({ fetchImpl: async () => { started(); await new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => ({ ok: true, stored: true }) }; } });
  await browser.maintenance.setDictionaryGapSharing(true);
  await browser.maintenance.enqueueDictionaryGap(dictionaryGap("První"));
  await browser.maintenance.enqueueDictionaryGap(dictionaryGap("Druhý"));
  const flushing = browser.maintenance.flushDictionaryGaps();
  await ready;
  await browser.maintenance.setDictionaryGapSharing(false);
  release();
  await flushing;
  assert.equal(browser.requests.length, 1);
  await browser.maintenance.setDictionaryGapSharing(true);
  await browser.maintenance.flushDictionaryGaps();
  assert.equal(browser.requests.length, 1, "revoked remaining reports must not reappear after re-enable");
});

test("revocation storage errors keep the disclosure dialog open with localized guidance", async () => {
  const browser = await harness();
  await browser.maintenance.setDictionaryGapSharing(true);
  browser.storage.fail.remove = true;
  const dialog = browser.document.getElementById("wordNetDictionarySharingDialog");
  dialog.setAttribute("open", "");
  browser.document.getElementById("wordNetDictionarySharingChange").click();
  for (let attempt = 0; attempt < 8; attempt++) await Promise.resolve();
  assert.equal(dialog.hasAttribute("open"), true);
  assert.equal(browser.document.getElementById("wordNetDictionarySharingStatus").textContent, "reporting.dictionary.storageerror");
});

test("authorized queues stay offline away from the declared public origin", async () => {
  const browser = await harness({ origin: "https://unrelated.test" });
  browser.consent.checked = true;
  await browser.maintenance.enqueueReport(payload);
  assert.equal((await browser.maintenance.flushReports()).paused, true);
  assert.equal(browser.requests.length, 0);
});

test("unsupported diagnostics and unconsented dictionaries never invoke legacy maintenance senders", async () => {
  const called = [];
  const maintenance = Object.fromEntries(["enqueueReport", "enqueueDictionaryGap", "flushDictionaryGaps"]
    .map(name => [name, async () => { called.push(name); return { ok: true }; }]));
  const browser = await harness({ maintenance });
  assert.equal((await browser.maintenance.enqueueReport({ kind: "setup_attention", message: "diagnostic" })).disabled, true);
  assert.equal((await browser.maintenance.enqueueDictionaryGap(dictionaryGap())).consentRequired, true);
  assert.equal((await browser.maintenance.flushDictionaryGaps()).disabled, true);
  await browser.maintenance.setDictionaryGapSharing(true);
  await browser.maintenance.setDictionaryGapSharing(false);
  await browser.maintenance.flushDictionaryGaps();
  const noDictionary = REPORTING_COURSE_CATALOG.courses.find(course => !course.dictionary);
  const other = await harness({ course: asCourse(noDictionary), maintenance });
  assert.equal((await other.maintenance.enqueueDictionaryGap(dictionaryGap())).unsupported, true);
  assert.deepEqual(called, []);
});
