import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { createInterfaceContent } from "../static/source/interface-content.mjs";
import { mountRobotLoadingScreen } from "../static/source/games/embedded-game-controls.mjs";
import {
  fetchDeclaredCourseGameJson,
  readEmbeddedCourseProfile
} from "../static/source/games/course-game-content.mjs";
import {
  buildConjugationHelixRound,
  judgeConjugationHelixPair,
  judgeConjugationHelixRound,
  splitConjugationDisplay,
  buildConjugationVerbQueue,
  validateConjugationCometCatalog
} from "../static/source/games/conjugation-comet/conjugation-comet-core.mjs";

const hostSource = await readFile(new URL(
  "../static/source/games/conjugation-comet/conjugation-comet-host.mjs", import.meta.url
), "utf8");
const gameMarkup = await readFile(new URL(
  "../static/games/conjugation-comet.html", import.meta.url
), "utf8");
const englishInterface = JSON.parse(await readFile(new URL(
  "../static/data/interface/en.v1.json", import.meta.url
), "utf8"));

// The shared fake browser's seed() intentionally flattens id-bearing nodes.
// This game needs real ancestry and focus replacement, so assemble its actual
// simple static main markup into that same harness rather than duplicate a DOM.
function seedGameMarkup(harness) {
  const source = /<main\b[\s\S]*?<\/main>/u.exec(gameMarkup)?.[0];
  assert.ok(source, "the shared game document must expose its main landmark");
  const stack = [harness.document.body];
  const voidTags = new Set(["img", "input", "br", "hr", "source", "wbr"]);
  for (const token of source.match(/<!--[^]*?-->|<[^>]+>|[^<]+/gu) || []) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("</")) {
      stack.pop();
      continue;
    }
    if (!token.startsWith("<")) {
      stack.at(-1).append(token);
      continue;
    }
    const [, tag, attributes] = /^<([\w-]+)\b([^]*)>$/u.exec(token);
    const node = harness.document.createElement(tag);
    for (const [, name, value] of attributes.matchAll(/([:\w-]+)(?:="([^"]*)")?/gu)) {
      node.setAttribute(name, value ?? "");
    }
    stack.at(-1).append(node);
    if (!voidTags.has(tag) && !token.endsWith("/>")) stack.push(node);
  }
}

