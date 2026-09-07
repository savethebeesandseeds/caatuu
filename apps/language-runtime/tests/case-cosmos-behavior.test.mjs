import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { englishInterfaceContent } from "./helpers/english-interface-content.mjs";
import { createSpeechIcon, mountEmbeddedGameControls, mountRobotLoadingScreen } from "../static/source/games/embedded-game-controls.mjs";
import { CZECH_CASES, validatePack, buildRounds, buildQuestions } from "../../languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs";
import { assertEnglishCzechCourse } from "../../languages/czech/static/source/games/case-cosmos/case-cosmos-cs-policy.mjs";

const source = await readFile(new URL(
  "../../languages/czech/static/source/games/case-cosmos/case-cosmos.js", import.meta.url
), "utf8");
const markup = await readFile(new URL(
  "../../languages/czech/static/case-cosmos.html", import.meta.url
), "utf8");
const catalog = JSON.parse(await readFile(new URL(
  "../../languages/czech/static/data/games/case-cosmos/challenges.json", import.meta.url
), "utf8"));

// Keep real ancestry and authored text while reusing the repository's fake DOM.
// The helper's seed() only records id-bearing elements as a flat fixture.
function seedMarkup(harness) {
  const main = /<main\b[\s\S]*?<\/main>/u.exec(markup)?.[0];
  assert.ok(main, "Case Cosmos exposes a main landmark");
  const stack = [harness.document.body];
  const voidTags = new Set(["img", "input", "br", "hr", "source", "wbr"]);
  for (const token of main.match(/<!--[^]*?-->|<[^>]+>|[^<]+/gu) || []) {
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

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function mountGame({ difficulty = 1, pack = catalog, status = 200, duringLoad, embedded = true,
  speech = true, muted = false, pendingSpeech = false, parentOrigin = "https://caatuu.test", courseOverride = {} } = {}) {
  let selectedDifficulty = difficulty;
  const records = [];
  const messages = [];
  const timers = [];
  const errors = [];
  const fetches = [];
  const course = {
    id: "cz", sourceLanguage: { id: "en", locale: "en" },
    targetLanguage: { id: "cs", locale: "cs-CZ" }, capabilities: { speech }, ...courseOverride
  };
  const parentHarness = createBrowserHarness({ course, location: { origin: parentOrigin } });
  const parent = parentHarness.window;
  parent.postMessage = (data, origin) => messages.push({ data, origin });
  const harness = createBrowserHarness({
    course,
    location: {
      href: "https://caatuu.test/cz/case-cosmos.html",
      pathname: "/cz/case-cosmos.html"
    },
    window: {
      parent,
      CaatuuLearning: {
        difficulty: () => selectedDifficulty,
        difficultyOption: (value) => ({ label: `Level ${value}` }),
        record: (gameId, delta) => records.push({ gameId, delta: { ...delta } })
      }
    }
  });
  if (!embedded) harness.window.parent = harness.window;
  const chromeStates = new Map();
  for (const scope of [parent, harness.window]) {
    const preferences = { muted, pace: "normal", voice: "", stops: 0, calls: [], pendingStop: null };
    const observers = [];
    chromeStates.set(scope, preferences);
    scope.CaatuuI18n = englishInterfaceContent;
    scope.document.documentElement.dataset.theme = "light";
    scope.document.documentElement.dataset.fontSize = "largest";
    scope.MutationObserver = class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.push(this.callback); }
      disconnect() { observers.splice(observers.indexOf(this.callback), 1); }
    };
    scope.CaatuuChrome = {
      applyTheme(value) {
        scope.document.documentElement.dataset.theme = value;
        observers.forEach((callback) => callback());
      },
      applyFontSize(value) {
        scope.document.documentElement.dataset.fontSize = value;
        observers.forEach((callback) => callback());
      },
      getSpeechMuted: () => preferences.muted,
      setSpeechMuted(value) {
        preferences.muted = value;
        scope.dispatchEvent({ type: "caatuu:speech-mute-change" });
      },
      resolveSpeechPace: () => ({ key: preferences.pace, label: preferences.pace, rate: 1 }),
      setSpeechPacePreference(value) {
        preferences.pace = value;
        scope.dispatchEvent({ type: "caatuu:speech-pace-change" });
      },
      getSpeechVoicePreference: () => preferences.voice,
      setSpeechVoicePreference(value) {
        preferences.voice = value;
        scope.dispatchEvent({ type: "caatuu:speech-voice-change" });
      },
      stopSpeech() {
        preferences.stops += 1;
        return preferences.pendingStop || Promise.resolve();
      },
      speakText(text, options) {
        let complete;
        const completion = new Promise((resolve) => { complete = resolve; });
        preferences.calls.push({ text, options, complete });
        if (!pendingSpeech) complete(true);
        return completion;
      },
      async getSpeechVoiceControlState() {
        return { available: true, backend: "browser", voices: [{ value: "browser:cs", name: "Czech voice", locale: "cs-CZ" }] };
      },
      describeSpeechVoiceState: () => "Voice ready",
      installSpeechData: async () => {}
    };
  }
  const shell = embedded && parentOrigin === harness.window.location.origin ? parent : harness.window;
  seedMarkup(harness);
  let releaseFetch;
  const response = new Promise((resolve) => { releaseFetch = resolve; });
  harness.context.fetch = async (url, options) => {
    fetches.push({ url, options });
    return response;
  };
  let clock = 0;
  let timerId = 0;
  const setTimer = (callback, delay) => {
    const id = ++timerId;
    timers.push({ id, callback, delay, due: clock + delay });
    return id;
  };
  const clearTimer = (id) => {
    const index = timers.findIndex((timer) => timer.id === id);
    if (index >= 0) timers.splice(index, 1);
  };
  const tick = async (milliseconds) => {
    const end = clock + milliseconds;
    for (let guard = 0; guard < 1000; guard += 1) {
      const timer = timers.filter((entry) => entry.due <= end).sort((a, b) => a.due - b.due)[0];
      if (!timer) { clock = end; await settle(); return; }
      clock = timer.due;
      clearTimer(timer.id);
      timer.callback();
      await settle();
    }
    throw new Error("Unbounded timer loop");
  };
  harness.window.performance = { now: () => clock };
  harness.window.matchMedia = () => ({ matches: false });
  harness.context.setTimeout = harness.window.setTimeout = setTimer;
  harness.context.clearTimeout = harness.window.clearTimeout = clearTimer;
  harness.context.console = { ...console, error: (...values) => errors.push(values) };
  Object.assign(harness.context, { createSpeechIcon, mountEmbeddedGameControls, mountRobotLoadingScreen,
    CZECH_CASES, validatePack, buildRounds, buildQuestions, assertEnglishCzechCourse });
  // Capture the actual initialization promise, without exposing test APIs in production.
  assert.match(source, /\binit\(\);\s*$/u);
  const executable = source
    .replace(/^import\s+[\s\S]*?\sfrom\s+["'][^"']+["'];\r?\n/gmu, "")
    .replace(/\binit\(\);\s*$/u, "globalThis.caseCosmosReady = init();");
  vm.runInContext(executable, harness.context);
  const api = vm.runInContext(
    "({ state, CZECH_CASES, validatePack, buildRounds, buildQuestions, currentRound, currentChallenge, currentQuestion, chooseAnswer, nextRound, render })",
    harness.context
  );
  const game = {
    ...harness, api, records, messages, timers, errors, fetches, shell, parentHarness, tick,
    preferences: chromeStates.get(shell), chromeStates,
    element: (id) => harness.document.getElementById(`caseCosmos${id}`),
    selectCandidate(matches) {
      const challenge = api.currentChallenge();
      // Reorder actual generated alternatives so tests never start after the solution.
      const candidates = [...challenge.candidates].sort((a, b) => Number(a.matches) - Number(b.matches));
      api.state.questions = api.state.questions.map((entry, index) => index === api.state.questionIndex ? { ...entry, candidates } : entry);
      api.state.candidateIndex = candidates.findIndex((entry) => entry.matches === matches);
      api.render();
      return api.currentQuestion();
    },
    difficulty(value, reason = "difficulty") {
      selectedDifficulty = value;
      shell.dispatchEvent({ type: "caatuu:learning-change", detail: { reason } });
    },
    key(key, values = {}) {
      const panel = harness.document.getElementById("caseCosmosPanel");
      const event = { type: "keydown", key, target: panel, ...values };
      panel.dispatchEvent(event);
      return event;
    }
  };
  duringLoad?.(game);
  releaseFetch({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(pack) });
  await harness.context.caseCosmosReady;
  await settle();
  if (game.api.state.phase === "question") game.selectCandidate(true);
  return game;
}

