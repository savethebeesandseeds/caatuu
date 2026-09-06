import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  catalogInspectorMessages,
  mountDictionaryInspector,
  mountVerbDifficulty
} from "../static/source/developer-tools/catalog-inspectors.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";

function t(id, parameters = {}) {
  assert.equal(typeof catalogInspectorMessages[id], "string", `Undeclared message: ${id}`);
  return catalogInspectorMessages[id].replace(/\{(\w+)\}/gu, (_match, key) => {
    assert.ok(Object.hasOwn(parameters, key), `Missing ${id} parameter: ${key}`);
    return String(parameters[key]);
  });
}

const packageNames = ["czech", "mandarin-simplified", "spanish"];
const courses = await Promise.all(packageNames.map(async (name) => {
  const window = {};
  const profile = await readFile(new URL(`../../languages/${name}/static/source/shared/course-profile.js`, import.meta.url), "utf8");
  vm.runInNewContext(profile, { window });
  const course = window.CaatuuCourse;
  const readResource = (path) => readFile(new URL(`../../languages/${name}/static/${path.split("?", 1)[0]}`, import.meta.url), "utf8");
  return { name, course, readResource };
}));

function harnessFor(course, fetchImpl) {
  const harness = createBrowserHarness({ course, localStorageValues: { progress: "preserved" } });
  const root = harness.document.createElement("div");
  harness.document.body.append(root);
  const requests = [];
  const host = {
    ...harness.window,
    AbortController,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return fetchImpl(url, options);
    }
  };
  return { ...harness, root, host, course, requests, t };
}

function syntheticCourse(overrides = {}) {
  return {
    id: "ar",
    routePrefix: "/ar",
    sourceLanguage: { id: "en", locale: "en", label: "English" },
    targetLanguage: { id: "ar", locale: "ar", label: "Arabic" },
    gameContent: { "verb-lab": { verbNebulaCatalog: "data/verbs.json" } },
    dictionaryContent: { coreEntries: "data/core.json" },
    ...overrides
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setControl(root, selector, value, type = "change") {
  const control = root.querySelector(selector);
  assert.ok(control, `Missing control: ${selector}`);
  control.value = value;
  control.dispatchEvent({ type });
  return control;
}

for (const { name, course, readResource } of courses) {
  test(`verb inspector reads the declared ${name} catalog without altering the active course`, async () => {
    const path = course.gameContent["verb-lab"].verbNebulaCatalog;
    const catalog = JSON.parse(await readResource(path));
    const harness = harnessFor(course, async () => Response.json(catalog));
    const snapshot = JSON.stringify(course);
    const cleanup = await mountVerbDifficulty(harness);
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].url, `https://caatuu.test${course.routePrefix}/${path}`);
    assert.equal(harness.requests[0].options.redirect, "error");
    assert.ok(harness.root.querySelectorAll("[data-verb-id]").length > 30);
    assert.ok(harness.root.querySelector('[data-difficulty="1"]'));
    assert.ok(harness.root.querySelector('[data-difficulty="2"]'));
    assert.ok(harness.root.querySelector('[data-difficulty="3"]'));
    const target = harness.root.querySelector("tbody td");
    assert.equal(target.lang, course.targetLanguage.locale);
    assert.ok(catalog.some((entry) => String(entry.target ?? entry.cs ?? "").startsWith(target.textContent)));
    assert.equal(JSON.stringify(course), snapshot);
    assert.equal(harness.host.CaatuuCourse, course);
    assert.deepEqual(harness.localStorage.snapshot(), { progress: "preserved" });
    cleanup();
  });
}

test("verb search accepts accents and difficulty selection narrows real Spanish results", async () => {
  const { course, readResource } = courses.find((item) => item.name === "spanish");
  const harness = harnessFor(course, async () => Response.json(JSON.parse(await readResource(course.gameContent["verb-lab"].verbNebulaCatalog))));
  const cleanup = await mountVerbDifficulty(harness);
  setControl(harness.root, "[data-verb-search]", "oir", "input");
  assert.equal(harness.root.querySelectorAll("[data-verb-id]").length, 1);
  assert.equal(harness.root.querySelector("[data-verb-id]").dataset.verbId, "es.verb.oir");
  setControl(harness.root, "[data-verb-difficulty]", "3");
  assert.equal(harness.root.querySelectorAll("[data-verb-id]").length, 0);
  assert.match(harness.root.textContent, /No matching entries/);
  cleanup();
});

test("verb inspector separates unauthored fallback difficulty from reviewed level three", async () => {
  const catalog = [
    { id: "fallback", kind: "verb", target: "كتب", source: "write" },
    { id: "reviewed", kind: "verb", target: "قرأ", source: "read", difficulty: 3 }
  ];
  const harness = harnessFor(syntheticCourse(), async () => Response.json(catalog));
  const cleanup = await mountVerbDifficulty(harness);
  assert.equal(harness.root.querySelector('[data-difficulty="unassigned"] [data-verb-id]').dataset.verbId, "fallback");
  assert.equal(harness.root.querySelector('[data-difficulty="3"] [data-verb-id]').dataset.verbId, "reviewed");
  setControl(harness.root, "[data-verb-difficulty]", "unassigned");
  assert.equal(harness.root.querySelectorAll("[data-verb-id]").length, 1);
  cleanup();
});