async function mountGame({ language = "czech", syntheticBase = false, framed = false, syncretic = false, speech = false, autoplay = false, muted = false, speechResult, duringLoad, reducedMotion = false, localStorageValues = {} } = {}) {
  const raw = JSON.parse(await readFile(new URL(
    `../../languages/${language}/static/data/games/conjugation-comet/verbs.json`, import.meta.url
  ), "utf8"));
  const czech = language === "czech";
  const course = {
    id: czech ? "cz" : "es",
    routePrefix: czech ? "/cz" : "/es",
    workspaceLabel: "Caatuu fixture",
    sourceLanguage: { id: "en", locale: "en", direction: "ltr", label: "Stale base label" },
    targetLanguage: {
      id: czech ? "cs" : "es",
      locale: czech ? "cs-CZ" : "es-ES",
      label: "Stale target label"
    },
    capabilities: { speech },
    gameContent: {
      "conjugation-comet": {
        conjugationCometCatalog: "data/games/conjugation-comet/verbs.json?v=test-1"
      }
    }
  };
  if (syntheticBase) {
    assert.equal(czech, false, "only v1 catalogs support a different learner base");
    course.id = "de-es";
    course.routePrefix = "/de-es";
    course.sourceLanguage = { id: "de", locale: "de", direction: "ltr" };
    raw.courseId = course.id;
    raw.learnerBaseLanguageId = "de";
    raw.verbs.forEach((verb, index) => {
      verb.learnerBaseText = `Grundbedeutung ${index}`;
      if (verb.meaningChoiceBaseText) verb.meaningChoiceBaseText = `Grundbedeutung ${index}`;
      verb.teachingNoteBaseText = `Lernhinweis ${index}`;
      verb.forms.forEach((form, formIndex) => {
        form.learnerBaseCueText = `Grundform ${index}.${formIndex}`;
        form.subjectBaseText = `Grundsubjekt ${formIndex}`;
      });
    });
  }
  if (framed) raw.verbs.forEach((verb) => verb.forms.forEach((form) => {
    form.targetPhraseFrame = { beforeText: "« ", afterText: " »" };
  }));
  if (syncretic) raw.verbs.forEach((verb) => {
    const field = czech ? "form" : "targetText";
    verb.forms[1][field] = verb.forms[0][field];
  });
  const catalog = validateConjugationCometCatalog(raw, {
    expectedCourseId: course.id,
    expectedTargetLanguageId: course.targetLanguage.id,
    expectedLearnerBaseLanguageId: course.sourceLanguage.id,
    expectedTargetLocale: course.targetLanguage.locale
  });
  const harness = createBrowserHarness({ course, localStorageValues, location: {
    href: "https://caatuu.test/language-runtime/static/games/conjugation-comet.html"
  } });
  const focusCalls = [];
  const animations = [];
  harness.window.matchMedia = () => ({ matches: reducedMotion });
  const createElement = harness.registry.create.bind(harness.registry);
  harness.registry.create = (tag) => {
    const node = createElement(tag);
    const focus = node.focus.bind(node);
    node.focus = (options) => {
      focusCalls.push({ node, options });
      focus(options);
    };
    node.animate = (frames, options) => {
      const animation = {
        node, frames, options, playState: "running", cancelled: false,
        pause() { this.playState = "paused"; },
        play() { this.playState = "running"; },
        cancel() { this.cancelled = true; this.playState = "idle"; }
      };
      animations.push(animation);
      return animation;
    };
    return node;
  };
  seedGameMarkup(harness);
  harness.document.querySelectorAll = (selector) => harness.registry.querySelectorAll(selector)
    .filter((node) => node.isConnected);
  harness.document.querySelector = (selector) => harness.document.querySelectorAll(selector)[0] || null;
  const interfaceCatalog = structuredClone(englishInterface);
  Object.assign(interfaceCatalog.messages, {
    "languages.cs": "Reviewed Czech",
    "languages.es": "Reviewed Spanish",
    "languages.en": "Reviewed English",
    "languages.de": "Reviewed German"
  });
  const languageNames = createInterfaceContent(interfaceCatalog);
  const records = [];
  const messages = [];
  const timers = new Map();
  const builtRounds = [];
  const toolbarCalls = [];
  const loaderCalls = [];
  const toolbarLifecycle = { closes: 0, destroys: 0 };
  const speechCalls = [];
  let speechStops = 0;
  let nextTimer = 0;
  let controlsOpen = false;
  const shell = {
    addEventListener: harness.window.addEventListener.bind(harness.window),
    removeEventListener: harness.window.removeEventListener.bind(harness.window),
    location: harness.window.location,
    document: harness.document,
    localStorage: harness.localStorage,
    CaatuuCourse: course,
    CaatuuI18n: languageNames,
    CaatuuLearning: { record: (gameId, delta) => records.push({ gameId, ...delta }) },
    CaatuuChrome: {
      getSpeechAutoplay: () => autoplay,
      getSpeechMuted: () => muted,
      speakText: async (text) => { speechCalls.push(text); await speechResult; },
      stopSpeech: async () => { speechStops += 1; }
    },
    postMessage: (message, origin) => messages.push({ message, origin })
  };
  harness.window.parent = shell;
  harness.window.setTimeout = (callback, delay) => {
    timers.set(++nextTimer, { callback, delay });
    return nextTimer;
  };
  harness.window.clearTimeout = (id) => timers.delete(id);
  let releaseCatalog;
  let rejectCatalog;
  const catalogReady = duringLoad ? new Promise((resolve, reject) => {
    releaseCatalog = resolve;
    rejectCatalog = reject;
  }) : Promise.resolve();
  Object.assign(harness.context, {
    fetchDeclaredCourseGameJson,
    readEmbeddedCourseProfile,
    buildConjugationHelixRound(...args) {
      const round = buildConjugationHelixRound(...args);
      builtRounds.push(round);
      return round;
    },
    judgeConjugationHelixPair,
    judgeConjugationHelixRound,
    splitConjugationDisplay,
    buildConjugationVerbQueue,
    validateConjugationCometCatalog,
    mountRobotLoadingScreen(options) {
      const controller = mountRobotLoadingScreen(options);
      const call = { ...options, minimumDurations: [] };
      loaderCalls.push(call);
      return Object.freeze({ ...controller, minimumVisible(milliseconds) {
        call.minimumDurations.push(milliseconds);
        // Real visible-time accounting is exercised in robot-loading.test.mjs.
        return Promise.resolve();
      } });
    },
    mountEmbeddedGameControls(options) {
      toolbarCalls.push(options);
      return {
        sync() {},
        isOpen: () => controlsOpen,
        close() { toolbarLifecycle.closes += 1; },
        destroy() { toolbarLifecycle.destroys += 1; }
      };
    },
    createSpeechIcon(document, { stop = false } = {}) {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("data-speech-icon", stop ? "stop" : "play");
      icon.setAttribute("aria-hidden", "true");
      return icon;
    },
    fetch: async () => { await catalogReady; return { ok: true, json: async () => raw }; }
  });
  const executableHost = hostSource
    .replace(/^import\s+[\s\S]*?\sfrom\s+["'][^"']+["'];\r?\n/gmu, "")
    .replace(/\bexport async function /gu, "async function ")
    .replace(/mountSharedConjugationComet\(\)\.catch\(showError\);/u, "");
  vm.runInContext(executableHost, harness.context, { filename: "conjugation-comet-host.mjs" });
  const mounting = vm.runInContext(
    "mountSharedConjugationComet({ scope: window, fetchImpl: fetch })", harness.context
  );
  if (duringLoad) {
    try { await duringLoad({ ...harness, shell, toolbarCalls, loaderCalls, speechCalls, timers, records, messages, rejectCatalog }); }
    finally { releaseCatalog(); }
  }
  const controller = await mounting;
  const element = (id) => harness.document.getElementById(id);
  const current = () => catalog.verbs.find((verb) => (
    verb.targetText === element("conjugationCometFormLemma").textContent
  ));
  function click(node) {
    assert.ok(node, "the requested live control must exist");
    assert.equal(node.disabled, false, "the requested live control must be enabled");
    node.focus();
    node.click();
  }
  function advance(delay) {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `expected a ${delay}ms game transition`);
    timers.delete(entry[0]);
    entry[1].callback();
  }
  const round = () => builtRounds.at(-1);
  const sideContainer = (side) => element(side === "subject" ? "conjugationCometSubjects" : "conjugationCometTargets");
  const items = (side) => side === "subject" ? round().subjects : round().options;
  const strandButtons = (side) => sideContainer(side).querySelectorAll(`button[data-helix-side="${side}"]`);
  const selectedButton = (side) => strandButtons(side).find((button) => button.dataset.row === "0");
  const selected = (side) => items(side)[Number(selectedButton(side)?.dataset.helixIndex)];
  const normalized = (text) => String(text).normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
  const isMatch = (subject, option) => [subject.correctFormText, ...subject.acceptedTargetTexts]
    .some((text) => normalized(text) === normalized(option.text));
  const offset = (side) => Number(selectedButton(side)?.dataset.helixIndex);
  function assessment(subjectOffset = offset("subject"), targetOffset = offset("target")) {
    const total = round().subjects.length;
    const pairs = round().subjects.map((_, row) => {
      const subject = round().subjects[(row + subjectOffset) % total];
      const option = round().options[(row + targetOffset) % total];
      return { subjectId: subject.id, optionId: option.id, correct: isMatch(subject, option) };
    });
    const matched = pairs.filter((pair) => pair.correct).length;
    return { correct: matched === total, matched, total, pairs };
  }
  function choose(side, index) {
    let steps = 0;
    while (offset(side) !== index) {
      assert.ok(++steps <= items(side).length, "cyclic navigation must reach every offset");
      click(element(side === "subject" ? "conjugationCometSubjectNext" : "conjugationCometTargetNext"));
      advance(420);
    }
  }
  function align(correct = true) {
    const index = round().options.findIndex((_, targetOffset) => assessment(offset("subject"), targetOffset).correct === correct);
    assert.ok(index >= 0, "the fixture must offer the requested whole-helix alignment");
    choose("target", index);
    return assessment();
  }
  function submit(correct = true) {
    const result = align(correct);
    click(element("conjugationCometSubmit"));
    return result;
  }
  function setControlsOpen(open) {
    controlsOpen = open;
    toolbarCalls[0].onOpenChange?.(open);
  }
  function setActive(active, { origin = "https://caatuu.test", source = shell } = {}) {
    harness.window.dispatchEvent({ type: "message", origin, source,
      data: { source: "caatuu-app-shell", type: "visibility", active } });
  }
  function setAutoplay(value) {
    autoplay = value;
    harness.window.dispatchEvent({ type: "caatuu:speech-autoplay-change" });
  }
  return { ...harness, shell, course, catalog, records, messages, toolbarCalls, toolbarLifecycle, loaderCalls,
    timers, controller, element, current, click, advance, languageNames, round, items, strandButtons,
    selectedButton, selected, offset, assessment, choose, align, submit, setControlsOpen, setActive, setAutoplay,
    attempts: () => records.filter((entry) => entry.attempts),
    speechCalls, speechStops: () => speechStops, focusCalls, animations };
}

async function settleMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function finishBatch(game) {
  game.submit();
  game.advance(1600);
}

