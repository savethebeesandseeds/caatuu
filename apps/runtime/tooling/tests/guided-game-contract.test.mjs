import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const staticRoot = new URL("../../../languages/czech/static/", import.meta.url);
const curriculumRoot = new URL("../../../curriculum/data/", import.meta.url);
const [app, appCss, indexHtml, wordWorld, wordWorldHtml, profileSource, sourceCatalog, bindingRegistry, morphologyCatalog] = await Promise.all([
  readFile(new URL("app.js", staticRoot), "utf8"),
  readFile(new URL("app.css", staticRoot), "utf8"),
  readFile(new URL("index.html", staticRoot), "utf8"),
  readFile(new URL("word-net.js", staticRoot), "utf8"),
  readFile(new URL("word-net.html", staticRoot), "utf8"),
  readFile(new URL("course-profile.js", staticRoot), "utf8"),
  readFile(new URL("pilot-content-sources.v1.json", curriculumRoot), "utf8").then(JSON.parse),
  readFile(new URL("cs-CZ.cross-game-bindings.v1.json", curriculumRoot), "utf8").then(JSON.parse),
  readFile(new URL("cs-CZ.morphology-developer-pilot.v1.json", curriculumRoot), "utf8").then(JSON.parse)
]);

const profileContext = { window: {} };
vm.runInNewContext(profileSource, profileContext, { filename: "course-profile.js" });
const course = profileContext.window.CaatuuCourse;

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
  assert.match(verbGuided, /await import\("\.\/curriculum\/guided-opportunity\.mjs\?v=guided-opportunity-5"\)/);
  assert.doesNotMatch(wordWorld, /^import .*guided-opportunity/m);
  const wordGuided = functionSource(wordWorld, "initializeGuidedWordWorldMode", "runtimeAdapter");
  assert.match(wordGuided, /await import\("\.\/curriculum\/guided-opportunity\.mjs\?v=guided-opportunity-5"\)/);
});

