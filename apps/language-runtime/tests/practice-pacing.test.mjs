import assert from "node:assert/strict";
import test from "node:test";
import { afterInteractionPaint, createReviewContinuation } from "../static/source/games/practice-pacing.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

function interactionClock({ frames = true } = {}) {
  const pendingFrames = new Map(), pendingTasks = new Map();
  let serial = 0;
  const scope = {
    setTimeout(callback) { const id = serial++; pendingTasks.set(id, callback); return id; },
    clearTimeout(id) { pendingTasks.delete(id); }
  };
  if (frames) Object.assign(scope, {
    requestAnimationFrame(callback) { const id = serial++; pendingFrames.set(id, callback); return id; },
    cancelAnimationFrame(id) { pendingFrames.delete(id); }
  });
  function flush(queue) { const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(callback => callback()); }
  return { scope, frames: () => flush(pendingFrames), tasks: () => flush(pendingTasks) };
}

test("optional interaction work yields through a paint opportunity before running", async () => {
  const clock = interactionClock();
  let calls = 0;
  afterInteractionPaint(clock.scope, () => { calls++; });
  await Promise.resolve();
  assert.equal(calls, 0, "microtasks must not start audio ahead of selected-state paint");
  clock.frames();
  assert.equal(calls, 0, "animation-frame callbacks themselves run before paint");
  clock.tasks();
  assert.equal(calls, 1);
  clock.frames(); clock.tasks();
  assert.equal(calls, 1);
});

for (const phase of ["before-frame", "before-task", "no-frame-api"]) {
  test(`cancelled interaction work cannot run ${phase}`, () => {
    const clock = interactionClock({ frames: phase !== "no-frame-api" });
    let calls = 0;
    const cancel = afterInteractionPaint(clock.scope, () => { calls++; });
    if (phase === "before-task") clock.frames();
    cancel(); cancel();
    clock.frames(); clock.tasks();
    assert.equal(calls, 0);
  });
}

test("nonvisual hosts retain asynchronous optional work without an animation-frame API", () => {
  const clock = interactionClock({ frames: false });
  let calls = 0;
  afterInteractionPaint(clock.scope, () => { calls++; });
  assert.equal(calls, 0);
  clock.tasks();
  assert.equal(calls, 1);
});

test("review waits for its localized native button and consumes a review only once", () => {
  const { document } = createBrowserHarness();
  const button = document.createElement("button");
  document.body.append(button);
  let advances = 0;
  const review = createReviewContinuation({ button, onContinue: () => advances++,
    i18n: { t: () => "Continuar" } });
  assert.equal(button.hidden, true);
  review.show();
  review.sync();
  assert.equal(button.textContent, "Continuar");
  assert.equal(review.pending, true);
  assert.equal(advances, 0);
  button.click(); button.click();
  assert.equal(advances, 1);
  assert.equal(button.hidden, true);
  review.show(); button.click();
  assert.equal(advances, 2);
});

test("inactive, reset and destroyed reviews cannot be released by queued input", () => {
  const { document } = createBrowserHarness();
  const button = document.createElement("button"); document.body.append(button);
  let active = true, advances = 0;
  const review = createReviewContinuation({ button, canContinue: () => active,
    onContinue: () => advances++ });
  review.show(); active = false;
  button.dispatchEvent({ type: "click" });
  assert.equal(advances, 0, "the click guard rechecks activity even before a UI sync");
  review.sync(); assert.equal(button.disabled, true);
  active = true; review.sync(); button.click();
  assert.equal(advances, 1);
  review.show(); review.clear(); button.dispatchEvent({ type: "click" });
  review.show(); review.destroy(); button.dispatchEvent({ type: "click" });
  review.show();
  assert.equal(advances, 1);
  assert.equal(review.pending, false);
});

test("holding Enter or Space cannot repeat through learning reviews", () => {
  const { document } = createBrowserHarness();
  const button = document.createElement("button"); document.body.append(button);
  const review = createReviewContinuation({ button, onContinue() {} });
  review.show();
  for (const key of ["Enter", " "]) {
    const event = { type: "keydown", key, repeat: true };
    button.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }
  assert.equal(review.pending, true);
});

test("a double click cannot consume a second review synchronously shown by Continue", () => {
  const { document } = createBrowserHarness();
  const button = document.createElement("button"); document.body.append(button);
  let advances = 0;
  const review = createReviewContinuation({ button, onContinue() { advances++; review.show(); } });
  review.show();
  button.dispatchEvent({ type: "click", detail: 1 });
  button.dispatchEvent({ type: "click", detail: 2 });
  assert.equal(advances, 1); assert.equal(review.pending, true);
  button.dispatchEvent({ type: "click", detail: 1 });
  assert.equal(advances, 2);
});
