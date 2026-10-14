// Modern Georgian national romanization (2002, decree 109/2011), documented by
// UNGEGN: https://unstats.un.org/unsd/ungegn/working_groups/wg5/documents/wgrr4georgian.pdf
// Straight apostrophes mark ejectives. This is a written-letter reading aid,
// not an assertion of native-reviewed pronunciation or a phonetic transcription.
const LETTERS = Object.freeze({
  ა: "a", ბ: "b", გ: "g", დ: "d", ე: "e", ვ: "v", ზ: "z", თ: "t",
  ი: "i", კ: "k'", ლ: "l", მ: "m", ნ: "n", ო: "o", პ: "p'", ჟ: "zh",
  რ: "r", ს: "s", ტ: "t'", უ: "u", ფ: "p", ქ: "k", ღ: "gh", ყ: "q'",
  შ: "sh", ჩ: "ch", ც: "ts", ძ: "dz", წ: "ts'", ჭ: "ch'", ხ: "kh",
  ჯ: "j", ჰ: "h"
});
const GEORGIAN_WORD = /\p{Script=Georgian}/u;

function projectWord(surface) {
  // Unicode casing pairs Mtavruli headings with the same Mkhedruli letters.
  // Unsupported historic letters, foreign letters and combining marks decline
  // the whole unit instead of silently disappearing from the guide.
  const letters = [...surface.toLowerCase()];
  if (!letters.length || letters.some(letter => !Object.hasOwn(LETTERS, letter))) return null;
  return letters.map(letter => LETTERS[letter]).join("");
}

/** Exact whole-word alignment; spacing, numbers and punctuation carry no guide. */
export function georgianReadingUnits(text) {
  const surface = String(text ?? "");
  return [...surface.matchAll(/[\p{L}\p{M}]+|[^\p{L}\p{M}]+/gu)].map(([part]) => ({
    surface: part,
    notation: /^[\p{L}\p{M}]+$/u.test(part) && GEORGIAN_WORD.test(part) ? projectWord(part) : null
  }));
}

/** Returns null when any Georgian word is outside the modern alphabet. */
export function romanizeGeorgian(text) {
  const units = georgianReadingUnits(text);
  if (!units.some(unit => unit.notation)) return null;
  if (units.some(unit => /^[\p{L}\p{M}]+$/u.test(unit.surface)
    && GEORGIAN_WORD.test(unit.surface) && !unit.notation)) return null;
  return units.map(unit => unit.notation ?? unit.surface).join("");
}
