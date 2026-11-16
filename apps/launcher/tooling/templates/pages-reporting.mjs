export const REPORTING_POLICY = "2026-11-11.v2";
export const REPORTING_POLICY_HEADER = "X-Caatuu-Reporting-Policy";
export const SENTENCE_REPORT_SCHEMA = "caatuu.sentence-feedback-report.v2";
export const SENTENCE_REPORT_SCHEMA_V3 = "caatuu.sentence-feedback-report.v3";
export const DICTIONARY_REPORT_SCHEMA = "caatuu.dictionary-gap-report.v2";
export const SENTENCE_OUTBOX_KEY = "caatuu.sentenceFeedbackAuthorizedOutbox.v3";
export const DICTIONARY_OUTBOX_KEY = "caatuu.dictionaryGapAuthorizedOutbox.v3";
export const DICTIONARY_CONSENT_KEY = "caatuu.reportingConsent.v2";

const canonicalOrigin = "https://caatuu.waajacu.com";
const sentencePath = "/api/v2/sentence-reports";
const dictionaryPath = "/api/v2/dictionary-gaps";
const sentenceReasons = new Set(["nonsense_or_incorrect", "unnatural_target_language", "wrong_translation", "repeated_too_soon", "other"]);
const contentModes = new Set(["", "standard", "generative", "authored"]);

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) return "";
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
function compact(value, limit, { required = false } = {}) {
  const normalized = String(value ?? "").normalize("NFC");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(normalized)) return null;
  const text = normalized.replace(/\s+/gu, " ").trim();
  return ((required && !text) || [...text].length > limit) ? null : text;
}
function validUuid(value) {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(text) ? text.toLowerCase() : "";
}
function courseIdentity(course) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(course?.id || "")) return null;
  try {
    const sourceLanguage = Intl.getCanonicalLocales(course.sourceLanguage?.locale)[0];
    const targetLanguage = Intl.getCanonicalLocales(course.targetLanguage?.locale)[0];
    if (!sourceLanguage || !targetLanguage) return null;
    return { courseId: course.id, sourceLanguage, targetLanguage };
  } catch { return null; }
}
export function reportingStorageKeys(courseId) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(courseId || "")) throw new Error("Invalid reporting course identity.");
  return Object.freeze({
    sentence: SENTENCE_OUTBOX_KEY + "." + courseId,
    dictionary: DICTIONARY_OUTBOX_KEY + "." + courseId,
    consent: DICTIONARY_CONSENT_KEY + "." + courseId
  });
}
export function resolveReportingConfiguration(course, catalog) {
  const identity = courseIdentity(course);
  if (!identity || catalog?.schemaVersion !== 2 || !Array.isArray(catalog.courses)) return null;
  const matches = catalog.courses.filter(item => item.courseId === identity.courseId);
  if (matches.length !== 1) return null;
  const declaration = matches[0];
  if (declaration.sourceLanguage !== identity.sourceLanguage || declaration.targetLanguage !== identity.targetLanguage
    || declaration.sentenceReports !== true) return null;
  return { ...identity, sentenceReports: true, dictionary: declaration.dictionary ?? null };
}
export function buildSentenceFeedbackReport(payload, { course, id = "", idFactory = createId } = {}) {
  const identity = courseIdentity(course);
  if (!identity || payload?.kind !== "word_world_sentence_feedback") return null;
  const feedback = payload.feedback;
  if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)) return null;
  const sentence = compact(feedback.sentence, 360, { required: true });
  const translation = compact(feedback.translation, 360);
  const comment = compact(feedback.comment, 400);
  const entryId = compact(feedback.entryId, 120);
  const corpusVersion = compact(feedback.corpusVersion, 80);
  const contentMode = compact(feedback.contentMode, 32);
  const clientReportId = validUuid(feedback.clientReportId || id) || validUuid(idFactory());
  const reason = feedback.reason === "unnatural_czech" ? "unnatural_target_language" : feedback.reason;
  if (!sentence || translation === null || comment === null || entryId === null || corpusVersion === null
    || !contentModes.has(contentMode) || !clientReportId || !sentenceReasons.has(reason)) return null;
  const report = { schema: SENTENCE_REPORT_SCHEMA, ...identity, clientReportId,
    sentence, translation, reason, comment, entryId, contentMode, corpusVersion };
  if (!["translation", "content", "play"].includes(feedback.flagTarget)) return report;
  const flagTarget = feedback.flagTarget;
  return { ...report, schema: SENTENCE_REPORT_SCHEMA_V3,
    semanticBankId: compact(feedback.semanticBankId, 80) || "",
    contentId: compact(feedback.contentId || feedback.entryId, 160) || "",
    flagTarget,
    englishAtFlag: compact(feedback.englishAtFlag || translation, 360) || "",
    translationAtFlag: compact(feedback.translationAtFlag || sentence, 360) || "" };
}
export function buildDictionaryGapReport(value, { course, configuration } = {}) {
  const identity = courseIdentity(course), provider = configuration?.dictionary;
  const source = value?.kind === "dictionary_gap_feedback" ? value.feedback : value;
  if (!identity || !provider || !source) return null;
  const targetWord = compact(source.targetWord, 120, { required: true });
  const normalizedWord = compact(source.normalizedWord || targetWord, 120, { required: true });
  const lookupReturned = Number(source.lookupReturned);
  if (!targetWord || !normalizedWord
    || targetWord.toLocaleLowerCase(identity.targetLanguage).normalize("NFC") !== normalizedWord
    || source.dictionaryKey !== provider.dictionaryKey || source.dictionaryDirection !== provider.dictionaryDirection
    || !["no_results", "no_exact_usable_entry"].includes(source.lookupOutcome)
    || !Number.isInteger(lookupReturned) || lookupReturned < 0 || lookupReturned > 60
    || (source.lookupOutcome === "no_results" && lookupReturned !== 0)
    || (source.lookupOutcome === "no_exact_usable_entry" && lookupReturned < 1)) return null;
  return { schema: DICTIONARY_REPORT_SCHEMA, ...identity, providerId: provider.providerId,
    targetWord, normalizedWord, dictionaryKey: provider.dictionaryKey,
    dictionaryDirection: provider.dictionaryDirection, lookupOutcome: source.lookupOutcome, lookupReturned };
}
function clearAuthorizedOutboxResult(storage, storageKey) {
  if (!storage || typeof storage.key !== "function" || typeof storage.removeItem !== "function"
      || typeof storage.getItem !== "function") return { cleared: 0, complete: false };
  const prefix = storageKey + ".item.", keys = new Set();
  let length = 0, complete = true, cleared = 0;
  try { length = Number(storage.length || 0); } catch { complete = false; }
  for (let index = 0; index < length; index++) {
    try {
      const key = storage.key(index);
      if (key === storageKey || key?.startsWith(prefix)) keys.add(key);
    } catch { complete = false; }
  }
  for (const key of keys) {
    try {
      storage.removeItem(key);
      if (storage.getItem(key) === null) cleared++; else complete = false;
    } catch { complete = false; }
  }
  return { cleared, complete };
}
export function clearAuthorizedOutbox(storage, storageKey) {
  return clearAuthorizedOutboxResult(storage, storageKey).cleared;
}

