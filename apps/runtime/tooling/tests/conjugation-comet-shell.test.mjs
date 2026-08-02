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
  assert.match(page, /class="conjugation-comet-page"/);
  assert.match(page, /id="conjugationCometPanel"[^>]*class="conjugation-comet-panel is-active"|class="conjugation-comet-panel is-active"[^>]*id="conjugationCometPanel"/);
  assert.match(page, /id="verbMorphologyBoard"/);
  assert.match(page, /id="verbMorphologyChoices"[\s\S]*?role="group"/);
  assert.doesNotMatch(gamesPage, /id="verbMorphologyBoard"/);
  assert.doesNotMatch(appStyles, /verb-morphology|verbMorphology/);
});

test("the standalone shell loads shared state before its game controller", () => {
  const course = page.indexOf('src="course-profile.js?v=course-13"');
  const learning = page.indexOf('src="learning-profile.js?v=learning-5"');
  const runtime = page.indexOf('src="runtime.js?v=runtime-34"');
  const semantic = page.indexOf('src="semantic-learning.js?v=semantic-learning-7"');
  const curriculum = page.indexOf('src="curriculum-service.js?v=curriculum-service-9"');
  const chrome = page.indexOf('src="chrome.js?v=chrome-86"');
  const controller = page.indexOf('src="conjugation-comet.js?v=conjugation-comet-3"');
  assert.ok(course >= 0 && learning > course && runtime > learning);
  assert.ok(semantic > runtime && curriculum > semantic);
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
    /const totalSteps = sequenceTotalSteps\(\);[\s\S]*?Form \$\{completedNumber\} of \$\{totalSteps\}/
  );
  assert.doesNotMatch(cometController, /All three pinned pilot forms|of 3 complete/);
});

test("legacy local morphology bookmarks migrate before Verb Nebula starts", () => {
  assert.match(appController, /function redirectLegacyConjugationCometBookmark\(\)[\s\S]*?verb-family"\) !== "morphology"[\s\S]*?course\.routes\?\.conjugationComet[\s\S]*?window\.location\.replace\(target\.href\)/);
  assert.match(appController, /if \(!redirectLegacyConjugationCometBookmark\(\)\) init\(\);/);
});

test("the initial document exposes no Czech answer key and only one live status", () => {
  assert.doesNotMatch(page, /(?:číst|čtu|čteš|čte)/iu);
  assert.equal((page.match(/aria-live=/g) || []).length, 1);
  assert.match(page, /id="verbMorphologyFeedback"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.doesNotMatch(page, /id="verbGuidedStatus"[^>]*aria-live=/);
  assert.match(page, /id="verbMorphologyBoard"[\s\S]*?aria-busy="true"/);
  assert.match(page, /id="verbMorphologyHintButton"[^>]*disabled/);
  assert.match(page, /id="verbMorphologyRevealButton"[^>]*disabled/);
});

test("controls remain usable at touch, keyboard, mobile, and reduced-motion boundaries", () => {
  assert.match(styles, /\.verb-morphology-actions button \{[\s\S]*?min-height: 44px/);
  assert.match(styles, /\.verb-morphology-choice:focus-visible,[\s\S]*?outline: 3px solid/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.verb-morphology-choices \{[\s\S]*?grid-template-columns: 1fr/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none/);
  assert.match(styles, /#verbMorphologyChoices\[hidden\][\s\S]*?display: none/);
  assert.match(
    appStyles,
    /@media screen and \(max-width: 520px\)[\s\S]*?\.train-worlds \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/
  );
});

test("the offline shell pins its document, controller, styles, and logo together", () => {
  for (const asset of [
    "./conjugation-comet.html",
    "./conjugation-comet.css?v=conjugation-comet-2",
    "./conjugation-comet.js?v=conjugation-comet-3",
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
