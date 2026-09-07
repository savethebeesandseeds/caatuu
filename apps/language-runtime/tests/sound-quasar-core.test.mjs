import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildSoundQuasarRound,
  createSoundQuasarSession,
  evaluateSoundQuasarChoice,
  validateSoundQuasarCatalog
} from "../static/source/games/sound-quasar/sound-quasar-core.mjs";

const repositoryRoot = new URL("../../../", import.meta.url);
const courses = [
  { courseId: "cz", targetLanguageId: "cs", directory: "czech", locale: "cs-CZ" },
  { courseId: "zh", targetLanguageId: "zh", directory: "mandarin-simplified", locale: "zh-CN" },
  { courseId: "es", targetLanguageId: "es", directory: "spanish", locale: "es-ES" }
];
const documents = new Map(await Promise.all(courses.map(async (course) => [
  course.courseId,
  JSON.parse(await readFile(new URL(`apps/languages/${course.directory}/static/data/games/sound-quasar/content.json`, repositoryRoot), "utf8"))
])));

function sample() {
  return structuredClone(documents.get("es"));
}

function seededRandom(seed) {
  let current = seed;
  return () => {
    current = (Math.imul(current, 1664525) + 1013904223) >>> 0;
    return current / 4294967296;
  };
}

for (const course of courses) {
  test(`${course.courseId} listening pilot preserves exact source vocabulary and review provenance`, async () => {
    const catalog = validateSoundQuasarCatalog(documents.get(course.courseId), course);
    assert.equal(catalog.audio.locale, course.locale);
    assert.equal(catalog.mode, "practice");
    assert.equal(catalog.audio.reviewStatus, "unreviewed");
    assert.equal(catalog.audio.purpose, "listening-practice");
    assert.equal(catalog.items.length, 16);
    assert.equal(catalog.provenance.sourcePath, `apps/languages/${course.directory}/static/data/games/verb-nebula/content.json`);
    const original = JSON.parse(await readFile(new URL(catalog.provenance.sourcePath, repositoryRoot), "utf8"));
    for (const item of catalog.items) {
      const source = item.sourceId.startsWith("/")
        ? original[Number(item.sourceId.slice(1))]
        : original.find(({ id }) => id === item.sourceId);
      assert.ok(source, `source record exists: ${item.sourceId}`);
      assert.equal(item.target, source.target ?? source.cs);
      assert.equal(item.meaning, source.source ?? source.en);
      assert.equal(item.englishAuditText, source.source ?? source.en);
      assert.equal(item.sourceReviewStatus, source.reviewStatus ?? "not-declared");
    }
    const session = createSoundQuasarSession(catalog, { random: seededRandom(12) });
    assert.equal(session.length, 5);
    assert.equal(new Set(session.map(({ answerId }) => answerId)).size, 5);
  });

  test(`${course.courseId} sentence mode uses existing Word World sentences and exact English audit text`, async () => {
    const catalog = validateSoundQuasarCatalog(documents.get(course.courseId), course);
    assert.equal(catalog.sentences.length, 16);
    const source = JSON.parse(await readFile(new URL(catalog.sentenceProvenance.sourcePath, repositoryRoot), "utf8"));
    const english = JSON.parse(await readFile(new URL(catalog.sentenceProvenance.englishSourcePath, repositoryRoot), "utf8"));
    for (const item of catalog.sentences) {
      const original = (source.records ?? source.realizations).find(record => (record.id ?? record.conceptId) === item.sourceId);
      assert.ok(original, `sentence source exists: ${item.sourceId}`);
      assert.equal(item.target, original.cs ?? original.text);
      assert.equal(item.sourceReviewStatus, original.review?.status ?? source.review?.status ?? "not-declared");
      const englishText = original.en ?? english.concepts.find(({ id }) => id === item.sourceId).englishText;
      assert.equal(item.meaning, englishText);
      assert.equal(item.englishAuditText, englishText);
    }
    for (let seed = 1; seed <= 20; seed += 1) {
      const session = createSoundQuasarSession(catalog, { mode: "sentences", random: seededRandom(seed) });
      assert.equal(session.length, 5);
      assert.equal(new Set(session.map(({ answerId }) => answerId)).size, 5);
      for (const round of session) {
        assert.equal(round.mode, "sentences");
        assert.equal(round.choices.length, 4);
        assert.equal(new Set(round.choices.map(({ target }) => target)).size, 4);
        assert.ok(round.choices.every(choice => catalog.sentences.some(item => item.id === choice.id && item.target === choice.target)));
        assert.equal(round.choices.filter(choice => evaluateSoundQuasarChoice(round, choice.id)).length, 1);
      }
    }
  });
}

