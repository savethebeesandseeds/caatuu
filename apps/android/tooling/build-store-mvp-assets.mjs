import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = resolve(dirname(scriptPath), "../../..");

// This list is intentionally exhaustive. Adding a Czech static file does not put it
// in the Play bundle until it is reviewed and added here.
export const STORE_LANGUAGE_FILES = Object.freeze([
  "agreement-aurora.html",
  "case-cosmos.html",
  "icons/caatuu-czech-192.png",
  "icons/caatuu-czech-512.png",
  "index.html",
  "manifest.webmanifest",
  "setup-assets.json",
  "source/features/dictionary/dictionary-full.js",
  "source/features/dictionary/dictionary-gap-report.mjs",
  "source/features/dictionary/dictionary-patch-core.mjs",
  "source/features/home/home.css",
  "source/features/setup/setup-progress.js",
  "source/features/setup/setup.js",
  "source/games/agreement-aurora/agreement-aurora.css",
  "source/games/agreement-aurora/agreement-aurora.js",
  "source/games/agreement-aurora/launcher.css",
  "source/games/case-cosmos/case-cosmos.css",
  "source/games/case-cosmos/case-cosmos.js",
  "source/games/case-cosmos/launcher.css",
  "source/games/verb-nebula/app.css",
  "source/games/verb-nebula/app.js",
  "source/games/verb-nebula/verb-exercise-family-core.mjs",
  "source/games/verb-nebula/verb-nebula-core.mjs",
  "source/games/word-world/word-net-core.mjs",
  "source/games/word-world/word-net-standard.mjs",
  "source/games/word-world/word-net.css",
  "source/games/word-world/word-net.js",
  "source/shared/chrome.css",
  "source/shared/chrome.js",
  "source/shared/course-profile.js",
  "source/shared/feedback-outbox.mjs",
  "source/shared/learning-profile.js",
  "source/shared/maintenance-ui.js",
  "source/shared/runtime.js",
  "source/shared/semantic-learning-core.mjs",
  "source/shared/semantic-learning.js",
  "source/shared/theme.css",
  "source/shared/vector-db.js",
  "sw.js",
  "vendor/sql.js/LICENSE",
  "vendor/sql.js/README.md",
  "vendor/sql.js/sql-wasm.js",
  "vendor/sql.js/sql-wasm.wasm",
  "vendor/transformers/LICENSE",
  "vendor/transformers/README.md",
  "vendor/transformers/transformers.min.js",
  "word-net.html",
  "data/dictionaries/ATTRIBUTION.md",
  "data/dictionaries/README.md",
  "data/dictionaries/catalog.json",
  "data/dictionaries/kaikki-cs-en-2026-07-09/manifest.json",
  "data/dictionaries/patches/reviewed-cs-en.v1.json",
  "data/embeddings/all-minilm-l6-v2-qint8-v0.1/manifest.json",
  "data/embeddings/models.json",
  "data/games/agreement-aurora/challenges.json",
  "data/games/case-cosmos/challenges.json",
  "data/games/verb-nebula/core-vocabulary.json",
  "data/games/word-world/manifest.json",
  "data/games/word-world/standard-v0.1/records.json",
  "data/language/scripts.json"
]);

export const STORE_LAUNCHER_ICON_FILES = Object.freeze([
  "backpack_icon.png",
  "coin_icon.png",
  "coin_icon_ui.png",
  "czech_flag.png",
  "czech_flag_ui.png",
  "dark_mode.png",
  "dark_mode_ui.png",
  "difficulty_medal_1_ui.png",
  "difficulty_medal_2_ui.png",
  "difficulty_medal_3_ui.png",
  "games_icon.png",
  "gear_icon.png",
  "hello.png",
  "home_icon.png",
  "icon_gem.png",
  "items_icon.png",
  "light_mode_ui.png",
  "paper_plane_submit_ui.png",
  "stats_icon.png"
]);

export const STORE_MVP_PROFILE = Object.freeze({
  schemaVersion: 1,
  profile: "storeMvp",
  capabilities: Object.freeze({
    chat: false,
    llm: false,
    generation: false,
    godot: false,
    embeddings: true,
    imageLookup: true,
    stats: true,
    dictionary: true,
    wordWorldStandardOnly: true
  }),
  privacy: Object.freeze({
    bugReportsLocalOnly: true,
    dictionaryGapReportsLocalOnly: true
  })
});

const STORE_LAUNCHER_FILES = Object.freeze([
  ...STORE_LAUNCHER_ICON_FILES.map((name) => ({
    source: `assets/icons/${name}`,
    output: `assets/icons/${name}`
  })),
  {
    source: "assets/loading-animation/animations_manifest.json",
    output: "assets/loading_animation/animations_manifest.json"
  }
]);

const GENERATED_FILES = Object.freeze(["store-mvp-profile.json"]);
const STORE_OUTPUT_FILES = new Set([
  ...STORE_LANGUAGE_FILES,
  ...STORE_LAUNCHER_FILES.map(({ output }) => output),
  ...GENERATED_FILES
]);

const TEXT_EXTENSIONS = new Set([
  ".css", ".html", ".js", ".json", ".md", ".mjs", ".webmanifest"
]);

function slashPath(value) {
  return String(value).split(sep).join("/");
}

function extension(path) {
  const match = /(?:^|\/)([^/]+)$/.exec(slashPath(path));
  const fileName = match?.[1] || "";
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

function normalizeText(value) {
  return String(value).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function countOccurrences(source, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = source.indexOf(needle, index)) >= 0) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function exactReplace(source, before, after, label, expectedCount = 1) {
  const count = countOccurrences(source, before);
  assert.equal(
    count,
    expectedCount,
    `${label}: expected ${expectedCount} exact source anchor(s), found ${count}`
  );
  return source.split(before).join(after);
}

function replaceBetween(source, startAnchor, endAnchor, replacement, label) {
  const startCount = countOccurrences(source, startAnchor);
  assert.equal(startCount, 1, `${label}: expected one start anchor, found ${startCount}`);
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end > start, `${label}: expected an end anchor after the start anchor`);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function topLevelFunctionRange(source, name, { exported = false, indent = "" } = {}) {
  const prefix = exported ? "export " : "";
  const starts = [
    `\n${indent}${prefix}function ${name}(`,
    `\n${indent}${prefix}async function ${name}(`
  ].map((anchor) => ({ anchor, index: source.indexOf(anchor) }))
    .filter(({ index }) => index >= 0);
  assert.equal(starts.length, 1, `function ${name}: expected exactly one top-level declaration`);
  const start = starts[0].index + 1;
  const escapedIndent = indent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nextPattern = exported
    ? /\nexport (?:async )?function [A-Za-z_$][\w$]*\(/g
    : new RegExp(`\\n${escapedIndent}(?:async )?function [A-Za-z_$][\\w$]*\\(`, "g");
  nextPattern.lastIndex = start + starts[0].anchor.length;
  const next = nextPattern.exec(source);
  const initIndex = exported ? -1 : source.indexOf("\nvoid init()", start);
  let end = next?.index ?? source.length;
  if (initIndex >= 0 && initIndex < end) end = initIndex;
  return { start, end };
}

function removeTopLevelFunction(source, name, options = {}) {
  const { start, end } = topLevelFunctionRange(source, name, options);
  return `${source.slice(0, start)}${source.slice(end + (end < source.length ? 1 : 0))}`;
}

function replaceTopLevelFunction(source, name, replacement, options = {}) {
  const { start, end } = topLevelFunctionRange(source, name, options);
  const suffix = source.slice(end + (end < source.length ? 1 : 0));
  return `${source.slice(0, start)}${replacement.trim()}\n\n${suffix}`;
}

function stripFlatCssRules(source, patterns, label) {
  let result = source;
  let removed = 0;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("i") ? "gi" : "g";
    const matcher = new RegExp(`([^{}]*${pattern.source}[^{}]*)\\{[^{}]*\\}`, flags);
    let previous;
    do {
      previous = result;
      result = result.replace(matcher, () => {
        removed += 1;
        return "";
      });
    } while (result !== previous);
  }
  assert.ok(removed > 0, `${label}: expected at least one CSS rule to be removed`);
  return result;
}

function readSourceText(path) {
  return normalizeText(readFileSync(path, "utf8"));
}

function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, normalizeText(text), "utf8");
}

