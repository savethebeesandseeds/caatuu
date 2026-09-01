import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../../../../", import.meta.url);
const [chrome, chromeCss, czechProfileSource, mandarinProfileSource, launcherRegistry, serverRoutes, czechSetup, mandarinSetup, appAssets] = await Promise.all([
  readFile(new URL("apps/language-runtime/static/source/caatuu-chrome.js", repoRoot), "utf8"),
  readFile(new URL("apps/language-runtime/static/styles/caatuu-chrome.css", repoRoot), "utf8"),
  readFile(new URL("apps/languages/czech/static/source/shared/course-profile.js", repoRoot), "utf8"),
  readFile(new URL("apps/languages/mandarin-simplified/static/source/shared/course-profile.js", repoRoot), "utf8"),
  readFile(new URL("apps/launcher/static/languages.json", repoRoot), "utf8").then(JSON.parse),
  readFile(new URL("apps/server/src/routes/mod.rs", repoRoot), "utf8"),
  readFile(new URL("apps/languages/czech/static/setup-assets.json", repoRoot), "utf8").then(JSON.parse),
  readFile(new URL("apps/languages/mandarin-simplified/static/setup-assets.json", repoRoot), "utf8").then(JSON.parse),
  readFile(new URL("apps/language-runtime/app-assets.json", repoRoot), "utf8").then(JSON.parse)
]);

function evaluateProfile(source, filename) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename });
  return JSON.parse(JSON.stringify(context.window.CaatuuCourse));
}

const czechProfile = evaluateProfile(czechProfileSource, "czech-course-profile.js");
const mandarinProfile = evaluateProfile(mandarinProfileSource, "mandarin-course-profile.js");
const selectorStart = chrome.indexOf("function languageShortCode");
const selectorEnd = chrome.indexOf("function renderAppHeader", selectorStart);
const selectorSource = chrome.slice(selectorStart, selectorEnd);

test("both courses receive one catalog-derived browser course projection", () => {
  assert.ok(selectorStart >= 0 && selectorEnd > selectorStart, "the shared selector implementation remains inspectable");
  assert.deepEqual(czechProfile.courseSelector, mandarinProfile.courseSelector);
  assert.deepEqual(
    czechProfile.courseSelector.courses.map(({ id, status, entryPath }) => ({ id, status, entryPath })),
    [
      { id: "cz", status: "active", entryPath: "/cz/index.html" },
      { id: "zh", status: "development", entryPath: "/zh/index.html" }
    ]
  );
  assert.deepEqual(
    czechProfile.courseSelector.courses.map(({ sourceLanguage }) => sourceLanguage),
    [
      {
        id: "en",
        label: "English",
        nativeLabel: "English",
        shortCode: "EN",
        locale: "en",
        direction: "ltr",
        flagClass: "en-flag",
        flagSrc: "/assets/icons/english_flag.png"
      },
      {
        id: "en",
        label: "English",
        nativeLabel: "English",
        shortCode: "EN",
        locale: "en",
        direction: "ltr",
        flagClass: "en-flag",
        flagSrc: "/assets/icons/english_flag.png"
      }
    ]
  );
  assert.deepEqual(
    czechProfile.courseSelector.courses.map(({ targetLanguage }) => targetLanguage.shortCode),
    ["CZ", "ZH"]
  );
  assert.deepEqual(launcherRegistry.languages.map(({ id }) => id), ["cz"], "the public launcher remains active-only");
});

test("every shared selector flag is cached by every course and packaged by the shared app", () => {
  const flagUrls = new Set(czechProfile.courseSelector.courses.flatMap(({ sourceLanguage, targetLanguage }) => [
    sourceLanguage.flagSrc,
    targetLanguage.flagSrc
  ]));
  const sharedOutputs = new Set(appAssets.assets.map(({ output }) => output));
  for (const flagUrl of flagUrls) {
    assert.ok(czechSetup.offline.assets.includes(flagUrl), `Czech offline cache must include ${flagUrl}`);
    assert.ok(mandarinSetup.offline.assets.includes(flagUrl), `Mandarin offline cache must include ${flagUrl}`);
    assert.ok(sharedOutputs.has(flagUrl.slice(1)), `shared Android assets must include ${flagUrl}`);
  }
});

