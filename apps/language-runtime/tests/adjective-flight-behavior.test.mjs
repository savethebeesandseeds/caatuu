import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { englishInterfaceContent } from "./helpers/english-interface-content.mjs";
import {
  buildGrammarGravityRounds, normalizeGrammarGravityPack
} from "../static/source/games/grammar-gravity/grammar-gravity-core.mjs";
import * as flightCore from "../static/source/games/grammar-gravity/adjective-flight-core.mjs";
import { createSpeechIcon, mountRobotLoadingScreen } from "../static/source/games/embedded-game-controls.mjs";

const hostSource = await readFile(new URL(
  "../static/source/games/grammar-gravity/adjective-flight-host.mjs", import.meta.url
), "utf8");
const markup = await readFile(new URL("../static/games/grammar-gravity.html", import.meta.url), "utf8");

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

async function mountGame({ language = "czech", active = true, reducedMotion = false, speech = false, autoplay = false, meaningThenForm = false, practiceMode, focusKind, delayVisual = false } = {}) {
  const czech = language === "czech";
  const english = language === "english-from-spanish";
  const course = {
    id: czech ? "cz" : english ? "es-en" : "es",
    sourceLanguage: { id: english ? "es" : "en", locale: english ? "es-ES" : "en" },
    targetLanguage: { id: czech ? "cs" : english ? "en" : "es", locale: czech ? "cs-CZ" : english ? "en-US" : "es-ES" }
  };
  const raw = JSON.parse(await readFile(new URL(
    "../../languages/" + language + "/static/data/games/grammar-gravity/content.json", import.meta.url
  ), "utf8"));
  const pack = normalizeGrammarGravityPack(raw, {
    courseId: course.id, learnerBaseLanguage: course.sourceLanguage.locale, targetLanguage: course.targetLanguage.locale
  });
  const authoredRounds = buildGrammarGravityRounds(pack, 3, () => 0.999);
  const authored = authoredRounds.find((candidate) => !focusKind || candidate.focus.kind === focusKind);
  assert.ok(authored, "authored content supplies a modern grammar round");
  // Exercise a deliberately authored future-course subset, never an inferred fallback.
  const stages = meaningThenForm && practiceMode === undefined ? ["meaning", "form"] : authored.stages;
  const round = { ...authored, stages };
  const flights = authoredRounds.filter(({ challengeId }) => challengeId === authored.challengeId)
    .flatMap(({ flights }) => flights).slice(0, 3).map((flight) => ({ ...flight, stages }));
  const selectedMode = practiceMode || (meaningThenForm ? "sequence" : "forms");
  const harness = createBrowserHarness({ course });
  harness.window.CaatuuI18n = englishInterfaceContent;
  course.capabilities = { speech };
  const speechCalls = [];
  const speechState = { muted: false, autoplay, stops: 0 };
  harness.window.CaatuuChrome = {
    getSpeechMuted: () => speechState.muted,
    getSpeechAutoplay: () => speechState.autoplay,
    stopSpeech: async () => { speechState.stops += 1; },
    speakText: async (text) => { speechCalls.push(text); }
  };
  seedMarkup(harness);
  const element = (id) => harness.document.getElementById(id);
  const arena = element("gravityAdjectiveArena");
  arena.clientHeight = 500;
  element("gravityAdjectiveChoices").offsetTop = 422;
  element("gravityAdjectiveDrop").offsetHeight = 76;
  harness.document.hidden = false;
  const outsideControl = harness.document.createElement("button");
  outsideControl.textContent = "Outside the game";
  harness.document.body.append(outsideControl);
  const outsideInput = harness.document.createElement("input");
  harness.document.body.append(outsideInput);
  const frames = new Map();
  const attempts = [];
  const completions = [];
  const visuals = { updates: [], active: [], visible: [], destroyed: 0 };
  const motionListeners = new Set();
  let frameId = 0;
  let now = 0;
  harness.window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  harness.window.cancelAnimationFrame = (id) => frames.delete(id);
  harness.window.matchMedia = () => ({
    matches: reducedMotion,
    addEventListener: (_event, callback) => motionListeners.add(callback),
    removeEventListener: (_event, callback) => motionListeners.delete(callback)
  });
  Object.assign(harness.context, flightCore, {
    createSpeechIcon, mountRobotLoadingScreen,
    course,
    onAttempt: (value) => attempts.push(value),
    onComplete: (value) => completions.push(value),
    copy: (key, values = {}) => ({
      choose: "Complete the phrase with " + values.anchor,
      choosemeaning: "What does " + values.anchor + " mean?",
      choosecategory: "Choose the category for " + values.anchor,
      meaninghelp: "First, choose the meaning.",
      help: "Choose the form before it lands.",
      previewlabel: "Complete the phrase",
      previewhelp: "Read the phrase. The fall starts in four seconds.",
      recaplabel: "Answer",
      recaphelp: "Review the answer, then choose Next.",
      recapannouncement: values.phrase,
      nextword: "Next",
      meaningstage: "Meaning",
      categorystage: "Category",
      formstage: "Form",
      stepmistake: values.step + ": mistake",
      prompt: "Choose the form",
      correct: "Correct: " + values.phrase,
      wrong: "Try: " + values.phrase,
      timeout: "Time: " + values.phrase
    })[key] || key,
    createNounVisual: ({ image, onLoadingChange }) => ({
      get loading() { return Boolean(visuals.loading); },
      update(value) {
        visuals.updates.push(value);
        if (delayVisual) { visuals.loading = true; onLoadingChange(true); }
        visuals.finish = () => { visuals.loading = false; onLoadingChange(false); };
      },
      setActive: (value) => visuals.active.push(value),
      setVisible(value) { visuals.visible.push(value); image.hidden = !value; },
      destroy() { visuals.destroyed += 1; }
    })
  });
  const executable = hostSource
    .replace(/^import\s+[\s\S]*?\sfrom\s+["'][^"']+["'];\r?\n/gmu, "")
    .replace(/\bexport function /gu, "function ");
  vm.runInContext(executable, harness.context, { filename: "adjective-flight-host.mjs" });
  const controller = vm.runInContext(
    "mountGrammarFlight({ document, scope: window, shell: window, course, onAttempt, onComplete, copy })",
    harness.context
  );
  controller.setActive(active);
  assert.equal(controller.start(round, flights, { practiceMode: selectedMode }), true);
  function frame(timestamp) {
    assert.equal(frames.size, 1, "one animation frame is scheduled");
    now = timestamp;
    const [id, callback] = [...frames][0];
    frames.delete(id);
    callback(timestamp);
  }
  function advance(milliseconds) {
    frame(now);
    let remaining = milliseconds;
    while (remaining > 0) {
      const delta = Math.min(remaining, 1000);
      frame(now + delta);
      remaining -= delta;
    }
  }
  const option = (form = controller.snapshot().step === "meaning" ? controller.snapshot().current.anchorMeaning
    : controller.snapshot().step === "category" ? controller.snapshot().current.categoryId : controller.snapshot().current.answer) =>
    [...element("gravityAdjectiveChoices").querySelectorAll("button")]
      .find((button) => (button.dataset.grammarForm || button.dataset.nounMeaning || button.dataset.grammarCategory) === form);
  function answer(form) {
    const button = option(form);
    assert.ok(button);
    assert.equal(button.disabled, false);
    button.focus();
    button.click();
  }
  // Timing/input tests begin at the response window; dedicated modern preview tests keep it visible.
  if (!meaningThenForm && !practiceMode && active) advance(4000);
  return { ...harness, course, round, flights, controller, element, arena, outsideControl, outsideInput,
    attempts, completions, visuals, motionListeners, frames, frame, advance, option, answer, speechCalls, speechState,
    responseWindow: !meaningThenForm && !practiceMode };
}

async function settleSpeech() { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }

test("the robot keeps meaning input and its clock paused until the illustration is ready", async () => {
  const game = await mountGame({ practiceMode: "meaning", delayVisual: true });
  assert.equal(game.arena.getAttribute("aria-busy"), "true");
  assert.equal(game.element("gravityAdjectiveDrop").hidden, true);
  assert.equal(game.frames.size, 0);
  game.option().click();
  assert.equal(game.attempts.length, 0);
  assert.equal(game.controller.snapshot().elapsedMs, 0);
  game.visuals.finish();
  assert.equal(game.arena.getAttribute("aria-busy"), "false");
  assert.equal(game.element("gravityAdjectiveDrop").hidden, false);
  assert.equal(game.frames.size, 1);
  game.advance(500);
  assert.equal(game.controller.snapshot().elapsedMs, 500);
  game.controller.destroy();
});

function assertMistakes(game, stages) {
  assert.deepEqual(Array.from(game.controller.snapshot().mistakes), stages);
  const failedSteps = [...game.element("gravityAdjectiveProgress").querySelectorAll('[data-result="wrong"]')];
  assert.equal(failedSteps.length, stages.length);
  for (const [index, stage] of stages.entries()) {
    const label = failedSteps[index];
    const marker = label.querySelector(".gravity-adjective-mistake");
    assert.ok(marker, "each mistaken step has a visible non-color-only marker");
    assert.equal(marker.textContent, "×");
    assert.equal(marker.getAttribute("aria-hidden"), "true");
    assert.equal(label.getAttribute("aria-label"), stage[0].toUpperCase() + stage.slice(1) + ": mistake");
  }
}

function continueFromRecap(game) {
  assert.equal(game.controller.snapshot().phase, "recap");
  assert.equal(game.frames.size, 0, "the recap waits for the learner, not a countdown");
  assert.equal(game.element("gravityAdjectiveChoices").hidden, true);
  assert.equal(game.element("gravityAdjectiveRecap").hidden, false);
  assert.equal(game.element("gravityNounClock").hidden, true);
  const next = game.element("gravityAdjectiveNext");
  assert.equal(next.disabled, false);
  next.focus();
  next.click();
  if (game.responseWindow && game.controller.snapshot().phase === "preview") game.advance(4000);
}

for (const language of ["czech", "spanish"]) {
  test(language + " keeps one noun through meaning, gender, and the adjective preview", async () => {
    const game = await mountGame({ language, meaningThenForm: true, practiceMode: "sequence" });
    const first = game.controller.snapshot().current;
    assert.deepEqual(Array.from(game.controller.snapshot().steps), ["meaning", "category", "form"]);
    assert.doesNotMatch(game.element("gravityAdjectiveProgress").textContent, /[0-9]/u);
    game.answer();
    game.advance(180);
    game.advance(900);
    assert.equal(game.controller.snapshot().step, "category");
    assert.equal(game.controller.snapshot().current, first);
    assert.equal(game.element("gravityAdjectiveNoun").textContent, first.anchorText);
    assert.equal(game.element("gravityAdjectiveMeaning").textContent, first.anchorMeaning);
    assert.equal(game.attempts.length, 0);
    for (const gender of first.categoryOptions) {
      const button = game.option(gender.id);
      const icon = button.querySelector("img");
      assert.equal(icon.src, gender.image);
      assert.equal(icon.alt, "");
      assert.equal(icon.getAttribute("aria-hidden"), "true");
      assert.equal(icon.draggable, false);
      assert.equal(button.getAttribute("aria-label"), gender.label);
      assert.equal(button.querySelector(".gravity-adjective-choice-label").textContent, gender.label);
    }
    game.controller.setIconsVisible(false);
    assert.ok([...game.element("gravityAdjectiveChoices").querySelectorAll("img")].every((image) => image.hidden));
    game.controller.setIconsVisible(true);
    assert.ok([...game.element("gravityAdjectiveChoices").querySelectorAll("img")].every((image) => !image.hidden));
    game.answer();
    game.advance(180);
    game.advance(900);
    assert.equal(game.controller.snapshot().step, "form");
    assert.equal(game.controller.snapshot().phase, "preview");
    assert.equal(game.controller.snapshot().current, first);
    assert.ok(game.element("gravityAdjectiveContext").textContent.includes(first.anchorMeaning));
    assert.ok(game.element("gravityAdjectiveContext").textContent.includes(first.categoryOptions.find(({ id }) => id === first.categoryId).label));
    assert.ok(game.visuals.updates.every(({ id }) => id === first.id));
    game.advance(4000);
    game.answer();
    assert.equal(game.attempts.length, 1);
    assert.equal(game.attempts[0].correct, true);
    game.advance(180);
    game.advance(900);
    continueFromRecap(game);
    assert.equal(game.controller.snapshot().index, 1);
    assert.equal(game.controller.snapshot().step, "meaning");
    game.controller.destroy();
  });
}

for (const practiceMode of ["meaning", "forms", "sequence"]) {
  test(practiceMode + " supports infinite time without drifting or timing out", async () => {
    const game = await mountGame({ meaningThenForm: true, practiceMode });
    game.controller.setDurationMs(0);
    if (game.controller.snapshot().phase === "preview") game.advance(4000);
    const first = game.controller.snapshot().current;
    const position = game.element("gravityAdjectiveDrop").style.transform;
    game.advance(60000);
    assert.equal(game.controller.snapshot().phase, "falling");
    assert.equal(game.controller.snapshot().current, first);
    assert.equal(game.controller.snapshot().elapsedMs, 0);
    assert.equal(game.element("gravityAdjectiveDrop").style.transform, position);
    assert.equal(game.element("gravityNounClock").hidden, true);
    assert.equal(game.attempts.length, 0);
    game.answer();
    game.advance(180);
    game.advance(900);
    if (practiceMode === "sequence") {
      assert.equal(game.controller.snapshot().step, "category");
      game.advance(60000);
      assert.equal(game.controller.snapshot().phase, "falling");
      assert.equal(game.controller.snapshot().current, first);
    } else {
      if (practiceMode === "forms") continueFromRecap(game);
      assert.equal(game.controller.snapshot().index, 1);
      if (game.controller.snapshot().phase === "preview") game.advance(4000);
    }
    game.controller.setDurationMs(10000);
    assert.equal(game.controller.snapshot().elapsedMs, 0);
    assert.equal(game.element("gravityNounClock").hidden, false);
    game.controller.destroy();
  });
}

for (const language of ["czech", "spanish"]) {
  test(language + " checks the noun meaning first, then restarts the same card with a full adjective timer", async () => {
    const game = await mountGame({ language, meaningThenForm: true });
    const flight = game.controller.snapshot().current;
    assert.equal(game.controller.snapshot().step, "meaning");
    assert.equal(game.element("gravityAdjectiveNoun").textContent, flight.anchorText);
    assert.equal(game.element("gravityAdjectiveMeaning").textContent, "", "the answer is not exposed in the card");
    assert.equal(game.element("gravityAdjectiveProgress").textContent, "Meaning → Form");
    assert.equal(game.option().lang, "en");
    assert.equal(game.option().getAttribute("aria-label"), flight.anchorMeaning);
    game.advance(7000);
    game.answer();
    assert.equal(game.attempts.length, 0, "the first step cannot award the completed pair twice");
    game.advance(180);
    assert.equal(game.element("gravityAdjectiveMeaning").textContent, flight.anchorMeaning);
    assert.equal(game.element("gravityAdjectiveNoun").textContent, flight.anchorText);
    game.advance(900);
    assert.equal(game.controller.snapshot().step, "form");
    assert.equal(game.controller.snapshot().current, flight);
    assert.equal(game.controller.snapshot().elapsedMs, 0);
    assert.equal(game.element("gravityAdjectiveProgress").textContent, "Meaning → Form");
    assert.equal(game.element("gravityAdjectiveMeaning").textContent, flight.learnerBaseText);
    assert.equal(game.element("gravityAdjectiveDrop").style.transform, "translateY(192px)");
    assert.equal(game.controller.snapshot().phase, "preview");
    assert.match(game.element("gravityAdjectivePrompt").textContent, /…$/u);
    assert.equal(game.element("gravityAdjectivePrompt").getAttribute("aria-label"), "Choose the form");
    assert.equal(game.element("gravityAdjectivePreviewLabel").hidden, false);
    assert.equal(game.option().disabled, false);
    game.advance(3999);
    assert.equal(game.controller.snapshot().phase, "preview");
    assert.equal(game.controller.snapshot().elapsedMs, 0);
    assert.equal(game.element("gravityAdjectiveDrop").style.transform, "translateY(192px)");
    game.advance(1);
    assert.equal(game.controller.snapshot().phase, "falling");
    assert.equal(game.controller.snapshot().elapsedMs, 0);
    assert.equal(game.element("gravityAdjectivePreviewLabel").hidden, true);
    game.answer();
    assert.equal(game.attempts.length, 1);
    assert.equal(game.attempts[0].correct, true);
    game.advance(180);
    game.advance(900);
    continueFromRecap(game);
    assert.equal(game.controller.snapshot().step, "meaning");
    assert.equal(game.controller.snapshot().index, 1);
    assert.equal(game.controller.snapshot().correctCount, 1);
    game.controller.destroy();
  });
}

