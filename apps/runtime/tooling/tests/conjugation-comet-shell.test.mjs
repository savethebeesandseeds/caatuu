import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const launcherRoot = new URL("../../../../apps/launcher/static/", import.meta.url);
const [page, styles, gamesPage, appStyles, appController, cometController, serviceWorker, setupManifest, logoBytes] = await Promise.all([
  readFile(new URL("conjugation-comet.html", staticRoot), "utf8"),
  readFile(new URL("conjugation-comet.css", staticRoot), "utf8"),
  readFile(new URL("index.html", staticRoot), "utf8"),
  readFile(new URL("app.css", staticRoot), "utf8"),
  readFile(new URL("app.js", staticRoot), "utf8"),
  readFile(new URL("conjugation-comet.js", staticRoot), "utf8"),
  readFile(new URL("sw.js", staticRoot), "utf8"),
  readFile(new URL("setup-assets.json", staticRoot), "utf8").then(JSON.parse),
  readFile(new URL("assets/planets/conjugation-comet.png", launcherRoot))
]);

test("Conjugation Comet owns the morphology presentation outside Verb Nebula", () => {
  assert.match(page, /class="games-page conjugation-comet-page"/);
  assert.match(page, /class="app-shell"/);
  assert.match(page, /class="workspace"/);
  assert.match(page, /class="train-tab-panel verb-match-panel conjugation-comet-panel is-active"/);
  assert.match(page, /id="verbMeaningGateBoard"/);
  assert.match(page, /id="verbMeaningTargetColumn"/);
  assert.match(page, /id="verbMeaningEnglishColumn"/);
  assert.match(page, /id="verbMorphologyBoard"/);
  assert.match(page, /id="verbMorphologyFormsColumn"/);
  assert.match(page, /id="verbMorphologyCuesColumn"/);
  assert.doesNotMatch(page, /id="verbMorphologyChoices"/);
  assert.doesNotMatch(gamesPage, /id="verbMorphologyBoard"/);
  assert.doesNotMatch(appStyles, /verb-morphology|verbMorphology/);
  assert.doesNotMatch(page, /conjugation-comet-shell|conjugation-comet-main|conjugation-comet-toolbar|conjugation-comet-board-intro|conjugation-comet-board-footer/);
  assert.match(page, /id="verbMeaningGateFooter"[^>]*class="verb-match-footer conjugation-comet-footer"|class="verb-match-footer conjugation-comet-footer"[^>]*id="verbMeaningGateFooter"/);
  assert.match(page, /id="verbMorphologyFooter"[^>]*class="verb-match-footer conjugation-comet-footer"|class="verb-match-footer conjugation-comet-footer"[^>]*id="verbMorphologyFooter"/);
});

test("the standalone shell loads shared state before its game controller", () => {
  const course = page.indexOf('src="course-profile.js?v=course-13"');
  const learning = page.indexOf('src="learning-profile.js?v=learning-5"');
  const runtime = page.indexOf('src="runtime.js?v=runtime-36"');
  const semantic = page.indexOf('src="semantic-learning.js?v=semantic-learning-7"');
  const curriculum = page.indexOf('src="curriculum-service.js?v=curriculum-service-9"');
  const appStyle = page.indexOf('href="app.css?v=shell-72"');
  const chromeStyle = page.indexOf('href="chrome.css?v=chrome-style-90"');
  const cometStyle = page.indexOf('href="conjugation-comet.css?v=conjugation-comet-6"');
  const chrome = page.indexOf('src="chrome.js?v=chrome-90"');
  const controller = page.indexOf('src="conjugation-comet.js?v=conjugation-comet-7"');
  assert.ok(course >= 0 && learning > course && runtime > learning);
  assert.ok(semantic > runtime && curriculum > semantic);
  assert.ok(appStyle > curriculum && chromeStyle > appStyle && cometStyle > chromeStyle);
  assert.ok(chrome > curriculum && controller > chrome);
});

test("the standalone controller owns its configuration and renders safely before shared modules resolve", () => {
  assert.match(
    cometController,
    /const hintStates = verbExerciseFamilyCore\?\.VERB_HINT_STATES;/
  );
  assert.match(
    cometController,
    /morphologySequenceConfiguration\(\s*conjugationCometConfiguration\(\)\s*\)/
  );
  assert.doesNotMatch(cometController, /\bverbExerciseFamilyConfiguration\b/);
  assert.match(
    cometController,
    /function sequenceTotalSteps\(\)[\s\S]*?orderedBindingIds\?\.length/
  );
  assert.doesNotMatch(cometController, /All three pinned pilot forms|of 3 complete/);
});

