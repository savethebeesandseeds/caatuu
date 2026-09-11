import { readEmbeddedCourseProfile, fetchDeclaredCourseGameJson } from "../course-game-content.mjs?v=course-game-content-1";
import { validateSoundQuasarCatalog, createSoundQuasarSession, evaluateSoundQuasarChoice, soundQuasarItemsForDifficulty } from "./sound-quasar-core.mjs?v=sound-quasar-8";
import { createSpeechIcon, mountEmbeddedGameControls, mountRobotLoadingScreen } from "../embedded-game-controls.mjs?v=embedded-game-controls-8";
import { appendTargetToneText } from "../../target-text-tones.mjs?v=target-text-tones-1";
import { newContentEncounterId } from "../content-progression.mjs";

const GAME_ID = "sound-quasar";
const MUSIC_ARTWORK = Object.freeze([
  "/assets/macaw/music/music%20(1).png", "/assets/macaw/music/music%20(2).png",
  "/assets/macaw/music/music%20(3).png", "/assets/macaw/music/music%20(4).png",
  "/assets/macaw/music/music%20(5).png", "/assets/macaw/music/music%20(6).png",
  "/assets/macaw/music/music%20(7).png", "/assets/macaw/music/music%20(8).png",
  "/assets/macaw/music/music%20(9).png", "/assets/macaw/music/music%20(10).png",
  "/assets/macaw/music/music%20(11).png", "/assets/macaw/music/music%20(12).png"
]);

