export const REPORTING_POLICY = "2026-09-02.v1";
export const REPORTING_POLICY_HEADER = "X-Caatuu-Reporting-Policy";
export const SENTENCE_REPORT_SCHEMA = "caatuu.sentence-feedback-report.v1";
export const SENTENCE_OUTBOX_KEY = "caatuu.sentenceFeedbackAuthorizedOutbox.v2";
export const DICTIONARY_OUTBOX_KEY = "caatuu.dictionaryGapAuthorizedOutbox.v2";
export const DICTIONARY_CONSENT_KEY = "caatuu.reportingConsent.v1";

const canonicalOrigin = "https://caatuu.waajacu.com";
const dictionaryPath = "/cz/api/dictionary/gaps";
const sentencePath = "/api/sentence-reports";
const sentenceReasons = new Set([
  "nonsense_or_incorrect",
  "unnatural_czech",
  "wrong_translation",
  "repeated_too_soon",
  "other"
]);
const contentModes = new Set(["", "standard", "generative", "authored"]);

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function compact(value, limit, { required = false } = {}) {
  const normalized = String(value ?? "").normalize("NFC");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u0300-\u036f]/u.test(normalized)) return null;
  const text = normalized.replace(/\s+/gu, " ").trim();
  if ((required && !text) || [...text].length > limit) return null;
  return text;
}

function validUuid(value) {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(text)
    ? text.toLowerCase()
    : "";
}

export function buildSentenceFeedbackReport(payload, { id = "", idFactory = createId } = {}) {
  if (payload?.kind !== "word_world_sentence_feedback") return null;
  const feedback = payload.feedback;
  if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)) return null;
  const sentence = compact(feedback.sentence, 360, { required: true });
  const translation = compact(feedback.translation, 360);
  const comment = compact(feedback.comment, 400);
  const entryId = compact(feedback.entryId, 120);
  const corpusVersion = compact(feedback.corpusVersion, 80);
  const contentMode = compact(feedback.contentMode, 32);
  const clientReportId = validUuid(feedback.clientReportId || id) || validUuid(idFactory());
  if (
    !sentence
    || translation === null
    || comment === null
    || entryId === null
    || corpusVersion === null
    || !contentModes.has(contentMode)
    || !clientReportId
    || !sentenceReasons.has(feedback.reason)
  ) return null;
  return {
    schema: SENTENCE_REPORT_SCHEMA,
    clientReportId,
    sentence,
    translation,
    reason: feedback.reason,
    comment,
    entryId,
    contentMode,
    corpusVersion
  };
}