test("initial and between-round loading use the same accessible robot presentation", async () => {
  const game = await mountGame({ duringLoad({ document, loaderCalls }) {
    assert.equal(loaderCalls.length, 2, "both shared loaders are mounted before content fetch completes");
    const initial = document.getElementById("conjugationCometLoading");
    const transition = document.getElementById("conjugationCometTransition");
    assert.equal(initial.hidden, false);
    assert.equal(transition.hidden, true);
    for (const screen of [initial, transition]) {
      assert.ok(screen.classList.contains("caatuu-game-robot-loading"));
      assert.equal(screen.getAttribute("role"), "status");
      assert.ok(screen.getAttribute("aria-label"));
      assert.equal(screen.querySelectorAll(".caatuu-game-robot-loading-art").length, 1);
    }
  } });
  const initial = game.element("conjugationCometLoading");
  const transition = game.element("conjugationCometTransition");
  assert.equal(initial.hidden, true);
  assert.ok(game.loaderCalls.find((call) => call.container === initial).minimumDurations.includes(1000));
  finishBatch(game);
  assert.equal(transition.hidden, false);
  assert.equal(transition.dataset.active, "true");
  game.setActive(false);
  assert.equal(transition.dataset.active, "false");
  game.setActive(true);
  assert.equal(transition.dataset.active, "true");
  game.advance(1200);
  assert.equal(transition.hidden, true);
  game.controller.destroy();
  assert.equal(initial.hidden, true);
  assert.equal(transition.hidden, true);
  assert.equal(game.timers.size, 0);
});

test("startup autoplay introduces the target verb once and repeats only for a new verb", async () => {
  const game = await mountGame({ speech: true, autoplay: true });
  await settleMicrotasks();
  const firstVerb = game.current().targetText;
  assert.deepEqual(game.speechCalls, [firstVerb]);
  assert.equal(game.toolbarCalls[0].autoplay, true, "the shared audio settings expose the autoplay preference");
  game.click(game.element("conjugationCometTargetPrev"));
  game.advance(420);
  game.setControlsOpen(true);
  game.setControlsOpen(false);
  game.setActive(false);
  game.setActive(true);
  game.document.visibilityState = "hidden";
  game.document.dispatchEvent({ type: "visibilitychange" });
  game.document.visibilityState = "visible";
  game.document.dispatchEvent({ type: "visibilitychange" });
  game.submit(false);
  game.advance(1800);
  await settleMicrotasks();
  assert.deepEqual(game.speechCalls, [firstVerb], "navigation, resumption, and a retry do not repeat the introduction");
  game.controller.next();
  await settleMicrotasks();
  assert.notEqual(game.current().targetText, firstVerb);
  assert.deepEqual(game.speechCalls, [firstVerb, game.current().targetText]);
  game.controller.destroy();
});

for (const preferences of [
  { speech: true, autoplay: false },
  { speech: true, autoplay: true, muted: true },
  { speech: false, autoplay: true }
]) {
  test(`startup speech respects capability and preferences ${JSON.stringify(preferences)}`, async () => {
    const game = await mountGame(preferences);
    await settleMicrotasks();
    assert.deepEqual(game.speechCalls, []);
    game.controller.next();
    await settleMicrotasks();
    assert.deepEqual(game.speechCalls, []);
    game.controller.destroy();
  });
}

for (const pausedBy of ["shell", "document", "bfcache"]) {
  test(`the first verb waits for ${pausedBy} visibility before autoplay`, async () => {
    const game = await mountGame({ speech: true, autoplay: true, duringLoad({ document, window, shell, speechCalls }) {
      if (pausedBy === "shell") window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: shell,
        data: { source: "caatuu-app-shell", type: "visibility", active: false } });
      if (pausedBy === "document") {
        document.visibilityState = "hidden";
        document.dispatchEvent({ type: "visibilitychange" });
      }
      if (pausedBy === "bfcache") window.dispatchEvent({ type: "pagehide", persisted: true });
      assert.equal(document.getElementById("conjugationCometLoading").dataset.active, "false");
      assert.deepEqual(speechCalls, []);
    } });
    await settleMicrotasks();
    assert.deepEqual(game.speechCalls, []);
    if (pausedBy === "shell") game.setActive(true);
    if (pausedBy === "document") {
      game.document.visibilityState = "visible";
      game.document.dispatchEvent({ type: "visibilitychange" });
    }
    if (pausedBy === "bfcache") game.window.dispatchEvent({ type: "pageshow", persisted: true });
    await settleMicrotasks();
    assert.deepEqual(game.speechCalls, [game.current().targetText]);
    game.setActive(false);
    game.setActive(true);
    await settleMicrotasks();
    assert.equal(game.speechCalls.length, 1);
    game.controller.destroy();
  });
}

test("turning autoplay off stops its active introduction without affecting manual pronunciation", async () => {
  const automatic = await mountGame({ speech: true, autoplay: true, speechResult: new Promise(() => {}) });
  await settleMicrotasks();
  const speak = automatic.element("conjugationCometSpeakLemma");
  assert.equal(speak.getAttribute("aria-pressed"), "true");
  const automaticStops = automatic.speechStops();
  automatic.setAutoplay(false);
  await settleMicrotasks();
  assert.ok(automatic.speechStops() > automaticStops);
  assert.equal(speak.getAttribute("aria-pressed"), "false");
  automatic.setAutoplay(true);
  automatic.setActive(false);
  automatic.setActive(true);
  await settleMicrotasks();
  assert.equal(automatic.speechCalls.length, 1, "re-enabling autoplay does not repeat an already introduced verb");
  automatic.controller.destroy();

  const manual = await mountGame({ speech: true, speechResult: new Promise(() => {}) });
  const manualSpeak = manual.element("conjugationCometSpeakLemma");
  manual.click(manualSpeak);
  await settleMicrotasks();
  assert.equal(manualSpeak.getAttribute("aria-pressed"), "true");
  const manualStops = manual.speechStops();
  manual.setAutoplay(false);
  await settleMicrotasks();
  assert.equal(manual.speechStops(), manualStops);
  assert.equal(manualSpeak.getAttribute("aria-pressed"), "true");
  manual.controller.destroy();
});

test("retiring a loading game removes its robots and never plays a deferred introduction", async () => {
  const game = await mountGame({ speech: true, autoplay: true, duringLoad({ window }) {
    window.dispatchEvent({ type: "pagehide", persisted: false });
  } });
  await settleMicrotasks();
  assert.equal(game.controller, null);
  assert.deepEqual(game.speechCalls, []);
  assert.equal(game.element("conjugationCometLoading").hidden, true);
  assert.equal(game.element("conjugationCometTransition").hidden, true);
  assert.equal(game.timers.size, 0);
  game.setActive(true);
  await settleMicrotasks();
  assert.deepEqual(game.speechCalls, []);
});

