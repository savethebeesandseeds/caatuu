import { createBadgeRecommendation } from "./badge-recommendation.mjs?v=badge-recommendation-2";

/** Shared, advisory badge progression. Only an explicit learner action equips a badge. */
export function installBadgeProgression({ scope = globalThis.window ?? globalThis,
  document = scope.document, learning = scope.CaatuuLearning, course = scope.CaatuuCourse,
  i18n = scope.CaatuuI18n, evaluator } = {}) {
  const key = `${course?.storage?.namespace || `caatuu-${course?.id}`}.learning.badge-recommendations.v1`;
  const engine = evaluator ?? (course && learning ? createBadgeRecommendation({ course, learning,
    runtimeHref: scope.location?.href, fetchImpl: scope.fetch?.bind(scope) }) : null);
  const listeners = [];
  let destroyed = false, pageActive = true, revision = 0, pending = null, state = null, offerButton = null;
  const generation = () => typeof learning?.contentGeneration === "function" ? learning.contentGeneration() : "legacy";
  const difficulty = () => Number(learning?.difficulty?.() ?? 1);
  const badge = level => learning?.difficultyOption?.(level)?.label || String(level);
  const t = (id, parameters = {}) => i18n?.t?.(id, parameters) || id;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const listen = (target, type, callback) => {
    target?.addEventListener?.(type, callback);
    listeners.push(() => target?.removeEventListener?.(type, callback));
  };
  const validPreference = value => value?.schemaVersion === 1 && typeof value.generation === "string"
    && Array.isArray(value.dismissed) && value.dismissed.every(level => level === 2 || level === 3);
  function preferences() {
    try {
      const value = learning?.readGameState?.(key, { maxSchemaVersion: 1, validate: validPreference });
      return value?.generation === generation() ? value : { schemaVersion: 1, generation: generation(), dismissed: [] };
    } catch { return { schemaVersion: 1, generation: generation(), dismissed: [] }; }
  }
  function remember(level, dismissed) {
    if (destroyed || typeof generation() !== "string") return false;
    const previous = preferences();
    const value = { ...previous, dismissed: previous.dismissed.filter(item => item !== level) };
    if (dismissed) value.dismissed.push(level);
    try { return learning?.writeGameState?.(key, value, false) === true; } catch { return false; }
  }
  function cancel() { revision++; pending?.abort(); pending = null; }
  function render(root = document) {
    if (destroyed || !document?.body) return;
    const practice = learning?.practiceSet?.(), stage = practice?.progression?.stage;
    const setsPerCycle = practice?.cycle?.target;
    const currentDifficulty = difficulty();
    const ready = state?.status === "ready" && state.difficulty === currentDifficulty
      && stage?.stageComplete === true && practice.progression.available !== false
      && !preferences().dismissed.includes(currentDifficulty + 1);
    for (const slot of root.querySelectorAll?.("[data-caatuu-badge-progression]") || []) {
      if (!stage) { slot.hidden = true; continue; }
      slot.hidden = false;
      slot.setAttribute("role", "region");
      slot.setAttribute("aria-label", t("practice.stage.label"));
      slot.setAttribute("tabindex", "-1");
      slot.replaceChildren();
      const heading = node("strong", "caatuu-badge-stage-title", t("practice.stage.label"));
      const count = stage.targetCycles === null
        ? t("practice.stage.final", { cycles: stage.completedCycles })
        : t("practice.stage.progress", { badge: badge(stage.difficulty),
          cycles: Math.min(stage.completedCycles, stage.targetCycles), target: stage.targetCycles });
      const progress = node("p", "caatuu-badge-stage-count", count);
      const sets = node("small", "caatuu-badge-stage-sets", t("practice.stage.sets", {
        sets: stage.completedSets % setsPerCycle, target: setsPerCycle }));
      slot.append(heading, progress, sets);
      if (stage.targetCycles !== null) {
        const meter = node("progress", "caatuu-badge-stage-meter");
        meter.max = stage.targetCycles * setsPerCycle;
        meter.value = Math.min(meter.max, stage.completedSets);
        meter.setAttribute("aria-label", count);
        slot.append(meter);
      }
      const result = node("div", "caatuu-badge-recommendation");
      result.setAttribute("data-badge-status", state?.status || "practice-needed");
      if (ready) {
        const image = node("img", "caatuu-badge-recommendation-art");
        image.src = `/assets/icons/difficulty_medal_${currentDifficulty + 1}_ui.png?v=ui-1`;
        image.alt = "";
        const message = node("p", "caatuu-badge-recommendation-message", t("practice.badge.ready", { badge: badge(currentDifficulty + 1) }));
        result.append(image, message, node("small", "", t("practice.badge.explanation")));
        const actions = node("div", "caatuu-badge-recommendation-actions");
        const equip = node("button", "caatuu-badge-equip", t("practice.badge.equip", { badge: badge(currentDifficulty + 1) }));
        equip.type = "button";
        equip.addEventListener("click", async () => {
          // Recheck evidence and identity; a late click must not equip a stale offer.
          if (destroyed || state?.status !== "ready" || difficulty() !== currentDifficulty
            || state.generation !== generation() || !learning.practiceSet()?.progression?.stage?.stageComplete) return;
          const reset = generation();
          equip.disabled = true;
          await refresh();
          if (destroyed || state?.status !== "ready" || difficulty() !== currentDifficulty || generation() !== reset) return;
          learning.setDifficulty(currentDifficulty + 1);
          const status = document.querySelector("#learningStatus");
          if (status) status.textContent = t("progress.badge.equipped", { level: currentDifficulty + 1, badge: badge(currentDifficulty + 1) });
          void refresh();
        });
        const dismiss = node("button", "caatuu-badge-dismiss", t("practice.badge.dismiss"));
        dismiss.type = "button";
        dismiss.addEventListener("click", () => { if (remember(currentDifficulty + 1, true)) render(); });
        actions.append(equip, dismiss);
        result.append(actions);
      } else if (stage.stageComplete && preferences().dismissed.includes(currentDifficulty + 1)) {
        result.append(node("p", "", t("practice.badge.dismissed", { badge: badge(currentDifficulty) })));
        const review = node("button", "caatuu-badge-review", t("practice.badge.review"));
        review.type = "button";
        review.addEventListener("click", () => { if (remember(currentDifficulty + 1, false)) void refresh(); });
        result.append(review);
      } else if (stage.targetCycles !== null) {
        const messageId = !stage.stageComplete ? "practice.badge.practice"
          : state?.status === "checking" ? "practice.badge.checking"
          : state?.status === "evidence-needed" ? "practice.badge.evidence" : "practice.badge.unavailable";
        result.append(node("p", "", t(messageId, { badge: badge(currentDifficulty), target: stage.targetCycles })));
      }
      slot.append(result);
    }
    for (const button of document.querySelectorAll?.("[data-difficulty-level]") || []) {
      button.classList.toggle("is-recommended", ready && Number(button.dataset.difficultyLevel) === currentDifficulty + 1);
    }
    const meter = document.querySelector("[data-caatuu-practice-meter]");
    if (meter && (!offerButton || offerButton.parentElement !== meter)) {
      offerButton?.remove();
      offerButton = node("button", "caatuu-practice-badge-offer");
      offerButton.type = "button";
      offerButton.addEventListener("click", () => {
        scope.CaatuuChrome?.openSharedSettings?.({ view: "items" });
        const slot = document.querySelector("[data-caatuu-badge-progression]");
        slot?.scrollIntoView?.({ block: "center" });
        slot?.focus?.({ preventScroll: true });
      });
      meter.append(offerButton);
    }
    if (offerButton) {
      offerButton.hidden = !ready;
      offerButton.textContent = t("practice.badge.view", { badge: badge(currentDifficulty + 1) });
    }
  }
  async function refresh() {
    if (destroyed) return state;
    cancel();
    if (!pageActive || document?.visibilityState === "hidden") { state = null; render(); return state; }
    const token = revision, level = difficulty(), reset = generation();
    const progression = learning?.practiceSet?.()?.progression;
    const stage = progression?.stage;
    if (typeof reset !== "string" || progression?.available === false) {
      state = { status: "unknown", difficulty: level }; render(); return state;
    }
    if (!stage || level >= 3 || !stage.stageComplete) {
      state = { status: level >= 3 ? "max-level" : "practice-needed", difficulty: level };
      render();
      return state;
    }
    state = { status: "checking", difficulty: level };
    render();
    const controller = new AbortController();
    pending = controller;
    try {
      // Let the game finish journaling its scored content encounter first.
      const result = await Promise.resolve().then(() => engine?.evaluate({ signal: controller.signal,
        stageComplete: true, difficulty: level }));
      if (destroyed || token !== revision || difficulty() !== level || generation() !== reset
        || !learning.practiceSet()?.progression?.stage?.stageComplete) return state;
      state = { ...result, status: result?.status || "unknown", difficulty: level, generation: reset };
    } catch {
      if (destroyed || token !== revision) return state;
      state = { status: "unknown", difficulty: level, generation: reset };
    }
    if (token === revision) pending = null;
    render();
    return state;
  }
  const schedule = () => { void refresh(); };
  listen(scope, "caatuu:learning-change", schedule);
  listen(scope, "caatuu:practice-boundary", schedule);
  listen(scope, "caatuu:content-practice-change", schedule);
  listen(scope, "caatuu:progress-save-status", schedule);
  listen(document, "caatuu:settings-open", schedule);
  listen(scope, "storage", event => {
    if (event.storageArea && event.storageArea !== scope.localStorage) return;
    if (event.key === null || event.key === key || event.key?.startsWith(learning?.storage?.performanceStorageKey || "\0")
      || event.key?.startsWith(learning?.storage?.practiceStorageKey || "\0")) schedule();
    else if (event.key?.startsWith(learning?.storage?.contentStorageKey || "\0")) schedule();
  });
  listen(scope, "pagehide", () => { pageActive = false; cancel(); state = null; render(); offerButton?.remove(); });
  listen(scope, "pageshow", () => { pageActive = true; schedule(); });
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") { cancel(); state = null; render(); }
    else schedule();
  });
  void refresh();
  return Object.freeze({ refresh, mount: render, getState: () => state,
    destroy() { destroyed = true; cancel(); listeners.splice(0).forEach(remove => remove()); offerButton?.remove(); } });
}
