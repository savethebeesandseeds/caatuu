import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { mountRobotLoadingScreen } from "../static/source/games/embedded-game-controls.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { createInterfaceContent } from "../static/source/interface-content.mjs";
import { fetchDeclaredCourseGameJson } from "../static/source/games/course-game-content.mjs";
import * as core from "../static/source/games/grammar-gravity/noun-landing-core.mjs";
import { createNounVisual } from "../static/source/games/grammar-gravity/noun-visual.mjs";
import { mountGrammarFlight } from "../static/source/games/grammar-gravity/adjective-flight-host.mjs";
import { buildGrammarGravityRounds, normalizeGrammarGravityPack } from "../static/source/games/grammar-gravity/grammar-gravity-core.mjs";

const hostSource = await readFile(new URL(
  "../static/source/games/grammar-gravity/noun-landing-host.mjs", import.meta.url
), "utf8");
const markup = await readFile(new URL("../static/games/grammar-gravity.html", import.meta.url), "utf8");
const englishInterface = JSON.parse(await readFile(new URL(
  "../static/data/interface/en.v1.json", import.meta.url
), "utf8"));

function seedMarkup(harness) {
  const source = /<main\b[\s\S]*?<\/main>/u.exec(markup)?.[0];
  assert.ok(source, "the game document exposes a main landmark");
  const stack = [harness.document.body];
  const voidTags = new Set(["img", "input", "br", "hr", "source", "wbr"]);
  for (const token of source.match(/<!--[^]*?-->|<[^>]+>|[^<]+/gu) || []) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("</")) { stack.pop(); continue; }
    if (!token.startsWith("<")) { stack.at(-1).append(token); continue; }
    const [, tag, attributes] = /^<([\w-]+)\b([^]*)>$/u.exec(token);
    const node = harness.document.createElement(tag);
    for (const [, name, value] of attributes.matchAll(/([:\w-]+)(?:="([^"]*)")?/gu)) {
      node.setAttribute(name, value ?? "");
    }
    stack.at(-1).append(node);
    if (!voidTags.has(tag) && !token.endsWith("/>")) stack.push(node);
  }
}

async function mountGame({ language = "czech", syntheticBase = false, reducedMotion = false,
  fetchFails = false, unsafePath = false, invalidContent = false, speech = false,
  speechFails = false, deferSpeech = false, deferFetch = false, segmentSize = 0, mountControls = true,
  visuals = false, visualFails = false, initialActive = true, beforeMount, difficulty = 1, mutateContent } = {}) {
  const raw = JSON.parse(await readFile(new URL(
    "../../languages/" + language + "/static/data/games/grammar-gravity/nouns.json", import.meta.url
  ), "utf8"));
  const czech = language === "czech";
  const course = {
    id: czech ? "cz" : "es", routePrefix: czech ? "/cz" : "/es",
    sourceLanguage: { id: "en", locale: "en", direction: "ltr" },
    targetLanguage: { id: czech ? "cs" : "es", locale: czech ? "cs-CZ" : "es-ES" },
    capabilities: { speech, embeddings: visuals, semanticSearch: visuals },
    gameContent: { "grammar-gravity": {
      grammarGravityNouns: unsafePath ? "../outside.json" : "data/games/grammar-gravity/nouns.json?v=fixture-2"
    } }
  };
  if (syntheticBase) {
    course.id = "fr-es";
    course.routePrefix = "/fr-es";
    course.sourceLanguage = { id: "fr", locale: "fr", direction: "ltr" };
    raw.courseId = course.id;
    raw.learnerBaseLanguage = "fr";
    raw.items.forEach((item, index) => { item.learnerBaseText = "Sens français " + index; });
  }
  mutateContent?.(raw);
  if (invalidContent) raw.items[0].english = "";
  const harness = createBrowserHarness({ course, location: {
    href: "https://caatuu.test/language-runtime/static/games/grammar-gravity.html"
  } });
  seedMarkup(harness);
  const outsideControl = harness.document.createElement("button");
  outsideControl.type = "button";
  outsideControl.textContent = "Outside the game";
  harness.document.body.append(outsideControl);
  const element = (id) => harness.document.getElementById(id);
  element("gravityNounArena").clientHeight = 500;
  element("gravityNounBlock").offsetHeight = 100;
  harness.document.hidden = false;
  const frames = new Map();
  const fetches = [];
  const records = [];
  const messages = [];
  const errors = [];
  const speechCalls = [];
  const visualCalls = [];
  const controls = { mounts: 0, closes: 0, destroys: 0, open: false, options: null };
  const segments = [];
  const mediaListeners = new Set();
  let frameId = 0;
  let speechStops = 0;
  let finishSpeech;
  let finishFetch;
  let now = 0;
  harness.window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  harness.window.cancelAnimationFrame = (id) => frames.delete(id);
  harness.window.matchMedia = () => ({
    matches: reducedMotion,
    addEventListener: (_event, callback) => mediaListeners.add(callback),
    removeEventListener: (_event, callback) => mediaListeners.delete(callback)
  });
  controls.setOpen = (value) => {
    controls.open = Boolean(value);
    controls.options?.onOpenChange?.(controls.open);
  };
  const shell = {
    addEventListener: harness.window.addEventListener.bind(harness.window),
    removeEventListener: harness.window.removeEventListener.bind(harness.window),
    location: harness.window.location,
    CaatuuI18n: createInterfaceContent(englishInterface),
    CaatuuRuntime: { vector: { search() { assert.fail("Noun images use shared artwork retrieval."); } } },
    CaatuuLearning: { difficulty: () => difficulty, record: (gameId, delta) => records.push({ gameId, ...delta }) },
    CaatuuChrome: {
      stopSpeech: async () => { speechStops += 1; },
      speakText: async (word) => {
        speechCalls.push(word);
        if (speechFails) throw new Error("unavailable");
        if (deferSpeech) await new Promise((resolve) => { finishSpeech = resolve; });
      }
    },
    postMessage: (message, origin) => messages.push({ message, origin })
  };
  Object.assign(harness.context, core, {
    createNounVisual: options => createNounVisual({ ...options, searchImages: async (query, options) => {
      visualCalls.push({ query, options });
      if (visualFails) throw new Error("image lookup unavailable");
      return { rows: [{ sourceKind: "image_asset", path: "/assets/miscellaneous/noun-fixture.png" }] };
    } }), mountRobotLoadingScreen,
    course, shell, mountOptions: { segmentSize, mountControls, initialActive, onComplete: () => segments.push(true) },
    createNounLandingSession: (pack, options = {}) => core.createNounLandingSession(pack, { ...options, random: () => 0.999 }),
    fetchDeclaredCourseGameJson: (profile, options) => fetchDeclaredCourseGameJson(profile, {
      ...options,
      fetchImpl: async (url, request) => {
        fetches.push({ url, request });
        if (deferFetch) await new Promise((resolve) => { finishFetch = resolve; });
        return { ok: !fetchFails, status: fetchFails ? 503 : 200, json: async () => raw };
      }
    }),
    mountEmbeddedGameControls(options) {
      controls.mounts += 1;
      controls.options = options;
      return {
        isOpen: () => controls.open,
        close() { controls.closes += 1; controls.setOpen(false); },
        destroy() { controls.destroys += 1; controls.open = false; }
      };
    },
    createSpeechIcon(document, { stop = false } = {}) {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("data-speech-icon", stop ? "stop" : "play");
      icon.setAttribute("aria-hidden", "true");
      return icon;
    },
    console: { error: (...args) => errors.push(args) }
  });
  const executable = hostSource
    .replace(/^import\s+[\s\S]*?\sfrom\s+["'][^"']+["'];\r?\n/gmu, "")
    .replace(/\bexport async function /gu, "async function ");
  vm.runInContext(executable, harness.context, { filename: "noun-landing-host.mjs" });
  const companion = beforeMount?.({ document: harness.document, scope: harness.window, shell, course });
  const mounting = vm.runInContext("mountNounLanding({ course, shell, scope: window, ...mountOptions })", harness.context);
  let controller;
  if (deferFetch) await settle();
  else controller = await mounting;
  function click(node) {
    assert.ok(node, "the requested control must exist");
    assert.equal(node.disabled, false, "the requested control must be enabled");
    node.focus();
    node.click();
  }
  function frame(timestamp) {
    assert.equal(frames.size, 1, "one active-time frame is scheduled");
    now = timestamp;
    const [id, callback] = [...frames][0];
    frames.delete(id);
    callback(timestamp);
  }
  function finishFeedback() {
    const before = controller.snapshot().item?.id;
    for (let index = 0; index < 35 && controller.snapshot().phase === "feedback"; index += 1) {
      frame(now + 100);
    }
    assert.notEqual(controller.snapshot().phase, "feedback", "feedback advances automatically");
    if (controller.snapshot().phase !== "complete") assert.notEqual(controller.snapshot().item.id, before);
  }
  const lane = (id) => element("gravityNounLanes").querySelector('[data-lane-id="' + id + '"]');
  const answer = (id = controller.snapshot().item.laneId) => click(lane(id));
  return { ...harness, shell, get controller() { return controller; }, raw, course, element, click, lane, answer,
    frame, finishFeedback, frames, fetches, records, messages, errors, controls, segments, outsideControl,
    mediaListeners, speechCalls, visualCalls, companion, finishSpeech: () => finishSpeech?.(), speechStops: () => speechStops,
    async finishFetch() { finishFetch?.(); controller = await mounting; return controller; } };
}

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

