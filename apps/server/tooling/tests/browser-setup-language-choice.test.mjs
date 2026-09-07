import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "../../../language-runtime/tests/helpers/fake-browser.mjs";

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
  czechWorker,
  englishInterface
] = await Promise.all([
  readFile(new URL("apps/languages/czech/static/source/features/setup/setup.js", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/app/index.html", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/source/app-bootstrap.mjs", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/styles/caatuu-home.css", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/source/initial-theme.js", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/source/caatuu-chrome.js", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/source/caatuu-workspace.js", repoRoot), "utf8"),
  readFile(new URL("apps/languages/czech/static/setup-assets.json", repoRoot), "utf8").then(JSON.parse),
  readFile(new URL("apps/languages/czech/static/sw.js", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/data/interface/en.v1.json", repoRoot), "utf8").then(JSON.parse)
]);

function revisionedReference(source, pathname, revisionPrefix) {
  const escapedPath = pathname.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`["'](${escapedPath}\\?v=${revisionPrefix}-[1-9]\\d*)["']`, "gu");
  const references = [...source.matchAll(pattern)].map((match) => match[1]);
  assert.ok(references.length, `Missing revisioned reference to ${pathname}`);
  assert.equal(new Set(references).size, 1, `Conflicting revisions for ${pathname}`);
  return references[0];
}

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
  assert.match(chooser, /setText\("#setupTitle", "Choose a language"\)/u);
  assert.doesNotMatch(chooser, /Before local setup/u);
  assert.doesNotMatch(chooser, /Nothing is downloaded|Answer two quick questions|Now choose|Choose your base language/u);
});

function languageForm(records) {
  const browser = createBrowserHarness();
  browser.registry.seed(appEntry);
  const { context, document } = browser;
  const prepared = [];
  Object.assign(context, {
    course: { id: records[0].id, courseSelector: { schemaVersion: 1, courses: records } },
    $: (selector) => document.querySelector(selector),
    setText: (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = value; },
    stopSetupMessageCycle() {}, stopStageAnimation() {}, setNavigationLocked() {},
    setStageImage() {}, stageFallback() { return ""; },
    chooseSetupCourse: (record) => prepared.push(record.id)
  });
  vm.runInContext(`
    let setupCourseChoicePending = false, setupCourseChoices = [], selectedSetupSourceId = "", selectedSetupCourseId = "";
    let setupRunning = false, nativeSetupActive = false, setupComplete = false, setupAborted = false;
    ${sourceBetween(setupSource, "  function setupCourseRecords()", "  async function chooseSetupCourse(record)")}
    renderBrowserLanguageSelection();
  `, context);
  return {
    ...browser, prepared,
    source: () => document.getElementById("setupSourceLanguageOptions").children.map((choice) => choice.querySelector("input")),
    targets: () => document.getElementById("setupTargetLanguageOptions").children.map((choice) => choice.querySelector("input")),
    select(input) {
      document.querySelectorAll("input").filter((peer) => peer.name === input.name).forEach((peer) => { peer.checked = peer === input; });
      input.dispatchEvent({ type: "change" });
    },
    submit() { document.getElementById("setupLanguageForm").dispatchEvent({ type: "submit" }); }
  };
}

const sourceLanguage = { id: "en", label: "English" };
const testCourses = ["cs", "zh", "es"].map((id) => ({
  id: `en-${id}`, status: "active", entryPath: `/${id}/index.html`,
  sourceLanguage, targetLanguage: { id, label: id }
}));

test("even a single base language requires selection before target selection or Continue", () => {
  const browser = languageForm(testCourses);
  const targetFieldset = browser.document.getElementById("setupTargetLanguageQuestion");
  const submit = browser.document.getElementById("setupLanguageContinue");
  assert.equal(browser.source().length, 1);
  assert.equal(browser.source()[0].checked, false);
  assert.equal(browser.targets().length, 3, "available targets stay visible in the disabled fieldset");
  assert.equal(targetFieldset.disabled, true);
  assert.equal(submit.disabled, true);
  browser.select(browser.targets()[0]);
  browser.submit();
  assert.deepEqual(browser.prepared, [], "disabled targets cannot submit even through a synthetic change");

  browser.select(browser.source()[0]);
  assert.equal(targetFieldset.disabled, false);
  assert.equal(submit.disabled, true);
  assert.ok(browser.targets().every((input) => !input.checked));
  browser.select(browser.targets()[1]);
  assert.equal(submit.disabled, false);
  assert.deepEqual(browser.prepared, [], "selecting both languages does not start preparation");
  browser.submit();
  assert.deepEqual(browser.prepared, ["en-zh"]);
});

