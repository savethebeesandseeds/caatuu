import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { installEnglishInterfaceContent } from "./helpers/english-interface-content.mjs";
import shellPolicy from "../static/source/shell-policy.mjs";
import {
  createInterfaceContent,
  installInterfaceContent
} from "../static/source/interface-content.mjs";

const chromeSource = await readFile(
  new URL("../static/source/caatuu-chrome.js", import.meta.url),
  "utf8"
);
const chromeStyles = await readFile(new URL("../static/styles/caatuu-chrome.css", import.meta.url), "utf8");

test("the games sheet grows with available viewport height instead of a 320px scroll box", () => {
  const body = /\.games-menu-body\s*\{([^}]+)\}/u.exec(chromeStyles)?.[1] || "";
  assert.match(body, /max-height:\s*calc\(100dvh - var\(--caatuu-bottom-dock-height, 78px\) - 90px\)/u);
  assert.doesNotMatch(body, /320px|44dvh/u);
  assert.match(body, /overflow-y:\s*auto/u, "short screens retain an accessible scrolling fallback");
});

test("muted audio settings use a grey backslash and hide their inactive options", () => {
  assert.match(chromeStyles, /html\[data-speech-muted="true"\] \.word-net-audio-toggle,[^}]+color:\s*var\(--theme-quiet/u);
  assert.match(chromeStyles, /\.verb-audio-menu > summary::after\s*\{[^}]+transform:\s*rotate\(45deg\)/u);
  assert.match(chromeStyles, /\.speech-settings-body > :not\(\[data-speech-mute-toggle\]\):not\(\[data-music-controls\]\):not\(\[data-voice-controls\]\)\s*\{\s*display:\s*none !important/u,
    "global mute keeps independent voice and music volume preferences editable");
});
const englishInterfaceCatalog = JSON.parse(await readFile(
  new URL("../static/data/interface/en.v1.json", import.meta.url),
  "utf8"
));

function runChrome(harness, interfaceContent = null) {
  if (interfaceContent) {
    installInterfaceContent(interfaceContent, harness.context);
    if (harness.context.window && harness.context.window !== harness.context) {
      installInterfaceContent(interfaceContent, harness.context.window);
    }
  } else {
    installEnglishInterfaceContent(harness);
  }
  vm.runInContext(chromeSource, harness.context, { filename: "caatuu-chrome.js" });
}

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

test("autoplay is a persisted global audio preference with legacy Word World migration", async () => {
  await Promise.resolve();
  const browser = createBrowserHarness({ course: fixtureCourse() });
  runChrome(browser);
  const api = browser.window.CaatuuChrome;
  assert.equal(api.getSpeechAutoplay(), true);
  let changes = 0;
  browser.window.addEventListener("caatuu:speech-autoplay-change", () => { changes += 1; });
  api.setSpeechAutoplay(false);
  assert.equal(api.getSpeechAutoplay(), false);
  assert.equal(browser.localStorage.getItem("caatuu.speech.autoplay.v1"), "false");
  assert.equal(changes, 1);
  browser.localStorage.setItem("caatuu.speech.autoplay.v1", "true");
  browser.window.dispatchEvent({ type: "storage", key: "caatuu.speech.autoplay.v1" });
  assert.equal(api.getSpeechAutoplay(), true);
  assert.equal(changes, 2);
  const course = fixtureCourse();
  const legacy = createBrowserHarness({ course, localStorageValues: { [`${course.storage.namespace}.wordNet.speechAutoplay.v2`]: "false" } });
  runChrome(legacy);
  assert.equal(legacy.window.CaatuuChrome.getSpeechAutoplay(), false);
  assert.equal(legacy.localStorage.getItem("caatuu.speech.autoplay.v1"), "false");
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
const french = Object.freeze({
  id: "fr",
  label: "French",
  nativeLabel: "Français",
  shortCode: "FR",
  locale: "fr",
  direction: "ltr",
  flagClass: "fr-flag",
  flagSrc: "/assets/icons/french_flag.png"
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
      fontSize: "caatuu-cz.font-size",
      learningPerformance: "caatuu-czech.learning.performance.v1"
    },
    courseSelector: {
      schemaVersion: 1,
      courses: [
        {
          id: "cz",
          status: "active",
          entryPath: "/cz/index.html",
          sourceLanguage: english,
          targetLanguage: czech,
          storage: {
            learningPerformance: "caatuu-czech.learning.performance.v1"
          }
        },
        {
          id: "zh",
          status: "development",
          entryPath: "/zh/index.html",
          sourceLanguage: english,
          targetLanguage: mandarin,
          storage: {
            learningPerformance: "caatuu-zh-hans.learning.performance.v1"
          }
        }
      ]
    }
  };
}

function executeChrome(options = {}) {
  const harness = createBrowserHarness({ course: fixtureCourse(), ...options });
  runChrome(harness);
  return harness;
}

function executeChromeWithHomeMenu({ course = fixtureCourse(), interfaceContent = null, policy = null } = {}) {
  const harness = createBrowserHarness({ course });
  if (policy) harness.window.CaatuuShellPolicy = policy;
  const homeView = harness.document.createElement("section");
  homeView.id = "view-home";
  homeView.className = "view home-view is-active";

  const homeBaseView = harness.document.createElement("div");
  homeBaseView.id = "homeBaseView";
  const homeSocialView = harness.document.createElement("section");
  homeSocialView.id = "homeSocialView";
  homeSocialView.hidden = true;
  const homeStoreView = harness.document.createElement("section");
  homeStoreView.id = "homeStoreView";
  homeStoreView.hidden = true;
  const homeStoreArt = harness.document.createElement("img");
  homeStoreArt.id = "homeStoreArt";
  homeStoreView.append(homeStoreArt);
  homeView.append(homeBaseView, homeSocialView, homeStoreView);

  const nav = harness.document.createElement("nav");
  nav.className = "bottom-app-nav";
  nav.setAttribute("aria-label", "Caatuu sections");
  nav.dataset.caatuuBottomNav = "";
  nav.dataset.activeSection = "home";
  nav.dataset.viewButtons = "true";
  nav.dataset.settingsTarget = "openSettings";
  harness.document.body.append(homeView, nav);

  runChrome(harness, interfaceContent);
  return { ...harness, homeBaseView, homeSocialView, homeStoreArt, homeStoreView, homeView, nav };
}

test("global mute updates static playback and appearance synchronizes across open courses", () => {
  const browser = executeChromeWithHomeMenu();
  const playback = browser.document.createElement("button");
  playback.id = "naturalizationNucleusFeedbackSound";
  browser.document.body.append(playback);
  browser.window.CaatuuChrome.setSpeechMuted(true);
  assert.equal(browser.document.documentElement.dataset.speechMuted, "true");
  assert.equal(playback.disabled, true);
  browser.window.CaatuuChrome.setSpeechMuted(false);
  assert.equal(playback.disabled, false);
  browser.localStorage.setItem("caatuu.appearance.theme.v1", "dark");
  browser.window.dispatchEvent({ type: "storage", key: "caatuu.appearance.theme.v1" });
  assert.equal(browser.document.documentElement.dataset.theme, "dark");
  browser.localStorage.setItem("caatuu.appearance.font-size.v1", "large");
  browser.window.dispatchEvent({ type: "storage", key: "caatuu.appearance.font-size.v1" });
  assert.equal(browser.document.documentElement.dataset.fontSize, "large");
});

test("the canonical Home presenter exposes the setup-bearing base view after leaving a game or submenu", () => {
  const browser = executeChromeWithHomeMenu();
  const { document, window, homeView, homeBaseView, homeSocialView, homeStoreView } = browser;
  const gamesView = document.createElement("section");
  gamesView.id = "view-verbs";
  gamesView.className = "view is-active";
  document.body.append(gamesView);
  homeView.classList.remove("is-active");
  homeBaseView.hidden = true;
  homeStoreView.hidden = false;
  const workspaceRequests = [];
  document.addEventListener("caatuu:home-request", () => {
    workspaceRequests.push("home");
    gamesView.classList.remove("is-active");
    homeView.classList.add("is-active");
  });

  assert.equal(window.CaatuuChrome.showHomeDestination("home"), true);
  assert.deepEqual(workspaceRequests, ["home"]);
  assert.equal(homeView.classList.contains("is-active"), true);
  assert.equal(gamesView.classList.contains("is-active"), false);
  assert.equal(homeBaseView.hidden, false, "Home recovery must reveal the actual setup container");
  assert.equal(homeSocialView.hidden, true);
  assert.equal(homeStoreView.hidden, true);
  assert.equal(homeView.dataset.homeDestination, "home");
  assert.equal(browser.nav.dataset.activeSection, "home");
  assert.equal(document.querySelector("#homeMenuPanel")?.hidden, true);
});

function assertHomeNavIndicator(trigger, destination, iconName) {
  const badges = trigger.querySelectorAll(".app-nav-submenu-icon");
  const primaryIcon = trigger.querySelector(".app-nav-icon-img");
  const [badge] = badges;

  assert.equal(badges.length, 1, "Home must expose exactly one submenu indicator");
  assert.match(primaryIcon.src, /\/assets\/icons\/home_icon\.png(?:\?.*)?$/u);
  assert.match(badge.src, new RegExp(`/assets/icons/${iconName.replace(".", "\\.")}(?:\\?.*)?$`, "u"));
  assert.equal(badge.alt, "");
  assert.equal(badge.getAttribute("aria-hidden"), "true");
  assert.equal(badge.dataset.homeDestination, destination);
  assert.equal(trigger.dataset.homeDestination, destination);
  const sectionLabel = destination === "social" ? "Social" : "Store";
  assert.equal(trigger.getAttribute("aria-label"), destination === "home" ? "Home" : `Home, ${sectionLabel}`);
  assert.equal(trigger.title, destination === "home" ? "Open Home" : `Open Home, ${sectionLabel}`);
  return badge;
}

test("Home audio controls reuse global mute and speed, and dismiss on Escape or outside click", () => {
  const harness = createBrowserHarness({ course: fixtureCourse(), localStorageValues: { "caatuu.speech.muted.v1": "true" } });
  const menu = harness.document.createElement("details");
  menu.id = "setupAudioMenu";
  const summary = harness.document.createElement("summary");
  const panel = harness.document.createElement("div");
  panel.id = "setupAudioControls";
  const mute = harness.document.createElement("button");
  mute.dataset.speechMuteToggle = "";
  const speed = harness.document.createElement("input");
  speed.dataset.speechPaceSlider = "";
  panel.append(mute, speed);
  for (const [name, tag] of [["Voice", "select"], ["VoiceStatus", "small"]]) {
    const control = harness.document.createElement(tag);
    control.dataset.speechControl = name;
    panel.append(control);
  }
  menu.append(summary, panel);
  harness.document.body.append(menu);
  runChrome(harness);
  assert.equal(mute.getAttribute("aria-checked"), "true");
  assert.equal(panel.dataset.speechVoiceBound, "true");
  speed.value = "2";
  speed.dispatchEvent({ type: "input", target: speed });
  assert.equal(harness.localStorage.getItem("caatuu.speech.pace.v1"), "normal");
  harness.document.dispatchEvent({ type: "click", target: mute });
  assert.equal(harness.window.CaatuuChrome.getSpeechMuted(), false);
  harness.window.CaatuuChrome.setSpeechMuted(true);
  menu.open = true;
  menu.dispatchEvent({ type: "toggle" });
  harness.document.dispatchEvent({ type: "click", target: mute });
  assert.equal(menu.open, true, "inside controls keep their menu open");
  harness.document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(menu.open, false);
  assert.equal(harness.document.activeElement, summary);
  menu.open = true;
  harness.document.dispatchEvent({ type: "click", target: harness.document.body });
  assert.equal(menu.open, false);
});

test("an open Home voice picker updates when browser voices finish loading", async () => {
  const listeners = [];
  let voices = [];
  const harness = createBrowserHarness({
    course: fixtureCourse(),
    window: {
      SpeechSynthesisUtterance: function () {},
      speechSynthesis: {
        getVoices: () => voices,
        speak() {}, cancel() {},
        addEventListener(type, listener) { if (type === "voiceschanged") listeners.push(listener); }
      }
    }
  });
  const menu = harness.document.createElement("details");
  menu.id = "setupAudioMenu";
  const panel = harness.document.createElement("div");
  panel.id = "setupAudioControls";
  const select = harness.document.createElement("select");
  select.dataset.speechControl = "Voice";
  const status = harness.document.createElement("small");
  status.dataset.speechControl = "VoiceStatus";
  panel.append(select, status);
  menu.append(panel);
  harness.document.body.append(menu);
  runChrome(harness);
  menu.open = true;
  menu.dispatchEvent({ type: "toggle" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(select.dataset.voiceCount, "0");

  voices = [{ voiceURI: "test-cs", name: "Test voice", lang: "cs-CZ", localService: true }];
  listeners.forEach((listener) => listener());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(select.dataset.voiceCount, "1");
  assert.equal(select.disabled, false);
  assert.ok(select.querySelectorAll("option").some((option) => option.value === "browser:test-cs"));
  assert.match(status.textContent, /Test voice/u);
  assert.equal(menu.open, true);
});

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

  runChrome(harness);

  assert.equal(harness.document.documentElement.dataset.theme, "light");
  assert.equal(harness.document.documentElement.dataset.fontSize, "large");
  assert.equal(themeColor.getAttribute("content"), "#f5efe5");
  assert.equal(darkTheme.getAttribute("aria-pressed"), "false");
  assert.equal(harness.localStorage.getItem("caatuu.appearance.theme.v1"), "light");
  assert.equal(harness.localStorage.getItem("caatuu.appearance.font-size.v1"), "large");
  assert.deepEqual(systemThemes, ["light"]);

  harness.document.dispatchEvent({ type: "click", target: darkTheme });
  harness.document.dispatchEvent({ type: "click", target: standardText });

  assert.equal(harness.document.documentElement.dataset.theme, "dark");
  assert.equal(harness.document.documentElement.dataset.fontSize, "standard");
  assert.equal(harness.localStorage.getItem("caatuu-cz.theme"), "dark");
  assert.equal(harness.localStorage.getItem("caatuu-cz.font-size"), "standard");
  assert.equal(harness.localStorage.getItem("caatuu.appearance.theme.v1"), "dark");
  assert.equal(harness.localStorage.getItem("caatuu.appearance.font-size.v1"), "standard");
  assert.equal(darkTheme.getAttribute("aria-pressed"), "true");
  assert.equal(standardText.getAttribute("aria-pressed"), "true");
  assert.equal(themeColor.getAttribute("content"), "#151a18");
  assert.deepEqual(systemThemes, ["light", "dark"]);
});

test("Home display settings stays open for inside controls and dismisses outside or on Escape", () => {
  const harness = createBrowserHarness({ course: fixtureCourse() });
  const menu = harness.document.createElement("details");
  menu.id = "setupDisplayMenu";
  menu.className = "verb-toolbar-menu verb-display-menu workspace-display-menu";
  const summary = harness.document.createElement("summary");
  const popover = harness.document.createElement("div");
  popover.className = "verb-display-popover";
  const darkTheme = harness.document.createElement("button");
  darkTheme.dataset.themeOption = "dark";
  const outside = harness.document.createElement("button");
  popover.append(darkTheme);
  menu.append(summary, popover);
  harness.document.body.append(menu, outside);

  runChrome(harness);

  menu.open = true;
  darkTheme.click();
  assert.equal(menu.open, true, "a display control must not dismiss its own popover");
  assert.equal(harness.document.documentElement.dataset.theme, "dark");

  summary.click();
  assert.equal(menu.open, true, "the shared listener must leave native summary toggling alone");

  outside.focus();
  outside.click();
  assert.equal(menu.open, false);
  assert.equal(harness.document.activeElement, outside, "outside dismissal must not steal focus");

  menu.open = true;
  const escape = { type: "keydown", key: "Escape", target: darkTheme };
  harness.document.dispatchEvent(escape);
  assert.equal(menu.open, false);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(harness.document.activeElement, summary);
});

test("shared appearance follows the learner across course namespaces", () => {
  const czechHarness = createBrowserHarness({ course: fixtureCourse() });
  const darkTheme = czechHarness.document.createElement("button");
  darkTheme.dataset.themeOption = "dark";
  czechHarness.document.body.append(darkTheme);
  runChrome(czechHarness);
  czechHarness.document.dispatchEvent({ type: "click", target: darkTheme });

  const mandarinCourse = {
    ...fixtureCourse(),
    id: "zh",
    entryPath: "/zh/index.html",
    routePrefix: "/zh",
    targetLanguage: mandarin,
    storage: {
      ...fixtureCourse().storage,
      namespace: "caatuu-zh-hans",
      theme: "caatuu-zh-hans.theme",
      fontSize: "caatuu-zh-hans.font-size"
    }
  };
  const mandarinHarness = createBrowserHarness({
    course: mandarinCourse,
    localStorageValues: czechHarness.localStorage.snapshot()
  });
  runChrome(mandarinHarness);

  assert.equal(mandarinHarness.document.documentElement.dataset.theme, "dark");
  assert.equal(mandarinHarness.localStorage.getItem("caatuu.appearance.theme.v1"), "dark");
  assert.equal(mandarinHarness.localStorage.getItem("caatuu-zh-hans.theme"), "dark");
});

test("the transparent header renders compact journey stats with exact accessible totals", () => {
  const journey = {
    activities: 12,
    activeGames: 2,
    accuracy: 75,
    rounds: 999_500,
    xp: 1_050_000
  };
  const streak = {
    currentDays: 3,
    highestDays: 7,
    remindersEnabled: false
  };
  const learning = {
    difficultyLevels: [],
    snapshot() {
      return {
        difficulty: 1,
        difficultyOption: { label: "Explorer", summary: "" },
        journey: { summary: journey },
        streak,
        summary: journey
      };
    }
  };
  const harness = createBrowserHarness({
    course: fixtureCourse(),
    window: { CaatuuLearning: learning }
  });
  const header = harness.document.createElement("header");
  header.className = "app-header";
  harness.document.body.append(header);

  runChrome(harness);

  const formatter = harness.window.CaatuuChrome.formatCompactRewardCount;
  for (const [value, expected] of [
    [0, "0"],
    [999, "999"],
    [1_000, "1K"],
    [1_050, "1.1K"],
    [9_950, "10K"],
    [999_499, "999K"],
    [999_500, "1M"],
    [1_050_000, "1.1M"],
    [999_500_000, "999M+"],
    [1_000_000_000, "999M+"]
  ]) {
    assert.equal(formatter(value), expected, `compact reward count for ${value}`);
  }

  const stats = header.querySelector(".app-header-stats");
  const xp = header.querySelector("[data-caatuu-header-xp]");
  const coins = header.querySelector("[data-caatuu-header-coins]");
  const streakStat = header.querySelector("[data-caatuu-streak]");
  const languageIndicator = header.querySelector("[data-caatuu-language-indicator]");
  assert.ok(stats);
  assert.equal(languageIndicator.tagName, "SPAN");
  assert.equal(languageIndicator.getAttribute("role"), "img");
  assert.equal(languageIndicator.getAttribute("aria-haspopup"), null);
  assert.match(languageIndicator.getAttribute("aria-label"), /Current learning language: Czech/u);
  assert.match(languageIndicator.getAttribute("aria-label"), /Change languages from Home/u);
  assert.equal(header.querySelector(".language-selector"), null);
  assert.equal(xp.classList.contains("app-header-stat"), true);
  assert.equal(xp.classList.contains("app-header-xp"), true);
  assert.equal(coins.classList.contains("app-header-stat"), true);
  assert.equal(coins.classList.contains("app-header-coins"), true);
  assert.equal(streakStat.classList.contains("app-header-stat"), true);
  assert.equal(streakStat.classList.contains("app-header-streak"), true);
  assert.equal(xp.querySelector("[data-caatuu-header-xp-count]").textContent, "1.1M");
  assert.equal(coins.querySelector("[data-caatuu-header-coins-count]").textContent, "1M");
  assert.equal(streakStat.querySelector("[data-caatuu-streak-count]").textContent, "3");

  for (const [element, exactCount, label] of [
    [xp, "1050000", /(?:XP|experience)/iu],
    [coins, "999500", /coins?/iu]
  ]) {
    for (const attribute of ["aria-label", "title"]) {
      const accessibleText = element.getAttribute(attribute);
      assert.match(accessibleText, label);
      assert.equal(accessibleText.replace(/\D/gu, ""), exactCount);
      assert.doesNotMatch(accessibleText, /\d(?:\.\d)?[KM]\+?/u);
    }
  }
  assert.equal(streakStat.getAttribute("aria-label"), "3 days streak. Best: 7 days.");
  assert.equal(streakStat.getAttribute("title"), "3 days streak · Best 7 days");

  journey.xp = 999;
  journey.rounds = 1_000;
  streak.currentDays = 4;
  harness.window.dispatchEvent(new harness.window.CustomEvent("caatuu:learning-change"));
  assert.equal(xp.querySelector("[data-caatuu-header-xp-count]").textContent, "999");
  assert.equal(coins.querySelector("[data-caatuu-header-coins-count]").textContent, "1K");
  assert.equal(streakStat.querySelector("[data-caatuu-streak-count]").textContent, "4");
  harness.window.dispatchEvent({ type: "pagehide" });
});

test("the Home submenu exposes shared section semantics and availability", () => {
  const { document, nav } = executeChromeWithHomeMenu();
  const trigger = nav.querySelector('[data-nav-key="home"]');
  const backdrop = document.querySelector("#homeMenuPanel");
  const menu = document.querySelector("#homeMenu");
  const menuHost = document.querySelector("[data-caatuu-bottom-dock-menu]");
  const options = menu.querySelectorAll("[data-home-menu-target]");
  const [home, social, store] = options;

  assert.equal(trigger.hasAttribute("aria-haspopup"), false);
  assert.equal(trigger.getAttribute("aria-controls"), "homeMenu");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assertHomeNavIndicator(trigger, "home", "homebase_icon.png");
  assert.equal(backdrop.hidden, true);
  assert.equal(menu.hidden, true);
  assert.equal(menu.parentElement, menuHost);
  assert.equal(menu.classList.contains("home-section-switcher"), true);
  assert.equal(menu.getAttribute("role"), "tablist");
  assert.equal(menu.getAttribute("aria-label"), "Home sections");
  assert.deepEqual(options.map((option) => option.dataset.homeMenuTarget), [
    "home",
    "social",
    "store"
  ]);

  assert.equal(home.disabled, false);
  assert.equal(home.getAttribute("role"), "tab");
  assert.equal(home.getAttribute("aria-selected"), "true");
  assert.equal(home.getAttribute("aria-current"), "page");
  assert.equal(home.getAttribute("aria-controls"), "homeBaseView");
  assert.equal(home.tabIndex, 0);

  assert.equal(social.disabled, false);
  assert.equal(social.getAttribute("role"), "tab");
  assert.equal(social.getAttribute("aria-disabled"), null);
  assert.equal(social.getAttribute("aria-selected"), "false");
  assert.equal(social.getAttribute("aria-controls"), "homeSocialView");
  assert.equal(social.getAttribute("aria-label"), "Social. In development.");
  assert.equal(social.classList.contains("is-disabled"), false);
  assert.equal(social.tabIndex, -1);
  assert.match(social.textContent, /Social/u);
  assert.match(social.textContent, /In development/u);

  assert.equal(store.disabled, false);
  assert.equal(store.getAttribute("role"), "tab");
  assert.equal(store.getAttribute("aria-selected"), "false");
  assert.equal(store.getAttribute("aria-controls"), "homeStoreView");
  assert.equal(store.tabIndex, -1);

  for (const [option, iconName] of [
    [home, "homebase_icon.png"],
    [social, "social_icon.png"],
    [store, "store_icon.png"]
  ]) {
    const icon = option.querySelector("img");
    assert.match(icon.src, new RegExp(`/assets/icons/${iconName.replace(".", "\\.")}(?:\\?.*)?$`, "u"));
    assert.equal(icon.alt, "");
    assert.equal(icon.getAttribute("aria-hidden"), "true");
  }
});

test("the Home submenu navigates Social and Store, redraws Store, and restores focus", () => {
  const { document, homeBaseView, homeSocialView, homeStoreArt, homeStoreView, homeView, nav } = executeChromeWithHomeMenu();
  const displayMenu = document.createElement("details");
  displayMenu.id = "setupDisplayMenu";
  displayMenu.setAttribute("open", "");
  homeBaseView.prepend(displayMenu);
  const trigger = nav.querySelector('[data-nav-key="home"]');
  const dock = nav.closest("[data-caatuu-bottom-dock]");
  const backdrop = document.querySelector("#homeMenuPanel");
  const menu = document.querySelector("#homeMenu");
  const home = menu.querySelector('[data-home-menu-target="home"]');
  const social = menu.querySelector('[data-home-menu-target="social"]');
  const store = menu.querySelector('[data-home-menu-target="store"]');
  const homeIndicator = assertHomeNavIndicator(trigger, "home", "homebase_icon.png");
  const storeArtworkUrls = new Set(Array.from(
    { length: 16 },
    (_value, index) => `/assets/stores/stores%20(${index + 1}).png`
  ));

  trigger.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(dock.dataset.openMenu, "home");
  assert.equal(backdrop.hidden, false);
  assert.equal(menu.hidden, false);
  assert.equal(document.activeElement, home);

  home.dispatchEvent({ type: "keydown", key: "ArrowRight", bubbles: true });
  assert.equal(document.activeElement, social, "keyboard navigation must include Social");
  assert.equal(trigger.querySelector(".app-nav-submenu-icon"), homeIndicator);
  assertHomeNavIndicator(trigger, "home", "homebase_icon.png");
  social.click();
  assert.equal(displayMenu.getAttribute("open"), null, "leaving Home must close its display popover");
  assert.equal(home.getAttribute("aria-selected"), "false");
  assert.equal(social.getAttribute("aria-selected"), "true");
  assert.equal(social.getAttribute("aria-current"), "page");
  assert.equal(homeView.dataset.homeDestination, "social");
  assert.equal(homeView.getAttribute("aria-labelledby"), "homeSocialTitle");
  assert.equal(homeBaseView.hidden, true);
  assert.equal(homeSocialView.hidden, false);
  assert.equal(homeStoreView.hidden, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, trigger, "selecting Social must restore focus to the Home trigger");
  assert.equal(trigger.querySelector(".app-nav-submenu-icon"), homeIndicator);
  assertHomeNavIndicator(trigger, "social", "social_icon.png");

  trigger.click();
  assert.equal(document.activeElement, social, "reopening the submenu must focus Social");
  social.dispatchEvent({ type: "keydown", key: "ArrowLeft", bubbles: true });
  assert.equal(document.activeElement, home);
  home.dispatchEvent({ type: "keydown", key: "ArrowRight", bubbles: true });
  social.dispatchEvent({ type: "keydown", key: "ArrowRight", bubbles: true });
  assert.equal(document.activeElement, store);
  assert.equal(trigger.querySelector(".app-nav-submenu-icon"), homeIndicator);
  assertHomeNavIndicator(trigger, "social", "social_icon.png");
  store.click();
  assert.equal(home.getAttribute("aria-selected"), "false");
  assert.equal(social.getAttribute("aria-current"), null);
  assert.equal(store.getAttribute("aria-selected"), "true");
  assert.equal(store.getAttribute("aria-current"), "page");
  assert.equal(homeView.getAttribute("aria-labelledby"), "homeStoreTitle");
  assert.equal(homeBaseView.hidden, true);
  assert.equal(homeSocialView.hidden, true);
  assert.equal(homeStoreView.hidden, false);
  assert.ok(storeArtworkUrls.has(homeStoreArt.src), `unexpected Store artwork URL: ${homeStoreArt.src}`);
  assert.equal(document.activeElement, trigger, "selecting Store must restore focus to the Home trigger");
  assert.equal(trigger.querySelector(".app-nav-submenu-icon"), homeIndicator);
  assertHomeNavIndicator(trigger, "store", "store_icon.png");

  const firstStoreArtwork = homeStoreArt.src;
  trigger.click();
  assert.equal(document.activeElement, store, "reopening the submenu must focus Store");
  store.click();
  assert.ok(storeArtworkUrls.has(homeStoreArt.src), `unexpected second Store artwork URL: ${homeStoreArt.src}`);
  assert.notEqual(homeStoreArt.src, firstStoreArtwork, "Store must not immediately repeat its artwork");
  assert.equal(document.activeElement, trigger, "redrawing Store must restore focus to the Home trigger");
  assert.equal(trigger.querySelector(".app-nav-submenu-icon"), homeIndicator);
  assertHomeNavIndicator(trigger, "store", "store_icon.png");

  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  assert.equal(document.activeElement, store, "opening the submenu must focus its current section");
  store.dispatchEvent({ type: "keydown", key: "ArrowLeft", bubbles: true });
  assert.equal(document.activeElement, social, "reverse keyboard navigation must include Social");
  social.dispatchEvent({ type: "keydown", key: "Escape", bubbles: true });
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(backdrop.hidden, true);
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, trigger);

  trigger.click();
  home.click();
  assert.equal(trigger.querySelector(".app-nav-submenu-icon"), homeIndicator);
  assertHomeNavIndicator(trigger, "home", "homebase_icon.png");

  trigger.click();
  trigger.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, trigger);

  trigger.click();
  backdrop.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(backdrop.hidden, true);
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, trigger);
});