test("dictionary inspector searches arbitrary language fields, paginates, and renders data as text", async () => {
  const rows = Array.from({ length: 55 }, (_value, index) => ({
    ar: `كتاب ${index}`, en: `book ${index}`, metadata: { review: "pending" }
  }));
  rows[54].ar = '<img src="x" onerror="alert(1)">';
  const harness = harnessFor(syntheticCourse(), async () => Response.json(rows));
  const cleanup = await mountDictionaryInspector(harness);
  assert.equal(harness.root.querySelectorAll("[data-record-key]").length, 50);
  assert.equal(harness.root.querySelector("[data-dictionary-previous]").disabled, true);
  harness.root.querySelector("[data-dictionary-next]").dispatchEvent({ type: "click" });
  assert.equal(harness.root.querySelectorAll("[data-record-key]").length, 5);
  assert.equal(harness.root.querySelector("[data-record-key]").dataset.recordKey, "51");
  assert.match(harness.root.querySelector('[data-record-key="55"]').textContent, /<img src=/);
  assert.equal(harness.root.querySelectorAll("img, script").length, 0);
  setControl(harness.root, "[data-dictionary-field]", "en");
  setControl(harness.root, "[data-dictionary-search]", "book 54", "input");
  assert.equal(harness.root.querySelectorAll("[data-record-key]").length, 1);
  assert.equal(harness.root.querySelector("[data-record-key]").dataset.recordKey, "55");
  assert.match(harness.root.querySelector(".developer-tool-status").textContent, /1 \/ 55 matches/);
  assert.deepEqual(harness.localStorage.snapshot(), { progress: "preserved" });
  assert.equal(harness.host.CaatuuDictionaryProvider, undefined);
  cleanup();
});

test("dictionary inspector loads only the selected declared Czech resource and escapes reference markup", async () => {
  const { course, readResource } = courses.find((item) => item.name === "czech");
  const resourcePaths = ["coreEntries", "catalog", "scriptLines", "referenceDocument"]
    .map((key) => course.dictionaryContent[key]);
  const resourceText = new Map(await Promise.all(resourcePaths.map(async (path) => [path, await readResource(path)])));
  const harness = harnessFor(course, async (url) => {
    const relative = new URL(url).pathname.slice(`${course.routePrefix}/`.length);
    assert.ok(resourceText.has(relative), `Unexpected undeclared resource fetch: ${relative}`);
    return new Response(resourceText.get(relative));
  });
  const cleanup = await mountDictionaryInspector(harness);
  assert.equal(harness.requests.length, 1);
  assert.match(harness.root.textContent, /czech-full-dictionary-v1/);
  for (const [key, expected] of [
    ["catalog", /default_dictionary/],
    ["scriptLines", /Cafe/],
    ["referenceDocument", /<section class="dictionary-section-intro">/]
  ]) {
    setControl(harness.root, "[data-dictionary-resource]", key);
    await flush();
    assert.match(harness.root.textContent, expected);
    assert.equal(harness.requests.at(-1).url, `https://caatuu.test${course.routePrefix}/${course.dictionaryContent[key]}`);
  }
  assert.equal(harness.requests.length, 4);
  assert.equal(harness.root.querySelectorAll("iframe, script, .dictionary-section-intro").length, 0);
  cleanup();
});

for (const path of ["../other/data.json", "data/../../cz/data.json", "https://evil.test/data.json", "data/%2e%2e/data.json", "/cz/data/core.json"]) {
  test(`dictionary resources reject an unconfined declaration: ${path}`, async () => {
    const harness = harnessFor(syntheticCourse({ dictionaryContent: { coreEntries: path } }), async () => {
      assert.fail("Invalid resource paths must not be fetched");
    });
    const cleanup = await mountDictionaryInspector(harness);
    assert.equal(harness.requests.length, 0);
    assert.match(harness.root.querySelector('[role="alert"]').textContent, /not confined to this course/);
    cleanup();
  });
}

test("undeclared dictionary and verb data show availability without consulting another course", async () => {
  const course = syntheticCourse({ dictionaryContent: null, gameContent: {} });
  const harness = harnessFor(course, async () => { assert.fail("No fallback course may be fetched"); });
  const dictionaryCleanup = await mountDictionaryInspector(harness);
  assert.match(harness.root.textContent, /No dictionary resources are declared for Arabic/);
  dictionaryCleanup();
  const verbCleanup = await mountVerbDifficulty(harness);
  assert.match(harness.root.textContent, /No Verb difficulty resource is declared for Arabic/);
  assert.equal(harness.requests.length, 0);
  verbCleanup();
});