test("changing the base language filters targets and clears the previous target selection", () => {
  const browser = languageForm([...testCourses, {
    id: "es-cs", status: "active", entryPath: "/es-cs/index.html",
    sourceLanguage: { id: "es", label: "Spanish" }, targetLanguage: { id: "cs", label: "Czech" }
  }]);
  assert.equal(browser.targets().length, 3, "targets are not repeated for each base language");
  browser.select(browser.source()[0]);
  browser.select(browser.targets()[0]);
  browser.select(browser.source()[1]);
  assert.equal(browser.targets().length, 1);
  assert.equal(browser.targets()[0].value, "es-cs");
  assert.equal(browser.targets()[0].checked, false);
  assert.equal(browser.document.getElementById("setupLanguageContinue").disabled, true);
  browser.submit();
  assert.deepEqual(browser.prepared, []);
  browser.select(browser.targets()[0]);
  browser.submit();
  assert.deepEqual(browser.prepared, ["es-cs"]);
});

test("the shared home exposes a two-question language form and the game display menu", () => {
  assert.match(appEntry, /id="setupLanguageSelection"[^>]*hidden/u);
  assert.match(appEntry, /<form[^>]*id="setupLanguageForm"/u);
  assert.match(appEntry, /<fieldset[^>]*id="setupSourceLanguageQuestion"[\s\S]*What language do you speak\?/u);
  assert.match(appEntry, /<fieldset[^>]*id="setupTargetLanguageQuestion"[^>]*disabled[\s\S]*What language do you want to learn\?/u);
  assert.match(appEntry, /id="setupLanguageContinue"[^>]*type="submit"[^>]*data-i18n="common\.continue"[^>]*disabled/u);
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
  assert.match(appEntry, /id="setupLogTitle"[^>]*data-i18n="setup\.events"[^>]*>Events/u);
  assert.match(homeStyles, /\.setup-log li \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?gap: 2px;/u);
  assert.match(homeStyles, /\.setup-log span \{[\s\S]*?margin-inline-start: 28px;[\s\S]*?text-align: left;/u);
  assert.equal((appEntry.match(/data-caatuu-language-switch/gu) || []).length, 1);
  assert.match(appEntry, /Review your current course, switch to a course in progress, or start a new course\./u);
  assert.match(
    appEntry,
    /<section class="home-language-card" id="homeLanguageCard"[\s\S]*?id="homeLanguageTitle"[^>]*data-i18n="home\.courses\.title"[^>]*>Your courses<[\s\S]*?<button[\s\S]*?class="home-language-manage"[\s\S]*?data-caatuu-language-switch[\s\S]*?data-language-switch-variant="home"/u
  );
  assert.match(
    appEntry,
    /id="homeSocialView" role="tabpanel" aria-labelledby="homeSocialTab" hidden[\s\S]*?id="homeSocialTitle"[^>]*data-i18n="home\.social\.title"[^>]*>Social<[\s\S]*?Social is in development\./u
  );
  assert.match(
    homeStyles,
    /dialog\.home-language-selector-menu \{[\s\S]*?position: fixed;[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\);/u
  );
  assert.match(chromeSource, /className = "home-language-pair"/u);
  assert.match(chromeSource, /const current = document\.createElement\("div"\)/u);
  assert.match(chromeSource, /current\.className = "home-language-current-course"/u);
  assert.match(chromeSource, /status\.textContent = interfaceMessage\("common\.current"\)/u);
  assert.match(chromeSource, /heading\.textContent = interfaceMessage\("courseselector\.ongoing\.heading"\)/u);
  assert.match(chromeSource, /manageIcon\.textContent = "\+"/u);
  assert.match(chromeSource, /manageLabel\.textContent = interfaceMessage\("courseselector\.newcourse"\)/u);
  assert.match(chromeSource, /trigger\.setAttribute\("aria-label", interfaceMessage\("courseselector\.startnew"\)\)/u);
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
  assert.match(chromeSource, /function renderLanguageIndicator\(element\)[\s\S]*?interfaceMessage\("courseselector\.indicator\.arialabel"/u);
  assert.doesNotMatch(chromeSource, /language\.dataset\.caatuuLanguageSwitch/u);
  assert.match(chromeSource, /menu\.setAttribute\("role", "dialog"\)/u);
  assert.match(chromeSource, /document\.createElement\("dialog"\)/u);
  assert.match(chromeSource, /menu\.showModal\(\)/u);
  assert.match(homeStyles, /\.home-language-selector-menu::backdrop/u);
  assert.match(chromeSource, /interfaceMessage\("courseselector\.sourcequestion"\)/u);
  assert.match(chromeSource, /interfaceMessage\("courseselector\.targetquestion"\)/u);
  assert.match(chromeSource, /dataset\.languageSelectorReview/u);
  assert.match(chromeSource, /dataset\.languageSelectorConfirm/u);
  assert.match(chromeSource, /review\.textContent = interfaceMessage\("common\.continue"\)/u);
  assert.match(chromeSource, /confirm\.textContent = interfaceMessage\("common\.confirm"\)/u);
  assert.match(chromeSource, /interfaceMessage\("courseselector\.review\.progress"/u);
  assert.doesNotMatch(chromeSource, /Instructions will use/u);
  assert.match(chromeSource, /interfaceMessage\("courseselector\.review\.sharedprogress"/u);
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
    /\.home-language-ongoing-head \{[\s\S]*?background: var\(--theme-panel-head-bg, #eee8de\);/u
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
  assert.match(appEntry, /caatuu-theme\.css\?v=theme-7/u);
  const homeUrl = revisionedReference(appEntry, "/language-runtime/static/styles/caatuu-home.css", "home");
  const chromeStyleUrl = revisionedReference(appEntry, "/language-runtime/static/styles/caatuu-chrome.css", "chrome-style");
  assert.doesNotMatch(appEntry, /caatuu-chrome\.js/u);
  revisionedReference(appEntry, "source/shared/course-profile.js", "course");
  const bootstrapUrl = revisionedReference(appEntry, "/language-runtime/static/source/app-bootstrap.mjs", "app");
  const chromeUrl = revisionedReference(bootstrapSource, "/language-runtime/static/source/caatuu-chrome.js", "chrome");
  const workspaceUrl = revisionedReference(bootstrapSource, "/language-runtime/static/source/caatuu-workspace.js", "workspace");
  assert.match(czechSetup.offline.cacheName, /^caatuu-czech-pwa-v[1-9]\d*$/u);
  assert.ok(czechWorker.includes(`// Offline catalog revision: ${czechSetup.offline.cacheName}`));
  for (const url of [homeUrl, bootstrapUrl, chromeUrl, workspaceUrl, chromeStyleUrl]) {
    assert.ok(czechSetup.offline.assets.includes(url), `Offline setup must contain the current shared reference ${url}`);
  }
  assert.ok(czechSetup.offline.assets.includes("/language-runtime/static/source/dictionary-provider-loader.mjs"));
  assert.ok(czechSetup.offline.assets.includes("/language-runtime/static/source/interface-content.mjs?v=interface-runtime-2"));
  assert.ok(czechSetup.offline.assets.includes("/language-runtime/static/source/legacy-page-bootstrap.mjs?v=legacy-page-8"));
  assert.ok(czechSetup.offline.assets.includes(`/language-runtime/static/data/interface/en.v1.json?v=${englishInterface.revision}`));
  assert.ok(czechSetup.offline.assets.includes("./source/features/setup/setup.js?v=setup-41"));
  assert.match(
    bootstrapSource,
    /for \(const providerName of \["semanticLearningProvider", "setupProgressProvider", "setupProvider"\]\)/u
  );
  assert.match(
    bootstrapSource,
    /const providerModule = declaredBrowserProvider\(providerName\);\s*if \(providerModule\) await loadScript\(providerModule\);/u
  );
  assert.match(bootstrapSource, /interface-content\.mjs\?v=interface-runtime-2/u);
  assert.match(
    bootstrapSource,
    /loadInterfaceContent\(course\);[\s\S]*installInterfaceContent\(interfaceContent\);[\s\S]*caatuu-chrome\.js\?v=chrome-[1-9]\d*/u
  );
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