test("Guided games declare their honest receptive evidence modalities", () => {
  const wordBinding = bindingRegistry.bindings.find((binding) => binding.activityId === "word-world");
  const verbBinding = bindingRegistry.bindings.find((binding) => (
    binding.exerciseFamilyId === "verb-nebula.meaning-match"
  ));
  const morphologyBinding = bindingRegistry.bindings.find((binding) => (
    binding.exerciseFamilyId === "verb-nebula.contextual-target-realization"
  ));
  const wordCapability = wordBinding.evidenceCapabilities.find((capability) => capability.scoreRequired);
  const verbCapability = verbBinding.evidenceCapabilities.find((capability) => capability.scoreRequired);
  const morphologyCapability = morphologyBinding.evidenceCapabilities.find((capability) => capability.scoreRequired);

  assert.deepEqual(wordCapability, {
    id: "independent-comprehension",
    mechanicId: "translation-reconstruction",
    learningStage: "comprehend",
    evidenceKind: "comprehension",
    independence: "independent",
    scoreRequired: true,
    masteryEligible: false,
    minimumScore: 1
  });
  assert.deepEqual(verbCapability, {
    id: "independent-discrimination",
    mechanicId: "association-grid-match",
    learningStage: "discriminate",
    evidenceKind: "comprehension",
    independence: "independent",
    scoreRequired: true,
    masteryEligible: false,
    minimumScore: 1
  });
  assert.deepEqual(morphologyCapability, {
    id: "independent-form-discrimination",
    mechanicId: "visible-form-choice",
    learningStage: "discriminate",
    evidenceKind: "comprehension",
    independence: "independent",
    scoreRequired: true,
    masteryEligible: false,
    minimumScore: 1
  });
  assert.match(wordWorld, /capabilityId: "independent-comprehension"/);
  assert.match(app, /capabilityId: familyConfiguration\.assessedCapabilityId/);
  assert.equal(
    course.curriculum.verbExerciseFamilies.families.meaning.assessedCapabilityId,
    "independent-discrimination"
  );
  assert.equal(
    course.curriculum.verbExerciseFamilies.families.morphology.assessedCapabilityId,
    "independent-form-discrimination"
  );
  assert.doesNotMatch(wordWorld, /capabilityId: "independent-retrieval"/);
  assert.doesNotMatch(app, /capabilityId: "independent-retrieval"/);
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

test("Word World persists the assessed first response and reveals before rendering any solution", () => {
  const show = functionSource(wordWorld, "showStandardPhrase", "takeQueuedRandomCandidate");
  assert.ok(show.indexOf("state.guidedLifecycle = guidedLifecycle") < show.indexOf("setTranslation(record.en)"));
  assert.ok(show.indexOf("renderCzechSentence(record.cs, target)") < show.indexOf("activatePresentedGuidedWord"));
  assert.ok(show.indexOf("setBusy(false, { immediate: true })") < show.indexOf("activatePresentedGuidedWord"));
  assert.ok(show.indexOf("activatePresentedGuidedWord") < show.indexOf("setTranslation(record.en)"));
  assert.match(show, /guidedLifecycle[\s\S]*?hideSceneAsset/, "clean comprehension must suppress the semantic scene clue");
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
  const meaningConfiguration = course.curriculum.verbExerciseFamilies.families.meaning;
  const meaningSource = sourceCatalog.sources.find((entry) => (
    entry.exerciseFamilyId === meaningConfiguration.exerciseFamilyId
  ));
  assert.equal((app.match(/loadJsonBytes\("data\/dictionary\.json"\)/g) || []).length, 1);
  assert.match(app, /response\.arrayBuffer\(\)/);
  assert.match(app, /new TextDecoder\("utf-8", \{ fatal: true \}\)\.decode\(bytes\)/);
  assert.match(app, /countryDictionaryBytes = dictionarySource\.bytes/);
  assert.equal(meaningConfiguration.stableContentId, "cs.verb.cist.read");
  assert.match(app, /resolveBinding\("verb-nebula", familyConfiguration\.stableContentId\)/);
  assert.deepEqual(
    meaningSource.snapshot.guidedContrasts.map((contrast) => contrast.conceptId),
    ["concept.action.eat", "concept.action.drink", "concept.action.sleep"]
  );
  assert.match(app, /resolvePinnedStableVerbPairs\(\s*countryDictionaryBytes,\s*resolution\.source\.catalogDigest,\s*reviewedReferences/);
  assert.match(app, /contrastPairs,[\s\S]*?taskFingerprint: `preview:\$\{resolution\.source\.contentDigest\}`/);
  assert.match(app, /taskFingerprint: lifecycle\.state\(\)\.taskFingerprint/);
  assert.match(app, /if \(state\.verbGuidedRequested\) \{[\s\S]*?state\.verbQueueIds = \[\]/);
  assert.match(app, /if \(state\.verbGuidedRequested\) \{[\s\S]*?renderVerbNebula\(\);\s*return;\s*\}/);
});

test("Verb forms stay course-configured, developer-only, deterministic, and non-semantic", () => {
  const morphologyConfiguration = course.curriculum.verbExerciseFamilies.families.morphology;
  const morphologySources = sourceCatalog.sources.filter((entry) => (
    entry.exerciseFamilyId === morphologyConfiguration.exerciseFamilyId
  ));
  const morphologyBindings = bindingRegistry.bindings.filter((entry) => (
    entry.exerciseFamilyId === morphologyConfiguration.exerciseFamilyId
  ));

  assert.equal(morphologyConfiguration.developerOnly, true);
  assert.equal(morphologyConfiguration.requiresPinnedCatalog, true);
  assert.equal(morphologyConfiguration.optionCount, 3);
  assert.equal(morphologyConfiguration.targetSkillId, "cs.skill.form.cist.present-singular-person");
  assert.equal(morphologySources.length, 3);
  assert.equal(morphologyBindings.length, 3);
  assert.deepEqual(
    morphologySources.map((source) => source.contentId),
    Array.from(morphologyConfiguration.sequence.orderedContentIds)
  );
  assert.deepEqual(
    morphologyBindings.map((binding) => binding.id),
    Array.from(morphologyConfiguration.sequence.orderedBindingIds)
  );
  morphologyBindings.forEach((binding, index) => {
    assert.equal(binding.contentRef.contentId, morphologyConfiguration.sequence.orderedContentIds[index]);
    assert.deepEqual(binding.targetSkillRefs, [{ id: morphologyConfiguration.targetSkillId, revision: 1 }]);
    assert.equal(binding.evidenceCapabilities[0].masteryEligible, false);
  });
  assert.deepEqual(
    morphologySources.map((source) => source.snapshot.selectedCueRef.id),
    [
      "cs.cue.cist.read.speaker-singular-current",
      "cs.cue.cist.read.addressee-singular-current",
      "cs.cue.cist.read.named-third-person-current"
    ]
  );
  const expectedSequence = [
    {
      contentId: "cs.morphology.cist.present-singular-person.1sg",
      bindingId: "binding.verb-nebula.cs.morphology.cist.present-singular-person.1sg",
      cueRef: { id: "cs.cue.cist.read.speaker-singular-current", revision: 1 },
      targetItemRef: { id: "cs.form.cist.present-indicative.1sg", revision: 1 },
      role: "I",
      translation: "I am reading now.",
      surface: "čtu"
    },
    {
      contentId: "cs.morphology.cist.present-singular-person.2sg",
      bindingId: "binding.verb-nebula.cs.morphology.cist.present-singular-person.2sg",
      cueRef: { id: "cs.cue.cist.read.addressee-singular-current", revision: 2 },
      targetItemRef: { id: "cs.form.cist.present-indicative.2sg", revision: 2 },
      role: "you",
      translation: "You are reading now.",
      surface: "čteš"
    },
    {
      contentId: "cs.morphology.cist.present-singular-person.3sg",
      bindingId: "binding.verb-nebula.cs.morphology.cist.present-singular-person.3sg",
      cueRef: { id: "cs.cue.cist.read.named-third-person-current", revision: 2 },
      targetItemRef: { id: "cs.form.cist.present-indicative.3sg", revision: 1 },
      role: "Grandpa",
      translation: "Grandpa is reading now.",
      surface: "čte"
    }
  ];
  expectedSequence.forEach((expected, index) => {
    const source = morphologySources.find((row) => row.contentId === expected.contentId);
    const binding = morphologyBindings.find((row) => row.id === expected.bindingId);
    const cue = morphologyCatalog.cues.find((row) => (
      row.id === expected.cueRef.id && row.revision === expected.cueRef.revision
    ));
    const item = morphologyCatalog.items.find((row) => (
      row.id === expected.targetItemRef.id && row.revision === expected.targetItemRef.revision
    ));
    assert.equal(morphologyConfiguration.sequence.orderedContentIds[index], expected.contentId);
    assert.equal(morphologyConfiguration.sequence.orderedBindingIds[index], expected.bindingId);
    assert.deepEqual(source?.snapshot.selectedCueRef, expected.cueRef);
    assert.deepEqual(source?.snapshot.targetItemRef, expected.targetItemRef);
    assert.deepEqual(binding?.contentRef, {
      catalogId: source.catalogId,
      catalogRevision: source.catalogRevision,
      catalogDigest: source.catalogDigest,
      contentId: source.contentId,
      revision: source.revision,
      contentDigest: source.contentDigest
    });
    assert.deepEqual(cue?.targetItemRef, expected.targetItemRef);
    assert.equal(cue?.presentation.roleTokenEn, expected.role);
    assert.equal(cue?.presentation.naturalTranslationEn, expected.translation);
    assert.equal(item?.surface, expected.surface);
  });

  const requestedFamily = functionSource(app, "requestedVerbExerciseFamily", "verbExerciseFamilyConfiguration");
  assert.match(requestedFamily, /explicitLocalGuidedRequest\(\) && requested === "morphology"/);
  assert.match(requestedFamily, /configuration\?\.defaultFamily \|\| "meaning"/);

  const prepare = functionSource(app, "prepareVerbMorphologyGuidedStep", "initializeVerbGuidedMode");
  assert.match(prepare, /claimDeveloperPilotSequence\([\s\S]*?requirePresented: \(\) => false/);
  assert.match(prepare, /restoreMorphologyRoundState\(claim\.taskRef\)/);
  assert.match(prepare, /JSON\.stringify\(restored\.round\) !== JSON\.stringify\(expectedRound\)/);
  assert.match(prepare, /const round = expectedRound/);
  assert.match(prepare, /normalizeVerbMorphologyProgress\(restored\.state, fallbackRoundState, round\)/);
  assert.match(prepare, /composeBoundMorphologyRound\([\s\S]*?`preview:\$\{resolution\.source\.contentDigest\}`/);
  assert.match(prepare, /sequence:[\s\S]*?orderedBindingIds:[\s\S]*?expectedStep: claim\.sequence\.expectedStep/);
  const resolveStep = functionSource(app, "resolveVerbMorphologyStep", "prepareVerbMorphologyGuidedStep");
  assert.match(resolveStep, /resolvePinnedMorphologyCatalog\([\s\S]*?verbMorphologyCatalogBytes,[\s\S]*?resolution\.source\.catalogDigest/);
  assert.match(resolveStep, /sameRefSet\(resolution\.source\.snapshot\?\.itemRefs, familyItems\)/);
  assert.match(resolveStep, /sameRefSet\(resolution\.source\.snapshot\?\.cueRefs, familyCues\)/);
  const compose = functionSource(app, "composeBoundMorphologyRound", "resolveVerbMorphologyStep");
  assert.match(compose, /cueRef: selectedCueRef/);
  const activate = functionSource(app, "activateVerbGuidedOpportunity", "parseStoredVerbMemory");
  assert.ok(activate.indexOf("applyMorphologyGuidedRound(round, { task })") < activate.indexOf("await saveVerbMorphologyProgress()"));
  assert.ok(activate.indexOf("await saveVerbMorphologyProgress()") < activate.indexOf('state.verbGuidedStatus = "ready"'));
  const painted = functionSource(app, "verbMorphologyPresentationPainted", "verbGuidedPresentationReady");
  assert.match(painted, /round\.cue\?\.cueRef\?\.id !== selectedCueRef\.id/);
  assert.match(painted, /data-morphology-item-id/);
  assert.match(painted, /naturalTranslationEn/);

  const render = functionSource(app, "renderVerbMorphology", "renderVerbNebula");
  assert.doesNotMatch(render, /createElement\("img"\)|assetPath|picture clue/i);
  assert.match(render, /presentation\.naturalTranslationEn/);
  assert.match(render, /presentation\.teachingLabelEn/);
  assert.doesNotMatch(render, /presentation\.questionEn|Who is reading\?/);
  assert.match(render, /setText\("#verbMorphologyTitle", "Which form fits\?"\)/);
  assert.match(render, /course\.targetLanguage\?\.label \|\| "target language"/);
  assert.match(render, /course\.targetLanguage\?\.locale \|\| course\.targetLanguage\?\.id/);
  assert.match(render, /lemmaNode\.lang = targetLanguageLocale/);
  assert.match(render, /stateDescription\.lang = "en"/);
  assert.match(render, /button\.removeAttribute\("aria-pressed"\)/);
  assert.doesNotMatch(render, /button\.setAttribute\("aria-pressed"|choice\.ariaLabel/);
  assert.match(render, /const reusable = existingButtons\.length/);
  assert.match(render, /buttons\.find\(\(button\) => \(\s*!button\.disabled && !button\.classList\.contains\("is-wrong"\)/);
  assert.match(render, /state\.verbMorphologyFocusNextAction[\s\S]*?!nextButton\.disabled[\s\S]*?focusVerbMorphologyControl\(nextButton, board\)/);
  assert.match(render, /state\.verbGuidedStatus === "awaiting-next"/);
  assert.match(render, /"Next form"/);
  assert.match(render, /0 XP/);
  assert.ok((render.match(/hintPanel\.hidden = true/g) || []).length >= 2);
  assert.ok((render.match(/nextButton\.hidden = true/g) || []).length >= 2);
  assert.match(render, /choices\.replaceChildren\(\);\s*choices\.hidden = true;/);
  assert.match(render, /"Unavailable · non-mastery · 0 XP"/);
  const guidedStatus = functionSource(app, "renderVerbGuidedStatus", "waitForVerbPaintedFrame");
  assert.match(guidedStatus, /state\.verbGuidedStatus === "awaiting-next" && morphology[\s\S]*?supportedBeforeResponse[\s\S]*?supported comprehension, not independent evidence/);

  const choose = functionSource(app, "chooseVerbMorphologyForm", "showVerbMorphologyHint");
  assert.ok(choose.indexOf("morphologySettlement(") < choose.indexOf("await recordVerbMorphologyEvidence(request)"));
  assert.ok(choose.indexOf("await saveVerbMorphologyProgress(pendingProgress)") < choose.indexOf("await recordVerbMorphologyEvidence(request)"));
  assert.ok(choose.indexOf("await recordVerbMorphologyEvidence(request)") < choose.indexOf("await saveVerbMorphologyProgress(completedEvidenceProgress)"));
  assert.match(choose, /terminalCompletionKind: completionKind/);
  assert.doesNotMatch(choose, /completeVerbMorphologySequenceStep/);
  assert.match(choose, /Your answer was not recorded because the local result could not be prepared\./);
  assert.match(choose, /supported form comprehension, not independent evidence/);
  assert.match(choose, /choose Next form when ready/);
  assert.doesNotMatch(choose, /CaatuuLearning\?\.record/);

  const reveal = functionSource(app, "revealVerbMorphologySolution", "advanceVerbMorphologySequence");
  assert.ok(reveal.indexOf("await saveVerbMorphologyProgress(pendingProgress)") < reveal.indexOf("await recordVerbMorphologyEvidence(request)"));
  assert.match(reveal, /terminalCompletionKind: "solution-review"/);
  assert.match(reveal, /const settlementId = morphologySettlement\(\s*"solution-reveal"/);
  assert.doesNotMatch(reveal, /current\.settlementId \|\| morphologySettlement/);
  assert.doesNotMatch(reveal, /completeVerbMorphologySequenceStep/);
  assert.match(reveal, /\{ hintState: nextHintState \}/);
  assert.match(reveal, /choose Next form when ready/);
  assert.doesNotMatch(reveal, /CaatuuLearning\?\.record/);

  const advance = functionSource(app, "advanceVerbMorphologySequence", "waitForVerbTransition");
  assert.ok(advance.indexOf("pendingCompletionKind: completionKind") < advance.indexOf("completeVerbMorphologySequenceStep(completionKind)"));
  assert.ok(advance.indexOf("completeVerbMorphologySequenceStep(completionKind)") < advance.indexOf("prepareVerbMorphologyGuidedStep("));
  const saveProgress = functionSource(app, "saveVerbMorphologyProgress", "failVerbMorphologyOnRevisionConflict");
  assert.match(saveProgress, /expectedRevision: state\.verbMorphologyProgressRevision/);
  assert.match(saveProgress, /state\.verbMorphologyProgressRevision = Number\(saved\?\.revision/);
  const revisionConflict = functionSource(app, "failVerbMorphologyOnRevisionConflict", "morphologyEvidenceRequest");
  assert.match(revisionConflict, /CURRICULUM_MORPHOLOGY_ROUND_REVISION_CONFLICT[\s\S]*?CURRICULUM_MORPHOLOGY_ROUND_SETTLED/);
  assert.match(revisionConflict, /changed in another tab[\s\S]*?Reload this page/);
  assert.ok((app.match(/failVerbMorphologyOnRevisionConflict\(error\)/g) || []).length >= 6);
  const recover = functionSource(app, "recoverVerbMorphologyProgress", "morphologyPresentation");
  assert.match(recover, /recordVerbMorphologyEvidence\(pending\.request, \{ direct: true \}\)/);
  assert.match(recover, /completeVerbMorphologySequenceStep\(completionKind, \{ direct: true \}\)/);
  assert.match(indexHtml, /id="verbMorphologyNextButton"[\s\S]*?hidden/);
  assert.match(app, /verbMorphologyNextButton[\s\S]*?advanceVerbMorphologySequence/);

  const memoryRead = functionSource(app, "readVerbMemoryEnvelope", "readVerbMemory");
  assert.match(memoryRead, /try \{[\s\S]*?localStorage\.setItem\(verbStorageKey, JSON\.stringify\(migrated\)\)[\s\S]*?catch \(error\)[\s\S]*?return migrated/);

  assert.match(indexHtml, /id="verbWorldSubtitle">Match meanings<\/small>/);
  assert.match(app, /state\.verbExerciseFamily === "morphology" \? "Choose forms" : "Match meanings"/);
  assert.match(indexHtml, /id="verbMorphologyTitle">Which form fits\?<\/h2>/);
  assert.match(indexHtml, /id="verbMorphologyLemmaTarget" lang="cs-CZ">číst<\/span>/u);
  assert.match(indexHtml, /id="verbMorphologyGloss" lang="en">read<\/span>/);
  assert.match(indexHtml, /id="verbMorphologyChoices"[\s\S]*?role="group"/);
  assert.match(indexHtml, /id="verbMorphologyFeedback"[\s\S]*?aria-live="polite"/);
  assert.match(indexHtml, /id="verbGuidedStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app, /if \(morphology\) \{[\s\S]*?banner\.removeAttribute\("aria-live"\)/);
  assert.doesNotMatch(indexHtml, /id="verbMorphologyNextButton"[^>]*aria-describedby/);
  assert.match(appCss, /\.verb-morphology-role\s*\{[\s\S]*?background: var\(--theme-blue-filled, #496d84\);[\s\S]*?color: #ffffff;/);
  assert.match(appCss, /\.verb-morphology-visually-hidden\s*\{[\s\S]*?clip: rect\(0 0 0 0\);/);
  assert.match(appCss, /#verbMorphologyCue\[hidden\],[\s\S]*?#verbMorphologyNextButton\[hidden\]\s*\{\s*display: none;/);
});

test("Verb forms reject contradictory persisted progress envelopes", () => {
  const context = {
    state: { verbMorphologyRound: null },
    verbMorphologyProgressSchema: "caatuu-morphology-guided-progress-v1",
    verbExerciseFamilyCore: {
      VERB_HINT_STATES: {
        AVAILABLE: "available",
        USED: "used",
        SOLUTION_REVEALED: "solution-revealed"
      }
    },
    verbMorphologyAdapter: () => ({ restoreRound: (round) => structuredClone(round) }),
    morphologyRefKey: (reference) => `${reference?.id || ""}@${reference?.revision || ""}`
  };
  vm.runInNewContext(
    `${functionSource(app, "normalizeVerbMorphologyProgress", "morphologyTaskRefFor")}; this.normalizeProgress = normalizeVerbMorphologyProgress;`,
    context
  );
  const targetItemRef = { id: "cs.form.cist.present-indicative.1sg", revision: 1 };
  const wrongItemRef = { id: "cs.form.cist.present-indicative.2sg", revision: 2 };
  const contentRound = { targetItemRef };
  const occurredAt = "2026-08-02T10:00:00.000Z";
  const round = (overrides = {}) => ({
    roundId: "round.test",
    completed: true,
    settlementId: "verb-settlement:v1:test",
    hintState: "available",
    selectedItemRef: targetItemRef,
    rejectedItemRefs: [],
    ...overrides
  });
  const evidence = (overrides = {}) => ({
    recorded: true,
    score: 1,
    solutionRevealed: false,
    hintsUsed: 0,
    occurredAt,
    ...overrides
  });
  const progress = (overrides = {}) => ({
    schemaVersion: "caatuu-morphology-guided-progress-v1",
    round: round(),
    evidence: evidence(),
    pendingEvidence: null,
    terminalCompletionKind: "correct-first-response",
    pendingCompletionKind: null,
    ...overrides
  });
  const normalize = (value) => context.normalizeProgress(value, value.round, contentRound);

  const valid = [
    progress(),
    progress({
      round: round({ hintState: "used" }),
      evidence: evidence({ hintsUsed: 1 })
    }),
    progress({
      round: round({ rejectedItemRefs: [wrongItemRef] }),
      evidence: evidence({ score: 0 }),
      terminalCompletionKind: "corrective-correct"
    }),
    progress({
      round: round({ hintState: "solution-revealed", selectedItemRef: null }),
      evidence: evidence({ score: 0, solutionRevealed: true }),
      terminalCompletionKind: "solution-review"
    }),
    progress({
      round: round({
        hintState: "solution-revealed",
        selectedItemRef: wrongItemRef,
        rejectedItemRefs: [wrongItemRef]
      }),
      evidence: evidence({ score: 0 }),
      terminalCompletionKind: "solution-review"
    }),
    progress({
      round: round({ completed: false, selectedItemRef: wrongItemRef, rejectedItemRefs: [wrongItemRef] }),
      evidence: evidence({ score: 0 }),
      terminalCompletionKind: null
    })
  ];
  valid.forEach((value) => assert.doesNotThrow(() => normalize(value)));

  const pendingBase = progress({
    round: round({ completed: false, settlementId: "", selectedItemRef: null }),
    evidence: evidence({ recorded: false, score: null, occurredAt: null }),
    terminalCompletionKind: null
  });
  const validPending = [
    {
      ...pendingBase,
      pendingEvidence: {
        request: { attemptNumber: 1, score: 1, solutionRevealed: false, hintsUsed: 0, occurredAt },
        round: round(),
        completionKind: "correct-first-response"
      }
    },
    {
      ...pendingBase,
      pendingEvidence: {
        request: { attemptNumber: 1, score: 1, solutionRevealed: false, hintsUsed: 1, occurredAt },
        round: round({ hintState: "used" }),
        completionKind: "correct-first-response"
      }
    },
    {
      ...pendingBase,
      pendingEvidence: {
        request: { attemptNumber: 1, score: 0, solutionRevealed: true, hintsUsed: 0, occurredAt },
        round: round({ hintState: "solution-revealed", selectedItemRef: null }),
        completionKind: "solution-review"
      }
    },
    {
      ...pendingBase,
      pendingEvidence: {
        request: { attemptNumber: 1, score: 0, solutionRevealed: false, hintsUsed: 0, occurredAt },
        round: round({ completed: false, selectedItemRef: wrongItemRef, rejectedItemRefs: [wrongItemRef] }),
        completionKind: null
      }
    }
  ];
  validPending.forEach((value) => assert.doesNotThrow(() => normalize(value)));

  const invalid = [
    {
      ...pendingBase,
      evidence: { ...pendingBase.evidence, hintsUsed: 1 }
    },
    progress({ evidence: evidence({ hintsUsed: 1 }) }),
    progress({ round: round({ hintState: "used" }) }),
    progress({ evidence: evidence({ solutionRevealed: true }) }),
    progress({ round: round({ rejectedItemRefs: [wrongItemRef] }) }),
    progress({ evidence: evidence({ score: 0 }), terminalCompletionKind: "corrective-correct" }),
    progress({
      round: round({ hintState: "solution-revealed", selectedItemRef: wrongItemRef, rejectedItemRefs: [wrongItemRef] }),
      evidence: evidence({ score: 0, solutionRevealed: true }),
      terminalCompletionKind: "solution-review"
    }),
    progress({
      round: round({ hintState: "solution-revealed", selectedItemRef: null }),
      evidence: evidence({ score: 0 }),
      terminalCompletionKind: "solution-review"
    }),
    progress({
      round: round({ hintState: "solution-revealed", selectedItemRef: targetItemRef }),
      evidence: evidence({ score: 0, solutionRevealed: true }),
      terminalCompletionKind: "solution-review"
    }),
    progress({
      round: round({
        hintState: "solution-revealed",
        selectedItemRef: targetItemRef,
        rejectedItemRefs: [wrongItemRef]
      }),
      evidence: evidence({ score: 0 }),
      terminalCompletionKind: "solution-review"
    }),
    {
      ...validPending[0],
      pendingEvidence: {
        ...validPending[0].pendingEvidence,
        request: { ...validPending[0].pendingEvidence.request, solutionRevealed: true }
      }
    },
    {
      ...validPending[0],
      pendingEvidence: {
        ...validPending[0].pendingEvidence,
        round: round({ hintState: "used" })
      }
    },
    {
      ...validPending[3],
      pendingEvidence: {
        ...validPending[3].pendingEvidence,
        request: { ...validPending[3].pendingEvidence.request, solutionRevealed: true }
      }
    },
    { ...validPending[0], evidence: evidence({ score: 0 }) }
  ];
  invalid.forEach((value) => assert.throws(() => normalize(value)));
});

test("Guided games drain lifecycle work before reset and keep recovery journals retryable", () => {
  const verbReset = functionSource(app, "prepareVerbProgressReset", "resetGuidedVerbRuntimeState");
  assert.ok(verbReset.indexOf("state.verbProgressResetPending = true") < verbReset.indexOf("lifecycle?.abort?.()"));
  assert.match(verbReset, /state\.verbGuidedActivationEpoch \+= 1/);
  assert.match(verbReset, /state\.verbMorphologyGeneration \+= 1/);
  assert.match(verbReset, /\.\.\.state\.verbGuidedOperations/);
  assert.match(app, /registerProgressResetPreparation\?\.\(prepareVerbProgressReset\)/);
  assert.match(app, /trackVerbGuidedOperation\(settleVerbMatch\)/);
  assert.match(app, /trackVerbGuidedOperation\(toggleVerbSolution\)/);

  const wordReset = functionSource(
    wordWorld,
    "prepareGuidedWordProgressReset",
    "restartGuidedWordWorldAfterReset"
  );
  assert.ok(wordReset.indexOf("state.guidedResetPending = true") < wordReset.indexOf("await lifecycle.abort()"));
  assert.match(wordReset, /state\.guidedActivationEpoch \+= 1/);
  assert.match(wordReset, /state\.phraseRequestId \+= 1/);
  assert.match(wordWorld, /registerProgressResetPreparation\?\.\(prepareGuidedWordProgressReset\)/);

  const recovery = functionSource(app, "recoverVerbMorphologyProgress", "morphologyPresentation");
  assert.ok(
    recovery.indexOf("await saveVerbMorphologyProgress(recoveredProgress)")
      < recovery.lastIndexOf("progress = state.verbMorphologyProgress"),
    "a failed final journal save must leave the durable pending journal in global state"
  );
  assert.match(recovery, /state\.verbMorphologyResume = true/);
  assert.match(recovery, /restoredWithSupport[\s\S]*?supported comprehension, not independent evidence/);

  const hint = functionSource(app, "showVerbMorphologyHint", "revealVerbMorphologySolution");
  assert.ok(
    hint.indexOf("await saveVerbMorphologyProgress") < hint.indexOf("markHint("),
    "support must not be marked before its visible hint state is durably saved"
  );
  assert.match(hint, /state\.verbMorphologyFocusNextStep = transferFocus/);
  assert.match(hint, /state\.verbMorphologyFocusHintAction = transferFocus/);

  const conflict = functionSource(app, "failVerbMorphologyOnRevisionConflict", "trackVerbGuidedOperation");
  for (const code of [
    "CURRICULUM_MORPHOLOGY_ROUND_TASK_INVALID",
    "EVIDENCE_TASK_NOT_ISSUED",
    "CURRICULUM_DEVELOPER_PILOT_SEQUENCE_UNKNOWN",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_TASK_INVALID",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_EVIDENCE_MISMATCH",
    "CURRICULUM_DEVELOPER_PILOT_COMPLETION_SETTLEMENT_MISMATCH",
    "CURRICULUM_STORAGE_CORRUPT"
  ]) assert.match(conflict, new RegExp(code));

  const advance = functionSource(app, "advanceVerbMorphologySequence", "waitForVerbTransition");
  assert.match(advance, /verbMorphologyProgress\?\.terminalCompletionKind[\s\S]*?"awaiting-next"/);
  assert.match(advance, /state\.verbProgressResetPending/);
});

test("Verb Nebula persists target discrimination evidence before feedback and keeps support sticky", () => {
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
