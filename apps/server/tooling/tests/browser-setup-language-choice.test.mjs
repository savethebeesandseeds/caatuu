import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../../../../", import.meta.url);
const [
  setupSource,
  appEntry,
  bootstrapSource,
  homeStyles,
  initialThemeSource,
  chromeSource,
  workspaceSource
] = await Promise.all([
  readFile(new URL("apps/languages/czech/static/source/features/setup/setup.js", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/app/index.html", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/source/app-bootstrap.mjs", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/styles/caatuu-home.css", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/source/initial-theme.js", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/source/caatuu-chrome.js", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/source/caatuu-workspace.js", repoRoot), "utf8")
]);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("browser first run waits for a language choice before setup work", () => {
  const initSetup = sourceBetween(setupSource, "  async function initSetup()", "  async function refreshUpdateAvailability()");
  const browserBranch = sourceBetween(
    initSetup,
    "      if (!hasNativeRuntime()) {",
    "      setupMode = \"native\";"
  );

  assert.match(browserBranch, /const status = await runtime\.setup\.status\(\);/u);
  assert.match(browserBranch, /if \(!status\.ready\) \{\s*renderBrowserLanguageSelection\(\);\s*return;\s*\}/u);
  assert.doesNotMatch(browserBranch, /startSetup\(|loadSetupVisualFrames\(/u);
  assert.match(browserBranch, /await renderStatus\(status\);/u);
});

test("the first-run form projects base and target languages without starting on a radio change", () => {
  const chooser = sourceBetween(setupSource, "  function setupCourseRecords()", "  function formatBytes(");
  const targetChoice = sourceBetween(
    chooser,
    "  function createSetupCourseChoice(record)",
    "  function renderSetupTargetChoices()"
  );

  assert.match(chooser, /course\?\.courseSelector\?\.schemaVersion === 1/u);
  assert.match(chooser, /\["active", "development"\]\.includes\(record\?\.status\)/u);
  assert.match(chooser, /function setupSourceLanguages\(records = setupCourseRecords\(\)\)/u);
  assert.match(chooser, /sourceOptions\.replaceChildren\(\.\.\.sourceLanguages\.map\(createSetupSourceChoice\)\)/u);
  assert.match(chooser, /options\.replaceChildren\(\.\.\.matching\.map\(createSetupCourseChoice\)\)/u);
  assert.match(chooser, /form\.addEventListener\("submit"[\s\S]*void chooseSetupCourse\(record\);/u);
  assert.doesNotMatch(targetChoice, /chooseSetupCourse\(/u);
  assert.match(chooser, /if \(record\.id !== course\.id\) \{\s*window\.location\.assign\(record\.entryPath\);/u);
  assert.match(chooser, /await loadSetupVisualFrames\(\);\s*applyStageArt\(\);[\s\S]*await startSetup\(\);/u);
  assert.match(chooser, /setText\("#setupPhase", "Local setup"\)/u);
  assert.doesNotMatch(chooser, /Before local setup/u);
  assert.match(chooser, /Nothing is downloaded until you continue\./u);
});

test("the shared home exposes a two-question language form and the game display menu", () => {
  assert.match(appEntry, /id="setupLanguageSelection"[^>]*hidden/u);
  assert.match(appEntry, /<form[^>]*id="setupLanguageForm"/u);
  assert.match(appEntry, /<fieldset[^>]*id="setupSourceLanguageQuestion"[\s\S]*What language do you speak\?/u);
  assert.match(appEntry, /<fieldset[^>]*id="setupTargetLanguageQuestion"[^>]*disabled[\s\S]*What language do you want to learn\?/u);
  assert.match(appEntry, /id="setupLanguageContinue" type="submit" disabled/u);
  assert.match(appEntry, /class="verb-toolbar-menu verb-display-menu workspace-display-menu"[^>]*id="setupDisplayMenu"/u);
  assert.match(appEntry, /id="setupDisplayMenu"[\s\S]*dark_mode_ui\.png[\s\S]*data-theme-option="light"[\s\S]*data-theme-option="dark"[\s\S]*data-font-size-option="largest"/u);
  assert.match(homeStyles, /\.native-setup-card\.is-choosing-language \.setup-progress/u);
  assert.match(homeStyles, /\.setup-language-selection \.setup-language-choice/u);
  assert.match(homeStyles, /body\.choosing-setup-language \.workspace-display-menu/u);
  assert.match(homeStyles, /\.setup-language-selection \.setup-language-choice\.is-selected/u);
  assert.match(
    homeStyles,
    /\.setup-language-form-actions > \.setup-language-continue \{[\s\S]*?flex: 0 0 196px;[\s\S]*?width: 196px;[\s\S]*?min-width: 196px;/u
  );
  assert.match(
    homeStyles,
    /\.setup-actions > \.setup-action,\s*\.setup-actions > \.setup-small-action \{\s*flex: 1 1 96px;/u
  );
  assert.match(appEntry, /initial-theme\.js\?v=theme-2/u);
  assert.match(appEntry, /caatuu-home\.css\?v=home-35/u);
  assert.match(appEntry, /caatuu-chrome\.js\?v=chrome-125/u);
  assert.match(appEntry, /app-bootstrap\.mjs\?v=app-26/u);
  assert.match(bootstrapSource, /source\/features\/setup\/setup\.js\?v=setup-39/u);
  assert.match(bootstrapSource, /caatuu-workspace\.js\?v=workspace-7/u);
});

function evaluateInitialTheme(values = {}, { throwOnRead = false } = {}) {
  const html = { dataset: {} };
  const context = {
    CaatuuCourse: { storage: { theme: "course.theme", fontSize: "course.font-size" } },
    document: { documentElement: html },
    localStorage: {
      getItem(key) {
        if (throwOnRead) throw new Error("storage unavailable");
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
      }
    }
  };
  vm.runInNewContext(initialThemeSource, context, { filename: "initial-theme.js" });
  return html.dataset;
}

test("fresh installs default to light while stored appearance remains authoritative", () => {
  assert.deepEqual(
    { ...evaluateInitialTheme() },
    { theme: "light", fontSize: "largest" }
  );
  assert.deepEqual(
    { ...evaluateInitialTheme({ "course.theme": "dark", "course.font-size": "large" }) },
    { theme: "dark", fontSize: "large" }
  );
  assert.equal(evaluateInitialTheme({ "course.theme": "unexpected" }).theme, "light");
  assert.equal(evaluateInitialTheme({}, { throwOnRead: true }).theme, "light");
  assert.match(chromeSource, /function normalizeTheme\(theme\) \{\s*return theme === "light" \|\| theme === "dark" \? theme : "light";/u);
  assert.match(workspaceSource, /function normalizeTheme\(theme\) \{\s*return Object\.prototype\.hasOwnProperty\.call\(themeOptions, theme\) \? theme : "light";/u);
});
