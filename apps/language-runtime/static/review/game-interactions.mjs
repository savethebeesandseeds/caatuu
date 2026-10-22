// Local review only. Production markup, bootstrap and answer handlers run over
// disposable storage; this file is excluded from the exact release allowlists.
const reviewUrl = new URL(location.href);
const reviewPath = reviewUrl.pathname;
const params = new URLSearchParams(reviewUrl.search);
const originalReplaceState = history.replaceState.bind(history);

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); }
  };
}
for (const key of ["localStorage", "sessionStorage"]) {
  Object.defineProperty(window, key, { configurable: true, value: memoryStorage() });
}
Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
// The runtime checks `in navigator`, so retain its interface without creating
// registrations, deleting existing registrations, or contacting real workers.
const registration = {
  active: null, waiting: null, installing: null, scope: reviewUrl.origin + reviewPath,
  update: async () => {}, unregister: async () => true,
  addEventListener() {}, removeEventListener() {}
};
Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
  controller: null, ready: Promise.resolve(registration),
  register: async () => registration,
  getRegistration: async () => undefined, getRegistrations: async () => [],
  addEventListener() {}, removeEventListener() {}, startMessages() {}
} });
// Chrome's URL cleanup must never turn a reload into an ordinary learner page.
history.replaceState = (state, title) => originalReplaceState(state, title, reviewUrl.href);

function sameOriginUrl(value, base = reviewUrl) {
  const url = new URL(value, base);
  if (url.origin !== reviewUrl.origin) throw new Error(`Non-local review resource: ${url.href}`);
  return url;
}

function loadScript(source, type = "", attributes = []) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    for (const [name, value] of attributes) script.setAttribute(name, value);
    if (type) script.type = type;
    script.async = false;
    script.src = sameOriginUrl(source).href;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error(`Could not load ${script.src}`)), { once: true });
    document.head.append(script);
  });
}

function showBanner(message, error = false) {
  let banner = document.getElementById("gameInteractionReviewBanner");
  if (!banner) {
    banner = document.createElement("p");
    banner.id = "gameInteractionReviewBanner";
    banner.setAttribute("role", "status");
    document.body.prepend(banner);
  }
  banner.textContent = message;
  if (error) banner.dataset.error = "true";
}

