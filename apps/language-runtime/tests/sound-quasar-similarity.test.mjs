import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSoundQuasarRound, createSoundQuasarSession, evaluateSoundQuasarChoice, soundQuasarItemsForDifficulty, validateSoundQuasarCatalog } from "../static/source/games/sound-quasar/sound-quasar-core.mjs";

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
    const round = buildSoundQuasarRound(catalog, { difficulty: 1, random: seededRandom(seed) });
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

test("real Mandarin homophones never compete as isolated-word listening answers", async () => {
  const catalog = validateSoundQuasarCatalog(JSON.parse(await readFile(new URL(
    "../../languages/mandarin-simplified/static/data/games/sound-quasar/content.json", import.meta.url
  ), "utf8")));
  for (const peers of [["是", "试", "事"], ["浇水", "胶水"], ["页", "夜"], ["响起", "想起"]]) {
    for (const target of peers) {
      const item = catalog.items.find(item => item.target === target);
      assert.ok(item, `${target} exists in the authored listening inventory`);
      const eligible = soundQuasarItemsForDifficulty(catalog, { difficulty: item.difficulty });
      const index = eligible.findIndex(candidate => candidate.id === item.id);
      for (const choiceCount of [4, 6]) for (let seed = 1; seed <= 24; seed += 1) {
        const round = buildSoundQuasarRound(catalog, { index, difficulty: item.difficulty, choiceCount, random: seededRandom(seed) });
        assert.equal(round.target, target);
        assert.equal(round.choices.length, choiceCount);
        assert.ok(round.choices.filter(choice => choice.id !== round.answerId).every(choice => !peers.includes(choice.target)),
          `${target} must not compete against another word with the same sound`);
        assert.equal(round.choices.filter(choice => evaluateSoundQuasarChoice(round, choice.id)).length, 1);
      }
    }
  }
});

test("word rounds retain tone contrasts and cap options by distinct authored sounds", () => {
  const catalog = catalogFor([
    { target: "是", notation: "shì" }, { target: "事", notation: "shi\u0300" },
    { target: "试", notation: "shì" }, { target: "诗", notation: "shī" },
    { target: "时", notation: "shí" }, { target: "史", notation: "shǐ" }
  ], { mandarin: true });
  for (let seed = 1; seed <= 16; seed += 1) {
    const round = buildSoundQuasarRound(catalog, { index: 0, difficulty: 1, choiceCount: 6, random: seededRandom(seed) });
    assert.deepEqual(new Set(round.choices.map(choice => choice.target)), new Set(["是", "诗", "时", "史"]));
    const session = createSoundQuasarSession(catalog, { difficulty: 1, roundLength: 6, choiceCount: 6, random: seededRandom(seed) });
    assert.equal(new Set(session.map(round => round.answerId)).size, 6, "homophones remain reachable as separate answer encounters");
    assert.ok(session.every(round => round.choices.length === 4));
    assert.ok(session.every(round => round.choices.filter(choice => evaluateSoundQuasarChoice(round, choice.id)).length === 1));
  }
});

test("a badge containing only homophones reports no playable isolated-word rounds", () => {
  const catalog = catalogFor([
    { target: "是", notation: "shì" }, { target: "事", notation: "shì" },
    { target: "试", notation: "shì" }, { target: "市", notation: "shì" },
    { target: "诗", notation: "shī", difficulty: 2 }, { target: "史", notation: "shǐ", difficulty: 2 }
  ], { mandarin: true });
  assert.deepEqual(soundQuasarItemsForDifficulty(catalog, { difficulty: 1 }), []);
  assert.throws(() => buildSoundQuasarRound(catalog, { difficulty: 1 }), /at least two eligible/u);
  assert.throws(() => createSoundQuasarSession(catalog, { difficulty: 1 }), /at least two eligible/u);
  assert.ok(soundQuasarItemsForDifficulty(catalog, { difficulty: 2 }).length >= 2);
});

test("an adaptive homophone cohort keeps its answers and borrows only eligible sound contrasts", () => {
  const catalog = catalogFor([
    { target: "是", notation: "shì" }, { target: "事", notation: "shì" },
    { target: "试", notation: "shì" }, { target: "市", notation: "shì" },
    { target: "诗", notation: "shī" }, { target: "史", notation: "shǐ" },
    { target: "时", notation: "shí", difficulty: 2 }
  ], { mandarin: true });
  const selected = catalog.items.slice(0, 4);
  const session = createSoundQuasarSession(catalog, { difficulty: 1, roundLength: 4, choiceCount: 4,
    random: seededRandom(19), history: {}, policy: {
      identity: { courseId: "zh", gameId: "sound-quasar", bankId: "words" },
      select: () => ({ items: selected, trace: {} })
    }
  });
  assert.deepEqual(session.map(round => round.answerId), selected.map(item => item.id));
  for (const round of session) {
    assert.equal(round.choices.length, 3);
    assert.deepEqual(new Set(round.choices.filter(choice => choice.id !== round.answerId).map(choice => choice.target)), new Set(["诗", "史"]));
    assert.equal(round.choices.filter(choice => evaluateSoundQuasarChoice(round, choice.id)).length, 1);
  }
});
