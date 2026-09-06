import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { mountRobotLoadingScreen } from "../static/source/games/embedded-game-controls.mjs";

function fixture({ hidden = false, active = true, fallback = false } = {}) {
  const { document, window } = createBrowserHarness();
  const container = document.createElement("section");
  container.hidden = hidden;
  document.body.append(container);
  const image = fallback ? document.createElement("img") : null;
  if (image) container.append(image);
  let time = 0;
  let serial = 0;
  const timers = new Map();
  window.performance = { now: () => time };
  window.setTimeout = (callback, delay) => {
    const id = ++serial;
    timers.set(id, { callback, at: time + delay });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  function advance(milliseconds) {
    const until = time + milliseconds;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      time = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    time = until;
  }
  const loader = mountRobotLoadingScreen({ container, label: "Preparing the game", active });
  return { container, loader, image, timers, advance };
}

test("the shared robot loader preserves initial visibility and reuses static fallback artwork", () => {
  const { container, loader, image } = fixture({ hidden: true, fallback: true });
  assert.equal(container.hidden, true);
  assert.equal(container.getAttribute("role"), "status");
  assert.equal(container.getAttribute("aria-label"), "Preparing the game");
  assert.equal(container.querySelectorAll("img").length, 1);
  assert.equal(container.querySelector("img"), image);
  assert.equal(image.getAttribute("src"), "/assets/robots/robot%20(1).png");
  assert.equal(image.getAttribute("alt"), "");
  assert.equal(image.getAttribute("aria-hidden"), "true");
  assert.ok(image.classList.contains("caatuu-game-robot-loading-art"));
  loader.show();
  assert.equal(container.hidden, false);
  loader.destroy();
});

test("minimum visibility counts time already shown without waiting for artwork load", async () => {
  const { loader, advance, timers } = fixture();
  advance(400);
  let ready = false;
  const waiting = loader.minimumVisible(1000).then(() => { ready = true; });
  loader.show();
  advance(599);
  await Promise.resolve();
  assert.equal(ready, false);
  advance(1);
  await waiting;
  assert.equal(ready, true);
  assert.equal(timers.size, 0);
  loader.destroy();
});

test("inactive screens pause the blink and minimum-visible clock", async () => {
  const { loader, container, advance, timers } = fixture({ active: false });
  let ready = false;
  const waiting = loader.minimumVisible(1000).then(() => { ready = true; });
  assert.equal(container.dataset.active, "false");
  assert.equal(timers.size, 0);
  advance(3000);
  loader.setActive(true);
  advance(400);
  loader.setActive(false);
  advance(5000);
  await Promise.resolve();
  assert.equal(ready, false);
  loader.setActive(true);
  assert.equal(container.dataset.active, "true");
  advance(599);
  await Promise.resolve();
  assert.equal(ready, false);
  advance(1);
  await waiting;
  loader.destroy();
});

test("hiding resolves concurrent waits and starts a fresh clock on the next appearance", async () => {
  const { loader, container, advance, timers } = fixture();
  const waits = [loader.minimumVisible(1000), loader.minimumVisible(2000)];
  advance(200);
  loader.hide();
  await Promise.all(waits);
  assert.equal(container.hidden, true);
  assert.equal(timers.size, 0);
  await loader.minimumVisible(1000);
  advance(5000);
  loader.show();
  let ready = false;
  const waiting = loader.minimumVisible(1000).then(() => { ready = true; });
  advance(999);
  await Promise.resolve();
  assert.equal(ready, false);
  advance(1);
  await waiting;
  loader.destroy();
});

test("destroy cancels pending timers and later calls cannot show or delay the screen", async () => {
  const { loader, container, advance, timers } = fixture();
  const waiting = loader.minimumVisible(1000);
  loader.destroy();
  loader.destroy();
  await waiting;
  loader.show();
  loader.setActive(true);
  advance(5000);
  await loader.minimumVisible(1000);
  assert.equal(container.hidden, true);
  assert.equal(timers.size, 0);
});

test("shared loader CSS centers its static fallback and uses the standard reduced-motion-aware blink", async () => {
  const css = await readFile(new URL("../static/styles/games/embedded-game-controls.css", import.meta.url), "utf8");
  const screen = /\.caatuu-game-robot-loading\s*\{([^}]*)\}/u.exec(css)?.[1];
  assert.match(screen, /position:\s*absolute/u);
  assert.match(screen, /inset:\s*0/u);
  assert.match(screen, /place-items:\s*center/u);
  assert.match(css, /animation:\s*caatuu-game-robot-blink 1\.6s/u);
  assert.match(css, /0%, 100%\s*\{\s*opacity:\s*\.42/u);
  assert.match(css, /50%\s*\{\s*opacity:\s*\.6/u);
  assert.match(css, /\[data-active="false"\][^{]*\{\s*animation-play-state:\s*paused/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.caatuu-game-robot-loading-art\s*\{\s*animation:\s*none/u);
});