test("Case Cosmos has one sentence, one proposed case, and two real answer buttons; the old matching grid is gone", async () => {
  const game = await mountGame();
  assert.doesNotMatch(markup, /caseCosmos(?:SituationOptions|SentenceOptions|Patterns)|case-cosmos-match-grid/u);
  for (const id of ["Yes", "No"]) {
    assert.equal(game.element(id).tagName, "BUTTON");
    assert.equal(game.element(id).getAttribute("type"), "button");
  }
  assert.equal(game.element("Board").hidden, false);
  assert.equal(game.element("Feedback").hidden, true);
  assert.equal(game.element("Next").hidden, true);
  assert.equal(game.document.querySelectorAll("#caseCosmosSentence").length, 1);
  assert.equal(game.document.querySelectorAll("#caseCosmosProposedCase").length, 1);
  assert.equal(game.element("Panel").getAttribute("aria-busy"), "false");
  assert.equal(game.element("Example").getAttribute("aria-describedby"), "caseCosmosSentence caseCosmosTranslation caseCosmosProposedCase caseCosmosCaseHint");
  assert.equal(game.element("Example").getAttribute("aria-label"), "Sentence to review");
  assert.equal(game.element("Example").getAttribute("tabindex"), "-1");
  assert.equal(game.element("Panel").contains(game.element("Info")), false);
  assert.equal(game.document.getElementById("caseCosmosPrompt"), null);
  assert.equal(game.element("Info").hidden, false);
  assert.doesNotMatch(markup, /id="caseCosmosProgress"|One sentence at a time/u);
  assert.equal(game.document.body.classList.contains("case-cosmos-embedded"), true);
});

test("only the sentence and translation remain in the cabin; noun, case note, and playback sit outside", async () => {
  const game = await mountGame();
  for (const id of ["Sentence", "Translation"]) assert.ok(game.element("Example").contains(game.element(id)));
  for (const id of ["Noun", "ProposedCase", "CaseHint", "Speak"]) assert.equal(game.element("Example").contains(game.element(id)), false);
  assert.ok(game.element("CaseNote").contains(game.element("Noun")));
  assert.ok(game.element("CaseNote").contains(game.element("ProposedCase")));
  assert.ok(game.element("CaseNote").contains(game.element("CaseHint")));
  const actions = game.document.querySelector(".case-cosmos-actions");
  for (const id of ["No", "Yes", "Speak"]) assert.ok(actions.contains(game.element(id)));
  assert.deepEqual(game.document.querySelector(".case-cosmos-answers").children.map((button) => button.id), ["caseCosmosNo", "caseCosmosYes"]);
  assert.match(game.element("Info").textContent, /Swipe left for No · right for Yes/u);
});

test("symbol-only answers retain accessible names, the question, and keyboard shortcuts", async () => {
  const game = await mountGame();
  for (const [id, symbol, shortcuts] of [["No", "×", "N 2"], ["Yes", "✓", "Y 1"]]) {
    const button = game.element(id);
    assert.equal(button.textContent.trim(), symbol);
    assert.equal(button.getAttribute("aria-label"), id);
    assert.equal(button.getAttribute("aria-keyshortcuts"), shortcuts);
  }
  const answers = game.document.querySelector(".case-cosmos-answers");
  assert.equal(answers.getAttribute("aria-label"), "Does the highlighted noun form fit this sentence?");
  assert.equal(answers.getAttribute("aria-describedby"), "caseCosmosProposedCase");
});