test("noun feedback acknowledges a selected authored alternative and shows every accepted lane", async () => {
  const game = await mountGame({ language: "spanish", mutateContent(raw) {
    // Synthetic acceptance fixture, not a reclassification of the source curriculum.
    raw.items[0].acceptedLaneIds = raw.lanes.map(({ id }) => id);
  } });
  const before = game.controller.snapshot();
  const alternative = game.raw.lanes.find(({ id }) => id !== before.item.laneId);
  game.answer(alternative.id);
  for (let index = 0; index < 8; index += 1) game.frame(index * 100);
  const after = game.controller.snapshot();
  assert.equal(after.phase, "feedback");
  assert.equal(after.correct, true);
  assert.equal(after.correctCount, 1);
  for (const lane of game.raw.lanes) assert.ok(game.lane(lane.id).classList.contains("is-correct"));
  assert.equal(game.lane(alternative.id).classList.contains("is-wrong"), false);
  assert.ok(game.element("gravityNounFeedback").textContent.includes(alternative.label));
  assert.equal(game.records.length, 1);
  assert.equal(game.records[0].successes, 1);
  assert.equal(game.records[0].xp, 1);
  game.controller.destroy();
});

test("an initially inactive noun game loads its gender metadata without timing, input, or speech", async () => {
  const game = await mountGame({ initialActive: false, speech: true });
  game.shell.CaatuuChrome.getSpeechAutoplay = () => true;
  game.window.dispatchEvent({ type: "caatuu:speech-autoplay-change" });
  await settle();
  assert.equal(game.controller.ready(), true);
  assert.equal(game.controller.snapshot().lanes.length, 3);
  assert.equal(game.frames.size, 0);
  assert.deepEqual(game.speechCalls, []);
  const first = game.controller.snapshot();
  game.lane(first.item.laneId).click();
  assert.equal(game.controller.snapshot(), first);
  assert.deepEqual(game.records, []);
  game.controller.setActive(true);
  game.frame(0);
  await settle();
  assert.deepEqual(game.speechCalls, [first.item.targetText]);
  assert.equal(game.frames.size, 1);
  game.controller.destroy();
});

test("the hidden noun host cannot steal the active grammar form game's clock or pronunciation", async () => {
  const game = await mountGame({ initialActive: false, speech: true, deferSpeech: true,
    // Match the coordinator's actual order: grammar flight listeners precede noun listeners.
    beforeMount: (options) => mountGrammarFlight(options)
  });
  const raw = JSON.parse(await readFile(new URL(
    "../../languages/czech/static/data/games/grammar-gravity/content.json", import.meta.url
  ), "utf8"));
  const pack = normalizeGrammarGravityPack(raw, { courseId: "cz", learnerBaseLanguage: "en", targetLanguage: "cs-CZ" });
  const round = buildGrammarGravityRounds(pack, 3, () => 0.999).find((candidate) => candidate.focus.kind === "adjective");
  const adjective = game.companion;
  game.element("gravityAdjectiveArena").prepend(game.element("gravityGameHeader"));
  adjective.start(round, round.flights, { practiceMode: "forms" });
  adjective.setActive(true);
  game.shell.CaatuuChrome.getSpeechAutoplay = () => true;
  game.frame(0);
  await settle();
  assert.equal(game.speechCalls.length, 1);
  assert.equal(game.speechCalls[0], adjective.snapshot().current.anchorText);
  const clock = game.element("gravityNounClock");
  const stops = game.speechStops();
  assert.equal(clock.hidden, false);

  for (const event of ["resize", "caatuu:speech-mute-change", "pageshow"]) {
    game.window.dispatchEvent({ type: event });
    assert.equal(clock.hidden, false, event + " cannot hide the adjective clock, even before its next frame");
  }
  game.controller.setDurationMs(20000);
  game.controller.setIconsVisible(false);
  assert.equal(clock.getAttribute("aria-valuemax"), "20", "inactive noun preferences cannot overwrite the active adjective timer");
  assert.equal(clock.hidden, false);

  // A repeated shell visibility=true notification deactivates noun again before activating adjective.
  game.controller.setActive(false);
  adjective.setActive(true);
  assert.equal(game.speechStops(), stops, "a hidden noun owns no pronunciation to cancel");
  assert.equal(clock.hidden, false);
  assert.ok(game.element("gravityAdjectiveSpeak").querySelector('[data-speech-icon="stop"]'));
  game.controller.destroy();
  assert.equal(game.speechStops(), stops, "destroying the hidden host cannot cancel adjective speech");
  assert.equal(clock.hidden, false);

  game.shell.CaatuuChrome.getSpeechMuted = () => true;
  game.window.dispatchEvent({ type: "caatuu:speech-mute-change" });
  assert.equal(game.speechStops(), stops + 1, "global mute still stops speech through its active owner");
  assert.equal(game.element("gravityAdjectiveSpeak").disabled, true);
  game.finishSpeech();
  await settle();
  adjective.destroy();
});