test("opening Games over Backpack preserves the current screen until selection", () => {
  const course = fixtureCourse();
  course.games = ["word-net"];
  course.capabilities.wordWorld = true;
  const { document, homeView, nav, window } = executeChromeWithHomeMenu({ course });
  const settingsPanel = document.createElement("section");
  settingsPanel.id = "settingsPanel";
  settingsPanel.hidden = false;
  const settingsSheet = document.createElement("section");
  settingsSheet.className = "settings-sheet";
  settingsSheet.dataset.settingsCurrentView = "settings";
  const settingsSentinel = document.createElement("h2");
  settingsSentinel.textContent = "Backpack settings stay visible";
  settingsSheet.append(settingsSentinel);
  settingsPanel.append(settingsSheet);

  const localGameTarget = document.createElement("button");
  localGameTarget.dataset.trainTab = "word-net";
  let localGameClicks = 0;
  localGameTarget.addEventListener("click", () => {
    localGameClicks += 1;
  });
  document.body.append(settingsPanel, localGameTarget);
  document.body.classList.add("settings-open");
  window.CaatuuChrome.setSettingsNavActive(true);

  const backpackTrigger = nav.querySelector('[data-nav-key="backpack"]');
  const gamesTrigger = nav.querySelector('[data-nav-key="games"]');
  const underlyingView = document.querySelector(".view.is-active");
  gamesTrigger.click();

  const chooser = document.querySelector("#gamesMenuPanel");
  assert.equal(settingsPanel.hidden, false);
  assert.equal(document.body.classList.contains("settings-open"), true);
  assert.equal(settingsSheet.dataset.settingsCurrentView, "settings");
  assert.equal(settingsSentinel.parentElement, settingsSheet);
  assert.equal(document.querySelector(".view.is-active"), underlyingView);
  assert.equal(underlyingView, homeView);
  assert.equal(backpackTrigger.classList.contains("is-active"), true);
  assert.equal(backpackTrigger.getAttribute("aria-current"), "page");
  assert.equal(chooser.hidden, false);
  assert.equal(gamesTrigger.getAttribute("aria-expanded"), "true");

  document.activeElement.dispatchEvent({ type: "keydown", key: "Escape", bubbles: true });
  assert.equal(chooser.hidden, true);
  assert.equal(settingsPanel.hidden, false);
  assert.equal(document.body.classList.contains("settings-open"), true);
  assert.equal(document.querySelector(".view.is-active"), underlyingView);

  gamesTrigger.click();
  document.querySelector('[data-game-menu-target="word-net"]').click();
  assert.equal(settingsPanel.hidden, true);
  assert.equal(document.body.classList.contains("settings-open"), false);
  assert.equal(chooser.hidden, true);
  assert.equal(gamesTrigger.getAttribute("aria-expanded"), "false");
  assert.equal(gamesTrigger.dataset.activeGame, "word-net");
  assert.equal(localGameClicks, 1);
});