test("the boat frames the live card while decisions stay below it, and the original asset is packaged offline", async () => {
  const game = await mountGame();
  const vessel = game.document.querySelector(".case-cosmos-vessel");
  const boat = game.element("Boat");
  assert.equal(boat.getAttribute("src"), "/assets/micelaneous/floating_boat.png");
  assert.equal(boat.getAttribute("aria-hidden"), "true");
  assert.equal(boat.getAttribute("alt"), "");
  for (const id of ["Example", "Feedback"]) {
    assert.ok(vessel.contains(game.element(id)), `${id} stays anchored to the boat`);
  }
  for (const id of ["Yes", "No", "Speak", "CaseNote"]) {
    assert.equal(vessel.contains(game.element(id)), false, `${id} does not crowd the boat`);
    assert.ok(game.element("Board").contains(game.element(id)));
  }
  const assetMap = JSON.parse(await readFile(new URL("../app-assets.json", import.meta.url), "utf8"));
  assert.ok(assetMap.assets.some((asset) => asset.source === "apps/launcher/static/assets/micelaneous/floating_boat.png"
    && asset.output === "assets/micelaneous/floating_boat.png"));
  const setup = JSON.parse(await readFile(new URL("../../languages/czech/static/setup-assets.json", import.meta.url), "utf8"));
  assert.ok(setup.offline.assets.includes(boat.getAttribute("src")));
  const png = await readFile(new URL("../../launcher/static/assets/micelaneous/floating_boat.png", import.meta.url));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1189, 1323], "frame coordinates match the source image");
});

test("the responsive boat preserves the full artwork instead of enlarging and cropping it", async () => {
  const styles = await readFile(new URL("../../languages/czech/static/source/games/case-cosmos/case-cosmos.css", import.meta.url), "utf8");
  assert.match(styles, /aspect-ratio:\s*1189\s*\/\s*1323/u);
  const artworkRules = [...styles.matchAll(/\.case-cosmos-boat\s*\{([^}]+)\}/gu)].map((match) => match[1]);
  assert.equal(artworkRules.length, 2, "one hidden default and one full-frame illustrated rule, without zoom overrides");
  assert.match(artworkRules[1], /inset:\s*0;/u);
  assert.match(artworkRules[1], /width:\s*100%;/u);
  assert.match(artworkRules[1], /height:\s*100%;/u);
});

test("missing boat artwork falls back to the usable plain card without resetting the question", async () => {
  const game = await mountGame();
  const question = game.api.currentQuestion();
  assert.ok(game.element("Panel").classList.contains("case-cosmos-boat-layout"));
  game.element("Boat").dispatchEvent({ type: "error" });
  assert.equal(game.element("Panel").classList.contains("case-cosmos-boat-layout"), false);
  assert.equal(game.api.currentQuestion(), question);
  const toggle = game.document.querySelector('[aria-label="Illustrations"]');
  toggle.click();
  toggle.click();
  assert.equal(game.element("Panel").classList.contains("case-cosmos-boat-layout"), false);
  game.api.chooseAnswer(question.matches);
  assert.equal(game.api.state.phase, "solved");
  assert.equal(game.records.length, 1);
});

function pointer(game, type, x, y = 100, options = {}) {
  const { target = game.element("Example"), ...values } = options;
  const event = { type, pointerId: 1, isPrimary: true, pointerType: "touch", button: 0,
    clientX: x, clientY: y, bubbles: true, ...values };
  target.dispatchEvent(event);
  return event;
}

test("swipe right answers Yes and left answers No in both illustrated and plain layouts, once only", async () => {
  for (const plain of [false, true]) {
    for (const direction of [-1, 1]) {
      const game = await mountGame();
      if (plain) game.element("Boat").dispatchEvent({ type: "error" });
      const question = game.api.currentQuestion();
      pointer(game, "pointerdown", 150);
      const move = pointer(game, "pointermove", 150 + direction * 80);
      assert.equal(move.defaultPrevented, false, "native vertical scrolling is never suppressed");
      assert.equal(game.element("Board").dataset.swipeAnswer, direction > 0 ? "yes" : "no");
      assert.equal(game.records.length, 0, "preview is not a submission");
      pointer(game, "pointerup", 150 + direction * 80);
      assert.equal(game.api.state.answer, direction > 0);
      assert.equal(game.api.state.phase, direction > 0 ? "solved" : "mistake");
      assert.equal(game.document.activeElement.id, game.element(direction > 0 ? "Example" : "Next").id);
      assert.equal(game.element("Board").dataset.swipeAnswer, undefined);
      assert.equal(game.records.length, 1);
      assert.equal(game.records[0].delta.successes, question.matches === (direction > 0) ? 1 : 0);
      pointer(game, "pointerup", 230);
      pointer(game, "pointerdown", 150);
      pointer(game, "pointerup", 230);
      assert.equal(game.records.length, 1, "feedback and repeated events cannot answer again or advance");
      assert.equal(game.api.currentQuestion(), question);
    }
  }
});

test("taps, vertical and diagonal scrolls, cancelled gestures, and multiple contacts never answer", async () => {
  for (const kind of ["tap", "vertical", "diagonal", "cancel", "capture", "multitouch", "secondary", "right-click"]) {
    const game = await mountGame();
    const options = kind === "secondary" ? { isPrimary: false } : kind === "right-click" ? { button: 2 } : {};
    pointer(game, "pointerdown", 150, 100, options);
    if (kind === "vertical") pointer(game, "pointermove", 155, 140);
    if (kind === "cancel") pointer(game, "pointercancel", 150);
    if (kind === "capture") game.element("Vessel").dispatchEvent({ type: "lostpointercapture" });
    if (kind === "multitouch") pointer(game, "pointerdown", 180, 100, { isPrimary: false, pointerId: 2 });
    pointer(game, "pointerup", kind === "tap" ? 165 : 240, kind === "diagonal" ? 180 : 100);
    assert.equal(game.records.length, 0, kind);
    assert.equal(game.api.state.phase, "question", kind);
  }
});

test("swipes ignore controls, notes, answer buttons, and open menus", async () => {
  for (const id of ["Speak", "No", "Yes", "CaseNote", "Controls", "Panel"]) {
    const game = await mountGame();
    pointer(game, "pointerdown", 150, 100, { target: game.element(id) });
    pointer(game, "pointerup", 240);
    assert.equal(game.records.length, 0, id);
  }
  const game = await mountGame();
  game.element("Controls").querySelector(".caatuu-game-control-toggle").click();
  assert.equal(game.api.state.controls.isOpen(), true);
  pointer(game, "pointerdown", 150);
  pointer(game, "pointerup", 240);
  assert.equal(game.records.length, 0);
});