function copyExactFile(source, output) {
  assert.ok(existsSync(source), `Allowlisted source is missing: ${source}`);
  assert.ok(statSync(source).isFile(), `Allowlisted source is not a file: ${source}`);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(source, output);
}

export function transformCourseProfile(input) {
  let source = normalizeText(input);
  source = exactReplace(
    source,
    '      conjugationComet: "index.html",\n',
    "",
    "course Conjugation Comet route"
  );
  source = exactReplace(
    source,
    '      chatSettings: "caatuu-czech.chat.settings.v1",\n',
    "",
    "course profile chat storage"
  );
  source = exactReplace(source, "      chat: true,", "      chat: false,", "course chat capability");
  source = exactReplace(
    source,
    "      conjugationComet: true,\n",
    "",
    "course Conjugation Comet capability"
  );
  source = exactReplace(
    source,
    "      offlineModels: true,",
    "      offlineModels: false,",
    "course offline model capability"
  );
  assert.match(source, /semanticSearch: true/);
  return source;
}

export function transformManifest(input) {
  const manifest = JSON.parse(normalizeText(input));
  assert.equal(manifest.description, "Czech chat, verbs, dictionary, scripts, and guide.");
  assert.ok(manifest.shortcuts?.some((shortcut) => shortcut.url === "./chat.html"));
  manifest.description = "Czech verbs, dictionary, scripts, games, and learning guide.";
  manifest.shortcuts = manifest.shortcuts.filter((shortcut) => shortcut.url !== "./chat.html");
  manifest.icons = manifest.icons.filter((icon) => icon.src !== "icons/caatuu-czech-1024.png");
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function transformIndex(input) {
  let source = normalizeText(input);
  source = replaceBetween(
    source,
    '                <button\n                  class="train-world train-world-comet"',
    '                <button class="train-world train-world-case"',
    "",
    "home Conjugation Comet launcher"
  );
  source = replaceBetween(
    source,
    '            <section class="train-tab-panel word-net-panel word-net-embedded-panel embedded-game-panel" id="trainPanelConjugationComet"',
    '            <section class="train-tab-panel word-net-panel word-net-embedded-panel embedded-game-panel" id="trainPanelCaseCosmos"',
    "",
    "home Conjugation Comet panel"
  );
  return source;
}

export function transformSetupAssets(input) {
  const manifest = JSON.parse(normalizeText(input));
  assert.ok(Array.isArray(manifest.artifacts), "setup assets must declare an artifact array");
  const excluded = manifest.artifacts.filter((artifact) => artifact?.key === "planet-conjugation");
  assert.equal(excluded.length, 1, "setup assets must expose exactly one Conjugation Comet planet");
  assert.equal(excluded[0].label, "Conjugation Comet", "setup Conjugation Comet label");
  assert.equal(excluded[0].url, "/assets/planets/conjugation-comet.png", "setup Conjugation Comet URL");
  assert.equal(excluded[0].asset_path, "assets/planets/conjugation-comet.png", "setup Conjugation Comet asset path");
  manifest.artifacts = manifest.artifacts.filter((artifact) => artifact?.key !== "planet-conjugation");
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function transformRuntime(input) {
  let source = normalizeText(input);
  source = exactReplace(
    source,
    '  const modelCatalogPath = "data/models/phone-bench/models.json";\n',
    "",
    "runtime model catalog"
  );
  source = exactReplace(
    source,
    '  const webllmCdn = "https://esm.run/@mlc-ai/web-llm";\n  const browserFallbackModel = "Qwen3-0.6B-q4f16_1-MLC";\n',
    "",
    "runtime browser language model constants"
  );
  source = exactReplace(
    source,
    '  let browserEngine = null;\n  let browserEngineModelKey = "";\n  let browserModelLoad = null;\n',
    "",
    "runtime browser language model state"
  );
  source = exactReplace(
    source,
    "    return /caatuu-czech|webllm|mlc|tvm|wasm|model/i.test(name);",
    "    return /caatuu-czech/i.test(name);",
    "runtime cache scope"
  );
  source = exactReplace(
    source,
    "  async function clearBrowserCache() {\n    await unloadBrowserModel();",
    "  async function clearBrowserCache() {",
    "runtime cache model unload"
  );
  source = exactReplace(
    source,
    '          generationSource: clampReportText(payload.feedback.generationSource || "", 80),\n',
    "",
    "runtime feedback generation source"
  );
  source = exactReplace(
    source,
    '          sentenceModelKey: clampReportText(payload.feedback.sentenceModelKey || "", 120),\n          translationModelKey: clampReportText(payload.feedback.translationModelKey || "", 120),\n',
    "",
    "runtime feedback language model keys"
  );
  source = replaceTopLevelFunction(source, "sendDictionaryGapReport", `
  async function sendDictionaryGapReport() {
    throw new Error("Remote dictionary-gap reporting is disabled for storeMvp.");
  }`, { indent: "  " });
  source = exactReplace(
    source,
    "            online: () => navigator.onLine !== false,",
    "            online: () => false,",
    "dictionary-gap outbox network gate"
  );
  source = exactReplace(
    source,
    "    scheduleDictionaryGapFlush(0);\n    return { ...result, pending: outbox.list().length, automaticDelivery: true };",
    "    return { ...result, pending: outbox.list().length, automaticDelivery: false, localOnly: true };",
    "dictionary-gap enqueue policy"
  );
  source = replaceTopLevelFunction(source, "flushQueuedDictionaryGaps", `
  async function flushQueuedDictionaryGaps() {
    const outbox = await getDictionaryGapOutbox();
    outbox.refreshFromStorage();
    return {
      sent: [],
      failed: [],
      pending: outbox.list().length,
      disabled: true,
      automaticDelivery: false,
      localOnly: true
    };
  }`, { indent: "  " });
  for (const name of ["clearDictionaryGapFlushTimer", "scheduleDictionaryGapFlush"]) {
    source = removeTopLevelFunction(source, name, { indent: "  " });
  }
  source = replaceBetween(
    source,
    "  async function loadModelCatalog() {",
    "  async function searchBrowserVectorDatabase(text, options = {}) {",
    `  async function loadEmbeddingCatalog() {
    return fetchJson(embeddingCatalogPath);
  }

`,
    "runtime language model implementation"
  );
  source = replaceBetween(
    source,
    "    models: {",
    "    speech: {",
    "",
    "runtime public language model API"
  );
  source = exactReplace(
    source,
    "    clearNativeBrowserState,\n    nativeCall,\n    fetchJson,",
    "    clearNativeBrowserState,\n    fetchJson,",
    "runtime public native call escape hatch"
  );
  source = exactReplace(
    source,
    "    vector: {\n      status() {",
    "    vector: {\n      catalog: loadEmbeddingCatalog,\n      status() {",
    "runtime embedding catalog API"
  );
  source = exactReplace(
    source,
    '? nativeCall("delete_model", {}, handlers)',
    '? nativeCall("delete_local_pack", {}, handlers)',
    "runtime local pack deletion"
  );
  source = exactReplace(
    source,
    `  window.addEventListener("online", () => scheduleDictionaryGapFlush(0));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleDictionaryGapFlush(0);
  });
  scheduleDictionaryGapFlush(1_000);
`,
    "",
    "dictionary-gap automatic delivery triggers"
  );
  return source;
}

export function transformChromeJs(input) {
  let source = normalizeText(input);
  source = exactReplace(
    source,
    `    "conjugation-comet": {
      title: "Conjugation Comet",
      summary: "Choose the form",
      iconSrc: "/assets/planets/conjugation-comet.png",
      href: "index.html"
    },
`,
    "",
    "chrome Conjugation Comet presentation"
  );
  source = removeTopLevelFunction(source, "conjugationCometAvailable", { indent: "  " });
  source = removeTopLevelFunction(source, "gameLandingHref", { indent: "  " });
  source = exactReplace(
    source,
    '    if (gameId === "conjugation-comet") return conjugationCometAvailable();\n',
    "",
    "chrome Conjugation Comet availability"
  );
  source = exactReplace(
    source,
    `
    if (currentGameId() !== "conjugation-comet" || !conjugationCometAvailable()) return;
    const back = document.querySelector(".app-header-back");
    if (back) back.href = gameLandingHref("conjugation-comet");
`,
    "\n",
    "chrome Conjugation Comet navigation sync"
  );
  source = exactReplace(
    source,
    '["verb-lab", "word-net", "conjugation-comet", "case-cosmos", "agreement-aurora", "memory-moon"]',
    '["verb-lab", "word-net", "case-cosmos", "agreement-aurora", "memory-moon"]',
    "chrome Conjugation Comet navigation list"
  );
  source = exactReplace(
    source,
    '    if (document.querySelector(".conjugation-comet-page")) return "conjugation-comet";\n',
    "",
    "chrome Conjugation Comet page detection"
  );
  source = exactReplace(
    source,
    '    if (document.querySelector("#trainPanelConjugationComet:not([hidden])")) return "conjugation-comet";\n',
    "",
    "chrome Conjugation Comet panel detection"
  );
  source = exactReplace(source, "<small>AI, developer, storage</small>", "<small>Storage and app controls</small>", "chrome advanced summary");
  source = replaceBetween(
    source,
    '          <section class="settings-card side-card ai-settings-card" aria-label="Chat settings">',
    '          <section class="settings-card side-card maintenance-card" aria-label="App settings">',
    "",
    "chrome language model and developer settings"
  );
  source = replaceBetween(
    source,
    '            <div class="legal-notice" role="note">',
    '            <details class="settings-details model-details legal-details">',
    "",
    "chrome AI notice"
  );
  source = exactReplace(
    source,
    "Models, dictionaries, datasets, artwork, branding, and third-party components keep their separate terms.",
    "Dictionaries, datasets, artwork, branding, and third-party components keep their separate terms.",
    "chrome legal scope"
  );
  source = replaceBetween(
    source,
    '                <dl class="meta-list model-license-list" id="modelLicenseList">',
    "                </dl>",
    `                <dl class="meta-list model-license-list" id="embeddingLicenseList">
                  <div>
                    <dt>Caatuu Curriculum and Asset Embeddings</dt>
                    <dd>all-MiniLM-L6-v2 embedding base, Apache-2.0. Curriculum and asset provenance review pending; embeds English text only.</dd>
                  </div>
`,
    "chrome artifact licenses"
  );
  return source;
}

export function transformChromeCss(input) {
  return stripFlatCssRules(
    normalizeText(input),
    [/\.ai-settings-card/i, /\.preset-control/i, /\.capability-note/i],
    "chrome language model controls"
  );
}

export function transformAppJs(input) {
  let source = normalizeText(input);
  source = exactReplace(
    source,
    `  "conjugation-comet": {
    frameId: "conjugationCometEmbeddedGame",
    stageId: "conjugationCometEmbeddedStage",
    statusId: "conjugationCometEmbeddedStatus",
    title: "Conjugation Comet"
  },
`,
    "",
    "app Conjugation Comet embedded presentation"
  );
  source = exactReplace(
    source,
    '    "conjugation-comet": "trainPanelConjugationComet",\n',
    "",
    "app Conjugation Comet panel navigation"
  );
  source = exactReplace(
    source,
    '    "conjugation-comet": "Conjugation Comet",\n',
    "",
    "app Conjugation Comet title"
  );
  source = exactReplace(
    source,
    '["verb-lab", "word-net", "conjugation-comet", "case-cosmos", "agreement-aurora", "memory-moon"]',
    '["verb-lab", "word-net", "case-cosmos", "agreement-aurora", "memory-moon"]',
    "app Conjugation Comet navigation request"
  );
  source = replaceBetween(
    source,
    "const chatSettingsStorageKey = course.storage.chatSettings;",
    "async function loadJson(path) {",
    `const verbSpeakOnTapStorageKey = \`${'${course.storage.namespace}'}.verbNebula.speakOnTap.v1\`;

`,
    "app language model settings"
  );
  source = replaceBetween(
    source,
    "function renderModelLicenseList() {",
    "function readStoredTheme() {",
    "",
    "app language model settings functions"
  );
  source = exactReplace(
    source,
    "  syncThemeControls();\n  syncGenerationSettingsUi();\n  syncAppRuntimeControls();",
    "  syncThemeControls();\n  syncAppRuntimeControls();",
    "app settings open generation sync"
  );
  source = exactReplace(
    source,
    `  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => applyGenerationPreset(button.dataset.preset));
  });
  ["settingsModel", "thinkingEnabled", "maxTokens", "temperature", "contextSize", "reasoningDisplay"].forEach((id) => {
    const control = $(\`#\${id}\`);
    if (!control) return;
    control.addEventListener("input", readGenerationSettingsControls);
    control.addEventListener("change", readGenerationSettingsControls);
  });
`,
    "",
    "app generation control bindings"
  );
  source = exactReplace(source, "    await loadModelLicenseCatalog().catch(() => {});\n", "", "app model catalog init");
  source = exactReplace(
    source,
    "    renderModelLicenseList();\n    syncGenerationSettingsUi();\n",
    "",
    "app model settings init"
  );
  return source;
}

export function transformAppCss(input) {
  let source = normalizeText(input);
  source = exactReplace(source, ".train-world-comet .train-orbit,\n", "", "app Conjugation Comet orbit selector");
  source = exactReplace(
    source,
    `.train-world-comet {
  top: clamp(18px, 7%, 46px);
  left: clamp(12px, 8vw, 72px);
}
.train-world-comet img {
  width: clamp(68px, 19vw, 94px);
}
`,
    "",
    "app Conjugation Comet desktop presentation"
  );
  source = exactReplace(source, "  .train-world-comet,\n", "", "app Conjugation Comet mobile layout selector");
  source = exactReplace(source, "  .train-world-comet img,\n", "", "app Conjugation Comet mobile image selector");
  source = exactReplace(
    source,
    `  .train-world-comet {
    grid-column: 1;
    grid-row: 1;
  }

  .train-world-comet img {
    width: clamp(64px, 20vw, 92px);
  }

`,
    "",
    "app Conjugation Comet mobile presentation"
  );
  return stripFlatCssRules(
    source,
    [/\.ai-settings-card/i, /\.preset-control/i, /\.capability-note/i],
    "app language model controls"
  );
}

export function transformSetupJs(input) {
  let source = normalizeText(input);
  source = exactReplace(
    source,
    "    return item.key || item.modelKey || item.artifactKey || item.assetPath || item.url || item.label || \"artifact\";",
    "    return item.key || item.artifactKey || item.assetPath || item.url || item.label || \"artifact\";",
    "setup artifact key"
  );
  source = replaceBetween(
    source,
    '    if (kind === "gguf-model") {',
    '    if (kind === "embedding-vector-db" || searchable.includes("embedding")) {',
    "",
    "setup language model display group"
  );
  source = replaceBetween(
    source,
    "    const models = Array.isArray(status?.models) ? status.models : [];",
    "    if (status?.vectorDatabase) {",
    "    const rows = [];\n",
    "setup language model status rows"
  );
  source = exactReplace(
    source,
    "        key: status.vectorDatabase.modelKey || status.vectorDatabase.key || \"embeddings\",",
    "        key: status.vectorDatabase.key || \"embeddings\",",
    "setup embedding key"
  );
  return source;
}

export function transformHomeCss(input) {
  return stripFlatCssRules(normalizeText(input), [/gguf-model/i], "home model artifact styling");
}

export function transformWordNetHtml(input) {
  let source = normalizeText(input);
  source = exactReplace(source, 'aria-label="Sentence generation"', 'aria-label="Next sentence options"', "Word World options label");
  source = replaceBetween(
    source,
    '                <section class="word-net-generation-menu-section" role="group" aria-labelledby="wordNetContentSourceLabel">',
    "              </div>\n            </div>",
    "",
    "Word World content source selector"
  );
  source = exactReplace(
    source,
    "                  <dt>model</dt>\n                  <dd id=\"wordNetMetaModel\">browser fallback</dd>",
    "                  <dt>content</dt>\n                  <dd id=\"wordNetMetaModel\">curated corpus</dd>",
    "Word World diagnostics content"
  );
  source = replaceBetween(
    source,
    "    <dialog\n      class=\"word-net-generative-dialog\"",
    "    <nav\n      class=\"bottom-app-nav\"",
    "",
    "Word World optional content dialog"
  );
  return source;
}

export function transformWordNetCss(input) {
  return stripFlatCssRules(normalizeText(input), [/generative/i], "Word World optional content styling");
}

export function transformWordNetStandard(input) {
  let source = normalizeText(input);
  source = exactReplace(
    source,
    '  const contentMode = entry.contentMode === "standard" ? "standard" : "generative";',
    '  if (entry.contentMode !== "standard") return null;\n  const contentMode = "standard";',
    "Word World history mode"
  );
  source = exactReplace(
    source,
    '    source: String(entry.source || (contentMode === "standard" ? "standard-corpus" : "history")).trim().slice(0, 64),',
    '    source: String(entry.source || "standard-corpus").trim().slice(0, 64),',
    "Word World history source"
  );
  return source;
}

export function transformWordNetCore(input) {
  let source = normalizeText(input);
  for (const name of [
    "stripModelEcho",
    "sentenceIncludesWord",
    "cleanGeneratedSentence",
    "cleanTranslation",
    "isRecentSentence",
    "isPlausibleSentence",
    "sentenceTargets"
  ]) {
    source = removeTopLevelFunction(source, name, { exported: true });
  }
  return source;
}

export function transformWordNetJs(input) {
  let source = normalizeText(input);
  source = replaceBetween(
    source,
    "import {\n  alignWordReconstructionAttempt,",
    "const WORD_NET_MODEL_KEY =",
    `import {
  alignWordReconstructionAttempt,
  buildWordReconstructionChallenge,
  interpretHorizontalSwipe,
  isMiscellaneousAssetPath,
  isReservedEdgeGesture,
  isWordReconstructionCorrect,
  isSpeechSynthesisSupported,
  normalizeWord,
  parseSceneKeymap,
  selectDictionaryMeaning,
  selectSpeechSynthesisVoice,
  sentenceFingerprint,
  resolveSpeechPace,
  tokenizeCzechSentence,
  wordMatchesTarget
} from "./word-net-core.mjs?v=word-net-core-18";
import {
  loadStandardWordWorldCorpus,
  migrateWordWorldHistory,
  selectStandardTurn
} from "./word-net-standard.mjs?v=word-net-standard-5";

`,
    "Word World imports"
  );
  source = replaceBetween(
    source,
    "const WORD_NET_MODEL_KEY =",
    "const SCENE_KEYMAP_URL =",
    "",
    "Word World model constants"
  );
  source = exactReplace(source, "const CONTENT_MODE_STORAGE_KEY = `${course.storage.namespace}.wordNet.contentMode.v1`;\n", "", "Word World content mode storage");
  source = exactReplace(source, "const PREPARED_QUEUE_STORAGE_KEY = `${course.storage.namespace}.wordNet.preparedQueue.v2`;\n", "", "Word World prepared queue storage");
  source = replaceBetween(
    source,
    "const PREPARED_QUEUE_CAPACITY = 512;",
    "const translationModes = {",
    "",
    "Word World language model queue constants"
  );
  source = replaceBetween(
    source,
    "const contentModes = {",
    "const audioSpeedOptions = Object.freeze([",
    "",
    "Word World content modes"
  );
  source = replaceBetween(
    source,
    "const seedWords = [",
    "const seedEnglish = {",
    "",
    "Word World fallback sentence templates"
  );
  source = exactReplace(source, "  generativeTurnActive: false,\n", "", "Word World optional turn state");
  source = exactReplace(source, "  contentMode: loadContentMode(),", '  contentMode: "standard",', "Word World forced Standard mode");
  source = exactReplace(source, "  translationCache: loadTranslationCache(),\n", "", "Word World retired translation cache state");
  source = replaceBetween(
    source,
    "  branchQueue: new WordNetBranchQueue({",
    "  phraseRequestId: 0,",
    "",
    "Word World prepared queue state"
  );
  source = replaceBetween(
    source,
    "  backgroundController: null,",
    "  robotRowsPromise: null,",
    "",
    "Word World background generation state"
  );
  source = replaceTopLevelFunction(source, "loadHistory", `
function loadHistory() {
  const current = readStoredArray(HISTORY_STORAGE_KEY);
  const legacy = current.length ? [] : readStoredArray(LEGACY_HISTORY_STORAGE_KEY);
  return migrateWordWorldHistory(current.length ? current : legacy, { limit: HISTORY_LIMIT })
    .filter((entry) => entry?.contentMode === "standard");
}`);
  for (const name of [
    "loadPreparedQueue",
    "savePreparedQueue",
    "loadTranslationCache",
    "saveTranslationCache",
    "generationAvoidList",
    "queueAvoidFingerprints",
    "queueWordsForSentence",
    "rememberPreparedCandidate",
    "hydrateQueueFromHistory",
    "restoreSavedGenerativePhraseAtInit",
    "wordNetPrompt",
    "translationPrompt",
    "nativeWordNetRuntimeAvailable",
    "nativeTranslationRuntimeAvailable",
    "localSentence",
    "diagnosticsPhase",
    "diagnosticsModel",
    "diagnosticsSource",
    "loadContentMode",
    "hasContentMode",
    "saveContentMode",
    "syncContentControl",
    "abortOptionalGenerationDownloads",
    "setContentMode",
    "confirmGenerativeMode",
    "requestContentMode",
    "takeQueuedRandomCandidate",
    "generateRandomPhrase",
    "isAbortError",
    "cacheTranslation",
    "requestEnglishTranslation",
    "prepareCandidateForDisplay",
    "presentPreparedCandidate",
    "translateCurrentSentence",
    "enrichCurrentPhrase",
    "clearPrefetchTimer",
    "prefetchAllowance",
    "schedulePrefetch",
    "prefetchPriorityWords",
    "nextPrefetchTarget",
    "untranslatedPreparedCandidates",
    "freshTranslatedPreparedCount",
    "translatePreparedBatch",
    "runPrefetch",
    "requestSentenceCandidate",
    "updateHistoryTranslation",
    "generateSentenceForWord",
    "showPreparedPhrase",
    "freshSeedWord"
  ]) {
    source = removeTopLevelFunction(source, name);
  }
  source = replaceTopLevelFunction(source, "syncDiagnostics", `
function syncDiagnostics() {
  const phase = state.standardCorpusLoading ? "loading corpus" : state.busy ? "loading" : state.currentSentence ? "ready" : "starting";
  const difficulty = learningDifficulty();
  const standardCounts = state.standardProvider?.difficultyCounts?.() || { 1: 0, 2: 0, 3: 0 };
  const eligibleStandard = standardCounts[1]
    + (difficulty >= 2 ? standardCounts[2] : 0)
    + (difficulty >= 3 ? standardCounts[3] : 0);
  const history = state.historyCursor
    ? \`${'${state.history.length}'} · back ${'${state.historyCursor}'}\`
    : String(state.history.length);
  const mode = generationModes[state.generationMode]?.label || generationModes.random.label;
  const values = {
    wordNetMetaPhase: phase,
    wordNetMetaModel: "curated corpus",
    wordNetMetaQueue: \`${'${eligibleStandard}'} eligible · ${'${state.standardProvider?.usage?.entries?.size || 0}'} seen\`,
    wordNetMetaMode: \`Standard · ${'${mode}'} · L${'${difficulty}'}\`,
    wordNetMetaSource: state.currentGenerationSource || "standard-corpus",
    wordNetMetaHistory: history
  };
  for (const [id, value] of Object.entries(values)) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }
  const poolLabel = $("#wordNetMetaPoolLabel");
  if (poolLabel) poolLabel.textContent = "corpus";
  const summary = $("#wordNetDiagnosticsSummary");
  if (summary) summary.textContent = \`${'${phase}'} · Standard · L${'${difficulty}'} · ${'${eligibleStandard}'} eligible\`;
}`);
  source = replaceTopLevelFunction(source, "generateFromConfiguredMode", `
function generateFromConfiguredMode(mode = state.generationMode, { force = false } = {}) {
  if (state.guidedRequested || state.busy) return;
  if (!force && shouldBlockReconstructionAdvance()) return;
  void generateStandardFromConfiguredMode(mode);
}`);
  source = replaceTopLevelFunction(source, "cancelBackgroundWork", `
function cancelBackgroundWork() {
  // storeMvp has no optional background sentence jobs to cancel.
}`);
  source = replaceTopLevelFunction(source, "setTranslationMode", `
function setTranslationMode(mode, { closeMenu = true } = {}) {
  if (guidedWordInteractionLocked() || !hasTranslationMode(mode)) return;
  state.translationMode = mode;
  saveTranslationMode();
  applyTranslationMode({ restartTimer: true });
  setStatus(currentPlayInstruction());
  if (closeMenu) closeTranslationMenu({ restoreFocus: true });
  if (mode === "off") {
    if (state.speechSource === "word") cancelCzechSpeech();
    abortWordLookup();
  } else if (state.selectedWord && !state.selectedWordMeaning) {
    void lookupSelectedWord(state.selectedWord);
  }
  if (state.currentSentence) {
    setTranslation(state.currentTranslation);
    if (state.guidedMode) hideSceneAsset({ cancel: true });
    else void updateSceneAsset(state.currentSceneQuery || state.currentTranslation || localTranslation(state.currentSentence, state.currentWord));
  }
}`);
  source = replaceTopLevelFunction(source, "rememberStep", `
function rememberStep(word, sentence, metadata = {}) {
  const fingerprint = sentenceFingerprint(sentence);
  const alreadyRemembered = state.history.some((entry) => sentenceFingerprint(entry.sentence) === fingerprint);
  state.history = state.history.filter((entry) => sentenceFingerprint(entry.sentence) !== fingerprint);
  state.history.unshift({
    id: String(metadata.id || ""),
    word,
    sentence,
    en: String(metadata.en || ""),
    contentMode: "standard",
    source: String(metadata.source || state.currentGenerationSource || "standard-corpus"),
    corpusVersion: String(metadata.corpusVersion || ""),
    difficulty: Number(metadata.difficulty) >= 1 && Number(metadata.difficulty) <= 3
      ? Math.floor(Number(metadata.difficulty))
      : null,
    sceneQuery: String(metadata.sceneQuery || metadata.en || "")
  });
  state.history = state.history.slice(0, HISTORY_LIMIT);
  state.historyCursor = 0;
  saveHistory();
  if (!alreadyRemembered) window.CaatuuLearning?.record("word-world", { activities: 1 });
  renderTrail();
  syncDiagnostics();
}`);
  source = replaceTopLevelFunction(source, "showPreviousSentence", `
async function showPreviousSentence() {
  if (state.guidedRequested) {
    setStatus("History is disabled while the exact Guided task is active.", { tone: "muted" });
    return;
  }
  if (state.busy || shouldBlockReconstructionAdvance()) return;
  const previousIndex = state.historyCursor + 1;
  const previous = state.history[previousIndex];
  if (!previous) {
    setStatus("There is no earlier sentence yet.", { tone: "muted" });
    return;
  }
  const transitionStartedAt = performance.now();
  const requestId = state.phraseRequestId + 1;
  state.phraseRequestId = requestId;
  hideSceneAsset({ cancel: true });
  setBusy(true);
  setStatus("Restoring the previous sentence.", { tone: "active" });
  try {
    state.historyCursor = previousIndex;
    state.currentWord = previous.word;
    state.currentSentence = previous.sentence;
    state.currentTranslation = previous.en || "";
    state.currentSceneQuery = previous.sceneQuery || previous.en || "";
    state.currentEntryId = previous.id || "";
    state.currentCorpusVersion = previous.corpusVersion || "";
    state.currentDifficulty = previous.difficulty || null;
    state.currentStandardRecord = state.standardProvider?.records?.find((record) => record.id === previous.id) || null;
    state.currentContentMode = "standard";
    state.currentGenerationSource = previous.source || "standard-corpus";
    selectWord(previous.word, { lookup: state.translationMode !== "off", render: false });
    setTranslation(previous.en || "");
    renderCzechSentence(previous.sentence, previous.word);
    resetSentenceFeedback();
    setProgress(null);
    const sceneText = previous.sceneQuery || previous.en || localTranslation(previous.sentence, previous.word);
    await Promise.all([holdSentenceTransition(transitionStartedAt), updateSceneAsset(sceneText)]);
    if (requestId === state.phraseRequestId) setStatus("Previous Standard sentence restored.", { tone: "muted" });
  } finally {
    if (requestId === state.phraseRequestId) setBusy(false);
  }
}`);
  source = exactReplace(source, "    generationSource: state.currentGenerationSource,\n", "", "Word World feedback source");
  source = exactReplace(
    source,
    `    ...snapshot,
    ...(snapshot.contentMode === "generative" ? {
      sentenceModelKey: WORD_NET_MODEL_KEY,
      translationModelKey: TRANSLATION_MODEL_KEY
    } : {})
`,
    "    ...snapshot\n",
    "Word World feedback model metadata"
  );
  source = exactReplace(
    source,
    `  $("#wordNetContentSource")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-content-mode]");
    if (!button || button.disabled) return;
    closeGenerationMenu();
    await requestContentMode(button.dataset.contentMode);
  });
`,
    "",
    "Word World content source binding"
  );
  source = exactReplace(source, "  syncContentControl();\n", "", "Word World retired content control calls", 3);
  source = exactReplace(
    source,
    ': `Selected "${button.dataset.word}". Choose ↻ in Generation to continue with it.`,',
    ': `Selected "${button.dataset.word}". Choose ↻ to continue with it.`,',
    "Word World selected-word status"
  );
  source = exactReplace(
    source,
    `      if (!state.busy && state.currentSentence) {
        if (state.translationMode !== "off" && !state.currentTranslation) void enrichCurrentPhrase();
        else schedulePrefetch(state.currentSentence, 180);
      }
`,
    "",
    "Word World background work resume"
  );
  source = replaceTopLevelFunction(source, "init", `
async function init() {
  bindEmbeddedShellBridge();
  bindUi();
  syncDisplaySettingsControl();
  initializeSpeechControl();
  runtimeAdapter()?.registerServiceWorker?.().catch(() => {});
  await initializeGuidedWordWorldMode();
  const diagnostics = $("#wordNetDiagnostics");
  if (diagnostics) diagnostics.open = false;
  applyTranslationMode();
  renderCzechSentence("");
  syncGenerationControl();
  syncWordTranslation();
  syncDiagnostics();
  renderWordGuidedStatus();
  setStatus(playInstruction);
  setBusy(true);
  if (state.guidedRequested && !state.guidedMode) {
    setStatus("Guided Word World is locked because its curriculum contract could not be verified.", { tone: "error" });
    renderWordGuidedStatus();
    setBusy(false);
    return;
  }
  setStatus(state.guidedRequested ? "Preparing the exact Guided developer task." : "Preparing the guided sentence pack.", { tone: "active" });
  try {
    await initializeStandardCorpus();
    if (state.guidedRequested) await generateGuidedStandardPhrase({ allowBusy: true });
    else await generateStandardFromConfiguredMode("random", { allowBusy: true });
  } finally {
    if (state.busy) setBusy(false);
  }
}`);
  return source;
}

const TRANSFORMS = Object.freeze({
  "index.html": transformIndex,
  "manifest.webmanifest": transformManifest,
  "setup-assets.json": transformSetupAssets,
  "source/features/home/home.css": transformHomeCss,
  "source/features/setup/setup.js": transformSetupJs,
  "source/games/verb-nebula/app.css": transformAppCss,
  "source/games/verb-nebula/app.js": transformAppJs,
  "source/games/word-world/word-net-core.mjs": transformWordNetCore,
  "source/games/word-world/word-net-standard.mjs": transformWordNetStandard,
  "source/games/word-world/word-net.css": transformWordNetCss,
  "source/games/word-world/word-net.js": transformWordNetJs,
  "source/shared/chrome.css": transformChromeCss,
  "source/shared/chrome.js": transformChromeJs,
  "source/shared/course-profile.js": transformCourseProfile,
  "source/shared/runtime.js": transformRuntime,
  "word-net.html": transformWordNetHtml
});

function assertSafeOutputDirectory(outputDir, workspaceRoot, languageStaticDir, launcherStaticDir) {
  const output = resolve(outputDir);
  assert.ok(output.toLowerCase().includes("store-mvp"), "Output path must contain 'store-mvp'");
  for (const protectedPath of [workspaceRoot, languageStaticDir, launcherStaticDir]) {
    assert.notEqual(output.toLowerCase(), resolve(protectedPath).toLowerCase(), `Refusing to replace protected path: ${output}`);
  }
  assert.ok(dirname(output) !== output, `Refusing to replace filesystem root: ${output}`);
  const workspaceRelative = relative(resolve(workspaceRoot), output);
  const insideWorkspace = workspaceRelative !== ""
    && !workspaceRelative.startsWith(`..${sep}`)
    && workspaceRelative !== ".."
    && !isAbsolute(workspaceRelative);
  if (insideWorkspace) {
    const allowedRoot = resolve(workspaceRoot, "apps/android/storeMvp/build");
    const allowedRelative = relative(allowedRoot, output);
    assert.ok(
      allowedRelative !== ""
        && !allowedRelative.startsWith(`..${sep}`)
        && allowedRelative !== ".."
        && !isAbsolute(allowedRelative),
      `In-workspace store output must be inside ${allowedRoot}`
    );
  }
}

function allFiles(root) {
  const result = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) result.push(slashPath(relative(root, fullPath)));
      else throw new Error(`Store asset output may not contain links or special files: ${fullPath}`);
    }
  };
  visit(root);
  return result.sort();
}

