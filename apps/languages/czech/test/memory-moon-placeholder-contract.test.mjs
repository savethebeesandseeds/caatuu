import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../static/", import.meta.url);
const [index, app, styles, serviceWorker, chrome] = await Promise.all([
  readFile(new URL("index.html", staticRoot), "utf8"),
  readFile(new URL("app.js", staticRoot), "utf8"),
  readFile(new URL("app.css", staticRoot), "utf8"),
  readFile(new URL("sw.js", staticRoot), "utf8"),
  readFile(new URL("chrome.js", staticRoot), "utf8"),
]);

test("Memory Moon remains a static application placeholder", () => {
  assert.match(index, /data-train-tab="memory-moon"/);
  assert.match(index, /id="trainPanelMemoryMoon"/);
  assert.match(index, /A smaller orbit for recall games will live here\./);
  assert.match(index, /<div class="memory-moon-stage">[\s\S]*planet_C\.png[\s\S]*Coming next/);
  assert.match(chrome, /"memory-moon": \{[\s\S]*title: "Memory Moon"/);
});

test("the application contains no executable Memory Moon game host", () => {
  const applicationSources = `${index}\n${app}\n${styles}\n${serviceWorker}`;
  assert.doesNotMatch(applicationSources, /memoryMoonGame|memoryMoonStatus/);
  assert.doesNotMatch(applicationSources, /ensureMemoryMoonLoaded/);
  assert.doesNotMatch(applicationSources, /caatuu-memory-moon/);
  assert.doesNotMatch(applicationSources, /\/games\/memory-moon/);
  assert.doesNotMatch(index, /<iframe[^>]*(?:memory-moon|caatuu-game)/i);
});
