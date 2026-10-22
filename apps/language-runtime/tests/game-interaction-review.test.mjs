import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../static/review/game-interactions.mjs", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function review(query) {
  const records = ["cz", "ar"].map(id => ({ id, status: "active", entryPath: `/${id}/index.html`, targetLanguage: { label: id } }));
  const legacy = query.includes("legacy=");
  const courseId = new URLSearchParams(query).get("course");
  const scripts = [
    { src: "source/shared/course-profile.js?v=course-73" },
    { src: "/language-runtime/static/source/learning-profile.js?v=learning-24" },
    legacy
      ? { src: "/language-runtime/static/source/legacy-page-bootstrap.mjs?v=legacy-page-23", type: "module", "data-caatuu-feature-module": "source/games/case-cosmos/case-cosmos.js?v=case-cosmos-32" }
      : { src: "/language-runtime/static/source/app-bootstrap.mjs?v=bootstrap-154", type: "module" }
  ].map(attributes => node("script", attributes));
  const frame = node("iframe", { "data-src": "case-cosmos.html" });
  const listeners = new Map();
  const loaded = [];
  const nativeStorage = { untouched: true };
  const window = { localStorage: nativeStorage, sessionStorage: nativeStorage, indexedDB: { native: true } };
  const profile = () => ({ courseSelector: { courses: records }, routes: { caseCosmos: "case-cosmos.html" }, browserProviders: { setupProvider: { module: "native-download" }, languageProvider: { module: "language" } } });
  const location = { href: `http://127.0.0.1:8765/language-runtime/static/review/game-interactions.html?${query}`, assign() {} };
  const historyWrites = [];
  const history = { state: {}, replaceState: (_state, _title, url) => historyWrites.push(url) };
  const banners = new Map();
  const document = {
    documentElement: node("html", legacy ? { class: "caatuu-embedded-shell" } : {}),
    body: Object.assign(node("body", legacy ? { class: "caatuu-embedded-shell" } : {}), {
      replaceChildren() { banners.clear(); },
      prepend(value) { banners.set(value.id, value); }
    }),
    head: {
      prepend() {},
      append(value) {
        if (value.tagName !== "script") return;
        assert.notEqual(window.localStorage, nativeStorage, "storage must be isolated before any production script");
        assert.equal(window.indexedDB, undefined);
        loaded.push({ src: value.src, attributes: value.attributes, route: window.CaatuuCourse?.routes?.caseCosmos });
        if (value.src.includes("/course-profile.js")) window.CaatuuCourse = profile();
        if (value.src.includes("/app-bootstrap.mjs")) {
          // Production configureGameRoutes reapplies this binding.
          frame.setAttribute("data-src", window.CaatuuCourse.routes.caseCosmos);
          history.replaceState({}, "", `/${courseId}/index.html`);
          document.dispatchEvent({ type: "caatuu:app-ready" });
        }
        if (value.src.includes("/legacy-page-bootstrap.mjs")) document.dispatchEvent({ type: "caatuu:legacy-page-ready" });
        queueMicrotask(() => value.dispatchEvent({ type: "load" }));
      }
    },
    createElement: tag => node(tag),
    importNode: value => value,
    getElementById: id => banners.get(id) || null,
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent(event) { listeners.get(event.type)?.(event); }
  };
  const markup = {
    documentElement: node("html"), body: Object.assign(node("body", { class: "games-page" }), { childNodes: [] }),
    head: { querySelectorAll: () => [] },
    getElementById: id => id === "caseCosmosEmbeddedGame" ? frame : null,
    querySelector: () => null,
    querySelectorAll: selector => selector === "script[src]" || selector === "script" ? scripts : [...scripts, frame]
  };
  const requests = [];
  const fetch = async url => { requests.push(url.href); return { ok: true, text: async () => "canonical markup" }; };
  const DOMParser = class { parseFromString() { return markup; } };
  await new AsyncFunction("window", "document", "navigator", "location", "history", "fetch", "DOMParser", source)(
    window, document, {}, location, history, fetch, DOMParser
  );
  assert.equal(document.documentElement.dataset.reviewReady, "true", banners.get("gameInteractionReviewBanner")?.textContent);
  assert.deepEqual(nativeStorage, { untouched: true });
  assert.ok(historyWrites.every(url => url === location.href), "URL cleanup must retain the isolated reload entry");
  return { window, document, loaded, frame, requests };
}

function node(tagName, initial = {}) {
  const values = new Map(Object.entries(initial));
  const listeners = new Map();
  return {
    tagName, dataset: {},
    classList: {
      contains(value) { return String(values.get("class") || "").split(/\s+/u).includes(value); },
      add(value) { values.set("class", `${values.get("class") || ""} ${value}`.trim()); }
    },
    get attributes() { return [...values].map(([name, value]) => ({ name, value })); },
    get src() { return values.get("src") || ""; }, set src(value) { values.set("src", value); },
    get type() { return values.get("type") || ""; }, set type(value) { values.set("type", value); },
    getAttribute: name => values.get(name) ?? null,
    setAttribute(name, value) { values.set(name, value); },
    removeAttribute(name) { values.delete(name); },
    remove() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent(event) { listeners.get(event.type)?.(event); }
  };
}

test("Czech full-app review keeps Case Cosmos isolated after production route binding", async () => {
  const { window, loaded, frame } = await review("course=cz&game=case-cosmos");
  const child = new URL(frame.getAttribute("data-src"));
  assert.equal(child.pathname, "/language-runtime/static/review/game-interactions.html");
  assert.equal(child.searchParams.get("legacy"), "case-cosmos");
  assert.equal(loaded.at(-1).route, child.href);
  assert.equal(window.CaatuuCourse.browserProviders.setupProvider, undefined);
  assert.equal(window.CaatuuCourse.browserProviders.languageProvider.module, "language");
});

test("legacy review isolates its own head scripts and retains the declared feature metadata", async () => {
  const { document, loaded, requests } = await review("course=cz&legacy=case-cosmos");
  assert.equal(requests[0], "http://127.0.0.1:8765/cz/case-cosmos.html");
  assert.deepEqual(loaded.at(-1).attributes.find(attribute => attribute.name === "data-caatuu-feature-module"), {
    name: "data-caatuu-feature-module", value: "source/games/case-cosmos/case-cosmos.js?v=case-cosmos-32"
  });
  assert.ok(loaded[1].src.endsWith("/cz/source/shared/course-profile.js?v=course-73"));
  assert.ok(loaded[2].src.includes("/learning-profile.js"));
  assert.ok(document.body.classList.contains("caatuu-embedded-shell"), "the parent shell placement must survive the asynchronous body clone");
  assert.ok(document.body.classList.contains("games-page"), "canonical body classes must also be retained");
});

test("other course review retains its production providers and routes", async () => {
  const { window } = await review("course=ar&game=grammar-gravity&practice=forms");
  assert.equal(window.CaatuuCourse.browserProviders.setupProvider.module, "native-download");
  assert.equal(window.CaatuuCourse.routes.caseCosmos, "case-cosmos.html");
});