test("a wrong meaning shakes and reveals the correction, then retries without skipping to adjectives", async () => {
  const game = await mountGame({ meaningThenForm: true });
  const flight = game.controller.snapshot().current;
  game.answer(flight.meaningOptions.find((meaning) => meaning !== flight.anchorMeaning));
  game.advance(180);
  assert.equal(game.arena.dataset.state, "wrong");
  assert.equal(game.element("gravityAdjectiveMeaning").textContent, flight.anchorMeaning);
  game.advance(2399);
  assert.equal(game.controller.snapshot().phase, "feedback");
  game.advance(1);
  assert.equal(game.controller.snapshot().step, "meaning");
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.equal(game.controller.snapshot().elapsedMs, 0);
  assert.equal(game.element("gravityAdjectiveMeaning").textContent, "");
  assert.equal(game.attempts.length, 0);
  game.answer();
  game.advance(180);
  game.advance(900);
  game.advance(4000);
  game.answer();
  assert.equal(game.attempts.length, 1);
  assert.equal(game.attempts[0].meaningRetries, 1);
  assert.equal(game.attempts[0].correct, false, "a corrected retry does not earn first-try credit");
  game.controller.destroy();
});

test("sequence retains each mistake while meaning retries and gender and adjective errors move forward", async () => {
  const game = await mountGame({ meaningThenForm: true, practiceMode: "sequence" });
  const first = game.controller.snapshot().current;
  assertMistakes(game, []);
  game.answer(first.meaningOptions.find((meaning) => meaning !== first.anchorMeaning));
  game.advance(180);
  assertMistakes(game, ["meaning"]);
  game.advance(2400);
  assert.equal(game.controller.snapshot().current, first);
  assert.equal(game.controller.snapshot().step, "meaning");
  assert.equal(game.controller.snapshot().elapsedMs, 0);
  assert.equal(game.attempts.length, 0);
  assertMistakes(game, ["meaning"]);

  game.answer();
  game.advance(180);
  game.advance(900);
  assert.equal(game.controller.snapshot().step, "category");
  assert.equal(game.controller.snapshot().current, first);
  assertMistakes(game, ["meaning"]);
  game.answer(first.categoryOptions.find(({ id }) => id !== first.categoryId).id);
  game.advance(180);
  assert.equal(game.element("gravityAdjectiveMeaning").textContent,
    `${first.anchorMeaning} · ${first.categoryOptions.find(({ id }) => id === first.categoryId).label}`);
  assertMistakes(game, ["meaning", "category"]);
  game.advance(2399);
  assert.equal(game.controller.snapshot().phase, "feedback");
  game.advance(1);
  assert.equal(game.controller.snapshot().step, "form");
  assert.equal(game.controller.snapshot().phase, "preview");
  assert.equal(game.controller.snapshot().current, first);
  assert.equal(game.controller.snapshot().meaningRetries, 2);
  assert.equal(game.attempts.length, 0, "a gender error cannot award or finish the noun before the adjective");
  assertMistakes(game, ["meaning", "category"]);

  game.advance(4000);
  game.answer(first.options.find((form) => form !== first.answer));
  game.advance(180);
  assertMistakes(game, ["meaning", "category", "form"]);
  assert.equal(game.attempts.length, 1);
  assert.equal(game.attempts[0].correct, false);
  assert.equal(game.attempts[0].meaningRetries, 2);
  game.advance(2400);
  assertMistakes(game, ["meaning", "category", "form"]);
  continueFromRecap(game);
  assert.equal(game.controller.snapshot().index, 1);
  assert.notEqual(game.controller.snapshot().current, first);
  assert.equal(game.controller.snapshot().step, "meaning");
  assert.equal(game.controller.snapshot().correctCount, 0);
  assertMistakes(game, []);
  game.controller.destroy();
});

test("a corrected meaning or gender mistake never earns clean sequence credit", async () => {
  for (const mistakenStage of ["meaning", "category"]) {
    const game = await mountGame({ meaningThenForm: true, practiceMode: "sequence" });
    const first = game.controller.snapshot().current;
    if (mistakenStage === "meaning") {
      game.answer(first.meaningOptions.find((meaning) => meaning !== first.anchorMeaning));
      game.advance(180);
      game.advance(2400);
    }
    game.answer();
    game.advance(180);
    game.advance(900);
    game.answer(mistakenStage === "category" ? first.categoryOptions.find(({ id }) => id !== first.categoryId).id : undefined);
    game.advance(180);
    game.advance(mistakenStage === "category" ? 2400 : 900);
    assert.equal(game.controller.snapshot().phase, "preview");
    assertMistakes(game, [mistakenStage]);
    game.advance(4000);
    game.answer();
    assert.equal(game.attempts.length, 1);
    assert.equal(game.attempts[0].correct, false);
    assert.equal(game.attempts[0].meaningRetries, 1);
    assert.equal(game.controller.snapshot().correctCount, 0);
    game.controller.destroy();
  }
});

test("standalone meaning retries the same noun until correct and records just one non-clean attempt", async () => {
  const game = await mountGame({ meaningThenForm: true, practiceMode: "meaning" });
  const first = game.controller.snapshot().current;
  for (let retry = 0; retry < 2; retry += 1) {
    game.answer(first.meaningOptions.find((meaning) => meaning !== first.anchorMeaning));
    game.advance(180);
    assertMistakes(game, ["meaning"]);
    game.advance(2400);
    assert.equal(game.controller.snapshot().current, first);
    assert.equal(game.controller.snapshot().phase, "falling");
    assert.equal(game.attempts.length, 0);
  }
  game.answer();
  assert.equal(game.attempts.length, 1);
  assert.equal(game.attempts[0].correct, false);
  assert.equal(game.attempts[0].meaningRetries, 2);
  game.advance(180);
  game.advance(900);
  assert.equal(game.controller.snapshot().index, 1);
  assertMistakes(game, []);
  game.controller.destroy();
});

test("gender timeout keeps the same noun for adjective practice without recording an early attempt", async () => {
  const game = await mountGame({ meaningThenForm: true, practiceMode: "sequence" });
  const first = game.controller.snapshot().current;
  game.answer();
  game.advance(180);
  game.advance(900);
  game.advance(10000);
  game.advance(180);
  assertMistakes(game, ["category"]);
  assert.equal(game.attempts.length, 0);
  game.advance(2400);
  assert.equal(game.controller.snapshot().current, first);
  assert.equal(game.controller.snapshot().step, "form");
  assert.equal(game.controller.snapshot().phase, "preview");
  assertMistakes(game, ["category"]);
  game.advance(4000);
  game.answer();
  assert.equal(game.attempts.length, 1);
  assert.equal(game.attempts[0].correct, false);
  assert.equal(game.attempts[0].meaningRetries, 1);
  assert.equal(game.controller.snapshot().correctCount, 0);
  game.controller.destroy();
});

test("sequence meaning timeout still skips an unanswered noun rather than creating an unattended retry loop", async () => {
  const game = await mountGame({ meaningThenForm: true, practiceMode: "sequence" });
  game.advance(10000);
  game.advance(180);
  assertMistakes(game, ["meaning"]);
  assert.equal(game.attempts.length, 1);
  assert.equal(game.attempts[0].timeout, true);
  assert.equal(game.attempts[0].correct, false);
  game.advance(2400);
  assert.equal(game.controller.snapshot().index, 1);
  assert.equal(game.controller.snapshot().step, "meaning");
  assertMistakes(game, []);
  game.controller.destroy();
});

