import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const pageNames = [
  "home.html",
  "index.html",
  "chat.html",
  "word-net.html",
  "embedding-images.html",
  "verb-difficulty.html"
];
const [course, runtime, semantic, core, chrome, app, wordWorld, serviceWorker, ...pages] = await Promise.all([
  readFile(new URL("course-profile.js", staticRoot), "utf8"),
  readFile(new URL("runtime.js", staticRoot), "utf8"),
  readFile(new URL("semantic-learning.js", staticRoot), "utf8"),
  readFile(new URL("semantic-learning-core.mjs", staticRoot), "utf8"),
  readFile(new URL("chrome.js", staticRoot), "utf8"),
  readFile(new URL("app.js", staticRoot), "utf8"),
  readFile(new URL("word-net.js", staticRoot), "utf8"),
  readFile(new URL("sw.js", staticRoot), "utf8"),
  ...pageNames.map((name) => readFile(new URL(name, staticRoot), "utf8").then((source) => ({ name, source })))
]);

test("every Czech page installs the synchronous semantic facade before shared Chrome and game code", () => {
  for (const { name, source } of pages) {
    const courseIndex = source.indexOf('src="course-profile.js?v=course-5"');
    const learningIndex = source.indexOf('src="learning-profile.js?v=learning-2"');
    const runtimeIndex = source.indexOf('src="runtime.js?v=runtime-30"');
    const semanticIndex = source.indexOf('src="semantic-learning.js?v=semantic-learning-6"');
    const chromeIndex = source.indexOf('src="chrome.js?v=chrome-70"');
    assert.ok(courseIndex >= 0, `${name} must load the course profile`);
    assert.ok(learningIndex > courseIndex, `${name} must load lightweight learning state after the course profile`);
    assert.ok(runtimeIndex > learningIndex, `${name} must load the runtime after learning state`);
    assert.ok(semanticIndex > runtimeIndex, `${name} must load semantic learning after the runtime`);
    assert.ok(chromeIndex > semanticIndex, `${name} must expose semantic learning before shared Chrome`);
  }
});

test("a compact semantic ledger preserves lifetime truth while journals and caches stay bounded", () => {
  assert.match(course, /semanticLearningDatabase: "caatuu-czech\.semantic-learning"/);
  assert.match(semantic, /const databaseVersion = 2/);
  assert.match(semantic, /attempts: "attempts"/);
  assert.match(semantic, /ledger: "ledger"/);
  assert.match(semantic, /receipts: "receipts"/);
  assert.match(semantic, /evidence: "evidence"/);
  assert.match(semantic, /embeddings: "embeddings"/);
  assert.match(semantic, /attempts\.get\(attempt\.id\)/);
  assert.match(semantic, /attempts\.add\(attempt\)/);
  assert.match(semantic, /core\.semanticAttemptsEqual\(existing, attempt, storedAttemptNormalization\)/);
  assert.match(semantic, /refers to a different immutable event/);
  assert.match(semantic, /caller-supplied id must include occurredAt/);
  assert.match(semantic, /return \{ duplicate: true, attempt: existing \}/);
  assert.match(semantic, /normalizeOptions: storedAttemptNormalization/);
  assert.match(semantic, /truthFormat: "compact-ledger-v2"/);
  assert.match(semantic, /semanticAttemptFingerprint\(attempt, storedAttemptNormalization\)/);
  assert.match(semantic, /attempts\.delete\(attempt\.id\)/);
  assert.match(semantic, /receipts\.index\("compactedAtMs"\)\.getAllKeys\(\)/);
  assert.match(semantic, /embeddings\.index\("createdAtMs"\)\.getAllKeys\(\)/);
  assert.match(semantic, /objectStore\(storeNames\.meta\)\.get\("evidence-state"\)/);
  assert.match(semantic, /state\?\.reducerVersion/);
  assert.match(semantic, /migratedFromReducerVersion/);
  assert.match(semantic, /ensureEvidenceReducerCurrentInTransaction\(transaction, core\)/);
  assert.doesNotMatch(semantic, /reducerReadyVersion/);
  const writeStart = semantic.indexOf("async function writeAttempt");
  const writeEnd = semantic.indexOf("function recordAttempt", writeStart);
  const writePath = semantic.slice(writeStart, writeEnd);
  assert.ok(
    writePath.indexOf("ensureEvidenceReducerCurrentInTransaction(transaction, core)")
      < writePath.indexOf("attempts.get(attempt.id)"),
    "write transactions must validate the reducer before reading or updating evidence"
  );
  assert.match(core, /score === null/);
  assert.match(core, /evidenceReducerVersion: 4/);
  assert.match(core, /historyLedgerVersion: 2/);
  assert.match(core, /rawAttemptLimit: 512/);
  assert.match(core, /rawAttemptTarget: 384/);
  assert.match(core, /compactedReceiptLimit: 2048/);
  assert.match(core, /historyPolicyVersion: 3/);
  assert.match(core, /embeddingLimit: 4608/);
  assert.match(core, /embeddingTarget: 4352/);
  assert.match(core, /maximumStatementKeys: 4096/);
  assert.match(core, /maximumEvidenceReferences: 32/);
  assert.match(core, /maximumSignalsPerAttempt: 16/);
  assert.match(core, /maximumAttemptCharacters: 16384/);
  assert.match(core, /temporalBucketSlots: 16/);
  assert.match(core, /exposureWeight/);
  assert.match(core, /assessedWeight/);

  assert.doesNotMatch(writePath, /CaatuuRuntime|embedText|materializeEmbedding/);
});

