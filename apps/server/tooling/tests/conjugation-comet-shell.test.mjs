import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const launcherRoot = new URL("../../../../apps/launcher/static/", import.meta.url);
const [page, styles, gamesPage, appStyles, controller, serviceWorker, setupManifest, logoBytes, verbs] = await Promise.all([
  readFile(new URL("conjugation-comet.html", staticRoot), "utf8"),
  readFile(new URL("source/games/conjugation-comet/conjugation-comet.css", staticRoot), "utf8"),
  readFile(new URL("index.html", staticRoot), "utf8"),
  readFile(new URL("source/games/verb-nebula/app.css", staticRoot), "utf8"),
  readFile(new URL("source/games/conjugation-comet/conjugation-comet.js", staticRoot), "utf8"),
  readFile(new URL("sw.js", staticRoot), "utf8"),
  readFile(new URL("setup-assets.json", staticRoot), "utf8").then(JSON.parse),
  readFile(new URL("assets/planets/conjugation-comet.png", launcherRoot)),
  readFile(new URL("data/games/conjugation-comet/verbs.json", staticRoot), "utf8").then(JSON.parse)
]);

test("Conjugation Comet preserves the Verb Nebula-derived two-column shell", () => {
  assert.match(page, /class="games-page conjugation-comet-page"/);
  assert.match(page, /class="train-tab-panel verb-match-panel conjugation-comet-panel is-active"/);
  for (const id of [
    "verbMeaningGateBoard",
    "verbMeaningTargetColumn",
    "verbMeaningEnglishColumn",
    "verbMorphologyBoard",
    "verbMorphologyFormsColumn",
    "verbMorphologyCuesColumn"
  ]) assert.match(page, new RegExp(`id="${id}"`));
  assert.doesNotMatch(gamesPage, /id="verbMorphologyBoard"/);
  assert.doesNotMatch(appStyles, /verb-morphology|verbMorphology/);
});

test("the standalone page loads direct game data without the curriculum service", () => {
  const semantic = page.indexOf('src="source/shared/semantic-learning.js?v=semantic-learning-7"');
  const chrome = page.indexOf('src="source/shared/chrome.js?v=chrome-96"');
  const game = page.indexOf('src="source/games/conjugation-comet/conjugation-comet.js?v=conjugation-comet-13"');
  assert.ok(semantic >= 0 && chrome > semantic && game > chrome);
  assert.doesNotMatch(page, /curriculum-service/);
  assert.match(controller, /const VERBS_URL = "data\/games\/conjugation-comet\/verbs\.json"/);
  assert.doesNotMatch(controller, /CaatuuCurriculum|data\/curriculum|guided-opportunity/);
});

test("verbs.json supplies complete six-form paradigms and fair English cues", () => {
  const keys = ["1s", "2s", "3s", "1p", "2p", "3p"];
  assert.ok(verbs.length >= 4);
  for (const verb of verbs) {
    assert.ok(verb.infinitive?.trim());
    assert.ok(verb.english?.trim());
    for (const key of keys) {
      assert.ok(verb.forms?.[key]?.cs?.trim(), `${verb.infinitive} ${key} needs Czech`);
      assert.ok(verb.forms?.[key]?.en?.trim(), `${verb.infinitive} ${key} needs English`);
    }
  }
  assert.match(controller, /FORM_KEYS = Object\.freeze\(\["1s", "2s", "3s", "1p", "2p", "3p"\]\)/);
  assert.match(controller, /FORM_LABELS/);
  assert.match(controller, /formsAreEquivalent\(state\.current\.forms\[formKey\], state\.current\.forms\[cueKey\]\)/);
  assert.match(controller, /form\?\.accepted/);
  assert.match(controller, /const FORM_BADGES/);
  assert.match(controller, /conjugation-comet-cue-verb/);
  assert.match(page, /id="verbMorphologyLegend"/);
  assert.match(page, /S = singular/);
});

test("each round has a four-choice meaning gate followed by all six forms", () => {
  assert.match(controller, /state\.meaningOptions = shuffle\(\[state\.current, \.\.\.contrasts\]\)/);
  assert.match(controller, /contrasts\.length !== 3/);
  assert.match(controller, /state\.phase = "meaning"/);
  assert.match(controller, /state\.phase = "forms"/);
  assert.match(controller, /All six forms matched\. Next verb!/);
  assert.match(controller, /window\.setTimeout\(startNextVerb, 1700\)/);
  assert.match(controller, /CaatuuLearning\?\.record\?\.\("conjugation-comet"/);
});

test("controls remain usable at touch, keyboard, mobile, and reduced-motion boundaries", () => {
  assert.match(styles, /\.conjugation-comet-match-board \.verb-match-card:focus-visible[\s\S]*?outline: 3px solid/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.conjugation-comet-match-board \.verb-match-card/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none/);
  assert.match(styles, /\.conjugation-comet-match-board\[hidden\][\s\S]*?display: none/);
});

test("the offline shell pins the game, verb data, and logo together", () => {
  for (const asset of [
    "./conjugation-comet.html",
    "./source/games/conjugation-comet/conjugation-comet.css?v=conjugation-comet-7",
    "./source/games/conjugation-comet/conjugation-comet.js?v=conjugation-comet-13",
    "./data/games/conjugation-comet/verbs.json",
    "/assets/planets/conjugation-comet.png"
  ]) assert.ok(serviceWorker.includes(`"${asset}"`), `service worker must precache ${asset}`);
});

test("browser setup and Android packaging share the exact reviewed logo", () => {
  const artifact = setupManifest.artifacts.find((entry) => entry.key === "planet-conjugation");
  assert.equal(artifact.url, "/assets/planets/conjugation-comet.png");
  assert.equal(logoBytes.byteLength, artifact.bytes);
  assert.equal(createHash("sha256").update(logoBytes).digest("hex"), artifact.sha256);
});
