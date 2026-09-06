import { extractCoreVerbPairs } from "../games/verb-nebula/verb-nebula-core.mjs";

export const catalogInspectorMessages = Object.freeze({
  "devtools.catalog.loading": "Loading {resource}…",
  "devtools.catalog.unavailable": "No {resource} resource is declared for {language}.",
  "devtools.catalog.invalidresource": "The declared resource path is not confined to this course: {path}",
  "devtools.catalog.loadfailed": "Could not load {resource}: {message}",
  "devtools.catalog.http": "Request failed ({status}).",
  "devtools.catalog.invalidverbs": "The verb catalog must contain a list of entries.",
  "devtools.catalog.source": "Source: {path}",
  "devtools.catalog.search": "Search",
  "devtools.catalog.searchplaceholder": "Search labels, meanings, and identifiers",
  "devtools.catalog.difficulty": "Difficulty",
  "devtools.catalog.alllevels": "All levels",
  "devtools.catalog.level1": "Explorer · Level 1",
  "devtools.catalog.level2": "Traveler · Level 2",
  "devtools.catalog.level3": "Navigator · Level 3",
  "devtools.catalog.unassigned": "No authored difficulty",
  "devtools.catalog.defaultnote": "Entries without authored difficulty use level 3 in the game.",
  "devtools.catalog.verbs": "Verb difficulty",
  "devtools.catalog.verbcount": "{visible} / {total} playable verbs",
  "devtools.catalog.catalogcount": "{raw} catalog rows · {total} playable pairs",
  "devtools.catalog.empty": "No matching entries.",
  "devtools.catalog.identifier": "Identifier",
  "devtools.catalog.targetlanguage": "Target language",
  "devtools.catalog.sourcelanguage": "Source language",
  "devtools.catalog.dictionary": "Dictionary",
  "devtools.catalog.resource": "Resource",
  "devtools.catalog.core": "Core entries",
  "devtools.catalog.catalog": "Dictionary catalog",
  "devtools.catalog.scripts": "Script lines",
  "devtools.catalog.reference": "Reference document",
  "devtools.catalog.provider": "Declared provider: {provider}",
  "devtools.catalog.noprovider": "No dictionary provider is declared.",
  "devtools.catalog.nodictionary": "No dictionary resources are declared for {language}.",
  "devtools.catalog.searchfield": "Search field",
  "devtools.catalog.allfields": "All fields",
  "devtools.catalog.recordcount": "{visible} / {total} matches · Page {page} / {pages}",
  "devtools.catalog.previous": "Previous",
  "devtools.catalog.next": "Next",
  "devtools.catalog.record": "Entry {index}",
  "devtools.catalog.rawreference": "Reference markup is shown as text."
});

function languageLabel(language, fallback) {
  return String(language?.label || language?.nativeLabel || language?.id || fallback);
}

function languageLocale(language) {
  return String(language?.locale || language?.id || "und");
}

