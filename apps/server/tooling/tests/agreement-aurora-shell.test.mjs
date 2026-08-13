import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const launcherRoot = new URL("../../../../apps/launcher/static/", import.meta.url);
const [page, styles, launcherStyles, controller, gamesPage, chrome, serviceWorker, setupManifest, planetBytes, pack] = await Promise.all([
  readFile(new URL("agreement-aurora.html", staticRoot), "utf8"),
  readFile(new URL("source/games/agreement-aurora/agreement-aurora.css", staticRoot), "utf8"),
  readFile(new URL("source/games/agreement-aurora/launcher.css", staticRoot), "utf8"),
  readFile(new URL("source/games/agreement-aurora/agreement-aurora.js", staticRoot), "utf8"),
  readFile(new URL("index.html", staticRoot), "utf8"),
  readFile(new URL("source/shared/chrome.js", staticRoot), "utf8"),
  readFile(new URL("sw.js", staticRoot), "utf8"),
  readFile(new URL("setup-assets.json", staticRoot), "utf8").then(JSON.parse),
  readFile(new URL("assets/planets/agreement-aurora.png", launcherRoot)),
  readFile(new URL("data/games/agreement-aurora/challenges.json", staticRoot), "utf8").then(JSON.parse)
]);

test("Agreement Aurora lazy-mounts from the shared Games selector while its standalone route remains compatible", () => {
  assert.match(gamesPage, /<button class="train-world train-world-agreement"[^>]*data-train-tab="agreement-aurora"[^>]*aria-label="Open Agreement Aurora"/);
  assert.match(gamesPage, /source\/games\/agreement-aurora\/launcher\.css\?v=agreement-aurora-launcher-1/);
  assert.match(gamesPage, /\/assets\/planets\/agreement-aurora\.png[\s\S]*?<b>Agreement Aurora<\/b>/);
  assert.match(gamesPage, /id="agreementAuroraEmbeddedGame"[^>]*data-src="agreement-aurora\.html"[^>]*data-embedded-game="agreement-aurora"/);
  assert.match(launcherStyles, /\.train-world-agreement \{/);

  assert.match(page, /class="games-page agreement-aurora-page"/);
  assert.match(page, /data-caatuu-page-title="Agreement Aurora"/);
  assert.match(page, /data-caatuu-header-back-href="index\.html"/);
  assert.match(page, /agreement-aurora\.css\?v=agreement-aurora-1/);
  assert.match(page, /agreement-aurora\.js\?v=agreement-aurora-2/);
  assert.match(chrome, /"agreement-aurora"[\s\S]*?href: "index\.html"/);
  assert.match(chrome, /\.agreement-aurora-page/);
});

test("the JSON is a direct list of eighteen adjective challenge records", () => {
  const genderNames = ["masculine", "feminine", "neuter"];
  assert.ok(Array.isArray(pack));
  assert.equal(pack.length, 18);
  assert.equal(pack.flatMap((entry) => Object.values(entry.forms).flatMap((form) => form.examples)).length, 162);
  assert.deepEqual(Object.fromEntries([1, 2, 3].map((level) => [level, pack.filter((entry) => entry.difficulty === level).length])), {
    1: 6,
    2: 6,
    3: 6
  });
  assert.doesNotMatch(JSON.stringify(pack), /"(?:id|prompt|review|source|url|language|lesson|rounds|summary|rule|gender)"/i);

  for (const entry of pack) {
    assert.deepEqual(Object.keys(entry), ["adjective", "difficulty", "forms"]);
    assert.ok(entry.adjective?.trim());
    assert.ok(Number.isInteger(entry.difficulty) && entry.difficulty >= 1 && entry.difficulty <= 3);
    assert.deepEqual(Object.keys(entry.forms), genderNames);
    assert.equal(new Set(Object.values(entry.forms).map((form) => form.form)).size, 3);
    for (const form of Object.values(entry.forms)) {
      assert.deepEqual(Object.keys(form), ["form", "examples"]);
      assert.ok(form.form?.trim());
      assert.equal(form.examples.length, 3);
      for (const example of form.examples) {
        assert.deepEqual(Object.keys(example), ["english", "czech"]);
        assert.ok(example.english?.trim());
        assert.ok(example.czech?.startsWith(`${form.form} `));
      }
    }
  }
});

test("the Agreement Aurora examples remain suitable for children", () => {
  const examples = pack.flatMap((entry) => Object.values(entry.forms).flatMap((form) => form.examples));
  assert.deepEqual(
    pack[3].forms.neuter.examples[2],
    { english: "Czech glass", czech: "české sklo" }
  );
  assert.doesNotMatch(JSON.stringify(examples), /\b(?:beer|wine|alcohol)\b|\b(?:pivo|víno|alkohol)\b/iu);
});

test("the initial learning loop is one three-gender side-to-side match", () => {
  for (const id of [
    "agreementAuroraEnglishOptions",
    "agreementAuroraCzechOptions",
    "agreementAuroraResult",
    "agreementAuroraPatterns",
    "agreementAuroraSummary",
    "agreementAuroraFeedback"
  ]) assert.match(page, new RegExp(`id="${id}"`));

  assert.match(page, /English phrase/);
  assert.match(page, /Czech phrase/);
  assert.match(controller, /const GENDERS = Object\.freeze/);
  assert.match(controller, /function buildRounds\(pack, difficulty\)/);
  assert.match(controller, /\.filter\(\(entry\) => entry\.difficulty <= difficulty\)/);
  assert.match(controller, /function chooseEnglish\(index\)/);
  assert.match(controller, /function chooseCzech\(index\)/);
  assert.match(controller, /record\(\{ activities: 1, attempts: 1, successes: correct \? 1 : 0/);
  assert.doesNotMatch(controller, /innerHTML|case-cosmos|conjugation-comet|verb-nebula/);
  assert.doesNotMatch(page, /nový dům|nová kniha|nové město/);
});

test("each page holds one adjective while the three gender forms change", () => {
  assert.deepEqual(pack.map((entry) => entry.adjective), [
    "nový", "malý", "dobrý", "český", "velký", "starý", "dlouhý", "mladý", "rychlý",
    "pomalý", "krásný", "teplý", "zajímavý", "důležitý", "chytrý", "studený", "vysoký", "krátký"
  ]);
  assert.deepEqual(Object.values(pack[0].forms).map((form) => form.form), ["nový", "nová", "nové"]);
  assert.deepEqual(Object.values(pack[0].forms).map((form) => form.examples[0].czech), ["nový dům", "nová kniha", "nové město"]);
  assert.match(controller, /function chooseExample\(form\)/);
  assert.match(controller, /The noun stays in its ordinary naming form\. The adjective changes to match the noun's gender\./);
});

test("Agreement Aurora keeps keyboard, touch, mobile, and reduced-motion boundaries", () => {
  assert.match(styles, /\.agreement-aurora-option:focus-visible[\s\S]*?outline: 3px solid/);
  assert.match(styles, /\.agreement-aurora-option \{[\s\S]*?min-height: 76px/);
  assert.match(styles, /@media \(max-width: 420px\)[\s\S]*?grid-template-columns: 1fr/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/);
  assert.match(page, /role="status" aria-live="polite" aria-atomic="true"/);
});

test("offline and Android setup boundaries include Agreement Aurora", () => {
  for (const asset of [
    "./agreement-aurora.html",
    "./source/games/agreement-aurora/launcher.css?v=agreement-aurora-launcher-1",
    "./source/games/agreement-aurora/agreement-aurora.css?v=agreement-aurora-1",
    "./source/games/agreement-aurora/agreement-aurora.js?v=agreement-aurora-2",
    "./data/games/agreement-aurora/challenges.json?v=agreement-aurora-data-3",
    "/assets/planets/agreement-aurora.png"
  ]) assert.ok(serviceWorker.includes(`"${asset}"`), `service worker must precache ${asset}`);

  const artifact = setupManifest.artifacts.find((entry) => entry.key === "planet-agreement-aurora");
  assert.equal(artifact.url, "/assets/planets/agreement-aurora.png");
  assert.equal(planetBytes.byteLength, artifact.bytes);
  assert.equal(createHash("sha256").update(planetBytes).digest("hex"), artifact.sha256);
});