test("changing cards, layout, focus, or visibility cancels an in-flight swipe", async () => {
  const transitions = {
    difficulty: (game) => game.difficulty(2),
    artwork: (game) => game.element("Boat").dispatchEvent({ type: "error" }),
    illustrations: (game) => game.document.querySelector('[aria-label="Illustrations"]').click(),
    blur: (game) => game.window.dispatchEvent({ type: "blur" }),
    document: (game) => {
      game.document.hidden = true;
      game.document.dispatchEvent({ type: "visibilitychange" });
      game.document.hidden = false;
      game.document.dispatchEvent({ type: "visibilitychange" });
    },
    shell: (game) => {
      for (const active of [false, true]) game.window.dispatchEvent({ type: "message", origin: game.window.location.origin,
        source: game.window.parent, data: { source: "caatuu-app-shell", type: "visibility", active } });
    },
    pagehide: (game) => {
      game.window.dispatchEvent({ type: "pagehide", persisted: true });
      game.window.dispatchEvent({ type: "pageshow", persisted: true });
    },
    next: (game) => { game.api.chooseAnswer(true); game.api.nextRound(); }
  };
  for (const [name, transition] of Object.entries(transitions)) {
    const game = await mountGame();
    pointer(game, "pointerdown", 150);
    pointer(game, "pointermove", 240);
    transition(game);
    const before = game.records.length;
    pointer(game, "pointerup", 240);
    assert.equal(game.records.length, before, name);
    assert.equal(game.api.state.phase, name === "next" ? "loading" : "question", name);
    assert.equal(game.element("Board").dataset.swipeAnswer, undefined, name);
  }
});

test("loading never flashes playable cards and does not permit an answer", async () => {
  await mountGame({ duringLoad(game) {
    assert.equal(game.api.state.phase, "loading");
    assert.equal(game.element("Loading").hidden, false);
    assert.equal(game.element("Board").hidden, true);
    assert.equal(game.element("Info").hidden, true);
    game.api.chooseAnswer(true);
    game.api.nextRound();
    assert.equal(game.records.length, 0);
    assert.equal(game.api.state.phase, "loading");
  } });
});

test("each noun gets seven sentence challenges with a reachable unique correct form", async () => {
  const game = await mountGame({ difficulty: 3 });
  const orders = new Set();
  for (let seed = 1; seed <= 30; seed += 1) {
    for (const round of game.api.state.rounds) {
      const original = JSON.stringify(round);
      const challenges = game.api.buildQuestions(round, seededRandom(seed));
      assert.equal(new Set(challenges.map((entry) => entry.case)).size, 7);
      for (const challenge of challenges) {
        const authored = round.matches.find((entry) => entry.case === challenge.case);
        for (const field of ["form", "czech", "english"]) assert.equal(challenge[field], authored[field]);
        assert.equal(challenge.candidates.filter((candidate) => candidate.matches).length, 1);
        assert.ok(challenge.candidates.length >= 2 && challenge.candidates.length <= 4);
      }
      assert.equal(JSON.stringify(round), original);
      orders.add(challenges.map((entry) => entry.case).join(","));
    }
  }
  assert.ok(orders.size > 10);
});

test("the highlighted form and English translation belong to the single displayed authored sentence", async () => {
  const game = await mountGame();
  const question = game.api.currentQuestion();
  assert.equal(game.element("Sentence").textContent, question.czech);
  const marks = game.element("Sentence").querySelectorAll("mark");
  assert.equal(marks.length, 1);
  assert.equal(marks[0].textContent.toLocaleLowerCase("cs-CZ"), question.form.toLocaleLowerCase("cs-CZ"));
  assert.equal(game.element("Translation").textContent, question.english);
  assert.ok(game.element("ProposedCase").textContent.includes(question.case));
});

test("markup injected into authored content fails closed before a playable question appears", async () => {
  const pack = structuredClone(catalog);
  for (const example of Object.values(pack[0].cases)) {
    example.czech = example.czech.replace(example.form, "<img src=x onerror=alert(1)>");
    example.form = "<img src=x onerror=alert(1)>";
  }
  const game = await mountGame({ pack });
  assert.equal(game.api.state.phase, "error");
  assert.equal(game.element("Board").hidden, true);
  assert.equal(game.element("Sentence").querySelectorAll("img").length, 0);
  assert.equal(game.records.length, 0);
});

test("English-to-Czech content cannot be mounted in a different course or learner-base language", async () => {
  for (const courseOverride of [{ id: "es" }, { sourceLanguage: { id: "es", locale: "es" } },
    { targetLanguage: { id: "en", locale: "en-US" } }]) {
    const game = await mountGame({ courseOverride });
    assert.equal(game.api.state.phase, "error");
    assert.equal(game.element("Board").hidden, true);
    assert.equal(game.fetches.length, 0);
    assert.equal(game.records.length, 0);
  }
});

test("only accepting the correct form solves the sentence and awards once, followed by result and robot", async () => {
  const game = await mountGame();
  game.element("Yes").click();
  game.element("Yes").click();
  game.api.chooseAnswer(false);
  assert.equal(game.api.state.phase, "solved");
  assert.equal(game.records.length, 1);
  assert.deepEqual(game.records[0].delta, { activities: 1, attempts: 1, successes: 1, rounds: 1, xp: 1 });
  assert.equal(game.messages.length, 0, "show the result before handing off to the campaign");
  assert.equal(game.element("Next").hidden, true);
  assert.equal(game.element("Yes").disabled, true);
  assert.match(game.element("FeedbackTitle").textContent, /✓ Sentence solved/u);
  await game.tick(1799);
  assert.equal(game.api.state.phase, "solved");
  await game.tick(1);
  assert.equal(game.api.state.phase, "loading");
  assert.equal(game.element("Board").hidden, true);
  assert.equal(game.element("Loading").hidden, false);
  assert.equal(game.messages.length, 1);
  assert.deepEqual({ ...game.messages[0].data }, { source: "caatuu-game", type: "round-success", gameId: "case-cosmos" });
  await game.tick(849);
  assert.equal(game.api.state.questionIndex, 0);
  await game.tick(1);
  assert.equal(game.api.state.phase, "question");
  assert.equal(game.api.state.questionIndex, 1);
  assert.equal(game.element("Loading").hidden, true);
  assert.equal(game.records.length, 1);
});