function serviceWorkerSource(paths, developmentSource) {
  const source = normalizeText(developmentSource);
  assert.equal(countOccurrences(source, "function isModelRuntimeRequest(url) {"), 1, "service worker model runtime anchor");
  assert.ok(source.includes('"./source/features/chat/chat.js'), "service worker must still expose the development Chat anchor");
  for (const anchor of [
    '"./conjugation-comet.html"',
    '"./source/games/conjugation-comet/conjugation-comet.css',
    '"./source/games/conjugation-comet/conjugation-comet.js',
    '"/assets/planets/conjugation-comet.png"',
    '"./data/games/conjugation-comet/verbs.json'
  ]) {
    assert.equal(
      countOccurrences(source, anchor),
      1,
      `service worker Conjugation Comet anchor ${anchor}`
    );
  }
  const coreAssets = ["./", ...paths
    .filter((path) => path !== "sw.js")
    .map((path) => `./${path}`)];
  return `const CACHE_NAME = "caatuu-czech-pwa-store-mvp-v1";
const CORE_ASSETS = ${JSON.stringify(coreAssets, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then((cache) => cache.addAll(CORE_ASSETS))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys
      .filter((key) => key.startsWith("caatuu-czech-pwa-") && key !== CACHE_NAME)
      .map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (request.cache === "no-store") {
    event.respondWith(fetch(request));
  } else if (request.cache === "reload" || request.mode === "navigate" || ["document", "script", "style"].includes(request.destination)) {
    event.respondWith(networkThenCache(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

async function cacheFirst(request) {
  const cached = await currentCacheMatch(request);
  if (cached) return cached;
  const response = await fetch(request);
  await cacheResponse(request, response);
  return response;
}

async function networkThenCache(request) {
  try {
    const response = await fetch(new Request(request, { cache: "reload" }));
    await cacheResponse(request, response);
    return response;
  } catch (error) {
    let cached = await currentCacheMatch(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallbackUrl = new URL(request.url);
      if (fallbackUrl.origin === location.origin && fallbackUrl.search) {
        fallbackUrl.search = "";
        cached = await currentCacheMatch(fallbackUrl.href);
        if (cached) return cached;
      }
    }
    throw error;
  }
}

async function currentCacheMatch(request) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(request);
}

async function cacheResponse(request, response) {
  if (!response || response.status !== 200) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (error) {
    // The offline cache is opportunistic; quota pressure must not hide a valid response.
  }
}
`;
}