test("an active noun releases its own clock and speech exactly once when deactivated", async () => {
  const game = await mountGame({ speech: true, deferSpeech: true });
  game.click(game.element("gravityNounSpeak"));
  await settle();
  const stops = game.speechStops();
  const clock = game.element("gravityNounClock");
  assert.equal(clock.hidden, false);
  game.controller.setActive(false);
  assert.equal(clock.hidden, true);
  assert.equal(game.speechStops(), stops + 1);
  clock.hidden = false;
  game.controller.setActive(false);
  assert.equal(clock.hidden, false, "the new mode's clock is no longer owned by noun");
  assert.equal(game.speechStops(), stops + 1);
  game.finishSpeech();
  await settle();
  assert.equal(clock.hidden, false, "late noun speech completion cannot redraw another mode's clock");
  game.controller.destroy();
});

test("noun autoplay reads each new word once and follows the shared mute and autoplay preferences", async () => {
  const game = await mountGame({ speech: true });
  let autoplay = true;
  let muted = false;
  game.shell.CaatuuChrome.getSpeechAutoplay = () => autoplay;
  game.shell.CaatuuChrome.getSpeechMuted = () => muted;
  game.frame(0);
  await settle();
  assert.deepEqual(game.speechCalls, [game.controller.snapshot().item.targetText]);
  game.frame(500);
  await settle();
  assert.equal(game.speechCalls.length, 1);
  game.answer();
  game.finishFeedback();
  game.frame(5000);
  await settle();
  assert.equal(game.speechCalls.length, 2);
  muted = true;
  game.window.dispatchEvent({ type: "caatuu:speech-mute-change" });
  assert.equal(game.element("gravityNounSpeak").disabled, true);
  game.answer();
  game.finishFeedback();
  game.frame(10000);
  await settle();
  assert.equal(game.speechCalls.length, 2);
  autoplay = false;
  game.window.dispatchEvent({ type: "caatuu:speech-autoplay-change" });
  muted = false;
  game.window.dispatchEvent({ type: "caatuu:speech-mute-change" });
  game.frame(10100);
  await settle();
  assert.equal(game.speechCalls.length, 2);
  game.controller.destroy();
});

for (const language of ["czech", "spanish"]) {
  test(language + " starts automatically from course JSON without initial practice credit", async () => {
    const game = await mountGame({ language });
    assert.equal(game.controller.ready(), true);
    assert.equal(game.controller.snapshot().phase, "falling");
    assert.equal(game.element("gravityNounLanes").children.length, language === "czech" ? 3 : 2);
    assert.equal(game.element("gravityNounWord").textContent, game.raw.items[0].targetText);
    assert.equal(game.element("gravityNounMeaning").textContent, game.raw.items[0].learnerBaseText);
    for (const id of ["gravityNounStart", "gravityNounNext", "gravityNounDrop", "gravityNounPause",
      "gravityNounReview", "gravityNounTitle", "gravityNounInstruction", "gravityNounUntimed",
      "gravityNounSettings", "gravityNounProgress", "gravityNounStreak", "gravityNounSummary", "gravityNounRestart"]) {
      assert.equal(game.element(id), null, id + " must not remain in the document");
    }
    for (const lane of game.raw.lanes) {
      const button = game.lane(lane.id);
      assert.equal(button.tagName, "BUTTON");
      assert.equal(button.type, "button");
      assert.ok(button.getAttribute("aria-label").includes(lane.label));
      const image = button.querySelector("img");
      assert.equal(image.src, lane.image);
      assert.equal(image.alt ?? image.getAttribute("alt"), "");
    }
    assert.equal(game.frames.size, 1);
    assert.equal(game.records.length, 0);
    assert.equal(game.controls.mounts, 1);
    assert.equal(game.controls.options.onOpenChange, undefined);
    assert.equal(game.controls.options.settings, undefined);
    assert.equal(game.element("gravityNounBlock").style.transform, "translateY(0px)");
    assert.equal(game.element("gravityNounLoading").hidden, true);
    assert.equal(game.controller.snapshot().total, game.raw.items.filter(item => item.difficulty === undefined || item.difficulty <= 1).length);
    assert.equal(game.fetches.length, 1);
    assert.equal(game.fetches[0].url,
      "https://caatuu.test/" + game.course.id + "/data/games/grammar-gravity/nouns.json?v=fixture-2");
    assert.equal(game.fetches[0].request.credentials, "same-origin");
    game.controller.destroy();
  });
}

test("correct selection lands once, settles for180ms, and displays the result for900 active milliseconds", async () => {
  const game = await mountGame();
  const first = game.controller.snapshot().item;
  game.answer();
  assert.equal(game.controller.snapshot().phase, "feedback");
  assert.equal(game.controller.snapshot().correct, true);
  assert.equal(game.records.length, 1);
  assert.deepEqual(game.records[0], { gameId: "grammar-gravity", activities: 1, attempts: 1, successes: 1, xp: 1 });
  game.lane(first.laneId).click();
  game.controller.next();
  assert.equal(game.records.length, 1);
  assert.equal(game.controller.snapshot().item.id, first.id);
  game.frame(0);
  game.frame(179);
  assert.equal(game.controller.snapshot().item.id, first.id);
  assert.equal(game.element("gravityNounResult"), null);
  game.frame(180);
  assert.ok(game.element("gravityNounBlock").classList.contains("is-correct"));
  assert.equal(game.element("gravityNounResultMark"), null);
  assert.ok(game.element("gravityNounFeedback").getAttribute("aria-label").includes("Correct"));
  assert.ok(game.lane(first.laneId).classList.contains("is-correct"));
  game.frame(1000);
  game.frame(1079);
  assert.equal(game.controller.snapshot().item.id, first.id);
  const outsideControl = game.outsideControl;
  outsideControl.focus();
  game.frame(1080);
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.notEqual(game.controller.snapshot().item.id, first.id);
  assert.equal(game.controller.snapshot().selectedLane, null);
  assert.equal(game.records.length, 1);
  assert.equal(game.element("gravityNounBlock").classList.contains("is-correct"), false);
  assert.equal(game.document.activeElement, outsideControl, "automatic progress must not steal focus");
  game.controller.destroy();
});

test("incorrect selection keeps the full2400ms review pause", async () => {
  const game = await mountGame();
  const first = game.controller.snapshot().item;
  game.answer(game.raw.lanes.find((lane) => lane.id !== first.laneId).id);
  assert.equal(game.controller.snapshot().correct, false);
  game.frame(0);
  game.frame(1000);
  game.frame(2000);
  game.frame(2579);
  assert.equal(game.controller.snapshot().item.id, first.id);
  game.frame(2580);
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.notEqual(game.controller.snapshot().item.id, first.id);
  game.controller.destroy();
});