test("meaning timeout reveals once and skips to the next noun without credit or an endless retry", async () => {
  const game = await mountGame({ meaningThenForm: true });
  const first = game.controller.snapshot().current;
  game.advance(10000);
  game.advance(180);
  assert.equal(game.element("gravityAdjectiveMeaning").textContent, first.anchorMeaning);
  game.advance(2400);
  assert.equal(game.controller.snapshot().step, "meaning");
  assert.equal(game.controller.snapshot().index, 1);
  assert.equal(game.attempts.length, 1);
  assert.equal(game.attempts[0].correct, false);
  assert.equal(game.attempts[0].timeout, true);
  assert.equal(game.controller.snapshot().correctCount, 0);
  const flight = game.controller.snapshot().current;
  game.arena.dispatchEvent({ type: "keydown", key: String(flight.meaningOptions.indexOf(flight.anchorMeaning) + 1) });
  assert.equal(game.controller.snapshot().phase, "landing");
  game.advance(180);
  game.advance(900);
  game.advance(4000);
  game.arena.dispatchEvent({ type: "keydown", key: String(flight.options.indexOf(flight.answer) + 1) });
  assert.equal(game.controller.snapshot().phase, "landing");
  assert.equal(game.attempts.length, 2);
  assert.equal(game.attempts[1].correct, true);
  game.controller.destroy();
});

test("sequence speaks once at each step start, with silent answer feedback and no preview repeat", async () => {
  const game = await mountGame({ meaningThenForm: true, practiceMode: "sequence", speech: true, autoplay: true });
  const first = game.controller.snapshot().current;
  game.advance(100);
  await settleSpeech();
  assert.deepEqual(game.speechCalls, [first.anchorText]);
  for (const [index, nextStep] of ["category", "form"].entries()) {
    game.answer();
    game.advance(180);
    await settleSpeech();
    assert.equal(game.speechCalls.length, index + 1, "answer selection must not speak");
    game.advance(900);
    game.advance(100);
    await settleSpeech();
    assert.equal(game.controller.snapshot().step, nextStep);
    assert.equal(game.speechCalls.length, index + 2, "only the incoming step speaks");
  }
  game.advance(4000);
  await settleSpeech();
  assert.deepEqual(game.speechCalls, [first.anchorText, first.anchorText, first.anchorText]);
  game.answer();
  game.advance(180);
  await settleSpeech();
  assert.equal(game.speechCalls.length, 3, "the final adjective answer is also silent");
  game.advance(900);
  assert.equal(game.speechCalls.length, 3, "the recap does not add automatic pronunciation");
  continueFromRecap(game);
  game.advance(100);
  await settleSpeech();
  assert.equal(game.speechCalls.length, 4);
  assert.equal(game.speechCalls.at(-1), game.controller.snapshot().current.anchorText);
  game.controller.destroy();
});

test("wrong answers stay silent until the retry prompt starts", async () => {
  const game = await mountGame({ meaningThenForm: true, practiceMode: "sequence", speech: true, autoplay: true });
  const first = game.controller.snapshot().current;
  game.advance(100);
  await settleSpeech();
  game.answer(first.meaningOptions.find((option) => option !== first.anchorMeaning));
  game.advance(180);
  game.advance(500);
  await settleSpeech();
  assert.deepEqual(game.speechCalls, [first.anchorText]);
  game.advance(1900);
  game.advance(100);
  await settleSpeech();
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.equal(game.controller.snapshot().step, "meaning");
  assert.deepEqual(game.speechCalls, [first.anchorText, first.anchorText]);
  game.controller.destroy();
});

test("two-step autoplay does not reveal an adjective during noun practice", async () => {
  const game = await mountGame({ meaningThenForm: true, speech: true, autoplay: true });
  const flight = game.controller.snapshot().current;
  game.advance(100);
  await settleSpeech();
  game.answer();
  game.advance(180);
  await settleSpeech();
  assert.ok(game.speechCalls.every((text) => text === flight.anchorText));
  game.advance(900);
  game.advance(100);
  await settleSpeech();
  assert.equal(game.speechCalls.at(-1), flight.anchorText);
  const calls = game.speechCalls.length;
  game.advance(3900);
  await settleSpeech();
  assert.equal(game.speechCalls.length, calls, "starting gravity must not repeat the preview pronunciation");
  game.answer();
  game.advance(180);
  await settleSpeech();
  assert.equal(game.speechCalls.length, calls, "answer feedback must not add automatic pronunciation");
  game.controller.destroy();
});

test("six meaning choices are distinct, include the answer, and support the sixth keyboard shortcut", async () => {
  const game = await mountGame({ meaningThenForm: true });
  game.advance(1000);
  assert.equal(game.controller.setMeaningOptionCount(6), true);
  const flight = game.controller.snapshot().current;
  assert.equal(flight.meaningOptions.length, 6);
  assert.equal(new Set(flight.meaningOptions).size, 6);
  assert.ok(flight.meaningOptions.includes(flight.anchorMeaning));
  assert.equal(game.arena.dataset.meaningCount, "6");
  assert.equal(game.controller.snapshot().elapsedMs, 0);
  assert.equal(game.element("gravityAdjectiveChoices").children.length, 6);
  game.arena.dispatchEvent({ type: "keydown", key: "6" });
  assert.equal(game.controller.snapshot().phase, "landing");
  assert.equal(game.attempts.length, 0);
  assert.equal(game.controller.setMeaningOptionCount(4), false);
  game.controller.setMeaningOptionCount(3);
  assert.equal(game.controller.snapshot().current.meaningOptions.length, 3);
  game.controller.destroy();
});

for (const duration of [5000, 10000, 15000, 20000]) {
  for (const practiceMode of ["sequence", "forms"]) {
    test(`${practiceMode} gives adjectives twice the ${duration}ms setting without extending earlier steps`, async () => {
      const game = await mountGame({ meaningThenForm: true, practiceMode });
      game.controller.setDurationMs(duration);
      const clock = game.element("gravityNounClock");
      if (practiceMode === "sequence") {
        for (const step of ["meaning", "category"]) {
          assert.equal(game.controller.snapshot().step, step);
          assert.equal(game.controller.snapshot().stepDurationMs, duration);
          assert.equal(clock.getAttribute("aria-valuemax"), String(duration / 1000));
          game.advance(duration - 1);
          assert.equal(game.controller.snapshot().phase, "falling");
          game.answer();
          game.advance(180);
          game.advance(900);
        }
      }
      assert.equal(game.controller.snapshot().phase, "preview");
      assert.equal(game.controller.snapshot().stepDurationMs, duration * 2);
      assert.equal(clock.getAttribute("aria-valuemax"), String(duration * 2 / 1000));
      game.advance(4000);
      assert.equal(game.controller.snapshot().elapsedMs, 0, "warm-up is separate from answering time");
      game.advance(duration * 2 - 1);
      assert.equal(game.controller.snapshot().phase, "falling");
      assert.equal(clock.getAttribute("aria-valuenow"), "1");
      game.advance(1);
      assert.equal(game.controller.snapshot().phase, "landing");
      assert.equal(game.attempts.length, 1);
      assert.equal(game.attempts[0].timeout, true);
      game.controller.destroy();
    });
  }
}