test("ledger upgrades are explicit and retain bounded temporal summaries", () => {
  assert.match(semantic, /migrateLedgerInTransaction/);
  assert.match(semantic, /core\.migrateSemanticLedger\(rows, fromVersion\)/);
  assert.match(core, /Compacted semantic ledger version .* requires an explicit migration/);
  assert.match(core, /function addTemporalEvidence/);
  assert.match(core, /export function summarizeTemporalEvidence/);
  const rebuildStart = semantic.indexOf("function rebuildEvidence()");
  const rebuildEnd = semantic.indexOf("function compactHistory()", rebuildStart);
  const rebuildPath = semantic.slice(rebuildStart, rebuildEnd);
  assert.ok(
    rebuildPath.indexOf("ensureEvidenceReducerCurrentInTransaction")
      < rebuildPath.indexOf("rebuildEvidenceInTransaction")
  );
  assert.match(core, /exactAfterMs/);
  assert.match(semantic, /temporalHistoryExactAfterMigration: false/);
  assert.match(semantic, /maximumStatementKeys/);
  assert.match(semantic, /Semantic capability limit reached/);
  assert.match(core, /must include a stable conceptId/);
});

test("retry idempotency is explicitly bounded instead of promising an infinite id set", () => {
  assert.match(semantic, /mode: "bounded-retry-window"/);
  assert.match(semantic, /lifetimeExact: false/);
  assert.match(semantic, /rawAttemptLimit: core\.boundedSemanticHistoryPolicy\.rawAttemptLimit/);
  assert.match(semantic, /compactedReceiptLimit: core\.boundedSemanticHistoryPolicy\.compactedReceiptLimit/);
});

test("compaction, evidence updates, and duplicate receipts share one atomic write transaction", () => {
  const writeStart = semantic.indexOf("async function writeAttempt");
  const writeEnd = semantic.indexOf("function recordAttempt", writeStart);
  const writePath = semantic.slice(writeStart, writeEnd);
  assert.match(writePath, /storeNames\.attempts, storeNames\.ledger, storeNames\.receipts, storeNames\.evidence, storeNames\.meta/);
  assert.ok(writePath.indexOf("receipts).get(attempt.id)") < writePath.indexOf("attempts.add(attempt)"));
  const newEventPath = writePath.slice(writePath.indexOf("attempts.add(attempt)"));
  assert.ok(newEventPath.indexOf("evidence.put(next)") < newEventPath.indexOf("compactHistoryInTransaction(transaction, core)"));
  assert.ok(newEventPath.indexOf("compactHistoryInTransaction(transaction, core)") < newEventPath.indexOf("await finished"));

  const compactStart = semantic.indexOf("async function compactHistoryInTransaction");
  const compactEnd = semantic.indexOf("async function writeAttempt", compactStart);
  const compactPath = semantic.slice(compactStart, compactEnd);
  assert.match(compactPath, /core\.applyAttemptToEvidence/);
  assert.match(compactPath, /ledgerStore\.put/);
  assert.match(compactPath, /receipts\.put/);
  assert.match(compactPath, /attempts\.delete/);
  assert.match(compactPath, /compactedAttemptCount/);
});

