import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { FeedbackOutbox } from "../../../language-runtime/static/source/feedback-outbox.mjs";
import { buildDictionaryGapReport } from "../../../languages/czech/static/source/features/dictionary/dictionary-gap-report.mjs";

const root = new URL("../../../languages/czech/static/", import.meta.url);
const [profile, rawSource] = await Promise.all([
  readFile(new URL("source/shared/course-profile.js", root), "utf8"),
  readFile(new URL("source/shared/runtime.js", root), "utf8")
]);
const source = rawSource.replace(/import\("([^"]+)"\)/gu, (original, path) => {
  if (path.includes("/feedback-outbox.mjs")) return "Promise.resolve(__outbox)";
  if (path.includes("/dictionary-gap-report.mjs")) return "Promise.resolve(__dictionary)";
  return original;
});
const gap = { targetWord: "Řekněme", normalizedWord: "řekněme", dictionaryKey: "kaikki-cs-en-2026-07-09",
  dictionaryDirection: "cs-en", lookupOutcome: "no_results", lookupReturned: 0 };

function standalone(native) {
  const old = JSON.stringify([{ id: "legacy", payload: buildDictionaryGapReport(gap) }]);
  const values = new Map([["caatuu.dictionaryGapOutbox.v1", old], ["caatuu.dictionaryGapOutbox.v1.item.legacy", old]]);
  const storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  const events = new Map(), documentEvents = new Map(), timers = [], requests = [], nativeRequests = [];
  const window = { location: { hostname: native ? "caatuu.local" : "caatuu.waajacu.com", origin: "https://caatuu.waajacu.com",
      href: "https://caatuu.waajacu.com/cz/case-cosmos.html" }, localStorage: storage,
    WebAssembly, addEventListener: (name, callback) => events.set(name, callback),
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {},
    dispatchEvent() {}, CustomEvent: class { constructor(type) { this.type = type; } } };
  window.parent = window;
  if (native) window.CaatuuAndroid = { postMessage: payload => nativeRequests.push(payload) };
  const document = { visibilityState: "visible", addEventListener: (name, callback) => documentEvents.set(name, callback) };
  const context = { window, document, navigator: { onLine: true }, URL, Response, AbortController, DOMException, WebAssembly,
    __outbox: { FeedbackOutbox }, __dictionary: { buildDictionaryGapReport },
    fetch: async (...args) => { requests.push(args); throw new Error("Unexpected legacy remote report."); } };
  runInNewContext(profile, context, { filename: "course-profile.js" });
  runInNewContext(source, context, { filename: "runtime.js" });
  return { window, values, old, events, documentEvents, timers, requests, nativeRequests };
}

for (const native of [false, true]) test("retained " + (native ? "native" : "browser") + " reporting is local-only and never migrates old queues on lifecycle events", async () => {
  const app = standalone(native);
  app.events.get("online")?.();
  app.documentEvents.get("visibilitychange")?.();
  for (const callback of [...app.timers]) await callback();
  assert.equal(app.requests.length, 0);
  assert.equal(app.nativeRequests.length, 0);
  assert.equal(app.values.size, 2, "startup/lifecycle must not initialize or migrate reporting queues");
  assert.equal(app.values.get("caatuu.dictionaryGapOutbox.v1"), app.old);
  const queued = await app.window.CaatuuRuntime.maintenance.enqueueDictionaryGap(gap);
  assert.equal(queued.queued, true);
  assert.equal(queued.pending, 1);
  assert.equal(queued.localOnly, true);
  assert.equal(queued.automaticDelivery, false);
  const flushed = await app.window.CaatuuRuntime.maintenance.flushDictionaryGaps();
  assert.equal(flushed.paused, true);
  assert.equal(flushed.disabled, true);
  assert.equal(flushed.localOnly, true);
  assert.equal(app.values.get("caatuu.dictionaryGapOutbox.v1"), app.old);
  assert.equal(app.values.get("caatuu.dictionaryGapOutbox.v1.item.legacy"), app.old);
  assert.equal(app.values.has("caatuu.dictionaryGapMigration.v1"), false);
  const diagnostic = await app.window.CaatuuRuntime.maintenance.enqueueReport({ kind: "setup_attention", message: "device-local" });
  assert.equal(diagnostic.localOnly, true);
  assert.equal((await app.window.CaatuuRuntime.maintenance.flushReports()).paused, true);
  assert.equal(app.requests.length, 0);
  assert.equal(app.nativeRequests.length, 0);
});
