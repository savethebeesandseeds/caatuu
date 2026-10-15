import { createRewardSound } from "./reward-sound.mjs?v=reward-sound-2";

const CELEBRATION_MS = 2200;
const REDUCED_MOTION_MS = 1200;
const XP_ICON = "/language-runtime/static/assets/xp-gold.webp";
const gameIds = Object.freeze({ "verb-lab": "verb-nebula", "word-net": "word-world" });

/** The shared shell owns practice pacing and presentation; courses supply content. */
export function installGameDynamics({
  scope = globalThis.window ?? globalThis,
  learning = scope.CaatuuLearning,
  document = scope.document,
  i18n = scope.CaatuuI18n,
  onPauseChange = () => {},
  sound
} = {}) {
  const rewardSound = sound ?? createRewardSound({ scope });
  let destroyed = false;
  let enabled = false;
  let current = null;
  let meter = null;
  let meterProgress = null;
  let lastSnapshot = null;
  const transitions = new Map();
  const listeners = [];
  const clock = () => scope.performance?.now?.() ?? Date.now();
  const setTimer = (callback, delay) => (scope.setTimeout ?? setTimeout)(callback, delay);
  const clearTimer = id => (scope.clearTimeout ?? clearTimeout)(id);
  const read = () => typeof learning?.practiceSet === "function" ? learning.practiceSet() : null;
  const translate = (key, fallback, parameters = {}) => {
    const value = i18n?.t?.(key, parameters);
    return typeof value === "string" && value && value !== key ? value : fallback;
  };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const listen = (target, type, listener, options) => {
    target?.addEventListener?.(type, listener, options);
    listeners.push(() => target?.removeEventListener?.(type, listener, options));
  };

  function stopEffects(state) {
    rewardSound.stop();
    state.effectsTimers.forEach(clearTimer);
    state.effectsTimers.length = 0;
    state.animations.forEach(animation => { try { animation.cancel(); } catch { /* Already finished. */ } });
    state.animations.clear();
    state.targets.forEach(target => target.classList.remove("caatuu-reward-received", "is-paused"));
    state.targets.clear();
  }

  function startMotion(state) {
    if (state.reduced) return;
    const layer = element("div", "caatuu-practice-flight-layer");
    layer.setAttribute("aria-hidden", "true");
    state.overlay.append(layer);
    for (const token of state.tokens) {
      const target = document.querySelector(`[data-caatuu-header-${token.kind}]`);
      const sourceRect = token.art.getBoundingClientRect?.();
      const targetRect = target?.getBoundingClientRect?.();
      const copies = token.kind === "coins" ? 3 : token.kind === "xp" ? 2 : 1;
      for (let index = 0; index < copies; index++) {
        const flight = element("div", `caatuu-practice-flight caatuu-practice-flight-${token.kind}`);
        const art = element("img");
        art.src = token.art.src;
        art.alt = "";
        flight.append(art);
        layer.append(flight);
        if (typeof flight.animate !== "function" || !sourceRect || !targetRect || !targetRect.width) {
          flight.classList.add("is-fallback");
          continue;
        }
        const startX = sourceRect.left + sourceRect.width / 2 - 12;
        const startY = sourceRect.top + sourceRect.height / 2 - 12;
        const endX = targetRect.left + targetRect.width / 2 - 12;
        const endY = targetRect.top + targetRect.height / 2 - 12;
        const turnX = startX + (endX - startX) * .3 + (index - (copies - 1) / 2) * 36;
        const turnY = startY - 70;
        let animation;
        try { animation = flight.animate([
          { transform: `translate(${startX}px, ${startY}px) scale(.6)`, opacity: 0, offset: 0 },
          { transform: `translate(${startX}px, ${startY}px) scale(1)`, opacity: 1, offset: .12 },
          { transform: `translate(${turnX}px, ${turnY}px) scale(.9)`, opacity: 1, offset: .45 },
          { transform: `translate(${endX}px, ${endY}px) scale(.45)`, opacity: 0, offset: 1 }
        ], { duration: 900, delay: 650 + index * 90, easing: "cubic-bezier(.25,.65,.35,1)", fill: "both" });
        } catch { flight.classList.add("is-fallback"); continue; }
        state.animations.add(animation);
      }
      if (target) {
        state.targets.add(target);
        state.effectsTimers.push(setTimer(() => {
          if (current === state) target.classList.add("caatuu-reward-received");
        }, 1200));
      }
    }
  }

  function refresh(snapshot = read()) {
    if (destroyed || !document?.body) return;
    lastSnapshot = snapshot;
    if (!snapshot) {
      if (meter) meter.hidden = true;
      return;
    }
    if (!meter) {
      meter = element("div", "caatuu-practice-meter");
      meter.setAttribute("data-caatuu-practice-meter", "");
      meterProgress = element("progress", "caatuu-practice-meter-progress");
      meter.append(meterProgress);
    }
    const header = document.querySelector(".app-header");
    if (header && meter.parentElement !== header) header.append(meter);
    const target = Math.max(1, Number(snapshot.target) || 1);
    const effort = Math.min(target, Math.max(0, Number(snapshot.effort) || 0));
    const label = translate("practice.set.label", "Practice set");
    const count = translate("practice.set.progress", `${effort} / ${target}`, { effort, target });
    meterProgress.max = target;
    meterProgress.value = effort;
    meterProgress.setAttribute("aria-label", label);
    meterProgress.setAttribute("aria-valuetext", count);
    meter.hidden = !enabled || !header;
  }

  function contentFor(details) {
    const supplied = details?.content;
    if (supplied?.nodeType === 1 && supplied.ownerDocument === document) return supplied;
    return document?.querySelector?.('[data-train-panel]:not([hidden])') ?? null;
  }

  function finish(state, restoreFocus = false) {
    if (current !== state) return;
    clearTimer(state.timer);
    stopEffects(state);
    state.overlay?.remove();
    if (state.content && !state.wasInert) state.content.removeAttribute("inert");
    current = null;
    onPauseChange(false);
    const focus = state.previousFocus;
    if (restoreFocus && state.shown && focus?.isConnected && !focus.disabled
      && focus !== document.body && !focus.closest?.('[hidden], [inert]')) focus.focus?.();
    state.resolve(state.shown);
  }

  function resumeClock(state) {
    if (current !== state || !state.claimed || state.timer !== null || document.visibilityState === "hidden") return;
    state.overlay.hidden = false;
    state.overlay.classList.remove("is-paused");
    if (!state.shown) {
      state.shown = true;
      startMotion(state);
      rewardSound.play(state.receipt);
      // Move focus only when the game currently owns it. Menus remain usable.
      if (state.content?.contains?.(state.previousFocus)) state.skip.focus?.();
    }
    state.started = clock();
    state.targets.forEach(target => target.classList.remove("is-paused"));
    state.animations.forEach(animation => { try { animation.play(); } catch { /* Optional visual effect. */ } });
    state.timer = setTimer(() => finish(state), state.remaining);
  }

  function buildCelebration(state, receipt) {
    const reduced = Boolean(scope.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    const overlay = element("div", "caatuu-practice-celebration");
    overlay.classList.toggle("is-reduced-motion", reduced);
    overlay.hidden = true;
    const card = element("section", "caatuu-practice-celebration-card");
    const sparkles = element("div", "caatuu-practice-sparkles");
    sparkles.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 8; index++) sparkles.append(element("span", "caatuu-practice-sparkle"));
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-labelledby", "caatuuPracticeRewardTitle");
    const heading = element("h2", "caatuu-practice-celebration-title",
      translate("practice.set.complete", "Practice set complete"));
    heading.id = "caatuuPracticeRewardTitle";
    const message = element("p", "caatuu-practice-celebration-message",
      translate("practice.set.message", "A useful piece of practice, finished."));
    const rewards = element("div", "caatuu-practice-celebration-rewards");
    rewards.setAttribute("role", "status");
    rewards.setAttribute("aria-live", "polite");
    for (const kind of ["xp", "coins", "gems"]) {
      const amount = Math.max(0, Number(receipt[kind]) || 0);
      if (!amount) continue;
      const token = element("div", `caatuu-practice-reward caatuu-practice-reward-${kind}`);
      const art = element("img", "caatuu-practice-reward-art");
      art.setAttribute("aria-hidden", "true");
      art.src = kind === "xp" ? XP_ICON : kind === "coins" ? "/assets/icons/coin_icon_ui.png" : "/assets/icons/icon_gem.png";
      art.alt = "";
      const amountLabel = element("strong", "caatuu-practice-reward-amount", `+${amount}`);
      const label = element("span", "caatuu-practice-reward-label",
        translate(`practice.reward.${kind}`, kind === "xp" ? "XP" : kind === "coins" ? "Coins" : "Gems"));
      token.append(art, amountLabel, label);
      rewards.append(token);
      state.tokens.push({ kind, art });
    }
    const skip = element("button", "caatuu-practice-celebration-skip",
      translate("practice.reward.skip", "Continue"));
    skip.type = "button";
    skip.addEventListener("click", () => finish(state, true));
    card.append(sparkles, heading, message, rewards);
    const cycle = read()?.cycle;
    if (cycle) {
      const row = element("div", "caatuu-practice-cycle-progress");
      const icon = element("img");
      icon.src = "/assets/icons/icon_gem.png";
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      const progress = element("progress");
      const target = Math.max(1, Number(cycle.target) || 1);
      const completed = Number(receipt.gems) > 0;
      const sets = completed ? target : Math.min(target, Math.max(0, Number(cycle.sets) || 0));
      progress.max = target;
      progress.value = sets;
      progress.setAttribute("aria-label", translate("practice.gems.description", "Progress toward the next gem"));
      progress.setAttribute("aria-valuetext", translate("practice.cycle.progress", `${sets} / ${target} sets`, { ...cycle, sets, target }));
      row.classList.toggle("is-complete", completed);
      row.append(icon, progress);
      card.append(row);
    }
    card.append(skip);
    overlay.append(card);
    document.body.append(overlay);
    state.overlay = overlay;
    state.skip = skip;
    state.reduced = reduced;
    state.remaining = reduced ? REDUCED_MOTION_MS : CELEBRATION_MS;
  }

  function boundary(details = {}) {
    details ||= {};
    if (destroyed || !enabled || !document?.body || typeof learning?.claimPracticeSetReward !== "function") {
      return Promise.resolve(false);
    }
    if (current) return current.promise;
    const snapshot = details.practiceSet ?? read();
    const receipt = snapshot?.pending;
    refresh(snapshot);
    if (!receipt?.id) return Promise.resolve(false);
    const content = contentFor(details);
    const state = { content, receiptId: receipt.id, previousFocus: document.activeElement, wasInert: content?.hasAttribute("inert"),
      receipt, tokens: [], animations: new Set(), targets: new Set(), effectsTimers: [], reduced: false,
      claimed: false, shown: false, timer: null, overlay: null, started: 0, remaining: 0, resolve: null, promise: null };
    state.promise = new Promise(resolve => { state.resolve = resolve; });
    current = state;
    content?.setAttribute("inert", "");
    onPauseChange(true);
    Promise.resolve().then(() => {
      if (current !== state) return false;
      return learning.claimPracticeSetReward(receipt.id);
    }).then(claimed => {
      if (current !== state) return;
      if (!claimed) { finish(state); return; }
      state.claimed = true;
      buildCelebration(state, receipt);
      resumeClock(state);
    }).catch(() => finish(state));
    return state.promise;
  }

  function transition(event) {
    const details = event.detail ?? {};
    const key = details.container ?? details.content ?? details.sourceWindow;
    if (details.phase === "destroy") {
      transitions.delete(key);
      return;
    }
    if (!enabled || details.active === false) {
      transitions.delete(key);
      if (current) details.waitUntil?.(current.promise);
      return;
    }
    if (details.phase === "show" || details.phase === "hold") transitions.set(key, details);
    const panelId = contentFor(details)?.dataset?.trainPanel;
    const gameId = details.gameId ?? gameIds[panelId] ?? panelId;
    // The ledger checks for activity in this live game. Initial loaders cannot
    // settle saved incomplete effort, and repeated robot callbacks are harmless.
    if (gameId && details.phase !== "hide") learning?.completePracticeBoundary?.(gameId);
    const promise = current?.promise ?? (details.initial === true ? null : boundary(details));
    if (promise) details.waitUntil?.(promise);
    if (details.phase === "hide") transitions.delete(key);
  }

  listen(scope, "caatuu:practice-boundary", event => {
    const promise = boundary(event.detail);
    event.detail?.waitUntil?.(promise);
  });
  listen(scope, "caatuu:challenge-transition", transition);
  listen(document, "pointerdown", event => rewardSound.unlock(event), true);
  listen(document, "pointerup", event => rewardSound.unlock(event), true);
  listen(document, "keydown", event => rewardSound.unlock(event), true);
  listen(scope, "caatuu:learning-change", event => {
    if (event.detail?.reason === "progress-reset") {
      transitions.clear();
      if (current) finish(current);
      refresh(event.detail?.practiceSet ?? read());
      return;
    }
    const previousReceipt = lastSnapshot?.pending?.id;
    const snapshot = event.detail?.practiceSet ?? read();
    refresh(snapshot);
    // Some games journal completion immediately after showing the robot.
    // Wait for an earned receipt while that real transition is still visible.
    if (enabled && !current && snapshot?.pending?.id && snapshot.pending.id !== previousReceipt) {
      const details = [...transitions.values()].at(-1);
      if (details) boundary({ ...details, practiceSet: snapshot });
    }
  });
  listen(scope, "pagehide", () => {
    transitions.clear();
    if (current) finish(current);
  });
  listen(scope, "pageshow", () => refresh());
  listen(scope, "storage", event => {
    if (event.storageArea && event.storageArea !== scope.localStorage) return;
    const practiceKey = learning?.storage?.practiceStorageKey;
    const resetKey = learning?.storage?.performanceStorageKey
      ? `${learning.storage.performanceStorageKey}.reset` : null;
    const reset = event.key === null || (resetKey && event.key === resetKey);
    const relevant = reset || (practiceKey && (event.key === practiceKey || event.key?.startsWith(`${practiceKey}.`)));
    if (!relevant) return;
    const snapshot = read();
    if (reset) transitions.clear();
    if (current && (reset || (!current.claimed && snapshot?.pending?.id !== current.receiptId))) finish(current);
    refresh(snapshot);
  });
  listen(document, "visibilitychange", () => {
    const state = current;
    if (!state?.claimed) return;
    if (document.visibilityState === "hidden") {
      clearTimer(state.timer);
      if (state.timer !== null && state.shown) state.remaining = Math.max(0, state.remaining - (clock() - state.started));
      state.timer = null;
      rewardSound.stop();
      state.targets.forEach(target => target.classList.add("is-paused"));
      state.animations.forEach(animation => { try { animation.pause(); } catch { /* Optional visual effect. */ } });
      state.overlay.classList.add("is-paused");
    } else resumeClock(state);
  });
  listen(document, "keydown", event => {
    if (!current?.shown || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      finish(current, true);
    } else if (event.key === "Tab" && current.overlay?.contains(document.activeElement)) {
      event.preventDefault();
      current.skip.focus?.();
    }
  });
  refresh();
  return Object.freeze({
    boundary,
    unlockSound: event => rewardSound.unlock(event),
    refresh,
    setActive(value) {
      if (destroyed) return;
      enabled = Boolean(value);
      if (!enabled) {
        transitions.clear();
        if (current) finish(current);
      } else if (current?.content) {
        const previousPanel = current.content.closest?.("[data-train-panel]") ?? current.content;
        const selectedPanel = contentFor();
        if (selectedPanel && selectedPanel !== previousPanel) {
          transitions.clear();
          finish(current);
        }
      }
      refresh();
    },
    cancel() {
      transitions.clear();
      if (current) finish(current);
    },
    destroy() {
      if (destroyed) return;
      if (current) finish(current);
      destroyed = true;
      transitions.clear();
      listeners.splice(0).forEach(remove => remove());
      rewardSound.destroy();
      meter?.remove();
    },
    get active() { return Boolean(current); }
  });
}
