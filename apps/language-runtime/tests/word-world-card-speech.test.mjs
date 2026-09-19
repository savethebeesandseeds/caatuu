import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../static/source/product-word-world.mjs", import.meta.url), "utf8");
const implementation = ["speechGloballyMuted", "targetSentenceSpeechAllowed",
  "toggleCzechSpeech", "speakCzechWithSharedService", "speakReconstructionOption",
  "selectReconstructionOption", "removeReconstructionOption"].map((name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}).join("\n");

function fixture({ answerSide = "target", speech = true, muted = false,
  available = true, locale = "cs-CZ", text = "kočka" } = {}) {
  const calls = [];
  const round = { answerSide, promptSide: answerSide === "target" ? "source" : "target",
    challenge: { options: [{ id: "word", text }] }, selectedIds: [] };
  const state = { reconstruction: round, translationMode: "reconstruct", speechRequestId: 0 };
  const context = vm.createContext({
    state, course: { capabilities: { speech } }, targetSpeechLocale: locale,
    window: { CaatuuChrome: { getSpeechMuted: () => muted } },
    document: {}, $: () => null, ensureReconstructionChallenge: () => round,
    guidedWordInteractionLocked: () => false, reconstructionOptionNode: () => null,
    interfaceText: () => "", renderReconstruction() {}, animateReconstructionTransfer() {},
    syncSpeechControl() {}, speechControlSupported: () => available,
    czechSpeechPace: () => ({ rate: 0.6 }), preferredSpeechVoice: () => "saved-voice",
    sharedCzechSpeechApi: () => ({ speak(text, options) {
      calls.push({ text, options });
      return new Promise(() => {});
    } }),
    cancelCzechSpeech() { state.speechSession = null; state.speechState = "idle"; }
  });
  vm.runInContext(implementation, context);
  return { calls, round, state, context };
}

for (const [locale, text] of [["cs-CZ", "kočka"], ["zh-CN", "银行"], ["en-US", "hello"]]) {
  test(`target cards speak their text using the selected ${locale} voice and pace on add and remove`, () => {
    const game = fixture({ locale, text });
    game.context.selectReconstructionOption("word");
    assert.deepEqual(game.round.selectedIds, ["word"]);
    assert.equal(game.calls.length, 1);
    assert.equal(game.calls[0].text, text);
    assert.equal(game.calls[0].options.locale, locale);
    assert.equal(game.calls[0].options.rate, 0.6);
    assert.equal(game.calls[0].options.voice, "saved-voice");
    game.context.removeReconstructionOption("word");
    assert.equal(game.round.selectedIds.length, 0);
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
    assert.equal(game.calls.length, 0);
  });
}