test("a mistake ends the challenge with its correction and cannot be converted to a win", async () => {
  for (const correctForm of [true, false]) {
    const game = await mountGame();
    const question = game.selectCandidate(correctForm);
    game.api.chooseAnswer(!correctForm);
    assert.equal(game.api.state.phase, "mistake");
    assert.equal(game.element("Board").dataset.state, "mistake");
    assert.match(game.element("FeedbackTitle").textContent, /× Not quite/u);
    assert.equal(game.element(!correctForm ? "Yes" : "No").dataset.result, "wrong");
    assert.equal(game.element("Next").hidden, false);
    assert.equal(game.records[0].delta.xp, 0);
    assert.equal(game.records[0].delta.rounds, 1);
    assert.equal(game.element("ActualCase").textContent, game.api.currentChallenge().czech);
    await game.tick(1800);
    assert.equal(game.api.currentQuestion(), question);
    game.api.chooseAnswer(correctForm);
    assert.equal(game.records.length, 1);
    assert.equal(game.api.state.phase, "mistake");
    assert.equal(game.api.state.questionIndex, 0);
    game.element("Next").click();
    await game.tick(850);
    assert.equal(game.api.state.questionIndex, 1);
    assert.equal(game.api.state.phase, "question");
    assert.equal(game.element("Feedback").hidden, true);
    assert.equal(game.messages.length, 0);
    assert.equal(game.element("Yes").disabled, false);
  }
});

test("a correct X replaces only the noun, stays in the sentence, and does not complete a round", async () => {
  const game = await mountGame();
  const old = game.selectCandidate(false);
  const challenge = game.api.currentChallenge();
  const sentence = game.element("Sentence");
  const mark = sentence.querySelector("mark");
  const before = sentence.childNodes[0];
  game.element("No").click();
  assert.equal(game.api.state.phase, "rejecting");
  assert.equal(game.records[0].delta.successes, 1);
  assert.equal(game.records[0].delta.rounds, 0);
  assert.equal(game.records[0].delta.xp, 0);
  game.api.chooseAnswer(false);
  await game.tick(649);
  assert.equal(game.api.currentQuestion(), old);
  await game.tick(1);
  assert.equal(game.api.state.phase, "entering");
  assert.notEqual(game.api.currentQuestion().form, old.form);
  assert.equal(game.api.currentChallenge(), challenge);
  assert.equal(game.element("Sentence").querySelector("mark"), mark);
  assert.equal(game.element("Sentence").childNodes[0], before);
  assert.equal(game.element("Translation").textContent, old.english);
  assert.equal(game.element("ProposedCase").textContent, old.case);
  await game.tick(300);
  assert.equal(game.api.state.phase, "question");
  assert.equal(game.api.state.questionIndex, 0);
  assert.equal(game.messages.length, 0);
  assert.equal(game.records.length, 1);
});

test("every sentence persists through rejection until solved, then all seven cases advance and nouns wrap", async () => {
  const game = await mountGame();
  const count = game.api.state.rounds.length;
  for (let nounIndex = 0; nounIndex < count; nounIndex += 1) {
    for (let questionIndex = 0; questionIndex < 7; questionIndex += 1) {
      const challenge = game.api.currentChallenge();
      game.api.nextRound();
      assert.equal(game.api.currentChallenge(), challenge);
      for (let guard = 0; guard < 4; guard += 1) {
        const candidate = game.api.currentQuestion();
        game.api.chooseAnswer(candidate.matches);
        if (candidate.matches) break;
        await game.tick(950);
        assert.equal(game.api.currentChallenge(), challenge);
      }
      assert.equal(game.api.state.phase, "solved");
      await game.tick(2650);
    }
    assert.equal(game.api.state.index, (nounIndex + 1) % count);
  }
  assert.equal(game.api.state.questionIndex, 0);
  assert.equal(game.records.reduce((sum, entry) => sum + entry.delta.rounds, 0), count * 7);
  assert.equal(game.records.reduce((sum, entry) => sum + entry.delta.xp, 0), count * 7);
  assert.equal(game.messages.length, count * 7);
  assert.equal(game.timers.length, 0);
});

test("animations and robot transitions pause while hidden, in menus, and in the back-forward cache", async () => {
  for (const pause of ["document", "shell", "page", "menu"]) {
    for (const phase of ["mistake", "rejecting", "solved", "loading"]) {
      const game = await mountGame();
      if (phase === "rejecting") game.selectCandidate(false);
      game.api.chooseAnswer(phase === "solved" || phase === "loading");
      if (phase === "loading") await game.tick(1800);
      assert.equal(game.api.state.phase, phase);
      const toggle = (active) => {
        if (pause === "document") {
          game.document.hidden = !active;
          game.document.dispatchEvent({ type: "visibilitychange" });
        } else if (pause === "shell") game.window.dispatchEvent({ type: "message", origin: game.window.location.origin,
          source: game.window.parent, data: { source: "caatuu-app-shell", type: "visibility", active } });
        else if (pause === "page") game.window.dispatchEvent({ type: active ? "pageshow" : "pagehide", persisted: true });
        else game.element("Controls").querySelector(".caatuu-game-control-toggle").click();
      };
      const candidate = game.api.currentQuestion();
      await game.tick(100);
      toggle(false);
      await game.tick(10000);
      assert.equal(game.api.state.phase, phase, `${pause}/${phase}`);
      assert.equal(game.api.currentQuestion(), candidate);
      assert.equal(game.element("Board").dataset.active, "false");
      toggle(true);
      await game.tick(3000);
      assert.equal(game.api.state.phase, phase === "mistake" ? "mistake" : "question", `${pause}/${phase} resumes`);
      assert.equal(game.records.length, 1);
    }
  }
});

test("difficulty resets and final disposal cancel stale noun replacements and robot continuations", async () => {
  for (const phase of ["mistake", "rejecting", "solved", "loading"]) {
    for (const destroy of [false, true]) {
      const game = await mountGame();
      if (phase === "rejecting") game.selectCandidate(false);
      game.api.chooseAnswer(phase === "solved" || phase === "loading");
      if (phase === "loading") await game.tick(1800);
      const staleCallbacks = game.timers.map((entry) => entry.callback);
      if (destroy) game.window.dispatchEvent({ type: "pagehide", persisted: false });
      else game.difficulty(2);
      const candidate = game.api.currentQuestion();
      const messages = game.messages.length;
      staleCallbacks.forEach((callback) => callback());
      await game.tick(10000);
      assert.equal(game.api.currentQuestion(), candidate);
      assert.equal(game.api.state.destroyed, destroy);
      if (!destroy) assert.equal(game.api.state.phase, "question");
      assert.equal(game.messages.length, messages);
      assert.equal(game.records.length, 1);
      assert.equal(game.timers.length, 0);
    }
  }
});