export async function mountSharedSoundQuasar({ scope = globalThis, fetchImpl = globalThis.fetch, random = Math.random } = {}) {
  const doc = scope.document;
  const node = (id) => doc.getElementById(id);
  const course = readEmbeddedCourseProfile(scope);
  const shell = scope.parent && scope.parent !== scope ? scope.parent : scope;
  const api = shell.CaatuuChrome;
  const i18n = shell.CaatuuI18n;
  if (!api || typeof i18n?.t !== "function") throw new Error("The Caatuu shell must be ready before Sounds Quasar starts.");
  const t = (key, args) => i18n.t(key, args);
  const language = i18n.languageName(course.targetLanguage);
  function syncAppearance() {
    const source = shell.document.documentElement;
    doc.documentElement.dataset.theme = source.dataset.theme || "light";
    doc.documentElement.dataset.fontSize = source.dataset.fontSize || "largest";
  }
  syncAppearance();
  doc.documentElement.lang = course.sourceLanguage?.locale || "en";
  doc.documentElement.dir = course.sourceLanguage?.direction || "ltr";
  doc.title = t("games.soundsquasar.title");
  for (const element of doc.querySelectorAll("[data-quasar-copy]")) element.textContent = t(element.dataset.quasarCopy);
  node("quasarChoices").setAttribute("aria-label", t("soundquasar.choices"));
  node("quasarListenIcon").append(createSpeechIcon(doc));
  node("quasarSkip").setAttribute("aria-label", t("soundquasar.skip"));
  node("quasarSkip").title = t("soundquasar.skip");
  let catalog;
  const state = {
    rounds: [], index: 0, missed: new Set(), resolved: false, resultCorrect: false,
    skipped: false, heard: false, playing: false, audioReady: false,
    active: !scope.frameElement?.closest?.("[data-train-panel]")?.hidden,
    finished: false, destroyed: false, speechRequest: 0, voiceRequest: 0,
    voiceBackend: "", audioContext: null, report: null, reported: new Set(), mode: "words", artwork: "", sessionCorrect: 0,
    advanceTimer: null, advanceRequest: 0, pageHidden: false, pendingAutoplay: false, audioFailed: false, choiceCount: 4,
    batchTimer: null, batchRequest: 0, waitingCampaign: false
  };
  const loadingLabel = t("verbnebula.round.preparing");
  const loadingScreen = mountRobotLoadingScreen({ container: node("quasarLoading"), label: loadingLabel,
    active: state.active && shell.document.visibilityState !== "hidden" });
  const transitionScreen = mountRobotLoadingScreen({ container: node("quasarTransition"), label: loadingLabel,
    active: state.active && shell.document.visibilityState !== "hidden" });
  function syncRobotScreens() {
    const active = state.active && !state.destroyed && !state.pageHidden
      && shell.document.visibilityState !== "hidden";
    loadingScreen.setActive(active);
    transitionScreen.setActive(active && !state.report && !controls.isOpen());
  }
  function cancelBatch() {
    if (state.batchTimer !== null) scope.clearTimeout(state.batchTimer);
    state.batchTimer = null;
    state.batchRequest += 1;
  }
  function syncBatch() {
    cancelBatch();
    if (!state.finished || state.waitingCampaign || !state.active || state.destroyed || state.pageHidden
      || shell.document.visibilityState === "hidden" || state.report || controls.isOpen()) return;
    const request = state.batchRequest;
    state.batchTimer = scope.setTimeout(() => {
      if (request !== state.batchRequest || state.destroyed || !state.finished) return;
      startSession();
      node("quasarListen").focus();
    }, 1200);
  }
  const choiceCountKey = `${course.storage?.namespace || course.id}.soundQuasar.choiceCount.v1`;
  try { if (shell.localStorage?.getItem(choiceCountKey) === "6") state.choiceCount = 6; } catch { /* Keep the session default when storage is unavailable. */ }
  const disposers = [];
  const listen = (target, event, handler) => {
    target?.addEventListener?.(event, handler);
    disposers.push(() => target?.removeEventListener?.(event, handler));
  };
  const controls = mountEmbeddedGameControls({ container: node("quasarControls"), shell, course,
    challenge: { content: node("quasarModeOptions"), labelKey: "soundquasar.mode.title" },
    settings: { content: node("quasarChoiceOptions"), labelKey: "soundquasar.options.title", icon: "boxes" },
    onOpenChange: () => syncButtons() });
  const current = () => state.rounds[state.index];
  const muted = () => api.getSpeechMuted?.() === true;
  const automaticAudioOff = () => muted() || api.getSpeechAutoplay?.() === false;
  function maybeAutoplay() {
    if (!state.pendingAutoplay || !state.audioReady || automaticAudioOff() || !state.active || state.destroyed
      || state.pageHidden || shell.document.visibilityState === "hidden" || state.finished
      || state.report || controls.isOpen() || state.playing || state.heard || state.resolved || state.skipped) return;
    state.pendingAutoplay = false;
    void play({ automatic: true });
  }
  function canSkip() {
    return !state.resolved && !state.skipped && !state.finished && state.active && !state.destroyed
      && !state.pageHidden && shell.document.visibilityState !== "hidden" && !state.playing
      && !state.report && !controls.isOpen() && (automaticAudioOff() || !state.audioReady || state.audioFailed);
  }
  function cancelAdvance() {
    if (state.advanceTimer !== null) scope.clearTimeout(state.advanceTimer);
    state.advanceTimer = null;
    state.advanceRequest += 1;
  }
  function canAdvance() {
    return (state.resolved || state.skipped) && state.active && !state.destroyed && !state.finished
      && !state.pageHidden && shell.document.visibilityState !== "hidden"
      && !state.playing && !state.report && !controls.isOpen();
  }
  function syncAdvance() {
    cancelAdvance();
    if (!canAdvance()) return;
    const request = state.advanceRequest;
    const round = current();
    const delay = state.resultCorrect ? (state.mode === "sentences" ? 1800 : 1200)
      : Math.min(8000, Math.max(state.mode === "sentences" ? 4500 : 3000, round.meaning.length * 55 + 1000));
    state.advanceTimer = scope.setTimeout(() => {
      if (request !== state.advanceRequest || current() !== round || !canAdvance()) return;
      state.advanceTimer = null;
      next();
    }, delay);
  }
  function showResult(correct = true) {
    const round = current();
    state.resultCorrect = correct;
    feedback();
    node("quasarChoices").setAttribute("aria-hidden", "true");
    node("quasarAnswerArea").classList.add("is-result");
    node("quasarResultStatus").textContent = t(correct ? "soundquasar.result.correct" : "wordworld.result.correctanswer");
    node("quasarResult").dataset.tone = correct ? "success" : "error";
    const target = node("quasarResultTarget");
    target.lang = course.targetLanguage.locale || course.targetLanguage.id;
    target.replaceChildren();
    appendTargetToneText(doc, target, round.target, round.reading);
    const reading = node("quasarResultReading");
    reading.textContent = round.reading?.system === "pinyin"
      ? round.reading.tokens.flatMap((token) => token.units.map((unit) => unit.notation)).join(" ") : "";
    reading.hidden = !reading.textContent;
    node("quasarResultMeaning").lang = catalog.learnerBaseLanguage;
    node("quasarResultMeaning").textContent = round.meaning;
    node("quasarResult").hidden = false;
    node("quasarResult").focus();
  }
  function feedback(key, args, tone = "") {
    node("quasarFeedback").textContent = key ? t(key, args) : "";
    node("quasarFeedback").dataset.tone = tone;
  }
  function syncButtons() {
    syncRobotScreens();
    const unavailable = !state.active || state.destroyed || state.finished;
    node("quasarListen").disabled = unavailable || !state.audioReady || state.finished;
    node("quasarListen").setAttribute("aria-pressed", String(state.playing));
    node("quasarListen").setAttribute("aria-label", t(state.playing ? "soundquasar.stop" : state.heard ? "soundquasar.replay" : "soundquasar.listen"));
    node("quasarGame").classList.toggle("is-playing", state.playing);
    node("quasarSkip").hidden = state.finished || state.resolved || state.skipped || !(automaticAudioOff() || !state.audioReady || state.audioFailed);
    node("quasarSkip").disabled = !canSkip();
    node("quasarReport").disabled = unavailable || state.finished || state.reported.has(current()?.id);
    node("quasarReport").textContent = t(state.reported.has(current()?.id) ? "wordworld.report.savedaction" : "soundquasar.report.action");
    for (const button of node("quasarChoices").querySelectorAll("button")) {
      button.disabled = unavailable || !state.heard || state.playing || state.resolved || state.skipped || state.missed.has(button.dataset.choiceId);
    }
    syncAdvance();
    syncBatch();
    maybeAutoplay();
  }
  function stopSpeech() {
    state.speechRequest += 1;
    const wasPlaying = state.playing;
    state.playing = false;
    if (wasPlaying) void Promise.resolve(api.stopSpeech?.()).catch(() => {});
    syncButtons();
  }
  async function checkAudio() {
    const request = ++state.voiceRequest;
    try {
      const status = await api.getSpeechVoiceControlState?.();
      if (request !== state.voiceRequest || state.destroyed) return;
      state.voiceBackend = status?.backend || "";
      state.audioReady = course.capabilities?.speech === true && typeof api.speakText === "function"
        && status?.available === true && status.reason !== "no-language-voice"
        && (status.backend === "android" || status.voices?.length > 0);
    } catch {
      if (request !== state.voiceRequest || state.destroyed) return;
      state.audioReady = false;
    }
    node("quasarAudioStatus").textContent = state.audioReady ? "" : t("soundquasar.audio.unavailable", { language });
    node("quasarRetryAudio").hidden = state.audioReady;
    syncButtons();
  }
  function beginWord() {
    state.encounterId = newContentEncounterId();
    state.contentGeneration = shell.CaatuuLearning?.contentGeneration?.() ?? null;
    state.resolved = false;
    state.resultCorrect = false;
    state.skipped = false;
    state.pendingAutoplay = false;
    stopSpeech();
    state.heard = false;
    state.audioFailed = false;
    state.audioContext = null;
    state.missed.clear();
    closeReport(false);
    node("quasarReportStatus").textContent = "";
    if (state.audioReady) {
      node("quasarAudioStatus").textContent = "";
      node("quasarRetryAudio").hidden = true;
    }
    node("quasarProgress").textContent = t(state.mode === "sentences" ? "soundquasar.progress.sentences" : "soundquasar.progress", { number: state.index + 1, count: state.rounds.length });
    const artwork = MUSIC_ARTWORK.filter((path) => path !== state.artwork);
    state.artwork = artwork[Math.min(artwork.length - 1, Math.max(0, Math.floor(random() * artwork.length)))];
    node("quasarEmblem").src = state.artwork;
    node("quasarEmblem").classList.toggle("is-mirrored", random() < .5);
    const choices = current().choices.map((choice, index) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "quasar-choice";
      button.dataset.choiceId = choice.id;
      button.lang = course.targetLanguage.locale || course.targetLanguage.id;
      button.setAttribute("aria-keyshortcuts", String(index + 1));
      const number = doc.createElement("span");
      number.className = "quasar-choice-number";
      number.textContent = `${index + 1}.`;
      const target = doc.createElement("span");
      target.className = "quasar-choice-target";
      appendTargetToneText(doc, target, choice.target, choice.reading);
      button.append(number, target);
      button.addEventListener("click", () => choose(choice.id));
      return button;
    });
    node("quasarChoices").replaceChildren(...choices);
    node("quasarChoices").dataset.count = String(choices.length);
    node("quasarChoices").removeAttribute("aria-hidden");
    node("quasarAnswerArea").classList.remove("is-result");
    node("quasarResult").hidden = true;
    feedback();
    state.pendingAutoplay = !automaticAudioOff();
    syncButtons();
  }
  function startSession() {
    cancelBatch();
    state.waitingCampaign = false;
    state.resolved = false;
    state.skipped = false;
    cancelAdvance();
    const difficulty = Math.max(1, Math.min(3, Math.floor(Number(shell.CaatuuLearning?.difficulty?.()) || 1)));
    const available = soundQuasarItemsForDifficulty(catalog, { mode: state.mode, difficulty }).length;
    const choiceCount = available >= state.choiceCount ? state.choiceCount : Math.min(4, available);
    state.rounds = createSoundQuasarSession(catalog, { random, roundLength: 5, mode: state.mode, choiceCount, difficulty,
      history: shell.CaatuuLearning?.contentHistory?.(GAME_ID, state.mode) });
    for (const button of node("quasarChoiceOptions").querySelectorAll("button[data-count]")) {
      const count = Number(button.dataset.count);
      button.textContent = t("soundquasar.options.count", { count });
      button.disabled = count > available;
      button.setAttribute("aria-pressed", String(count === choiceCount));
    }
    state.index = 0;
    state.sessionCorrect = 0;
    state.finished = false;
    transitionScreen.hide();
    node("quasarPanel").classList.remove("is-transitioning");
    node("quasarPlayArea").hidden = false;
    node("quasarGame").dataset.mode = state.mode;
    node("quasarInstructions").textContent = t(state.mode === "sentences" ? "soundquasar.help.sentences" : "soundquasar.help");
    node("quasarChoices").setAttribute("aria-label", t(state.mode === "sentences" ? "soundquasar.choices.sentences" : "soundquasar.choices"));
    for (const button of node("quasarModeOptions").querySelectorAll("button[data-mode]")) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
    }
    beginWord();
  }
  async function play({ automatic = false } = {}) {
    if (!state.active || state.destroyed || !state.audioReady || state.finished || state.pageHidden
      || shell.document.visibilityState === "hidden" || (automatic && automaticAudioOff())) return;
    state.pendingAutoplay = false;
    if (state.playing) { stopSpeech(); return; }
    const token = ++state.speechRequest;
    state.audioContext = soundContext();
    state.playing = true;
    syncButtons();
    try {
      // The shared shell owns voice, speed, mute, and browser/native transport.
      const result = await api.speakText(current().target, { allowWhileMuted: !automatic });
      if (token !== state.speechRequest || !state.active || state.destroyed) return;
      if (result?.outcome === "completed") {
        state.heard = true;
        state.audioFailed = false;
        node("quasarAudioStatus").textContent = "";
        node("quasarRetryAudio").hidden = true;
        if (!state.resolved && !state.skipped) feedback();
      } else if (result?.outcome === "muted" || result?.muted) {
        state.audioFailed = true;
        feedback("soundquasar.muted");
      } else {
        state.audioFailed = result?.outcome !== "stopped";
        feedback("soundquasar.audio.stopped");
      }
    } catch (error) {
      if (token !== state.speechRequest || state.destroyed) return;
      state.audioFailed = true;
      node("quasarAudioStatus").textContent = String(error?.message || "");
      feedback("soundquasar.audio.failed", { language }, "error");
      node("quasarRetryAudio").hidden = false;
    } finally {
      if (token === state.speechRequest && !state.destroyed) {
        state.playing = false;
        syncButtons();
      }
    }
  }
  function choose(choiceId) {
    if (!state.active || state.destroyed || state.finished || !state.heard || state.playing || state.resolved || state.skipped || state.missed.has(choiceId)) return;
    const round = current();
    const correct = evaluateSoundQuasarChoice(round, choiceId);
    const evidence = state.missed.size ? "assisted" : "independent";
    const button = node("quasarChoices").querySelector(`[data-choice-id="${choiceId}"]`);
    if (correct) {
      state.resolved = true;
      state.sessionCorrect += 1;
      button.classList.add("is-correct");
      showResult();
    } else {
      state.missed.add(choiceId);
      button.classList.add("is-wrong");
      if (state.missed.size >= 2) {
        state.resolved = true;
        showResult(false);
      } else feedback("soundquasar.tryagain", undefined, "error");
    }
    // Lock the attempt before record() emits synchronous learning-change events.
    shell.CaatuuLearning?.recordExposure?.(GAME_ID, {
      bankId: state.mode, itemId: round.id, encounterId: state.encounterId,
      generation: state.contentGeneration,
      evidence, correct
    });
    shell.CaatuuLearning?.record?.(GAME_ID, { activities: 1, attempts: 1, successes: correct ? 1 : 0, xp: correct ? 1 : 0 });
    syncButtons();
  }
  function skip() {
    if (!canSkip()) return;
    state.skipped = true;
    state.pendingAutoplay = false;
    stopSpeech();
    next();
  }
  function next() {
    if (!canAdvance()) return;
    state.resolved = false;
    state.skipped = false;
    cancelAdvance();
    stopSpeech();
    state.index += 1;
    if (state.index < state.rounds.length) {
      beginWord();
      node("quasarListen").focus();
      return;
    }
    state.finished = true;
    if (state.sessionCorrect > 0) shell.CaatuuLearning?.record?.(GAME_ID, { rounds: 1, streakEligible: true });
    node("quasarPlayArea").hidden = true;
    node("quasarResult").hidden = true;
    transitionScreen.show();
    node("quasarPanel").classList.add("is-transitioning");
    state.waitingCampaign = shell.document.body?.dataset.campaignActive === "true";
    syncButtons();
    if (state.waitingCampaign) shell.postMessage({ source: "caatuu-game", type: "round-complete", gameId: GAME_ID }, scope.location.origin);
  }
  function soundContext() {
    return { backend: state.voiceBackend, locale: catalog.audio.locale,
      voice: api.getSpeechVoicePreference?.() || "automatic", rate: api.resolveSpeechPace?.()?.rate ?? 1 };
  }
  function closeReport(restoreFocus = true) {
    const dialog = node("quasarReportDialog");
    if (dialog.open || dialog.hasAttribute("open")) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    state.report = null;
    if (restoreFocus && state.active && !state.destroyed) node("quasarReport").focus();
    syncAdvance();
  }
  function openReport() {
    if (!state.active || state.destroyed || state.finished || state.reported.has(current()?.id)) return;
    state.pendingAutoplay = false;
    controls.close();
    stopSpeech();
    const round = current();
    state.report = {
      clientReportId: scope.crypto?.randomUUID?.() || `sound-quasar-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      reportedAt: new Date().toISOString(), kind: "sound_quasar_audio", courseId: course.id, gameId: GAME_ID,
      catalogId: catalog.id, contentRevision: catalog.contentRevision,
      itemId: round.id, target: round.target, meaning: round.meaning, mode: state.mode,
      audio: state.audioContext || soundContext(), pending: false
    };
    node("quasarReportReason").value = "pronunciation";
    node("quasarReportComment").value = "";
    node("quasarReportDialogStatus").textContent = "";
    node("quasarReportSubmit").disabled = false;
    const dialog = node("quasarReportDialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    node("quasarReportReason").focus();
    syncAdvance();
  }
  async function saveReport(event) {
    event.preventDefault();
    const snapshot = state.report;
    if (!snapshot || snapshot.pending || !state.active || state.destroyed) return;
    const reason = node("quasarReportReason").value;
    if (!["pronunciation", "wrong-word", "no-sound", "other"].includes(reason)) return;
    const { pending, ...details } = snapshot;
    const reportFeedback = { ...details, reason, comment: node("quasarReportComment").value.trim().slice(0, 400) };
    snapshot.pending = true;
    node("quasarReportSubmit").disabled = true;
    node("quasarReportDialogStatus").textContent = t("wordworld.report.saving");
    try {
      const queued = await shell.CaatuuRuntime?.maintenance?.enqueueReport?.({
        kind: "sound_quasar_audio_feedback", title: "Sounds Quasar audio feedback",
        message: `${reason}: ${snapshot.target}`, feedback: reportFeedback
      }, { id: snapshot.clientReportId, dedupeKey: [GAME_ID, course.id, catalog.contentRevision, snapshot.itemId, snapshot.audio.voice, reason].join("|") });
      if (!queued?.queued && queued?.ok !== true) throw new Error("Feedback queue is unavailable.");
      state.reported.add(snapshot.itemId);
      if (state.destroyed) return;
      syncButtons();
      if (state.report !== snapshot) return;
      closeReport();
      node("quasarReportStatus").textContent = t(queued.persisted === false ? "wordworld.report.sessiononly" : "wordworld.report.savedlocal");
      syncButtons();
    } catch {
      if (!state.destroyed && state.report === snapshot) node("quasarReportDialogStatus").textContent = t("wordworld.report.savefailed");
    } finally {
      snapshot.pending = false;
      if (!state.destroyed && state.report === snapshot) node("quasarReportSubmit").disabled = false;
    }
  }
  function setActive(active) {
    state.active = active;
    syncRobotScreens();
    if (active && shell.document.body?.dataset.campaignActive !== "true") state.waitingCampaign = false;
    if (!active) { controls.close(); closeReport(false); stopSpeech(); }
    else { syncAppearance(); controls.sync(); syncAdvance(); void checkAudio(); }
  }
  listen(node("quasarListen"), "click", () => { void play(); });
  listen(doc, "keydown", (event) => {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || !/^[1-6]$/u.test(event.key) || !state.active || state.destroyed || state.finished || state.pageHidden
      || shell.document.visibilityState === "hidden" || state.report || controls.isOpen()) return;
    if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], dialog, [role="dialog"], .caatuu-game-controls')) return;
    const button = node("quasarChoices").querySelectorAll("button")[Number(event.key) - 1];
    if (!button || button.disabled) return;
    event.preventDefault();
    choose(button.dataset.choiceId);
  });
  listen(node("quasarPanel"), "click", (event) => {
    if (event.defaultPrevented || (event.button !== undefined && event.button !== 0) || state.report || controls.isOpen()) return;
    if (event.target?.closest?.('button, a, input, select, textarea, label, dialog, [role="dialog"], .caatuu-game-controls')) return;
    if (scope.getSelection?.()?.isCollapsed === false) return;
    // A single click covers taps as well, avoiding duplicate touch/click playback.
    void play();
  });
  listen(node("quasarReport"), "click", openReport);
  listen(node("quasarReportCancel"), "click", () => closeReport());
  listen(node("quasarReportDialog"), "cancel", (event) => { event.preventDefault(); closeReport(); });
  listen(node("quasarReportForm"), "submit", (event) => { void saveReport(event); });
  listen(node("quasarModeOptions"), "click", (event) => {
    const mode = event.target?.closest?.("button[data-mode]")?.dataset.mode;
    if (!state.active || state.destroyed || !["words", "sentences"].includes(mode) || mode === state.mode) return;
    state.mode = mode;
    state.pendingAutoplay = false;
    controls.close();
    startSession();
    node("quasarListen").focus();
  });
  listen(node("quasarSkip"), "click", skip);
  listen(node("quasarChoiceOptions"), "click", (event) => {
    const button = event.target?.closest?.("button[data-count]");
    const count = Number(button?.dataset.count);
    if (!state.active || state.destroyed || button?.disabled || ![4, 6].includes(count) || count === state.choiceCount) return;
    state.choiceCount = count;
    try { shell.localStorage?.setItem(choiceCountKey, String(count)); } catch { /* Keep the session choice when storage is unavailable. */ }
    state.pendingAutoplay = false;
    controls.close();
    startSession();
    node("quasarListen").focus();
  });
  listen(node("quasarRetryAudio"), "click", () => { void checkAudio(); });
  listen(shell, "caatuu:learning-change", (event) => {
    if (event.detail?.reason !== "difficulty" || !catalog || state.destroyed) return;
    controls.close();
    closeReport(false);
    stopSpeech();
    startSession();
  });
  listen(shell, "caatuu:speech-mute-change", () => { if (muted()) { state.pendingAutoplay = false; stopSpeech(); } void checkAudio(); });
  listen(shell, "caatuu:speech-autoplay-change", () => { if (automaticAudioOff()) state.pendingAutoplay = false; syncButtons(); });
  listen(shell, "caatuu:speech-voices-refresh", () => { void checkAudio(); });
  listen(shell.speechSynthesis, "voiceschanged", () => { void checkAudio(); });
  listen(scope, "message", (event) => {
    if (event.origin !== scope.location.origin || event.source !== shell || event.data?.source !== "caatuu-app-shell") return;
    if (event.data.type === "campaign-advance" && state.waitingCampaign && state.finished) {
      state.active = false;
      startSession();
    } else if (event.data.type === "visibility") setActive(event.data.active === true);
  });
  listen(shell.document, "visibilitychange", () => {
    if (shell.document.visibilityState === "hidden") { controls.close(); closeReport(false); stopSpeech(); }
    else { syncRobotScreens(); syncAdvance(); syncBatch(); maybeAutoplay(); }
  });
  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    loadingScreen.destroy();
    transitionScreen.destroy();
    stopSpeech();
    closeReport(false);
    state.voiceRequest += 1;
    disposers.forEach((dispose) => dispose());
    controls.destroy();
    syncButtons();
  }
  listen(scope, "pagehide", (event) => {
    state.pageHidden = true;
    if (event.persisted) { controls.close(); closeReport(false); stopSpeech(); } else destroy();
  });
  listen(scope, "pageshow", () => { state.pageHidden = false; syncRobotScreens(); syncAppearance(); syncAdvance(); void checkAudio(); });
  // Register lifecycle before fetching so a hidden or retired frame cannot keep
  // its initial loading animation active or begin playback when content arrives.
  try {
    const { document: raw } = await fetchDeclaredCourseGameJson(course, {
      gameId: GAME_ID, resourceName: "soundQuasarCatalog", runtimeHref: scope.location.href, fetchImpl
    });
    if (state.destroyed) return null;
    catalog = validateSoundQuasarCatalog(raw, {
      courseId: course.id,
      targetLanguageId: course.targetLanguage.id,
      learnerBaseLanguage: course.sourceLanguage.locale || course.sourceLanguage.id
    });
  } catch (error) {
    if (state.destroyed) return null;
    destroy();
    throw error;
  }
  startSession();
  loadingScreen.hide();
  node("quasarGame").hidden = false;
  node("quasarRoot").setAttribute("aria-busy", "false");
  void checkAudio();
  return Object.freeze({ destroy });
}

function showError(error) {
  const doc = globalThis.document;
  doc.getElementById("quasarRoot").setAttribute("aria-busy", "false");
  doc.getElementById("quasarLoading").hidden = true;
  doc.getElementById("quasarGame").hidden = true;
  doc.getElementById("quasarError").hidden = false;
  doc.getElementById("quasarErrorText").textContent = String(error?.message || "Sounds Quasar could not start.");
}

if (typeof document !== "undefined") mountSharedSoundQuasar().catch(showError);