test("trusted visibility received while the catalog loads survives initialization", async () => {
  const game = await mountGame({ duringLoad({ window, shell, toolbarCalls }) {
    assert.equal(toolbarCalls.length, 0);
    window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: shell,
      data: { source: "caatuu-app-shell", type: "visibility", active: false, theme: "light", fontSize: "large" } });
  } });
  assert.equal(game.document.documentElement.dataset.theme, "light");
  assert.equal(game.document.documentElement.dataset.fontSize, "large");
  assert.equal(game.timers.size, 0);
  assert.equal(game.element("conjugationCometSubmit").disabled, true);
  game.setActive(true);
  assert.equal(game.element("conjugationCometSubmit").disabled, false);
  game.controller.destroy();
});

test("early visibility obeys the exact-shell and origin boundary", async () => {
  const game = await mountGame({ duringLoad({ window, shell }) {
    const data = { source: "caatuu-app-shell", type: "visibility", active: false };
    window.dispatchEvent({ type: "message", origin: "https://foreign.test", source: shell, data });
    window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: {}, data });
  } });
  assert.equal(game.element("conjugationCometSubmit").disabled, false);
  game.controller.destroy();
});

test("BFCache entry during loading stays paused until restoration", async () => {
  const game = await mountGame({ duringLoad({ window }) {
    window.dispatchEvent({ type: "pagehide", persisted: true });
  } });
  assert.equal(game.toolbarCalls.length, 1);
  assert.equal(game.timers.size, 0);
  assert.equal(game.element("conjugationCometSubmit").disabled, true);
  game.window.dispatchEvent({ type: "pageshow", persisted: true });
  game.submit();
  assert.equal(game.attempts().length, 1);
  game.controller.destroy();
});

for (const rejected of [false, true]) {
  test(`an abandoned catalog ${rejected ? "failure" : "response"} never mounts a retired game`, async () => {
    const game = await mountGame({ duringLoad({ window, rejectCatalog }) {
      window.dispatchEvent({ type: "pagehide", persisted: false });
      if (rejected) rejectCatalog(new Error("The old frame's request failed."));
    } });
    assert.equal(game.controller, null);
    assert.equal(game.toolbarCalls.length, 0);
    assert.equal(game.timers.size, 0);
    assert.equal(game.element("conjugationCometGame").hidden, true);
    game.window.dispatchEvent({ type: "pageshow", persisted: false });
    game.setActive(true);
    assert.equal(game.toolbarCalls.length, 0);
    assert.equal(game.timers.size, 0);
    assert.equal(game.records.length, 0);
    assert.equal(game.messages.length, 0);
  });
}

for (const language of ["czech", "spanish"]) {
  test(`${language} starts with two complete equal strands and one deliberate whole-board Submit`, async () => {
    const game = await mountGame({ language });
    const { element } = game;
    assert.equal(element("conjugationCometRoot").getAttribute("aria-busy"), "false");
    assert.equal(element("conjugationCometGame").hidden, false);
    assert.equal(element("conjugationCometYes"), null);
    assert.equal(element("conjugationCometNo"), null);
    assert.equal(element("conjugationCometMeaning").textContent, game.current().learnerBaseText);
    assert.equal(game.strandButtons("subject").length, game.round().subjects.length);
    assert.equal(game.strandButtons("target").length, game.round().subjects.length);
    for (const side of ["subject", "target"]) {
      assert.equal(game.strandButtons(side).filter((button) => button.dataset.row === "0").length, 1);
      for (const button of game.strandButtons(side)) {
        const item = game.items(side)[Number(button.dataset.helixIndex)];
        assert.equal(button.textContent, side === "subject" ? item.learnerBaseText : item.text);
        if (side === "subject") {
          const highlights = button.querySelectorAll(".conjugation-comet-difference");
          assert.ok(highlights.length > 0, "full base phrases distinguish their pronouns");
          assert.ok(highlights.every((span) => !/speak|show|know|feel|sleep/u.test(span.textContent)),
            "highlighting the subject must not recolor the complete English phrase");
        }
        assert.equal(button.tabIndex, 0, "every audio card must remain keyboard reachable");
        assert.equal(button.getAttribute("aria-pressed"), null, "audio actions are not pair-selection toggles");
      }
    }
    assert.equal(game.focusCalls.filter(({ node }) => node.dataset.helixIndex !== undefined).length, 0,
      "initial rendering must not highlight a card through autofocus");
    assert.equal(element("conjugationCometSubmit").disabled, false);
    assert.equal(game.assessment().correct, false, "the initial puzzle needs real alignment");
    assert.equal(game.timers.size, 0);
    assert.equal(game.records.length, 0);
    assert.equal(game.toolbarCalls.length, 1);
    assert.equal(game.toolbarCalls[0].container, element("conjugationCometControls"));
    game.controller.destroy();
  });
}

test("rotating either entire strand is independent, cyclic, and locks Submit during movement", async () => {
  const game = await mountGame();
  for (const side of ["subject", "target"]) {
    const other = side === "subject" ? "target" : "subject";
    const otherOffset = game.offset(other);
    const original = game.offset(side);
    const label = side === "subject" ? "Subject" : "Target";
    const step = game.element(`conjugationComet${label}Next`);
    const direction = Number(step.dataset.step);
    const count = game.items(side).length;
    game.click(step);
    assert.equal(game.element("conjugationCometSubmit").disabled, true);
    game.element("conjugationCometSubmit").dispatchEvent({ type: "click", bubbles: true });
    assert.equal(game.records.length, 0);
    game.advance(420);
    assert.equal(game.offset(side), (original + direction + count) % count);
    assert.equal(game.offset(other), otherOffset);
    game.choose(side, direction > 0 ? count - 1 : 0);
    game.click(step);
    game.advance(420);
    assert.equal(game.offset(side), direction > 0 ? 0 : count - 1);
    assert.equal(game.offset(other), otherOffset);
  }
  game.controller.destroy();
});

test("reduced motion keeps strand rotation and whole-board submission usable without animations", async () => {
  const game = await mountGame({ reducedMotion: true });
  const result = game.submit();
  assert.equal(game.animations.length, 0);
  assert.equal(game.attempts().length, 1);
  assert.equal(game.attempts()[0].xp, result.total);
  game.controller.destroy();
});

test("strand wraparound teleports only between coincident invisible keyframes", async () => {
  const game = await mountGame();
  for (const id of ["conjugationCometSubjectPrev", "conjugationCometSubjectNext",
    "conjugationCometTargetPrev", "conjugationCometTargetNext"]) {
    const start = game.animations.length;
    game.click(game.element(id));
    const jumps = game.animations.slice(start).flatMap(({ frames }) => frames.slice(1)
      .map((frame, index) => [frames[index], frame])
      .filter(([before, after]) => Math.abs(parseFloat(after.top) - parseFloat(before.top)) > 50));
    assert.ok(jumps.length > 0, "a full strand rotation carries an end card around the boundary");
    for (const [before, after] of jumps) {
      assert.ok(Number.isFinite(before.offset));
      assert.equal(before.offset, after.offset, "the browser must not interpolate across the teleport");
      assert.equal(before.opacity, 0);
      assert.equal(after.opacity, 0);
    }
    game.advance(420);
  }
  game.controller.destroy();
});

