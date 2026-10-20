import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { afterInteractionPaint } from "../static/source/games/practice-pacing.mjs";

const source = readFileSync(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8");
const implementation = ["speechGloballyMuted", "speechPresentationActive", "targetSentenceSpeechAllowed",
  "toggleCzechSpeech", "speakCzechWithSharedService", "speakReconstructionOption",
  "selectReconstructionOption", "removeReconstructionOption"].map((name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}).join("\n");

function fixture({ answerSide = "target", speech = true, muted = false,
  available = true, locale = "cs-CZ", text = "kočka" } = {}) {
  const calls = [];
  const paints = new Map(), tasks = new Map(), renders = [];
  let serial = 0;
  const round = { answerSide, promptSide: answerSide === "target" ? "source" : "target",
    challenge: { options: [{ id: "word", text }] }, selectedIds: [] };
  const state = { reconstruction: round, translationMode: "reconstruct", speechRequestId: 0,
    loadingActive: true, loadingPageHidden: false };
  const context = vm.createContext({
    state, course: { capabilities: { speech } }, targetSpeechLocale: locale,
    window: { CaatuuChrome: { getSpeechMuted: () => muted },
      requestAnimationFrame(callback) { const id = ++serial; paints.set(id, callback); return id; },
      cancelAnimationFrame(id) { paints.delete(id); },
      setTimeout(callback) { const id = ++serial; tasks.set(id, callback); return id; },
      clearTimeout(id) { tasks.delete(id); } },
    document: {}, $: () => null, ensureReconstructionChallenge: () => round,
    guidedWordInteractionLocked: () => false, reconstructionOptionNode: () => null,
    interfaceText: () => "", renderReconstruction() { renders.push([...round.selectedIds]); }, animateReconstructionTransfer() {},
    afterInteractionPaint,
    syncSpeechControl() {}, speechControlSupported: () => available,
    czechSpeechPace: () => ({ rate: 0.6 }), preferredSpeechVoice: () => "saved-voice",
    sharedCzechSpeechApi: () => ({ speak(text, options) {
      calls.push({ text, options });
      return new Promise(() => {});
    } }),
    cancelCzechSpeech() { state.speechSession = null; state.speechState = "idle"; }
  });
  vm.runInContext(implementation, context);
  const flush = queue => { const pending = [...queue.values()]; queue.clear(); pending.forEach(callback => callback()); };
  return { calls, round, state, context, renders, paint: () => flush(paints),
    audioTask: () => flush(tasks), flushAudio() { flush(paints); flush(tasks); } };
}

for (const [locale, text] of [["cs-CZ", "kočka"], ["zh-CN", "银行"], ["en-US", "hello"]]) {
  test(`target cards speak their text using the selected ${locale} voice and pace on add and remove`, () => {
    const game = fixture({ locale, text });
    game.context.selectReconstructionOption("word");
    assert.deepEqual(game.round.selectedIds, ["word"]);
    assert.deepEqual(game.renders, [["word"]], "the selected answer is rendered in the click handler");
    assert.equal(game.calls.length, 0, "audio must yield to the selected-state paint");
    game.paint();
    assert.equal(game.calls.length, 0, "audio cannot block the animation-frame paint itself");
    game.audioTask();
    assert.equal(game.calls.length, 1);
    assert.equal(game.calls[0].text, text);
    assert.equal(game.calls[0].options.locale, locale);
    assert.equal(game.calls[0].options.rate, 0.6);
    assert.equal(game.calls[0].options.voice, "saved-voice");
    game.context.removeReconstructionOption("word");
    assert.equal(game.round.selectedIds.length, 0);
    game.flushAudio();
    assert.equal(game.calls.length, 2, "tapping the same card replays it even during speech");
    game.context.toggleCzechSpeech("The full target answer", "sentence");
    assert.equal(game.calls.length, 2, "the target sentence stays silent for a base-language prompt");
  });
}

for (const options of [{ answerSide: "source" }, { speech: false }, { muted: true }, { available: false }]) {
  test(`card movement remains available without speech: ${JSON.stringify(options)}`, () => {
    const game = fixture(options);
    game.context.selectReconstructionOption("word");
    assert.equal(game.round.selectedIds.length, 1);
    game.context.removeReconstructionOption("word");
    assert.equal(game.round.selectedIds.length, 0);
    game.flushAudio();
    assert.equal(game.calls.length, 0);
  });
}

for (const blocked of ["submitted", "evidencePending", "busy"]) {
  test(`blocked ${blocked} rounds cannot move or speak cards`, () => {
    const game = fixture();
    (blocked === "busy" ? game.state : game.round)[blocked] = true;
    game.context.selectReconstructionOption("word");
    assert.equal(game.round.selectedIds.length, 0);
    game.round.selectedIds.push("word");
    game.context.removeReconstructionOption("word");
    assert.equal(game.round.selectedIds.length, 1);
    game.flushAudio();
    assert.equal(game.calls.length, 0);
  });
}

test("a course without speech cannot preview words or sentences through the shared service", () => {
  const game = fixture({ speech: false, answerSide: "source", locale: "la", text: "Corpus movētur." });
  // A target-language prompt and hover mode would ordinarily permit sentence
  // audio; even an available service must respect the course declaration.
  game.state.translationMode = "hover";
  game.context.toggleCzechSpeech("Corpus movētur.", "sentence");
  game.context.toggleCzechSpeech("Corpus", "word");
  assert.equal(game.calls.length, 0);
});

test("rapid card changes render immediately while only the latest word reaches slow speech", () => {
  const game = fixture();
  game.round.challenge.options.push({ id: "second", text: "dům" });
  game.context.selectReconstructionOption("word");
  game.context.selectReconstructionOption("second");
  assert.deepEqual(game.round.selectedIds, ["word", "second"]);
  assert.deepEqual(game.renders, [["word"], ["word", "second"]]);
  assert.equal(game.calls.length, 0);
  game.flushAudio();
  assert.deepEqual(game.calls.map(call => call.text), ["dům"]);
  // The speech provider never resolves; removing a card must still be immediate.
  game.context.removeReconstructionOption("word");
  assert.deepEqual(game.round.selectedIds, ["second"]);
  assert.deepEqual(game.renders.at(-1), ["second"]);
});

for (const stale of ["hidden", "submitted", "replaced", "busy"]) {
  test(`queued card speech cannot start after its interaction is ${stale}`, () => {
    const game = fixture();
    game.context.selectReconstructionOption("word");
    if (stale === "hidden") game.state.loadingActive = false;
    if (stale === "submitted") game.round.submitted = true;
    if (stale === "replaced") game.state.reconstruction = {};
    if (stale === "busy") game.state.busy = true;
    game.flushAudio();
    assert.equal(game.calls.length, 0);
  });
}
