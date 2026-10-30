import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { romanizeRussian, russianReadingUnits } from "../static/source/russian-romanization.mjs";

const stress = (word, index) => {
  let seen = 0;
  const out = [];
  for (const char of word.normalize("NFC")) {
    out.push(char);
    if ("аеёиоуыэюя".includes(char)) {
      if (seen === index) out.push("\u0301");
      seen += 1;
    }
  }
  return out.join("").normalize("NFC");
};

test("BGN/PCGN readings cover the modern alphabet and keep consonant contrasts", () => {
  const pairs = [
    ["а", "a"], ["б", "b"], ["в", "v"], ["г", "g"], ["д", "d"], ["е", "ye"],
    ["ё", "yo"], ["ж", "zh"], ["з", "z"], ["и", "i"], ["й", "y"], ["к", "k"],
    ["л", "l"], ["м", "m"], ["н", "n"], ["о", "o"], ["п", "p"], ["р", "r"],
    ["с", "s"], ["т", "t"], ["у", "u"], ["ф", "f"], ["х", "kh"], ["ц", "ts"],
    ["ч", "ch"], ["ш", "sh"], ["щ", "shch"], ["ъ", "ʺ"], ["ы", "y"], ["ь", "ʹ"],
    ["э", "e"], ["ю", "yu"], ["я", "ya"]
  ];
  for (const [letter, reading] of pairs) {
    assert.equal(romanizeRussian(letter), reading, letter);
    assert.equal(romanizeRussian(letter.toLocaleUpperCase("ru")), reading, `${letter}: capital`);
  }
  assert.equal(romanizeRussian("шщ ий"), "shshch iy");
  assert.notEqual(romanizeRussian("ш"), romanizeRussian("щ"));
  assert.equal(romanizeRussian("ы"), romanizeRussian("й"));
});

test("ye, yo and stress follow the authored letter, not a guessed pronunciation", () => {
  assert.equal(romanizeRussian("съезд"), "sʺyezd");
  assert.equal(romanizeRussian("семья"), "semʹya");
  assert.equal(romanizeRussian("поезд"), "poyezd");
  assert.equal(romanizeRussian("диета"), "diyeta");
  assert.equal(romanizeRussian("ёлка"), "yolka");
  assert.equal(romanizeRussian("всё"), "vsyo");
  assert.equal(romanizeRussian("ещё"), "yeshchyo");
  assert.equal(romanizeRussian(stress("ёлка", 0)), "yólka");
  assert.equal(romanizeRussian(stress("всё", 0)), "vsyó");
  assert.equal(romanizeRussian(stress("живёшь", 1)), "zhivyóshʹ");
  assert.equal(romanizeRussian(stress("море", 0)), "móre");
  assert.equal(romanizeRussian(stress("если", 0)), "yésli");
  assert.equal(romanizeRussian(stress("семья", 1)), "semʹyá");
  assert.equal(romanizeRussian(stress("подъезд", 1)), "podʺyézd");
  assert.equal(romanizeRussian(stress("это", 0)), "éto");
  assert.equal(romanizeRussian(stress("есть", 0)), "yéstʹ");
  assert.equal(romanizeRussian("е"), "ye");
  assert.equal(romanizeRussian("э"), "e");
  assert.equal(romanizeRussian("как-нибудь"), "kak-nibudʹ");
});

test("Russian whole-word readings preserve exact surfaces", () => {
  const sea = stress("море", 0);
  assert.equal(romanizeRussian(`${sea}, hello! 12`), "móre, hello! 12");
  assert.equal(russianReadingUnits(`${sea}, hello!`).map(unit => unit.surface).join(""), `${sea}, hello!`);
  assert.deepEqual(russianReadingUnits("Мо́ре hello"), [
    { surface: "Мо́ре", notation: "móre" },
    { surface: " ", notation: null },
    { surface: "hello", notation: null }
  ]);
});

test("unsupported letters, mixed words and misplaced stress do not receive guessed readings", () => {
  for (const surface of ["", "hello", "123!", "і", "ѣ", "ѳ", "ѵ", "мо́реa", "б\u0301", "ё\u0308"]) {
    assert.equal(romanizeRussian(surface), null, surface);
  }
  assert.equal(romanizeRussian("мо́ре і"), null);
  assert.equal(romanizeRussian(`hello ${stress("море", 0)}`), "hello móre");
  assert.equal(romanizeRussian("е\u0308"), "yo", "NFC folds the diaeresis into ё inside the word");
});

test("every whole Russian word in each enabled game catalog has an aligned reading", async () => {
  const catalogRoot = new URL("../../languages/russian/static/data/games/", import.meta.url);
  const directories = await readdir(catalogRoot, { withFileTypes: true });
  const collect = (value, words) => {
    if (typeof value === "string") {
      for (const [word] of value.matchAll(/[\p{L}\p{M}]+/gu)) {
        if (/\p{Script=Cyrillic}/u.test(word)) words.add(word);
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
    assert.ok(words.size > 0, `${directory.name} exposes its Russian learning words`);
    assert.deepEqual([...words].filter(word => romanizeRussian(word) === null), [], directory.name);
    for (const word of words) {
      const units = russianReadingUnits(word);
      assert.equal(units.map(unit => unit.surface).join(""), word, `${directory.name}: preserve authored text`);
    }
  }
});