test("automatic advancement restores play focus after a native disabled lane drops it to body", async () => {
  const game = await mountGame();
  const lane = game.lane(game.controller.snapshot().item.laneId);
  lane.focus();
  lane.click();
  assert.equal(lane.disabled, true);
  // Browsers blur a disabled focused button; FakeElement intentionally does not.
  game.document.body.focus();
  game.finishFeedback();
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.equal(game.document.activeElement, game.element("gravityNounArena"));
  game.controller.destroy();
});

test("unfocused automatic timeouts do not pull focus into the game", async () => {
  const game = await mountGame();
  game.document.body.focus();
  game.frame(0);
  for (let time = 1000; time <= 10000; time += 1000) game.frame(time);
  game.finishFeedback();
  assert.equal(game.document.activeElement, game.document.body);
  game.controller.destroy();
});

test("automatic noun advancement never restores play focus from an in-arena toolbar", async () => {
  const game = await mountGame();
  const header = game.element("gravityGameHeader") || game.document.createElement("header");
  header.id = "gravityGameHeader";
  game.element("gravityNounArena").append(header);
  const setting = game.document.createElement("button");
  header.append(setting);
  game.answer();
  setting.focus();
  game.finishFeedback();
  assert.equal(game.document.activeElement, setting, "opening settings during feedback keeps focus in settings");
  game.frame(10000);
  for (let time = 11000; time <= 20000; time += 1000) game.frame(time);
  assert.equal(game.controller.snapshot().phase, "feedback");
  game.document.body.focus();
  game.finishFeedback();
  assert.equal(game.document.activeElement, game.document.body, "a toolbar-focused timeout does not request arena focus");
  game.controller.destroy();
});

test("the visible word is a polite atomic status updated only when its noun changes", async () => {
  const game = await mountGame();
  const word = game.element("gravityNounWord");
  assert.equal(word.getAttribute("role"), "status");
  assert.equal(word.getAttribute("aria-live"), "polite");
  assert.equal(word.getAttribute("aria-atomic"), "true");
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(word), "textContent");
  const writes = [];
  Object.defineProperty(word, "textContent", {
    configurable: true,
    get() { return descriptor.get.call(this); },
    set(value) { writes.push(value); descriptor.set.call(this, value); }
  });
  game.controls.setOpen(true);
  game.controls.setOpen(false);
  game.frame(0);
  game.frame(500);
  game.answer();
  game.frame(500);
  game.frame(680);
  assert.equal(writes.length, 0, "settings, motion and result redraws must not repeat the live noun");
  game.finishFeedback();
  assert.deepEqual(writes, [game.controller.snapshot().item.targetText]);
  assert.equal(word.textContent, game.controller.snapshot().item.targetText);
  game.controller.destroy();
});

test("timeout gives a short correction and one second chance without adding teaching prose", async () => {
  const game = await mountGame();
  game.frame(0);
  for (let time = 1000; time <= 10000; time += 1000) game.frame(time);
  const state = game.controller.snapshot();
  assert.equal(state.phase, "feedback");
  assert.equal(state.correct, false);
  assert.equal(state.queue.at(-1).id, state.item.id);
  assert.equal(game.records[0].successes, 0);
  assert.equal(game.records[0].xp, 0);
  game.frame(10000);
  game.frame(10180);
  const feedback = game.element("gravityNounFeedback").textContent;
  const lane = game.raw.lanes.find(({ id }) => id === state.item.laneId);
  assert.ok(feedback.includes(lane.label));
  assert.ok(feedback.length < 80);
  assert.doesNotMatch(feedback, /belongs in|grammatically|native review|undefined/i);
  assert.equal(game.frames.size, 1);
  game.finishFeedback();
  assert.equal(game.controller.snapshot().phase, "falling");
  game.controller.destroy();
});

test("large animation gaps are ignored and automatically resume the active-time clock", async () => {
  const game = await mountGame();
  game.frame(0);
  game.frame(500);
  game.frame(20000);
  assert.equal(game.controller.snapshot().elapsedMs, 500);
  assert.equal(game.frames.size, 1);
  game.frame(20500);
  assert.equal(game.controller.snapshot().elapsedMs, 1000);
  assert.equal(game.records.length, 0);
  game.controller.destroy();
});

test("hidden and inactive games freeze input and resume automatically without background catch-up", async () => {
  const game = await mountGame();
  game.frame(0);
  game.frame(250);
  const pending = [...game.frames.values()][0];
  game.document.hidden = true;
  game.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(game.frames.size, 0);
  const hidden = game.controller.snapshot();
  pending(20000);
  game.lane(hidden.item.laneId).click();
  assert.equal(game.controller.snapshot(), hidden);
  game.document.hidden = false;
  game.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(game.frames.size, 1);
  game.frame(30000);
  game.frame(30250);
  assert.equal(game.controller.snapshot().elapsedMs, 500);
  game.controller.setActive(false);
  assert.equal(game.frames.size, 0);
  const inactive = game.controller.snapshot();
  game.lane(inactive.item.laneId).click();
  assert.equal(game.controller.snapshot(), inactive);
  game.controller.setActive(true);
  assert.equal(game.frames.size, 1);
  game.frame(60000);
  game.frame(60250);
  assert.equal(game.controller.snapshot().elapsedMs, 750);
  game.controller.destroy();
  assert.equal(game.frames.size, 0);
  assert.equal(game.controls.destroys, 1);
  assert.equal(game.mediaListeners.size, 0);
  assert.equal(game.records.length, 0);
  assert.equal(game.speechStops(), 0, "a game without pronunciation does not own shared speech");
});

test("display and audio menus cannot pause falling, selection, or visible results", async () => {
  const game = await mountGame();
  game.frame(0);
  game.frame(500);
  game.controls.setOpen(true);
  assert.equal(game.frames.size, 1);
  assert.equal(game.controls.options.settings, undefined);
  game.frame(1000);
  assert.equal(game.controller.snapshot().elapsedMs, 1000);
  game.answer();
  assert.equal(game.records.length, 1, "an open display/audio menu does not block a lane answer");
  game.frame(1100);
  game.frame(1280);
  assert.ok(game.element("gravityNounBlock").classList.contains("is-correct"));
  game.controls.setOpen(false);
  game.controls.setOpen(true);
  assert.equal(game.frames.size, 1);
  game.finishFeedback();
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.equal(game.records.length, 1);
  game.controller.destroy();
});

