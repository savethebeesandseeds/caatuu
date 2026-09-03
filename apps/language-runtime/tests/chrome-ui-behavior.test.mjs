import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { createBrowserHarness } from "./helpers/fake-browser.mjs";

const chromeSource = await readFile(
  new URL("../static/source/caatuu-chrome.js", import.meta.url),
  "utf8"
);

const english = Object.freeze({
  id: "en",
  label: "English",
  nativeLabel: "English",
  shortCode: "EN",
  locale: "en",
  direction: "ltr",
  flagClass: "en-flag",
  flagSrc: "/assets/icons/english_flag.png"
});
const czech = Object.freeze({
  id: "cs",
  label: "Czech",
  nativeLabel: "Čeština",
  shortCode: "CZ",
  locale: "cs",
  direction: "ltr",
  flagClass: "cz-flag",
  flagSrc: "/assets/icons/czech_flag.png"
});
const mandarin = Object.freeze({
  id: "zh-Hans",
  label: "Mandarin Chinese",
  nativeLabel: "简体中文",
  shortCode: "ZH",
  locale: "zh-Hans",
  direction: "ltr",
  flagClass: "zh-flag",
  flagSrc: "/assets/icons/chinese_flag.png"
});

function fixtureCourse() {
  return {
    id: "cz",
    status: "active",
    entryPath: "/cz/index.html",
    routePrefix: "/cz",
    workspaceLabel: "Czech Journey",
    brandLabel: "Caatuu",
    sourceLanguage: english,
    targetLanguage: czech,
    capabilities: {},
    games: [],
    routes: {
      home: "/cz/index.html",
      games: "/cz/index.html",
      settings: "/cz/index.html"
    },
    storage: {
      namespace: "caatuu-cz",
      theme: "caatuu-cz.theme",
      fontSize: "caatuu-cz.font-size"
    },
    courseSelector: {
      schemaVersion: 1,
      courses: [
        {
          id: "cz",
          status: "active",
          entryPath: "/cz/index.html",
          sourceLanguage: english,
          targetLanguage: czech
        },
        {
          id: "zh",
          status: "development",
          entryPath: "/zh/index.html",
          sourceLanguage: english,
          targetLanguage: mandarin
        }
      ]
    }
  };
}

function executeChrome(options = {}) {
  const harness = createBrowserHarness({ course: fixtureCourse(), ...options });
  vm.runInContext(chromeSource, harness.context, { filename: "caatuu-chrome.js" });
  return harness;
}

test("stored appearance is applied and real controls persist immediate changes", () => {
  const systemThemes = [];
  const harness = createBrowserHarness({
    course: fixtureCourse(),
    localStorageValues: {
      "caatuu-cz.theme": "light",
      "caatuu-cz.font-size": "large"
    },
    runtime: {
      env: "browser",
      registerServiceWorker: async () => true,
      appearance: { setSystemTheme: (theme) => systemThemes.push(theme) }
    }
  });
  const themeColor = harness.document.createElement("meta");
  themeColor.setAttribute("name", "theme-color");
  harness.document.head.append(themeColor);
  const darkTheme = harness.document.createElement("button");
  darkTheme.dataset.themeOption = "dark";
  const standardText = harness.document.createElement("button");
  standardText.dataset.fontSizeOption = "standard";
  harness.document.body.append(darkTheme, standardText);

  vm.runInContext(chromeSource, harness.context, { filename: "caatuu-chrome.js" });

  assert.equal(harness.document.documentElement.dataset.theme, "light");
  assert.equal(harness.document.documentElement.dataset.fontSize, "large");
  assert.equal(themeColor.getAttribute("content"), "#f5efe5");
  assert.equal(darkTheme.getAttribute("aria-pressed"), "false");
  assert.deepEqual(systemThemes, ["light"]);

  harness.document.dispatchEvent({ type: "click", target: darkTheme });
  harness.document.dispatchEvent({ type: "click", target: standardText });

  assert.equal(harness.document.documentElement.dataset.theme, "dark");
  assert.equal(harness.document.documentElement.dataset.fontSize, "standard");
  assert.equal(harness.localStorage.getItem("caatuu-cz.theme"), "dark");
  assert.equal(harness.localStorage.getItem("caatuu-cz.font-size"), "standard");
  assert.equal(darkTheme.getAttribute("aria-pressed"), "true");
  assert.equal(standardText.getAttribute("aria-pressed"), "true");
  assert.equal(themeColor.getAttribute("content"), "#151a18");
  assert.deepEqual(systemThemes, ["light", "dark"]);
});

test("the shared language menu renders catalog courses and supports keyboard navigation", () => {
  const harness = executeChrome();
  const trigger = harness.document.createElement("button");
  trigger.dataset.caatuuLanguageSwitch = "";
  harness.document.body.append(trigger);

  harness.window.CaatuuChrome.renderLanguageSwitch(trigger);

  const host = harness.document.querySelector(".language-selector");
  const menu = host.querySelector("[data-language-selector-menu]");
  const sourceOptions = menu.querySelectorAll("[data-language-base-option]");
  const courseOptions = menu.querySelectorAll("[data-language-course-option]");
  const current = courseOptions.find((option) => option.dataset.languageCourseOption === "cz");
  const preview = courseOptions.find((option) => option.dataset.languageCourseOption === "zh");

  assert.equal(trigger.querySelector("img").src, czech.flagSrc);
  assert.equal(trigger.getAttribute("aria-haspopup"), "menu");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(menu.hidden, true);
  assert.equal(menu.getAttribute("role"), "menu");
  assert.equal(sourceOptions.length, 1);
  assert.equal(courseOptions.length, 2);
  assert.equal(current.getAttribute("aria-current"), "page");
  assert.equal(current.getAttribute("aria-checked"), "true");
  assert.equal(preview.href, "/zh/index.html");
  assert.equal(preview.rel, "nofollow");
  assert.match(preview.textContent, /简体中文/u);
  assert.match(preview.textContent, /Preview/u);

  trigger.dispatchEvent({ type: "keydown", key: "ArrowDown" });
  const enabledOptions = menu.querySelectorAll(
    '[data-language-selector-option]:not([aria-disabled="true"])'
  );
  assert.equal(menu.hidden, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(harness.document.activeElement, enabledOptions[0]);

  menu.dispatchEvent({ type: "keydown", key: "End" });
  assert.equal(harness.document.activeElement, enabledOptions.at(-1));
  menu.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(menu.hidden, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(harness.document.activeElement, trigger);
});

test("the native selector disables courses absent from the installed shell", () => {
  const harness = executeChrome({
    runtime: { env: "android" },
    window: {
      CaatuuAndroid: {
        isCourseBundled(courseId) {
          return courseId === "cz";
        }
      }
    }
  });
  const trigger = harness.document.createElement("button");
  trigger.dataset.caatuuLanguageSwitch = "";
  harness.document.body.append(trigger);

  harness.window.CaatuuChrome.renderLanguageSwitch(trigger);

  const preview = harness.document.querySelector('[data-language-course-option="zh"]');
  assert.equal(preview.getAttribute("aria-disabled"), "true");
  assert.equal(preview.tabIndex, -1);
  assert.equal(preview.href, "");
  assert.match(preview.textContent, /Browser only/u);
});