test("the shared chooser opens the declared Sounds Quasar game", () => {
  const course = fixtureCourse();
  course.games = ["sound-quasar"];
  course.upcomingGames = ["memory-moon"];
  course.capabilities.speech = true;
  course.routes.soundQuasar = "/language-runtime/static/games/sound-quasar.html";
  const { document, nav } = executeChromeWithHomeMenu({ course, policy: shellPolicy });
  const localTarget = document.createElement("button");
  localTarget.dataset.trainTab = "sound-quasar";
  let selections = 0;
  localTarget.addEventListener("click", () => { selections += 1; });
  document.body.append(localTarget);
  nav.querySelector('[data-nav-key="games"]').click();
  const option = document.querySelector('[data-game-menu-target="sound-quasar"]');
  assert.equal(option.disabled, false);
  assert.equal(option.dataset.gameState, "playable");
  assert.equal(option.classList.contains("is-upcoming"), false);
  assert.equal(option.querySelector("strong").textContent, "Sounds Quasar");
  option.click();
  assert.equal(selections, 1);
  assert.equal(document.querySelector("#gamesMenuPanel").hidden, true);
  assert.equal(nav.querySelector('[data-nav-key="games"]').dataset.activeGame, "sound-quasar");
});
test("the shared game chooser presents Sounds Quasar as a disabled coming-later planet", () => {
  const course = fixtureCourse();
  course.games = ["word-net"];
  course.upcomingGames = ["memory-moon", "sound-quasar"];
  course.capabilities.wordWorld = true;
  course.capabilities.speech = true;
  const { document, nav } = executeChromeWithHomeMenu({ course });

  nav.querySelector('[data-nav-key="games"]').click();

  const option = document.querySelector('[data-game-menu-target="sound-quasar"]');
  assert.ok(option);
  assert.equal(option.disabled, true);
  assert.equal(option.getAttribute("aria-disabled"), "true");
  assert.equal(option.getAttribute("aria-label"), "Sounds Quasar. Coming later.");
  assert.equal(option.dataset.gameState, "upcoming");
  assert.equal(option.classList.contains("is-upcoming"), true);
  assert.equal(option.querySelector("strong").textContent, "Sounds Quasar");
  assert.equal(option.querySelector("small").textContent, "Coming later");
  assert.match(option.querySelector("img").src, /\/assets\/planets\/sounds-quasar\.png$/u);
});