test("reduced motion keeps the timed challenge but holds its card at the top until the result", async () => {
  const game = await mountGame({ reducedMotion: true });
  const block = game.element("gravityNounBlock");
  assert.equal(game.element("gravityNounUntimed"), null);
  assert.equal(game.frames.size, 1);
  assert.equal(block.style.transform, "translateY(0px)");
  game.frame(0);
  for (let time = 1000; time <= 9000; time += 1000) {
    game.frame(time);
    assert.equal(block.style.transform, "translateY(0px)");
  }
  assert.equal(game.controller.snapshot().elapsedMs, 9000);
  game.frame(10000);
  assert.equal(game.controller.snapshot().phase, "feedback");
  assert.equal(game.controller.snapshot().correct, false);
  game.frame(10000);
  game.frame(10179);
  assert.equal(block.classList.contains("is-wrong"), false);
  assert.equal(block.style.transform, "translateY(0px)");
  game.frame(10180);
  assert.ok(block.classList.contains("is-wrong"));
  assert.notEqual(block.style.transform, "translateY(0px)");
  game.finishFeedback();
  assert.equal(game.frames.size, 1);
  assert.equal(block.style.transform, "translateY(0px)");
  game.controller.destroy();
});

test("future learner-base text is rendered independently from immutable English audit text", async () => {
  const game = await mountGame({ language: "spanish", syntheticBase: true });
  const item = game.controller.snapshot().item;
  assert.equal(game.element("gravityNounMeaning").textContent, item.learnerBaseText);
  assert.match(game.element("gravityNounMeaning").textContent, /^Sens français/);
  assert.equal(game.element("gravityNounMeaning").lang, "fr");
  assert.notEqual(game.element("gravityNounMeaning").textContent, item.english);
  assert.equal(game.element("gravityNounWord").lang, "es-ES");
  assert.match(game.fetches[0].url, /\/fr-es\/data\/games\/grammar-gravity\/nouns\.json/);
  assert.equal(Object.hasOwn(item, "explanation"), false);
  game.answer();
  assert.equal(game.records[0].successes, 1);
  game.controller.destroy();
});

test("bad content and escaping paths fail visibly without credit, and a clean remount recovers", async () => {
  for (const options of [{ fetchFails: true }, { invalidContent: true }, { unsafePath: true }]) {
    const game = await mountGame(options);
    assert.equal(game.controller.ready(), false);
    assert.equal(game.element("gravityNounError").hidden, false);
    assert.match(game.element("gravityNounError").textContent, /could not load/);
    assert.equal(game.element("gravityNounArena").hidden, true);
    assert.equal(game.element("gravityNounLoading").hidden, true);
    assert.equal(game.frames.size, 0);
    assert.equal(game.records.length, 0);
    assert.equal(game.errors.length, 1);
    if (options.unsafePath) assert.equal(game.fetches.length, 0);
    game.controller.destroy();
  }
  const recovered = await mountGame();
  assert.equal(recovered.controller.ready(), true);
  assert.equal(recovered.controller.snapshot().phase, "falling");
  assert.equal(recovered.records.length, 0);
  recovered.controller.destroy();
});

test("digits and left/right arrows select and land exactly once in both course layouts", async () => {
  for (const language of ["czech", "spanish"]) {
    for (const key of ["1", "ArrowLeft", "ArrowRight"]) {
      const game = await mountGame({ language });
      const arena = game.element("gravityNounArena");
      arena.dispatchEvent({ type: "keydown", key, repeat: true });
      assert.equal(game.records.length, 0, "held key does not answer a new noun");
      const event = { type: "keydown", key };
      arena.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
      assert.equal(game.controller.snapshot().phase, "feedback");
      assert.equal(game.controller.snapshot().selectedLane,
        key === "ArrowRight" ? game.raw.lanes.at(-1).id : game.raw.lanes[0].id);
      assert.equal(game.records.length, 1);
      arena.dispatchEvent({ type: "keydown", key });
      assert.equal(game.records.length, 1);
      game.controller.destroy();
    }
  }
});

test("native Enter/Space on lane buttons retain browser activation without duplicate keyboard handling", async () => {
  for (const key of ["Enter", " "]) {
    const game = await mountGame();
    const lane = game.lane(game.controller.snapshot().item.laneId);
    lane.focus();
    const event = { type: "keydown", key, bubbles: true };
    lane.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(game.records.length, 0, "fake keydown does not synthesize the browser's click");
    lane.click();
    assert.equal(game.controller.snapshot().phase, "feedback");
    assert.equal(game.records.length, 1);
    lane.click();
    assert.equal(game.records.length, 1);
    game.controller.destroy();
  }
});

test("modified, out-of-range and speech-button keyboard input cannot accidentally answer", async () => {
  const game = await mountGame({ speech: true });
  const arena = game.element("gravityNounArena");
  for (const event of [
    { key: "6" }, { key: "1", altKey: true }, { key: "1", ctrlKey: true },
    { key: "ArrowLeft", metaKey: true }, { key: "Enter" }, { key: " " }
  ]) arena.dispatchEvent({ type: "keydown", ...event });
  game.element("gravityNounSpeak").dispatchEvent({ type: "keydown", key: "1", bubbles: true });
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.equal(game.records.length, 0);
  game.controller.destroy();
});

test("in-arena header and controls keep their keyboard input out of noun answers", async () => {
  const game = await mountGame();
  const arena = game.element("gravityNounArena");
  const header = game.element("gravityGameHeader") || game.document.createElement("header");
  header.id = "gravityGameHeader";
  arena.append(header);
  const headerButton = game.document.createElement("button");
  header.append(headerButton);
  const controls = game.element("gravityNounControls");
  header.append(controls);
  const setting = game.document.createElement("input");
  controls.append(setting);
  for (const target of [headerButton, setting]) {
    for (const key of ["1", "2", "ArrowLeft", "ArrowRight", "Enter", " "]) {
      const event = { type: "keydown", key, bubbles: true };
      target.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false, "settings retain native keyboard behavior");
      assert.equal(game.controller.snapshot().phase, "falling");
      assert.equal(game.records.length, 0);
    }
  }
  arena.append(controls);
  setting.dispatchEvent({ type: "keydown", key: "1", bubbles: true });
  assert.equal(game.records.length, 0, "controls remain isolated if moved outside the header");
  arena.dispatchEvent({ type: "keydown", key: "1" });
  assert.equal(game.records.length, 1, "arena answer shortcuts are still available");
  game.controller.destroy();
});

test("pronunciation never pauses falling or selection and is stopped when the word lands", async () => {
  const game = await mountGame({ speech: true, deferSpeech: true });
  assert.ok(game.element("gravityNounSpeak").querySelector('[data-speech-icon="play"]'));
  const word = game.controller.snapshot().item.targetText;
  game.frame(0);
  game.click(game.element("gravityNounSpeak"));
  await settle();
  assert.equal(game.frames.size, 1);
  assert.equal(game.speechCalls[0], word);
  assert.ok(game.element("gravityNounSpeak").querySelector('[data-speech-icon="stop"]'));
  game.frame(500);
  assert.equal(game.controller.snapshot().elapsedMs, 500);
  const stops = game.speechStops();
  game.lane(game.controller.snapshot().item.laneId).click();
  assert.equal(game.records.length, 1);
  assert.ok(game.speechStops() > stops);
  assert.equal(game.element("gravityNounSpeak").hidden, true);
  game.finishSpeech();
  await settle();
  assert.equal(game.controller.snapshot().phase, "feedback", "late speech completion cannot change a landed word");
  assert.equal(game.frames.size, 1);
  game.finishFeedback();
  assert.ok(game.element("gravityNounSpeak").querySelector('[data-speech-icon="play"]'));
  game.controller.destroy();

  const failed = await mountGame({ speech: true, speechFails: true });
  failed.click(failed.element("gravityNounSpeak"));
  await settle();
  assert.equal(failed.frames.size, 1);
  assert.match(failed.element("gravityNounSpeak").title, /Audio unavailable/);
  assert.equal(failed.element("gravityNounResult"), null, "there is no landing-result overlay");
  failed.answer();
  assert.equal(failed.records[0].successes, 1);
  failed.controller.destroy();
});