function assertPairFeedback(game, result) {
  for (const [row, pair] of result.pairs.entries()) {
    for (const [side, id] of [["subject", pair.subjectId], ["target", pair.optionId]]) {
      const button = game.strandButtons(side).find((node) => node.dataset.formId === id);
      assert.equal(Number(button.dataset.row), row, "the rendered row must be the pair that was graded");
      assert.equal(button.dataset.result, pair.correct ? "correct" : "wrong");
    }
    const marker = game.element("conjugationCometRungStatus").querySelector(`[data-row="${row}"]`);
    assert.equal(marker.dataset.result, pair.correct ? "correct" : "wrong");
    const background = game.element("conjugationCometPairBackgrounds").querySelector(`[data-row="${row}"]`);
    assert.equal(background.dataset.result, pair.correct ? "correct" : "wrong", "the whole pair background reflects its own graded result");
  }
}

test("external phrase columns preserve six distinct graded pair rows through independent rotations", async () => {
  const game = await mountGame();
  function checkRows() {
    const pairs = game.assessment().pairs;
    assert.equal(pairs.length, 6);
    assert.equal(game.element("conjugationCometBackbone").querySelectorAll(".conjugation-comet-overpass").length, 3);
    assert.equal(game.strandButtons("subject").length + game.strandButtons("target").length, 12);
    let previousTop = -1;
    for (const [row, pair] of pairs.entries()) {
      const subject = game.strandButtons("subject").find((node) => node.dataset.formId === pair.subjectId);
      const target = game.strandButtons("target").find((node) => node.dataset.formId === pair.optionId);
      assert.equal(Number(subject.dataset.row), row);
      assert.equal(Number(target.dataset.row), row);
      const top = parseFloat(subject.style.top);
      assert.equal(parseFloat(target.style.top), top, "paired labels must share the same visible row");
      assert.ok(top > previousTop && top > 0 && top < 100);
      previousTop = top;
      const leftEdge = parseFloat(target.style.left) + parseFloat(target.style.width) / 2;
      const rightEdge = parseFloat(subject.style.left) - parseFloat(subject.style.width) / 2;
      if (row % 2) {
        assert.ok(leftEdge > 40 && leftEdge < 47, "crossing labels approach the center without touching the joint");
        assert.ok(rightEdge > 53 && rightEdge < 60);
      } else {
        assert.ok(leftEdge < 32, "wide pairs leave room for the outer glass beads");
        assert.ok(rightEdge > 68);
      }
      assert.ok(leftEdge < rightEdge, "the two languages keep their own side at every matching row");
    }

  }
  checkRows();
  game.choose("subject", 1);
  game.choose("target", 3);
  checkRows();
  const result = game.submit(false);
  checkRows();
  assertPairFeedback(game, result);
  game.controller.destroy();
});

test("an incorrect whole-board check grades every pair, awards no XP, and retries the same alignment", async () => {
  const game = await mountGame();
  const result = game.submit(false);
  const offsets = [game.offset("subject"), game.offset("target")];
  assertPairFeedback(game, result);
  assert.equal(game.element("conjugationCometFeedback").dataset.kind, "wrong");
  assert.equal(game.attempts().length, 1);
  assert.equal(game.attempts()[0].xp, 0);
  assert.equal(game.attempts()[0].successes, 0);
  game.element("conjugationCometSubmit").dispatchEvent({ type: "click", bubbles: true });
  assert.equal(game.attempts().length, 1);
  game.advance(1800);
  assert.deepEqual([game.offset("subject"), game.offset("target")], offsets);
  assert.equal(game.element("conjugationCometPairBackgrounds").querySelectorAll("[data-result]").length, 0, "retry clears every pair tint");
  assert.equal(game.element("conjugationCometSubmit").disabled, false);
  assert.equal(game.messages.length, 0);
  game.submit();
  assert.equal(game.attempts().length, 2);
  assert.equal(game.attempts()[1].xp, result.total);
  assert.equal(game.attempts()[1].successes, 1);
  game.controller.destroy();
});

test("partly correct rows never award credit for an incorrect helix", async () => {
  const game = await mountGame({ syncretic: true });
  let candidate;
  for (let subject = 0; subject < game.round().subjects.length; subject += 1) {
    for (let target = 0; target < game.round().options.length; target += 1) {
      const result = game.assessment(subject, target);
      if (!result.correct && result.matched > 0) candidate = { subject, target, result };
    }
  }
  assert.ok(candidate, "the fixture has a partially aligned board");
  game.choose("subject", candidate.subject);
  game.choose("target", candidate.target);
  game.click(game.element("conjugationCometSubmit"));
  assertPairFeedback(game, candidate.result);
  assert.equal(game.attempts().length, 1);
  assert.equal(game.attempts()[0].xp, 0);
  assert.equal(game.attempts()[0].successes, 0);
  assert.equal(game.messages.length, 0);
  game.controller.destroy();
});

test("one fully aligned submission earns N XP once and continues through the robots", async () => {
  const game = await mountGame();
  const original = game.current();
  const result = game.submit();
  assertPairFeedback(game, result);
  assert.equal(game.attempts().length, 1);
  assert.equal(game.attempts()[0].activities, 1);
  assert.equal(game.attempts()[0].attempts, 1);
  assert.equal(game.attempts()[0].successes, 1);
  assert.equal(game.attempts()[0].xp, result.total);
  assert.equal(game.element("conjugationCometSubmit").disabled, true);
  game.element("conjugationCometSubmit").dispatchEvent({ type: "click", bubbles: true });
  assert.equal(game.attempts().length, 1);
  game.advance(1600);
  assert.equal(game.messages.length, 1);
  assert.equal(game.messages[0].message.type, "round-success");
  assert.equal(game.messages[0].message.contentId, original.id);
  assert.equal(game.messages[0].origin, "https://caatuu.test");
  assert.equal(game.records.reduce((sum, entry) => sum + (entry.rounds || 0), 0), 1);
  assert.equal(game.element("conjugationCometTransition").hidden, false);
  assert.equal(game.element("conjugationCometSummary"), null);
  game.advance(1200);
  assert.notEqual(game.current().id, original.id);
  assert.equal(game.element("conjugationCometTransition").hidden, true);
  assert.equal(game.element("conjugationCometSubmit").disabled, false);
  assert.equal(game.messages.length, 1);
  assert.equal(game.attempts().length, 1);
  game.controller.destroy();
});