test("the parachute follows the falling card without changing timing or covering the toolbar", async () => {
  const game = await mountGame({ meaningThenForm: true, practiceMode: "sequence" });
  const parachute = game.element("gravityAdjectiveParachute");
  parachute.offsetHeight = 96;
  game.window.dispatchEvent({ type: "resize" });
  assert.equal(parachute.hidden, false);
  assert.equal(game.element("gravityAdjectiveDrop").style.transform, "translateY(122px)");
  game.advance(1000);
  const elapsed = game.controller.snapshot().elapsedMs;
  game.controller.setIconsVisible(false);
  assert.equal(parachute.hidden, true);
  game.controller.setIconsVisible(true);
  assert.equal(parachute.hidden, false);
  assert.equal(game.controller.snapshot().elapsedMs, elapsed);
  for (const step of ["meaning", "category", "form"]) {
    assert.equal(game.controller.snapshot().step, step);
    if (step === "form") {
      assert.equal(parachute.hidden, true, "warm-up stays uncluttered");
      game.advance(4000);
      assert.equal(parachute.hidden, false);
      assert.equal(game.controller.snapshot().stepDurationMs, 20000);
    }
    game.answer();
    assert.equal(parachute.dataset.motion, "landing");
    game.advance(180);
    assert.equal(parachute.hidden, true);
    game.advance(900);
  }
  assert.equal(game.controller.snapshot().phase, "recap");
  assert.equal(parachute.hidden, true);
  game.controller.destroy();
});

test("compact arenas omit the parachute when it would overlap the toolbar", async () => {
  const game = await mountGame();
  const parachute = game.element("gravityAdjectiveParachute");
  parachute.offsetHeight = 108;
  game.element("gravityAdjectiveChoices").offsetTop = 156;
  game.window.dispatchEvent({ type: "resize" });
  assert.equal(parachute.hidden, true);
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.equal(game.element("gravityAdjectiveDrop").style.transform, "translateY(38px)");
  game.controller.destroy();
});

test("the preview pauses offscreen and rejects hidden answer input without using the fall timer", async () => {
  const game = await mountGame({ meaningThenForm: true });
  game.answer();
  game.advance(180);
  game.advance(900);
  game.advance(500);
  assert.equal(game.controller.snapshot().phase, "preview");
  assert.equal(game.attempts.length, 0);
  game.document.hidden = true;
  game.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(game.frames.size, 0);
  game.arena.dispatchEvent({ type: "keydown", key: "1" });
  game.option().click();
  assert.equal(game.attempts.length, 0);
  assert.equal(game.controller.snapshot().phase, "preview");
  game.document.hidden = false;
  game.document.dispatchEvent({ type: "visibilitychange" });
  game.frame(20000);
  assert.equal(game.controller.snapshot().previewMs, 500);
  game.controller.setActive(false);
  assert.equal(game.frames.size, 0);
  game.controller.setActive(true);
  game.frame(40000);
  game.advance(3500);
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.equal(game.controller.snapshot().elapsedMs, 0);
  game.controller.destroy();
});

for (const input of ["click", "keyboard"]) {
  test(`the preview accepts a ${input} answer with the same ellipsis hint as the fall`, async () => {
    const game = await mountGame({ practiceMode: "forms" });
    assert.equal(game.controller.snapshot().phase, "preview");
    assert.match(game.element("gravityAdjectivePrompt").textContent, /…$/u);
    const current = game.controller.snapshot().current;
    const choice = input === "click" ? current.answer : current.options.find((form) => form !== current.answer);
    assert.equal(game.option(choice).disabled, false);
    if (input === "click") game.option(choice).click();
    else game.arena.dispatchEvent({ type: "keydown", key: String(current.options.indexOf(choice) + 1) });
    assert.equal(game.controller.snapshot().phase, "landing");
    assert.equal(game.attempts.length, 1);
    assert.equal(game.attempts[0].correct, input === "click");
    game.advance(180);
    game.advance(input === "click" ? 900 : 2400);
    assert.equal(game.controller.snapshot().phase, "recap");
    assert.equal(game.arena.dataset.formResult, input === "click" ? "correct" : "wrong");
    assert.equal(game.element("gravityAdjectiveRecapHint"), null);
    assert.equal(game.element("gravityAdjectiveFeedback").textContent, current.targetText);
    assert.equal(game.frames.size, 0, "the preview countdown stops after an early answer");
    assert.equal(game.attempts.length, 1);
    game.controller.destroy();
  });
}

test("the adjective introduction is centered below the in-arena header before falling from beneath it", async () => {
  const game = await mountGame({ meaningThenForm: true, practiceMode: "sequence" });
  const header = game.element("gravityGameHeader") || game.document.createElement("header");
  header.id = "gravityGameHeader";
  header.offsetTop = 12;
  header.offsetHeight = 88;
  game.arena.append(header);
  game.controller.setDurationMs(0);
  assert.equal(game.element("gravityAdjectiveDrop").style.transform, "translateY(112px)",
    "the falling card reserves room for the controls, clock and step labels");
  for (let step = 0; step < 2; step += 1) {
    game.answer();
    game.advance(180);
    game.advance(900);
  }
  assert.equal(game.controller.snapshot().phase, "preview");
  assert.equal(game.element("gravityAdjectiveDrop").style.transform, "translateY(229px)",
    "the introduction is centered between the header and the options divider");
  game.advance(3999);
  assert.equal(game.element("gravityAdjectiveDrop").style.transform, "translateY(229px)");
  assert.equal(game.controller.snapshot().elapsedMs, 0);
  game.advance(1);
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.equal(game.element("gravityAdjectiveDrop").style.transform, "translateY(112px)");
  game.controller.setDurationMs(10000);
  game.advance(5000);
  assert.equal(game.element("gravityAdjectiveDrop").style.transform, "translateY(170.5px)");
  game.answer();
  game.advance(180);
  assert.equal(game.element("gravityAdjectiveDrop").style.transform, "translateY(346px)",
    "moving the header inside does not move the final landing beyond the divider");
  game.controller.destroy();
});

test("leaving every meaning unanswered finishes the segment with one failed attempt per noun", async () => {
  const game = await mountGame({ meaningThenForm: true });
  for (let index = 0; index < game.flights.length; index += 1) {
    assert.equal(game.controller.snapshot().index, index);
    game.advance(10000);
    game.advance(180);
    game.advance(2400);
  }
  assert.equal(game.controller.snapshot().phase, "complete");
  assert.equal(game.attempts.length, game.flights.length);
  assert.ok(game.attempts.every(({ correct, timeout }) => !correct && timeout));
  assert.equal(game.completions.length, 1);
  assert.equal(game.completions[0].correctCount, 0);
  assert.equal(game.frames.size, 0);
  game.controller.destroy();
});

test("the card speaker reads the noun before an answer and the full phrase after it without pausing", async () => {
  const game = await mountGame({ speech: true });
  const flight = game.controller.snapshot().current;
  const speaker = game.element("gravityAdjectiveSpeak");
  assert.equal(speaker.hidden, false);
  assert.equal(speaker.disabled, false);
  speaker.dispatchEvent({ type: "keydown", key: "1", bubbles: true });
  assert.equal(game.attempts.length, 0);
  speaker.click();
  await settleSpeech();
  assert.deepEqual(game.speechCalls, [flight.anchorText]);
  game.advance(1000);
  assert.equal(game.controller.snapshot().elapsedMs, 1000);
  game.answer();
  assert.equal(speaker.disabled, true);
  game.advance(180);
  assert.equal(speaker.disabled, false);
  speaker.click();
  await settleSpeech();
  assert.deepEqual(game.speechCalls, [flight.anchorText, flight.targetText]);
  game.speechState.muted = true;
  game.window.dispatchEvent({ type: "caatuu:speech-mute-change" });
  assert.equal(speaker.disabled, true);
  speaker.click();
  await settleSpeech();
  assert.equal(game.speechCalls.length, 2);
  game.controller.destroy();
});