test("global mute disables noun pronunciation and restores only active controls", async () => {
  const game = await mountGame({ speech: true, deferSpeech: true });
  let muted = false;
  game.shell.CaatuuChrome.getSpeechMuted = () => muted;
  const speak = game.element("gravityNounSpeak");
  game.click(speak);
  await settle();
  assert.equal(game.speechCalls.length, 1);
  muted = true;
  game.window.dispatchEvent({ type: "caatuu:speech-mute-change" });
  assert.equal(speak.disabled, true);
  assert.ok(speak.querySelector('[data-speech-icon="play"]'));
  speak.dispatchEvent({ type: "click", bubbles: true });
  game.finishSpeech();
  await settle();
  assert.equal(game.speechCalls.length, 1);
  assert.equal(speak.disabled, true);
  muted = false;
  game.window.dispatchEvent({ type: "caatuu:speech-mute-change" });
  assert.equal(speak.disabled, false);
  game.controller.setActive(false);
  muted = true;
  game.window.dispatchEvent({ type: "caatuu:speech-mute-change" });
  muted = false;
  game.window.dispatchEvent({ type: "caatuu:speech-mute-change" });
  assert.equal(speak.disabled, true, "unmuting cannot reactivate a hidden game");
  game.controller.destroy();
});

test("pronunciation remains usable with an open menu but cannot interrupt a result animation", async () => {
  const game = await mountGame({ speech: true });
  const speak = game.element("gravityNounSpeak");
  game.controls.setOpen(true);
  speak.click();
  await settle();
  assert.equal(game.speechCalls.length, 1);
  assert.equal(speak.hidden, false);
  game.answer();
  assert.equal(speak.hidden, true);
  speak.click();
  await settle();
  assert.equal(game.speechCalls.length, 1);
  assert.equal(game.frames.size, 1);
  game.finishFeedback();
  assert.equal(speak.hidden, false);
  game.controller.destroy();
});

test("destruction makes pending animation and speech callbacks inert", async () => {
  const game = await mountGame({ speech: true, deferSpeech: true });
  const pending = [...game.frames.values()][0];
  game.click(game.element("gravityNounSpeak"));
  await settle();
  game.controller.destroy();
  pending(100000);
  game.finishSpeech();
  await settle();
  game.lane(game.controller.snapshot().item.laneId).click();
  assert.equal(game.frames.size, 0);
  assert.equal(game.records.length, 0);
  assert.equal(game.controls.destroys, 1);
});

test("continuous full-pack cycles credit once and restart without a completion gate or repeated boundary noun", async () => {
  for (const outcome of ["perfect", "recovered", "unresolved"]) {
    const game = await mountGame({ reducedMotion: true, difficulty: 3 });
    const missedId = game.controller.snapshot().item.id;
    const outsideControl = game.outsideControl;
    const count = game.raw.items.length;
    let turns = 0;
    let lastId;
    const seen = new Set();
    while (!game.records.some((record) => record.rounds === 1) && turns < count * 2 + 2) {
      const item = game.controller.snapshot().item;
      seen.add(item.id);
      lastId = item.id;
      const miss = item.id === missedId && (outcome === "unresolved" || (outcome === "recovered" && turns === 0));
      const lane = miss ? game.raw.lanes.find((candidate) => candidate.id !== item.laneId).id : item.laneId;
      game.answer(lane);
      if (game.controller.snapshot().queue.length === 0) outsideControl.focus();
      game.finishFeedback();
      turns += 1;
    }
    assert.equal(seen.size, count, "every noun in the JSON pool is practiced");
    assert.equal(game.controller.snapshot().phase, "falling");
    assert.equal(game.controller.snapshot().total, count);
    assert.notEqual(game.controller.snapshot().item.id, lastId, "cycle boundaries avoid repeating the previous noun");
    assert.equal(game.records.filter((record) => record.rounds === 1).length, 1);
    assert.equal(game.records.filter((record) => record.attempts === 1).length, count + (outcome === "perfect" ? 0 : 1));
    assert.equal(game.records.reduce((sum, record) => sum + (record.xp || 0), 0), count - (outcome === "unresolved" ? 1 : 0));
    assert.equal(game.messages.length, outcome === "unresolved" ? 0 : 1);
    if (outcome !== "unresolved") {
      assert.equal(game.messages[0].message.gameId, "grammar-gravity");
      assert.equal(game.messages[0].origin, "https://caatuu.test");
      assert.equal(game.messages[0].message.evidence.exampleIds.length, count);
      assert.equal(game.messages[0].message.evidence.contentRevision, game.raw.contentRevision);
    }
    const recordCount = game.records.length;
    game.controller.next();
    assert.equal(game.records.length, recordCount);
    assert.equal(game.element("gravityNounSummary"), null);
    assert.equal(game.element("gravityNounRestart"), null);
    assert.equal(game.element("gravityNounBlock").hidden, false);
    assert.equal(game.element("gravityNounBlock").classList.contains("is-correct"), false);
    assert.equal(game.frames.size, 1);
    assert.equal(game.document.activeElement, outsideControl, "cycle changes leave external focus in place");
    if (outcome === "perfect") {
      for (let index = 0; index < count; index += 1) { game.answer(); game.finishFeedback(); }
      assert.equal(game.records.filter((record) => record.rounds === 1).length, 2);
      assert.equal(game.records.reduce((sum, record) => sum + (record.xp || 0), 0), count * 2);
      assert.equal(game.messages.length, 2);
      assert.equal(game.controller.snapshot().phase, "falling");
      game.document.body.focus();
      game.frame(1000000);
      for (let index = 1; index <= 10; index += 1) game.frame(1000000 + index * 1000);
      game.finishFeedback();
      assert.equal(game.document.activeElement, game.document.body, "new cycles reset previous play-focus recovery");
    }
    game.controller.destroy();
  }
});