test("reduced motion removes noun transforms without removing reject, retry, or solve semantics", async () => {
  const game = await mountGame();
  game.window.matchMedia = () => ({ matches: true });
  const old = game.selectCandidate(false);
  game.api.chooseAnswer(false);
  await game.tick(450);
  assert.equal(game.api.state.phase, "question");
  assert.notEqual(game.api.currentQuestion().form, old.form);
  assert.equal(game.api.state.questionIndex, 0);
  const styles = await readFile(new URL("../../languages/czech/static/source/games/case-cosmos/case-cosmos.css", import.meta.url), "utf8");
  assert.match(styles, /prefers-reduced-motion:[\s\S]*sentence mark \{ animation: none/u);
  assert.match(styles, /data-state="mistake"[^}]+--case-feedback: var\(--case-wrong\)/u);
  assert.match(styles, /case-cosmos-next\[hidden\]/u);
});

test("wrong candidate speech never models an incorrect sentence; a solved card speaks the correct utterance", async () => {
  const game = await mountGame();
  const wrong = game.selectCandidate(false);
  game.element("Speak").click();
  await settle();
  assert.equal(game.preferences.calls[0].text, wrong.form);
  game.selectCandidate(true);
  game.api.chooseAnswer(true);
  game.element("Speak").click();
  await settle();
  assert.equal(game.preferences.calls[1].text, game.api.currentChallenge().czech);
});

test("difficulty changes rebuild eligible noun rounds and clear pending feedback without adding rewards", async () => {
  const game = await mountGame();
  const initialCount = game.api.state.rounds.length;
  assert.ok(game.api.state.rounds.every((round) => round.difficulty === 1));
  game.api.chooseAnswer(game.api.currentQuestion().matches);
  game.difficulty(2, "audio");
  assert.equal(game.api.state.phase, "solved", "unrelated profile changes do not restart a question");
  game.difficulty(2);
  assert.equal(game.api.state.phase, "question");
  assert.equal(game.api.state.answer, null);
  assert.equal(game.api.state.index, 0);
  assert.equal(game.api.state.questionIndex, 0);
  assert.ok(game.api.state.rounds.length > initialCount);
  assert.ok(game.api.state.rounds.every((round) => round.difficulty <= 2));
  game.difficulty(3);
  assert.equal(game.api.state.rounds.length, catalog.length);
  game.difficulty(99);
  assert.equal(game.api.state.difficulty, 1);
  assert.equal(game.api.state.rounds.length, initialCount);
  assert.equal(game.records.length, 1);
});

test("yes/no keyboard shortcuts ignore modified, repeated, and editable-field events", async () => {
  for (const [key, answer] of [["y", true], ["Y", true], ["1", true], ["n", false], ["N", false], ["2", false]]) {
    const game = await mountGame();
    for (const values of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { repeat: true }]) {
      game.key(key, values);
      assert.equal(game.api.state.phase, "question");
    }
    for (const tag of ["input", "textarea", "select"]) {
      game.key(key, { target: game.document.createElement(tag) });
      assert.equal(game.api.state.phase, "question");
    }
    const editable = game.document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.isContentEditable = true;
    game.key(key, { target: editable });
    assert.equal(game.api.state.phase, "question");
    game.key(key);
    assert.equal(game.api.state.phase, answer ? "solved" : "mistake");
    assert.equal(game.api.state.answer, answer);
    game.key(key);
    assert.equal(game.records.length, 1);
  }
});

test("campaign advance is origin-checked, cannot skip mistakes, and cannot double-advance a solution", async () => {
  const game = await mountGame();
  const dispatch = (override = {}) => game.window.dispatchEvent({
    type: "message", origin: game.window.location.origin, source: game.window.parent,
    data: { source: "caatuu-app-shell", type: "campaign-advance" }, ...override
  });
  dispatch();
  assert.equal(game.api.state.phase, "question");
  game.api.chooseAnswer(false);
  dispatch();
  assert.equal(game.api.state.phase, "mistake");
  game.element("Next").click();
  await game.tick(850);
  game.selectCandidate(true);
  game.api.chooseAnswer(true);
  for (const override of [{ origin: "https://outside.test" }, { source: {} },
    { data: { source: "outside", type: "campaign-advance" } }]) {
    dispatch(override);
    assert.equal(game.api.state.phase, "solved");
  }
  dispatch();
  dispatch();
  assert.equal(game.api.state.phase, "loading");
  await game.tick(850);
  assert.equal(game.api.state.questionIndex, 2);
  assert.equal(game.api.state.phase, "question");
  assert.equal(game.records.reduce((sum, entry) => sum + entry.delta.rounds, 0), 2);
});

test("standalone success does not post a campaign message", async () => {
  const game = await mountGame({ embedded: false });
  game.api.chooseAnswer(game.api.currentQuestion().matches);
  assert.equal(game.records.length, 1);
  assert.equal(game.messages.length, 0);
});

test("the shared robot covers pending content and pauses with the host before readiness", async () => {
  const game = await mountGame({ duringLoad(game) {
    const loading = game.element("Loading");
    assert.equal(loading.hidden, false);
    assert.equal(loading.textContent.trim(), "");
    assert.ok(loading.classList.contains("caatuu-game-robot-loading"));
    assert.equal(loading.getAttribute("aria-label"), englishInterfaceContent.t("verbnebula.round.preparing"));
    const image = loading.querySelector("img");
    assert.ok(image.classList.contains("caatuu-game-robot-loading-art"));
    assert.equal(image.getAttribute("src"), "/assets/robots/robot%20(1).png");
    assert.equal(image.getAttribute("aria-hidden"), "true");
    assert.equal(loading.dataset.active, "true");
    game.document.hidden = true;
    game.document.dispatchEvent({ type: "visibilitychange" });
    assert.equal(loading.dataset.active, "false");
    game.document.hidden = false;
    game.document.dispatchEvent({ type: "visibilitychange" });
    assert.equal(loading.dataset.active, "true");
    for (const active of [false, true]) {
      game.window.dispatchEvent({ type: "message", origin: game.window.location.origin, source: game.window.parent,
        data: { source: "caatuu-app-shell", type: "visibility", active } });
      assert.equal(loading.dataset.active, String(active));
    }
    game.window.dispatchEvent({ type: "pagehide", persisted: true });
    assert.equal(loading.dataset.active, "false");
    game.window.dispatchEvent({ type: "pageshow", persisted: true });
    assert.equal(loading.dataset.active, "true");
    assert.equal(game.element("Board").hidden, true);
    assert.equal(game.records.length, 0);
    assert.equal(game.timers.length, 0, "robot presentation does not add a readiness timer");
  } });
  assert.equal(game.element("Loading").hidden, true);
  assert.equal(game.api.state.phase, "question");
  assert.equal(game.timers.length, 0);
});