test("old game identities keep one presentation and are saved canonically on selection", () => {
  const course = fixtureCourse();
  course.games = ["grammar-gravity"];
  course.linguisticFeatures = ["grammatical-agreement"];
  course.routes.grammarGravity = "/language-runtime/static/games/grammar-gravity.html";
  const key = `${course.storage.namespace}.navigation.active-game.v1`;
  const harness = createBrowserHarness({
    course,
    localStorageValues: { [key]: "agreement-aurora" },
    window: { CaatuuShellPolicy: shellPolicy }
  });
  const nav = harness.document.createElement("nav");
  nav.dataset.caatuuBottomNav = "";
  nav.dataset.activeSection = "games";
  // Build the menu tree explicitly: the light DOM harness does not parse
  // innerHTML, and globally registered detached options are not visible items.
  const panel = harness.document.createElement("div");
  panel.id = "gamesMenuPanel";
  panel.className = "games-menu-backdrop";
  panel.hidden = true;
  const grid = harness.document.createElement("nav");
  grid.className = "games-menu-grid";
  panel.append(grid);
  harness.document.body.append(nav, panel);
  runChrome(harness);

  const presentation = harness.window.CaatuuChrome.gamePresentation("agreement-aurora");
  assert.equal(presentation.title, "Grammar Gravity");
  assert.equal(presentation.titleId, "games.grammargravity.title");
  assert.equal(presentation.iconSrc, "/assets/planets/grammar-gravity.png?v=agreement-aurora-art-2");
  const trigger = nav.querySelector('[data-nav-key="games"]');
  assert.equal(trigger.dataset.activeGame, undefined,
    "an old preference must not imply an active planet while the launchpad is visible");
  assert.equal(harness.localStorage.getItem(key), "agreement-aurora",
    "rendering the selector must not rewrite a preference");
  trigger.click();
  const menu = harness.document.querySelector(".games-menu-grid");
  assert.equal(menu.querySelectorAll('[data-game-menu-target="grammar-gravity"]').length, 1);
  assert.equal(menu.querySelector('[data-game-menu-target="agreement-aurora"]'), null);
  menu.querySelector('[data-game-menu-target="grammar-gravity"]').click();
  assert.equal(trigger.dataset.activeGame, "grammar-gravity");
  assert.equal(harness.localStorage.getItem(key), "grammar-gravity");
  assert.equal(harness.sessionStorage.getItem(`${course.storage.namespace}.navigation.request.v1`),
    "game:grammar-gravity");
});

test("game presentations and visible course names derive from the interface catalog locale", () => {
  const interfaceContent = createInterfaceContent({
    ...englishInterfaceCatalog,
    locale: "es-ES",
    revision: "interface-es-test-1",
    messages: {
      ...englishInterfaceCatalog.messages,
      "games.wordworld.summary": "Significados y conexiones",
      "games.wordworld.title": "Mundo de palabras",
      "languages.cs": "checo revisado",
      "languages.en": "inglés revisado"
    }
  });
  const course = fixtureCourse();
  course.games = ["word-net"];
  course.capabilities.wordWorld = true;
  const harness = createBrowserHarness({ course });
  const indicator = harness.document.createElement("span");
  indicator.dataset.caatuuLanguageIndicator = "";
  const switcher = harness.document.createElement("button");
  switcher.dataset.caatuuLanguageSwitch = "";
  switcher.dataset.languageSwitchVariant = "home";
  harness.document.body.append(indicator, switcher);

  runChrome(harness, interfaceContent);

  const englishName = "inglés revisado";
  const czechName = "checo revisado";
  const presentation = harness.window.CaatuuChrome.gamePresentation("word-net");
  assert.equal(presentation.title, "Mundo de palabras");
  assert.equal(presentation.summary, "Significados y conexiones");
  assert.equal(presentation.titleId, "games.wordworld.title");
  assert.match(indicator.getAttribute("aria-label"), new RegExp(czechName, "u"));

  const currentCourse = harness.document.querySelector("[data-home-language-current-course]");
  assert.match(currentCourse.textContent, new RegExp(`${englishName} → ${czechName}`, "u"));
  const currentOption = harness.document.querySelector('[data-language-course-option="cz"]');
  assert.match(currentOption.textContent, /Čeština/u, "the explicit target autonym remains visible");
  assert.match(currentOption.textContent, new RegExp(czechName, "u"));
  assert.match(currentOption.getAttribute("aria-label"), new RegExp(czechName, "u"));
});

test("translated plain text remains literal in HTML templates and DOM properties", () => {
  const quoted = 'Abrir "Mis objetos" & <recuerdos>';
  const title = 'Mochila <viajera> & "amiga"';
  const translated = createInterfaceContent({
    ...englishInterfaceCatalog,
    locale: "es",
    revision: "interface-es-test-1",
    messages: {
      ...englishInterfaceCatalog.messages,
      "settings.backpack.openitems": quoted,
      "nav.backpack": title,
      "games.wordworld.title": title
    }
  });
  const harness = createBrowserHarness({ course: fixtureCourse() });
  runChrome(harness, translated);
  const panel = harness.document.createElement("div");
  harness.window.CaatuuChrome.renderSettingsPanel(panel);

  assert.ok(panel.innerHTML.includes('aria-label="Abrir &quot;Mis objetos&quot; &amp; &lt;recuerdos&gt;"'));
  assert.ok(panel.innerHTML.includes('title="Abrir &quot;Mis objetos&quot; &amp; &lt;recuerdos&gt;"'));
  assert.ok(panel.innerHTML.includes('<h2 id="settingsTitle">Mochila &lt;viajera&gt; &amp; &quot;amiga&quot;</h2>'));
  assert.ok(panel.innerHTML.includes('<img src="/assets/icons/backpack_icon.png"'), "the shared layout remains HTML");
  assert.doesNotMatch(panel.innerHTML, /<(?:viajera|recuerdos)>/u);
  assert.equal(harness.window.CaatuuChrome.gamePresentation("word-net").title, title,
    "textContent/setAttribute consumers receive plain translated text without HTML entities");
});

