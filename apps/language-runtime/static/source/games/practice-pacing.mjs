export function preventRepeatedReviewKey(event) {
  if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
}

/** Learning feedback has no deadline. Only its native Continue button releases it. */
export function createReviewContinuation({ button, canContinue = () => true, onContinue, i18n } = {}) {
  let pending = false;
  let destroyed = false;
  if (!button || typeof onContinue !== "function") throw new TypeError("Review needs a button and continuation.");
  button.type = "button";
  button.setAttribute("data-caatuu-review-continue", "");
  const label = i18n?.t?.("common.continue");
  button.textContent = label && label !== "common.continue" ? label : "Continue";
  function sync() {
    button.hidden = !pending;
    button.disabled = destroyed || !pending || !canContinue();
  }
  function clear() { pending = false; sync(); }
  function activate(event) {
    if (destroyed || !pending || event.detail > 1 || !canContinue()) return;
    // Consume before invoking application code: synchronous renders and repeated
    // clicks cannot release this same review twice.
    clear();
    onContinue();
  }
  button.addEventListener("click", activate);
  button.addEventListener("keydown", preventRepeatedReviewKey);
  sync();
  return Object.freeze({
    show() { if (!destroyed) { pending = true; sync(); } },
    clear,
    sync,
    destroy() {
      destroyed = true;
      clear();
      button.removeEventListener("click", activate);
      button.removeEventListener("keydown", preventRepeatedReviewKey);
    },
    get pending() { return pending; }
  });
}

/** Let selected state paint before starting optional audio or other tap work. */
export function afterInteractionPaint(scope, callback) {
  let cancelled = false, frame = null, timer = null;
  const schedule = () => {
    frame = null;
    if (cancelled) return;
    timer = scope.setTimeout(() => {
      timer = null;
      if (!cancelled) callback();
    }, 0);
  };
  if (typeof scope.requestAnimationFrame === "function") frame = scope.requestAnimationFrame(schedule);
  else schedule();
  return () => {
    cancelled = true;
    if (frame !== null) scope.cancelAnimationFrame?.(frame);
    if (timer !== null) scope.clearTimeout(timer);
    frame = timer = null;
  };
}
