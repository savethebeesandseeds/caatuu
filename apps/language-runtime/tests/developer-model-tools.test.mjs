import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { validateEnglishEmbeddingPayload } from "../static/source/english-minilm-ranker.mjs";
import { BROWSER_CHAT_MODEL } from "../static/source/developer-tools/browser-model-service.mjs";
import {
  browserChatService, createEnglishImageSearch,
  messages, mountDebugChat, mountEmbeddingImages, normalizeImageCatalog
} from "../static/source/developer-tools/model-tools.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));
const t = (key, values = {}) => {
  assert.ok(Object.hasOwn(messages, key), `Missing centralized interface message: ${key}`);
  return messages[key].replace(/\{([a-z]+)\}/gu, (_, name) => String(values[name] ?? ""));
};
const imageCatalog = {
  "/assets/miscellaneous/book.png": { description: "A child reads a book at home.", category: "book" },
  "/assets/miscellaneous/ship.png": { description: "A spaceship flies near the sun.", category: "ship" }
};
const actionCatalog = {
  "/assets/macaw/actions/wave.png": { description: "A macaw waves hello.", action: "wave_hello" },
  "/assets/macaw/actions/sword.png": { description: "A macaw holds a sword.", action: "draw_sword" }
};
const loadJson = async (path) => path.includes("miscellaneous") ? imageCatalog : actionCatalog;

test("shared image catalog confines image sources and preserves child-facing exclusions", () => {
  const rows = normalizeImageCatalog({
    ...actionCatalog,
    "https://outside.test/image.png": { description: "External image." },
    "/assets/macaw/actions/../other.png": { description: "Escaped image." },
    "/assets/macaw/actions/%2e%2e%2fother.png": { description: "Encoded escaped image." },
    "/assets/macaw/actions/nested/image.png": { description: "Nested image." },
    "/assets/macaw/actions/script.svg": { description: "Not a raster image." },
    "/assets/macaw/actions/macaw%20(35).png": { description: "Excluded historical asset." }
  }, "macaw_action_asset");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, "/assets/macaw/actions/wave.png");
  assert.equal(rows[0].sourceCatalog, "/assets/macaw/actions/keymaps.json");
});

test("real shared artwork metadata satisfies the English ranker boundary", async () => {
  const catalogs = [
    ["../../launcher/static/assets/visual-vocabulary/keymap.json", "image_asset"],
    ["../../launcher/static/assets/macaw/actions/keymaps.json", "macaw_action_asset"]
  ];
  for (const [path, kind] of catalogs) {
    const raw = JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
    const rows = normalizeImageCatalog(raw, kind);
    assert.ok(rows.length > 100, `${kind} includes the established global collection`);
    assert.doesNotThrow(() => validateEnglishEmbeddingPayload({ inputLanguage: "en",
      query: { embeddingText: "a macaw plays music" },
      candidates: rows.map(({ conceptId, embeddingText }) => ({ conceptId, embeddingText })) }));
  }
});

test("image search uses global English metadata with type filtering and source attribution", async () => {
  const calls = [];
  const search = createEnglishImageSearch({ loadJson, ranker: async (payload) => {
    calls.push(payload);
    return payload.candidates.map(({ conceptId }, index) => ({ conceptId, score: 1 - index / 10 }));
  } });
  const result = await search("a book", { sourceKind: "image_asset" });
  assert.equal(result.mode, "embedding");
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every((row) => row.sourceKind === "image_asset"));
  assert.equal(result.rows[0].sourceCatalog, "/assets/miscellaneous/keymap.json");
  assert.equal(calls[0].inputLanguage, "en");
  assert.ok(calls[0].candidates.every((row) => Object.keys(row).join() === "conceptId,embeddingText"));
});