test("adjective autoplay fires once per visible prompt, never on its result, and respects hidden, mute, and disabled autoplay", async () => {
  const game = await mountGame({ speech: true, autoplay: true, active: false });
  assert.equal(game.speechCalls.length, 0);
  game.controller.setActive(true);
  game.advance(100);
  await settleSpeech();
  const first = game.controller.snapshot().current;
  assert.deepEqual(game.speechCalls, [first.anchorText]);
  game.advance(100);
  await settleSpeech();
  assert.equal(game.speechCalls.length, 1);
  game.controller.setActive(false);
  assert.equal(game.element("gravityAdjectiveSpeak").disabled, true);
  game.controller.setActive(true);
  game.advance(100);
  await settleSpeech();
  assert.equal(game.speechCalls.length, 1);
  game.advance(3700);
  assert.equal(game.controller.snapshot().phase, "falling");
  game.answer();
  game.advance(180);
  await settleSpeech();
  assert.deepEqual(game.speechCalls, [first.anchorText]);
  game.speechState.muted = true;
  game.window.dispatchEvent({ type: "caatuu:speech-mute-change" });
  game.advance(900);
  continueFromRecap(game);
  game.advance(100);
  await settleSpeech();
  assert.equal(game.speechCalls.length, 1);
  game.speechState.autoplay = false;
  game.window.dispatchEvent({ type: "caatuu:speech-autoplay-change" });
  game.speechState.muted = false;
  game.window.dispatchEvent({ type: "caatuu:speech-mute-change" });
  game.advance(100);
  await settleSpeech();
  assert.equal(game.speechCalls.length, 1);
  game.controller.destroy();
});

for (const language of ["czech", "spanish"]) {
  test(language + " starts an authored adjective flight without recording credit", async () => {
    const game = await mountGame({ language });
    const state = game.controller.snapshot();
    assert.equal(state.phase, "falling");
    assert.equal(state.total, game.flights.length);
    assert.equal(state.durationMs, 10000);
    const placeholder = game.element("gravityAdjectivePrompt").textContent;
    assert.ok(placeholder.endsWith("…") || placeholder === "\u00a0");
    assert.equal(game.element("gravityAdjectiveNoun").textContent,
      state.current.beforeText + placeholder + state.current.afterText);
    assert.equal(game.element("gravityAdjectiveMeaning").textContent, state.current.learnerBaseText);
    assert.equal(game.element("gravityAdjectiveNoun").lang, game.course.targetLanguage.locale);
    assert.equal(game.element("gravityAdjectiveMeaning").lang, "en");
    assert.equal(game.element("gravityAdjectiveChoices").children.length, state.current.options.length);
    assert.equal(game.attempts.length, 0);
    assert.equal(game.completions.length, 0);
    assert.equal(game.frames.size, 1);
    assert.equal(game.visuals.updates[0].id, state.current.id);
    game.controller.destroy();
  });
}

test("a correct choice lands for180ms then joins the authored phrase for900ms", async () => {
  const game = await mountGame();
  const first = game.controller.snapshot().current;
  game.answer();
  assert.equal(game.controller.snapshot().phase, "landing");
  assert.equal(game.attempts.length, 1);
  assert.equal(game.attempts[0].correct, true);
  assert.equal(game.attempts[0].timeout, false);
  assert.equal(game.attempts[0].flight, first);
  game.option().click();
  game.controller.next();
  assert.equal(game.attempts.length, 1, "repeated activation never awards twice");
  game.advance(179);
  assert.equal(game.controller.snapshot().phase, "landing");
  game.advance(1);
  assert.equal(game.controller.snapshot().phase, "feedback");
  assert.equal(game.element("gravityAdjectiveDrop").hidden, false);
  assert.equal(game.element("gravityAdjectiveDrop").style.transform, "translateY(346px)",
    "the full phrase lands exactly at the options divider");
  assert.equal(game.element("gravityAdjectiveNoun").textContent, first.targetText);
  assert.ok(game.element("gravityAdjectiveNoun").querySelector(".gravity-adjective-ending"));
  assert.equal(game.arena.dataset.state, "correct");
  game.advance(899);
  assert.equal(game.controller.snapshot().current.id, first.id);
  game.advance(1);
  continueFromRecap(game);
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.equal(game.controller.snapshot().index, 1);
  assert.equal(game.controller.snapshot().correctCount, 1);
  assert.equal(game.element("gravityAdjectiveDrop").hidden, false);
  game.controller.destroy();
});

test("wrong choices retain the full2400ms correction without success credit", async () => {
  const game = await mountGame();
  const first = game.controller.snapshot().current;
  game.answer(first.options.find((form) => form !== first.answer));
  game.advance(180);
  assert.equal(game.arena.dataset.state, "wrong");
  assert.equal(game.element("gravityAdjectiveNoun").textContent, first.targetText);
  assert.equal(game.attempts[0].correct, false);
  assert.equal(game.attempts[0].timeout, false);
  game.advance(2399);
  assert.equal(game.controller.snapshot().phase, "feedback");
  game.advance(1);
  assert.equal(game.arena.dataset.formResult, "wrong");
  continueFromRecap(game);
  assert.equal(game.controller.snapshot().index, 1);
  assert.equal(game.controller.snapshot().correctCount, 0);
  assert.equal(game.arena.dataset.formResult, undefined);
  game.controller.destroy();
});

test("timeout records once, shows the correct phrase, and continues without stealing focus", async () => {
  const game = await mountGame();
  game.document.body.focus();
  game.advance(20000);
  assert.equal(game.controller.snapshot().phase, "landing");
  assert.equal(game.attempts.length, 1);
  assert.equal(game.attempts[0].timeout, true);
  assert.equal(game.attempts[0].correct, false);
  game.advance(180);
  assert.match(game.element("gravityAdjectiveFeedback").textContent, /^Time:/);
  game.advance(2400);
  assert.equal(game.document.activeElement, game.document.body, "an unattended recap does not steal focus");
  assert.equal(game.arena.dataset.formResult, "wrong");
  continueFromRecap(game);
  assert.equal(game.controller.snapshot().phase, "falling");
  assert.equal(game.document.activeElement, game.arena);
  assert.equal(game.attempts.length, 1);
  game.controller.destroy();
});

for (const stage of ["meaning", "category", "form"]) {
  test(`${stage} timeout reveals the correction without success credit`, async () => {
    const game = await mountGame({ practiceMode: "sequence" });
    while (game.controller.snapshot().step !== stage) {
      game.answer();
      game.advance(180);
      game.advance(900);
    }
    if (game.controller.snapshot().phase === "preview") game.advance(4000);
    const unanswered = game.element("gravityAdjectiveNoun").textContent;
    game.advance(game.controller.snapshot().stepDurationMs);
    assert.equal(game.arena.dataset.state, "wrong");
    assert.equal(game.element("gravityAdjectiveNoun").textContent, unanswered,
      "landing without an answer must not fill in a form as if the learner selected it");
    assertMistakes(game, [stage]);
    const options = game.element("gravityAdjectiveChoices").querySelectorAll("button");
    for (const button of options) {
      assert.equal(button.disabled, true);
      assert.equal(button.classList.contains("is-correct"), false);
      assert.equal(button.classList.contains("is-wrong"), false);
    }
    game.advance(180);
    assert.equal(game.arena.dataset.state, "wrong");
    const feedback = game.element("gravityAdjectiveFeedback");
    assert.equal(feedback.classList.contains("gravity-visually-hidden"), true);
    assert.match(feedback.textContent, /^Time:/);
    const flight = game.controller.snapshot().current;
    const answer = stage === "meaning" ? flight.anchorMeaning : stage === "category" ? flight.categoryId : flight.answer;
    for (const button of options) {
      const value = stage === "meaning" ? button.dataset.nounMeaning
        : stage === "category" ? button.dataset.grammarCategory : button.dataset.grammarForm;
      assert.equal(button.classList.contains("is-correct"), value === answer);
      assert.equal(button.disabled, true);
    }
    if (stage === "category") {
      game.advance(2400);
      game.advance(4000);
      game.answer();
    }
    assert.equal(game.attempts.length, 1);
    assert.equal(game.attempts[0].correct, false, "an unanswered step cannot earn success credit");
    assert.equal(game.controller.snapshot().correctCount, 0);
    game.controller.destroy();
  });
}

test("completed flights emit a single completion and stop scheduling frames", async () => {
  const game = await mountGame();
  for (let index = 0; index < game.flights.length; index += 1) {
    game.answer();
    game.advance(180);
    game.advance(900);
    assert.equal(game.arena.dataset.formResult, "correct");
    continueFromRecap(game);
  }
  assert.equal(game.controller.snapshot().phase, "complete");
  assert.equal(game.attempts.length, game.flights.length);
  assert.equal(game.completions.length, 1);
  assert.equal(game.completions[0].correctCount, game.flights.length);
  assert.equal(game.completions[0].total, game.flights.length);
  assert.equal(game.frames.size, 0);
  game.controller.next();
  game.controller.setActive(true);
  assert.equal(game.completions.length, 1);
  assert.equal(game.frames.size, 0);
  game.controller.destroy();
});

