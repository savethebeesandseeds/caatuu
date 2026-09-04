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
  workspaceSource,
  czechSetup,
  czechWorker
] = await Promise.all([
  readFile(new URL("apps/languages/czech/static/source/features/setup/setup.js", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/app/index.html", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/source/app-bootstrap.mjs", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/styles/caatuu-home.css", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/source/initial-theme.js", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/source/caatuu-chrome.js", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/source/caatuu-workspace.js", repoRoot), "utf8"),
  readFile(new URL("apps/languages/czech/static/setup-assets.json", repoRoot), "utf8").then(JSON.parse),
  readFile(new URL("apps/languages/czech/static/sw.js", repoRoot), "utf8")
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
  assert.match(
    appEntry,
    /id="homeBaseView"[^>]*>[\s\S]*?<details class="verb-toolbar-menu verb-display-menu workspace-display-menu" id="setupDisplayMenu"[\s\S]*?<section class="home-hero">/u
  );
  assert.match(appEntry, /id="setupDisplayMenu"[\s\S]*dark_mode_ui\.png[\s\S]*data-theme-option="light"[\s\S]*data-theme-option="dark"[\s\S]*data-font-size-option="largest"/u);
  assert.match(homeStyles, /\.native-setup-card\.is-choosing-language \.setup-progress/u);
  assert.match(homeStyles, /\.setup-language-selection \.setup-language-choice/u);
  assert.match(homeStyles, /#homeBaseView > \.workspace-display-menu \{[\s\S]*?position: absolute;[\s\S]*?display: block;/u);
  assert.match(homeStyles, /\.setup-language-selection \.setup-language-choice\.is-selected/u);
  assert.match(appEntry, /id="setupLogTitle">Events</u);
  assert.match(homeStyles, /\.setup-log li \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?gap: 2px;/u);
  assert.match(homeStyles, /\.setup-log span \{[\s\S]*?margin-inline-start: 28px;[\s\S]*?text-align: left;/u);
  assert.equal((appEntry.match(/data-caatuu-language-switch/gu) || []).length, 1);
  assert.match(appEntry, /Review your current course, switch to a course in progress, or start a new course\./u);
  assert.match(
    appEntry,
    /<section class="home-language-card" id="homeLanguageCard"[\s\S]*?id="homeLanguageTitle">Your courses<[\s\S]*?<button[\s\S]*?class="home-language-manage"[\s\S]*?data-caatuu-language-switch[\s\S]*?data-language-switch-variant="home"/u
  );
  assert.match(
    appEntry,
    /id="homeSocialView" role="tabpanel" aria-labelledby="homeSocialTab" hidden[\s\S]*?id="homeSocialTitle">Social<[\s\S]*?Social is in development\./u
  );
  assert.match(
    homeStyles,
    /\.native-setup-card\.is-ready:not\(\.is-updating\):not\(\.is-app-update-lock\):not\(\.is-error\) \+ \.home-language-card \{\s*display: grid;/u
  );
  assert.match(
    homeStyles,
    /\.home-language-card \.language-selector-menu \{[\s\S]*?position: fixed;[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\);/u
  );
  assert.match(chromeSource, /className = "home-language-pair"/u);
  assert.match(chromeSource, /const current = document\.createElement\("div"\)/u);
  assert.match(chromeSource, /current\.className = "home-language-current-course"/u);
  assert.match(chromeSource, /status\.textContent = "Current"/u);
  assert.match(chromeSource, /heading\.textContent = "Ongoing courses"/u);
  assert.match(chromeSource, /manageIcon\.textContent = "\+"/u);
  assert.match(chromeSource, /manageLabel\.textContent = "New course"/u);
  assert.match(chromeSource, /trigger\.setAttribute\("aria-label", "Start a new language course"\)/u);
  assert.match(homeStyles, /\.home-language-manage \{[\s\S]*?flex: 0 0 auto;[\s\S]*?white-space: nowrap;/u);
  assert.match(chromeSource, /className = "home-language-quick-switches"/u);
  assert.match(
    homeStyles,
    /\.home-language-quick-switches \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/u
  );
  assert.match(chromeSource, /\.filter\(\(\{ effort \}\) => effort\.hasProgress\)/u);
  assert.match(chromeSource, /menu\.caatuuReviewCourse\?\.\(record\.id\)/u);
  assert.match(chromeSource, /dataset\.languageEffortExact/u);
  assert.match(chromeSource, /className = "language-pill app-header-language-pill current-language-indicator"/u);
  assert.match(chromeSource, /function renderLanguageIndicator\(element\)[\s\S]*?Change languages from Home/u);
  assert.doesNotMatch(chromeSource, /language\.dataset\.caatuuLanguageSwitch/u);
  assert.match(chromeSource, /menu\.setAttribute\("role", "dialog"\)/u);
  assert.match(chromeSource, /What language do you use\?/u);
  assert.match(chromeSource, /What language do you want to learn\?/u);
  assert.match(chromeSource, /dataset\.languageSelectorReview/u);
  assert.match(chromeSource, /dataset\.languageSelectorConfirm/u);
  assert.match(chromeSource, /review\.textContent = "Continue"/u);
  assert.match(chromeSource, /confirm\.textContent = "Confirm"/u);
  assert.match(chromeSource, /course progress will remain saved/u);
  assert.doesNotMatch(chromeSource, /Instructions will use/u);
  assert.match(chromeSource, /XP, coins, and streak remain shared across languages/u);
  assert.match(chromeSource, /switch back to \$\{targetLanguage\.label\} at any time/u);
  assert.match(chromeSource, /learning\?\.courseSummaries/u);
  assert.match(homeStyles, /\.home-language-selector-menu \.language-selector-effort/u);
  assert.match(
    homeStyles,
    /\.home-language-selector-menu \.language-selector-option\[aria-checked="true"\] \{[\s\S]*?background:[\s\S]*?box-shadow:/u
  );
  assert.match(homeStyles, /\.language-selector-review-info \{[\s\S]*?border-radius: 50%;/u);
  assert.match(homeStyles, /\.home-language-current-course \{[\s\S]*?background:[\s\S]*?box-shadow:/u);
  assert.match(homeStyles, /\.home-language-current-status \{[\s\S]*?background: var\(--setup-accent\);/u);
  assert.match(homeStyles, /\.home-language-ongoing-courses \{[\s\S]*?border:[\s\S]*?background:/u);
  assert.match(
    homeStyles,
    /\.home-language-ongoing-head \{[\s\S]*?background: color-mix\(in srgb, var\(--setup-accent\) 16%, var\(--setup-panel-raised\)\);/u
  );
  assert.match(
    homeStyles,
    /\.home-language-selector-menu \[data-language-target-options\] \{\s*grid-template-columns: minmax\(0, 1fr\);/u
  );
  assert.match(homeStyles, /\.language-selector-review-heading \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/u);
  assert.match(homeStyles, /\.language-selector-choice-stage\[hidden\] \{\s*display: none;/u);
  assert.match(homeStyles, /\.language-selector-form-actions \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/u);
  assert.match(
    homeStyles,
    /\.setup-language-form-actions > \.setup-language-continue \{[\s\S]*?flex: 0 0 196px;[\s\S]*?width: 196px;[\s\S]*?min-width: 196px;/u
  );
  assert.match(
    homeStyles,
    /\.setup-actions > \.setup-action,\s*\.setup-actions > \.setup-small-action \{\s*flex: 1 1 96px;/u
  );
  assert.match(appEntry, /initial-theme\.js\?v=theme-3/u);
  assert.match(appEntry, /caatuu-theme\.css\?v=theme-6/u);
  assert.match(appEntry, /caatuu-home\.css\?v=home-45/u);
  assert.match(appEntry, /caatuu-chrome\.css\?v=chrome-style-130/u);
  assert.match(appEntry, /caatuu-chrome\.js\?v=chrome-142/u);
  assert.match(appEntry, /app-bootstrap\.mjs\?v=app-40/u);
  assert.equal(czechSetup.offline.cacheName, "caatuu-czech-pwa-v613");
  assert.match(czechWorker, /Offline catalog revision: caatuu-czech-pwa-v613/u);
  assert.ok(czechSetup.offline.assets.includes("/language-runtime/static/source/caatuu-chrome.js?v=chrome-142"));
  assert.ok(czechSetup.offline.assets.includes("/language-runtime/static/styles/caatuu-chrome.css?v=chrome-style-130"));
  assert.ok(czechSetup.offline.assets.includes("/language-runtime/static/source/dictionary-provider-loader.mjs"));
  assert.ok(czechSetup.offline.assets.includes("./source/features/setup/setup.js?v=setup-39"));
  assert.match(
    bootstrapSource,
    /for \(const providerName of \["semanticLearningProvider", "setupProgressProvider", "setupProvider"\]\)/u
  );
  assert.match(
    bootstrapSource,
    /const providerModule = declaredBrowserProvider\(providerName\);\s*if \(providerModule\) await loadScript\(providerModule\);/u
  );
  assert.match(bootstrapSource, /caatuu-workspace\.js\?v=workspace-13/u);
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
      },
      setItem(key, value) {
        values[key] = String(value);
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
  const legacyAppearance = { "course.theme": "dark", "course.font-size": "large" };
  assert.deepEqual(
    { ...evaluateInitialTheme(legacyAppearance) },
    { theme: "dark", fontSize: "large" }
  );
  assert.equal(legacyAppearance["caatuu.appearance.theme.v1"], "dark");
  assert.equal(legacyAppearance["caatuu.appearance.font-size.v1"], "large");
  const sharedAppearance = {
    "caatuu.appearance.theme.v1": "dark",
    "caatuu.appearance.font-size.v1": "standard",
    "course.theme": "light",
    "course.font-size": "largest"
  };
  assert.deepEqual(
    { ...evaluateInitialTheme(sharedAppearance) },
    { theme: "dark", fontSize: "standard" }
  );
  assert.equal(sharedAppearance["course.theme"], "dark");
  assert.equal(sharedAppearance["course.font-size"], "standard");
  assert.equal(evaluateInitialTheme({ "course.theme": "unexpected" }).theme, "light");
  assert.equal(evaluateInitialTheme({}, { throwOnRead: true }).theme, "light");
  assert.match(initialThemeSource, /caatuu\.appearance\.theme\.v1/u);
  assert.match(initialThemeSource, /caatuu\.appearance\.font-size\.v1/u);
  assert.match(chromeSource, /const themeStorageKey = "caatuu\.appearance\.theme\.v1"/u);
  assert.match(workspaceSource, /const themeStorageKey = "caatuu\.appearance\.theme\.v1"/u);
  assert.match(chromeSource, /function normalizeTheme\(theme\) \{\s*return theme === "light" \|\| theme === "dark" \? theme : "light";/u);
  assert.match(workspaceSource, /function normalizeTheme\(theme\) \{\s*return Object\.prototype\.hasOwnProperty\.call\(themeOptions, theme\) \? theme : "light";/u);
});
