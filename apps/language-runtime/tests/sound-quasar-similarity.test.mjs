import assert from "node:assert/strict";
import test from "node:test";
import { buildSoundQuasarRound, validateSoundQuasarCatalog } from "../static/source/games/sound-quasar/sound-quasar-core.mjs";

function catalogFor(words, { mandarin = false } = {}) {
  const items = words.map((word, index) => {
    const { target, notation, difficulty = 1 } = typeof word === "string" ? { target: word } : word;
    const id = `word-${index}`;
    return {
      id, revision: "v1", target, meaning: `Meaning ${index}`, englishAuditText: `Meaning ${index}`,
      sourceId: id, sourceReviewStatus: "pending", difficulty,
      ...(notation ? { reading: {
        system: "pinyin", status: "machine-assisted-preview",
        sourcePath: "apps/languages/mandarin-simplified/static/data/games/word-world/reading-guides.json",
        sourceId: id, tokens: [{ surface: target, units: [{ surface: target, notation }] }]
      } } : {})
    };
  });
  return validateSoundQuasarCatalog({
    schemaVersion: 1, gameId: "sound-quasar", courseId: mandarin ? "zh" : "es-en",
    targetLanguageId: mandarin ? "zh" : "en", learnerBaseLanguage: "en", auditLanguage: "en",
    id: "similarity-fixture", contentRevision: "v1", mode: "practice",
    audio: { kind: "device-speech", locale: mandarin ? "zh-CN" : "en-US", reviewStatus: "unreviewed", purpose: "listening-practice" },
    provenance: {
      sourcePath: `apps/languages/${mandarin ? "mandarin-simplified" : "english-from-spanish"}/static/data/games/verb-nebula/content.json`,
      sourceItemIds: items.map(item => item.sourceId), selection: "Synthetic selection test fixture."
    }, items
  });
}

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test("similar word options favor nearby eligible words while varying sets and answer positions", () => {
  const nearby = ["bat", "hat", "mat", "rat", "sat", "pat", "fat", "vat", "cap", "can"];
  const catalog = catalogFor(["cat", ...nearby, "encyclopedia", "photography", "refrigerator", "understanding", { target: "cab", difficulty: 3 }]);
  for (const choiceCount of [4, 6]) {
    const sets = new Set();
    const positions = new Set();
    for (let seed = 1; seed <= 24; seed += 1) {
      const round = buildSoundQuasarRound(catalog, { choiceCount, difficulty: 1, random: seededRandom(seed) });
      const alternatives = round.choices.filter(choice => choice.id !== round.answerId);
      assert.equal(round.choices.length, choiceCount);
      assert.equal(new Set(round.choices.map(choice => choice.id)).size, choiceCount);
      assert.equal(alternatives.length, choiceCount - 1);
      assert.ok(alternatives.every(choice => nearby.includes(choice.target)));
      sets.add(alternatives.map(choice => choice.id).sort().join(","));
      positions.add(round.choices.findIndex(choice => choice.id === round.answerId));
    }
    assert.ok(sets.size > 1, "nearby combinations vary");
    assert.equal(positions.size, choiceCount, "the answer can occupy every position");
  }
});

test("similar word options use existing Pinyin while preserving the displayed characters and tones", () => {
  const nearby = [["麻", "má"], ["马", "mǎ"], ["骂", "mà"], ["猫", "māo"], ["毛", "máo"], ["帽", "mào"]];
  const words = [["妈", "mā"], ...nearby, ["桌", "zhuō"], ["听", "tīng"], ["喝", "hē"], ["书", "shū"], ["去", "qù"]];
  const catalog = catalogFor(words.map(([target, notation]) => ({ target, notation })), { mandarin: true });
  for (let seed = 1; seed <= 12; seed += 1) {
    const round = buildSoundQuasarRound(catalog, { random: seededRandom(seed) });
    for (const choice of round.choices) {
      if (choice.id !== round.answerId) assert.ok(nearby.some(([target]) => target === choice.target));
      assert.equal(choice.reading.tokens[0].units[0].notation, words.find(([target]) => target === choice.target)[1]);
    }
  }
});

test("similar word options handle a small eligible pool without duplicates or harder vocabulary", () => {
  const catalog = catalogFor(["cat", "bat", "hat", { target: "mat", difficulty: 3 }]);
  const round = buildSoundQuasarRound(catalog, { difficulty: 1, choiceCount: 4, random: seededRandom(1) });
  assert.deepEqual(new Set(round.choices.map(choice => choice.target)), new Set(["cat", "bat", "hat"]));
});
