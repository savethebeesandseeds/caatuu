import { IMAGE_SOURCES, createEnglishImageSearch } from "../english-image-search.mjs?v=english-image-search-3";
export { createEnglishImageSearch, normalizeImageCatalog } from "../english-image-search.mjs?v=english-image-search-3";

export const messages = Object.freeze({
  "developer.images.description": "Search shared artwork using its English descriptions. The image collection is the same for every course.",
  "developer.images.prompt": "English prompt",
  "developer.images.example": "a macaw plays music",
  "developer.images.type": "Image type",
  "developer.images.all": "All images",
  "developer.images.miscellaneous": "Miscellaneous",
  "developer.images.actions": "Macaw actions",
  "developer.images.search": "Search images",
  "developer.images.ready": "Ready to search shared artwork.",
  "developer.images.searching": "Searching shared English embeddings…",
  "developer.images.emptyquery": "Write an English prompt first.",
  "developer.images.invalidquery": "Use an English prompt of up to 1,024 characters.",
  "developer.images.none": "No matching images found.",
  "developer.images.matches": "{count} image matches · English MiniLM similarity",
  "developer.images.fallback": "{count} keyword matches · English embeddings are unavailable",
  "developer.images.failed": "Shared image search could not be loaded. Try again.",
  "developer.images.missing": "Image unavailable",
  "developer.images.source": "Source catalog",
  "developer.images.score": "Similarity: {score}",
  "developer.chat.description": "Test the shared browser model. Messages stay in this tool and do not change your learning history.",
  "developer.chat.checking": "Checking the model runtime…",
  "developer.chat.unavailable": "A supported browser model runtime is unavailable on this device.",
  "developer.chat.android": "Debug Chat needs a browser with WebGPU. This Android app uses Standard content and does not include a chat model runtime.",
  "developer.chat.product": "Debug Chat is not included in this build. Open the local development app in a browser to use a chat model.",
  "developer.chat.download": "Loading the browser model may download model files the first time. Generation runs on this device.",
  "developer.chat.load": "Load browser model",
  "developer.chat.loading": "Loading the browser model…",
  "developer.chat.notloaded": "Browser model available; load it to begin.",
  "developer.chat.ready": "Browser model ready.",
  "developer.chat.failed": "The browser model could not complete this request. Try again.",
  "developer.chat.model": "Model: {model}",
  "developer.chat.message": "Message",
  "developer.chat.context": "Reply language: {language}",
  "developer.chat.send": "Send",
  "developer.chat.clear": "Clear conversation",
  "developer.chat.generating": "Generating on this device…",
  "developer.chat.empty": "Write a message first.",
  "developer.chat.emptyoutput": "The model returned no text.",
  "developer.chat.user": "You",
  "developer.chat.assistant": "Model",
  "developer.chat.request": "Last request",
  "developer.chat.temperature": "Temperature",
  "developer.chat.tokens": "Maximum output tokens"
});

const browserServices = new WeakMap();

function text(t, key, values = {}) {
  if (typeof t !== "function") throw new TypeError("Shared interface translator is required.");
  return t(key, values);
}

function element(document, tag, className = "", content = "") {
  const node = document.createElement(tag);
  node.className = className;
  if (content) node.textContent = content;
  return node;
}

function mountScope(root) {
  const document = root.ownerDocument;
  const listeners = [];
  let disposed = false;
  const panel = element(document, "section", "developer-model-tool");
  root.replaceChildren(panel);
  return {
    document, panel, get disposed() { return disposed; },
    listen(node, event, callback) {
      node.addEventListener(event, callback);
      listeners.push(() => node.removeEventListener(event, callback));
    },
    cleanup() { disposed = true; listeners.forEach((remove) => remove()); panel.remove(); }
  };
}

function field(document, label, control) {
  const wrapper = element(document, "label", "developer-tool-field");
  wrapper.append(element(document, "span", "", label), control);
  return wrapper;
}

