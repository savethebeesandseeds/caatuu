/**
 * One cancellable feedback delay. The host schedules only answered questions.
 * Resuming gives feedback a fresh full delay after a hidden or paused page.
 */
export function createMoonAdvance({
  onAdvance, delayMs = 2000, setTimer = setTimeout, clearTimer = clearTimeout
} = {}) {
  if (typeof onAdvance !== 'function') throw new TypeError('Memory Moon needs an advance callback.');
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new TypeError('Advance delay must be nonnegative.');
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    throw new TypeError('Memory Moon needs timer functions.');
  }

  let timer = null;
  let generation = 0;
  let pending = false;
  let paused = false;
  let destroyed = false;
  const state = () => ({ pending, paused, destroyed });

  function clear() {
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function arm() {
    const request = generation;
    timer = setTimer(() => {
      if (destroyed || paused || !pending || request !== generation) return;
      timer = null;
      pending = false;
      generation += 1;
      onAdvance();
    }, delayMs);
  }

  function schedule() {
    if (destroyed) return;
    clear();
    pending = true;
    if (!paused) arm();
  }

  function cancel() {
    clear();
    pending = false;
  }

  function pause() {
    if (destroyed || paused) return;
    paused = true;
    clear();
  }

  function resume() {
    if (destroyed || !paused) return;
    paused = false;
    if (pending) arm();
  }

  function destroy() {
    if (destroyed) return;
    cancel();
    destroyed = true;
  }

  return { schedule, cancel, pause, resume, destroy, state };
}