export function clearAuthorizedOutbox(storage, storageKey) {
  if (!storage || typeof storage.key !== "function" || typeof storage.removeItem !== "function") return 0;
  const prefix = `${storageKey}.item.`;
  const keys = [];
  for (let index = 0; index < Number(storage.length || 0); index += 1) {
    const key = storage.key(index);
    if (key === storageKey || key?.startsWith(prefix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}

function safeStorage(windowObject) {
  try {
    return windowObject.localStorage;
  } catch (error) {
    return null;
  }
}

function disclosureUi(documentObject, sharingEnabled, setSharingEnabled) {
  const form = documentObject.getElementById("wordNetFeedbackForm");
  const actions = form?.querySelector(".word-net-feedback-actions");
  const submit = documentObject.getElementById("wordNetFeedbackSubmit");
  if (form && actions && !documentObject.getElementById("wordNetFeedbackConsent")) {
    const explanation = documentObject.createElement("p");
    explanation.className = "word-net-feedback-disclosure";
    explanation.textContent = "Sending shares this Czech sentence, its English translation, your reason, optional note, entry ID, content type, and corpus version with Caatuu for 90 days. It does not send your identity, device, URL, nearby sentences, or model details.";
    const label = documentObject.createElement("label");
    label.className = "word-net-feedback-consent";
    const checkbox = documentObject.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "wordNetFeedbackConsent";
    checkbox.required = true;
    label.append(checkbox, documentObject.createTextNode(" I agree to send this report to Caatuu."));
    actions.before(explanation, label);
    const syncSubmit = () => {
      if (submit) submit.disabled = !checkbox.checked;
    };
    checkbox.addEventListener("change", syncSubmit);
    form.addEventListener("reset", () => queueMicrotask(syncSubmit));
    form.addEventListener("submit", (event) => {
      if (checkbox.checked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const status = documentObject.getElementById("wordNetFeedbackStatus");
      if (status) status.textContent = "Confirm what will be sent before sending this report.";
    }, true);
    if (submit) submit.textContent = "Send report";
    syncSubmit();
  }

  const feedbackArea = documentObject.querySelector(".word-net-feedback");
  if (!feedbackArea || documentObject.getElementById("wordNetDictionarySharingToggle")) return;
  const toggle = documentObject.createElement("button");
  toggle.className = "word-net-report-toggle";
  toggle.id = "wordNetDictionarySharingToggle";
  toggle.type = "button";

  const dialog = documentObject.createElement("dialog");
  dialog.className = "word-net-feedback-dialog";
  dialog.id = "wordNetDictionarySharingDialog";
  dialog.setAttribute("aria-labelledby", "wordNetDictionarySharingTitle");
  const panel = documentObject.createElement("div");
  panel.className = "word-net-feedback-form";
  const title = documentObject.createElement("strong");
  title.id = "wordNetDictionarySharingTitle";
  title.textContent = "Missing dictionary words";
  const explanation = documentObject.createElement("p");
  explanation.textContent = "If you turn this on, future missing-word checks send only the word, normalized form, fixed dictionary version and direction, lookup outcome, and result count. No sentence, identity, device details, or old saved reports are sent. Previously saved gaps stay on this device.";
  const sharingActions = documentObject.createElement("div");
  sharingActions.className = "word-net-feedback-actions";
  const change = documentObject.createElement("button");
  change.type = "button";
  change.id = "wordNetDictionarySharingChange";
  const cancel = documentObject.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  sharingActions.append(change, cancel);
  panel.append(title, explanation, sharingActions);
  dialog.append(panel);
  feedbackArea.append(toggle, dialog);

  const sync = () => {
    const enabled = sharingEnabled();
    toggle.textContent = `Dictionary sharing: ${enabled ? "on" : "off"}`;
    toggle.setAttribute("aria-pressed", String(enabled));
    change.textContent = enabled
      ? "Turn off and delete unsent shared-word reports"
      : "Share future missing words";
  };
  toggle.addEventListener("click", () => {
    sync();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });
  cancel.addEventListener("click", () => dialog.close?.());
  change.addEventListener("click", async () => {
    change.disabled = true;
    try {
      await setSharingEnabled(!sharingEnabled());
      sync();
      dialog.close?.();
    } finally {
      change.disabled = false;
    }
  });
  sync();
}

export async function installPagesReporting({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  fetchImpl = globalThis.fetch
} = {}) {
  const course = windowObject?.CaatuuCourse;
  const maintenance = windowObject?.CaatuuRuntime?.maintenance;
  if (course?.id !== "cz" || !maintenance) return { installed: false };
  if (maintenance.pagesReportingPolicy === REPORTING_POLICY) return { installed: true, reused: true };

  const [{ FeedbackOutbox }, { buildDictionaryGapReport }] = await Promise.all([
    import("./feedback-outbox.mjs?v=feedback-outbox-5"),
    import("../features/dictionary/dictionary-gap-report.mjs?v=dictionary-gap-report-1")
  ]);
  const storage = safeStorage(windowObject);
  const original = {
    enqueueReport: maintenance.enqueueReport.bind(maintenance),
    enqueueDictionaryGap: maintenance.enqueueDictionaryGap.bind(maintenance),
    flushReports: maintenance.flushReports.bind(maintenance),
    flushDictionaryGaps: maintenance.flushDictionaryGaps.bind(maintenance)
  };
  let sentenceOutbox = null;
  let dictionaryOutbox = null;
  let sentenceTimer = null;
  let dictionaryTimer = null;
  let sharingForSession = false;

  const canonical = () => windowObject.location?.origin === canonicalOrigin;
  const visible = () => documentObject.visibilityState !== "hidden";
  const online = () => canonical() && windowObject.navigator?.onLine !== false;
  const sharingEnabled = () => {
    if (sharingForSession) return true;
    try {
      return storage?.getItem(DICTIONARY_CONSENT_KEY) === REPORTING_POLICY;
    } catch (error) {
      return false;
    }
  };

  const send = async (path, payload) => {
    if (!canonical()) throw new Error("Reporting is available only on the public Caatuu origin.");
    const response = await fetchImpl(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [REPORTING_POLICY_HEADER]: REPORTING_POLICY
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok !== true || result?.stored !== true) {
      throw new Error(result?.message || `Reporting returned HTTP ${response.status}.`);
    }
    return { ok: true };
  };

  const getSentenceOutbox = () => {
    if (!sentenceOutbox) {
      sentenceOutbox = new FeedbackOutbox({
        storage,
        storageKey: SENTENCE_OUTBOX_KEY,
        send: (payload) => send(sentencePath, payload),
        online,
        visible,
        saveData: () => false,
        maxItems: 64
      });
    }
    return sentenceOutbox;
  };
  const getDictionaryOutbox = () => {
    if (!dictionaryOutbox) {
      dictionaryOutbox = new FeedbackOutbox({
        storage,
        storageKey: DICTIONARY_OUTBOX_KEY,
        send: (payload) => send(dictionaryPath, payload),
        online: () => sharingEnabled() && online(),
        visible,
        saveData: () => false,
        maxItems: 128
      });
    }
    return dictionaryOutbox;
  };

  const schedule = (kind, delay = 0) => {
    const dictionary = kind === "dictionary";
    const existing = dictionary ? dictionaryTimer : sentenceTimer;
    if (existing !== null) windowObject.clearTimeout(existing);
    const timer = windowObject.setTimeout(async () => {
      if (dictionary) dictionaryTimer = null;
      else sentenceTimer = null;
      const outbox = dictionary ? getDictionaryOutbox() : getSentenceOutbox();
      const result = await outbox.flush({ maxItems: dictionary ? 4 : 1 });
      if (!result.paused && result.pending > 0) {
        const next = outbox.nextDelayMs();
        schedule(kind, next === null ? 30_000 : Math.max(1_000, next));
      }
    }, Math.max(0, Number(delay) || 0));
    if (dictionary) dictionaryTimer = timer;
    else sentenceTimer = timer;
  };

  const setSharingEnabled = async (enabled) => {
    sharingForSession = Boolean(enabled);
    if (enabled) {
      try {
        storage?.setItem(DICTIONARY_CONSENT_KEY, REPORTING_POLICY);
      } catch (error) {
        // Explicit sharing remains active only for this browser session.
      }
      if (getDictionaryOutbox().list().length) schedule("dictionary", 0);
      return { enabled: true, priorReportsUploaded: false };
    }
    if (dictionaryTimer !== null) windowObject.clearTimeout(dictionaryTimer);
    dictionaryTimer = null;
    try {
      storage?.removeItem(DICTIONARY_CONSENT_KEY);
    } catch (error) {
      // The session flag still revokes delivery immediately.
    }
    sharingForSession = false;
    const cleared = clearAuthorizedOutbox(storage, DICTIONARY_OUTBOX_KEY);
    dictionaryOutbox = null;
    return { enabled: false, clearedAuthorizedReports: cleared };
  };

  maintenance.enqueueReport = async (payload = {}, options = {}) => {
    const report = buildSentenceFeedbackReport(payload, { id: options.id });
    if (!report) return original.enqueueReport(payload, options);
    const outbox = getSentenceOutbox();
    const result = outbox.enqueue(report, {
      id: report.clientReportId,
      dedupeKey: [report.sentence, report.reason].join("|")
    });
    schedule("sentence", 0);
    return { ...result, pending: outbox.list().length, localOnly: false, authorized: true };
  };
  maintenance.flushReports = async () => {
    const outbox = getSentenceOutbox();
    const result = await outbox.flush({ maxItems: 1 });
    if (!result.paused && result.pending > 0) schedule("sentence", outbox.nextDelayMs() ?? 30_000);
    return { ...result, localOnly: false, authorized: true };
  };
  maintenance.enqueueDictionaryGap = async (feedback = {}) => {
    const report = buildDictionaryGapReport(feedback);
    if (!report) return { queued: false, persisted: false, invalid: true, pending: 0 };
    if (!sharingEnabled()) {
      const local = await original.enqueueDictionaryGap(feedback);
      return { ...local, consentRequired: true, automaticDelivery: false, localOnly: true };
    }
    const outbox = getDictionaryOutbox();
    const result = outbox.enqueue(report, {
      dedupeKey: [report.dictionaryKey, report.dictionaryDirection, report.normalizedWord].join("|")
    });
    schedule("dictionary", 0);
    return { ...result, pending: outbox.list().length, automaticDelivery: true, authorized: true };
  };
  maintenance.flushDictionaryGaps = async () => {
    if (!sharingEnabled()) return original.flushDictionaryGaps();
    const outbox = getDictionaryOutbox();
    const result = await outbox.flush({ maxItems: 4 });
    if (!result.paused && result.pending > 0) schedule("dictionary", outbox.nextDelayMs() ?? 30_000);
    return { ...result, automaticDelivery: true, authorized: true };
  };
  maintenance.dictionaryGapSharing = () => ({
    enabled: sharingEnabled(),
    policy: REPORTING_POLICY,
    priorReportsUploaded: false
  });
  maintenance.setDictionaryGapSharing = setSharingEnabled;
  maintenance.pagesReportingPolicy = REPORTING_POLICY;

  disclosureUi(documentObject, sharingEnabled, setSharingEnabled);
  windowObject.addEventListener("online", () => {
    schedule("sentence", 0);
    if (sharingEnabled()) schedule("dictionary", 0);
  });
  documentObject.addEventListener("visibilitychange", () => {
    if (documentObject.visibilityState !== "visible") return;
    schedule("sentence", 0);
    if (sharingEnabled()) schedule("dictionary", 0);
  });
  if (getSentenceOutbox().list().length) schedule("sentence", 1_000);
  if (sharingEnabled() && getDictionaryOutbox().list().length) schedule("dictionary", 1_000);
  return { installed: true, policy: REPORTING_POLICY };
}