function button(document, label, type = "button") {
  const node = element(document, "button", "developer-tool-button", label);
  node.type = type;
  return node;
}

export async function mountEmbeddingImages({ root, host, t }) {
  const scope = mountScope(root);
  const { document, panel } = scope;
  panel.append(element(document, "p", "developer-tool-note", text(t, "developer.images.description")));
  const form = element(document, "form", "developer-tool-form");
  const prompt = element(document, "textarea");
  prompt.rows = 3;
  prompt.maxLength = 1024;
  prompt.value = text(t, "developer.images.example");
  const types = element(document, "select");
  [["", "developer.images.all"], ...IMAGE_SOURCES.map((source) => [source.kind, source.label])]
    .forEach(([value, label]) => { const option = element(document, "option", "", text(t, label)); option.value = value; types.append(option); });
  const run = button(document, text(t, "developer.images.search"), "submit");
  const status = element(document, "p", "developer-tool-status", text(t, "developer.images.ready"));
  status.setAttribute("role", "status");
  const results = element(document, "div", "developer-image-results");
  form.append(field(document, text(t, "developer.images.prompt"), prompt),
    field(document, text(t, "developer.images.type"), types), run);
  panel.append(form, status, results);
  const search = createEnglishImageSearch({ loadJson: async (path) => {
    const response = await host.fetch(path, { cache: "force-cache" });
    if (!response.ok) throw new Error("Image catalog unavailable.");
    return response.json();
  } });
  let controller = null;
  const submit = async (event) => {
    event.preventDefault();
    if (run.disabled || scope.disposed) return;
    const query = prompt.value.trim();
    if (!query) { status.textContent = text(t, "developer.images.emptyquery"); return; }
    run.disabled = true;
    status.dataset.tone = "";
    status.textContent = text(t, "developer.images.searching");
    results.replaceChildren();
    controller = new AbortController();
    try {
      const result = await search(query, { sourceKind: types.value, signal: controller.signal });
      if (scope.disposed) return;
      if (!result.rows.length) results.append(element(document, "p", "developer-tool-note", text(t, "developer.images.none")));
      for (const source of IMAGE_SOURCES) {
        const rows = result.rows.filter((row) => row.sourceKind === source.kind);
        if (!rows.length) continue;
        const group = element(document, "section", "developer-image-group");
        const grid = element(document, "div", "developer-image-grid");
        group.append(element(document, "h3", "", text(t, source.label)), grid);
        for (const row of rows) {
          const card = element(document, "figure", "developer-image-card");
          const image = element(document, "img");
          image.src = row.path;
          image.alt = row.description;
          image.loading = "lazy";
          const missing = element(document, "span", "developer-tool-note", text(t, "developer.images.missing"));
          missing.hidden = true;
          scope.listen(image, "error", () => { image.hidden = true; missing.hidden = false; });
          const caption = element(document, "figcaption");
          caption.append(element(document, "strong", "", row.title || row.description), element(document, "p", "", row.description));
          if (result.mode === "embedding") caption.append(element(document, "small", "", text(t, "developer.images.score", { score: row.score.toFixed(3) })));
          const attribution = element(document, "a", "", text(t, "developer.images.source"));
          attribution.href = row.sourceCatalog;
          attribution.target = "_blank";
          attribution.rel = "noopener";
          caption.append(element(document, "code", "", row.path), attribution);
          card.append(image, missing, caption);
          grid.append(card);
        }
        results.append(group);
      }
      status.textContent = text(t, result.mode === "embedding" ? "developer.images.matches" : "developer.images.fallback", { count: result.rows.length });
      status.dataset.tone = result.mode === "embedding" ? "" : "warning";
    } catch (error) {
      if (!scope.disposed) {
        status.textContent = text(t, error instanceof TypeError ? "developer.images.invalidquery" : "developer.images.failed");
        status.dataset.tone = "error";
      }
    } finally { if (!scope.disposed) run.disabled = false; }
  };
  scope.listen(form, "submit", submit);
  scope.listen(prompt, "keydown", (event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit(event); });
  return () => { controller?.abort(); scope.cleanup(); };
}

