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
  vm.runInContext(chromeSource, harness.context, { filename: "caatuu-chrome.js" });
  return harness;
}

function executeChromeWithHomeMenu({ course = fixtureCourse() } = {}) {
  const harness = createBrowserHarness({ course });
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

  vm.runInContext(chromeSource, harness.context, { filename: "caatuu-chrome.js" });
  return { ...harness, homeBaseView, homeSocialView, homeStoreArt, homeStoreView, homeView, nav };
}

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

  vm.runInContext(chromeSource, harness.context, { filename: "caatuu-chrome.js" });

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
  vm.runInContext(chromeSource, czechHarness.context, { filename: "caatuu-chrome.js" });
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
  vm.runInContext(chromeSource, mandarinHarness.context, { filename: "caatuu-chrome.js" });

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

  vm.runInContext(chromeSource, harness.context, { filename: "caatuu-chrome.js" });

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

  vm.runInContext(chromeSource, harness.context, { filename: "caatuu-chrome.js" });

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
    /<button class="settings-brand-mark" type="button" data-settings-view="items" aria-label="Open Backpack items" aria-controls="itemsViewPanel"/u
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

  vm.runInContext(chromeSource, harness.context, { filename: "caatuu-chrome.js" });

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
  assert.match(currentCourse.textContent, /English → Čeština/u);
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
  assert.equal(current.getAttribute("aria-checked"), "true");
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
  assert.match(menu.querySelector("[data-language-selector-review-title]").textContent, /Switch to Mandarin Chinese\?/u);
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
  assert.match(quickSwitches[0].textContent, /English → 简体中文/u);
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
  assert.match(menu.querySelector("[data-language-selector-review-title]").textContent, /Mandarin Chinese/u);
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
  vm.runInContext(chromeSource, harness.context, { filename: "caatuu-chrome.js" });
  const menu = harness.document.querySelector("[data-language-selector-menu]");

  trigger.click();
  menu.querySelector('[data-language-course-option="zh"]').click();
  menu.querySelector("[data-language-selector-cancel]").click();
  assert.equal(menu.hidden, true);
  assert.equal(assignments.length, 0);
  assert.equal(harness.document.activeElement, trigger);

  trigger.dispatchEvent({ type: "keydown", key: "ArrowDown" });
  const enabledOptions = menu.querySelectorAll(
    '[data-language-selector-option]:not([aria-disabled="true"])'
  );
  assert.equal(menu.hidden, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(harness.document.activeElement, enabledOptions[0]);
  assert.equal(menu.querySelector('[data-language-course-option="cz"]').getAttribute("aria-checked"), "true");

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
  assert.equal(preview.disabled, true);
  assert.equal(preview.href, "");
  assert.match(preview.textContent, /Browser only/u);
});

test("base-language switching preserves the current target and checks the destination bundle", () => {
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
  frenchBase.click();

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
