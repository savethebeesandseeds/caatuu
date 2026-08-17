import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const launcherRoot = new URL("../../../../apps/launcher/static/", import.meta.url);
const [page, styles, launcherStyles, controller, gamesPage, serviceWorker, setupManifest, planetBytes, pack] = await Promise.all([
  readFile(new URL("case-cosmos.html", staticRoot), "utf8"),
  readFile(new URL("source/games/case-cosmos/case-cosmos.css", staticRoot), "utf8"),
  readFile(new URL("source/games/case-cosmos/launcher.css", staticRoot), "utf8"),
  readFile(new URL("source/games/case-cosmos/case-cosmos.js", staticRoot), "utf8"),
  readFile(new URL("index.html", staticRoot), "utf8"),
  readFile(new URL("sw.js", staticRoot), "utf8"),
  readFile(new URL("setup-assets.json", staticRoot), "utf8").then(JSON.parse),
  readFile(new URL("assets/planets/case-cosmos.png", launcherRoot)),
  readFile(new URL("data/games/case-cosmos/challenges.json", staticRoot), "utf8").then(JSON.parse)
]);

test("Case Cosmos lazy-mounts from the shared Games selector while its standalone route remains compatible", () => {
  assert.match(gamesPage, /<button class="train-world train-world-case"[^>]*data-train-tab="case-cosmos"[^>]*aria-label="Open Case Cosmos"/);
  assert.match(gamesPage, /source\/games\/case-cosmos\/launcher\.css\?v=case-cosmos-launcher-1/);
  assert.match(gamesPage, /\/assets\/planets\/case-cosmos\.png[\s\S]*?<b>Case Cosmos<\/b>/);
  assert.match(gamesPage, /id="caseCosmosEmbeddedGame"[^>]*data-src="case-cosmos\.html"[^>]*data-embedded-game="case-cosmos"/);
  assert.match(launcherStyles, /\.train-world-case \{/);
  const trigger = gamesPage.match(/<button class="train-world train-world-case"[\s\S]*?<\/button>/)?.[0] || "";
  assert.doesNotMatch(trigger, /\bhref=|data-course-game/);

  assert.match(page, /class="games-page case-cosmos-page"/);
  assert.match(page, /data-caatuu-page-title="Case Cosmos"/);
  assert.match(page, /data-caatuu-header-back-href="index\.html"/);
  assert.match(page, /source\/games\/case-cosmos\/case-cosmos\.css\?v=case-cosmos-1/);
  assert.match(page, /source\/games\/case-cosmos\/case-cosmos\.js\?v=case-cosmos-6/);
  assert.doesNotMatch(controller, /conjugation-comet|verb-nebula|word-net/);
});

test("the direct JSON keeps the first Case Cosmos content boundary small and inspectable", () => {
  const caseNames = ["Nominative", "Genitive", "Dative", "Accusative", "Vocative", "Locative", "Instrumental"];
  assert.ok(Array.isArray(pack));
  assert.equal(pack.length, 18);
  assert.equal(pack.flatMap((entry) => Object.values(entry.cases)).length, 126);
  assert.deepEqual(Object.fromEntries([1, 2, 3].map((level) => [level, pack.filter((entry) => entry.difficulty === level).length])), {
    1: 12,
    2: 4,
    3: 2
  });
  assert.doesNotMatch(JSON.stringify(pack), /"(?:id|meaning|question|prompt|review|source|url|language|lesson|rounds|summary|cue|focus|note)"/i);

  for (const entry of pack) {
    assert.deepEqual(Object.keys(entry), ["noun", "difficulty", "cases"]);
    assert.ok(entry.noun?.trim());
    assert.ok(Number.isInteger(entry.difficulty) && entry.difficulty >= 1 && entry.difficulty <= 3);
    assert.deepEqual(Object.keys(entry.cases), caseNames);
    for (const example of Object.values(entry.cases)) {
      assert.deepEqual(Object.keys(example), ["form", "english", "czech"]);
      assert.ok(example.form?.trim());
      assert.ok(example.english?.trim());
      assert.ok(example.czech?.trim());
      assert.ok(example.czech.toLocaleLowerCase("cs-CZ").includes(example.form.toLocaleLowerCase("cs-CZ")));
    }
  }
});

test("the beginner lesson uses one side-to-side meaning match instead of technical choices", () => {
  for (const id of [
    "caseCosmosSituationOptions",
    "caseCosmosSentenceOptions",
    "caseCosmosResult",
    "caseCosmosResultKicker",
    "caseCosmosPatterns",
    "caseCosmosGrammarSummary",
    "caseCosmosFeedback"
  ]) assert.match(page, new RegExp(`id="${id}"`));

  assert.match(page, /Everyday situation/);
  assert.match(page, /Czech sentence/);
  assert.match(page, /Show the base questions/);
  assert.doesNotMatch(page, /Choose construction|Choose noun form|genitive|locative|accusative/);
  assert.match(controller, /state\.phase = "matching"/);
  assert.match(controller, /state\.phase = "complete"/);
  assert.match(controller, /const CZECH_CASES = Object\.freeze/);
  assert.match(controller, /function buildRounds\(pack, difficulty\)/);
  assert.match(controller, /\.filter\(\(entry\) => entry\.difficulty <= difficulty\)/);
  assert.match(controller, /function configureDifficulty\(\)/);
  assert.match(controller, /state\.pack = pack/);
  assert.match(controller, /event\.detail\?\.reason !== "difficulty"/);
  assert.match(controller, /function chooseSituation\(index\)/);
  assert.match(controller, /function chooseSentence\(index\)/);
  assert.match(controller, /\.case-cosmos-grammar"\)\.open = false/);
  assert.match(controller, /record\(\{ activities: 1, attempts: 1, successes: correct \? 1 : 0/);
  assert.doesNotMatch(controller, /chooseConstruction|chooseForm|constructionChoice|formChoice/);
  assert.doesNotMatch(controller, /innerHTML/);
});

test("the base stays fixed while eighteen difficulty-ranked noun pages demonstrate all seven cases", () => {
  const examples = pack.flatMap((entry) => Object.values(entry.cases));
  for (const [caseName, meaning, question] of [
    ["Nominative", "naming or subject", "Who or what is the subject?"],
    ["Genitive", "belonging, origin, or absence", "Whose? From or without whom or what?"],
    ["Dative", "receiver or beneficiary", "Who or what receives or benefits?"],
    ["Accusative", "direct target", "Who or what is the target?"],
    ["Vocative", "direct address", "Who or what is addressed?"],
    ["Locative", "place or topic after a preposition", "Where, or about whom or what?"],
    ["Instrumental", "companion or means", "With whom, or using what?"]
  ]) {
    assert.match(controller, new RegExp(`case: "${caseName}"[^\n]+meaning: "${meaning}"[^\n]+question: "${question.replace(/[?]/g, "\\?")}"`));
  }
  assert.deepEqual(pack.map((entry) => entry.noun), [
    "Petr", "Jana", "kamarád", "učitelka", "kotě", "Tomáš",
    "doktor", "maminka", "Marie", "Karel", "tatínek", "hrdina",
    "Anna", "Eva", "Martin", "David", "student", "soused"
  ]);
  assert.deepEqual(Object.values(pack[0].cases).map((example) => example.form), [
    "Petr", "Petra", "Petrovi", "Petra", "Petře", "Petrovi", "Petrem"
  ]);
  assert.ok(examples.some((example) => example.czech === "Petr čte."));
  assert.ok(examples.some((example) => example.czech === "Dopis je od Petra."));
  assert.ok(examples.some((example) => example.czech === "Dávám Petrovi knihu."));
  assert.ok(examples.some((example) => example.czech === "Vidím Petra."));
  assert.ok(examples.some((example) => example.czech === "Petře, pojď sem!"));
  assert.ok(examples.some((example) => example.czech === "Mluvím o Petrovi."));
  assert.ok(examples.some((example) => example.czech === "Jdu s Petrem."));
  assert.ok(examples.some((example) => example.czech === "Jdu s Janou."));
  assert.ok(examples.some((example) => example.czech === "Cestuji s kamarádem."));
  assert.ok(examples.some((example) => example.czech === "Jdu s učitelkou."));
  assert.ok(examples.some((example) => example.czech === "Jdu s kotětem."));
  assert.ok(examples.some((example) => example.czech === "Jdu s Tomášem."));
  assert.ok(examples.some((example) => example.czech === "Mluvím s doktorem."));
  assert.ok(examples.some((example) => example.czech === "Jdu s maminkou."));
  assert.ok(examples.some((example) => example.czech === "Jdu s Marií."));
  assert.ok(examples.some((example) => example.czech === "Jdu s Karlem."));
  assert.ok(examples.some((example) => example.czech === "Jdu s tatínkem."));
  assert.ok(examples.some((example) => example.czech === "Jdu s hrdinou."));
  assert.ok(examples.some((example) => example.czech === "Jdu s Annou."));
  assert.ok(examples.some((example) => example.czech === "Pracuji s Evou."));
  assert.ok(examples.some((example) => example.czech === "Cestuji s Martinem."));
  assert.ok(examples.some((example) => example.czech === "Pracuji s Davidem."));
  assert.ok(examples.some((example) => example.czech === "Pracuji se studentem."));
  assert.ok(examples.some((example) => example.czech === "Jdu se sousedem."));
  assert.doesNotMatch(JSON.stringify(pack), /The woman is cooking|Žena vaří|The doer|Who is it about/i);
  assert.doesNotMatch(JSON.stringify(pack), /motion means accusative/i);
});

test("Case Cosmos remains accessible at keyboard, touch, mobile, and reduced-motion boundaries", () => {
  assert.match(styles, /\.case-cosmos-option:focus-visible[\s\S]*?outline: 3px solid/);
  assert.match(styles, /\.case-cosmos-option \{[\s\S]*?min-height: 72px/);
  assert.match(styles, /@media \(max-width: 380px\)[\s\S]*?grid-template-columns: 1fr/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/);
  assert.match(page, /role="status" aria-live="polite" aria-atomic="true"/);
});

test("the offline and Android setup boundaries include the Case Cosmos slice", () => {
  for (const asset of [
    "./case-cosmos.html",
    "./source/games/case-cosmos/launcher.css?v=case-cosmos-launcher-1",
    "./source/games/case-cosmos/case-cosmos.css?v=case-cosmos-1",
    "./source/games/case-cosmos/case-cosmos.js?v=case-cosmos-6",
    "./data/games/case-cosmos/challenges.json?v=case-cosmos-data-5",
    "/assets/planets/case-cosmos.png"
  ]) assert.ok(serviceWorker.includes(`"${asset}"`), `service worker must precache ${asset}`);

  const artifact = setupManifest.artifacts.find((entry) => entry.key === "planet-case-cosmos");
  assert.equal(artifact.url, "/assets/planets/case-cosmos.png");
  assert.equal(planetBytes.byteLength, artifact.bytes);
  assert.equal(createHash("sha256").update(planetBytes).digest("hex"), artifact.sha256);
});