test("Mandarin word and sentence readings preserve the exact source units and target order", async () => {
  const catalog = validateSoundQuasarCatalog(documents.get("zh"));
  const guides = JSON.parse(await readFile(new URL(catalog.sentences[0].reading.sourcePath, repositoryRoot), "utf8"));
  for (const item of [...catalog.items, ...catalog.sentences]) {
    const reading = item.reading;
    const original = guides.entries.find(entry => entry.conceptId === reading.sourceId);
    assert.equal(reading.status, guides.status);
    assert.equal(reading.system, guides.system);
    for (const token of reading.tokens) {
      assert.deepEqual(token, original.tokens.find(source => source.surface === token.surface));
      assert.equal(token.units.map(({ surface }) => surface).join(""), token.surface);
      assert.equal(Object.isFrozen(token.units), true);
      assert.equal(Object.isFrozen(token.units[0]), true);
    }
    assert.equal(Object.isFrozen(reading), true);
    assert.equal(Object.isFrozen(reading.tokens), true);
  }
  const need = catalog.items.find(item => item.target === "需要");
  assert.deepEqual(need.reading.tokens[0].units, [{ surface: "需", notation: "xū" }, { surface: "要", notation: "yào" }]);
  for (const mode of ["words", "sentences"]) {
    const round = buildSoundQuasarRound(catalog, { mode, random: () => 0 });
    assert.ok(round.reading.tokens.length);
    assert.ok(round.choices.every(choice => choice.reading.tokens.length));
  }
});

test("reading validation rejects mismatched, reordered, partial, or promoted guide content", () => {
  for (const mutate of [
    raw => { raw.sentences[0].reading.tokens.reverse(); },
    raw => { raw.items[0].reading.tokens[0].surface = "有"; },
    raw => { raw.items[3].reading.tokens[0].units.pop(); },
    raw => { raw.sentences[0].reading.tokens.pop(); },
    raw => { raw.items[0].reading.status = "reviewed"; },
    raw => { raw.items[0].reading.tokens[0].units[0].notation = "<i>shì</i>"; },
    raw => { raw.items[0].reading.sourcePath = "../../outside.json"; }
  ]) {
    const raw = structuredClone(documents.get("zh"));
    mutate(raw);
    assert.throws(() => validateSoundQuasarCatalog(raw), TypeError);
  }
});

test("sentence choices reject punctuation-only duplicates and invalid sentence provenance", () => {
  for (const mutate of [
    raw => { raw.sentences[1].target = raw.sentences[0].target.replace(/\p{P}/gu, "") + "!"; },
    raw => { raw.sentences[0].target = "x".repeat(241); },
    raw => { raw.sentences = raw.sentences.slice(0, 3); },
    raw => { raw.sentences[0].id = raw.items[0].id; },
    raw => { raw.sentenceProvenance.sourceItemIds.reverse(); },
    raw => { raw.sentenceProvenance.sourcePath = "apps/languages/czech/static/data/games/word-world/content.json"; },
    raw => { raw.sentenceProvenance.englishSourcePath = "../unknown.json"; }
  ]) {
    const raw = sample();
    mutate(raw);
    assert.throws(() => validateSoundQuasarCatalog(raw), TypeError);
  }
});

test("word-only catalogs stay compatible and unknown or unavailable modes fail explicitly", () => {
  const raw = sample();
  delete raw.sentences;
  delete raw.sentenceProvenance;
  const catalog = validateSoundQuasarCatalog(raw);
  assert.equal(createSoundQuasarSession(catalog)[0].mode, "words");
  assert.throws(() => createSoundQuasarSession(catalog, { mode: "sentences" }), /does not contain sentences/u);
  assert.throws(() => createSoundQuasarSession(catalog, { mode: "unknown" }), /mode/u);
});

test("catalog validation copies and deeply freezes the selected content", () => {
  const raw = sample();
  const catalog = validateSoundQuasarCatalog(raw);
  raw.items[0].target = "changed";
  raw.provenance.sourceItemIds[0] = "changed";
  assert.notEqual(catalog.items[0].target, "changed");
  assert.notEqual(catalog.provenance.sourceItemIds[0], "changed");
  for (const value of [catalog, catalog.items, catalog.items[0], catalog.audio, catalog.provenance, catalog.provenance.sourceItemIds]) {
    assert.equal(Object.isFrozen(value), true);
  }
});

test("catalog rejects another course, target language, and unrelated speech locale", () => {
  assert.throws(() => validateSoundQuasarCatalog(sample(), { courseId: "zh" }), /different course/u);
  assert.throws(() => validateSoundQuasarCatalog(sample(), { targetLanguageId: "zh" }), /different target language/u);
  const raw = sample();
  raw.audio.locale = "cs-CZ";
  assert.throws(() => validateSoundQuasarCatalog(raw), /locale/u);
});

test("device speech cannot be promoted to assessed or reviewed audio by changing metadata", () => {
  for (const mutate of [
    (raw) => { raw.mode = "assessment"; },
    (raw) => { raw.audio.reviewStatus = "reviewed"; },
    (raw) => { raw.audio.kind = "recording"; },
    (raw) => { raw.audio.purpose = "pronunciation-assessment"; }
  ]) {
    const raw = sample();
    mutate(raw);
    assert.throws(() => validateSoundQuasarCatalog(raw), /practice/u);
  }
});