test("retiring Case Cosmos during loading prevents late content or errors from rebuilding its screen", async () => {
  for (const status of [200, 503]) {
    const game = await mountGame({ status, duringLoad(game) {
      game.window.dispatchEvent({ type: "pagehide", persisted: false });
      assert.equal(game.element("Loading").hidden, true);
      assert.equal(game.element("Controls").children.length, 0);
    } });
    assert.equal(game.api.state.destroyed, true);
    assert.equal(game.element("Loading").hidden, true);
    assert.equal(game.element("Board").hidden, true);
    assert.equal(game.element("Error").hidden, true);
    assert.equal(game.api.currentQuestion(), null);
    assert.equal(game.records.length, 0);
    assert.equal(game.errors.length, 0);
  }
});
test("fetch and invalid-catalog failures show a non-playable error state", async () => {
  for (const options of [{ status: 503 }, { pack: [] }]) {
    const game = await mountGame(options);
    assert.equal(game.api.state.phase, "error");
    assert.equal(game.element("Error").hidden, false);
    assert.equal(game.element("Board").hidden, true);
    assert.equal(game.element("Loading").hidden, true);
    assert.equal(game.element("Info").hidden, true);
    assert.equal(game.element("Panel").getAttribute("aria-busy"), "false");
    assert.ok(game.element("ErrorCopy").textContent.length > 0);
    assert.equal(game.errors.length, 1);
    game.api.chooseAnswer(true);
    game.api.nextRound();
    game.difficulty(3);
    assert.equal(game.records.length, 0);
    assert.equal(game.api.state.phase, "error");
  }
});

test("real embedded controls share shell appearance, audio, and illustration settings without local storage", async () => {
  const game = await mountGame();
  const controls = game.element("Controls");
  assert.equal(controls.querySelectorAll(".caatuu-game-controls").length, 1);
  assert.equal(controls.querySelectorAll(".caatuu-game-control-toggle").length, 3);
  controls.querySelector('[data-value="dark"]').click();
  controls.querySelector('[data-value="large"]').click();
  assert.equal(game.shell.document.documentElement.dataset.theme, "dark");
  assert.equal(game.document.documentElement.dataset.theme, "dark");
  assert.equal(game.document.documentElement.dataset.fontSize, "large");
  assert.equal(game.window.document.documentElement.dataset.fontSize, "large");
  const feather = controls.querySelectorAll(".caatuu-game-control-toggle")
    .find((button) => button.querySelector(".caatuu-game-illustration-icon"));
  assert.equal(feather.getAttribute("aria-pressed"), "true");
  feather.click();
  assert.equal(game.element("Panel").classList.contains("case-cosmos-illustrations-off"), true);
  assert.equal(feather.getAttribute("aria-pressed"), "false");
  feather.click();
  assert.equal(game.element("Panel").classList.contains("case-cosmos-illustrations-off"), false);
  assert.deepEqual(game.localStorage.snapshot(), {});
  assert.deepEqual(game.parentHarness.localStorage.snapshot(), {});
  assert.equal(game.preferences.calls.length, 0);
});

test("answer shortcuts do not intercept keyboard use inside the shared controls", async () => {
  const game = await mountGame();
  const controls = game.element("Controls");
  for (const target of [controls, ...controls.querySelectorAll("button, input, select")]) {
    for (const key of ["y", "n", "1", "2"]) {
      const event = game.key(key, { target });
      assert.equal(event.defaultPrevented, false);
      assert.equal(game.api.state.phase, "question");
    }
  }
  assert.equal(game.records.length, 0);
});

test("pronunciation is manual, speaks the candidate word, and offers stop and replay", async () => {
  const game = await mountGame({ pendingSpeech: true });
  assert.equal(game.preferences.calls.length, 0);
  game.api.chooseAnswer(game.api.currentQuestion().matches);
  game.api.nextRound();
  game.difficulty(2);
  await settle();
  assert.equal(game.preferences.calls.length, 0, "answers, new cards, and difficulty changes never autoplay");
  assert.equal(game.preferences.stops, 0, "idle gameplay does not stop another game's audio");
  const speaker = game.element("Speak");
  const sentence = game.api.currentQuestion().form;
  speaker.click();
  await settle();
  assert.equal(game.preferences.calls.length, 1);
  assert.equal(game.preferences.calls[0].text, sentence);
  assert.equal(speaker.querySelector("svg").dataset.speechIcon, "stop");
  assert.equal(game.chromeStates.get(game.window).calls.length, 0, "embedded speech belongs to the parent shell");
  speaker.click();
  assert.equal(game.api.state.speaking, false);
  assert.equal(game.preferences.calls.length, 1);
  assert.equal(speaker.querySelector("svg").dataset.speechIcon, "play");
  speaker.click();
  await settle();
  assert.equal(game.preferences.calls.length, 2);
  game.preferences.calls[0].complete(true);
  await settle();
  assert.equal(game.api.state.speaking, true, "an old completion cannot clear the new replay's stop icon");
  game.preferences.calls[1].complete(true);
  await settle();
  assert.equal(game.api.state.speaking, false);
  assert.equal(speaker.querySelector("svg").dataset.speechIcon, "play");
});

test("mute is shared and prevents manual speech until the user unmutes", async () => {
  const game = await mountGame({ pendingSpeech: true });
  const speaker = game.element("Speak");
  speaker.click();
  await settle();
  const stops = game.preferences.stops;
  const mute = game.element("Controls").querySelector('[role="switch"]');
  mute.click();
  assert.equal(game.preferences.muted, true);
  assert.equal(game.preferences.stops, stops + 1);
  assert.equal(game.api.state.speaking, false);
  assert.equal(speaker.disabled, true);
  speaker.click();
  await settle();
  assert.equal(game.preferences.calls.length, 1);
  mute.click();
  assert.equal(game.preferences.muted, false);
  assert.equal(speaker.disabled, false);
  speaker.click();
  await settle();
  assert.equal(game.preferences.calls.length, 2);
});