try {
  await loadScript("/cz/source/shared/course-profile.js?v=course-74");
  const records = window.CaatuuCourse?.courseSelector?.courses;
  if (!Array.isArray(records)) throw new Error("The canonical course selector is unavailable.");
  const courseId = params.get("course") || "ar";
  const record = records.find(entry => entry.id === courseId);
  if (!record || !["active", "development"].includes(record.status)
      || !/^\/[a-z0-9-]+\/index\.html$/u.test(record.entryPath)) {
    throw new Error(`Unknown review course: ${courseId}`);
  }
  const legacy = params.get("legacy");
  if (legacy && (legacy !== "case-cosmos" || courseId !== "cz")) throw new Error("Only the declared Czech Case Cosmos legacy review is supported.");
  const caseChildUrl = !legacy && courseId === "cz" ? new URL(reviewUrl) : null;
  if (caseChildUrl) {
    caseChildUrl.searchParams.set("course", "cz");
    caseChildUrl.searchParams.set("legacy", "case-cosmos");
  }
  const entryUrl = sameOriginUrl(legacy ? "/cz/case-cosmos.html" : record.entryPath);
  const response = await fetch(entryUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Canonical entry returned HTTP ${response.status}.`);
  const markup = new DOMParser().parseFromString(await response.text(), "text/html");
  if (markup.querySelector("script:not([src])")) throw new Error("The canonical entry unexpectedly contains an inline script.");
  for (const node of markup.querySelectorAll("[src], [href], [data-src], [action]")) {
    for (const attribute of ["src", "href", "data-src", "action"]) {
      const value = node.getAttribute(attribute);
      if (!value || value.startsWith("#")) continue;
      node.setAttribute(attribute, new URL(value, entryUrl).href);
    }
  }
  if (!legacy && courseId === "cz") {
    // This legacy frame boots its own learning profile. Give its document the
    // same storage isolation before any of its production scripts can execute.
    const frame = markup.getElementById("caseCosmosEmbeddedGame");
    if (!frame) throw new Error("The canonical Czech Case Cosmos frame is missing.");
    frame.setAttribute("data-src", caseChildUrl.href);
  }
  const scripts = [...markup.querySelectorAll("script[src]")].map(script => ({ src: script.src, type: script.type,
    attributes: [...script.attributes].filter(attribute => !["src", "type"].includes(attribute.name)).map(attribute => [attribute.name, attribute.value]) }));
  markup.querySelectorAll("script").forEach(script => script.remove());
  const base = document.createElement("base");
  base.href = entryUrl.href;
  document.head.prepend(base);
  for (const link of markup.head.querySelectorAll('link[rel="stylesheet"]')) document.head.append(document.importNode(link, true));
  for (const attribute of markup.documentElement.attributes) document.documentElement.setAttribute(attribute.name, attribute.value);
  // The parent prepares embedded shells on iframe load, which can precede this
  // asynchronous markup clone. Retain that placement marker on the new body.
  const embeddedShell = document.documentElement.classList.contains("caatuu-embedded-shell")
    || document.body.classList.contains("caatuu-embedded-shell");
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  for (const attribute of markup.body.attributes) document.body.setAttribute(attribute.name, attribute.value);
  if (embeddedShell) document.body.classList.add("caatuu-embedded-shell");
  document.body.replaceChildren(...[...markup.body.childNodes].map(node => document.importNode(node, true)));
  document.documentElement.dataset.reviewStorage = "memory";
  document.documentElement.dataset.reviewCourse = courseId;
  document.documentElement.dataset.reviewServiceWorkers = "suppressed";
  showBanner("Isolated learner memory · local review · loading production application…");

  const navigateReview = selected => {
    const next = new URL(reviewUrl);
    next.searchParams.set("course", selected.id);
    location.assign(next.href);
  };
  // Navigation stays isolated too. The production game answer handlers remain
  // untouched; only confirmed course changes are routed back through this page.
  document.addEventListener("click", event => {
    if (!event.target.closest?.("[data-language-selector-confirm]")) return;
    const selectedId = event.target.closest("[data-language-selector-menu]")
      ?.querySelector('[data-language-course-option][aria-checked="true"]')?.dataset.languageCourseOption;
    const selected = records.find(entry => entry.id === selectedId);
    if (!selected) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    navigateReview(selected);
  }, true);
  document.addEventListener("click", event => {
    if (event.defaultPrevented) return;
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    const target = new URL(link.href, entryUrl);
    const selected = records.find(entry => new URL(entry.entryPath, entryUrl).pathname === target.pathname);
    if (target.origin !== reviewUrl.origin || !selected) return;
    event.preventDefault();
    const next = new URL(reviewUrl);
    next.searchParams.set("course", selected.id);
    for (const name of ["game", "practice", "view"]) {
      if (target.searchParams.has(name)) next.searchParams.set(name, target.searchParams.get(name));
    }
    location.assign(next.href);
  });
  const appReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Production application did not become ready within 45 seconds.")), 45000);
    document.addEventListener(legacy ? "caatuu:legacy-page-ready" : "caatuu:app-ready", () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
  for (const script of scripts) {
    await loadScript(script.src, script.type, script.attributes);
    if (script.src.includes("/source/shared/course-profile.js") && courseId === "cz") {
      const browserProviders = { ...window.CaatuuCourse.browserProviders };
      delete browserProviders.setupProvider;
      // Bootstrap reapplies frame URLs from the course profile. Keep its route
      // binding pointed at the isolated child as well as the cloned markup.
      const routes = caseChildUrl ? Object.freeze({ ...window.CaatuuCourse.routes, caseCosmos: caseChildUrl.href }) : window.CaatuuCourse.routes;
      window.CaatuuCourse = Object.freeze({ ...window.CaatuuCourse, routes, browserProviders: Object.freeze(browserProviders) });
      document.documentElement.dataset.reviewSetup = "czech-download-provider-omitted";
    }
  }
  await appReady;
  originalReplaceState(history.state, "", reviewUrl.href);
  document.documentElement.dataset.reviewReady = "true";
  showBanner(`Isolated learner memory · local review · ${record.targetLanguage.label}${legacy ? " · Case Cosmos child" : courseId === "cz" ? " · Czech download setup bypassed" : ""}`);
} catch (error) {
  document.documentElement.dataset.reviewReady = "error";
  showBanner(`Interaction review failed: ${error?.message || String(error)}`, true);
}