function checkJavaScriptSyntax(path, source) {
  const moduleSyntax = /(^|\n)\s*(?:import\s+(?!\()|export\s+)|\bimport\.meta\b/m.test(source);
  const result = spawnSync(
    process.execPath,
    ["--input-type", moduleSyntax ? "module" : "commonjs", "--check"],
    { input: source, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );
  assert.equal(result.status, 0, `${path}: node --check failed\n${result.stderr || result.stdout}`);
}

function localModuleReferences(source) {
  const references = new Set();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) references.add(match[1]);
  }
  return [...references].filter((value) => value.startsWith("."));
}

function assertImportReferences(outputDir, files) {
  for (const path of files.filter((item) => [".js", ".mjs"].includes(extension(item)))) {
    if (path.startsWith("vendor/")) continue;
    const source = readSourceText(join(outputDir, path));
    checkJavaScriptSyntax(path, source);
    for (const reference of localModuleReferences(source)) {
      const cleanReference = reference.split(/[?#]/, 1)[0];
      const target = resolve(outputDir, dirname(path), cleanReference);
      assert.ok(existsSync(target) && statSync(target).isFile(), `${path}: missing module import ${reference}`);
    }
  }
}

function assertHtmlReferences(outputDir, files) {
  const pattern = /\b(?:src|href|data-src)\s*=\s*["']([^"']+)["']/g;
  for (const path of files.filter((item) => extension(item) === ".html")) {
    const source = readSourceText(join(outputDir, path));
    for (const match of source.matchAll(pattern)) {
      const reference = match[1];
      if (!reference || reference.startsWith("#") || reference.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(reference)) continue;
      const cleanReference = reference.split(/[?#]/, 1)[0];
      if (!cleanReference) continue;
      const target = resolve(outputDir, dirname(path), decodeURIComponent(cleanReference));
      assert.ok(existsSync(target) && statSync(target).isFile(), `${path}: missing HTML reference ${reference}`);
    }
  }
}

function assertNoForbiddenPaths(files) {
  const forbidden = [
    /(^|\/)chat(?:\.|\/)/i,
    /(^|\/)data\/models(?:\/|$)/i,
    /(^|\/)games\/(?:godot|runtime|exports?)(?:\/|$)/i,
    /godot/i,
    /word-net-queue/i,
    /conjugation-comet/i,
    /data\/embeddings\/.*\/(?:runtime\/|.*\.(?:sqlite|db|onnx|bin|safetensors|wasm)$)/i
  ];
  for (const path of files) {
    for (const pattern of forbidden) assert.doesNotMatch(path, pattern, `Forbidden store asset path: ${path}`);
  }
}

function assertFirstPartySurface(outputDir, files) {
  const executableUi = files.filter((path) =>
    !path.startsWith("vendor/") && [".css", ".html", ".js", ".mjs", ".webmanifest"].includes(extension(path))
  );
  const forbidden = /generative|webllm|web-llm|gguf|qwen|cstinyllama|data\/models|chat\.html|source\/features\/chat|word-net-queue|report_dictionary_gap|\/cz\/api\/dictionary\/gaps|godot|conjugation(?:[- ]?comet)|train-world-comet/i;
  for (const path of executableUi) {
    assert.doesNotMatch(readSourceText(join(outputDir, path)), forbidden, `Forbidden store surface survived in ${path}`);
  }
}

function assertNoConjugationCometSurface(outputDir, files) {
  const forbidden = /conjugation(?:[- ]?comet)|train-world-comet/i;
  for (const path of files) {
    assert.doesNotMatch(path, forbidden, `Conjugation Comet path survived in storeMvp: ${path}`);
    if (!TEXT_EXTENSIONS.has(extension(path))) continue;
    assert.doesNotMatch(
      readSourceText(join(outputDir, path)),
      forbidden,
      `Conjugation Comet reference survived in storeMvp: ${path}`
    );
  }
}

function assertVectorConfinement(outputDir) {
  const vector = readSourceText(join(outputDir, "source/shared/vector-db.js"));
  assert.match(vector, /env\.allowRemoteModels = false;/);
  assert.match(vector, /env\.allowLocalModels = true;/);
  assert.match(vector, /pipeline\("feature-extraction", this\.modelId, \{/);
  assert.match(vector, /local_files_only: true/);
  assert.doesNotMatch(vector, /allowRemoteModels = true/);
}

function assertRuntimeBoundary(outputDir) {
  const runtime = readSourceText(join(outputDir, "source/shared/runtime.js"));
  assert.doesNotMatch(runtime, /modelCatalogPath|browserEngine|browserModelLoad|\.models\s*=|\bmodels:\s*\{|nativeCall\("(?:prompt|load|status|start_download|cancel_download|reset_conversation|delete_model|report_dictionary_gap)"/);
  assert.doesNotMatch(runtime, /^\s+nativeCall,\s*$/m);
  assert.doesNotMatch(runtime, /\/cz\/api\/dictionary\/gaps/);
  assert.match(runtime, /catalog: loadEmbeddingCatalog/);
  assert.match(runtime, /nativeCall\("delete_local_pack"/);
  assert.match(runtime, /online: \(\) => false/);
  assert.match(runtime, /automaticDelivery: false, localOnly: true/);
  assert.doesNotMatch(runtime, /scheduleDictionaryGapFlush\(/);
}

function assertSetupBoundary(outputDir, languageStaticDir) {
  const outputPath = join(outputDir, "setup-assets.json");
  const developmentSource = readSourceText(join(languageStaticDir, "setup-assets.json"));
  assert.equal(
    readSourceText(outputPath),
    normalizeText(transformSetupAssets(developmentSource)),
    "setup manifest must equal the reviewed store transform"
  );
  const manifest = JSON.parse(readFileSync(outputPath, "utf8"));
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  assert.ok(artifacts.length > 0, "setup manifest must retain artifacts");
  assert.ok(artifacts.some((artifact) => String(artifact.artifact_kind || artifact.kind || "").includes("embedding") || String(artifact.key || "").includes("embedding")), "setup must retain embedding artifacts");
  const dictionaryCatalogPath = join(outputDir, "data/dictionaries/catalog.json");
  assert.ok(existsSync(dictionaryCatalogPath), "store output must retain the dictionary catalog");
  const dictionaryCatalog = JSON.parse(readFileSync(dictionaryCatalogPath, "utf8"));
  const dictionaries = Array.isArray(dictionaryCatalog.dictionaries) ? dictionaryCatalog.dictionaries : [];
  const activeDictionary = dictionaries.find((dictionary) => dictionary.status === "active" && (
    dictionary.default === true || dictionary.key === dictionaryCatalog.default_dictionary_key
  )) || dictionaries.find((dictionary) => dictionary.status === "active");
  assert.ok(activeDictionary, "dictionary catalog must retain an active dictionary");
  assert.ok(Number(activeDictionary.bytes || activeDictionary.expected_bytes) > 0, "active dictionary must declare bytes");
  assert.match(String(activeDictionary.sha256 || ""), /^[a-f\d]{64}$/i, "active dictionary must be hash-pinned");
  assert.ok(String(activeDictionary.download_url || activeDictionary.url || "").trim(), "active dictionary must declare a download URL");
  for (const artifact of artifacts) {
    const surface = `${artifact.artifact_kind || artifact.kind || ""} ${artifact.url || ""} ${artifact.key || ""}`;
    assert.doesNotMatch(surface, /gguf|data\/models|godot|conjugation(?:[- ]?comet)/i);
  }
  const setup = readSourceText(join(outputDir, "source/features/setup/setup.js"));
  assert.doesNotMatch(setup, /gguf|status\?\.models|modelKey/i);
  assert.match(setup, /status\?\.vectorDatabase/);
}

function assertWordWorldBoundary(outputDir) {
  const paths = [
    "word-net.html",
    "source/games/word-world/word-net.css",
    "source/games/word-world/word-net.js",
    "source/games/word-world/word-net-core.mjs",
    "source/games/word-world/word-net-standard.mjs"
  ];
  const surface = paths.map((path) => readSourceText(join(outputDir, path))).join("\n");
  assert.doesNotMatch(surface, /generative|WordNetBranchQueue|runtimeAdapter\(\)\.models|WORD_NET_MODEL_KEY|TRANSLATION_MODEL_KEY|requestSentenceCandidate|requestEnglishTranslation|loadTranslationCache|syncContentControl/i);
  assert.match(readSourceText(join(outputDir, "source/games/word-world/word-net.js")), /contentMode: "standard"/);
  assert.match(readSourceText(join(outputDir, "source/games/word-world/word-net-standard.mjs")), /entry\.contentMode !== "standard"\) return null/);
}

function assertServiceWorkerBoundary(outputDir) {
  const source = readSourceText(join(outputDir, "sw.js"));
  assert.doesNotMatch(source, /isModelRuntimeRequest|huggingface|esm\.run|github\.com|chat|conjugation(?:[- ]?comet)/i);
  const match = /const CORE_ASSETS = (\[[\s\S]*?\]);/.exec(source);
  assert.ok(match, "store service worker must declare CORE_ASSETS");
  const assets = JSON.parse(match[1]);
  for (const asset of assets) {
    if (asset === "./") continue;
    assert.ok(asset.startsWith("./"), `Service worker core asset must be same-origin relative: ${asset}`);
    const target = join(outputDir, asset.slice(2));
    assert.ok(existsSync(target) && statSync(target).isFile(), `Service worker references missing core asset: ${asset}`);
  }
}

export function validateStoreMvpAssets({
  outputDir,
  languageStaticDir = join(defaultWorkspaceRoot, "apps/languages/czech/static")
}) {
  const resolvedOutput = resolve(outputDir);
  assert.ok(existsSync(resolvedOutput), `Store output does not exist: ${resolvedOutput}`);
  const files = allFiles(resolvedOutput);
  assert.deepEqual(files, [...STORE_OUTPUT_FILES].sort(), "Store output must equal the exact reviewed allowlist");
  assertNoForbiddenPaths(files);
  assertFirstPartySurface(resolvedOutput, files);
  assertNoConjugationCometSurface(resolvedOutput, files);
  assertVectorConfinement(resolvedOutput);
  assertRuntimeBoundary(resolvedOutput);
  assertSetupBoundary(resolvedOutput, resolve(languageStaticDir));
  assertWordWorldBoundary(resolvedOutput);
  assertServiceWorkerBoundary(resolvedOutput);
  assertImportReferences(resolvedOutput, files);
  assertHtmlReferences(resolvedOutput, files);

  const profile = JSON.parse(readFileSync(join(resolvedOutput, "store-mvp-profile.json"), "utf8"));
  assert.deepEqual(profile, STORE_MVP_PROFILE, "storeMvp profile marker must use the exact release schema");
  const course = readSourceText(join(resolvedOutput, "source/shared/course-profile.js"));
  assert.match(course, /chat: false/);
  assert.match(course, /offlineModels: false/);
  assert.match(course, /semanticSearch: true/);
  const manifest = JSON.parse(readFileSync(join(resolvedOutput, "manifest.webmanifest"), "utf8"));
  assert.ok(manifest.shortcuts.every((shortcut) => shortcut.url !== "./chat.html"));

  const totalBytes = files.reduce((sum, path) => sum + statSync(join(resolvedOutput, path)).size, 0);
  return { outputDir: resolvedOutput, fileCount: files.length, totalBytes, files };
}

export function compileStoreMvpAssets({
  workspaceRoot = defaultWorkspaceRoot,
  languageStaticDir = join(workspaceRoot, "apps/languages/czech/static"),
  launcherStaticDir = join(workspaceRoot, "apps/launcher/static"),
  outputDir = join(workspaceRoot, "apps/android/storeMvp/build/generated/assets/store-mvp")
} = {}) {
  const resolvedWorkspace = resolve(workspaceRoot);
  const resolvedLanguage = resolve(languageStaticDir);
  const resolvedLauncher = resolve(launcherStaticDir);
  const resolvedOutput = resolve(outputDir);
  assertSafeOutputDirectory(resolvedOutput, resolvedWorkspace, resolvedLanguage, resolvedLauncher);
  assert.ok(existsSync(resolvedLanguage), `Czech static source is missing: ${resolvedLanguage}`);
  assert.ok(existsSync(resolvedLauncher), `Launcher static source is missing: ${resolvedLauncher}`);

  rmSync(resolvedOutput, { recursive: true, force: true });
  mkdirSync(resolvedOutput, { recursive: true });
  for (const path of STORE_LANGUAGE_FILES) {
    if (path === "sw.js") continue;
    const sourcePath = join(resolvedLanguage, path);
    const outputPath = join(resolvedOutput, path);
    const transform = TRANSFORMS[path];
    if (transform) {
      assert.ok(TEXT_EXTENSIONS.has(extension(path)), `Transform target must be text: ${path}`);
      writeText(outputPath, transform(readSourceText(sourcePath)));
    } else {
      copyExactFile(sourcePath, outputPath);
    }
  }
  for (const { source, output } of STORE_LAUNCHER_FILES) {
    copyExactFile(join(resolvedLauncher, source), join(resolvedOutput, output));
  }
  writeText(join(resolvedOutput, "store-mvp-profile.json"), `${JSON.stringify(STORE_MVP_PROFILE, null, 2)}\n`);
  const preWorkerFiles = [...STORE_OUTPUT_FILES].filter((path) => path !== "sw.js").sort();
  writeText(
    join(resolvedOutput, "sw.js"),
    serviceWorkerSource(preWorkerFiles, readSourceText(join(resolvedLanguage, "sw.js")))
  );
  return validateStoreMvpAssets({ outputDir: resolvedOutput, languageStaticDir: resolvedLanguage });
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help") return { help: true };
    const value = argv[index + 1];
    assert.ok(value && !value.startsWith("--"), `Missing value for ${key}`);
    index += 1;
    if (key === "--workspace-root") options.workspaceRoot = resolve(value);
    else if (key === "--language-static" || key === "--source") options.languageStaticDir = resolve(value);
    else if (key === "--launcher-static" || key === "--launcher") options.launcherStaticDir = resolve(value);
    else if (key === "--output") options.outputDir = resolve(value);
    else throw new Error(`Unknown argument: ${key}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: node apps/android/tooling/build-store-mvp-assets.mjs [--output DIR] [--workspace-root DIR] [--source DIR|--language-static DIR] [--launcher DIR|--launcher-static DIR]\n");
  } else {
    const result = compileStoreMvpAssets(options);
    process.stdout.write(`${JSON.stringify({
      profile: STORE_MVP_PROFILE.profile,
      outputDir: result.outputDir,
      fileCount: result.fileCount,
      totalBytes: result.totalBytes
    }, null, 2)}\n`);
  }
}