test("campaign completion waits for a trusted handoff and resumes without duplicate rewards", async () => {
  const game = await mountGame();
  game.shell.document.body.dataset.campaignActive = "true";
  finishBatch(game);
  assert.equal(game.messages.length, 1);
  assert.equal(game.timers.size, 0);
  const original = game.current();
  const count = game.records.length;
  const ack = { source: "caatuu-app-shell", type: "campaign-advance", gameId: "conjugation-comet" };
  for (const [origin, source] of [["https://foreign.test", game.shell], ["https://caatuu.test", {}]]) {
    game.window.dispatchEvent({ type: "message", origin, source, data: ack });
    assert.equal(game.current().id, original.id);
  }
  game.window.dispatchEvent({ type: "message", origin: "https://caatuu.test", source: game.shell, data: ack });
  assert.equal(game.records.length, count);
  assert.equal(game.messages.length, 1);
  assert.equal(game.element("conjugationCometSubmit").disabled, true);
  game.setActive(true);
  assert.equal(game.element("conjugationCometSubmit").disabled, false);
  game.controller.destroy();
});

test("leaving campaign releases a pending handoff on trusted standalone reactivation", async () => {
  const game = await mountGame();
  game.shell.document.body.dataset.campaignActive = "true";
  finishBatch(game);
  const original = game.current();
  const credits = game.records.length;
  game.setActive(false);
  game.shell.document.body.dataset.campaignActive = "false";
  game.setActive(true, { source: {} });
  assert.equal(game.timers.size, 0);
  game.setActive(true);
  game.advance(1200);
  assert.notEqual(game.current().id, original.id);
  assert.equal(game.messages.length, 1);
  assert.equal(game.records.length, credits);
  game.controller.destroy();
});

test("next skips an unfinished board without credit and invalidates pending callbacks", async () => {
  const game = await mountGame();
  const original = game.current();
  game.submit(false);
  const stale = [...game.timers.values()][0].callback;
  game.controller.next();
  assert.notEqual(game.current().id, original.id);
  const next = game.current();
  stale();
  assert.equal(game.current().id, next.id);
  assert.equal(game.attempts().length, 1);
  assert.equal(game.attempts()[0].xp, 0);
  assert.equal(game.messages.length, 0);
  assert.equal(game.timers.size, 0);
  game.controller.destroy();
});

test("a non-English base supplies subject labels and meanings without English audit text", async () => {
  const game = await mountGame({ language: "spanish", syntheticBase: true });
  assert.match(game.element("conjugationCometMeaning").textContent, /^Grundbedeutung /u);
  for (const button of game.strandButtons("subject")) assert.match(button.textContent, /Grundform /u);
  assert.equal(game.catalog.auditLanguageId, "en");
  game.submit();
  assert.ok(!game.element("conjugationCometGame").textContent.includes(game.current().englishAuditText));
  game.controller.destroy();
});

for (const side of ["subject", "target"]) {
  test(`up/down keys rotate only the focused ${side} strand`, async () => {
    const game = await mountGame();
    const other = side === "subject" ? "target" : "subject";
    const original = game.offset(side);
    const otherOffset = game.offset(other);
    for (const key of ["ArrowDown", "ArrowUp"]) {
      game.document.dispatchEvent({ type: "keydown", key, target: game.selectedButton(side) });
      game.advance(420);
      assert.equal(game.offset(other), otherOffset);
    }
    assert.equal(game.offset(side), original);
    assert.equal(game.records.length, 0);
    game.controller.destroy();
  });
}

test("strand shortcuts ignore held or modified keys, text entry, popovers and inactive games", async () => {
  const game = await mountGame();
  const original = game.offset("subject");
  const press = (details = {}) => game.document.dispatchEvent({ type: "keydown", key: "ArrowDown", target: game.selectedButton("subject"), ...details });
  for (const property of ["repeat", "isComposing", "ctrlKey", "altKey", "metaKey", "shiftKey"]) press({ [property]: true });
  for (const tag of ["input", "textarea", "select"]) {
    const field = game.document.createElement(tag);
    game.document.body.append(field);
    press({ target: field });
  }
  game.setControlsOpen(true); press(); game.setControlsOpen(false);
  game.setActive(false); press();
  assert.equal(game.offset("subject"), original);
  assert.equal(game.timers.size, 0);
  game.setActive(true); press(); game.advance(420);
  assert.notEqual(game.offset("subject"), original);
  assert.equal(game.records.length, 0);
  game.controller.destroy();
});

test("left/right transfers keyboard focus without rotating either strand", async () => {
  const game = await mountGame();
  const offsets = [game.offset("subject"), game.offset("target")];
  game.document.dispatchEvent({ type: "keydown", key: "ArrowRight", target: game.selectedButton("target") });
  assert.equal(game.document.activeElement, game.selectedButton("subject"));
  game.document.dispatchEvent({ type: "keydown", key: "ArrowLeft", target: game.selectedButton("subject") });
  assert.equal(game.document.activeElement, game.selectedButton("target"));
  assert.deepEqual([game.offset("subject"), game.offset("target")], offsets);
  assert.equal(game.element("conjugationCometPairBackgrounds").querySelectorAll("[data-result]").length, 0, "retry clears every pair tint");
  game.controller.destroy();
});

test("native Enter and Space replay audio cards while only Check submits the complete alignment", async () => {
  const game = await mountGame({ speech: true });
  const result = game.align();
  const offsets = [game.offset("subject"), game.offset("target")];
  for (const key of ["Enter", " "]) {
    const node = game.selectedButton("target");
    assert.equal(game.document.dispatchEvent({ type: "keydown", key, target: node }), true);
    assert.equal(game.attempts().length, 0);
    game.click(node);
    await settleMicrotasks();
    assert.equal(game.speechCalls.at(-1), game.selected("target").text);
    assert.deepEqual([game.offset("subject"), game.offset("target")], offsets);
  assert.equal(game.element("conjugationCometPairBackgrounds").querySelectorAll("[data-result]").length, 0, "retry clears every pair tint");
    assert.equal(game.attempts().length, 0);
  }
  const check = game.element("conjugationCometSubmit");
  assert.equal(game.document.dispatchEvent({ type: "keydown", key: "Enter", target: check }), true);
  game.click(check);
  assert.equal(game.attempts().length, 1);
  assert.equal(game.attempts()[0].xp, result.total);
  game.advance(1600); game.advance(1200);
  const step = game.element("conjugationCometTargetNext");
  assert.equal(game.document.dispatchEvent({ type: "keydown", key: "Enter", target: step }), true);
  assert.equal(game.timers.size, 0);
  game.click(step); game.advance(420); game.align();
  const submit = game.element("conjugationCometSubmit");
  assert.equal(game.document.dispatchEvent({ type: "keydown", key: "Enter", target: submit }), true);
  assert.equal(game.attempts().length, 1);
  game.click(submit);
  assert.equal(game.attempts().length, 2);
  game.controller.destroy();
});

