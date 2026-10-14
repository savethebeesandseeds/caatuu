import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { georgianReadingUnits, romanizeGeorgian } from "../static/source/georgian-romanization.mjs";

test("modern Georgian national readings cover every letter and preserve consonant contrasts", () => {
  const pairs = [
    ["ა", "a"], ["ბ", "b"], ["გ", "g"], ["დ", "d"], ["ე", "e"], ["ვ", "v"],
    ["ზ", "z"], ["თ", "t"], ["ი", "i"], ["კ", "k'"], ["ლ", "l"], ["მ", "m"],
    ["ნ", "n"], ["ო", "o"], ["პ", "p'"], ["ჟ", "zh"], ["რ", "r"], ["ს", "s"],
    ["ტ", "t'"], ["უ", "u"], ["ფ", "p"], ["ქ", "k"], ["ღ", "gh"], ["ყ", "q'"],
    ["შ", "sh"], ["ჩ", "ch"], ["ც", "ts"], ["ძ", "dz"], ["წ", "ts'"], ["ჭ", "ch'"],
    ["ხ", "kh"], ["ჯ", "j"], ["ჰ", "h"]
  ];
  for (const [letter, reading] of pairs) {
    assert.equal(romanizeGeorgian(letter), reading, letter);
    assert.equal(romanizeGeorgian(letter.toUpperCase()), reading, `${letter}: Mtavruli`);
  }
  assert.equal(romanizeGeorgian("თტ ქკ ფპ ცწ ჩჭ"), "tt' kk' pp' tsts' chch'");
});

test("Georgian whole-word readings preserve exact surfaces and practical expressions", () => {
  const cases = {
    "ქართული": "kartuli", "გამარჯობა": "gamarjoba", "მადლობა": "madloba",
    "თბილისი": "tbilisi", "წიგნი": "ts'igni", "ჭამა": "ch'ama", "ყოფნა": "q'opna",
    "მასწავლებელი წერილს წერს.": "masts'avlebeli ts'erils ts'ers.",
    "გამარჯობა,  მეგობარო! 12": "gamarjoba,  megobaro! 12"
  };
  for (const [surface, reading] of Object.entries(cases)) {
    assert.equal(romanizeGeorgian(surface), reading, surface);
    assert.equal(georgianReadingUnits(surface).map(unit => unit.surface).join(""), surface);
  }
  assert.deepEqual(georgianReadingUnits("Ქართული, hello!"), [
    { surface: "Ქართული", notation: "kartuli" }, { surface: ", ", notation: null },
    { surface: "hello", notation: null }, { surface: "!", notation: null }
  ]);
  assert.equal(romanizeGeorgian("ა჻ბ"), "a჻b", "historic punctuation remains plain");
});

test("unsupported historical letters, mixed words and marks do not receive guessed readings", () => {
  for (const surface of ["", "hello", "123!", "ჱ", "ჲ", "ჳ", "ჴ", "ჵ", "Ⴀ", "ⴀ", "ქართულიa", "ა́"]) {
    assert.equal(romanizeGeorgian(surface), null, surface);
  }
  assert.equal(romanizeGeorgian("გამარჯობა ჱ"), null);
  assert.deepEqual(georgianReadingUnits("გამარჯობა ჱ"), [
    { surface: "გამარჯობა", notation: "gamarjoba" }, { surface: " ", notation: null },
    { surface: "ჱ", notation: null }
  ]);
  assert.equal(romanizeGeorgian("hello ქართული"), "hello kartuli");
});

test("every whole Georgian word in each enabled game catalog has an aligned reading", async () => {
  const catalogRoot = new URL("../../languages/georgian/static/data/games/", import.meta.url);
  const directories = await readdir(catalogRoot, { withFileTypes: true });
  const collect = (value, words) => {
    if (typeof value === "string") {
      for (const [word] of value.matchAll(/[\p{L}\p{M}]+/gu)) {
        if (/\p{Script=Georgian}/u.test(word)) words.add(word);
      }
    } else if (Array.isArray(value)) value.forEach(item => collect(item, words));
    else if (value && typeof value === "object") Object.values(value).forEach(item => collect(item, words));
  };
  for (const directory of directories.filter(entry => entry.isDirectory())) {
    const gameRoot = new URL(`${directory.name}/`, catalogRoot);
    const words = new Set();
    for (const file of await readdir(gameRoot)) {
      if (!file.endsWith(".json")) continue;
      collect(JSON.parse(await readFile(new URL(file, gameRoot), "utf8")), words);
    }
    assert.ok(words.size > 0, `${directory.name} exposes its Georgian learning words`);
    assert.deepEqual([...words].filter(word => romanizeGeorgian(word) === null), [], directory.name);
    for (const word of words) {
      const units = georgianReadingUnits(word);
      assert.equal(units.length, 1, `${directory.name}: one unit per word`);
      assert.equal(units[0].surface, word, `${directory.name}: preserve authored text`);
    }
  }
});
