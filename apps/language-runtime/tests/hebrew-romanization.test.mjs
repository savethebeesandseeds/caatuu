import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { hebrewReadingUnits, romanizeHebrew } from "../static/source/hebrew-romanization.mjs";

const locked = [
  ["\u05E9\u05B8\u05C1\u05DC\u05D5\u05B9\u05DD", "shalom"],
  ["\u05EA\u05BC\u05D5\u05B9\u05D3\u05B8\u05D4", "toda"],
  ["\u05EA\u05BC\u05B9\u05D5\u05D3\u05B8\u05D4", "toda"],
  ["\u05D0\u05B2\u05E0\u05B4\u05D9", "ani"],
  ["\u05D1\u05BC\u05B7\u05D9\u05B4\u05EA", "bayit"],
  ["\u05E1\u05B0\u05DC\u05B4\u05D9\u05D7\u05B8\u05D4", "slikha"],
  ["\u05D1\u05B0\u05E8\u05B8\u05DB\u05B8\u05D4", "berakha"],
  ["\u05D0\u05B6\u05DC", "el"],
  ["\u05D5\u05B0\u05D4\u05B7\u05E9\u05BC\u05B8\u05C1\u05DC\u05D5\u05B9\u05DD", "vehashalom"],
  ["\u05DC\u05B4\u05E7\u05B0\u05E8\u05D5\u05B9\u05D0", "likro"],
  ["\u05D2\u05B8\u05BC\u05E8", "gar"],
  ["\u05D1\u05BC\u05B8\u05D0", "ba"],
  ["\u05D4\u05B8\u05D0\u05B8\u05D3\u05B8\u05DD", "ha'adam"],
  ["\u05E7\u05D5\u05B9\u05E8\u05B5\u05D0", "kore"],
  ["\u05E2\u05B7\u05D9\u05B4\u05DF", "'ayin"],
  ["\u05D1\u05BC\u05B8\u05D0\u05B8\u05D4", "ba'a"],
  ["\u05E8\u05D5\u05BC\u05D7\u05B7", "ruakh"],
  ["\u05E9\u05C1\u05D5\u05B9\u05DE\u05B5\u05E2\u05B7", "shome'a"],
  ["\u05D1\u05BC\u05B5\u05D9\u05EA", "bet"],
  ["\u05E8\u05D5\u05B9\u05D0\u05D5\u05B9\u05EA", "ro'ot"],
  ["\u05DC\u05B4\u05E8\u05B0\u05D0\u05D5\u05B9\u05EA", "lir'ot"]
];

test("pointed Hebrew reads with the learner Latin aid", () => {
  for (const [word, reading] of locked) {
    assert.equal(romanizeHebrew(word.normalize("NFC")), reading, word);
  }
  const shalom = locked[0][0];
  assert.equal(romanizeHebrew(`${shalom}, \u05EA\u05BC\u05D5\u05B9\u05D3\u05B8\u05D4! 12`), "shalom, toda! 12");
  assert.equal(hebrewReadingUnits(`${shalom}!`).map(unit => unit.surface).join(""), `${shalom}!`);
  assert.equal(romanizeHebrew("\u05E9\u05DC\u05D5\u05DD"), null, "an unpointed shin has no guide");
  assert.equal(romanizeHebrew("\u05E9\u05B8\u05C1\u05DC\u05D5\u05B9\u05DD hello"), "shalom hello");
  assert.equal(romanizeHebrew("\u05D1\u05B7\u05BC"), "ba", "dagesh and vowel marks may arrive in either order");
  assert.equal(romanizeHebrew("\u05D1\u05BC\u05B7"), "ba");
});

test("every whole Hebrew word in the authored banks has an aligned reading", async () => {
  const roots = [
    new URL("../../languages/hebrew/static/data/games/", import.meta.url),
    new URL("../../languages/hebrew/content/", import.meta.url)
  ];
  const collect = (value, words) => {
    if (typeof value === "string") {
      for (const [word] of value.matchAll(/[\p{L}\p{M}]+/gu)) {
        if (/\p{Script=Hebrew}/u.test(word)) words.add(word);
      }
    } else if (Array.isArray(value)) value.forEach(item => collect(item, words));
    else if (value && typeof value === "object") Object.values(value).forEach(item => collect(item, words));
  };
  const words = new Set();
  for (const root of roots) {
    const walk = async directory => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const url = new URL(entry.name, directory);
        if (entry.isDirectory()) await walk(new URL(`${entry.name}/`, directory));
        else if (entry.name.endsWith(".json")) collect(JSON.parse(await readFile(url, "utf8")), words);
      }
    };
    await walk(root);
  }
  assert.ok(words.size > 100, "the Hebrew banks expose their learning words");
  assert.deepEqual([...words].filter(word => romanizeHebrew(word) === null), []);
  for (const word of words) {
    assert.equal(hebrewReadingUnits(word).map(unit => unit.surface).join(""), word);
  }
});
