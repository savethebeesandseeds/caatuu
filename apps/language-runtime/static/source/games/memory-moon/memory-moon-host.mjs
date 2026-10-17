import { fetchDeclaredCourseGameJson } from '../course-game-content.mjs';
import { mountEmbeddedGameControls } from '../embedded-game-controls.mjs';
import { createMemoryMoonPractice } from './memory-moon-practice.mjs';
import { validateMemoryMoonCatalog, moonIllumination, moonShadePath } from './memory-moon-core.mjs';
import { createMoonRenderer } from './memory-moon-render.mjs';
import { createMoonSpeech } from './memory-moon-speech.mjs';
import { createMoonOrbit } from './memory-moon-orbit.mjs';
import { createMoonAdvance } from './memory-moon-advance.mjs';
import { createMoonPhase } from './memory-moon-phase.mjs';

/** Mount in the frame's document; persisted learning and speech belong to its shell. */
export async function mountMemoryMoon({ root, shell = globalThis,
  course = shell.CaatuuCourse, learning = shell.CaatuuLearning,
  fetchImpl = shell.fetch?.bind(shell), random = Math.random, campaign = false,
  active = true, services = {} } = {}) {
  const document = root?.ownerDocument, view = document?.defaultView;
  if (!view || !course || shell.location?.origin !== view.location?.origin) {
    throw new Error('Memory Moon requires a local root and a same-origin course shell.');
  }
  const runtimeHref = new URL(`${course.routePrefix}/index.html`, view.location.origin).href;
  const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const disposers = [];
  let destroyed = false, paused = false, pageActive = true, controlsOpen = false;
  let generation = 0, abort = null, pending = false, needsStart = true;
  let loading = true, error = false, snapshot = null, practice = null, packPromise = null;
  let shipCatalog = null, completed = false, completionReady = false;
  const running = () => !destroyed && active && !paused && pageActive && !document.hidden && !controlsOpen;
  const renderer = createMoonRenderer({ root, course, i18n: shell.CaatuuI18n, onAnswer: answer,
    onSpeak: text => { if (running() && !loading && snapshot?.phase === 'question') void speech.play(text); },
    onReplay: () => { void restart(); }
  });
  const phase = (services.createPhase || createMoonPhase)({
    draw: progress => renderer.shade.setAttribute('d', moonShadePath(progress)), reducedMotion,
    requestFrame: view.requestAnimationFrame?.bind(view), cancelFrame: view.cancelAnimationFrame?.bind(view),
    now: () => view.performance?.now?.() ?? Date.now()
  });
  const speech = (services.createSpeech || createMoonSpeech)({ api: shell.CaatuuChrome,
    onState: state => { if (!destroyed) renderer.syncSpeech(state); },
    onStart: () => {
      if (running() && !loading && snapshot?.phase === 'question') {
        const next = practice?.assist('audio');
        if (next) snapshot = next;
      }
    }
  });
  const orbit = (services.createOrbit || createMoonOrbit)({
    element: renderer.ship, image: renderer.shipImage, document, reducedMotion, random
  });
  const advance = (services.createAdvance || createMoonAdvance)({
    setTimer: view.setTimeout.bind(view), clearTimer: view.clearTimeout.bind(view),
    onAdvance() {
      if (!running() || !['answered', 'complete'].includes(snapshot?.phase)) return;
      void speech.stop();
      if (snapshot.phase === 'complete') completionReady = true;
      else snapshot = practice.advance();
      render();
      renderer.focusChoice();
    }
  });
  const controls = (services.mountControls || mountEmbeddedGameControls)({
    container: renderer.toolbar, shell, course,
    onOpenChange(open) {
      if (destroyed) return;
      controlsOpen = open;
      syncActivity();
    }
  });
  function listen(target, type, callback) {
    target?.addEventListener?.(type, callback);
    disposers.push(() => target?.removeEventListener?.(type, callback));
  }
  function render({ wrongChoiceId } = {}) {
    if (destroyed) return;
    renderer.render(snapshot, { wrongChoiceId, loading, error,
      interactive: running() && (snapshot?.phase !== 'complete' || completionReady),
      campaignMode: campaign, illumination: moonIllumination(snapshot?.progress || 0) });
    phase.set(snapshot?.progress || 0);
    if (snapshot?.phase === 'complete' && completionReady && !completed && running()) {
      completed = true;
      shell.postMessage?.({ source: 'caatuu-game', type: 'round-complete', gameId: 'memory-moon' }, view.location.origin);
    }
  }
  function cancelSelection() {
    if (!pending) return;
    generation += 1;
    abort?.abort();
    abort = null;
    practice?.cancelPending?.();
    pending = false;
    needsStart = true;
  }
  function syncActivity() {
    if (destroyed) return;
    const enabled = running();
    if (enabled) {
      orbit.resume();
      phase.resume();
      advance.resume();
      if (needsStart && !pending) void begin();
    } else {
      cancelSelection();
      orbit.pause();
      phase.pause();
      advance.pause();
      void speech.stop();
    }
    render();
  }
  function answer(choiceId) {
    if (!running() || loading || snapshot?.phase !== 'question') return;
    void speech.stop();
    const previous = snapshot, current = generation;
    const next = practice.answer(choiceId);
    // Evidence listeners may reset progress synchronously during the answer.
    if (destroyed || current !== generation) return;
    snapshot = next;
    // Generation changes are also fenced inside the evidence owner.
    if (snapshot?.saveStatus === 'stale') { void restart(); return; }
    const wrong = snapshot?.phase === 'question' && snapshot !== previous
      && snapshot.wrongChoiceIds?.includes(choiceId);
    render({ wrongChoiceId: wrong ? choiceId : null });
    if (['answered', 'complete'].includes(snapshot?.phase)) advance.schedule();
    else if (wrong) renderer.focusChoice();
  }
  async function loadPack() {
    if (!packPromise) {
      packPromise = Promise.resolve().then(async () => {
        const result = await (services.loadCatalog || fetchDeclaredCourseGameJson)(course, {
          gameId: 'memory-moon', resourceName: 'memoryMoonCatalog', runtimeHref, fetchImpl
        });
        const pack = result.document;
        validateMemoryMoonCatalog(pack, { course });
        return pack;
      }).catch(failure => { packPromise = null; throw failure; });
    }
    return packPromise;
  }
  async function begin() {
    if (destroyed || pending || !needsStart || !running()) return;
    const current = ++generation;
    abort = new (view.AbortController || globalThis.AbortController)();
    const signal = abort.signal;
    pending = true;
    needsStart = false;
    loading = true;
    error = false;
    render();
    const valid = () => !destroyed && current === generation && running() && !signal.aborted;
    try {
      const pack = await loadPack();
      if (!valid()) return;
      if (!practice) practice = (services.createPractice || createMemoryMoonPractice)({
        course, learning, pack, runtimeHref, random
      });
      await practice.startRound({ difficulty: learning?.difficulty?.(), signal });
      if (!valid()) return;
      snapshot = practice.snapshot();
      if (!snapshot) throw new Error('Memory Moon did not produce a session.');
      loading = false;
      pending = false;
      abort = null;
      orbit.select(shipCatalog);
      phase.set(snapshot.progress || 0, { immediate: true });
      render();
    } catch (failure) {
      if (!valid()) return;
      pending = false;
      abort = null;
      loading = false;
      error = true;
      render();
    }
  }
  async function restart() {
    if (destroyed) return;
    generation += 1;
    abort?.abort();
    abort = null;
    practice?.cancelPending?.();
    pending = false;
    needsStart = true;
    loading = true;
    error = false;
    snapshot = null;
    completed = false;
    completionReady = false;
    advance.cancel();
    void speech.stop();
    phase.set(0, { immediate: true });
    render();
    await begin();
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    generation += 1;
    abort?.abort();
    practice?.dispose();
    advance.destroy();
    phase.destroy();
    orbit.destroy();
    controls.destroy();
    void speech.destroy();
    disposers.forEach(dispose => dispose());
    renderer.destroy();
  }
  listen(document, 'visibilitychange', syncActivity);
  listen(view, 'pagehide', () => { pageActive = false; syncActivity(); });
  listen(view, 'pageshow', () => { pageActive = true; syncActivity(); });
  listen(shell, 'caatuu:learning-change', event => {
    if (['progress-reset', 'difficulty'].includes(event.detail?.reason)) void restart();
  });
  // Decoration is optional and never blocks content or evidence readiness.
  if (typeof fetchImpl === 'function') void Promise.resolve().then(() => fetchImpl(
    new URL('/assets/ships/meta.json', view.location.origin).href,
    { credentials: 'same-origin', headers: { Accept: 'application/json' } }
  )).then(response => response?.ok ? response.json() : null).then(catalog => {
    if (destroyed) return;
    shipCatalog = catalog;
    if (snapshot && !loading) orbit.select(shipCatalog);
  }).catch(() => {});
  const controller = { restart, destroy, dispose: destroy,
    setActive(value) { if (!destroyed && active !== Boolean(value)) { active = Boolean(value); syncActivity(); } },
    setPaused(value) { if (!destroyed && paused !== Boolean(value)) { paused = Boolean(value); syncActivity(); } },
    setCampaign(value) {
      if (destroyed) return;
      const entering = !campaign && Boolean(value);
      campaign = Boolean(value);
      // A completed free-play or cancelled campaign moon cannot own a new boundary.
      if (entering && snapshot?.phase === 'complete') { void restart(); return; }
      render();
    },
    snapshot: () => snapshot,
    ready: null
  };
  controller.ready = restart();
  syncActivity();
  return controller;
}