test("visible streak units refresh plural forms for current and best counts", () => {
  const streak = { currentDays: 1, highestDays: 2, remindersEnabled: false };
  const summary = { activities: 0, activeGames: 0, accuracy: null, rounds: 0, xp: 0 };
  const learning = {
    difficultyLevels: [],
    snapshot: () => ({
      difficulty: 1,
      difficultyOption: { label: "Explorer", summary: "" },
      journey: { summary },
      streak,
      summary
    })
  };
  const translated = createInterfaceContent({
    ...englishInterfaceCatalog,
    locale: "es",
    revision: "interface-es-test-1",
    messages: {
      ...englishInterfaceCatalog.messages,
      "progress.streak.dayword": { one: "día", other: "días" }
    }
  });
  const harness = createBrowserHarness({
    course: fixtureCourse(),
    window: { CaatuuLearning: learning }
  });
  const currentUnit = harness.document.createElement("span");
  currentUnit.dataset.caatuuStreakUnit = "current";
  const bestUnit = harness.document.createElement("span");
  bestUnit.dataset.caatuuStreakUnit = "best";
  harness.document.body.append(currentUnit, bestUnit);
  runChrome(harness, translated);
  assert.equal(currentUnit.textContent, "día");
  assert.equal(bestUnit.textContent, "días");

  streak.currentDays = 2;
  streak.highestDays = 1;
  harness.window.dispatchEvent(new harness.window.CustomEvent("caatuu:learning-change"));
  assert.equal(currentUnit.textContent, "días");
  assert.equal(bestUnit.textContent, "día");

  const panel = harness.document.createElement("div");
  harness.window.CaatuuChrome.renderSettingsPanel(panel);
  assert.match(panel.innerHTML, /data-caatuu-streak-unit="current"/u);
  assert.match(panel.innerHTML, /data-caatuu-streak-unit="best"/u);
  harness.window.dispatchEvent({ type: "pagehide" });
});

test("denied notification permission has calm copy and explains that progress still works", () => {
  const harness = createBrowserHarness({ course: fixtureCourse(), window: {
    CaatuuRuntime: { env: "browser", registerServiceWorker: async () => true }, Notification: { permission: "denied" },
    CaatuuLearning: { snapshot: () => ({ difficulty: 1, difficultyOption: {}, summary: {}, streak: { currentDays: 3, highestDays: 3 } }) }
  } });
  const button = harness.document.createElement("button");
  button.setAttribute("data-streak-reminder-toggle", "");
  harness.document.body.append(button);
  runChrome(harness);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, englishInterfaceCatalog.messages["progress.reminders.blocked"]);
  assert.equal(button.getAttribute("aria-label"), englishInterfaceCatalog.messages["progress.reminders.permissionhint"]);
  assert.equal(button.title, button.getAttribute("aria-label"));
  harness.window.dispatchEvent({ type: "pagehide" });
});

test("About preserves its content with a compact update button and install controls stay in Advanced", () => {
  const harness = createBrowserHarness({ course: fixtureCourse() });
  runChrome(harness);
  const panel = harness.document.createElement("div");
  harness.window.CaatuuChrome.renderSettingsPanel(panel);
  const about = panel.innerHTML.slice(panel.innerHTML.indexOf('class="settings-card side-card about-card"'));
  assert.match(about, /id="updateApp"/u);
  assert.doesNotMatch(about, /id="browserInstallActions"|data-update-app-copy|data-maintenance-action-row/u);
  assert.match(panel.innerHTML.slice(0, panel.innerHTML.indexOf('class="settings-card side-card about-card"')), /id="browserInstallActions"/u);
  assert.match(about, /about-brand-note/u);
  assert.match(about, /legal-notice/u);
  assert.match(about, /legal-details/u);
  assert.ok(about.indexOf('id="updateApp"') < about.indexOf("<details"), "updating needs no expandable section");
  harness.window.dispatchEvent({ type: "pagehide" });
});

test("shared update controls keep browser freshness checks and offline failures out of the page chrome", async () => {
  const h = createBrowserHarness({ course: fixtureCourse() });
  h.window.CaatuuRuntime = { env: "browser", registerServiceWorker: async () => false };
  h.window.CaatuuMaintenanceUi = { getUpdateController: () => ({}) };
  runChrome(h);
  await Promise.resolve();
  for (const state of ["checking", "offline", "update-ready"]) {
    h.window.dispatchEvent({ type: "caatuu:app-freshness", detail: { state } });
    assert.equal(h.document.querySelector(".app-freshness-notice"), null);
  }
  h.window.dispatchEvent({ type: "pagehide" });
});

function progressSaveHarness({ env = "browser", status = "saved", retry = () => {} } = {}) {
  return executeChrome({
    runtime: { env },
    window: {
      CaatuuLearning: {
        snapshot: () => ({ difficulty: 1, difficultyOption: {}, summary: {}, streak: {} }),
        saveStatus: () => ({ status }),
        retryPendingSaves: retry
      }
    }
  });
}

for (const env of ["browser", "android"]) {
  test(`${env} chrome surfaces a save failure that happened before chrome loaded`, () => {
    const harness = progressSaveHarness({ env, status: "error" });
    const notice = harness.document.querySelector("#progressSaveNotice");
    assert.ok(notice);
    assert.equal(notice.hidden, false);
    assert.equal(notice.getAttribute("role"), "alert");
    assert.equal(notice.getAttribute("aria-atomic"), "true");
    assert.equal(notice.querySelector("span").textContent, englishInterfaceCatalog.messages["chrome.progress.savefailed"]);
    assert.equal(notice.querySelector("button").textContent, englishInterfaceCatalog.messages["common.retry"]);
    harness.window.dispatchEvent({ type: "pagehide" });
  });
}

test("save retries remain visible until storage confirms success, while ordinary pending saves stay quiet", async () => {
  let resolveRetry;
  let retryCount = 0;
  const retryResult = new Promise((resolve) => { resolveRetry = resolve; });
  const harness = progressSaveHarness({ retry: () => { retryCount += 1; return retryResult; } });
  const changeStatus = (status) => harness.window.dispatchEvent({
    type: "caatuu:progress-save-status", detail: { status }
  });
  assert.equal(harness.document.querySelector("#progressSaveNotice"), null);
  changeStatus("pending");
  assert.equal(harness.document.querySelector("#progressSaveNotice"), null);
  changeStatus("error");
  const notice = harness.document.querySelector("#progressSaveNotice");
  const retry = notice.querySelector("button");
  retry.click();
  retry.click();
  assert.equal(retryCount, 1, "an in-flight retry cannot be submitted twice");
  assert.equal(retry.disabled, true);
  changeStatus("pending");
  assert.equal(notice.hidden, false);
  resolveRetry(true);
  await new Promise(setImmediate);
  assert.equal(retry.disabled, false);
  assert.equal(notice.hidden, false, "a resolved retry does not itself confirm persistence");
  changeStatus("saved");
  assert.equal(notice.hidden, true);
  changeStatus("error");
  assert.equal(notice.hidden, false);
  assert.equal(harness.document.querySelectorAll("#progressSaveNotice").length, 1);
  harness.window.dispatchEvent({ type: "pagehide" });
});

test("failed save retries keep the warning and allow another retry", async () => {
  for (const retry of [() => { throw new Error("storage unavailable"); }, () => Promise.reject(new Error("storage unavailable"))]) {
    const harness = progressSaveHarness({ status: "error", retry });
    const notice = harness.document.querySelector("#progressSaveNotice");
    const button = notice.querySelector("button");
    button.click();
    await new Promise(setImmediate);
    assert.equal(button.disabled, false);
    assert.equal(notice.hidden, false);
    harness.window.dispatchEvent({ type: "pagehide" });
  }
});

test("save failures take precedence over an app refresh notice until the progress is safe", () => {
  const harness = progressSaveHarness();
  harness.window.dispatchEvent({ type: "caatuu:app-freshness", detail: { state: "update-ready" } });
  const freshness = harness.document.querySelector("#appFreshnessNotice");
  assert.equal(freshness.hidden, false);
  harness.window.dispatchEvent({ type: "caatuu:progress-save-status", detail: { status: "error" } });
  assert.equal(freshness.hidden, true);
  harness.window.dispatchEvent({ type: "caatuu:app-freshness", detail: { state: "offline" } });
  assert.equal(freshness.hidden, true, "later update events do not cover the save warning");
  harness.window.dispatchEvent({ type: "caatuu:progress-save-status", detail: { status: "saved" } });
  assert.equal(freshness.hidden, false);
  assert.equal(freshness.querySelector("[data-freshness-message]").textContent, englishInterfaceCatalog.messages["chrome.freshness.offline"]);
  harness.window.dispatchEvent({ type: "pagehide" });
});

test("a rejected progress reset reports failure without claiming completion", async () => {
  const harness = progressSaveHarness();
  let resetAttempts = 0;
  let cancelled = 0;
  harness.window.CaatuuLearning.resetProgress = () => { resetAttempts += 1; throw new Error("Storage is unavailable"); };
  harness.window.addEventListener("caatuu:progress-reset-cancelled", () => { cancelled += 1; });
  const reset = harness.document.createElement("button");
  reset.id = "settingsResetCourseProgress";
  reset.dataset.confirmArmed = "true";
  const status = harness.document.createElement("p");
  status.id = "learningStatus";
  harness.document.body.append(reset, status);
  reset.click();
  await new Promise(setImmediate);
  assert.equal(resetAttempts, 1);
  assert.equal(cancelled, 1);
  assert.equal(status.textContent, englishInterfaceCatalog.messages["progress.restart.failed"]);
  harness.window.dispatchEvent({ type: "pagehide" });
});