test("clicking strand labels speaks the currently paired target without changing the alignment", async () => {
  const game = await mountGame({ speech: true });
  game.choose("subject", 1); game.choose("target", 2);
  const offsets = [game.offset("subject"), game.offset("target")];
  const count = game.round().subjects.length;
  for (const side of ["subject", "target"]) {
    for (const button of game.strandButtons(side)) {
      if (button.disabled) continue;
      const index = Number(button.dataset.helixIndex);
      const targetIndex = side === "target" ? index : (index - offsets[0] + offsets[1] + count) % count;
      game.click(button);
      await settleMicrotasks();
      assert.equal(game.speechCalls.at(-1), game.round().options[targetIndex].text);
      assert.deepEqual([game.offset("subject"), game.offset("target")], offsets);
  assert.equal(game.element("conjugationCometPairBackgrounds").querySelectorAll("[data-result]").length, 0, "retry clears every pair tint");
      assert.equal(game.timers.size, 0);
    }
  }
  assert.equal(game.records.length, 0);
  game.controller.destroy();
});

test("pronunciation remains stoppable, cancels on hide, and ignores stale completions", async () => {
  let finishSpeech;
  const speechResult = new Promise((resolve) => { finishSpeech = resolve; });
  const game = await mountGame({ speech: true, speechResult });
  const speak = game.element("conjugationCometSpeakLemma");
  const initialStops = game.speechStops();
  game.click(speak); await settleMicrotasks();
  assert.deepEqual(game.speechCalls, [game.current().targetText]);
  assert.equal(speak.disabled, false);
  assert.equal(speak.getAttribute("aria-pressed"), "true");
  assert.equal(speak.querySelector('[data-speech-icon="play"]').hidden, true);
  assert.equal(speak.querySelector('[data-speech-icon="stop"]').hidden, false);
  game.click(speak); await settleMicrotasks();
  assert.equal(speak.getAttribute("aria-pressed"), "false");
  assert.ok(game.speechStops() > initialStops);
  game.click(speak); await settleMicrotasks(); game.setActive(false);
  assert.equal(speak.getAttribute("aria-pressed"), "false");
  finishSpeech(); await settleMicrotasks();
  assert.equal(speak.getAttribute("aria-pressed"), "false");
  assert.equal(game.records.length, 0);
  game.controller.destroy();
});

test("global mute blocks shared pronunciation across boards and restores it on unmute", async () => {
  const game = await mountGame({ speech: true });
  let muted = true;
  game.shell.CaatuuChrome.getSpeechMuted = () => muted;
  game.window.dispatchEvent({ type: "caatuu:speech-mute-change" });
  const speak = game.element("conjugationCometSpeakLemma");
  assert.equal(speak.disabled, true);
  speak.dispatchEvent({ type: "click", bubbles: true });
  game.click(game.strandButtons("target")[0]);
  await settleMicrotasks();
  assert.equal(game.speechCalls.length, 0);
  game.controller.next();
  muted = false; game.window.dispatchEvent({ type: "caatuu:speech-mute-change" });
  assert.equal(speak.disabled, false);
  game.click(speak); await settleMicrotasks();
  assert.equal(game.speechCalls.length, 1);
  game.controller.destroy();
});

test("unavailable shared speech reports the authored failure without a browser voice fallback", async () => {
  const game = await mountGame({ speech: true });
  delete game.shell.CaatuuChrome.speakText;
  let fallbackCalls = 0;
  game.window.speechSynthesis = { speak() { fallbackCalls += 1; }, cancel() {} };
  game.click(game.element("conjugationCometSpeakLemma")); await settleMicrotasks();
  const expected = game.catalog.copy.audioUnavailableTemplate.replace("{language}", game.languageNames.languageName(game.course.targetLanguage));
  assert.equal(game.element("conjugationCometFeedback").textContent, expected);
  assert.equal(fallbackCalls, 0);
  assert.equal(game.records.length, 0);
  game.controller.destroy();
});

for (const phase of ["moving", "correct", "incorrect", "transition"]) {
  test(`${phase} timers pause while hidden or controls are open and resume safely`, async () => {
    const game = await mountGame();
    const delay = phase === "moving" ? 420 : phase === "correct" ? 1600 : phase === "incorrect" ? 1800 : 1200;
    if (phase === "moving") game.click(game.element("conjugationCometSubjectNext"));
    if (phase === "correct" || phase === "incorrect") game.submit(phase === "correct");
    if (phase === "transition") finishBatch(game);
    const stale = [...game.timers.values()][0].callback;
    const count = game.attempts().length;
    game.setActive(false, { origin: "https://foreign.test" }); assert.equal(game.timers.size, 1);
    game.setActive(false, { source: {} }); assert.equal(game.timers.size, 1);
    game.setActive(false); assert.equal(game.timers.size, 0);
    if (phase === "moving") assert.ok(game.animations.filter((animation) => !animation.cancelled)
      .every((animation) => animation.playState === "paused"));
    stale(); assert.equal(game.timers.size, 0);
    game.setActive(true); game.setControlsOpen(true); assert.equal(game.timers.size, 0);
    game.setActive(false); game.setControlsOpen(false); assert.equal(game.timers.size, 0);
    game.setActive(true); game.document.visibilityState = "hidden";
    game.document.dispatchEvent({ type: "visibilitychange" }); assert.equal(game.timers.size, 0);
    game.document.visibilityState = "visible"; game.document.dispatchEvent({ type: "visibilitychange" });
    if (phase === "moving") assert.ok(game.animations.filter((animation) => !animation.cancelled)
      .every((animation) => animation.playState === "running"));
    game.advance(delay);
    if (phase === "moving") assert.ok(game.animations.every((animation) => animation.cancelled));
    assert.equal(game.attempts().length, count);
    game.controller.destroy();
  });
}

test("BFCache pauses result feedback and playback while retaining the live toolbar", async () => {
  const game = await mountGame({ speech: true, speechResult: new Promise(() => {}) });
  game.submit(false);
  game.click(game.element("conjugationCometSpeakLemma")); await settleMicrotasks();
  const initialStops = game.speechStops();
  const initialCloses = game.toolbarLifecycle.closes;
  game.window.dispatchEvent({ type: "pagehide", persisted: true });
  assert.equal(game.toolbarLifecycle.closes, initialCloses + 1);
  assert.equal(game.toolbarLifecycle.destroys, 0);
  assert.ok(game.speechStops() > initialStops);
  assert.equal(game.timers.size, 0);
  game.window.dispatchEvent({ type: "pageshow", persisted: true }); game.advance(1800);
  game.submit();
  assert.equal(game.toolbarCalls.length, 1);
  assert.equal(game.attempts().length, 2);
  game.controller.destroy();
});

