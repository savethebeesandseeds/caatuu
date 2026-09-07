import {
  normalizeNounLandingPack, createNounLandingSession, startNounLanding,
  selectNounLane, advanceNounFall, landNoun, nextNoun, setNounFallDuration
} from "./noun-landing-core.mjs?v=noun-landing-core-7";
import { fetchDeclaredCourseGameJson } from "../course-game-content.mjs?v=course-game-content-1";
import { createSpeechIcon, mountEmbeddedGameControls, mountRobotLoadingScreen } from "../embedded-game-controls.mjs?v=embedded-game-controls-8";
import { createNounVisual } from "./noun-visual.mjs?v=noun-visual-3";

const LANDING_MS = 180;
const SUCCESS_FEEDBACK_MS = LANDING_MS + 900;
const ERROR_FEEDBACK_MS = LANDING_MS + 2400;

// Course JSON owns words, categories and artwork. This host owns input and active-time presentation.
export async function mountNounLanding({ course, shell, scope = globalThis, document = scope.document,
  mountControls = true, initialActive = true, segmentSize = 0, onComplete } = {}) {
  if (!Number.isInteger(segmentSize) || segmentSize < 0 || (segmentSize > 0 && typeof onComplete !== "function")) {
    throw new Error("Noun segments require a nonnegative size and a completion callback.");
  }
  const element = (id) => document.getElementById(id);
  const t = (key, values) => shell.CaatuuI18n.t(`games.grammargravity.nouns.${key}`, values);
  const listeners = [];
  const creditedNouns = new Set();
  const recordedLandings = new Set();
  let pack;
  let session;
  let frame = 0;
  let lastTime = null;
  let active = Boolean(initialActive);
  let destroyed = false;
  let speechRequest = 0;
  let speaking = false;
  let soundError = false;
  let lastAutoplayItem = "";
  let controls;
  let laneButtons = [];
  let feedbackElapsed = 0;
  let landingFrom = 0;
  let roundRecorded = false;
  let restorePlayFocus = false;
  let durationMs = 10000;
  let iconsVisible = true;
  let segmentCount = 0;
  let segmentWaiting = false;
  let clockItem = "";
  let clockTurns = 0;
  let loadingPageHidden = false;
  const visual = createNounVisual({ shell, course, image: element("gravityNounVisual"), scope,
    onLoadingChange: () => {
      if (!session || destroyed) return;
      syncVisualState();
      syncClock();
    } });
  const reducedMotion = scope.matchMedia?.("(prefers-reduced-motion: reduce)");
  const loadingScreen = mountRobotLoadingScreen({
    container: element("gravityNounLoading"), label: t("loading"), active: active && !document.hidden
  });

  function listen(target, name, callback, options) {
    target?.addEventListener?.(name, callback, options);
    listeners.push(() => target?.removeEventListener?.(name, callback, options));
  }
  function focus(id) { element(id)?.focus?.({ preventScroll: true }); }
  function inControls(target) {
    return Boolean(element("gravityGameHeader")?.contains(target)
      || element("gravityNounControls")?.contains(target));
  }
  function cancelFrame() {
    if (frame) scope.cancelAnimationFrame(frame);
    frame = 0;
    lastTime = null;
  }
  function engaged() {
    return !destroyed && active && !document.hidden && !segmentWaiting && !visual.loading;
  }
  function canRun() {
    return engaged() && (session?.phase === "feedback" || session?.phase === "falling");
  }
  function schedule() {
    if (canRun() && !frame) frame = scope.requestAnimationFrame(tick);
  }
  function syncClock() {
    syncLoadingScreen();
    if (!canRun()) cancelFrame();
    else schedule();
  }
  function fallFraction(value = session) {
    return value.durationMs ? Math.max(0, Math.min(1, value.elapsedMs / value.durationMs)) : 0;
  }
  function resultVisible() {
    return session?.phase === "feedback" && feedbackElapsed >= LANDING_MS;
  }
  function updateClock() {
    const clock = element("gravityNounClock");
    // The adjective game shares this clock; hidden noun redraws must not own it.
    if (!clock || !active) return;
    clock.hidden = !engaged() || !session || session.durationMs === 0;
    if (clock.hidden) return;
    if (session.item.id !== clockItem) {
      if (clockItem) clockTurns += 1;
      clockItem = session.item.id;
    }
    const remaining = Math.max(0, 1 - fallFraction());
    const tickAngle = session.phase === "falling" ? Math.sin(session.elapsedMs / 1000 * Math.PI * 2) * 6 : 0;
    clock.style.setProperty("--gravity-clock-turn", `${reducedMotion?.matches ? 0 : (clockTurns % 2) * 180 + tickAngle}deg`);
    clock.style.setProperty("--gravity-time-left", String(remaining));
    clock.setAttribute("aria-valuemax", String(session.durationMs / 1000));
    clock.setAttribute("aria-valuenow", String(Math.ceil(remaining * session.durationMs / 1000)));
  }
  function positionBlock() {
    if (!session || destroyed) return;
    updateClock();
    const arena = element("gravityNounArena");
    const block = element("gravityNounBlock");
    const count = pack.lanes.length;
    const selected = pack.lanes.findIndex(({ id }) => id === session.selectedLane);
    const index = selected < 0 ? (count - 1) / 2 : selected;
    block.style.width = `calc(100% / ${count} - 20px)`;
    const arenaWidth = arena.clientWidth;
    const blockWidth = block.offsetWidth;
    block.style.left = arenaWidth > 0 && blockWidth > 0
      ? `${Math.max(8, Math.min(arenaWidth - blockWidth - 8, (index + 0.5) * arenaWidth / count - blockWidth / 2))}px`
      : `calc(${index * 100 / count}% + 10px)`;
    const measuredReserve = Number.parseFloat(scope.getComputedStyle?.(arena)?.getPropertyValue("--gravity-lane-reserve"));
    const reserve = Number.isFinite(measuredReserve) ? Math.max(0, measuredReserve) : 142;
    const travel = Math.max(0, arena.clientHeight - block.offsetHeight - reserve - 14);
    const header = element("gravityGameHeader");
    const start = header && arena.contains(header)
      ? Math.min(travel, Math.max(0, (header.offsetTop || 0) + (header.offsetHeight || 0) + 12 - 14)) : 0;
    let fraction = reducedMotion?.matches ? 0 : fallFraction();
    if (session.phase === "feedback") {
      fraction = reducedMotion?.matches ? Number(resultVisible())
        : landingFrom + (1 - landingFrom) * Math.min(1, feedbackElapsed / LANDING_MS);
    }
    block.style.transform = `translateY(${start + (travel - start) * fraction}px)`;
  }
  function speechIcon() {
    const button = element("gravityNounSpeak");
    button.replaceChildren(createSpeechIcon(document, { stop: speaking }));
    button.setAttribute("aria-label", speaking ? t("stopsound") : t("hear", { word: session?.item?.targetText || "" }));
    button.title = soundError ? t("soundunavailable") : button.getAttribute("aria-label");
  }
  function stopSpeech() {
    speechRequest += 1;
    const wasSpeaking = speaking;
    speaking = false;
    speechIcon();
    if (!wasSpeaking) return Promise.resolve();
    try { return Promise.resolve(shell.CaatuuChrome?.stopSpeech?.()).catch(() => {}); }
    catch { return Promise.resolve(); }
  }
  function render() {
    if (!session || destroyed) return;
    const playing = session.phase === "falling";
    const settled = resultVisible();
    const arena = element("gravityNounArena");
    visual.setActive(!destroyed && active && !document.hidden && !segmentWaiting);
    visual.update(session.item);
    arena.hidden = false;
    arena.dataset.state = session.phase === "feedback" && !settled ? "landing" : session.phase;
    arena.setAttribute("aria-label", t("arena", { word: session.item?.targetText || "" }));
    const word = element("gravityNounWord");
    const targetText = session.item?.targetText || "";
    if (word.textContent !== targetText) word.textContent = targetText;
    word.lang = pack.targetLanguage;
    element("gravityNounMeaning").textContent = session.item?.learnerBaseText || "";
    element("gravityNounMeaning").lang = pack.learnerBaseLanguage;
    const block = element("gravityNounBlock");
    block.hidden = false;
    block.classList.toggle("is-correct", settled && session.correct);
    block.classList.toggle("is-wrong", settled && !session.correct);
    laneButtons.forEach((button, index) => {
      const lane = pack.lanes[index];
      const selected = session.selectedLane === lane.id;
      button.disabled = !playing || !engaged();
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("is-selected", selected);
      button.classList.toggle("is-correct", settled && lane.id === session.item.laneId);
      button.classList.toggle("is-wrong", settled && selected && !session.correct);
    });
    const message = element("gravityNounFeedback");
    const lane = settled ? pack.lanes.find(({ id }) => id === session.item.laneId) : null;
    const result = settled ? t("result", { word: session.item.targetText, lane: lane.label }) : "";
    message.textContent = soundError ? t("soundunavailable") : result;
    if (settled && !soundError) message.setAttribute("aria-label", `${t(session.correct ? "correct" : "incorrect")} · ${result}`);
    else message.removeAttribute("aria-label");
    message.classList.toggle("is-correct", settled && session.correct && !soundError);
    message.classList.toggle("is-wrong", settled && !session.correct && !soundError);
    element("gravityNounSpeak").hidden = course.capabilities?.speech !== true || !playing;
    element("gravityNounSpeak").disabled = !active || Boolean(document.hidden) || Boolean(shell.CaatuuChrome?.getSpeechMuted?.());
    speechIcon();
    positionBlock();
    syncVisualState();
  }
  function syncVisualState() {
    loadingScreen[visual.loading ? "show" : "hide"]();
    const arena = element("gravityNounArena");
    arena.hidden = visual.loading;
    arena.setAttribute("aria-busy", String(visual.loading));
    laneButtons.forEach((button) => { button.disabled = !engaged() || session?.phase !== "falling"; });
    updateClock();
  }
  function recordLanding(previous, fraction = fallFraction(previous)) {
    if (previous.phase !== "falling" || session.phase !== "feedback") return;
    restorePlayFocus = !inControls(document.activeElement) && element("gravityNounArena").contains(document.activeElement);
    segmentCount += 1;
    cancelFrame();
    landingFrom = fraction;
    feedbackElapsed = 0;
    soundError = false;
    void stopSpeech();
    const landingId = `${session.item.id}:${session.attemptsByItem[session.item.id]}`;
    if (!recordedLandings.has(landingId)) {
      recordedLandings.add(landingId);
      const earned = session.correct && !creditedNouns.has(session.item.id);
      if (earned) creditedNouns.add(session.item.id);
      shell.CaatuuLearning?.record?.("grammar-gravity", {
        activities: 1, attempts: 1, successes: session.correct ? 1 : 0, xp: earned ? 1 : 0
      });
    }
    render();
    schedule();
  }
  function tick(timestamp) {
    frame = 0;
    if (!canRun()) { lastTime = null; return; }
    maybeAutoplay();
    const elapsed = lastTime === null ? 0 : Math.max(0, timestamp - lastTime);
    lastTime = timestamp;
    // Ignore suspended-tab gaps: no word or result may disappear unseen.
    if (!Number.isFinite(elapsed) || elapsed > 1000) { schedule(); return; }
    if (session.phase === "feedback") {
      const wasVisible = resultVisible();
      const feedbackMs = session.correct ? SUCCESS_FEEDBACK_MS : ERROR_FEEDBACK_MS;
      feedbackElapsed = Math.min(feedbackMs, feedbackElapsed + elapsed);
      if (feedbackElapsed >= feedbackMs) { next(); return; }
      if (wasVisible !== resultVisible()) render();
      else positionBlock();
      schedule();
      return;
    }
    const previous = session;
    session = advanceNounFall(session, elapsed);
    if (session.phase === "feedback") recordLanding(previous, 1);
    else { positionBlock(); schedule(); }
  }
  function next() {
    if (!engaged() || session?.phase !== "feedback"
      || feedbackElapsed < (session.correct ? SUCCESS_FEEDBACK_MS : ERROR_FEEDBACK_MS)) return;
    const focusInPlay = !inControls(document.activeElement) && (document.activeElement === document.body
      || element("gravityNounArena").contains(document.activeElement));
    const restoreArena = restorePlayFocus && focusInPlay;
    restorePlayFocus = false;
    cancelFrame();
    const lastItemId = session.item.id;
    session = nextNoun(session);
    feedbackElapsed = 0;
    soundError = false;
    if (session.phase === "complete" && !roundRecorded) {
      roundRecorded = true;
      shell.CaatuuLearning?.record?.("grammar-gravity", { rounds: 1 });
      if (session.correctCount === session.total && shell !== scope) shell.postMessage({
        source: "caatuu-game", type: "round-success", gameId: "grammar-gravity",
        evidence: { contentId: pack.contentId, contentRevision: pack.contentRevision,
          challengeId: pack.contentId, challengeRevision: pack.contentRevision,
          exampleIds: Object.keys(session.attemptsByItem) }
      }, scope.location.origin);
      beginCycle(lastItemId);
    }
    if (segmentSize > 0 && segmentCount >= segmentSize) {
      segmentWaiting = true;
      onComplete();
      return;
    }
    render();
    if (restoreArena) focus("gravityNounArena");
    schedule();
  }
  function beginCycle(avoidFirstItemId) {
    lastAutoplayItem = "";
    creditedNouns.clear();
    recordedLandings.clear();
    roundRecorded = false;
    feedbackElapsed = 0;
    restorePlayFocus = false;
    soundError = false;
    session = startNounLanding(createNounLandingSession(pack, { avoidFirstItemId, durationMs }));
  }
  function resumeSegment() {
    if (destroyed || !segmentWaiting) return;
    segmentWaiting = false;
    segmentCount = 0;
    render();
    syncClock();
  }
  function setDurationMs(value) {
    if (![0, 5000, 10000, 15000, 20000].includes(value)) return false;
    durationMs = value;
    if (session) session = setNounFallDuration(session, value);
    render();
    return true;
  }
  function setIconsVisible(value) {
    iconsVisible = Boolean(value);
    visual.setVisible(iconsVisible);
    laneButtons.forEach((button) => { const image = button.querySelector("img"); if (image) image.hidden = !iconsVisible; });
    element("grammarGravityNounMode")?.setAttribute("data-illustrations", iconsVisible ? "shown" : "hidden");
    positionBlock();
  }
  function choose(laneId) {
    if (!engaged() || session?.phase !== "falling") return;
    const previous = session;
    const selected = selectNounLane(session, laneId);
    if (selected.selectedLane !== laneId) return;
    session = landNoun(selected);
    recordLanding(previous);
  }
  function setActive(value) {
    if (destroyed) return;
    if (active && !value && element("gravityNounClock")) element("gravityNounClock").hidden = true;
    active = Boolean(value);
    if (!active) {
      cancelFrame();
      controls?.close();
      void stopSpeech();
    }
    render();
    syncClock();
  }
  async function speak() {
    if (!engaged() || shell.CaatuuChrome?.getSpeechMuted?.()
        || session?.phase !== "falling" || !session.item || course.capabilities?.speech !== true) return;
    if (speaking) {
      void stopSpeech();
      render();
      syncClock();
      return;
    }
    const request = ++speechRequest;
    const word = session.item.targetText;
    speaking = true;
    soundError = false;
    render();
    try {
      await shell.CaatuuChrome?.stopSpeech?.();
      if (request !== speechRequest || destroyed || !active || document.hidden || shell.CaatuuChrome?.getSpeechMuted?.()) return;
      await shell.CaatuuChrome.speakText(word);
    } catch {
      if (request === speechRequest && !destroyed) soundError = true;
    } finally {
      if (request === speechRequest && !destroyed) {
        speaking = false;
        render();
        syncClock();
      }
    }
  }
  function maybeAutoplay() {
    if (!engaged() || session?.phase !== "falling" || !shell.CaatuuChrome?.getSpeechAutoplay?.()
        || shell.CaatuuChrome?.getSpeechMuted?.() || course.capabilities?.speech !== true) return;
    const key = `${session.item.id}:${session.attemptsByItem[session.item.id] || 0}`;
    if (key === lastAutoplayItem) return;
    lastAutoplayItem = key;
    if (!speaking) void speak();
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    visual.destroy();
    loadingScreen.destroy();
    if (active && element("gravityNounClock")) element("gravityNounClock").hidden = true;
    cancelFrame();
    void stopSpeech();
    controls?.destroy();
    listeners.forEach((dispose) => dispose());
  }

  function syncLoadingScreen() {
    loadingScreen.setActive(!destroyed && active && !document.hidden && !loadingPageHidden);
  }
  // Keep the shared blink suspended even while the noun catalog is pending.
  listen(document, "visibilitychange", syncLoadingScreen);
  listen(scope, "pagehide", () => { loadingPageHidden = true; syncLoadingScreen(); });
  listen(scope, "pageshow", () => { loadingPageHidden = false; syncLoadingScreen(); });
  loadingScreen.show();
  element("gravityNounHelp").textContent = t("help");
  element("gravityNounClock")?.setAttribute("aria-label", shell.CaatuuI18n.t("games.grammargravity.controls.falltime"));
  element("grammarGravityNounMode")?.setAttribute("aria-label", shell.CaatuuI18n.t("games.grammargravity.nounmode"));
  element("gravityNounWord").setAttribute("role", "status");
  element("gravityNounWord").setAttribute("aria-live", "polite");
  element("gravityNounWord").setAttribute("aria-atomic", "true");
  element("gravityNounError").hidden = true;
  try {
    const { document: raw } = await fetchDeclaredCourseGameJson(course, {
      gameId: "grammar-gravity", resourceName: "grammarGravityNouns", runtimeHref: scope.location.href
    });
    pack = normalizeNounLandingPack(raw, { courseId: course.id,
      learnerBaseLanguage: course.sourceLanguage.locale || course.sourceLanguage.id,
      targetLanguage: course.targetLanguage.locale });
    const lanes = element("gravityNounLanes");
    lanes.style.gridTemplateColumns = `repeat(${pack.lanes.length}, minmax(0, 1fr))`;
    laneButtons = pack.lanes.map((lane, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gravity-noun-lane";
      button.dataset.laneId = lane.id;
      button.setAttribute("aria-label", t("lane", { number: index + 1, lane: lane.label }));
      if (lane.image) {
        const image = document.createElement("img");
        image.className = "gravity-noun-lane-image";
        image.src = lane.image;
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        image.draggable = false;
        image.hidden = !iconsVisible;
        button.append(image);
      }
      const label = document.createElement("span");
      label.className = "gravity-noun-lane-label";
      label.textContent = lane.label;
      button.append(label);
      listen(button, "click", (event) => {
        if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) choose(lane.id);
      });
      return button;
    });
    lanes.replaceChildren(...laneButtons);
    beginCycle();
    if (mountControls) controls = mountEmbeddedGameControls({ container: element("gravityNounControls"), shell, course, autoplay: true });
    listen(reducedMotion, "change", () => { render(); });
    listen(element("gravityNounSpeak"), "click", () => { void speak(); });
    listen(shell, "caatuu:speech-mute-change", () => {
      if (shell.CaatuuChrome?.getSpeechMuted?.()) void stopSpeech();
      render();
    });
    listen(shell, "caatuu:speech-autoplay-change", () => {
      if (!shell.CaatuuChrome?.getSpeechAutoplay?.()) void stopSpeech();
      else { lastAutoplayItem = ""; maybeAutoplay(); }
    });
    listen(element("gravityNounArena"), "keydown", (event) => {
      if (inControls(event.target)) return;
      if (element("gravityNounSpeak").contains(event.target)) return;
      const laneTarget = event.target?.closest?.(".gravity-noun-lane");
      const activation = event.key === " " || event.key === "Enter";
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        if (laneTarget && activation) event.preventDefault();
        return;
      }
      if (!engaged() || session.phase !== "falling") return;
      if (/^[1-6]$/u.test(event.key)) {
        const lane = pack.lanes[Number(event.key) - 1];
        if (lane) { event.preventDefault(); choose(lane.id); }
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        choose(pack.lanes[event.key === "ArrowLeft" ? 0 : pack.lanes.length - 1].id);
      }
      // Enter/Space retain the focused lane button's native click behavior.
    });
    listen(document, "visibilitychange", () => {
      if (document.hidden) { cancelFrame(); void stopSpeech(); }
      render(); syncClock();
    });
    listen(scope, "resize", positionBlock);
    if (scope.ResizeObserver) {
      const observer = new scope.ResizeObserver(positionBlock);
      observer.observe(element("gravityNounArena"));
      observer.observe(element("gravityNounBlock"));
      listeners.push(() => observer.disconnect());
    }
    listen(scope, "pagehide", (event) => {
      if (event.persisted) { cancelFrame(); void stopSpeech(); }
      else destroy();
    });
    listen(scope, "pageshow", () => { render(); syncClock(); });
    render();
    schedule();
  } catch (error) {
    console.error("Grammar Gravity noun content could not load", error);
    cancelFrame();
    session = null;
    visual.setActive(false);
    if (active && element("gravityNounClock")) element("gravityNounClock").hidden = true;
    controls?.destroy();
    element("gravityNounError").textContent = t("loaderror");
    element("gravityNounError").hidden = false;
    element("gravityNounArena").hidden = true;
  } finally {
    loadingScreen[visual.loading ? "show" : "hide"]();
  }
  return Object.freeze({ next, setActive, destroy, resumeSegment, setDurationMs, setIconsVisible,
    ready: () => Boolean(session) && !destroyed, snapshot: () => session });
}