test("opening Home over Backpack preserves the current screen until selection", () => {
  const { document, nav, window } = executeChromeWithHomeMenu();
  const settingsPanel = document.createElement("section");
  settingsPanel.id = "settingsPanel";
  settingsPanel.hidden = false;
  const settingsSentinel = document.createElement("p");
  settingsSentinel.textContent = "Backpack settings stay visible";
  settingsPanel.append(settingsSentinel);
  document.body.append(settingsPanel);
  document.body.classList.add("settings-open");
  window.CaatuuChrome.setSettingsNavActive(true);

  const backpackTrigger = nav.querySelector('[data-nav-key="backpack"]');
  const homeTrigger = nav.querySelector('[data-nav-key="home"]');
  homeTrigger.click();

  assert.equal(settingsPanel.hidden, false);
  assert.equal(document.body.classList.contains("settings-open"), true);
  assert.equal(settingsSentinel.parentElement, settingsPanel);
  assert.equal(backpackTrigger.classList.contains("is-active"), true);
  assert.equal(backpackTrigger.getAttribute("aria-current"), "page");
  assert.equal(document.querySelector("#homeMenuPanel").hidden, false);
  assert.equal(homeTrigger.getAttribute("aria-expanded"), "true");

  document.activeElement.dispatchEvent({ type: "keydown", key: "Escape", bubbles: true });
  assert.equal(document.querySelector("#homeMenuPanel").hidden, true);
  assert.equal(settingsPanel.hidden, false);
  assert.equal(document.body.classList.contains("settings-open"), true);

  homeTrigger.click();
  document.querySelector('[data-home-menu-target="social"]').click();
  assert.equal(settingsPanel.hidden, true);
  assert.equal(document.body.classList.contains("settings-open"), false);
  assert.equal(document.querySelector("#homeMenuPanel").hidden, true);
  assert.equal(homeTrigger.getAttribute("aria-expanded"), "false");
});

test("the Games header stays on the launchpad and only opens the game chooser", () => {
  const course = fixtureCourse();
  course.games = ["word-net"];
  course.capabilities.wordWorld = true;
  const harness = createBrowserHarness({ course });
  const header = harness.document.createElement("header");
  header.className = "app-header";
  header.dataset.caatuuPageKicker = "Train";
  header.dataset.caatuuPageTitle = "Games";
  header.dataset.caatuuPageIcon = "/assets/icons/games_icon.png";

  const homeView = harness.document.createElement("section");
  homeView.id = "view-home";
  homeView.className = "view home-view";
  const gamesView = harness.document.createElement("section");
  gamesView.id = "view-verbs";
  gamesView.className = "view is-active";
  const launchpad = harness.document.createElement("section");
  launchpad.id = "trainPanelGalaxy";
  gamesView.append(launchpad);

  const nav = harness.document.createElement("nav");
  nav.dataset.caatuuBottomNav = "";
  nav.dataset.viewButtons = "true";
  nav.dataset.settingsTarget = "openSettings";
  harness.document.body.append(header, homeView, gamesView, nav);

  runChrome(harness);

  let brand = header.querySelector(".brand-link");
  assert.equal(brand.dataset.gameMenuLauncher, "");
  assert.equal(brand.dataset.navigationRequest, undefined);
  assert.equal(brand.getAttribute("aria-label"), "Open game chooser");

  brand.click();
  const chooser = harness.document.querySelector("#gamesMenuPanel");
  const gamesTrigger = nav.querySelector('[data-nav-key="games"]');
  assert.equal(chooser.hidden, false);
  assert.equal(gamesTrigger.getAttribute("aria-expanded"), "true");
  assert.equal(gamesView.classList.contains("is-active"), true);
  assert.equal(homeView.classList.contains("is-active"), false);

  brand.click();
  assert.equal(harness.document.querySelector("#gamesMenuPanel"), chooser);
  assert.equal(chooser.hidden, false, "repeated header clicks must not close the chooser");
  assert.equal(gamesTrigger.getAttribute("aria-expanded"), "true");

  harness.window.CaatuuChrome.setPagePresentation({
    kicker: "Caatuu",
    title: "Home",
    iconSrc: "/assets/icons/home_icon.png"
  });
  brand = header.querySelector(".brand-link");
  assert.equal(brand.dataset.gameMenuLauncher, undefined);
  assert.equal(brand.dataset.navigationRequest, "home");
  assert.equal(brand.getAttribute("aria-label"), "Open Czech Journey home");
});

test("the Backpack header icon is an Items shortcut", () => {
  assert.match(
    chromeSource,
    /<button class="settings-brand-mark" type="button" data-settings-view="items" aria-label="\$\{interfaceHtml\("settings\.backpack\.openitems"\)\}" aria-controls="itemsViewPanel"/u
  );

  const harness = executeChrome();
  const panel = harness.document.createElement("section");
  panel.id = "settingsPanel";
  panel.hidden = false;
  const sheet = harness.document.createElement("section");
  sheet.className = "settings-sheet";
  sheet.dataset.settingsCurrentView = "settings";
  const shortcut = harness.document.createElement("button");
  shortcut.type = "button";
  shortcut.className = "settings-brand-mark";
  shortcut.dataset.settingsView = "items";
  shortcut.setAttribute("aria-controls", "itemsViewPanel");
  const body = harness.document.createElement("div");
  body.className = "settings-sheet-body";
  const items = harness.document.createElement("section");
  items.id = "itemsViewPanel";
  items.dataset.settingsViewPanel = "items";
  items.hidden = true;
  const settings = harness.document.createElement("section");
  settings.id = "settingsViewPanel";
  settings.dataset.settingsViewPanel = "settings";
  settings.className = "is-active";
  body.append(items, settings);
  sheet.append(shortcut, body);
  panel.append(sheet);
  harness.document.body.append(panel);

  shortcut.click();

  assert.equal(panel.hidden, false);
  assert.equal(sheet.dataset.settingsCurrentView, "items");
  assert.equal(items.hidden, false);
  assert.equal(items.classList.contains("is-active"), true);
  assert.equal(settings.hidden, true);
  assert.equal(settings.classList.contains("is-active"), false);
});

test("the Home language form is wired at startup and confirms a course switch", () => {
  const assignments = [];
  const preservedProgress = {
    "caatuu-czech.learning.performance.v1": "czech-progress",
    "caatuu-zh-hans.learning.performance.v1": "mandarin-progress"
  };
  const harness = createBrowserHarness({
    course: fixtureCourse(),
    localStorageValues: preservedProgress,
    location: {
      assign(path) {
        assignments.push(path);
      }
    },
    window: {
      CaatuuLearning: {
        courseSummaries() {
          return [
            {
              id: "cz",
              sourceLanguageId: "en",
              targetLanguageId: "cs",
              hasProgress: true,
              summary: { xp: 1250, rounds: 3, attempts: 12, activities: 4 }
            },
            {
              id: "zh",
              sourceLanguageId: "en",
              targetLanguageId: "zh-Hans",
              hasProgress: false,
              summary: { xp: 0, rounds: 0, attempts: 0, activities: 0 }
            }
          ];
        },
        snapshot() {
          const summary = {
            xp: 1250,
            rounds: 3,
            attempts: 12,
            activities: 4,
            accuracy: 75,
            activeGames: 2
          };
          return {
            difficulty: 1,
            difficultyOption: { label: "Explorer", summary: "A steady pace." },
            summary,
            journey: { summary },
            streak: { currentDays: 0, highestDays: 0, remindersEnabled: false }
          };
        }
      }
    }
  });
  const trigger = harness.document.createElement("button");
  trigger.dataset.caatuuLanguageSwitch = "";
  trigger.dataset.languageSwitchVariant = "home";
  harness.document.body.append(trigger);

  runChrome(harness);

  const host = harness.document.querySelector(".language-selector");
  const menu = host.querySelector("[data-language-selector-menu]");
  const sourceOptions = menu.querySelectorAll("[data-language-base-option]");
  const courseOptions = menu.querySelectorAll("[data-language-course-option]");
  const current = courseOptions.find((option) => option.dataset.languageCourseOption === "cz");
  let preview = courseOptions.find((option) => option.dataset.languageCourseOption === "zh");
  const review = menu.querySelector("[data-language-selector-review]");
  const reviewStage = menu.querySelector("[data-language-selector-review-stage]");
  const choiceStage = menu.querySelector("[data-language-selector-choice-stage]");
  const currentCourse = host.querySelector("[data-home-language-current-course]");

  const routeFlags = currentCourse.querySelectorAll("img");
  assert.equal(routeFlags.length, 2);
  assert.equal(routeFlags[0].src, english.flagSrc);
  assert.equal(routeFlags[1].src, czech.flagSrc);
  assert.equal(currentCourse.tagName, "DIV");
  assert.equal(currentCourse.getAttribute("aria-haspopup"), null);
  assert.equal(currentCourse.getAttribute("aria-expanded"), null);
  assert.equal(currentCourse.dataset.languageSelectorOpener, undefined);
  assert.match(currentCourse.textContent, /Current course/u);
  assert.match(currentCourse.textContent, /English → Czech/u);
  assert.match(currentCourse.textContent, /1\.3K XP · 3 rounds/u);
  assert.match(currentCourse.textContent, /Current/u);
  assert.doesNotMatch(currentCourse.textContent, /Change|›/u);
  assert.equal(currentCourse.dataset.languageEffort, "1.3K XP · 3 rounds");
  assert.equal(currentCourse.dataset.languageEffortExact, "1250 experience points and 3 completed rounds");
  assert.match(currentCourse.getAttribute("aria-label"), /Current course: English to Czech/u);
  assert.equal(trigger.classList.contains("home-language-manage"), true);
  assert.match(trigger.textContent, /\+New course/u);
  assert.equal(trigger.querySelector(".home-language-manage-icon").getAttribute("aria-hidden"), "true");
  assert.equal(trigger.getAttribute("aria-label"), "Start a new language course");
  assert.equal(trigger.getAttribute("title"), "Start a new language course");
  assert.equal(trigger.dataset.caatuuLanguageSelectorRendered, "true");
  assert.equal(trigger.getAttribute("aria-haspopup"), "dialog");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(menu.hidden, true);
  assert.equal(menu.getAttribute("role"), "dialog");
  assert.match(menu.textContent, /What language do you use\?/u);
  assert.match(menu.textContent, /What language do you want to learn\?/u);
  assert.equal(sourceOptions.length, 1);
  assert.equal(courseOptions.length, 2);
  assert.equal(current.getAttribute("aria-current"), "page");
  assert.equal(current.getAttribute("aria-checked"), "false");
  assert.equal(sourceOptions[0].getAttribute("aria-checked"), "false");
  assert.equal(current.disabled, true);
  assert.equal(preview.disabled, true);
  assert.equal(current.closest("fieldset").disabled, true);
  assert.equal(current.dataset.languageEffort, "1.3K XP · 3 rounds");
  assert.equal(current.dataset.languageEffortExact, "1250 experience points and 3 completed rounds");
  assert.equal(preview.dataset.languageEffort, "Not started");
  assert.equal(preview.href, "");
  assert.match(preview.textContent, /简体中文/u);
  assert.match(preview.textContent, /Preview/u);
  assert.equal(review.textContent, "Continue");
  assert.equal(review.disabled, true);

  trigger.click();
  preview.click();
  assert.equal(review.disabled, true, "step 2 cannot select a course before step 1");
  menu.querySelector('[data-language-base-option="en"]').click();
  preview = menu.querySelector('[data-language-course-option="zh"]');
  assert.equal(preview.closest("fieldset").disabled, false);
  assert.equal(preview.disabled, false);
  assert.equal(preview.getAttribute("aria-checked"), "false");
  assert.equal(review.disabled, true, "step 1 must not automatically choose step 2");
  preview.click();
  preview = menu.querySelector('[data-language-course-option="zh"]');
  assert.equal(assignments.length, 0, "choosing a target must not navigate");
  assert.equal(menu.hidden, false, "choosing a target must keep the form open");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(preview.getAttribute("aria-checked"), "true");
  assert.match(preview.textContent, /Selected/u);
  assert.equal(review.disabled, false);
  assert.match(menu.querySelector("[data-language-selection-status]").textContent, /selected.*Continue/u);

  review.click();
  assert.equal(assignments.length, 0, "reviewing a target must not navigate");
  assert.equal(choiceStage.hidden, true);
  assert.equal(reviewStage.hidden, false);
  assert.match(menu.querySelector("[data-language-selector-review-title]").textContent, /Switch to Simplified Chinese\?/u);
  assert.equal(
    menu.querySelector("[data-language-selector-review-copy]").textContent,
    "Your Czech course progress will remain saved."
  );
  assert.doesNotMatch(menu.textContent, /Instructions will use/u);
  assert.match(
    menu.querySelector("[data-language-selector-review-status]").textContent,
    /XP, coins, and streak remain shared.*switch back to Czech at any time/u
  );
  const reviewInfo = menu.querySelector("[data-language-selector-review-info]");
  assert.equal(reviewInfo.textContent, "i");
  assert.equal(reviewInfo.getAttribute("aria-hidden"), "true");
  const reviewFlag = menu.querySelector("[data-language-selector-review-flag]");
  assert.equal(reviewFlag.src, mandarin.flagSrc);
  assert.equal(reviewFlag.alt, "");
  assert.equal(menu.querySelector("[data-language-selector-confirm]").textContent, "Confirm");

  menu.querySelector("[data-language-selector-back]").click();
  assert.equal(choiceStage.hidden, false);
  assert.equal(reviewStage.hidden, true);
  menu.querySelector("[data-language-selector-review]").click();
  menu.querySelector("[data-language-selector-confirm]").click();
  assert.deepEqual(assignments, ["/zh/index.html"]);
  assert.deepEqual(harness.localStorage.snapshot(), {
    ...preservedProgress,
    "caatuu.appearance.theme.v1": "light",
    "caatuu-cz.theme": "light",
    "caatuu.appearance.font-size.v1": "largest",
    "caatuu-cz.font-size": "largest"
  });
});