test("the robot loader remains visible for real pending fetches and disappears on success or failure", async () => {
  for (const fetchFails of [false, true]) {
    const game = await mountGame({ deferFetch: true, fetchFails });
    assert.equal(game.controller, undefined);
    assert.equal(game.element("gravityNounLoading").hidden, false);
    const loading = game.element("gravityNounLoading");
    assert.equal(loading.getAttribute("aria-label"), "Loading Grammar Gravity");
    assert.ok(loading.classList.contains("caatuu-game-robot-loading"));
    assert.equal(loading.dataset.active, "true");
    game.document.hidden = true;
    game.document.dispatchEvent({ type: "visibilitychange" });
    assert.equal(loading.dataset.active, "false");
    game.document.hidden = false;
    game.document.dispatchEvent({ type: "visibilitychange" });
    assert.equal(loading.dataset.active, "true");
    game.window.dispatchEvent({ type: "pagehide", persisted: true });
    assert.equal(loading.dataset.active, "false");
    game.window.dispatchEvent({ type: "pageshow", persisted: true });
    assert.equal(loading.dataset.active, "true");
    assert.equal(game.element("gravityNounLoadingArt").getAttribute("aria-hidden"), "true");
    assert.equal(game.element("gravityNounBlock").hidden, true);
    assert.equal(game.frames.size, 0);
    assert.equal(game.records.length, 0);
    assert.equal(game.fetches.length, 1);
    await game.finishFetch();
    assert.equal(game.element("gravityNounLoading").hidden, true);
    assert.equal(game.controller.ready(), !fetchFails);
    assert.equal(game.element("gravityNounError").hidden, !fetchFails);
    assert.equal(game.frames.size, fetchFails ? 0 : 1);
    game.controller.destroy();
  }
});

test("wide cards stay inside narrow arenas while their center follows the chosen lane", async () => {
  const game = await mountGame();
  const arena = game.element("gravityNounArena");
  const block = game.element("gravityNounBlock");
  arena.clientWidth = 320;
  block.offsetWidth = 116;
  game.window.dispatchEvent({ type: "resize" });
  assert.equal(block.style.left, "102px");
  game.answer(game.raw.lanes[0].id);
  assert.equal(block.style.left, "8px");
  game.finishFeedback();
  game.answer(game.raw.lanes.at(-1).id);
  assert.equal(block.style.left, "196px");
  game.controller.destroy();
});

test("noun cards start below the in-arena header without changing the landing divider", async () => {
  const game = await mountGame();
  const arena = game.element("gravityNounArena");
  const block = game.element("gravityNounBlock");
  const header = game.element("gravityGameHeader") || game.document.createElement("header");
  header.id = "gravityGameHeader";
  header.offsetTop = 8;
  header.offsetHeight = 50;
  arena.append(header);
  game.window.dispatchEvent({ type: "resize" });
  assert.equal(block.style.transform, "translateY(56px)", "CSS top plus transform leaves 12px below the toolbar");
  game.frame(0);
  for (let time = 1000; time <= 5000; time += 1000) game.frame(time);
  assert.equal(block.style.transform, "translateY(150px)", "falling interpolates through the remaining play area");
  game.answer();
  game.frame(5000);
  game.frame(5180);
  assert.equal(block.style.transform, "translateY(244px)", "landing still aligns with the existing bottom divider");
  game.finishFeedback();
  game.document.body.append(header);
  game.window.dispatchEvent({ type: "resize" });
  assert.equal(block.style.transform, "translateY(0px)", "an external toolbar consumes no arena space");
  game.controller.destroy();
});

test("six-decision segments hand off without discarding the full noun pool or its bounded retry queue", async () => {
  const game = await mountGame({ segmentSize: 6, mountControls: false, difficulty: 3 });
  assert.equal(game.controls.mounts, 0, "the parent owns the single shared toolbar");
  const seen = new Set();
  const first = game.controller.snapshot().item;
  const wrong = game.raw.lanes.find((lane) => lane.id !== first.laneId).id;
  let attempts = 0;
  while (!game.records.some((record) => record.rounds === 1) && attempts < game.raw.items.length * 2) {
    const item = game.controller.snapshot().item;
    seen.add(item.id);
    game.answer(attempts === 0 ? wrong : item.laneId);
    game.finishFeedback();
    attempts += 1;
    if (attempts % 6 === 0) {
      assert.equal(game.frames.size, 0, "completed segments wait for their phrase round");
      const waiting = game.controller.snapshot();
      game.lane(waiting.item.laneId).click();
      game.controller.next();
      assert.equal(game.controller.snapshot(), waiting);
      game.controller.setActive(false);
      game.controller.setActive(true);
      assert.equal(game.frames.size, 0, "visibility alone cannot release a segment handoff");
      game.controller.resumeSegment();
      game.controller.resumeSegment();
      assert.equal(game.frames.size, 1);
      assert.equal(game.controller.snapshot().item.id, waiting.item.id);
    }
  }
  assert.equal(seen.size, game.raw.items.length);
  assert.equal(attempts, game.raw.items.length + 1, "one missed noun is retried once across segments");
  assert.equal(game.segments.length, Math.floor(attempts / 6));
  assert.equal(game.records.filter((record) => record.rounds === 1).length, 1);
  assert.equal(game.records.reduce((sum, record) => sum + (record.xp || 0), 0), game.raw.items.length);
  game.controller.destroy();
});

test("finite fall-time choices preserve current fall progress and reject unsupported values", async () => {
  const game = await mountGame();
  game.frame(0);
  game.frame(1000);
  game.frame(2000);
  game.frame(2500);
  const position = game.element("gravityNounBlock").style.transform;
  assert.equal(game.controller.setDurationMs(20000), true);
  assert.equal(game.controller.snapshot().elapsedMs, 5000);
  assert.equal(game.controller.snapshot().durationMs, 20000);
  assert.equal(game.element("gravityNounBlock").style.transform, position);
  game.frame(3000);
  assert.equal(game.controller.snapshot().elapsedMs, 5500);
  assert.equal(game.controller.setDurationMs(15000), true);
  assert.equal(game.controller.snapshot().elapsedMs, 4125);
  assert.equal(game.controller.setDurationMs(5000), true);
  assert.equal(game.controller.snapshot().elapsedMs, 1375);
  assert.equal(game.element("gravityNounClock").getAttribute("aria-valuemax"), "5");
  assert.equal(game.element("gravityNounClock").getAttribute("aria-valuenow"), "4");
  const before = game.controller.snapshot();
  for (const value of [-1, Infinity, NaN, "20000", 100000]) {
    assert.equal(game.controller.setDurationMs(value), false);
    assert.equal(game.controller.snapshot(), before);
  }
  game.answer();
  game.finishFeedback();
  assert.equal(game.controller.snapshot().durationMs, 5000);
  assert.equal(game.controller.snapshot().elapsedMs, 0);
  assert.equal(game.frames.size, 1);
  game.controller.destroy();
});