test("cache cleanup preserves learner truth and only clears its derived vectors", () => {
  assert.match(runtime, /function shouldClearIndexedDatabaseName\(name\)/);
  assert.match(runtime, /name !== semanticLearningDatabaseName && shouldClearCacheName\(name\)/);
  assert.match(runtime, /CaatuuSemanticLearning\.clearEmbeddingCache\(\)/);
  assert.match(semantic, /function clearEmbeddingCache\(\)/);
  assert.match(semantic, /clearStores\(\[storeNames\.embeddings\]/);
  assert.match(semantic, /event\?\.detail\?\.reason !== "progress-reset"/);
  assert.match(semantic, /clearStores\(Object\.values\(storeNames\), "progress-reset", newWorkEpochToken\(\)\)/);
  assert.match(semantic, /invalidateSemanticWork\(\)/);
  assert.match(semantic, /key: "semantic-work-epoch"/);
  assert.match(semantic, /assertPersistedWorkEpoch\(workEpochToken\)/);
  assert.match(semantic, /new window\.BroadcastChannel/);
  assert.match(chrome, /await window\.CaatuuSemanticLearning\?\.whenIdle\?\.\(\)/);
});

test("projection reuses the runtime singleton embedder without opening the curriculum database", () => {
  const embedStart = runtime.indexOf("async function embedBrowserSemanticText");
  const embedEnd = runtime.indexOf("function browserDictionaryStatus", embedStart);
  const embedPath = runtime.slice(embedStart, embedEnd);
  assert.match(embedPath, /if \(!browserVectorDatabase\) browserVectorDatabase = new Manager\(\)/);
  assert.match(embedPath, /browserVectorDatabase\.embedText\(value\)/);
  assert.doesNotMatch(embedPath, /browserVectorDatabase\.open\(\)/);
  assert.match(runtime, /embed\(text, options = \{\}\)/);
  assert.match(semantic, /window\.CaatuuRuntime\?\.vector\?\.embed/);
  assert.doesNotMatch(semantic, /LocalHashTextEmbedder/);
});

test("the Backpack skill compass is versioned, visible, accessible, and honest about uncertainty", () => {
  assert.match(chrome, /const semanticSkillCompassAxisPack = Object\.freeze\(\{/);
  assert.match(chrome, /id: "cz-everyday-compass"/);
  assert.match(chrome, /version: "1\.1\.0"/);
  assert.match(chrome, /modelId: "all-minilm-l6-v2-qint8-v0\.1"/);
  assert.equal((chrome.match(/probe: \{/g) || []).length >= 7, true);
  assert.equal((chrome.match(/emblem: "/g) || []).length, 7);
  assert.match(chrome, /id: "actions-abilities"/);
  assert.match(chrome, /chartLabel: "Actions"/);
  assert.match(chrome, /<details class="skill-compass" id="semanticSkillCompass" data-state="idle" open>/);
  assert.match(chrome, /viewBox="0 0 340 290" role="img" aria-labelledby=/);
  assert.match(chrome, /id="semanticSkillCompassAxes" aria-label="Skill compass values"/);
  assert.match(chrome, /role="status" aria-live="polite"/);
  for (const section of ["items", "stats", "settings"]) {
    assert.match(chrome, new RegExp(`id="${section}ViewTab"[\\s\\S]*?data-settings-view="${section}"`));
    assert.match(chrome, new RegExp(`id="${section}ViewPanel"[\\s\\S]*?data-settings-view-panel="${section}"`));
  }
  const itemsPanelStart = chrome.indexOf('id="itemsViewPanel"');
  const statsPanelStart = chrome.indexOf('id="statsViewPanel"');
  const settingsPanelStart = chrome.indexOf('id="settingsViewPanel"');
  const journeyLedgerStart = chrome.indexOf('class="journey-ledger"');
  const skillCompassStart = chrome.indexOf('class="skill-compass"');
  assert.ok(itemsPanelStart < statsPanelStart);
  assert.ok(statsPanelStart < journeyLedgerStart && journeyLedgerStart < settingsPanelStart);
  assert.ok(statsPanelStart < skillCompassStart && skillCompassStart < settingsPanelStart);
  assert.doesNotMatch(chrome, /statsMount\.append/);
  assert.match(chrome, /\/assets\/icons\/items_icon\.png\?v=items-2/);
  assert.match(chrome, /\/assets\/icons\/stats_icon\.png/);
  assert.match(chrome, /\/assets\/icons\/gear_icon\.png/);
  assert.match(chrome, /\/assets\/icons\/backpack_icon\.png/);
  assert.doesNotMatch(chrome, /\/assets\/icons\/settings_icon\.png/);
  assert.match(chrome, /class="language-pill settings-language-pill language-switch"/);
  assert.match(chrome, /data-caatuu-language-switch/);
  assert.match(chrome, /function semanticCompassAxisEmblem/);
  assert.match(chrome, /class: "skill-compass-emblem-ring"/);
  assert.match(chrome, /item\.dataset\.axisId = axis\.id/);
  assert.match(chrome, /item\.title = axis\.probe\.text/);
  assert.match(chrome, /"--axis-practice"/);
  assert.match(chrome, /skill-compass-axis-practice-meter/);
  assert.doesNotMatch(chrome, /probe\.textContent = axis\.probe\.text/);
  assert.match(chrome, /semanticSkillCompassLayout\.emblemRadius/);
  assert.match(chrome, /semanticSkillCompassMinimumConfidence = 0\.12/);
  assert.match(chrome, /Topic axes can overlap and do not add to 100%/i);

  const loadStart = chrome.indexOf("async function loadSemanticSkillCompass");
  const loadEnd = chrome.indexOf("function pauseSemanticSkillCompass", loadStart);
  const loadPath = chrome.slice(loadStart, loadEnd);
  assert.ok(loadPath.indexOf("semanticSkillCompassIsVisible(panel)") < loadPath.indexOf("readEvidence()"));
  assert.ok(loadPath.indexOf("readEvidence()") < loadPath.indexOf("projectRadar(semanticSkillCompassAxisPack"));
  assert.match(loadPath, /new AbortController\(\)/);
  assert.match(loadPath, /request !== controller\.request/);
  assert.match(chrome, /caatuu:semantic-learning-change/);
  assert.match(chrome, /controller\.renderedRevision === controller\.revision/);
  assert.match(chrome, /confirmOriginalAriaLabel/);
  assert.match(chrome, /button\.removeAttribute\("aria-label"\)/);
  const pauseStart = chrome.indexOf("function pauseSemanticSkillCompass");
  const pauseEnd = chrome.indexOf("function bindSemanticSkillCompass", pauseStart);
  const pausePath = chrome.slice(pauseStart, pauseEnd);
  assert.match(pausePath, /const wasLoading = controller\.loading/);
  assert.match(pausePath, /progress\.hidden = true/);
  assert.match(pausePath, /controller\.rendered \? "Update ready" : "Open to map"/);
  const settingsViewStart = chrome.indexOf("function setSettingsView");
  const settingsViewEnd = chrome.indexOf("function validAndroidChannelManifest", settingsViewStart);
  assert.match(
    chrome.slice(settingsViewStart, settingsViewEnd),
    /if \(view !== "stats"\) pauseSemanticSkillCompass\(panel\)/
  );
  assert.match(
    chrome.slice(settingsViewStart, settingsViewEnd),
    /if \(view === "stats"\) void loadSemanticSkillCompass\(panel\)/
  );
  const panelBindingStart = chrome.indexOf("function bindSharedSettingsPanel");
  const panelBindingEnd = chrome.indexOf("function clampReportText", panelBindingStart);
  const panelBindingPath = chrome.slice(panelBindingStart, panelBindingEnd);
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
    assert.match(panelBindingPath, new RegExp(`event\\.key === "${key}"`));
  }
  assert.match(panelBindingPath, /setSettingsView\(viewPanel, nextView\.dataset\.settingsView\)/);
  assert.match(panelBindingPath, /nextView\.focus\(\)/);
});

test("cached projections scan the bounded vector working set once and support cancellation", () => {
  assert.match(semantic, /async function cachedEmbeddingBatch/);
  assert.match(semantic, /objectStore\(storeNames\.embeddings\)\.getAll\(\)/);
  assert.match(semantic, /assertProjectionCurrent\(generation, signal\)/);
  assert.match(semantic, /signal\?\.aborted/);
  assert.match(semantic, /skipCacheLookup: true/);
  assert.match(semantic, /\{ skipCacheLookup: true, assertCurrent \}/);
  assert.match(semantic, /}, generation, workEpochToken, assertCurrent\)/);
  assert.match(core, /maximumProjectionAxes = 12/);
  assert.match(core, /duplicate axis id/);
});

test("current games record only evidence their interactions actually support", () => {
  assert.match(app, /function recordVerbSemanticAttempt/);
  assert.match(app, /score = solutionShown \? null : \(correct \? 1 : 0\)/);
  assert.match(app, /meaning-match/);
  assert.match(app, /hintShown \? 0\.65 : 1/);
  assert.match(app, /chosenEnglish: chosenPair\?\.eng/);
  assert.match(wordWorld, /function recordStandardSemanticExposure/);
  assert.match(wordWorld, /outcome: "exposure"/);
  assert.match(wordWorld, /score: null/);
  assert.match(wordWorld, /masteryWeight: 0/);
  assert.doesNotMatch(app, /recordVerbSemanticAttempt\([^)]*memory-moon/);
});

test("the offline shell precaches the semantic source and local embedding runtime", () => {
  assert.match(serviceWorker, /caatuu-czech-pwa-v334/);
  assert.match(serviceWorker, /\/assets\/icons\/items_icon\.png\?v=items-2/);
  assert.match(serviceWorker, /\/assets\/icons\/coin_icon\.png/);
  assert.match(serviceWorker, /semantic-learning\.js\?v=semantic-learning-6/);
  assert.match(serviceWorker, /semantic-learning-core\.mjs\?v=semantic-learning-core-5/);
  assert.match(semantic, /import\("\.\/semantic-learning-core\.mjs\?v=semantic-learning-core-5"\)/);
  assert.match(serviceWorker, /vendor\/transformers\/transformers\.min\.js/);
  assert.match(serviceWorker, /runtime\.js\?v=runtime-30/);
  assert.match(serviceWorker, /app\.js\?v=shell-69/);
  assert.match(serviceWorker, /word-net\.js\?v=word-net-50/);
});