function searchText(value) {
  return String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

function resourceUrl(course, path, host, t) {
  const route = String(course?.routePrefix || "");
  const relative = String(path || "").replace(/^\.\//u, "");
  const pathParts = relative.split("?", 1)[0].split("/");
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\/?$/u.test(route)
    || !/^data\/[A-Za-z0-9_./-]+(?:\?[A-Za-z0-9_=&.-]+)?$/u.test(relative)
    || pathParts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(t("devtools.catalog.invalidresource", { path: String(path || "") }));
  }
  const base = new URL(`${route.replace(/\/$/u, "")}/`, host.location.origin);
  const url = new URL(relative, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error(t("devtools.catalog.invalidresource", { path }));
  }
  return url.href;
}

function createInspector({ root, course, host = globalThis, t, signal }) {
  if (!root || typeof t !== "function") throw new TypeError("An inspector root and interface translator are required.");
  const document = root.ownerDocument || host.document;
  const controller = new (host.AbortController || globalThis.AbortController)();
  const listeners = [];
  let disposed = false;
  function node(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== "") element.textContent = text;
    return element;
  }
  const panel = node("section", "developer-tool-panel");
  root.replaceChildren(panel);
  function on(element, event, handler) {
    if (disposed) return;
    element.addEventListener(event, handler);
    listeners.push(() => element.removeEventListener(event, handler));
  }
  function control(toolbar, label, element) {
    const wrapper = node("label", "developer-tool-field developer-tool-control");
    wrapper.append(node("span", "", label), element);
    toolbar.append(wrapper);
    return element;
  }
  function option(select, value, label) {
    const element = node("option", "", label);
    element.value = value;
    select.append(element);
  }
  async function fetchResource(path, asText = false) {
    if (disposed) throw controller.signal.reason;
    const response = await host.fetch(resourceUrl(course, path, host, t), {
      cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal
    });
    if (!response.ok) throw new Error(t("devtools.catalog.http", { status: response.status }));
    return asText ? response.text() : response.json();
  }
  function fail(status, resource, error) {
    if (disposed) return;
    status.classList.add("is-error", "developer-tool-error");
    status.setAttribute("role", "alert");
    status.textContent = t("devtools.catalog.loadfailed", { resource, message: error?.message || String(error) });
  }
  function cleanup() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", cleanup);
    controller.abort(signal?.reason);
    listeners.splice(0).forEach((remove) => remove());
  }
  if (signal?.aborted) cleanup();
  else signal?.addEventListener("abort", cleanup, { once: true });
  return { node, panel, on, control, option, fetchResource, fail, cleanup, get disposed() { return disposed; } };
}

export async function mountVerbDifficulty({ root, course, host = globalThis, t, signal }) {
  const ui = createInspector({ root, course, host, t, signal });
  if (ui.disposed) return ui.cleanup;
  const { node, panel } = ui;
  const resource = t("devtools.catalog.verbs");
  const status = node("p", "developer-tool-status", t("devtools.catalog.loading", { resource }));
  status.setAttribute("role", "status");
  panel.append(status);
  const path = course?.gameContent?.["verb-lab"]?.verbNebulaCatalog;
  if (!path) {
    status.textContent = t("devtools.catalog.unavailable", {
      resource, language: languageLabel(course?.targetLanguage, t("devtools.catalog.targetlanguage"))
    });
    return ui.cleanup;
  }
  try {
    const catalog = await ui.fetchResource(path);
    if (ui.disposed) return ui.cleanup;
    if (!Array.isArray(catalog)) throw new Error(t("devtools.catalog.invalidverbs"));
    const verbs = extractCoreVerbPairs(catalog).slice().sort((left, right) => (
      left.target.localeCompare(right.target, languageLocale(course.targetLanguage), { sensitivity: "base" })
    ));
    panel.append(node("p", "developer-tool-source", t("devtools.catalog.source", { path })));
    panel.append(node("p", "developer-tool-source", t("devtools.catalog.catalogcount", { raw: catalog.length, total: verbs.length })));
    const toolbar = node("div", "developer-tool-toolbar");
    const search = ui.control(toolbar, t("devtools.catalog.search"), node("input"));
    search.type = "search";
    search.placeholder = t("devtools.catalog.searchplaceholder");
    search.dataset.verbSearch = "";
    const difficulty = ui.control(toolbar, t("devtools.catalog.difficulty"), node("select"));
    difficulty.dataset.verbDifficulty = "";
    ui.option(difficulty, "all", t("devtools.catalog.alllevels"));
    for (const level of [1, 2, 3]) ui.option(difficulty, String(level), t(`devtools.catalog.level${level}`));
    ui.option(difficulty, "unassigned", t("devtools.catalog.unassigned"));
    difficulty.value = "all";
    const groups = node("div", "developer-tool-catalog-groups");
    panel.append(toolbar, groups);
    function render() {
      const query = searchText(search.value);
      const matching = verbs.filter((verb) => {
        const level = verb.difficultyIsAuthored ? String(verb.difficulty) : "unassigned";
        return (difficulty.value === "all" || difficulty.value === level)
          && searchText(`${verb.target} ${verb.source} ${verb.id}`).includes(query);
      });
      status.textContent = t("devtools.catalog.verbcount", { visible: matching.length, total: verbs.length });
      groups.replaceChildren();
      for (const level of ["1", "2", "3", "unassigned"]) {
        if (difficulty.value !== "all" && difficulty.value !== level) continue;
        const rows = matching.filter((verb) => (verb.difficultyIsAuthored ? String(verb.difficulty) : "unassigned") === level);
        if (!rows.length) continue;
        const group = node("section", "developer-tool-catalog-group");
        group.dataset.difficulty = level;
        const title = t(level === "unassigned" ? "devtools.catalog.unassigned" : `devtools.catalog.level${level}`);
        group.append(node("h3", "", `${title} · ${rows.length}`));
        if (level === "unassigned") group.append(node("p", "developer-tool-source", t("devtools.catalog.defaultnote")));
        const table = node("table", "developer-tool-table");
        const head = node("thead");
        const heading = node("tr");
        for (const label of [
          languageLabel(course.targetLanguage, t("devtools.catalog.targetlanguage")),
          languageLabel(course.sourceLanguage, t("devtools.catalog.sourcelanguage")),
          t("devtools.catalog.identifier")
        ]) {
          const cell = node("th", "", label);
          cell.setAttribute("scope", "col");
          heading.append(cell);
        }
        head.append(heading);
        const body = node("tbody");
        for (const verb of rows) {
          const row = node("tr");
          row.dataset.verbId = verb.id;
          const target = node("td", "", verb.target);
          target.lang = languageLocale(course.targetLanguage);
          const source = node("td", "", verb.source);
          source.lang = languageLocale(course.sourceLanguage);
          row.append(target, source, node("td", "", verb.id));
          body.append(row);
        }
        table.append(head, body);
        group.append(table);
        groups.append(group);
      }
      if (!matching.length) groups.append(node("p", "developer-tool-empty", t("devtools.catalog.empty")));
    }
    ui.on(search, "input", render);
    ui.on(difficulty, "change", render);
    render();
  } catch (error) {
    ui.fail(status, resource, error);
  }
  return ui.cleanup;
}