test("pace and voice controls cancel the current manual pronunciation and retain shell preferences", async () => {
  const game = await mountGame({ pendingSpeech: true });
  const controls = game.element("Controls");
  const audio = controls.querySelectorAll(".caatuu-game-control-toggle")
    .find((button) => button.getAttribute("aria-label") === englishInterfaceContent.t("common.audio.settings"));
  audio.click();
  await settle();
  audio.click();
  game.element("Speak").click();
  await settle();
  const speed = controls.querySelector("input");
  speed.value = "0";
  speed.dispatchEvent({ type: "input" });
  assert.equal(game.preferences.pace, "slower");
  assert.equal(game.api.state.speaking, false);
  game.element("Speak").click();
  await settle();
  const voice = controls.querySelector("select");
  voice.value = "browser:cs";
  voice.dispatchEvent({ type: "change" });
  await settle();
  assert.equal(game.preferences.voice, "browser:cs");
  assert.equal(game.api.state.speaking, false);
  assert.equal(game.preferences.calls.length, 2);
});

test("pending speech never starts late after an answer, navigation, preference change, or loss of visibility", async () => {
  const transitions = {
    answer: (game) => game.api.chooseAnswer(game.api.currentQuestion().matches),
    next: (game) => game.api.nextRound(),
    difficulty: (game) => game.difficulty(2),
    mute: (game) => game.shell.CaatuuChrome.setSpeechMuted(true),
    pace: (game) => game.shell.CaatuuChrome.setSpeechPacePreference("slower"),
    voice: (game) => game.shell.CaatuuChrome.setSpeechVoicePreference("browser:cs"),
    document: (game) => {
      game.document.hidden = true;
      game.document.dispatchEvent({ type: "visibilitychange" });
    },
    shell: (game) => game.window.dispatchEvent({
      type: "message", origin: game.window.location.origin, source: game.window.parent,
      data: { source: "caatuu-app-shell", type: "visibility", active: false }
    }),
    pagehide: (game) => game.window.dispatchEvent({ type: "pagehide", persisted: true })
  };
  for (const [name, transition] of Object.entries(transitions)) {
    const game = await mountGame();
    if (name === "next") game.api.chooseAnswer(game.api.currentQuestion().matches);
    let release;
    game.preferences.pendingStop = new Promise((resolve) => { release = resolve; });
    game.element("Speak").click();
    assert.equal(game.api.state.speaking, true, name);
    transition(game);
    release();
    await settle();
    assert.equal(game.preferences.calls.length, 0, `${name} cancels the queued pronunciation`);
    assert.equal(game.api.state.speaking, false, name);
  }
});

test("hidden idle Case Cosmos never stops another game's audio and cannot answer until visible again", async () => {
  const game = await mountGame();
  const message = (active, override = {}) => game.window.dispatchEvent({
    type: "message", origin: game.window.location.origin, source: game.window.parent,
    data: { source: "caatuu-app-shell", type: "visibility", active }, ...override
  });
  message(false, { origin: "https://outside.test" });
  assert.equal(game.api.state.active, true);
  message(false, { source: {} });
  assert.equal(game.api.state.active, true);
  message(false);
  assert.equal(game.document.body.hasAttribute("inert"), true);
  assert.equal(game.element("Speak").disabled, true);
  game.shell.CaatuuChrome.setSpeechMuted(true);
  game.shell.CaatuuChrome.setSpeechPacePreference("slow");
  game.key("y");
  game.element("Speak").click();
  await settle();
  assert.equal(game.preferences.stops, 0);
  assert.equal(game.preferences.calls.length, 0);
  assert.equal(game.records.length, 0);
  message(true);
  game.shell.CaatuuChrome.setSpeechMuted(false);
  assert.equal(game.document.body.hasAttribute("inert"), false);
  assert.equal(game.element("Speak").disabled, false);
  game.api.chooseAnswer(game.api.currentQuestion().matches);
  assert.equal(game.records.length, 1);
});

test("back-forward cache pauses speech without destroying controls; final pagehide disposes both", async () => {
  const game = await mountGame({ pendingSpeech: true });
  const speaker = game.element("Speak");
  speaker.click();
  await settle();
  game.window.dispatchEvent({ type: "pagehide", persisted: true });
  assert.equal(game.api.state.speaking, false);
  assert.equal(speaker.disabled, true);
  assert.equal(game.element("Controls").children.length, 1);
  game.window.dispatchEvent({ type: "pageshow", persisted: true });
  assert.equal(speaker.disabled, false);
  speaker.click();
  await settle();
  assert.equal(game.preferences.calls.length, 2);
  game.window.dispatchEvent({ type: "pagehide", persisted: false });
  assert.equal(game.api.state.destroyed, true);
  assert.equal(game.api.state.speaking, false);
  assert.equal(game.element("Controls").children.length, 0);
  const stops = game.preferences.stops;
  speaker.click();
  game.shell.CaatuuChrome.setSpeechMuted(true);
  game.api.chooseAnswer(true);
  await settle();
  assert.equal(game.preferences.calls.length, 2);
  assert.equal(game.preferences.stops, stops);
  assert.equal(game.records.length, 0);
});

test("unsupported speech hides the speaker and audio menu while preserving the exercise", async () => {
  const game = await mountGame({ speech: false });
  assert.equal(game.element("Speak").hidden, true);
  assert.equal(game.element("Controls").querySelectorAll(".caatuu-game-control-toggle").length, 2);
  game.element("Speak").click();
  await settle();
  assert.equal(game.preferences.calls.length, 0);
  game.api.chooseAnswer(game.api.currentQuestion().matches);
  assert.equal(game.records.length, 1);
});

test("a foreign-origin parent is rejected before catalog loading or speech access", async () => {
  const game = await mountGame({ parentOrigin: "https://outside.test" });
  assert.equal(game.api.state.phase, "error");
  assert.equal(game.element("Error").hidden, false);
  assert.equal(game.element("Board").hidden, true);
  assert.match(game.element("ErrorCopy").textContent, /same-origin/u);
  assert.equal(game.fetches.length, 0);
  for (const preferences of game.chromeStates.values()) {
    assert.equal(preferences.calls.length, 0);
    assert.equal(preferences.stops, 0);
  }
});