test("infinite noun mode hides the countdown, holds position, and accepts a lane", async () => {
  const game = await mountGame();
  assert.equal(game.controller.setDurationMs(0), true);
  const word = game.controller.snapshot().item;
  const position = game.element("gravityNounBlock").style.transform;
  for (let time = 0; time <= 30000; time += 1000) game.frame(time);
  assert.equal(game.controller.snapshot().item, word);
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.equal(game.controller.snapshot().elapsedMs, 0);
  assert.equal(game.element("gravityNounBlock").style.transform, position);
  assert.equal(game.element("gravityNounClock").hidden, true);
  game.answer();
  game.finishFeedback();
  assert.equal(game.controller.snapshot().durationMs, 0);
  game.controller.setDurationMs(10000);
  assert.equal(game.controller.snapshot().elapsedMs, 0);
  assert.equal(game.element("gravityNounClock").hidden, false);
  game.controller.destroy();
});

test("the five-second clock counts active time exactly and remains visible without illustrations", async () => {
  const game = await mountGame();
  const clock = game.element("gravityNounClock");
  assert.equal(clock.getAttribute("aria-label"), "Time to choose");
  assert.equal(clock.getAttribute("aria-valuemin"), "0");
  assert.equal(clock.getAttribute("aria-valuemax"), "10");
  assert.equal(clock.getAttribute("aria-valuenow"), "10");
  assert.equal(game.controller.setDurationMs(5000), true);
  game.controller.setIconsVisible(false);
  assert.equal(clock.hidden, false);
  assert.equal(clock.getAttribute("aria-valuemax"), "5");
  game.frame(0);
  game.frame(1000);
  game.frame(1250);
  assert.equal(clock.style["--gravity-time-left"], "0.75");
  assert.equal(clock.getAttribute("aria-valuenow"), "4");
  const movingAngle = clock.style["--gravity-clock-turn"];
  game.document.hidden = true;
  game.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(clock.hidden, true);
  assert.equal(game.frames.size, 0);
  assert.equal(game.controller.snapshot().elapsedMs, 1250);
  game.document.hidden = false;
  game.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(clock.hidden, false);
  assert.equal(clock.style["--gravity-clock-turn"], movingAngle);
  game.frame(60000);
  assert.equal(clock.style["--gravity-time-left"], "0.75", "hidden time must not advance the visible countdown");
  game.controller.setActive(false);
  assert.equal(clock.hidden, true);
  assert.equal(game.frames.size, 0);
  game.controller.setActive(true);
  game.frame(100000);
  assert.equal(game.controller.snapshot().elapsedMs, 1250);
  for (const time of [101000, 102000, 103000, 103749]) game.frame(time);
  assert.equal(game.controller.snapshot().elapsedMs, 4999);
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.equal(clock.getAttribute("aria-valuenow"), "1");
  assert.equal(game.records.length, 0);
  game.frame(103750);
  assert.equal(game.controller.snapshot().phase, "feedback");
  assert.equal(clock.getAttribute("aria-valuenow"), "0");
  assert.equal(clock.style["--gravity-time-left"], "0");
  assert.equal(game.records.length, 1);
  game.finishFeedback();
  assert.equal(clock.getAttribute("aria-valuenow"), "5");
  assert.equal(clock.style["--gravity-time-left"], "1");
  assert.equal(clock.style["--gravity-clock-turn"], "180deg");
  game.controller.destroy();
  assert.equal(clock.hidden, true);
});

test("reduced motion preserves the countdown without rocking or flipping the clock", async () => {
  const game = await mountGame({ reducedMotion: true });
  const clock = game.element("gravityNounClock");
  game.controller.setDurationMs(5000);
  game.frame(0);
  game.frame(250);
  assert.equal(clock.style["--gravity-clock-turn"], "0deg");
  assert.equal(clock.style["--gravity-time-left"], "0.95");
  game.answer();
  game.finishFeedback();
  assert.equal(clock.style["--gravity-clock-turn"], "0deg");
  assert.equal(clock.getAttribute("aria-valuenow"), "5");
  game.controller.destroy();
});

test("noun visuals use the shared English retrieval API and follow the feather without pausing play", async () => {
  const game = await mountGame({ language: "spanish", syntheticBase: true, visuals: true });
  await settle();
  const image = game.element("gravityNounVisual");
  const first = game.controller.snapshot().item;
  assert.equal(game.visualCalls.length, 1);
  assert.equal(game.visualCalls[0].query, first.english);
  assert.notEqual(game.visualCalls[0].query, first.learnerBaseText);
  assert.deepEqual(game.visualCalls[0].options, { sourceKind: "image_asset" });
  assert.equal(image.getAttribute("aria-hidden"), "true");
  assert.equal(image.alt, "");
  assert.equal(image.hidden, true, "retrieved art remains hidden until its image loads");
  image.dispatchEvent({ type: "load" });
  assert.equal(image.hidden, false);
  game.frame(0);
  game.frame(500);
  game.controller.setIconsVisible(false);
  assert.equal(image.hidden, true);
  assert.equal(game.element("gravityNounClock").hidden, false);
  game.frame(1000);
  assert.equal(game.controller.snapshot().elapsedMs, 1000);
  game.controller.setIconsVisible(true);
  image.dispatchEvent({ type: "load" });
  assert.equal(image.hidden, false);
  assert.equal(game.visualCalls.length, 1, "the existing helper reuses its current English lookup");
  game.controller.setActive(false);
  assert.equal(image.hidden, true);
  game.controller.setActive(true);
  image.dispatchEvent({ type: "load" });
  assert.equal(image.hidden, false);
  game.answer();
  game.finishFeedback();
  await settle();
  assert.equal(game.visualCalls.at(-1).query, game.controller.snapshot().item.english);
  assert.notEqual(game.visualCalls.at(-1).query, first.english);
  game.controller.destroy();
  assert.equal(image.hidden, true);
});

test("missing retrieval capability or an image lookup failure never blocks noun practice", async () => {
  for (const options of [{}, { visuals: true, visualFails: true }]) {
    const game = await mountGame(options);
    await settle();
    assert.equal(game.element("gravityNounVisual").hidden, true);
    assert.equal(game.element("gravityNounClock").hidden, false);
    assert.equal(game.controller.ready(), true);
    assert.equal(game.errors.length, 0);
    game.answer();
    assert.equal(game.records[0].successes, 1);
    game.finishFeedback();
    assert.equal(game.controller.snapshot().phase, "falling");
    game.controller.destroy();
  }
});

test("illustration visibility changes only decorative lane art and does not pause play", async () => {
  const game = await mountGame();
  const label = game.lane(game.raw.lanes[0].id).querySelector("span").textContent;
  game.controller.setIconsVisible(false);
  for (const lane of game.raw.lanes) assert.equal(game.lane(lane.id).querySelector("img").hidden, true);
  assert.equal(game.element("grammarGravityNounMode").getAttribute("data-illustrations"), "hidden");
  assert.equal(game.lane(game.raw.lanes[0].id).querySelector("span").textContent, label);
  assert.equal(game.frames.size, 1);
  game.frame(0);
  game.frame(500);
  assert.equal(game.controller.snapshot().elapsedMs, 500);
  game.controller.setIconsVisible(true);
  for (const lane of game.raw.lanes) assert.equal(game.lane(lane.id).querySelector("img").hidden, false);
  game.controller.destroy();
});