test("ambiguous target options include normalized Unicode, case, and whitespace duplicates", () => {
  for (const [first, second] of [["café", "cafe\u0301"], ["hola", "HOLA"], ["buen día", "buen  día"]]) {
    const raw = sample();
    raw.items[0].target = first;
    raw.items[1].target = second;
    assert.throws(() => validateSoundQuasarCatalog(raw), /unique/u);
  }
  const raw = sample();
  raw.items[0].target = "ser / estar";
  assert.throws(() => validateSoundQuasarCatalog(raw), /alternative/u);
});

test("target NFC normalization preserves diacritics instead of merging distinct words", () => {
  const raw = sample();
  raw.items[0].target = "cafe\u0301";
  raw.items[1].target = "cafe";
  const catalog = validateSoundQuasarCatalog(raw);
  assert.equal(catalog.items[0].target, "café");
  assert.equal(catalog.items[1].target, "cafe");
});

test("invalid provenance, duplicate IDs, missing English text, and unbounded content fail before playback", () => {
  for (const mutate of [
    (raw) => { raw.items = raw.items.slice(0, 3); },
    (raw) => { raw.items[1].id = raw.items[0].id; },
    (raw) => { raw.items[1].sourceId = raw.items[0].sourceId; },
    (raw) => { raw.provenance.sourceItemIds[0] = "other"; },
    (raw) => { raw.provenance.sourcePath = "../../outside.json"; },
    (raw) => { raw.items[0].target = "<b>word</b>"; },
    (raw) => { raw.items[0].target = "word\nword"; },
    (raw) => { raw.items[0].target = "a".repeat(81); },
    (raw) => { raw.items[0].meaning = " "; },
    (raw) => { delete raw.items[0].englishAuditText; },
    (raw) => { delete raw.items[0].sourceReviewStatus; }
  ]) {
    const raw = sample();
    mutate(raw);
    assert.throws(() => validateSoundQuasarCatalog(raw), TypeError);
  }
});

test("each sampled round has one correct answer and three distinct catalog distractors", () => {
  const catalog = validateSoundQuasarCatalog(sample());
  const answerPositions = new Set();
  for (let seed = 1; seed <= 40; seed += 1) {
    const session = createSoundQuasarSession(catalog, { random: seededRandom(seed), roundLength: catalog.items.length });
    assert.equal(new Set(session.map(({ answerId }) => answerId)).size, catalog.items.length);
    for (const round of session) {
      assert.equal(round.choices.length, 4);
      assert.equal(new Set(round.choices.map(({ target }) => target)).size, 4);
      assert.equal(round.choices.filter(({ id }) => id === round.answerId).length, 1);
      assert.equal(round.target, catalog.items.find(({ id }) => id === round.answerId).target);
      assert.equal(Object.isFrozen(round.choices), true);
      answerPositions.add(round.choices.findIndex(({ id }) => id === round.answerId));
      for (const choice of round.choices) {
        assert.ok(catalog.items.some(({ id, target }) => id === choice.id && target === choice.target));
        assert.equal(evaluateSoundQuasarChoice(round, choice.id), choice.id === round.answerId);
      }
    }
  }
  assert.deepEqual([...answerPositions].sort(), [0, 1, 2, 3]);
});

test("round building cycles explicit indices and caps finite sessions without duplicate answers", () => {
  const catalog = validateSoundQuasarCatalog(sample());
  const first = buildSoundQuasarRound(catalog, { index: 0, random: () => 0 });
  const repeated = buildSoundQuasarRound(catalog, { index: catalog.items.length, random: () => 0 });
  assert.deepEqual(first, repeated);
  const session = createSoundQuasarSession(catalog, { roundLength: 100, random: () => 0 });
  assert.equal(session.length, catalog.items.length);
  assert.equal(new Set(session.map(({ answerId }) => answerId)).size, catalog.items.length);
  assert.equal(Object.isFrozen(session), true);
});

test("invalid choices and invalid random or round parameters are rejected", () => {
  const catalog = validateSoundQuasarCatalog(sample());
  const round = buildSoundQuasarRound(catalog, { random: () => 0 });
  assert.throws(() => evaluateSoundQuasarChoice(round, "not-an-option"), /not an option/u);
  assert.throws(() => evaluateSoundQuasarChoice(round, { id: round.answerId }), /not an option/u);
  for (const index of [-1, 1.5, NaN]) assert.throws(() => buildSoundQuasarRound(catalog, { index }), /index/u);
  for (const choiceCount of [1, 20, 2.5]) assert.throws(() => buildSoundQuasarRound(catalog, { choiceCount }), /choiceCount/u);
  for (const roundLength of [0, -1, 2.5]) assert.throws(() => createSoundQuasarSession(catalog, { roundLength }), /roundLength/u);
  for (const value of [1, -0.1, NaN, Infinity, "0.5"]) {
    assert.throws(() => createSoundQuasarSession(catalog, { random: () => value }), /random/u);
  }
});