test("the game has a reviewed meaning rendezvous before its full morphology board", () => {
  assert.match(cometController, /guidedContrasts/);
  assert.match(cometController, /resolvePinnedStableVerbPairs\(\s*verbDictionaryBytes/);
  assert.match(cometController, /buildGuidedVerbRound\([\s\S]*?pairCount: 4/);
  assert.match(cometController, /plan\.englishRound\.length !== 4/);
  assert.match(cometController, /const meaningPhase = state\.verbGuidedStatus !== "failed"[\s\S]*?Boolean\(state\.verbMeaningPlan\)/);
  assert.match(cometController, /if \(meaningPhase\) \{[\s\S]*?renderVerbMeaningGate\(\);[\s\S]*?return;/);
  assert.match(cometController, /composeMorphologyMatchBoard\([\s\S]*?itemRefs: snapshot\.itemRefs[\s\S]*?cueRefs: snapshot\.cueRefs/);
  assert.match(cometController, /evaluateMorphologyMatchPair\(/);
  assert.match(cometController, /naturalTranslationEn/);
  assert.match(cometController, /teachingLabelEn/);
  assert.match(cometController, /labelNode\.textContent = `\(\$\{teachingLabel\}\)`/);
  assert.match(cometController, /morphology evidence has not started/);
});

test("legacy local morphology bookmarks migrate before Verb Nebula starts", () => {
  assert.match(appController, /function redirectLegacyConjugationCometBookmark\(\)[\s\S]*?verb-family"\) !== "morphology"[\s\S]*?course\.routes\?\.conjugationComet[\s\S]*?window\.location\.replace\(target\.href\)/);
  assert.match(appController, /if \(!redirectLegacyConjugationCometBookmark\(\)\) init\(\);/);
});

test("the initial document exposes no Czech answer key and only one live status per visible phase", () => {
  assert.doesNotMatch(page, /(?:číst|čtu|čteš|čte)/iu);
  assert.equal((page.match(/aria-live=/g) || []).length, 2);
  assert.match(page, /id="verbMeaningGateBoard"[\s\S]*?hidden/);
  assert.match(page, /id="verbMeaningGateFeedback"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(page, /id="verbMorphologyFeedback"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.doesNotMatch(page, /id="verbGuidedStatus"[^>]*aria-live=/);
  assert.match(page, /id="verbMorphologyBoard"[\s\S]*?aria-busy="true"/);
  assert.match(page, /id="verbMorphologyHintButton"[^>]*disabled/);
  assert.match(page, /id="verbMorphologyRevealButton"[^>]*disabled/);
});

test("controls remain usable at touch, keyboard, mobile, and reduced-motion boundaries", () => {
  assert.match(page, /class="verb-match-controls"/);
  assert.match(page, /class="verb-match-control-cluster"/);
  assert.match(styles, /\.verb-morphology-actions > button \{[\s\S]*?min-height: 34px/);
  assert.match(styles, /\.conjugation-comet-match-board \.verb-match-card:focus-visible[\s\S]*?outline: 3px solid/);
  assert.match(appStyles, /\.verb-match-board \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(appStyles, /\.app-shell:has\(\.verb-match-panel\.is-active\)[\s\S]*?\.verb-match-panel\.is-active > \.verb-match-footer/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.conjugation-comet-match-board \.verb-match-card/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none/);
  assert.match(styles, /\.conjugation-comet-match-board\[hidden\][\s\S]*?display: none/);
  assert.match(
    appStyles,
    /@media screen and \(max-width: 520px\)[\s\S]*?\.train-worlds \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/
  );
});

test("the offline shell pins its document, controller, styles, and logo together", () => {
  for (const asset of [
    "./conjugation-comet.html",
    "./conjugation-comet.css?v=conjugation-comet-6",
    "./conjugation-comet.js?v=conjugation-comet-7",
    "/assets/planets/conjugation-comet.png"
  ]) {
    assert.ok(serviceWorker.includes(`"${asset}"`), `service worker must precache ${asset}`);
  }
});

test("browser setup and Android packaging share the exact reviewed logo", () => {
  const artifact = setupManifest.artifacts.find((entry) => entry.key === "planet-conjugation");
  assert.deepEqual(artifact, {
    key: "planet-conjugation",
    label: "Conjugation Comet",
    artifact_kind: "visual-asset",
    url: "/assets/planets/conjugation-comet.png",
    asset_path: "assets/planets/conjugation-comet.png",
    bytes: 534082,
    sha256: "78e59571a850aa92a3c3d6862f676d1b7fad54137b8ad10a74ef2eaaba20fee0",
    native_required: true,
    browser_required: true
  });
  assert.equal(logoBytes.byteLength, artifact.bytes);
  assert.equal(createHash("sha256").update(logoBytes).digest("hex"), artifact.sha256);
});