test("image search rejects target-script input before fetching or loading models", async () => {
  let fetched = false;
  let ranked = false;
  const search = createEnglishImageSearch({ loadJson: async () => { fetched = true; }, ranker: async () => { ranked = true; } });
  await assert.rejects(search("你好"), /English-only/u);
  assert.equal(fetched, false);
  assert.equal(ranked, false);
});

test("missing embeddings give honest keyword results without unsafe action assets", async () => {
  const search = createEnglishImageSearch({ loadJson, ranker: async () => { throw new Error("Local model missing"); } });
  const result = await search("macaw");
  assert.equal(result.mode, "lexical");
  assert.deepEqual(result.rows.map(({ path }) => path), ["/assets/macaw/actions/wave.png"]);
  assert.deepEqual((await search("bicycle")).rows, []);
});

test("image search cancellation does not turn into keyword fallback", async () => {
  const controller = new AbortController();
  const search = createEnglishImageSearch({ loadJson, ranker: async () => { controller.abort(); throw new Error("aborted"); } });
  await assert.rejects(search("macaw", { signal: controller.signal }), { name: "AbortError" });
});

test("image tool opens without downloading or searching and releases its UI", async () => {
  const harness = createBrowserHarness({ course: { id: "zh" } });
  let calls = 0;
  harness.window.fetch = async () => { calls++; throw new Error("Unexpected eager download"); };
  const root = harness.document.createElement("div");
  harness.document.body.append(root);
  const cleanup = await mountEmbeddingImages({ root, host: harness.window, t });
  assert.equal(calls, 0);
  assert.ok(root.textContent.includes("same for every course"));
  cleanup();
  assert.equal(root.children.length, 0);
});

test("Android cannot access browser model imports, GPU requests, or model downloads", async () => {
  let called = false;
  const forbidden = async () => { called = true; throw new Error("Forbidden"); };
  for (const native of [{ CaatuuRuntime: { env: "android" } }, { CaatuuAndroid: { postMessage() {} } }, { location: { hostname: "caatuu.local" } }]) {
    const result = await browserChatService({ ...native, navigator: { gpu: { requestAdapter: forbidden } } }, { importModule: forbidden, loadAdapter: forbidden });
    assert.equal(result.available, false);
    assert.equal(result.reason, "android");
  }
  assert.equal(called, false);
});

test("browser model availability requires a real WebGPU adapter without eager downloads", async () => {
  let imports = 0;
  const importModule = async () => { imports++; throw new Error("Unexpected download"); };
  for (const navigator of [{}, { gpu: { requestAdapter: async () => null } }]) {
    assert.equal((await browserChatService({ navigator }, { importModule })).available, false);
  }
  const service = await browserChatService({ navigator: { gpu: { requestAdapter: async () => ({}) } } }, { importModule });
  assert.equal(service.available, true);
  assert.equal((await service.models.status()).loaded, false);
  assert.equal(imports, 0);
});