test("the Home course card offers engaged courses as confirmed quick switches", () => {
  const course = fixtureCourse();
  course.courseSelector.courses.push({
    id: "fr",
    status: "active",
    entryPath: "/fr/index.html",
    sourceLanguage: english,
    targetLanguage: french,
    storage: { learningPerformance: "caatuu-fr.learning.performance.v1" }
  });
  const assignments = [];
  const harness = executeChrome({
    course,
    location: { assign: (path) => assignments.push(path) },
    window: {
      CaatuuLearning: {
        courseSummaries() {
          return [
            {
              id: "cz",
              hasProgress: true,
              summary: { xp: 1250, rounds: 3, attempts: 12, activities: 4 }
            },
            {
              id: "zh",
              hasProgress: true,
              summary: { xp: 28, rounds: 10, attempts: 10, activities: 10 }
            },
            {
              id: "fr",
              hasProgress: false,
              summary: { xp: 0, rounds: 0, attempts: 0, activities: 0 }
            }
          ];
        },
        snapshot() {
          return {
            difficulty: 1,
            difficultyOption: { label: "Explorer", summary: "A steady pace." },
            summary: { xp: 1250, rounds: 3, attempts: 12, activities: 4 },
            journey: { summary: { xp: 1278, rounds: 13, attempts: 22, activities: 14 } },
            streak: { currentDays: 0, highestDays: 0, remindersEnabled: false }
          };
        }
      }
    }
  });
  const trigger = harness.document.createElement("button");
  trigger.dataset.caatuuLanguageSwitch = "";
  trigger.dataset.languageSwitchVariant = "home";
  harness.document.body.append(trigger);
  harness.window.CaatuuChrome.renderLanguageSwitch(trigger);

  const host = harness.document.querySelector(".language-selector");
  const menu = host.querySelector("[data-language-selector-menu]");
  const currentCourse = host.querySelector("[data-home-language-current-course]");
  const ongoing = host.querySelector("[data-home-language-ongoing-courses]");
  const quickSwitches = host.querySelectorAll("[data-home-language-quick-course]");
  assert.equal(currentCourse.tagName, "DIV");
  assert.equal(currentCourse.parentElement, host);
  assert.equal(ongoing.parentElement, host);
  assert.equal(ongoing.querySelector("h3").textContent, "Ongoing courses");
  assert.match(currentCourse.textContent, /Current/u);
  assert.doesNotMatch(currentCourse.textContent, /Change|›/u);
  assert.equal(trigger.classList.contains("home-language-manage"), true);
  assert.match(trigger.textContent, /\+New course/u);
  assert.equal(host.classList.contains("has-quick-courses"), true);
  assert.equal(quickSwitches.length, 1, "only non-current courses with recorded engagement are listed");
  assert.equal(quickSwitches[0].dataset.homeLanguageQuickCourse, "zh");
  assert.match(quickSwitches[0].textContent, /English → Simplified Chinese/u);
  assert.match(quickSwitches[0].textContent, /28 XP · 10 rounds/u);
  assert.match(quickSwitches[0].textContent, /Switch/u);
  assert.equal(host.querySelector('[data-home-language-quick-course="fr"]'), null);

  trigger.click();
  assert.equal(menu.hidden, false);
  assert.equal(menu.querySelector("[data-language-selector-choice-stage]").hidden, false);
  menu.querySelector("[data-language-selector-cancel]").click();
  assert.equal(menu.hidden, true);

  quickSwitches[0].click();
  assert.equal(assignments.length, 0, "quick switching still requires confirmation");
  assert.equal(menu.hidden, false);
  assert.equal(menu.querySelector("[data-language-selector-choice-stage]").hidden, true);
  assert.equal(menu.querySelector("[data-language-selector-review-stage]").hidden, false);
  assert.match(menu.querySelector("[data-language-selector-review-title]").textContent, /Simplified Chinese/u);
  assert.equal(quickSwitches[0].getAttribute("aria-expanded"), "true");

  menu.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(menu.hidden, true);
  assert.equal(quickSwitches[0].getAttribute("aria-expanded"), "false");
  assert.equal(harness.document.activeElement, quickSwitches[0]);

  quickSwitches[0].click();
  menu.querySelector("[data-language-selector-confirm]").click();
  assert.deepEqual(assignments, ["/zh/index.html"]);
});