test("inactive or stopped games reject whole-board checks until trusted reactivation", async () => {
  const game = await mountGame(); game.align(); game.controller.stop();
  game.element("conjugationCometSubmit").dispatchEvent({ type: "click", bubbles: true });
  assert.equal(game.records.length, 0);
  assert.equal(game.timers.size, 0);
  game.setActive(true); game.submit();
  assert.equal(game.attempts().length, 1);
  game.controller.destroy();
});

test("non-persisted pagehide destroys controls and invalidates pending callbacks", async () => {
  const game = await mountGame({ speech: true, speechResult: new Promise(() => {}) });
  game.submit(false);
  game.click(game.element("conjugationCometSpeakLemma")); await settleMicrotasks();
  const stale = [...game.timers.values()][0].callback;
  const initialStops = game.speechStops();
  const initialCloses = game.toolbarLifecycle.closes;
  game.window.dispatchEvent({ type: "pagehide", persisted: false });
  assert.equal(game.toolbarLifecycle.closes, initialCloses + 1);
  assert.equal(game.toolbarLifecycle.destroys, 1);
  assert.ok(game.speechStops() > initialStops);
  assert.equal(game.timers.size, 0);
  stale(); assert.equal(game.timers.size, 0);
  assert.equal(game.attempts().length, 1);
  assert.equal(game.messages.length, 0);
});

function scrollBoard(game, overrides = {}) {
  const board = game.element("conjugationCometBoard");
  board.getBoundingClientRect = () => ({ left: 10, top: 10, width: 700, height: 640 });
  const event = { type: "wheel", clientX: 600, clientY: 400, deltaY: 100, deltaX: 0,
    deltaMode: 0, timeStamp: 1000, bubbles: true, cancelable: true, ...overrides };
  (overrides.target || board).dispatchEvent(event);
  return event;
}

test("scrolling anywhere on either half rotates only that strand without grading", async () => {
  const game = await mountGame();
  const before = { target: game.offset("target"), subject: game.offset("subject") };
  assert.equal(scrollBoard(game).defaultPrevented, true);
  assert.equal(game.offset("subject"), (before.subject + 1) % 6);
  assert.equal(game.offset("target"), before.target);
  assert.equal(game.element("conjugationCometGame").dataset.phase, "moving");
  // Large trackpad momentum during motion must not queue a second step.
  scrollBoard(game, { deltaY: 1600 });
  game.advance(420);
  assert.equal(game.offset("subject"), (before.subject + 1) % 6);
  assert.equal(scrollBoard(game, { clientX: 25, clientY: 80, deltaY: -100 }).defaultPrevented, true);
  assert.equal(game.offset("target"), (before.target + 5) % 6);
  assert.equal(game.offset("subject"), (before.subject + 1) % 6);
  assert.equal(game.attempts().length, 0);
  game.advance(420);
  const targetBefore = game.offset("target");
  scrollBoard(game, { target: game.strandButtons("target")[0], clientX: 200 });
  assert.equal(game.offset("target"), (targetBefore + 1) % 6, "scrolling over a phrase also works");
  game.controller.destroy();
});

test("trackpad deltas accumulate per half and direction, expire, and normalize line/page scrolling", async () => {
  const game = await mountGame();
  const before = game.offset("subject");
  scrollBoard(game, { deltaY: 25 });
  scrollBoard(game, { deltaY: 25, clientX: 200 });
  assert.equal(game.offset("subject"), before);
  scrollBoard(game, { deltaY: 25, timeStamp: 1300 });
  assert.equal(game.offset("subject"), before, "old and opposite-side deltas cannot combine");
  scrollBoard(game, { deltaY: -25, timeStamp: 1320 });
  assert.equal(game.offset("subject"), before, "changing direction starts a new gesture");
  scrollBoard(game, { deltaY: -20, timeStamp: 1340 });
  assert.equal(game.offset("subject"), (before + 5) % 6);
  game.advance(420);
  scrollBoard(game, { deltaY: 3, deltaMode: 1 });
  assert.equal(game.offset("subject"), before);
  game.advance(420);
  scrollBoard(game, { deltaY: 1, deltaMode: 2 });
  assert.equal(game.offset("subject"), (before + 1) % 6);
  game.controller.destroy();
});

test("scrolling preserves zoom and horizontal gestures and respects game lifecycle locks", async () => {
  const game = await mountGame();
  const before = game.offset("subject");
  for (const gesture of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true },
    { deltaX: 200 }, { deltaY: 0 }, { deltaY: NaN }]) {
    assert.equal(Boolean(scrollBoard(game, gesture).defaultPrevented), false);
    assert.equal(game.offset("subject"), before);
  }
  for (const setPaused of [value => game.setActive(!value), value => game.setControlsOpen(value)]) {
    setPaused(true);
    assert.equal(Boolean(scrollBoard(game).defaultPrevented), false);
    assert.equal(game.offset("subject"), before);
    setPaused(false);
  }
  game.submit(false);
  assert.equal(Boolean(scrollBoard(game).defaultPrevented), false);
  assert.equal(game.offset("subject"), before);
  game.advance(1800);
  game.controller.destroy();
  assert.equal(Boolean(scrollBoard(game).defaultPrevented), false);
  assert.equal(game.element("conjugationCometBoard").listeners.get("wheel").size, 0);
});

test("the feather preference persists and does not change pairs, offsets, or scoring", async () => {
  const key = "caatuu.conjugation-comet.illustrations";
  const game = await mountGame({ localStorageValues: { [key]: "false" } });
  const toggle = game.toolbarCalls[0].illustrations;
  assert.equal(toggle.pressed, false);
  assert.equal(game.element("conjugationCometCard").dataset.illustrations, "hidden");
  const initial = game.assessment();
  toggle.onChange(true);
  assert.equal(game.element("conjugationCometCard").dataset.illustrations, "shown");
  assert.equal(game.localStorage.getItem(key), "true");
  toggle.onChange(false);
  assert.deepEqual(game.assessment(), initial);
  assert.equal(game.localStorage.getItem(key), "false");
  game.submit();
  assert.equal(game.attempts().length, 1);
  game.controller.next();
  assert.equal(game.element("conjugationCometCard").dataset.illustrations, "hidden");
  game.controller.destroy();
  const reopened = await mountGame({ localStorageValues: { [key]: game.localStorage.getItem(key) } });
  assert.equal(reopened.toolbarCalls[0].illustrations.pressed, false);
  reopened.controller.destroy();
});

test("the feather still works when preference storage is unavailable", async () => {
  const game = await mountGame({ duringLoad({ shell }) {
    shell.localStorage = {
      getItem() { throw new Error("Storage blocked"); },
      setItem() { throw new Error("Storage blocked"); }
    };
  } });
  assert.equal(game.toolbarCalls[0].illustrations.pressed, true);
  game.toolbarCalls[0].illustrations.onChange(false);
  assert.equal(game.element("conjugationCometCard").dataset.illustrations, "hidden");
  game.controller.destroy();
});