function jsonRecords(value) {
  if (Array.isArray(value)) return value.map((entry, index) => ({ key: String(index + 1), value: entry }));
  if (value && typeof value === "object") return Object.entries(value).map(([key, entry]) => ({ key, value: entry }));
  return [{ key: "1", value }];
}

function displayValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
}

export async function mountDictionaryInspector({ root, course, host = globalThis, t, signal }) {
  const ui = createInspector({ root, course, host, t, signal });
  if (ui.disposed) return ui.cleanup;
  const { node, panel } = ui;
  const declaration = course?.dictionaryContent;
  const resources = [
    ["coreEntries", "devtools.catalog.core"],
    ["catalog", "devtools.catalog.catalog"],
    ["scriptLines", "devtools.catalog.scripts"],
    ["referenceDocument", "devtools.catalog.reference"]
  ].filter(([key]) => typeof declaration?.[key] === "string" && declaration[key].trim());
  const provider = node("p", "developer-tool-source", declaration?.providerId
    ? t("devtools.catalog.provider", { provider: declaration.providerId })
    : t("devtools.catalog.noprovider"));
  panel.append(provider);
  if (!resources.length) {
    panel.append(node("p", "developer-tool-empty", t("devtools.catalog.nodictionary", {
      language: languageLabel(course?.targetLanguage, t("devtools.catalog.targetlanguage"))
    })));
    return ui.cleanup;
  }
  const toolbar = node("div", "developer-tool-toolbar");
  const resourceSelect = ui.control(toolbar, t("devtools.catalog.resource"), node("select"));
  resourceSelect.dataset.dictionaryResource = "";
  resources.forEach(([key, label]) => ui.option(resourceSelect, key, t(label)));
  resourceSelect.value = resources[0][0];
  const search = ui.control(toolbar, t("devtools.catalog.search"), node("input"));
  search.type = "search";
  search.dataset.dictionarySearch = "";
  const fieldSelect = ui.control(toolbar, t("devtools.catalog.searchfield"), node("select"));
  fieldSelect.dataset.dictionaryField = "";
  const status = node("p", "developer-tool-status");
  status.setAttribute("role", "status");
  const source = node("p", "developer-tool-source");
  const note = node("p", "developer-tool-source");
  const list = node("div", "developer-tool-records");
  const pager = node("div", "developer-tool-actions developer-tool-pager");
  const previous = node("button", "", t("devtools.catalog.previous"));
  previous.type = "button";
  previous.dataset.dictionaryPrevious = "";
  const next = node("button", "", t("devtools.catalog.next"));
  next.type = "button";
  next.dataset.dictionaryNext = "";
  pager.append(previous, next);
  panel.append(toolbar, status, source, note, list, pager);
  let records = [];
  let page = 0;
  let requestSequence = 0;
  let loaded = false;
  const pageSize = 50;

  function render() {
    if (!loaded || ui.disposed) return;
    const query = searchText(search.value);
    const matching = records.filter(({ key, value }) => {
      if (fieldSelect.value === "all") return searchText(`${key} ${displayValue(value)}`).includes(query);
      return value && typeof value === "object" && !Array.isArray(value)
        && Object.hasOwn(value, fieldSelect.value) && searchText(displayValue(value[fieldSelect.value])).includes(query);
    });
    const pages = Math.max(1, Math.ceil(matching.length / pageSize));
    page = Math.max(0, Math.min(page, pages - 1));
    status.textContent = t("devtools.catalog.recordcount", {
      visible: matching.length, total: records.length, page: page + 1, pages
    });
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pages;
    list.replaceChildren();
    for (const { key, value } of matching.slice(page * pageSize, (page + 1) * pageSize)) {
      const record = node("article", "developer-tool-record");
      record.dataset.recordKey = key;
      record.append(node("h3", "", t("devtools.catalog.record", { index: key })));
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const fields = node("dl", "developer-tool-record-fields");
        for (const [name, content] of Object.entries(value)) {
          const detail = node("dd");
          detail.append(node(typeof content === "object" && content !== null ? "pre" : "span", "", displayValue(content)));
          fields.append(node("dt", "", name), detail);
        }
        record.append(fields);
      } else {
        record.append(node("pre", "", displayValue(value)));
      }
      list.append(record);
    }
    if (!matching.length) list.append(node("p", "developer-tool-empty", t("devtools.catalog.empty")));
  }

  async function loadSelectedResource() {
    const sequence = ++requestSequence;
    const selected = resources.find(([key]) => key === resourceSelect.value);
    if (!selected) return;
    loaded = false;
    previous.disabled = true;
    next.disabled = true;
    const [key, label] = selected;
    status.classList.remove("is-error", "developer-tool-error");
    status.setAttribute("role", "status");
    status.textContent = t("devtools.catalog.loading", { resource: t(label) });
    source.textContent = t("devtools.catalog.source", { path: declaration[key] });
    note.textContent = key === "referenceDocument" ? t("devtools.catalog.rawreference") : "";
    list.replaceChildren();
    try {
      const value = await ui.fetchResource(declaration[key], key === "referenceDocument");
      if (ui.disposed || sequence !== requestSequence) return;
      records = key === "referenceDocument"
        ? value.split(/\r?\n/u).map((line, index) => ({ key: String(index + 1), value: line })).filter((entry) => entry.value.trim())
        : jsonRecords(value);
      const fields = new Set(records.flatMap((entry) => (
        entry.value && typeof entry.value === "object" && !Array.isArray(entry.value) ? Object.keys(entry.value) : []
      )));
      fieldSelect.replaceChildren();
      ui.option(fieldSelect, "all", t("devtools.catalog.allfields"));
      [...fields].sort().forEach((field) => ui.option(fieldSelect, field, field));
      fieldSelect.value = "all";
      fieldSelect.disabled = fields.size === 0;
      page = 0;
      loaded = true;
      render();
    } catch (error) {
      if (sequence === requestSequence) ui.fail(status, t(label), error);
    }
  }
  ui.on(resourceSelect, "change", () => { void loadSelectedResource(); });
  ui.on(search, "input", () => { page = 0; render(); });
  ui.on(fieldSelect, "change", () => { page = 0; render(); });
  ui.on(previous, "click", () => { page -= 1; render(); });
  ui.on(next, "click", () => { page += 1; render(); });
  await loadSelectedResource();
  return ui.cleanup;
}
