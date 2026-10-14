import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { arabicReadingUnits, romanizeArabic } from "../static/source/arabic-romanization.mjs";

test("Arabic readings preserve written long vowels, diphthongs, hamza and doubling", () => {
  const cases = {
    "كَتَبَ": "kataba", "كُتِبَ": "kutiba", "كَانَ": "kāna", "حَقِيبَة": "ḥaqība",
    "يَقُولُ": "yaqūlu", "كَبِيرٌ": "kabīrun", "بَيْت": "bayt", "سَوْفَ": "sawfa",
    "جَاءَ": "jāʾa", "أَرَادَ": "arāda", "آمَنَ": "āmana", "عَلَّمَ": "ʿallama",
    "مَرْحَبًا": "marḥaban", "كَتَبُوا": "katabū", "رَأَوْا": "raʾaw", "مَشَى": "mashā",
    "بَالُون": "bālūn", "وَالِدَةٌ": "wālidatun"
  };
  for (const [surface, notation] of Object.entries(cases)) assert.equal(romanizeArabic(surface), notation, surface);
});

test("Arabic readings handle articles, initial wasl and conventional spelling exceptions", () => {
  const cases = {
    "الْبَيْتُ": "al-baytu", "الشَّمْسُ": "ash-shamsu", "لِلشَّمْسِ": "li-sh-shamsi",
    "وَالْبَيْتُ": "wa-l-baytu", "بِالْبَيْتِ": "bi-l-bayti", "الَّذِي": "alladhī",
    "الْأَكْلِ": "al-ʾakli", "الْآنَ": "al-ʾāna",
    "احْتَاجَ": "iḥtāja", "اكْتُبْ": "uktub", "افْتَحْ": "iftaḥ",
    "هَذَا": "hādhā", "هَذِهِ": "hādhihi", "ذَلِكَ": "dhālika", "وَلَكِنَّ": "walākinna",
    "في": "fī", "اسْمي": "ismī", "الْتَمَسَ": "iltamasa",
    "بِانْتِبَاهٍ": "bintibāhin", "لِالْتِقَاطِ": "liltiqāṭi", "مِرْآة": "mirʾāh",
    "الِاجْتِمَاعُ": "al-ijtimāʿu", "بِالِاتِّصَالِ": "bi-l-ittiṣāli"
  };
  for (const [surface, notation] of Object.entries(cases)) assert.equal(romanizeArabic(surface), notation, surface);
});

test("whole-word reading units preserve exact text and decline absent or conflicting vowels", () => {
  const text = "هَذَا كِتَابٌ،  12!";
  const units = arabicReadingUnits(text);
  assert.equal(units.map(unit => unit.surface).join(""), text);
  assert.deepEqual(units.filter(unit => unit.notation), [
    { surface: "هَذَا", notation: "hādhā" }, { surface: "كِتَابٌ", notation: "kitābun" }
  ]);
  assert.equal(romanizeArabic(text), "hādhā kitābun،  12!");
  for (const surface of ["كتب", "كَتبَ", "كَِتَبَ", "كـتب", "hello", ""]) {
    assert.equal(romanizeArabic(surface), null, surface);
  }
  assert.equal(arabicReadingUnits("كَتَبَ كتب").at(-1).notation, null);
  const decomposed = "أَصْبَحَ".normalize("NFD");
  assert.equal(arabicReadingUnits(decomposed)[0].surface, decomposed);
  assert.equal(romanizeArabic(decomposed), "aṣbaḥa");
});

test("the reading projection agrees with the Arabic Nucleus authored verb readings", async () => {
  const catalog = JSON.parse(await readFile(new URL(
    "../../languages/arabic-standard/static/data/games/naturalization-nucleus/content.json", import.meta.url), "utf8"));
  for (const challenge of catalog.challenges) {
    assert.equal(romanizeArabic(challenge.target), challenge.reading, challenge.target);
  }
});

test("every whole Arabic word in each current game catalog has an aligned reading", async () => {
  const catalogRoot = new URL("../../languages/arabic-standard/static/data/games/", import.meta.url);
  const directories = await readdir(catalogRoot, { withFileTypes: true });
  const collect = (value, words) => {
    if (typeof value === "string") {
      for (const [word] of value.matchAll(/[\p{L}\p{M}]+/gu)) {
        if (/\p{Script=Arabic}/u.test(word)) words.add(word);
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
    assert.ok(words.size > 0, `${directory.name} exposes its Arabic learning words`);
    const missing = [...words].filter(word => romanizeArabic(word) === null);
    assert.deepEqual(missing, [], `${directory.name} words with insufficient reading authority`);
    for (const word of words) {
      const units = arabicReadingUnits(word);
      assert.equal(units.length, 1, `${directory.name}: a whole word stays connected`);
      assert.equal(units[0].surface, word, `${directory.name}: the authored text stays exact`);
    }
  }
});