test("a stale dictionary response cannot replace the newly selected resource", async () => {
  const pendingCore = deferred();
  const course = syntheticCourse({ dictionaryContent: { coreEntries: "data/core.json", catalog: "data/catalog.json" } });
  const harness = harnessFor(course, async (url) => url.endsWith("core.json")
    ? pendingCore.promise : Response.json({ selected: "current catalog" }));
  const mount = mountDictionaryInspector(harness);
  setControl(harness.root, "[data-dictionary-resource]", "catalog");
  await flush();
  assert.match(harness.root.textContent, /current catalog/);
  pendingCore.resolve(Response.json([{ stale: "old core" }]));
  const cleanup = await mount;
  assert.match(harness.root.textContent, /current catalog/);
  assert.doesNotMatch(harness.root.textContent, /old core/);
  cleanup();
});

test("cleanup aborts resource loading and removes controls' handlers", async () => {
  const pendingCatalog = deferred();
  const course = syntheticCourse({ dictionaryContent: { coreEntries: "data/core.json", catalog: "data/catalog.json" } });
  const harness = harnessFor(course, async (url) => url.endsWith("core.json")
    ? Response.json([{ target: "first" }]) : pendingCatalog.promise);
  const cleanup = await mountDictionaryInspector(harness);
  setControl(harness.root, "[data-dictionary-resource]", "catalog");
  cleanup();
  assert.equal(harness.requests.at(-1).options.signal.aborted, true);
  const snapshot = harness.root.textContent;
  pendingCatalog.resolve(Response.json({ stale: "must not render" }));
  await flush();
  assert.equal(harness.root.textContent, snapshot);
  setControl(harness.root, "[data-dictionary-resource]", "coreEntries");
  assert.equal(harness.requests.length, 2);
});

test("failed resources render a useful error and leave other declared resources selectable", async () => {
  const course = syntheticCourse({ dictionaryContent: { coreEntries: "data/core.json", catalog: "data/catalog.json" } });
  const harness = harnessFor(course, async (url) => url.endsWith("core.json")
    ? new Response("missing", { status: 404 }) : Response.json({ available: true }));
  const cleanup = await mountDictionaryInspector(harness);
  assert.match(harness.root.querySelector('[role="alert"]').textContent, /Request failed \(404\)/);
  setControl(harness.root, "[data-dictionary-resource]", "catalog");
  await flush();
  assert.equal(harness.root.querySelector('[role="alert"]'), null);
  assert.match(harness.root.textContent, /true/);
  cleanup();
});

for (const [name, mount] of [["verb", mountVerbDifficulty], ["dictionary", mountDictionaryInspector]]) {
  test(`external abort cancels a pending initial ${name} fetch before mount returns cleanup`, { timeout: 2_000 }, async () => {
    const external = new AbortController();
    const harness = harnessFor(syntheticCourse(), async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const mounting = mount({ ...harness, signal: external.signal });
    assert.equal(harness.requests.length, 1);
    assert.equal(getEventListeners(external.signal, "abort").length, 1);
    const snapshot = harness.root.textContent;
    const reason = new Error("The tool was closed while loading");
    external.abort(reason);
    assert.equal(harness.requests[0].options.signal.aborted, true);
    assert.equal(harness.requests[0].options.signal.reason, reason);
    const cleanup = await mounting;
    assert.equal(harness.root.textContent, snapshot);
    assert.equal(harness.root.querySelector('[role="alert"]'), null);
    assert.equal(getEventListeners(external.signal, "abort").length, 0);
    cleanup();
    cleanup();
    const resource = harness.root.querySelector("[data-dictionary-resource]");
    resource?.dispatchEvent({ type: "change" });
    assert.equal(harness.requests.length, 1);
  });

  test(`an already aborted ${name} mount never starts a request`, async () => {
    const external = new AbortController();
    external.abort();
    const harness = harnessFor(syntheticCourse(), async () => { assert.fail("A closed tool must not fetch"); });
    const cleanup = await mount({ ...harness, signal: external.signal });
    assert.equal(harness.requests.length, 0);
    assert.equal(getEventListeners(external.signal, "abort").length, 0);
    cleanup();
  });
}

test("normal cleanup removes the external abort listener and remains idempotent", async () => {
  const external = new AbortController();
  const harness = harnessFor(syntheticCourse(), async () => Response.json([{ target: "كتب", source: "write", difficulty: 1 }]));
  const cleanup = await mountVerbDifficulty({ ...harness, signal: external.signal });
  assert.equal(getEventListeners(external.signal, "abort").length, 1);
  cleanup();
  cleanup();
  assert.equal(getEventListeners(external.signal, "abort").length, 0);
  assert.equal(harness.requests[0].options.signal.aborted, true);
});
