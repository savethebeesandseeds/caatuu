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
  const game = page.indexOf('src="source/games/conjugation-comet/conjugation-comet.js?v=conjugation-comet-19"');
  assert.ok(semantic >= 0 && chrome > semantic && game > chrome);
  assert.doesNotMatch(page, /curriculum-service/);
  assert.match(controller, /const VERBS_URL = "data\/games\/conjugation-comet\/verbs\.json\?v=conjugation-comet-verbs-2"/);
  assert.doesNotMatch(controller, /CaatuuCurriculum|data\/curriculum|guided-opportunity/);
});

test("verbs.json supplies simple, complete six-form paradigms and fair English cues", () => {
  const labels = ["S1", "S2", "S3", "P1", "P2", "P3"];
  assert.equal(verbs.language, "cs");
  assert.ok(Array.isArray(verbs.verbs) && verbs.verbs.length >= 4);
  for (const verb of verbs.verbs) {
    assert.ok(verb.verb?.trim());
    assert.ok(verb.meaning?.trim());
    assert.equal(verb.forms?.length, 6, `${verb.verb} needs six forms`);
    assert.deepEqual(verb.forms.map((form) => form.label), labels);
    for (const form of verb.forms) {
      assert.ok(form.form?.trim(), `${verb.verb} ${form.label} needs a Czech form`);
      assert.ok(form.cue?.trim(), `${verb.verb} ${form.label} needs an English cue`);
      if (form.accepted !== undefined) {
        assert.ok(Array.isArray(form.accepted));
        assert.ok(form.accepted.every((accepted) => accepted?.trim()));
      }
    }
  }
  assert.doesNotMatch(controller, /FORM_KEYS|FORM_LABELS|FORM_BADGES|commonLevel/);
  assert.match(controller, /state\.current\.forms\.map\(\(_, index\) => String\(index\)\)/);
  assert.match(controller, /formsAreEquivalent\([\s\S]*?state\.current\.forms\[Number\(formKey\)\]/);
  assert.match(controller, /form\?\.accepted/);
  assert.match(controller, /conjugation-comet-cue-verb/);
  assert.match(controller, /label\.textContent = form\.label/);
  assert.match(styles, /\.conjugation-comet-cue-copy \{[\s\S]*?flex-direction: column/);
  assert.match(styles, /\.conjugation-comet-cue-label \{[\s\S]*?position: static;[\s\S]*?align-self: flex-end/);
  assert.match(page, /id="verbMorphologyLegend"/);
  assert.match(page, /id="conjugationCometUnavailable"[\s\S]*?<\/section>\s*<\/div>\s*<div\s+class="conjugation-comet-person-legend"/);
  assert.match(page, /<strong>S1:<\/strong> singular first person/);
  assert.match(page, /<strong>P3:<\/strong> plural third person/);
  assert.match(controller, /\$\("#verbMorphologyLegend"\)\.hidden = !formsVisible/);
  assert.match(styles, /\.conjugation-comet-person-legend\s*\{[\s\S]*?grid-template-columns/);
});

test("each round has a four-choice meaning gate followed by every authored form", () => {
  assert.match(controller, /state\.meaningOptions = shuffle\(\[state\.current, \.\.\.contrasts\]\)/);
  assert.match(controller, /contrasts\.length !== 3/);
  assert.match(controller, /state\.phase = "meaning"/);
  assert.match(controller, /state\.phase = "forms"/);
  assert.match(controller, /All forms matched\. Next verb!/);
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
    "./source/games/conjugation-comet/conjugation-comet.css?v=conjugation-comet-14",
    "./source/games/conjugation-comet/conjugation-comet.js?v=conjugation-comet-19",
    "./data/games/conjugation-comet/verbs.json?v=conjugation-comet-verbs-2",
    "/assets/planets/conjugation-comet.png"
  ]) assert.ok(serviceWorker.includes(`"${asset}"`), `service worker must precache ${asset}`);
});

test("browser setup and Android packaging share the exact reviewed logo", () => {
  const artifact = setupManifest.artifacts.find((entry) => entry.key === "planet-conjugation");
  assert.equal(artifact.url, "/assets/planets/conjugation-comet.png");
  assert.equal(logoBytes.byteLength, artifact.bytes);
  assert.equal(createHash("sha256").update(logoBytes).digest("hex"), artifact.sha256);
});