function safeStorage(windowObject) {
  try { return windowObject.localStorage; } catch { return null; }
}

function disclosureUi(documentObject, t, sharingEnabled, setSharingEnabled, dictionaryEnabled) {
  const form = documentObject.getElementById("wordNetFeedbackForm");
  const actions = form?.querySelector(".word-net-feedback-actions");
  const submit = documentObject.getElementById("wordNetFeedbackSubmit");
  if (form && actions && !documentObject.getElementById("wordNetFeedbackConsent")) {
    const explanation = documentObject.createElement("p");
    explanation.className = "word-net-feedback-disclosure";
    explanation.textContent = t("reporting.sentence.disclosure");
    const label = documentObject.createElement("label");
    label.className = "word-net-feedback-consent";
    const checkbox = documentObject.createElement("input");
    checkbox.type = "checkbox"; checkbox.id = "wordNetFeedbackConsent"; checkbox.required = true;
    label.append(checkbox, documentObject.createTextNode(" " + t("reporting.sentence.consent")));
    actions.before(explanation, label);
    const sync = () => { if (submit) submit.disabled = !checkbox.checked; };
    checkbox.addEventListener("change", sync);
    form.addEventListener("reset", () => queueMicrotask(sync));
    form.addEventListener("submit", event => {
      if (checkbox.checked) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const status = documentObject.getElementById("wordNetFeedbackStatus");
      if (status) status.textContent = t("reporting.sentence.confirm");
    }, true);
    if (submit) submit.textContent = t("reporting.sentence.send");
    sync();
  }
  const area = documentObject.querySelector(".word-net-feedback");
  if (!dictionaryEnabled || !area || documentObject.getElementById("wordNetDictionarySharingToggle")) return;
  const toggle = documentObject.createElement("button");
  toggle.className = "word-net-report-toggle"; toggle.id = "wordNetDictionarySharingToggle"; toggle.type = "button";
  const dialog = documentObject.createElement("dialog");
  dialog.className = "word-net-feedback-dialog"; dialog.id = "wordNetDictionarySharingDialog";
  dialog.setAttribute("aria-labelledby", "wordNetDictionarySharingTitle");
  const panel = documentObject.createElement("div"); panel.className = "word-net-feedback-form";
  const title = documentObject.createElement("strong"); title.id = "wordNetDictionarySharingTitle";
  title.textContent = t("reporting.dictionary.title");
  const explanation = documentObject.createElement("p"); explanation.textContent = t("reporting.dictionary.disclosure");
  const buttons = documentObject.createElement("div"); buttons.className = "word-net-feedback-actions";
  const change = documentObject.createElement("button"); change.type = "button"; change.id = "wordNetDictionarySharingChange";
  const cancel = documentObject.createElement("button"); cancel.type = "button"; cancel.textContent = t("reporting.cancel");
  const status = documentObject.createElement("p"); status.id = "wordNetDictionarySharingStatus";
  status.setAttribute("role", "status");
  buttons.append(change, cancel); panel.append(title, explanation, status, buttons); dialog.append(panel); area.append(toggle, dialog);
  const sync = () => {
    const enabled = sharingEnabled();
    toggle.textContent = t(enabled ? "reporting.dictionary.on" : "reporting.dictionary.off");
    toggle.setAttribute("aria-pressed", String(enabled));
    change.textContent = t(enabled ? "reporting.dictionary.disable" : "reporting.dictionary.enable");
  };
  toggle.addEventListener("click", () => { sync(); if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", ""); });
  cancel.addEventListener("click", () => dialog.close?.());
  change.addEventListener("click", async () => {
    change.disabled = true;
    try {
      const result = await setSharingEnabled(!sharingEnabled());
      sync();
      status.textContent = result.storageError ? t("reporting.dictionary.storageerror") : "";
      if (!result.storageError) dialog.close?.();
    }
    finally { change.disabled = false; }
  });
  sync();
}

export async function installPagesReporting({
  windowObject = globalThis.window, documentObject = globalThis.document, fetchImpl = globalThis.fetch,
  configuration, importOutbox = () => import("./feedback-outbox.mjs?v=feedback-outbox-1")
} = {}) {
  const course = windowObject?.CaatuuCourse;
  const declared = resolveReportingConfiguration(course, configuration);
  const runtime = windowObject?.CaatuuRuntime;
  if (!declared || !runtime?.maintenance || !documentObject) return { installed: false };
  if (runtime.maintenance.pagesReportingPolicy === REPORTING_POLICY && runtime.maintenance.pagesReportingCourseId === course.id) {
    return { installed: true, reused: true };
  }
  const { FeedbackOutbox } = await importOutbox();
  const storage = safeStorage(windowObject), keys = reportingStorageKeys(course.id);
  const original = runtime.maintenance;
  const maintenance = { ...original };
  const disabledDelivery = () => ({ queued: false, persisted: false, pending: 0,
    disabled: true, automaticDelivery: false, localOnly: true });
  let sentenceOutbox = null, dictionaryOutbox = null, sentenceTimer = null, dictionaryTimer = null, sharingForSession = null;
  let dictionaryPersistenceBlocked = false;
  const canonical = () => windowObject.location?.origin === canonicalOrigin;
  const visible = () => documentObject.visibilityState !== "hidden";
  const online = () => canonical() && windowObject.navigator?.onLine !== false;
  const sharingEnabled = () => {
    if (!declared.dictionary) return false;
    if (sharingForSession !== null) return sharingForSession;
    try { return storage?.getItem(keys.consent) === REPORTING_POLICY; } catch { return false; }
  };
  const send = async (endpoint, payload) => {
    if (!canonical()) throw new Error("Reporting is available only on the public Caatuu origin.");
    if (endpoint === dictionaryPath && !sharingEnabled()) throw new Error("Dictionary sharing was revoked.");
    const response = await fetchImpl(endpoint, {
      method: "POST", headers: { "content-type": "application/json", [REPORTING_POLICY_HEADER]: REPORTING_POLICY },
      body: JSON.stringify(payload), cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok !== true || result?.stored !== true) throw new Error("The report could not be stored.");
    return { ok: true };
  };
  const getOutbox = dictionary => {
    let outbox = dictionary ? dictionaryOutbox : sentenceOutbox;
    if (!outbox) {
      outbox = new FeedbackOutbox({ storage: dictionary && dictionaryPersistenceBlocked ? null : storage,
        storageKey: dictionary ? keys.dictionary : keys.sentence,
        send: payload => send(dictionary ? dictionaryPath : sentencePath, payload),
        online: () => online() && (!dictionary || sharingEnabled()), visible,
        saveData: () => false, maxItems: dictionary ? 128 : 64 });
      if (dictionary) dictionaryOutbox = outbox; else sentenceOutbox = outbox;
    }
    return outbox;
  };
  const schedule = (dictionary, delay = 0) => {
    const existing = dictionary ? dictionaryTimer : sentenceTimer;
    if (existing !== null) windowObject.clearTimeout(existing);
    const timer = windowObject.setTimeout(async () => {
      if (dictionary) dictionaryTimer = null; else sentenceTimer = null;
      const outbox = getOutbox(dictionary), result = await outbox.flush({ maxItems: dictionary ? 4 : 1 });
      if (!result.paused && result.pending > 0) schedule(dictionary, Math.max(1000, outbox.nextDelayMs() ?? 30000));
    }, Math.max(0, Number(delay) || 0));
    if (dictionary) dictionaryTimer = timer; else sentenceTimer = timer;
  };
  const setSharingEnabled = async enabled => {
    if (!declared.dictionary) return { enabled: false, unsupported: true };
    sharingForSession = Boolean(enabled);
    if (enabled) {
      let persisted = false;
      if (!dictionaryPersistenceBlocked) {
        try { storage?.setItem(keys.consent, REPORTING_POLICY); persisted = storage?.getItem(keys.consent) === REPORTING_POLICY; }
        catch { /* Session consent still applies. */ }
      }
      if (getOutbox(true).list().length) schedule(true);
      return { enabled: true, persisted, priorReportsUploaded: false };
    }
    if (dictionaryTimer !== null) windowObject.clearTimeout(dictionaryTimer);
    dictionaryTimer = null;
    // Retire an in-flight batch before touching fallible persistence. Its later
    // acknowledgement/retry cannot restore revoked rows or send the next item.
    const retired = dictionaryOutbox;
    dictionaryOutbox = null;
    if (retired) { retired.storage = null; retired.items = []; }
    let consentRemoved = false;
    try { storage?.removeItem(keys.consent); consentRemoved = storage?.getItem(keys.consent) === null; }
    catch { /* Session revocation still applies. */ }
    const cleanup = clearAuthorizedOutboxResult(storage, keys.dictionary);
    const storageError = !consentRemoved || !cleanup.complete;
    dictionaryPersistenceBlocked = storageError;
    return { enabled: false, clearedAuthorizedReports: cleanup.cleared,
      persisted: !storageError, storageError,
      ...(storageError ? { messageKey: "reporting.dictionary.storageerror" } : {}) };
  };
  maintenance.enqueueReport = async (payload = {}, options = {}) => {
    const report = buildSentenceFeedbackReport(payload, { course, id: options.id });
    if (!report) return { ...disabledDelivery(), invalid: true };
    if (documentObject.getElementById("wordNetFeedbackConsent")?.checked !== true) {
      return { queued: false, consentRequired: true, localOnly: true, pending: 0 };
    }
    const outbox = getOutbox(false);
    const result = outbox.enqueue(report, { id: report.clientReportId, dedupeKey: [report.courseId, report.sentence, report.reason].join("|") });
    schedule(false);
    return { ...result, pending: outbox.list().length, localOnly: false, authorized: true };
  };
  maintenance.flushReports = async () => {
    const outbox = getOutbox(false), result = await outbox.flush({ maxItems: 1 });
    if (!result.paused && result.pending > 0) schedule(false, outbox.nextDelayMs() ?? 30000);
    return { ...result, localOnly: false, authorized: true };
  };
  maintenance.enqueueDictionaryGap = async feedback => {
    if (!declared.dictionary) return { ...disabledDelivery(), unsupported: true };
    const report = buildDictionaryGapReport(feedback, { course, configuration: declared });
    if (!report) return { queued: false, persisted: false, invalid: true, pending: 0 };
    if (!sharingEnabled()) return { ...disabledDelivery(), consentRequired: true };
    const outbox = getOutbox(true), result = outbox.enqueue(report, {
      dedupeKey: [report.courseId, report.providerId, report.dictionaryKey, report.dictionaryDirection, report.normalizedWord].join("|")
    });
    schedule(true);
    return { ...result, pending: outbox.list().length, automaticDelivery: true, authorized: true };
  };
  maintenance.flushDictionaryGaps = async () => {
    if (!sharingEnabled()) return { ...disabledDelivery(), sent: [], consentRequired: true };
    const outbox = getOutbox(true), result = await outbox.flush({ maxItems: 4 });
    if (!result.paused && result.pending > 0) schedule(true, outbox.nextDelayMs() ?? 30000);
    return { ...result, automaticDelivery: true, authorized: true };
  };
  maintenance.sentenceFeedbackSharing = () => ({ enabled: true, policy: REPORTING_POLICY, courseId: course.id });
  maintenance.dictionaryGapSharing = () => ({ enabled: sharingEnabled(), policy: REPORTING_POLICY, priorReportsUploaded: false });
  maintenance.setDictionaryGapSharing = setSharingEnabled;
  maintenance.pagesReportingPolicy = REPORTING_POLICY;
  maintenance.pagesReportingCourseId = course.id;
  windowObject.CaatuuRuntime = { ...runtime, maintenance };
  const t = id => windowObject.CaatuuI18n?.t?.(id) || id;
  disclosureUi(documentObject, t, sharingEnabled, setSharingEnabled, Boolean(declared.dictionary));
  windowObject.addEventListener("online", () => { schedule(false); if (sharingEnabled()) schedule(true); });
  documentObject.addEventListener("visibilitychange", () => {
    if (documentObject.visibilityState === "visible") { schedule(false); if (sharingEnabled()) schedule(true); }
  });
  if (getOutbox(false).list().length) schedule(false, 1000);
  if (sharingEnabled() && getOutbox(true).list().length) schedule(true, 1000);
  return { installed: true, policy: REPORTING_POLICY, courseId: course.id };
}