test("the Home language form resets drafts and supports keyboard dismissal", () => {
  const assignments = [];
  const harness = createBrowserHarness({
    course: fixtureCourse(),
    location: { assign: (path) => assignments.push(path) }
  });
  const trigger = harness.document.createElement("button");
  trigger.dataset.caatuuLanguageSwitch = "";
  trigger.dataset.languageSwitchVariant = "home";
  harness.document.body.append(trigger);
  runChrome(harness);
  const menu = harness.document.querySelector("[data-language-selector-menu]");

  trigger.click();
  assert.equal(menu.tagName, "DIALOG", "native modality blocks pointer and keyboard access to the background");
  assert.equal(menu.open, true);
  assert.equal(menu.getAttribute("aria-modal"), "true");
  assert.equal(harness.document.activeElement.closest("dialog"), menu);
  menu.querySelector('[data-language-base-option="en"]').click();
  menu.querySelector('[data-language-course-option="zh"]').click();
  menu.querySelector("[data-language-selector-cancel]").click();
  assert.equal(menu.hidden, true);
  assert.equal(menu.open, false);
  assert.equal(assignments.length, 0);
  assert.equal(harness.document.activeElement, trigger);

  trigger.dispatchEvent({ type: "keydown", key: "ArrowDown" });
  const enabledOptions = menu.querySelectorAll(
    '[data-language-selector-option]:not([aria-disabled="true"])'
  );
  assert.equal(menu.hidden, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(harness.document.activeElement, enabledOptions[0]);
  assert.equal(menu.querySelector('[data-language-course-option="cz"]').getAttribute("aria-checked"), "false");
  assert.equal(menu.querySelector('[data-language-base-option="en"]').getAttribute("aria-checked"), "false");
  assert.equal(menu.querySelector('[data-language-course-option="cz"]').disabled, true);

  menu.dispatchEvent({ type: "keydown", key: "End" });
  assert.equal(harness.document.activeElement, enabledOptions.at(-1));
  menu.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(menu.hidden, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(harness.document.activeElement, trigger);
});

test("native dialog dismissal releases the language selector and restores its opener", () => {
  const harness = executeChrome();
  const trigger = harness.document.createElement("button");
  trigger.dataset.caatuuLanguageSwitch = "";
  harness.document.body.append(trigger);
  harness.window.CaatuuChrome.renderLanguageSwitch(trigger);
  const menu = harness.document.querySelector("[data-language-selector-menu]");
  trigger.click();
  menu.dispatchEvent({ type: "cancel" });
  assert.equal(menu.open, false);
  assert.equal(menu.hidden, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(harness.document.activeElement, trigger);
  trigger.click();
  menu.close();
  assert.equal(menu.hidden, true);
  assert.equal(harness.document.activeElement, trigger);
  trigger.click();
  menu.dispatchEvent({ type: "close" });
  assert.equal(menu.open, true, "a queued close event cannot dismiss a newly reopened dialog");
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
  assert.equal(preview.disabled, true);
  assert.equal(preview.href, "");
  assert.match(preview.textContent, /Browser only/u);
});

test("English stays first and bundled draft Spanish remains selectable on Android", () => {
  const spanish = { ...french, id: "es", locale: "es", label: "Spanish", nativeLabel: "Español", shortCode: "ES" };
  for (const currentId of ["cz", "es-en"]) {
    const course = fixtureCourse();
    const draft = {
      id: "es-en", status: "development", entryPath: "/es-en/index.html",
      sourceLanguage: spanish, targetLanguage: english,
      storage: { learningPerformance: "caatuu-es-en.learning.performance.v1" }
    };
    course.courseSelector.courses.unshift(draft);
    if (currentId === "es-en") Object.assign(course, draft);
    const assignments = [];
    const harness = executeChrome({
      course,
      runtime: { env: "android" },
      location: { assign: (path) => assignments.push(path) },
      window: { CaatuuAndroid: { isCourseBundled: (id) => ["cz", "es-en"].includes(id) } }
    });
    const trigger = harness.document.createElement("button");
    harness.document.body.append(trigger);
    harness.window.CaatuuChrome.renderLanguageSwitch(trigger);
    trigger.click();
    const menu = harness.document.querySelector("[data-language-selector-menu]");
    const bases = menu.querySelectorAll("[data-language-base-option]");
    assert.equal(bases[0].dataset.languageBaseOption, "en");
    assert.ok(bases.every((button) => button.getAttribute("aria-checked") === "false"));
    menu.querySelector('[data-language-base-option="es"]').click();
    assert.equal(menu.querySelector('[data-language-base-option="es"]').getAttribute("aria-checked"), "true");
    const target = menu.querySelector('[data-language-course-option="es-en"]');
    assert.equal(target.disabled, false);
    target.click();
    if (currentId === "cz") {
      menu.querySelector("[data-language-selector-review]").click();
      menu.querySelector("[data-language-selector-confirm]").click();
      assert.deepEqual(assignments, ["/es-en/index.html"]);
    }
  }
});

test("base-language switching preserves an explicitly chosen current target and checks the destination bundle", () => {
  const course = fixtureCourse();
  course.courseSelector.courses.push(
    {
      id: "zh-from-fr",
      status: "active",
      entryPath: "/fr/zh/index.html",
      sourceLanguage: french,
      targetLanguage: mandarin,
      storage: { learningPerformance: "caatuu-fr-zh.learning.performance.v1" }
    },
    {
      id: "cz-from-fr",
      status: "development",
      entryPath: "/fr/cz/index.html",
      sourceLanguage: french,
      targetLanguage: czech,
      storage: { learningPerformance: "caatuu-fr-cz.learning.performance.v1" }
    }
  );

  const assignments = [];
  const harness = executeChrome({
    course,
    location: { assign: (path) => assignments.push(path) },
    runtime: { env: "android" },
    window: {
      CaatuuAndroid: {
        isCourseBundled(courseId) {
          return courseId === "cz" || courseId === "cz-from-fr";
        }
      }
    }
  });
  const trigger = harness.document.createElement("button");
  trigger.dataset.caatuuLanguageSwitch = "";
  harness.document.body.append(trigger);

  harness.window.CaatuuChrome.renderLanguageSwitch(trigger);

  const frenchBase = harness.document.querySelector('[data-language-base-option="fr"]');
  assert.equal(frenchBase.getAttribute("aria-disabled"), null);
  assert.equal(frenchBase.href, "");
  assert.match(frenchBase.textContent, /Français/u);
  assert.doesNotMatch(frenchBase.textContent, /Browser only/u);
  trigger.click();
  harness.document.querySelector('[data-language-base-option="en"]').click();
  harness.document.querySelector('[data-language-course-option="cz"]').click();
  harness.document.querySelector('[data-language-base-option="fr"]').click();

  const menu = harness.document.querySelector("[data-language-selector-menu]");
  const selectedFrenchBase = menu.querySelector('[data-language-base-option="fr"]');
  const frenchCzech = menu.querySelector('[data-language-course-option="cz-from-fr"]');
  const frenchMandarin = menu.querySelector('[data-language-course-option="zh-from-fr"]');
  assert.equal(assignments.length, 0);
  assert.equal(menu.hidden, false, "choosing a base language must keep the form open");
  assert.equal(selectedFrenchBase.getAttribute("aria-checked"), "true");
  assert.equal(frenchCzech.getAttribute("aria-checked"), "true");
  assert.equal(frenchMandarin.getAttribute("aria-disabled"), "true");
  assert.match(frenchMandarin.textContent, /Browser only/u);

  menu.querySelector("[data-language-selector-review]").click();
  assert.equal(assignments.length, 0);
  menu.querySelector("[data-language-selector-confirm]").click();
  assert.deepEqual(assignments, ["/fr/cz/index.html"]);
});

test("base-language switching preserves the in-progress target selection", () => {
  const course = fixtureCourse();
  course.courseSelector.courses.push(
    {
      id: "zh-from-fr",
      status: "active",
      entryPath: "/fr/zh/index.html",
      sourceLanguage: french,
      targetLanguage: mandarin,
      storage: { learningPerformance: "caatuu-fr-zh.learning.performance.v1" }
    },
    {
      id: "cz-from-fr",
      status: "development",
      entryPath: "/fr/cz/index.html",
      sourceLanguage: french,
      targetLanguage: czech,
      storage: { learningPerformance: "caatuu-fr-cz.learning.performance.v1" }
    }
  );

  const assignments = [];
  const harness = executeChrome({
    course,
    location: { assign: (destination) => assignments.push(destination) }
  });
  const trigger = harness.document.createElement("button");
  trigger.dataset.caatuuLanguageSwitch = "";
  harness.document.body.append(trigger);
  harness.window.CaatuuChrome.renderLanguageSwitch(trigger);

  trigger.click();
  harness.document.querySelector('[data-language-base-option="en"]').click();
  harness.document.querySelector('[data-language-course-option="zh"]').click();
  harness.document.querySelector('[data-language-base-option="fr"]').click();

  const menu = harness.document.querySelector("[data-language-selector-menu]");
  assert.equal(
    menu.querySelector('[data-language-course-option="zh-from-fr"]').getAttribute("aria-checked"),
    "true"
  );
  menu.querySelector("[data-language-selector-review]").click();
  menu.querySelector("[data-language-selector-confirm]").click();
  assert.deepEqual(assignments, ["/fr/zh/index.html"]);
});

test("base-language switching preserves the exact target script variant", () => {
  const course = fixtureCourse();
  const simplified = { ...mandarin, id: "zh", locale: "zh-Hans" };
  const traditional = {
    ...mandarin,
    id: "zh",
    label: "Mandarin Chinese (Traditional)",
    nativeLabel: "繁體中文",
    locale: "zh-Hant"
  };
  course.courseSelector.courses.find(({ id }) => id === "zh").targetLanguage = simplified;
  course.courseSelector.courses.push(
    {
      id: "zh-hant",
      status: "active",
      entryPath: "/zh-hant/index.html",
      sourceLanguage: english,
      targetLanguage: traditional,
      storage: { learningPerformance: "caatuu-zh-hant.learning.performance.v1" }
    },
    {
      id: "zh-hans-from-fr",
      status: "active",
      entryPath: "/fr/zh-hans/index.html",
      sourceLanguage: french,
      targetLanguage: simplified,
      storage: { learningPerformance: "caatuu-fr-zh-hans.learning.performance.v1" }
    },
    {
      id: "zh-hant-from-fr",
      status: "active",
      entryPath: "/fr/zh-hant/index.html",
      sourceLanguage: french,
      targetLanguage: traditional,
      storage: { learningPerformance: "caatuu-fr-zh-hant.learning.performance.v1" }
    }
  );

  const assignments = [];
  const harness = executeChrome({
    course,
    location: { assign: (destination) => assignments.push(destination) }
  });
  const trigger = harness.document.createElement("button");
  trigger.dataset.caatuuLanguageSwitch = "";
  harness.document.body.append(trigger);
  harness.window.CaatuuChrome.renderLanguageSwitch(trigger);

  trigger.click();
  harness.document.querySelector('[data-language-base-option="en"]').click();
  harness.document.querySelector('[data-language-course-option="zh-hant"]').click();
  harness.document.querySelector('[data-language-base-option="fr"]').click();

  const menu = harness.document.querySelector("[data-language-selector-menu]");
  assert.equal(
    menu.querySelector('[data-language-course-option="zh-hant-from-fr"]').getAttribute("aria-checked"),
    "true"
  );
  assert.equal(
    menu.querySelector('[data-language-course-option="zh-hans-from-fr"]').getAttribute("aria-checked"),
    "false"
  );
  menu.querySelector("[data-language-selector-review]").click();
  menu.querySelector("[data-language-selector-confirm]").click();
  assert.deepEqual(assignments, ["/fr/zh-hant/index.html"]);
});

test("the current base badge uses the canonical source locale key", () => {
  const course = fixtureCourse();
  const regionalEnglish = { ...english, locale: "en-US" };
  course.sourceLanguage = regionalEnglish;
  for (const record of course.courseSelector.courses) {
    record.sourceLanguage = regionalEnglish;
  }
  const harness = executeChrome({ course });
  const trigger = harness.document.createElement("button");
  trigger.dataset.caatuuLanguageSwitch = "";
  harness.document.body.append(trigger);
  harness.window.CaatuuChrome.renderLanguageSwitch(trigger);

  const currentBase = harness.document.querySelector('[data-language-base-option="en-us"]');
  assert.ok(currentBase);
  assert.match(currentBase.textContent, /Current/u);
});
