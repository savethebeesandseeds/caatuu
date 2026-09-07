import { grammarFeedbackDuration, highlightedFormParts, buildMeaningChoices, validateGrammarFlight, validateGrammarStages } from "./adjective-flight-core.mjs?v=grammar-journey-1";
import { createNounVisual } from "./noun-visual.mjs?v=noun-visual-3";
import { createSpeechIcon, mountRobotLoadingScreen } from "../embedded-game-controls.mjs?v=embedded-game-controls-8";

const LANDING_MS = 180;
const PREVIEW_MS = 4000;
const FORM_TIME_MULTIPLIER = 2;
const DURATIONS = [0, 5000, 10000, 15000, 20000];

export function mountGrammarFlight({ document, scope = globalThis, shell, course,
  onAttempt = () => {}, onComplete = () => {}, copy = (key) => key } = {}) {
  const element = (id) => document.getElementById(id);
  const arena = element("gravityAdjectiveArena");
  const drop = element("gravityAdjectiveDrop");
  const parachute = element("gravityAdjectiveParachute");
  const prompt = element("gravityAdjectivePrompt");
  const speechButton = element("gravityAdjectiveSpeak");
  const choices = element("gravityAdjectiveChoices");
  const recap = element("gravityAdjectiveRecap");
  const nextButton = element("gravityAdjectiveNext");
  const clock = element("gravityNounClock");
  const illustration = element("gravityAdjectiveVisual");
  const loadingContainer = document.createElement("div");
  loadingContainer.className = "gravity-illustration-loading";
  arena.append(loadingContainer);
  const loadingScreen = mountRobotLoadingScreen({ container: loadingContainer,
    label: shell.CaatuuI18n.t("games.grammargravity.nouns.loading"), active: false });
  loadingScreen.hide();
  const visual = createNounVisual({ shell, course, image: illustration, scope, onLoadingChange: syncVisualState });
  const reducedMotion = scope.matchMedia?.("(prefers-reduced-motion: reduce)");
  const listeners = [];
  let active = false;
  let destroyed = false;
  let phase = "idle";
  let step = "form";
  let practiceMode = null;
  let steps = [];
  let meaningRetries = 0;
  const mistakes = new Set();
  let meaningOptionCount = 3;
  let previewMs = 0;
  let flights = [];
  let index = 0;
  let elapsedMs = 0;
  let durationMs = 10000;
  let landingMs = 0;
  let feedbackMs = 0;
  let landingFrom = 0;
  let correct = false;
  let correctCount = 0;
  let timeout = false;
  let frame = 0;
  let lastTick = null;
  let restoreFocus = false;
  let speaking = false;
  let iconsVisible = true;
  let speechRequest = 0;
  let lastAutoplayKey = "";
  let roundRevision = null;

  function speechText() { return step !== "form" || ["preview", "falling"].includes(phase) ? current()?.anchorText : current()?.targetText; }
  function syncSpeech() {
    speechButton.hidden = course.capabilities?.speech !== true;
    speechButton.disabled = !engaged() || !["preview", "falling", "feedback", "recap"].includes(phase) || Boolean(shell.CaatuuChrome?.getSpeechMuted?.());
    speechButton.replaceChildren(createSpeechIcon(document, { stop: speaking }));
    const label = shell.CaatuuI18n?.t(`games.grammargravity.nouns.${speaking ? "stopsound" : "hear"}`, { word: speechText() || "" });
    speechButton.setAttribute("aria-label", label || speechText() || "");
    speechButton.title = label || "";
  }
  function stopSpeech() {
    speechRequest += 1;
    const wasSpeaking = speaking;
    speaking = false;
    if (wasSpeaking) {
      try { Promise.resolve(shell.CaatuuChrome?.stopSpeech?.()).catch(() => {}); } catch { /* Unavailable speech never blocks play. */ }
    }
    syncSpeech();
  }
  async function speak() {
    if (!engaged() || !["preview", "falling", "feedback", "recap"].includes(phase) || !speechText()
        || course.capabilities?.speech !== true || shell.CaatuuChrome?.getSpeechMuted?.()) return;
    if (speaking) { stopSpeech(); return; }
    const request = ++speechRequest;
    const text = speechText();
    speaking = true;
    syncSpeech();
    try {
      await shell.CaatuuChrome?.stopSpeech?.();
      if (request !== speechRequest || !engaged() || shell.CaatuuChrome?.getSpeechMuted?.()) return;
      await shell.CaatuuChrome?.speakText?.(text);
    } catch { /* Keep the timed game playable when pronunciation is unavailable. */ }
    finally { if (request === speechRequest && !destroyed) { speaking = false; syncSpeech(); } }
  }
  function maybeAutoplay() {
    if (!engaged() || !["preview", "falling"].includes(phase) || !shell.CaatuuChrome?.getSpeechAutoplay?.()
        || shell.CaatuuChrome?.getSpeechMuted?.() || course.capabilities?.speech !== true) return;
    const key = `${index}:${step}:${meaningRetries}`;
    if (lastAutoplayKey === key) return;
    lastAutoplayKey = key;
    if (!speaking) void speak();
  }

  function listen(target, name, handler) {
    target?.addEventListener?.(name, handler);
    listeners.push(() => target?.removeEventListener?.(name, handler));
  }
  function engaged() { return active && !destroyed && !document.hidden && !visual.loading; }
  function syncVisualState(loading = Boolean(visual.loading)) {
    loadingScreen[loading ? "show" : "hide"]();
    loadingScreen.setActive(active && !destroyed && !document.hidden);
    arena.setAttribute("aria-busy", String(loading));
    drop.hidden = loading;
    choices.hidden = loading || phase === "recap";
    if (loading) { cancelFrame(); stopSpeech(); }
    else { syncSpeech(); position(); schedule(); }
  }
  function headerContains(target) {
    return element("gravityGameHeader")?.contains(target) || element("gravityNounControls")?.contains(target);
  }
  function current() { return flights[index]; }
  function stepDurationMs() { return durationMs * (step === "form" ? FORM_TIME_MULTIPLIER : 1); }
  function syncHelp() {
    if (active && current()) element("gravityNounHelp").textContent = copy(phase === "recap" ? "recaphelp" : phase === "preview" ? "previewhelp"
      : step === "meaning" ? "meaninghelp" : step === "category" ? "categoryhelp" : durationMs === 0 ? "untimedhelp" : "help");
  }
  function currentOptions() { return step === "meaning" ? current()?.meaningOptions || []
    : step === "category" ? current()?.categoryOptions?.map(({ id }) => id) || [] : current()?.options || []; }
  function answerText() { return step === "meaning" ? current()?.anchorMeaning : step === "category" ? current()?.categoryId : current()?.answer; }
  function optionLabel(value) { return step === "category" ? current()?.categoryOptions.find(({ id }) => id === value)?.label || value : value; }
  function finalStep() { return step === steps.at(-1); }
  function retryMeaning() { return step === "meaning" && !correct && !timeout; }
  function resetFlight() {
    steps = practiceMode === "sequence" ? [...current().stages] : [practiceMode === "forms" ? "form" : "meaning"];
    step = steps[0];
    meaningRetries = 0;
    mistakes.clear();
    phase = step === "form" ? "preview" : "falling";
    elapsedMs = 0;
    feedbackMs = 0;
    previewMs = 0;
  }
  function cancelFrame() {
    if (frame) scope.cancelAnimationFrame(frame);
    frame = 0;
    lastTick = null;
  }
  function schedule() {
    if (engaged() && ["preview", "falling", "landing", "feedback"].includes(phase) && !frame) {
      frame = scope.requestAnimationFrame(tick);
    }
  }
  function position() {
    if (!current()) return;
    const fallingCard = ["falling", "landing"].includes(phase);
    parachute.hidden = !iconsVisible || !fallingCard;
    parachute.dataset.motion = phase;
    // Keep the canopy below the toolbar, including before the image finishes loading.
    const parachuteHeight = parachute.offsetHeight || Number.parseFloat(scope.getComputedStyle?.(parachute)?.height) || 0;
    let canopyClearance = ["preview", "recap"].includes(phase) ? 0 : Math.max(0, parachuteHeight - 12);
    const timeLimit = stepDurationMs();
    const fraction = phase === "preview" ? 0 : phase === "falling" ? (timeLimit ? elapsedMs / timeLimit : 0)
      : phase === "landing" ? landingFrom + (1 - landingFrom) * Math.min(1, landingMs / LANDING_MS) : 1;
    const header = element("gravityGameHeader");
    const headerBottom = header && arena.contains(header) && header.offsetHeight > 0
      ? (header.offsetTop || 0) + header.offsetHeight + 12 : 38;
    drop.style.maxHeight = phase === "recap" ? `${Math.max(44, arena.clientHeight - headerBottom - 16)}px` : "";
    const dividerTop = phase === "recap" ? arena.clientHeight - 16
      : choices.offsetTop || arena.clientHeight - (choices.offsetHeight || 78);
    const distance = Math.max(0, dividerTop - (drop.offsetHeight || 112));
    if (distance < headerBottom + canopyClearance) {
      parachute.hidden = true;
      canopyClearance = 0;
    }
    const start = phase === "recap" ? headerBottom : Math.min(distance, headerBottom + canopyClearance);
    const y = ["preview", "recap"].includes(phase) ? start + Math.max(0, distance - start) / 2
      : start + (distance - start) * (reducedMotion?.matches && phase === "falling" ? 0 : fraction);
    drop.style.transform = `translateY(${y}px)`;
    if (clock && active) {
      const left = phase === "preview" || timeLimit === 0 ? 1 : phase === "falling" ? Math.max(0, 1 - elapsedMs / timeLimit) : 0;
      clock.hidden = !engaged() || ["complete", "recap"].includes(phase) || durationMs === 0;
      clock.style.setProperty("--gravity-time-left", String(left));
      clock.style.setProperty("--gravity-clock-turn", `${reducedMotion?.matches ? 0 : (index % 2) * 180 + Math.sin(elapsedMs / 1000 * Math.PI * 2) * 6}deg`);
      clock.setAttribute("aria-valuemax", String(timeLimit / 1000));
      clock.setAttribute("aria-valuenow", String(Math.ceil(left * timeLimit / 1000)));
    }
  }
  function formContent(form, ending = false) {
    const { stem, ending: suffix } = highlightedFormParts(form, current().options);
    const fragment = document.createElement("span");
    fragment.append(stem);
    const highlight = document.createElement("span");
    highlight.className = ending ? "gravity-adjective-ending" : "gravity-adjective-form-ending";
    highlight.textContent = suffix;
    fragment.append(highlight);
    return fragment;
  }
  function renderProgress() {
    const progress = element("gravityAdjectiveProgress");
    progress.replaceChildren(...steps.flatMap((stage, stageIndex) => {
      const label = document.createElement("span");
      label.textContent = copy(`${stage}stage`);
      if (stage === step && phase !== "recap") label.setAttribute("aria-current", "step");
      if (mistakes.has(stage)) {
        label.dataset.result = "wrong";
        label.setAttribute("aria-label", copy("stepmistake", { step: label.textContent }));
        const marker = document.createElement("span");
        marker.className = "gravity-adjective-mistake";
        marker.textContent = "×";
        marker.setAttribute("aria-hidden", "true");
        label.append(" ", marker);
      }
      return stageIndex ? [" → ", label] : [label];
    }));
  }
  function renderFlight() {
    const flight = current();
    if (illustration.parentElement !== arena) arena.append(illustration);
    recap.hidden = true;
    nextButton.disabled = true;
    choices.hidden = false;
    arena.dataset.state = phase;
    arena.dataset.step = step;
    arena.dataset.meaningCount = String(currentOptions().length);
    const previewLabel = element("gravityAdjectivePreviewLabel");
    previewLabel.hidden = phase !== "preview";
    previewLabel.textContent = copy("previewlabel");
    arena.setAttribute("aria-label", copy(step === "meaning" ? "choosemeaning" : step === "category" ? "choosecategory" : "choose", { anchor: flight.anchorText }));
    renderProgress();
    const { stem, ending } = highlightedFormParts(flight.answer, flight.options);
    prompt.textContent = phase !== "preview" && stem && ending ? `${stem}…` : "\u00a0";
    prompt.setAttribute("aria-label", copy("prompt"));
    element("gravityAdjectiveNoun").replaceChildren(flight.beforeText, prompt, flight.afterText);
    element("gravityAdjectiveMeaning").textContent = flight.learnerBaseText;
    if (step !== "form") {
      element("gravityAdjectiveNoun").textContent = flight.anchorText;
      element("gravityAdjectiveMeaning").textContent = step === "meaning" ? "" : flight.anchorMeaning;
    }
    const context = element("gravityAdjectiveContext");
    if (context) {
      context.hidden = practiceMode !== "sequence" || step !== "form";
      context.textContent = [flight.anchorMeaning, ...(steps.includes("category")
        ? [flight.categoryOptions.find(({ id }) => id === flight.categoryId).label] : [])].join(" · ");
    }
    syncHelp();
    element("gravityAdjectiveFeedback").textContent = "";
    prompt.lang = course.targetLanguage?.locale || course.targetLanguage?.id || "und";
    element("gravityAdjectiveNoun").lang = prompt.lang;
    element("gravityAdjectiveMeaning").lang = course.sourceLanguage?.locale || "en";
    choices.style.setProperty("--adjective-options", String(currentOptions().length));
    choices.replaceChildren(...currentOptions().map((form, optionIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = phase === "preview";
      button.className = "gravity-adjective-choice";
      if (step === "meaning") button.dataset.nounMeaning = form;
      else if (step === "category") button.dataset.grammarCategory = form;
      else button.dataset.grammarForm = form;
      button.lang = step !== "form" ? course.sourceLanguage?.locale || "en" : course.targetLanguage?.locale || "und";
      button.setAttribute("aria-label", optionLabel(form));
      const categoryImage = step === "category" && flight.categoryOptions.find(({ id }) => id === form)?.image;
      if (categoryImage) {
        const icon = document.createElement("img");
        icon.className = "gravity-adjective-gender-icon";
        icon.src = categoryImage;
        icon.alt = "";
        icon.setAttribute("aria-hidden", "true");
        icon.draggable = false;
        icon.hidden = !iconsVisible;
        button.append(icon);
      }
      const key = document.createElement("small");
      key.setAttribute("aria-hidden", "true");
      key.textContent = String(optionIndex + 1);
      let labelContent = step !== "form" ? optionLabel(form) : formContent(form);
      if (step === "category") {
        labelContent = document.createElement("span");
        labelContent.className = "gravity-adjective-choice-label";
        labelContent.textContent = optionLabel(form);
      }
      button.append(labelContent, key);
      return button;
    }));
    drop.hidden = false;
    visual.update({ id: flight.id, revision: roundRevision, english: flight.anchorEnglishAuditText });
    syncVisualState();
    syncSpeech();
    position();
  }
  function renderResult() {
    const flight = current();
    arena.dataset.state = correct ? "correct" : "wrong";
    if (step !== "form") {
      element("gravityAdjectiveNoun").textContent = flight.anchorText;
      element("gravityAdjectiveMeaning").textContent = step === "category" ? `${flight.anchorMeaning} · ${optionLabel(flight.categoryId)}` : flight.anchorMeaning;
    } else {
      element("gravityAdjectiveNoun").replaceChildren(flight.beforeText, formContent(flight.answer, true), flight.afterText);
    }
    element("gravityAdjectiveFeedback").textContent = copy(correct ? "correct" : timeout ? "timeout" : step === "meaning" ? "wrongmeaning" : "wrong", {
      phrase: step !== "form" ? `${flight.anchorText} · ${optionLabel(answerText())}` : flight.targetText
    });
    syncSpeech();
    position();
  }
  function restorePlayFocus(target = arena) {
    if (restoreFocus && !headerContains(document.activeElement)
        && (document.activeElement === document.body || arena.contains(document.activeElement))) {
      target.focus({ preventScroll: true });
    }
    restoreFocus = false;
  }
  function renderRecap() {
    const flight = current();
    arena.dataset.state = "recap";
    arena.setAttribute("aria-label", copy("recaplabel"));
    renderProgress();
    const label = element("gravityAdjectivePreviewLabel");
    label.hidden = true;
    label.textContent = "";
    element("gravityAdjectiveNoun").replaceChildren(flight.beforeText, formContent(flight.answer, true), flight.afterText);
    element("gravityAdjectiveMeaning").textContent = flight.learnerBaseText;
    const category = steps.includes("category") ? flight.categoryOptions.find(({ id }) => id === flight.categoryId).label : "";
    const context = element("gravityAdjectiveContext");
    context.hidden = !category;
    context.textContent = category;
    context.lang = course.sourceLanguage?.locale || "en";
    drop.prepend(illustration);
    recap.hidden = false;
    choices.hidden = true;
    nextButton.textContent = copy("nextword");
    nextButton.disabled = !engaged();
    element("gravityAdjectiveFeedback").textContent = copy("recapannouncement", { phrase: flight.targetText });
    syncHelp();
    syncSpeech();
    position();
    restorePlayFocus(nextButton);
  }
  function choose(form, timedOut = false) {
    if (!engaged() || phase !== "falling" || (!timedOut && !currentOptions().includes(form))) return;
    restoreFocus = arena.contains(document.activeElement) && !headerContains(document.activeElement);
    correct = !timedOut && form === answerText();
    timeout = timedOut;
    if (!correct) {
      mistakes.add(step);
      if (step !== "form") meaningRetries += 1;
    }
    if (finalStep() && correct && mistakes.size === 0) correctCount += 1;
    renderProgress();
    landingFrom = durationMs ? Math.min(1, elapsedMs / stepDurationMs()) : 0;
    landingMs = 0;
    feedbackMs = 0;
    phase = "landing";
    stopSpeech();
    if (step === "form") element("gravityAdjectiveNoun").replaceChildren(current().beforeText,
      formContent(timedOut ? current().answer : form), current().afterText);
    for (const button of choices.querySelectorAll("button")) {
      button.disabled = true;
      const value = step === "meaning" ? button.dataset.nounMeaning : step === "category" ? button.dataset.grammarCategory : button.dataset.grammarForm;
      button.classList.toggle("is-correct", value === answerText());
      button.classList.toggle("is-wrong", !correct && value === form);
    }
    cancelFrame();
    if (finalStep() && !retryMeaning() || timedOut && step === "meaning") {
      onAttempt({ correct: correct && mistakes.size === 0, flight: current(), timeout, meaningRetries, mistakes: [...mistakes] });
    }
    position();
    schedule();
  }
  function next() {
    if (!engaged() || (phase !== "recap" && (phase !== "feedback" || feedbackMs < grammarFeedbackDuration(correct)))) return;
    cancelFrame();
    stopSpeech();
    if (phase === "feedback" && finalStep() && step === "form") {
      phase = "recap";
      renderRecap();
      return;
    }
    if (phase === "recap") restoreFocus = arena.contains(document.activeElement) && !headerContains(document.activeElement);
    if (retryMeaning() || !finalStep() && !(timeout && step === "meaning")) {
      if (!retryMeaning()) step = steps[steps.indexOf(step) + 1];
      phase = step === "form" ? "preview" : "falling";
      previewMs = 0;
      elapsedMs = 0;
      feedbackMs = 0;
    } else {
      index += 1;
      if (index >= flights.length) {
        phase = "complete";
        syncSpeech();
        onComplete({ correctCount, total: flights.length });
        return;
      }
      resetFlight();
    }
    renderFlight();
    restorePlayFocus();
    schedule();
  }
  function tick(timestamp) {
    frame = 0;
    if (!engaged()) { lastTick = null; return; }
    maybeAutoplay();
    const elapsed = lastTick === null ? 0 : Math.max(0, timestamp - lastTick);
    lastTick = timestamp;
    if (!Number.isFinite(elapsed) || elapsed > 1000) { schedule(); return; }
    if (phase === "preview") {
      previewMs = Math.min(PREVIEW_MS, previewMs + elapsed);
      if (previewMs >= PREVIEW_MS) {
        phase = "falling";
        elapsedMs = 0;
        renderFlight();
      }
    } else if (phase === "falling" && durationMs !== 0) {
      elapsedMs = Math.min(stepDurationMs(), elapsedMs + elapsed);
      if (elapsedMs >= stepDurationMs()) { choose("", true); return; }
    } else if (phase === "landing") {
      landingMs += elapsed;
      if (landingMs >= LANDING_MS) {
        feedbackMs = landingMs - LANDING_MS;
        phase = "feedback";
        renderResult();
      }
    } else if (phase === "feedback") {
      feedbackMs += elapsed;
      if (feedbackMs >= grammarFeedbackDuration(correct)) { next(); return; }
    }
    position();
    schedule();
  }
  function syncVisibility() {
    cancelFrame();
    nextButton.disabled = !engaged() || phase !== "recap";
    syncHelp();
    if (!engaged()) stopSpeech();
    else syncSpeech();
    visual.setActive(active && !destroyed && !document.hidden);
    syncVisualState();
    position();
    schedule();
  }
  listen(choices, "click", (event) => {
    const button = event.target?.closest?.("button");
    if (button && choices.contains(button)) choose(step === "meaning" ? button.dataset.nounMeaning
      : step === "category" ? button.dataset.grammarCategory : button.dataset.grammarForm);
  });
  listen(arena, "keydown", (event) => {
    if (speechButton.contains(event.target) || headerContains(event.target)) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.repeat || !/^[1-6]$/u.test(event.key)) return;
    const form = currentOptions()[Number(event.key) - 1];
    if (form && engaged() && phase === "falling") { event.preventDefault(); choose(form); }
  });
  listen(document, "visibilitychange", syncVisibility);
  listen(speechButton, "click", () => { void speak(); });
  listen(nextButton, "click", next);
  listen(shell, "caatuu:speech-mute-change", () => { if (shell.CaatuuChrome?.getSpeechMuted?.()) stopSpeech(); syncSpeech(); });
  listen(shell, "caatuu:speech-autoplay-change", () => {
    if (!shell.CaatuuChrome?.getSpeechAutoplay?.()) stopSpeech();
    else { lastAutoplayKey = ""; maybeAutoplay(); }
  });
  listen(scope, "resize", position);
  listen(scope, "pagehide", () => { cancelFrame(); stopSpeech(); visual.setActive(false); });
  listen(scope, "pageshow", syncVisibility);
  listen(reducedMotion, "change", position);
  return Object.freeze({
    start(round, nextFlights, options = {}) {
      if (destroyed) return false;
      if (!round || !Array.isArray(nextFlights) || !nextFlights.length) throw new Error("A modern grammar round must contain authored flights.");
      if (!["sequence", "meaning", "forms"].includes(options.practiceMode)) throw new Error("Grammar practice mode must be explicitly sequence, meaning, or forms.");
      validateGrammarStages(round.stages);
      for (const flight of nextFlights) {
        validateGrammarFlight(flight);
        if (JSON.stringify(flight.stages) !== JSON.stringify(round.stages)) throw new Error("Grammar flight stages must match the authored round stages.");
        if (options.practiceMode === "meaning" && !flight.stages.includes("meaning")) throw new Error("Meaning practice requires an authored meaning stage.");
      }
      cancelFrame();
      stopSpeech();
      lastAutoplayKey = "";
      practiceMode = options.practiceMode;
      roundRevision = round.revision;
      flights = nextFlights.map((flight) => ({ ...flight,
        meaningOptions: flight.stages.includes("meaning")
          ? buildMeaningChoices(flight.anchorMeaning, flight.meaningPool, meaningOptionCount) : []
      }));
      index = 0;
      correctCount = 0;
      elapsedMs = 0;
      feedbackMs = 0;
      restoreFocus = false;
      resetFlight();
      renderFlight();
      syncVisibility();
      return true;
    },
    setActive(value) { active = Boolean(value); syncVisibility(); },
    setDurationMs(value) {
      if (!DURATIONS.includes(value)) return false;
      elapsedMs = durationMs && value ? elapsedMs / durationMs * value : 0;
      durationMs = value;
      syncHelp();
      position();
      return true;
    },
    setIconsVisible(value) {
      iconsVisible = Boolean(value);
      visual.setVisible(iconsVisible);
      choices.querySelectorAll(".gravity-adjective-gender-icon").forEach((icon) => { icon.hidden = !iconsVisible; });
      position();
    },
    setMeaningOptionCount(value) {
      if (![3, 6].includes(value)) return false;
      meaningOptionCount = value;
      flights = flights.map((flight) => ({ ...flight,
        meaningOptions: flight.stages.includes("meaning")
          ? buildMeaningChoices(flight.anchorMeaning, flight.meaningPool, value) : []
      }));
      if (current() && step === "meaning" && phase === "falling") {
        cancelFrame();
        elapsedMs = 0;
        renderFlight();
        schedule();
      }
      return true;
    },
    next,
    snapshot: () => ({ phase, step, steps: [...steps], practiceMode, mistakes: [...mistakes], meaningRetries, meaningOptionCount, previewMs, index, elapsedMs, feedbackMs, correctCount, total: flights.length, current: current(), durationMs, stepDurationMs: stepDurationMs() }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopSpeech();
      cancelFrame();
      visual.destroy();
      loadingScreen.destroy();
      listeners.forEach((dispose) => dispose());
    }
  });
}