function nativeHost(host) {
  return host.CaatuuRuntime?.env === "android" || host.location?.hostname === "caatuu.local"
    || typeof host.CaatuuAndroid?.postMessage === "function";
}

/** Reuse the active browser service, or lazily prepare the same browser model used by legacy Chat. */
export async function browserChatService(host, {
  importModule = (url) => import(url),
  loadAdapter = () => import("./browser-model-service.mjs")
} = {}) {
  if (nativeHost(host)) return { available: false, reason: "android" };
  // This local adapter is replaced with an unavailable module in product builds.
  // Reading its declaration performs no model import or download.
  const module = await loadAdapter();
  if (module.BROWSER_CHAT_SUPPORTED === false) return { available: false, reason: "product" };
  const existing = host.CaatuuRuntime;
  if (existing?.env === "browser" && typeof existing.models?.status === "function"
      && typeof existing.models?.load === "function" && typeof existing.models?.generate === "function") {
    const status = await existing.models.status();
    const gpu = existing.capabilities?.webGpu;
    const available = status?.supported !== false && status?.available !== false
      && (status?.loaded === true || (gpu === true && Boolean(await host.navigator?.gpu?.requestAdapter?.())));
    return { available, status, models: existing.models };
  }
  if (browserServices.has(host)) return browserServices.get(host);
  const adapter = await host.navigator?.gpu?.requestAdapter?.();
  if (!adapter) return { available: false, reason: "webgpu" };
  const service = module.createBrowserModelService({ importModule });
  browserServices.set(host, service);
  return service;
}

