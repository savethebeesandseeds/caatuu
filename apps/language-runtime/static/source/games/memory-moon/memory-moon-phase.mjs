// A reward tween retains its displayed phase when the game is paused.
export function createMoonPhase({ draw, durationMs = 1200, reducedMotion,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
  if (typeof draw !== 'function' || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new TypeError('Memory Moon needs a drawing callback and a positive duration.');
  }
  let displayed = 0, target = 0, from = 0, elapsed = 0, started = null;
  let frame = null, generation = 0, paused = false, destroyed = false;
  const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
  function cancel() {
    generation += 1;
    if (frame !== null) cancelFrame?.(frame);
    frame = null;
  }
  function sample(time) {
    const fraction = Math.min(1, Math.max(0, elapsed + (started === null ? 0 : time - started)) / durationMs);
    const eased = fraction * fraction * (3 - 2 * fraction);
    displayed = from + (target - from) * eased;
    draw(displayed);
    return fraction === 1;
  }
  function arm() {
    if (destroyed || paused || displayed === target || frame !== null) return;
    if (reducedMotion?.matches || typeof requestFrame !== 'function') {
      displayed = target;
      draw(displayed);
      return;
    }
    started = now();
    const current = generation;
    function tick(time) {
      if (current !== generation || destroyed || paused) return;
      frame = null;
      if (sample(time)) { started = null; elapsed = durationMs; return; }
      frame = requestFrame(tick);
    }
    frame = requestFrame(tick);
  }
  function set(value, { immediate = false } = {}) {
    if (destroyed) return;
    const next = clamp(value);
    if (!immediate && next === target) return;
    cancel();
    target = next;
    from = displayed;
    elapsed = 0;
    started = null;
    if (immediate || reducedMotion?.matches) { displayed = target; draw(displayed); }
    else arm();
  }
  function pause() {
    if (destroyed || paused) return;
    if (started !== null) {
      const time = now();
      sample(time);
      elapsed = Math.min(durationMs, elapsed + Math.max(0, time - started));
      started = null;
    }
    paused = true;
    cancel();
  }
  function resume() { if (!destroyed && paused) { paused = false; arm(); } }
  const motionChange = () => {
    if (reducedMotion?.matches && !destroyed) set(target, { immediate: true });
  };
  reducedMotion?.addEventListener?.('change', motionChange);
  draw(displayed);
  return { set, pause, resume,
    state: () => ({ displayed, target, paused, destroyed }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancel();
      reducedMotion?.removeEventListener?.('change', motionChange);
    }
  };
}