test("shared developer UI contains no excluded model loader and accepts the product adapter boundary", async () => {
  const source = await readFile(new URL("../static/source/developer-tools/model-tools.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /webllm|web-llm|gguf|qwen|cstinyllama|esm\.run|CreateMLCEngine/iu);
  let imports = 0;
  const service = await browserChatService({ navigator: { gpu: { requestAdapter: async () => ({}) } } }, {
    importModule: async () => { imports++; throw new Error("Unexpected product import"); },
    loadAdapter: async () => ({ createBrowserModelService: () => ({ available: false, reason: "product" }) })
  });
  assert.deepEqual(service, { available: false, reason: "product" });
  assert.equal(imports, 0);
});

test("product model restriction is detected without probing absent hardware or a leftover host service", async () => {
  let probed = false;
  const service = await browserChatService({
    navigator: {},
    CaatuuRuntime: { env: "browser", models: {
      status: async () => { probed = true; return { loaded: true }; }, load() {}, generate() {}
    } }
  }, { loadAdapter: async () => ({ BROWSER_CHAT_SUPPORTED: false,
    createBrowserModelService: () => { throw new Error("Product fallback must not be initialized"); } }) });
  assert.deepEqual(service, { available: false, reason: "product" });
  assert.equal(probed, false);
});

test("shared browser model loads only explicitly and handles streamed and direct completions", async () => {
  let imports = 0;
  let loads = 0;
  let stream = true;
  const requests = [];
  const host = { CaatuuCourse: { id: "zh" }, navigator: { gpu: { requestAdapter: async () => ({}) } } };
  const service = await browserChatService(host, { importModule: async (url) => {
    assert.equal(url, "https://esm.run/@mlc-ai/web-llm");
    imports++;
    return { CreateMLCEngine: async (model) => {
      assert.equal(model, BROWSER_CHAT_MODEL);
      loads++;
      return { chat: { completions: { create: async (request) => {
        requests.push(request);
        return stream ? (async function* () {
          yield { choices: [{ delta: { content: "Hello" } }] };
          yield { choices: [{ delta: { content: " world" } }] };
        })() : { choices: [{ message: { content: "Direct reply" } }] };
      } } } };
    } };
  } });
  assert.equal(imports, 0);
  await assert.rejects(service.models.generate({ messages: [] }), /Load the browser model first/u);
  await service.models.load();
  await service.models.load();
  assert.equal(imports, 1);
  assert.equal(loads, 1);
  assert.equal((await service.models.status()).loaded, true);
  const tokens = [];
  assert.equal((await service.models.generate({ messages: [] }, { onEvent: (event) => tokens.push(event.token) })).output, "Hello world");
  assert.deepEqual(tokens, ["Hello", " world"]);
  stream = false;
  assert.equal((await service.models.generate({ messages: [] })).output, "Direct reply");
  assert.ok(requests.every((request) => request.model === BROWSER_CHAT_MODEL));
  assert.equal(await browserChatService(host), service);
  assert.deepEqual(host.CaatuuCourse, { id: "zh" });
});

test("Debug Chat selected language stays isolated from active course and learning storage", async () => {
  const active = Object.freeze({ id: "zh", targetLanguage: { id: "zh" } });
  const inspector = Object.freeze({ id: "es", targetLanguage: { englishName: "Spanish", id: "es" } });
  const requests = [];
  const harness = createBrowserHarness({ course: active, localStorageValues: { progress: "untouched" }, runtime: {
    models: { status: async () => ({ loaded: true, modelKey: "existing-model" }),
      load: async () => { throw new Error("Already loaded"); },
      generate: async (request, handlers) => { requests.push(request); handlers.onEvent({ kind: "token", token: "Hola" }); return { output: "Hola" }; } }
  } });
  const root = harness.document.createElement("div");
  harness.document.body.append(root);
  const cleanup = await mountDebugChat({ root, host: harness.window, course: inspector, t });
  await settle();
  const form = root.querySelector("form");
  assert.ok(form);
  root.querySelector("textarea").value = "Say hello";
  form.dispatchEvent({ type: "submit" });
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages[0].content, "Reply in Spanish.");
  assert.ok(root.querySelector(".developer-chat-log").textContent.includes("Hola"));
  assert.equal(harness.window.CaatuuCourse, active);
  assert.equal(harness.window.localStorage.getItem("progress"), "untouched");
  cleanup();
  assert.equal(root.children.length, 0);
});

test("closing Debug Chat while checking the runtime prevents late mounting", async () => {
  let resolveAdapter;
  const harness = createBrowserHarness({ course: { id: "zh" }, window: { navigator: {
    gpu: { requestAdapter: () => new Promise((resolve) => { resolveAdapter = resolve; }) }
  } } });
  const root = harness.document.createElement("div");
  harness.document.body.append(root);
  const cleanup = await mountDebugChat({ root, host: harness.window, course: {}, t });
  await settle();
  cleanup();
  resolveAdapter({});
  await settle();
  assert.equal(root.children.length, 0);
});