test("shared Chrome renders the base and current target without course-specific branches", () => {
  assert.match(selectorSource, /const configured = course\.courseSelector\?\.schemaVersion === 1[\s\S]*?Array\.isArray\(course\.courseSelector\.courses\)/);
  assert.match(selectorSource, /\["active", "development"\]\.includes\(record\?\.status\)/);
  assert.match(selectorSource, /function availableSourceLanguageSelectorRecords\(\)[\s\S]*?sources = new Map\(\)[\s\S]*?sources\.has\(sourceId\)/);
  assert.match(selectorSource, /courseSelectorRecords\(\)\.filter\(\(record\) => record\.sourceLanguage\.id === sourceId\)/);
  assert.match(selectorSource, /records\.unshift\(currentCourseSelectorRecord\(\)\)/);
  assert.match(selectorSource, /element\.replaceChildren\(flag\)/);
  assert.match(selectorSource, /flag\.src = targetLanguage\.flagSrc/);
  assert.doesNotMatch(selectorSource, /language-base-code|language-route-arrow|language-selector-disclosure/);
  assert.match(selectorSource, /sourceKicker\.textContent = "Base language"/);
  assert.match(selectorSource, /targetKicker\.textContent = "Target language"/);
  assert.match(selectorSource, /createBaseLanguageSelectorOption\(record, host\)/);
  assert.match(selectorSource, /populateLanguageSelectorOption\(option, record\.targetLanguage, statusLabels\)/);
  assert.match(selectorSource, /const host = document\.createElement\("div"\)/);
  assert.match(chrome, /const language = document\.createElement\("button"\)[\s\S]*?language\.dataset\.caatuuLanguageSwitch/);
  assert.match(chrome, /<button[\s\S]*?class="language-pill settings-language-pill language-switch"[\s\S]*?data-caatuu-language-switch/);
  assert.doesNotMatch(selectorSource, /\bCzech\b|\bMandarin\b|zh-hans|course\.id === "cz"/);
});

test("the one shared menu exposes active and development courses accessibly", () => {
  assert.match(selectorSource, /menu\.setAttribute\("role", "menu"\)/);
  assert.match(selectorSource, /sourceOptions\.setAttribute\("role", "group"\)/);
  assert.match(selectorSource, /options\.setAttribute\("role", "group"\)/);
  assert.match(selectorSource, /option\.setAttribute\("role", "menuitemradio"\)/);
  assert.match(selectorSource, /option\.setAttribute\("aria-checked", String\(current\)\)/);
  assert.match(selectorSource, /data-language-selector-option/);
  assert.match(selectorSource, /record\.status === "development"[\s\S]*?option\.rel = "nofollow"/);
  assert.match(selectorSource, /statusLabels\.push\("Preview"\)/);
  assert.match(selectorSource, /unavailableInNativeShell = isNativeShell\(\)[\s\S]*?&& !isCourseBundledInNativeShell\(record\.id\)[\s\S]*?aria-disabled/);
  assert.match(selectorSource, /event\.key === "ArrowDown"[\s\S]*?event\.key === "ArrowUp"[\s\S]*?event\.key === "Home"[\s\S]*?event\.key === "End"/);
  assert.match(selectorSource, /event\.key !== "Escape" \|\| !activeLanguageSelectorHost/);
  assert.match(selectorSource, /activeLanguageSelectorHost\.contains\(event\.target\)/);
  assert.match(selectorSource, /element\.setAttribute\("aria-haspopup", "menu"\)/);
  assert.match(selectorSource, /trigger\.setAttribute\("aria-expanded", "true"\)/);
});

test("the selector has one responsive themed surface and preserves development noindex", () => {
  assert.match(chromeCss, /\.language-selector \{[\s\S]*?position: relative;[\s\S]*?display: inline-flex;/);
  assert.match(chromeCss, /\.language-selector-menu \{[\s\S]*?z-index: 90;[\s\S]*?width: min\(320px, calc\(100vw - 24px\)\);/);
  assert.match(chromeCss, /\.language-selector-option\[aria-current="page"\],[\s\S]*?\.language-selector-option\[aria-checked="true"\] \{[\s\S]*?background:/);
  assert.match(chromeCss, /\.language-selector-status \{[\s\S]*?theme-amber/);
  assert.match(chromeCss, /\.language-pill\.app-header-language-pill,[\s\S]*?\.language-pill\.settings-language-pill \{[\s\S]*?width: 30px;[\s\S]*?min-width: 30px;[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/);
  assert.match(chromeCss, /@media screen and \(max-width: 560px\) \{[\s\S]*?\.language-pill\.app-header-language-pill,[\s\S]*?min-width: 30px;/);
  assert.match(serverRoutes, /if spec\.status == "development"[\s\S]*?HeaderName::from_static\("x-robots-tag"\)[\s\S]*?"noindex, nofollow"/);
});
