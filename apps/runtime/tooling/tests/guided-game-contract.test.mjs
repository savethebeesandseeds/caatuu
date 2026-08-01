import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../languages/czech/static/", import.meta.url);
const curriculumRoot = new URL("../../../curriculum/data/", import.meta.url);
const [app, indexHtml, wordWorld, wordWorldHtml, sourceCatalog] = await Promise.all([
  readFile(new URL("app.js", staticRoot), "utf8"),
  readFile(new URL("index.html", staticRoot), "utf8"),
  readFile(new URL("word-net.js", staticRoot), "utf8"),
  readFile(new URL("word-net.html", staticRoot), "utf8"),
  readFile(new URL("pilot-content-sources.v1.json", curriculumRoot), "utf8").then(JSON.parse)
]);

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} source boundary must exist`);
  return source.slice(start, end);
}

test("developer Guided badges disclose prototype status without leaking the answer", () => {
  for (const [html, id] of [[indexHtml, "verbGuidedStatus"], [wordWorldHtml, "wordNetGuidedStatus"]]) {
    const start = html.indexOf(`id="${id}"`);
    const end = html.indexOf("</aside>", start);
    assert.ok(start >= 0 && end > start);
    const badge = html.slice(start, end);
    assert.match(badge, /Developer Guided · prototype-not-human-approved/);
    assert.doesNotMatch(badge, /\b(?:read|číst|čte)\b/iu);
  }
});

test("developer lifecycle modules stay outside ordinary Explore startup", () => {
  const verbLoadStart = app.indexOf("async function loadContentData");
  const verbLoadEnd = app.indexOf("const state =", verbLoadStart);
  const verbGuided = functionSource(app, "initializeVerbGuidedMode", "verbGuidedInteractionLocked");
  assert.doesNotMatch(app.slice(verbLoadStart, verbLoadEnd), /guided-opportunity/);
  assert.match(verbGuided, /await import\("\.\/curriculum\/guided-opportunity\.mjs\?v=guided-opportunity-2"\)/);
  assert.doesNotMatch(wordWorld, /^import .*guided-opportunity/m);
  const wordGuided = functionSource(wordWorld, "initializeGuidedWordWorldMode", "runtimeAdapter");
  assert.match(wordGuided, /await import\("\.\/curriculum\/guided-opportunity\.mjs\?v=guided-opportunity-2"\)/);
});

test("Word World consumes the revisioned exact focus token and has no Guided random fallback", () => {
  const source = sourceCatalog.sources.find((entry) => entry.activityId === "word-world");
  assert.deepEqual(source.snapshot.focusTarget, { surface: "čte", normalized: "čte", tokenIndex: 1 });
  assert.match(wordWorld, /requireGuidedStandardTurn\(provider, state\.guidedResolution\)/);
  assert.match(wordWorld, /guidedLifecycle\s*\? selection\.target\?\.surface/);
  const guidedGenerator = functionSource(wordWorld, "generateGuidedStandardPhrase", "generateStandardFromConfiguredMode");
  assert.doesNotMatch(guidedGenerator, /selectStandardTurn|primaryWord|fallback/);
  assert.match(wordWorld, /function generateStandardFromConfiguredMode[\s\S]*?if \(state\.guidedRequested\) return;/);
  assert.match(wordWorld, /function generateFromConfiguredMode[\s\S]*?if \(state\.guidedRequested\) return;/);
});

test("Word World persists the first response and reveals before rendering any solution", () => {
  const show = functionSource(wordWorld, "showStandardPhrase", "takeQueuedRandomCandidate");
  assert.ok(show.indexOf("state.guidedLifecycle = guidedLifecycle") < show.indexOf("setTranslation(record.en)"));
  assert.ok(show.indexOf("renderCzechSentence(record.cs, target)") < show.indexOf("activatePresentedGuidedWord"));
  assert.ok(show.indexOf("setBusy(false, { immediate: true })") < show.indexOf("activatePresentedGuidedWord"));
  assert.ok(show.indexOf("activatePresentedGuidedWord") < show.indexOf("setTranslation(record.en)"));
  assert.match(show, /guidedLifecycle[\s\S]*?hideSceneAsset/, "clean retrieval must suppress the semantic scene clue");
  assert.match(wordWorld, /guidedTaskFingerprint[\s\S]*?taskFingerprint/);

  const submit = functionSource(wordWorld, "submitReconstructionChallenge", "shouldBlockReconstructionAdvance");
  assert.ok(submit.indexOf("markSolutionRevealed()") < submit.indexOf("recordFirstResponse"));
  assert.ok(submit.indexOf("await round.guidedLifecycle.recordFirstResponse") < submit.indexOf("round.submitted = true"));
  assert.ok(submit.indexOf("await round.guidedLifecycle.recordFirstResponse") < submit.lastIndexOf("renderReconstruction()"));
  assert.match(submit, /round\.evidencePending = true[\s\S]*?renderReconstruction\(\)[\s\S]*?await round\.guidedLifecycle\.recordFirstResponse/);

  const reveal = functionSource(wordWorld, "revealGuidedEnglish", "applyTranslationMode");
  assert.ok(reveal.indexOf("await lifecycle.recordSolutionReveal") < reveal.indexOf("state.translationVisible = true"));
  assert.match(reveal, /catch[\s\S]*?stayed hidden/);

  const activation = functionSource(wordWorld, "activatePresentedGuidedWord", "guidedWordInteractionLocked");
  assert.match(wordWorld, /function guidedWordPresentationReady[\s\S]*?document\.visibilityState !== "hidden"/);
  assert.match(activation, /requirePresented/);
  assert.ok(activation.indexOf("waitForPaintedFrame()") < activation.indexOf("lifecycle.activate("));
});

test("Word World records dictionary support before a cached meaning can appear and blocks task escape", () => {
  assert.match(wordWorld, /markGuidedDictionaryHint\(\)[\s\S]*?state\.wordCardPreferences\.showCard = true[\s\S]*?selectWord/);
  assert.match(wordWorld, /guidedCardAllowed[\s\S]*?guidedState\?\.hintsUsed/);
  assert.match(wordWorld, /button\.disabled = state\.busy \|\| state\.guidedRequested/);
  assert.match(wordWorld, /async function showPreviousSentence\(\) \{\s*if \(state\.guidedRequested\)/);
  assert.match(wordWorld, /function activateNextSentence\(\) \{\s*if \(state\.guidedRequested\)/);
  assert.match(wordWorld, /next\.disabled = state\.busy \|\| challengeLocked \|\| state\.guidedRequested/);
  assert.match(wordWorld, /is-curriculum-focus/);
  assert.match(wordWorld, /state\.guidedMode[\s\S]*?key === "showCard"[\s\S]*?lookupSelectedWord/);
});

test("Verb Nebula verifies raw dictionary bytes and builds one deterministic bound round", () => {
  assert.equal((app.match(/loadJsonBytes\("data\/dictionary\.json"\)/g) || []).length, 1);
  assert.match(app, /response\.arrayBuffer\(\)/);
  assert.match(app, /new TextDecoder\("utf-8", \{ fatal: true \}\)\.decode\(bytes\)/);
  assert.match(app, /countryDictionaryBytes = dictionarySource\.bytes/);
  assert.match(app, /resolveBinding\("verb-nebula", "cs\.verb\.cist\.read"\)/);
  assert.deepEqual(
    sourceCatalog.sources.find((entry) => entry.activityId === "verb-nebula")
      .snapshot.guidedContrasts.map((contrast) => contrast.conceptId),
    ["concept.action.eat", "concept.action.drink", "concept.action.sleep"]
  );
  assert.match(app, /resolvePinnedStableVerbPairs\(\s*countryDictionaryBytes,\s*resolution\.source\.catalogDigest,\s*reviewedReferences/);
  assert.match(app, /contrastPairs,[\s\S]*?taskFingerprint: `preview:\$\{resolution\.source\.contentDigest\}`/);
  assert.match(app, /taskFingerprint: lifecycle\.state\(\)\.taskFingerprint/);
  assert.match(app, /if \(state\.verbGuidedRequested\) \{[\s\S]*?state\.verbQueueIds = \[\]/);
  assert.match(app, /if \(state\.verbGuidedRequested\) \{[\s\S]*?renderVerbNebula\(\);\s*return;\s*\}/);
});

test("Verb Nebula persists target evidence before feedback and keeps support sticky", () => {
  const activate = functionSource(app, "activateVerbGuidedOpportunity", "readVerbMemory");
  assert.ok(activate.indexOf("waitForVerbPaintedFrame()") < activate.indexOf("lifecycle.activate("));
  assert.match(activate, /verbGuidedPresentationReady\(activationEpoch, lifecycle\)[\s\S]*?requirePresented/);
  assert.match(app, /document\.visibilityState !== "hidden"/);
  assert.match(app, /state\.verbGuidedActivationEpoch === epoch/);
  const settle = functionSource(app, "settleVerbMatch", "chooseVerbMatchCard");
  assert.ok(settle.indexOf("await state.verbGuidedLifecycle.recordFirstResponse") < settle.indexOf("state.verbStats.attempts += 1"));
  assert.match(settle, /czechId === state\.verbGuidedTargetId/);
  assert.match(settle, /if \(!state\.verbGuidedMode\) \{[\s\S]*?recordVerbSemanticAttempt/);

  const reveal = functionSource(app, "toggleVerbSolution", "recordVerbSemanticAttempt");
  assert.ok(reveal.indexOf("await state.verbGuidedLifecycle.recordSolutionReveal") < reveal.indexOf("state.verbSolutionRevealed = true"));
  assert.match(reveal, /if \(!state\.verbGuidedMode\) \{[\s\S]*?window\.setTimeout/);
  const hint = functionSource(app, "toggleVerbHints", "cancelVerbRoundTransition");
  assert.ok(hint.indexOf('markHint("picture-clue")') < hint.indexOf("state.verbHintsEnabled = !state.verbHintsEnabled"));
  assert.match(app, /roundComplete && !state\.verbGuidedMode/);
  assert.match(app, /verbGuidedTargetPending\(\)[\s\S]*?side === "cz"[\s\S]*?pair\.id !== state\.verbGuidedTargetId/);
  assert.match(settle, /if \(!state\.verbGuidedMode\) \{\s*window\.CaatuuLearning\?\.record/);
});