for (const language of ["czech", "spanish"]) {
  test(language + " consolidates the authored phrase, meaning and gender until Next word", async () => {
    const game = await mountGame({ language, meaningThenForm: true, practiceMode: "sequence", speech: true, autoplay: true });
    const first = game.controller.snapshot().current;
    for (let step = 0; step < 2; step += 1) {
      game.answer();
      game.advance(180);
      game.advance(900);
    }
    game.advance(4000);
    await settleSpeech();
    game.answer(first.options.find((form) => form !== first.answer));
    game.advance(180);
    game.advance(2400);
    await settleSpeech();
    assert.equal(game.controller.snapshot().phase, "recap");
    assert.equal(game.controller.snapshot().current, first);
    assert.equal(game.arena.dataset.state, "recap");
    assert.equal(game.element("gravityAdjectiveNoun").textContent, first.targetText);
    assert.equal(game.element("gravityAdjectiveMeaning").textContent, first.learnerBaseText);
    assert.equal(game.element("gravityAdjectivePreviewLabel").hidden, true);
    assert.equal(game.element("gravityAdjectivePreviewLabel").textContent, "");
    assert.equal(game.element("gravityAdjectiveRecapAnswers"), null);
    assert.equal(game.element("gravityAdjectiveContext").hidden, false);
    assert.equal(game.element("gravityAdjectiveContext").textContent,
      first.categoryOptions.find(({ id }) => id === first.categoryId).label);
    assert.equal(game.element("gravityAdjectiveNext").textContent, "Next");
    assert.equal(game.element("gravityAdjectiveVisual").parentElement, game.element("gravityAdjectiveDrop"));
    assert.equal(game.element("gravityAdjectiveVisual").getAttribute("aria-hidden"), "true");
    game.controller.setIconsVisible(false);
    assert.equal(game.element("gravityAdjectiveVisual").hidden, true);
    game.controller.setIconsVisible(true);
    assert.equal(game.element("gravityAdjectiveVisual").hidden, false);
    assertMistakes(game, ["form"]);
    assert.equal(game.frames.size, 0);
    assert.equal(game.completions.length, 0);
    assert.equal(game.attempts.length, 1);
    assert.equal(game.document.activeElement, game.element("gravityAdjectiveNext"));
    assert.equal(game.element("gravityAdjectiveDrop").style.transform, "translateY(223px)");
    game.arena.dispatchEvent({ type: "keydown", key: "1" });
    game.option().click();
    assert.equal(game.controller.snapshot().phase, "recap", "answer shortcuts do not dismiss the review");
    const calls = game.speechCalls.length;
    game.element("gravityAdjectiveSpeak").click();
    await settleSpeech();
    assert.equal(game.speechCalls.length, calls + 1);
    assert.equal(game.speechCalls.at(-1), first.targetText, "manual replay reads the consolidated full phrase");
    game.controller.setActive(false);
    assert.equal(game.element("gravityAdjectiveNext").disabled, true);
    game.controller.next();
    assert.equal(game.controller.snapshot().current, first);
    game.controller.setActive(true);
    game.document.hidden = true;
    game.document.dispatchEvent({ type: "visibilitychange" });
    assert.equal(game.element("gravityAdjectiveNext").disabled, true);
    game.document.hidden = false;
    game.document.dispatchEvent({ type: "visibilitychange" });
    assert.equal(game.frames.size, 0, "returning to review does not restart the fall");
    continueFromRecap(game);
    game.element("gravityAdjectiveNext").click();
    assert.equal(game.controller.snapshot().index, 1, "a double click cannot skip another word");
    assert.equal(game.controller.snapshot().step, "meaning");
    assert.equal(game.attempts.length, 1, "review and replay cannot duplicate learning credit");
    assertMistakes(game, []);
    assert.equal(game.element("gravityAdjectiveRecap").hidden, true);
    assert.equal(game.element("gravityAdjectiveChoices").hidden, false);
    assert.equal(game.element("gravityAdjectiveVisual").parentElement, game.arena, "the next word restores the stage-specific illustration position");
    game.controller.destroy();
  });
}

test("restarting a game during recap clears it and restores the four-second preview", async () => {
  const game = await mountGame({ meaningThenForm: true, practiceMode: "forms" });
  game.advance(3999);
  assert.equal(game.controller.snapshot().phase, "preview");
  assert.equal(game.controller.snapshot().elapsedMs, 0);
  game.advance(1);
  game.answer();
  game.advance(180);
  game.advance(900);
  assert.equal(game.controller.snapshot().phase, "recap");
  game.controller.start(game.round, game.flights, { practiceMode: "forms" });
  assert.equal(game.controller.snapshot().phase, "preview");
  assert.equal(game.controller.snapshot().previewMs, 0);
  assert.equal(game.element("gravityAdjectiveRecap").hidden, true);
  assert.equal(game.element("gravityAdjectiveNext").disabled, true);
  assert.equal(game.element("gravityAdjectiveChoices").hidden, false);
  assert.equal(game.element("gravityAdjectiveVisual").parentElement, game.arena);
  game.controller.destroy();
});

test("keyboard choices work in the arena but leave outside controls and modifiers alone", async () => {
  const game = await mountGame({ language: "spanish" });
  const choiceIndex = game.controller.snapshot().current.options.indexOf(game.controller.snapshot().current.answer);
  const key = String(choiceIndex + 1);
  for (const target of [game.outsideControl, game.outsideInput]) {
    target.focus();
    const event = { type: "keydown", key, bubbles: true };
    target.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  }
  game.arena.focus();
  for (const modifier of ["ctrlKey", "altKey", "metaKey", "repeat"]) {
    game.arena.dispatchEvent({ type: "keydown", key, [modifier]: true });
  }
  assert.equal(game.attempts.length, 0);
  const event = { type: "keydown", key };
  game.arena.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(game.attempts.length, 1);
  assert.equal(game.attempts[0].correct, true);
  game.controller.destroy();
});

test("toolbar controls inside the arena do not turn settings digits into answer shortcuts", async () => {
  const game = await mountGame({ meaningThenForm: true, practiceMode: "sequence" });
  const toolbar = game.element("gravityNounControls");
  game.arena.append(toolbar);
  for (const tag of ["input", "select", "button"]) {
    const control = game.document.createElement(tag);
    toolbar.append(control);
    control.focus();
    const event = { type: "keydown", key: "1", bubbles: true };
    control.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, "settings keep their native keyboard behavior");
    assert.equal(game.controller.snapshot().phase, "falling");
    assert.equal(game.attempts.length, 0);
  }
  game.arena.dispatchEvent({ type: "keydown", key: "1" });
  assert.equal(game.controller.snapshot().phase, "landing", "the same shortcut still answers in the play area");
  game.controller.destroy();
});

test("a setting focused during answer feedback keeps focus when the next step starts", async () => {
  const game = await mountGame({ meaningThenForm: true, practiceMode: "sequence" });
  const toolbar = game.element("gravityNounControls");
  const setting = game.document.createElement("input");
  toolbar.append(setting);
  game.arena.append(toolbar);
  game.answer();
  game.advance(180);
  setting.focus();
  game.advance(900);
  assert.equal(game.controller.snapshot().step, "category");
  assert.equal(game.document.activeElement, setting,
    "moving settings into the arena must not turn their focus into play focus");
  game.controller.destroy();
});

test("automatic progress restores blurred play focus but preserves deliberate outside focus", async () => {
  const game = await mountGame();
  game.answer();
  game.document.body.focus(); // Native browsers blur a focused button when it becomes disabled.
  game.advance(180);
  game.advance(900);
  continueFromRecap(game);
  assert.equal(game.document.activeElement, game.arena);
  game.answer();
  game.outsideControl.focus();
  game.advance(180);
  game.advance(900);
  assert.equal(game.document.activeElement, game.outsideControl);
  assert.equal(game.controller.snapshot().phase, "recap");
  game.controller.destroy();
});

