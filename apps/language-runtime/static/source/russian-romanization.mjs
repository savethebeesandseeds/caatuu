// BGN/PCGN romanization for modern Russian, for English readers.
// ё is written yo/yó rather than ë/yë so the guide stays ASCII-plus-accents.
// ъ is ʺ (U+02BA) and ь is ʹ (U+02B9). An authored combining acute (U+0301)
// is copied onto the Latin vowel only. This is a written-letter reading aid,
// not an assertion of native-reviewed pronunciation or a phonetic transcription.
const SIMPLE = Object.freeze({
  а: "a", б: "b", в: "v", г: "g", д: "d", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "ʺ", ы: "y", ь: "ʹ", э: "e", ю: "yu", я: "ya"
});
const VOWELS = new Set("аеёиоуыэюя");
const ACUTE = Object.freeze({ a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý" });
const CYRILLIC_WORD = /\p{Script=Cyrillic}/u;
const ACUTE_MARK = "\u0301";

function stressMark(latin) {
  const chars = [...latin];
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const marked = ACUTE[chars[index]];
    if (!marked) continue;
    chars[index] = marked;
    return chars.join("");
  }
  return null;
}

function projectWord(surface) {
  // NFC folds е + diaeresis into ё before mapping. The caller keeps the
  // original surface so a declined unit never rewrites the authored spelling.
  const letters = [...surface.normalize("NFC").toLocaleLowerCase("ru")];
  if (!letters.length) return null;
  let latin = "";
  let previous = "";
  for (const letter of letters) {
    if (letter === ACUTE_MARK) {
      if (!VOWELS.has(previous)) return null;
      latin = stressMark(latin);
      if (latin === null) return null;
      continue;
    }
    if (/\p{M}/u.test(letter)) return null;
    let mapped;
    if (letter === "е") {
      mapped = !previous || VOWELS.has(previous) || previous === "ъ" || previous === "ь" ? "ye" : "e";
    } else if (letter === "ё") mapped = "yo";
    else if (letter === "я") mapped = "ya";
    else if (letter === "ю") mapped = "yu";
    else mapped = SIMPLE[letter];
    if (!mapped) return null;
    latin += mapped;
    previous = letter;
  }
  return latin || null;
}

/** Exact whole-word alignment; spacing, numbers and punctuation carry no guide. */
export function russianReadingUnits(text) {
  const surface = String(text ?? "");
  return [...surface.matchAll(/[\p{L}\p{M}]+|[^\p{L}\p{M}]+/gu)].map(([part]) => ({
    surface: part,
    notation: /^[\p{L}\p{M}]+$/u.test(part) && CYRILLIC_WORD.test(part) ? projectWord(part) : null
  }));
}

/** Returns null when any Cyrillic word is outside the modern alphabet or stress rules. */
export function romanizeRussian(text) {
  const units = russianReadingUnits(text);
  if (!units.some(unit => unit.notation)) return null;
  if (units.some(unit => /^[\p{L}\p{M}]+$/u.test(unit.surface)
    && CYRILLIC_WORD.test(unit.surface) && !unit.notation)) return null;
  return units.map(unit => unit.notation ?? unit.surface).join("");
}