export async function mountDebugChat({ root, course, host, t }) {
  const scope = mountScope(root);
  const { document, panel } = scope;
  const status = element(document, "p", "developer-tool-status", text(t, "developer.chat.checking"));
  status.setAttribute("role", "status");
  panel.append(element(document, "p", "developer-tool-note", text(t, "developer.chat.description")), status);
  // Initialization is intentionally detached so closing the tool always has an immediate cleanup handle.
  void (async () => {
    try {
      const service = await browserChatService(host);
      if (scope.disposed) return;
      if (!service.available) {
        const unavailableKey = service.reason === "android" ? "developer.chat.android"
          : service.reason === "product" ? "developer.chat.product" : "developer.chat.unavailable";
        status.textContent = text(t, unavailableKey);
        status.dataset.tone = "error";
        return;
      }
      const models = service.models;
      let modelStatus = await models.status();
      if (scope.disposed) return;
      const modelKey = String(modelStatus.modelKey || modelStatus.defaultModelKey || "").trim();
      if (!modelKey) throw new Error("The browser model service did not identify its model.");
      const language = course.targetLanguage?.englishName || course.targetLanguage?.name
        || course.targetLanguage?.label || course.targetLanguage?.locale || course.targetLanguage?.id || "en";
      const history = [];
      let busy = false;
      const load = button(document, text(t, "developer.chat.load"));
      const form = element(document, "form", "developer-tool-form");
      const prompt = element(document, "textarea");
      prompt.rows = 3;
      prompt.maxLength = 4096;
      const temperature = element(document, "input");
      Object.assign(temperature, { type: "number", value: "0.7", min: "0", max: "2", step: "0.1" });
      const maxTokens = element(document, "input");
      Object.assign(maxTokens, { type: "number", value: "256", min: "16", max: "2048", step: "1" });
      const send = button(document, text(t, "developer.chat.send"), "submit");
      const clear = button(document, text(t, "developer.chat.clear"));
      const log = element(document, "div", "developer-chat-log");
      log.setAttribute("role", "log");
      const details = element(document, "details", "developer-chat-request");
      const requestPreview = element(document, "pre");
      details.append(element(document, "summary", "", text(t, "developer.chat.request")), requestPreview);
      form.append(field(document, text(t, "developer.chat.message"), prompt),
        field(document, text(t, "developer.chat.temperature"), temperature),
        field(document, text(t, "developer.chat.tokens"), maxTokens), send, clear);
      panel.append(element(document, "p", "", text(t, "developer.chat.model", { model: modelKey })),
        element(document, "p", "developer-tool-note", text(t, "developer.chat.context", { language })),
        element(document, "p", "developer-tool-note", text(t, "developer.chat.download")), load, log, form, details);
      const controls = () => {
        load.disabled = busy || modelStatus.loaded === true;
        send.disabled = busy || modelStatus.loaded !== true;
        clear.disabled = busy;
      };
      const ready = () => {
        status.textContent = text(t, modelStatus.loaded ? "developer.chat.ready" : "developer.chat.notloaded");
        status.dataset.tone = "";
        controls();
      };
      scope.listen(load, "click", async () => {
        if (busy || scope.disposed) return;
        busy = true;
        controls();
        status.textContent = text(t, "developer.chat.loading");
        try {
          await models.load(modelKey, { onEvent(event) {
            if (!scope.disposed && event.message) status.textContent = event.message;
          } });
          modelStatus = await models.status();
          if (!scope.disposed) ready();
        } catch {
          if (!scope.disposed) { status.textContent = text(t, "developer.chat.failed"); status.dataset.tone = "error"; }
        } finally { busy = false; if (!scope.disposed) controls(); }
      });
      scope.listen(clear, "click", () => { if (!busy) { history.length = 0; log.replaceChildren(); requestPreview.textContent = ""; } });
      const message = (role, content) => {
        const row = element(document, "article", "developer-chat-message");
        row.dataset.role = role;
        const body = element(document, "p", "", content);
        row.append(element(document, "strong", "", text(t, `developer.chat.${role}`)), body);
        log.append(row);
        return body;
      };
      scope.listen(form, "submit", async (event) => {
        event.preventDefault();
        if (busy || modelStatus.loaded !== true || scope.disposed) return;
        const content = prompt.value.trim();
        if (!content) { status.textContent = text(t, "developer.chat.empty"); return; }
        busy = true;
        controls();
        const request = {
          model: modelKey,
          messages: [{ role: "system", content: `Reply in ${language}.` }, ...history.slice(-12), { role: "user", content }],
          temperature: Math.max(0, Math.min(2, Number(temperature.value) || 0)),
          max_tokens: Math.max(16, Math.min(2048, Math.floor(Number(maxTokens.value) || 256))),
          extra_body: { enable_thinking: false }
        };
        requestPreview.textContent = JSON.stringify(request, null, 2);
        message("user", content);
        const reply = message("assistant", "…");
        let output = "";
        status.textContent = text(t, "developer.chat.generating");
        try {
          const result = await models.generate(request, { onEvent(event) {
            if (scope.disposed) return;
            if (event.kind === "token") { output += String(event.token || ""); reply.textContent = output; }
          } });
          if (scope.disposed) return;
          output = String(result?.output || output);
          reply.textContent = output || text(t, "developer.chat.emptyoutput");
          if (output) history.push({ role: "user", content }, { role: "assistant", content: output });
          prompt.value = "";
          ready();
        } catch {
          if (!scope.disposed) { status.textContent = text(t, "developer.chat.failed"); status.dataset.tone = "error"; reply.textContent = output || status.textContent; }
        } finally { busy = false; if (!scope.disposed) controls(); }
      });
      ready();
    } catch {
      if (!scope.disposed) { status.textContent = text(t, "developer.chat.unavailable"); status.dataset.tone = "error"; }
    }
  })();
  return () => scope.cleanup();
}