test("hidden and inactive games freeze motion and input without background catch-up", async () => {
  const game = await mountGame();
  game.advance(250);
  game.document.hidden = true;
  game.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(game.frames.size, 0);
  game.option().click();
  assert.equal(game.attempts.length, 0);
  game.document.hidden = false;
  game.document.dispatchEvent({ type: "visibilitychange" });
  game.frame(20000);
  game.frame(20250);
  assert.equal(game.controller.snapshot().elapsedMs, 500);
  game.controller.setActive(false);
  assert.equal(game.frames.size, 0);
  game.option().click();
  assert.equal(game.attempts.length, 0);
  game.controller.setActive(true);
  game.frame(40000);
  game.frame(40250);
  assert.equal(game.controller.snapshot().elapsedMs, 750);
  assert.equal(game.visuals.active.at(-1), true);
  game.controller.destroy();
});

test("large animation gaps are ignored and selected durations preserve the fall fraction", async () => {
  const game = await mountGame();
  game.advance(500);
  game.frame(20000);
  assert.equal(game.controller.snapshot().elapsedMs, 500);
  game.frame(20500);
  assert.equal(game.controller.snapshot().elapsedMs, 1000);
  for (const duration of [5000, 10000, 15000, 20000]) {
    assert.equal(game.controller.setDurationMs(duration), true);
    assert.equal(game.controller.snapshot().durationMs, duration);
    assert.equal(game.controller.snapshot().elapsedMs / game.controller.snapshot().stepDurationMs, 0.05);
  }
  assert.equal(game.controller.setDurationMs(7500), false);
  assert.equal(game.controller.snapshot().durationMs, 20000);
  game.controller.destroy();
});

test("the feather changes only the picture and reduced motion preserves the timer", async () => {
  const game = await mountGame({ reducedMotion: true });
  const initialPosition = game.element("gravityAdjectiveDrop").style.transform;
  game.controller.setIconsVisible(false);
  assert.equal(game.element("gravityAdjectiveVisual").hidden, true);
  game.controller.setIconsVisible(true);
  assert.equal(game.element("gravityAdjectiveVisual").hidden, false);
  assert.deepEqual(game.visuals.visible, [false, true]);
  game.advance(1000);
  assert.equal(game.element("gravityAdjectiveDrop").style.transform, initialPosition);
  assert.equal(game.controller.snapshot().elapsedMs, 1000);
  assert.equal(game.attempts.length, 0);
  game.controller.destroy();
  game.controller.destroy();
  assert.equal(game.frames.size, 0);
  assert.equal(game.motionListeners.size, 0);
  assert.equal(game.visuals.destroyed, 1);
  game.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(game.frames.size, 0);
});

for (const focusKind of ["determiner", "subject-agreement"]) {
  test(`English ${focusKind} uses Spanish meaning, number categories, and its complete authored sentence frame`, async () => {
    const game = await mountGame({ language: "english-from-spanish", practiceMode: "sequence", focusKind, speech: true });
    const first = game.controller.snapshot().current;
    assert.deepEqual(Array.from(game.controller.snapshot().steps), ["meaning", "category", "form"]);
    assert.equal(game.element("gravityAdjectiveNoun").textContent, first.anchorText);
    assert.equal(game.element("gravityAdjectiveMeaning").textContent, "");
    assert.equal(game.option().lang, "es-ES");
    assert.equal(game.option().getAttribute("aria-label"), first.anchorMeaning);
    assert.equal(game.visuals.updates[0].english, first.anchorEnglishAuditText);
    assert.notEqual(first.anchorMeaning, first.anchorEnglishAuditText);
    game.element("gravityAdjectiveSpeak").click();
    await settleSpeech();
    assert.deepEqual(game.speechCalls, [first.anchorText]);
    game.answer();
    game.advance(180);
    game.advance(900);
    assert.equal(game.controller.snapshot().step, "category");
    assert.deepEqual(Array.from(first.categoryOptions, ({ id }) => id), ["singular", "plural"]);
    assert.equal(game.element("gravityAdjectiveMeaning").textContent, first.anchorMeaning);
    assert.equal(game.option().getAttribute("aria-label"), first.categoryOptions.find(({ id }) => id === first.categoryId).label);
    game.answer();
    game.advance(180);
    game.advance(900);
    assert.equal(game.controller.snapshot().phase, "preview");
    assert.equal(game.element("gravityAdjectiveNoun").textContent, first.beforeText + game.element("gravityAdjectivePrompt").textContent + first.afterText);
    assert.equal(game.element("gravityAdjectiveMeaning").textContent, first.learnerBaseText);
    assert.equal(game.element("gravityAdjectiveMeaning").lang, "es-ES");
    assert.equal(game.element("gravityAdjectiveNoun").lang, "en-US");
    if (focusKind === "subject-agreement") {
      assert.ok(first.beforeText.startsWith("The "));
      assert.ok(first.afterText.trim(), "the predicate after the assessed verb stays in the frame");
    } else assert.equal(first.beforeText, "");
    game.advance(4000);
    game.answer();
    game.advance(180);
    assert.equal(game.element("gravityAdjectiveNoun").textContent, first.targetText);
    game.element("gravityAdjectiveSpeak").click();
    await settleSpeech();
    assert.equal(game.speechCalls.at(-1), first.targetText);
    game.advance(900);
    assert.equal(game.controller.snapshot().phase, "recap");
    assert.equal(game.attempts.length, 1);
    assert.equal(game.attempts[0].correct, true);
    game.controller.destroy();
  });
}

test("Spanish determiners use the same authored modern sequence", async () => {
  const game = await mountGame({ language: "spanish", practiceMode: "sequence", focusKind: "determiner" });
  const first = game.controller.snapshot().current;
  for (const stage of ["meaning", "category"]) {
    assert.equal(game.controller.snapshot().step, stage);
    game.answer();
    game.advance(180);
    game.advance(900);
  }
  assert.equal(game.controller.snapshot().step, "form");
  game.advance(4000);
  game.answer();
  game.advance(180);
  assert.equal(game.element("gravityAdjectiveNoun").textContent, first.targetText);
  assert.equal(game.attempts.length, 1);
  assert.equal(game.attempts[0].correct, true);
  game.controller.destroy();
});

test("missing modes, unknown modes, malformed flights, and undeclared stages cannot start another renderer path", async () => {
  const game = await mountGame({ practiceMode: "sequence" });
  const first = game.controller.snapshot().current;
  for (const practiceMode of [undefined, "old-matching", "form", "adjective"]) {
    assert.throws(() => game.controller.start(game.round, game.flights, { practiceMode }), /explicitly sequence, meaning, or forms/u);
  }
  assert.throws(() => game.controller.start(game.round, [], { practiceMode: "sequence" }), /authored flights/u);
  assert.throws(() => game.controller.start(game.round, [{ ...first, afterText: "" }], { practiceMode: "sequence" }), /phrase slot|anchor/u);
  assert.throws(() => game.controller.start({ ...game.round, stages: undefined }, game.flights, { practiceMode: "sequence" }), /stages/u);
  assert.throws(() => game.controller.start(game.round, [{ ...first, stages: ["form"] }], { practiceMode: "sequence" }), /match the authored round/u);
  const formsOnly = { ...first, stages: ["form"], meaningOptions: [], meaningPool: [] };
  const formsRound = { ...game.round, stages: ["form"] };
  assert.throws(() => game.controller.start(formsRound, [formsOnly], { practiceMode: "meaning" }), /authored meaning stage/u);
  assert.equal(game.controller.snapshot().current, first, "rejected starts do not silently replace the active journey");
  assert.equal(game.controller.start(formsRound, [formsOnly], { practiceMode: "sequence" }), true);
  assert.deepEqual(Array.from(game.controller.snapshot().steps), ["form"]);
  assert.equal(game.controller.snapshot().phase, "preview");
  assert.equal(game.element("gravityAdjectiveContext").textContent, first.anchorMeaning, "an omitted category stage is not inferred from its category data");
  game.controller.destroy();
});
