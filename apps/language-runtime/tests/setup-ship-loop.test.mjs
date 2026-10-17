import assert from "node:assert/strict";
import test from "node:test";
import { initializeSetupShipLoop } from "../static/source/course-setup.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const LAST_SHIP = "caatuu.setup.last-ship.v1";

function mount({ count = 4, reducedMotion = false, storage, random = () => 0.25 } = {}) {
  const app = createBrowserHarness();
  const { document, window } = app;
  document.hidden = false;
  const ships = Array.from({ length: count }, (_, index) => {
    const image = document.createElement("img");
    image.setAttribute("data-setup-ship", "");
    image.src = `/assets/setup-ship-${index}.png`;
    document.body.append(image);
    return image;
  });
  const decoration = document.createElement("img");
  document.body.append(decoration);
  const timers = new Map();
  const mediaListeners = new Set();
  const visibilityListeners = new Set();
  const originalAdd = document.addEventListener;
  const originalRemove = document.removeEventListener;
  document.addEventListener = (type, callback) => {
    if (type === "visibilitychange") visibilityListeners.add(callback);
    originalAdd(type, callback);
  };
  document.removeEventListener = (type, callback) => {
    if (type === "visibilitychange") visibilityListeners.delete(callback);
    originalRemove(type, callback);
  };
  const media = {
    matches: reducedMotion,
    addEventListener(type, callback) {
      assert.equal(type, "change");
      mediaListeners.add(callback);
    },
    removeEventListener(type, callback) {
      assert.equal(type, "change");
      mediaListeners.delete(callback);
    },
  };
  let sequence = 0;
  Object.assign(window, {
    sessionStorage: storage || app.sessionStorage,
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    matchMedia(query) {
      assert.equal(query, "(prefers-reduced-motion: reduce)");
      return media;
    },
  });
  const dispose = initializeSetupShipLoop(window, { random, intervalMs: 100 });
  return {
    ...app, ships, timers, mediaListeners, visibilityListeners, decoration, dispose,
    current() {
      const visible = ships.filter(image => !image.hidden);
      assert.equal(visible.length, 1, "exactly one spaceship is visible");
      return visible[0].getAttribute("src");
    },
    tick() {
      assert.equal(timers.size, 1, "the loop uses one timer");
      const [id, timer] = [...timers][0];
      assert.equal(timer.delay, 100, "the injected interval controls rotation");
      timers.delete(id);
      timer.callback();
    },
    visibility(hidden) {
      document.hidden = hidden;
      document.visibilityState = hidden ? "hidden" : "visible";
      document.dispatchEvent({ type: "visibilitychange" });
    },
    motion(reduce) {
      media.matches = reduce;
      for (const callback of mediaListeners) callback({ matches: reduce });
    },
  };
}

test("spaceships rotate through complete shuffled sets without adjacent repeats", t => {
  let seed = 713;
  const app = mount({ random: () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  } });
  t.after(app.dispose);
  const seen = [app.current()];
  for (let index = 0; index < app.ships.length * 3 - 1; index++) {
    app.tick();
    seen.push(app.current());
  }
  for (let index = 0; index < seen.length; index += app.ships.length) {
    assert.equal(new Set(seen.slice(index, index + app.ships.length)).size, app.ships.length,
      "every spaceship is shown once before the next set");
  }
  for (let index = 1; index < seen.length; index++) {
    assert.notEqual(seen[index], seen[index - 1], "cycle boundaries also avoid repeated artwork");
  }
  assert.equal(app.decoration.hidden, false, "unrelated artwork is untouched");
});

test("reopening setup avoids the last displayed spaceship, including after a rotation", t => {
  const app = mount();
  app.tick();
  const previous = app.current();
  assert.equal(app.window.sessionStorage.getItem(LAST_SHIP), previous);
  app.dispose();
  const reopened = mount({ storage: app.window.sessionStorage });
  t.after(reopened.dispose);
  assert.notEqual(reopened.current(), previous);
  assert.equal(reopened.window.sessionStorage.getItem(LAST_SHIP), reopened.current());
});

test("a hidden page pauses rotation and resumes with a single timer", t => {
  const app = mount();
  t.after(app.dispose);
  const before = app.current();
  const stale = [...app.timers.values()][0].callback;
  app.visibility(true);
  assert.equal(app.timers.size, 0);
  stale();
  assert.equal(app.current(), before, "a callback queued before the pause cannot rotate artwork");
  assert.equal(app.timers.size, 0);
  app.visibility(false);
  app.visibility(false);
  assert.equal(app.timers.size, 1);
  app.tick();
  assert.notEqual(app.current(), before);
});

test("reduced motion keeps one static ship and responds to preference changes", t => {
  const app = mount({ reducedMotion: true });
  t.after(app.dispose);
  const initial = app.current();
  assert.equal(app.timers.size, 0);
  app.visibility(true);
  app.visibility(false);
  assert.equal(app.timers.size, 0, "visibility cannot override reduced motion");
  app.motion(false);
  assert.equal(app.timers.size, 1);
  app.tick();
  assert.notEqual(app.current(), initial);
  const before = app.current();
  const stale = [...app.timers.values()][0].callback;
  app.motion(true);
  assert.equal(app.timers.size, 0);
  stale();
  assert.equal(app.current(), before);
  assert.equal(app.timers.size, 0);
});

test("disposing removes listeners and prevents queued callbacks from restarting the loop", () => {
  const app = mount();
  const before = app.current();
  const stale = [...app.timers.values()][0].callback;
  assert.equal(app.visibilityListeners.size, 1);
  assert.equal(app.mediaListeners.size, 1);
  app.dispose();
  app.dispose();
  assert.equal(app.timers.size, 0);
  assert.equal(app.visibilityListeners.size, 0);
  assert.equal(app.mediaListeners.size, 0);
  stale();
  app.visibility(false);
  app.motion(false);
  assert.equal(app.current(), before);
  assert.equal(app.timers.size, 0);
});

test("the artwork loop works when session storage is unavailable", t => {
  const app = mount({ storage: {
    getItem() { throw new Error("Storage unavailable"); },
    setItem() { throw new Error("Storage unavailable"); },
  } });
  t.after(app.dispose);
  const initial = app.current();
  app.tick();
  assert.notEqual(app.current(), initial);
});

test("zero or one spaceship never starts a rotation timer", t => {
  for (const count of [0, 1]) {
    const app = mount({ count });
    t.after(app.dispose);
    assert.equal(typeof app.dispose, "function");
    assert.equal(app.timers.size, 0);
    if (count) app.current();
  }
});
