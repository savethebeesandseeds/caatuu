// Israeli-Hebrew reading aid for English learners. Fully pointed text is the
// input. Sheva is silent except a leading וְ בְּ כְּ לְ מְ. Dagesh marks b/k/p
// and does not double a letter. This is a written-letter aid, not a
// pronunciation claim and not an answer key.
const SHEVA = "\u05B0";
const HATAF_SEGOL = "\u05B1";
const HATAF_PATAH = "\u05B2";
const HATAF_QAMATS = "\u05B3";
const HIRIQ = "\u05B4";
const TSERE = "\u05B5";
const SEGOL = "\u05B6";
const PATAH = "\u05B7";
const QAMATS = "\u05B8";
const HOLAM = "\u05B9";
const HOLAM_HASER = "\u05BA";
const QUBUTS = "\u05BB";
const DAGESH = "\u05BC";
const METEG = "\u05BD";
const RAFE = "\u05BF";
const SHIN_DOT = "\u05C1";
const SIN_DOT = "\u05C2";
const QAMATS_QATAN = "\u05C7";
const VOWEL = Object.freeze({
  [HATAF_SEGOL]: "e", [HATAF_PATAH]: "a", [HATAF_QAMATS]: "o", [HIRIQ]: "i",
  [TSERE]: "e", [SEGOL]: "e", [PATAH]: "a", [QAMATS]: "a", [HOLAM]: "o",
  [HOLAM_HASER]: "o", [QUBUTS]: "u"
});
const MATER_YOD = new Set([TSERE, SEGOL, HIRIQ]);
const HOLAM_MARKS = new Set([HOLAM, HOLAM_HASER]);
const PREFIX_SHEVA = Object.freeze({ "\u05D5": "ve", "\u05D1": "be", "\u05DB": "ke", "\u05DC": "le", "\u05DE": "me" });
const HEBREW_LETTER = /[\u05D0-\u05EA]/u;
const HEBREW_SCRIPT = /\p{Script=Hebrew}/u;

function consonant(letter, dagesh, shin, sin) {
  switch (letter) {
    case "\u05D0": return "";
    case "\u05D1": return dagesh ? "b" : "v";
    case "\u05D2": return "g";
    case "\u05D3": return "d";
    case "\u05D4": return "h";
    case "\u05D5": return "v";
    case "\u05D6": return "z";
    case "\u05D7": return "kh";
    case "\u05D8": return "t";
    case "\u05D9": return "y";
    case "\u05DB":
    case "\u05DA": return dagesh ? "k" : "kh";
    case "\u05DC": return "l";
    case "\u05DE":
    case "\u05DD": return "m";
    case "\u05E0":
    case "\u05DF": return "n";
    case "\u05E1": return "s";
    case "\u05E2": return "'";
    case "\u05E4": return dagesh ? "p" : "f";
    case "\u05E3": return "f";
    case "\u05E6":
    case "\u05E5": return "ts";
    case "\u05E7": return "k";
    case "\u05E8": return "r";
    case "\u05E9": return shin ? "sh" : sin ? "s" : null;
    case "\u05EA": return "t";
    default: return null;
  }
}

function analyze(cluster) {
  let dagesh = false;
  let shin = false;
  let sin = false;
  let vowel = null;
  for (const mark of cluster.marks) {
    if (mark === METEG || mark === RAFE) continue;
    if (mark === DAGESH) {
      if (dagesh) return null;
      dagesh = true;
      continue;
    }
    if (mark === SHIN_DOT || mark === SIN_DOT) {
      if (shin || sin) return null;
      if (mark === SHIN_DOT) shin = true;
      else sin = true;
      continue;
    }
    if (mark === QAMATS_QATAN || mark === SHEVA || Object.hasOwn(VOWEL, mark)) {
      if (vowel) return null;
      vowel = mark;
      continue;
    }
    return null;
  }
  if (cluster.letter === "\u05E9" ? !(shin || sin) : shin || sin) return null;
  if (vowel === QAMATS_QATAN) return null;
  return { letter: cluster.letter, dagesh, shin, sin, vowel };
}

function pureVowel(item) {
  if (!item || item.letter !== "\u05D5") return false;
  if (item.dagesh && !item.vowel) return true;
  return HOLAM_MARKS.has(item.vowel) && !item.dagesh;
}

function projectWord(surface) {
  const chars = [...surface.normalize("NFC")];
  if (!chars.length || chars.some(char => !HEBREW_LETTER.test(char) && !/\p{M}/u.test(char))) return null;
  const clusters = [];
  for (const char of chars) {
    if (HEBREW_LETTER.test(char)) clusters.push({ letter: char, marks: [] });
    else if (!clusters.length) return null;
    else clusters.at(-1).marks.push(char);
  }
  const letters = [];
  for (const cluster of clusters) {
    const item = analyze(cluster);
    if (!item) return null;
    letters.push(item);
  }
  let latin = "";
  let vowelEmitted = false;
  let previousVowel = null;
  let alefBreak = false;
  for (let index = 0; index < letters.length; index += 1) {
    const item = letters[index];
    const last = index === letters.length - 1;
    const next = letters[index + 1];
    const furtive = last && (item.letter === "\u05D7" || item.letter === "\u05E2") && item.vowel === PATAH;
    if (item.letter === "\u05D5") {
      const holam = HOLAM_MARKS.has(item.vowel);
      if (item.dagesh && !item.vowel) {
        if (alefBreak) latin += "'";
        latin += "u";
        vowelEmitted = true;
        previousVowel = "shuruq";
        alefBreak = false;
        continue;
      }
      if (holam && item.dagesh) return null;
      if (holam) {
        if (HOLAM_MARKS.has(previousVowel)) return null;
        if (alefBreak) latin += "'";
        latin += "o";
        vowelEmitted = true;
        previousVowel = item.vowel;
        alefBreak = false;
        continue;
      }
      if (!item.vowel && !item.dagesh && HOLAM_MARKS.has(previousVowel)) continue;
    }
    if (item.letter === "\u05D9" && !item.vowel && !item.dagesh && MATER_YOD.has(previousVowel)) continue;
    if (index === 0 && item.vowel === SHEVA && PREFIX_SHEVA[item.letter]) {
      latin += PREFIX_SHEVA[item.letter];
      vowelEmitted = true;
      previousVowel = SHEVA;
      continue;
    }
    if (last && item.letter === "\u05D4" && !item.vowel && !item.dagesh) continue;
    if (item.letter === "\u05D0") {
      if (item.vowel && item.vowel !== SHEVA) {
        if (vowelEmitted) latin += "'";
        latin += VOWEL[item.vowel];
        vowelEmitted = true;
        previousVowel = item.vowel;
      } else if (!item.vowel && pureVowel(next)) {
        alefBreak = true;
        previousVowel = null;
      } else previousVowel = item.vowel === SHEVA ? SHEVA : null;
      continue;
    }
    const base = consonant(item.letter, item.dagesh, item.shin, item.sin);
    if (base === null) return null;
    if (furtive) {
      if (alefBreak) latin += "'";
      // The stolen patah is heard before het, and before ayin. Ayin stays
      // written as an apostrophe in front of that vowel: shome'a, ruakh.
      latin += item.letter === "\u05E2" ? "'a" : `a${base}`;
      vowelEmitted = true;
      previousVowel = PATAH;
      alefBreak = false;
      continue;
    }
    if (alefBreak) alefBreak = false;
    latin += base;
    if (item.vowel && item.vowel !== SHEVA) {
      latin += VOWEL[item.vowel];
      vowelEmitted = true;
      previousVowel = item.vowel;
    } else previousVowel = item.vowel === SHEVA ? SHEVA : null;
  }
  return latin || null;
}

/** Exact whole-word alignment; spacing, numbers and punctuation carry no guide. */
export function hebrewReadingUnits(text) {
  const surface = String(text ?? "");
  return [...surface.matchAll(/[\p{L}\p{M}]+|[^\p{L}\p{M}]+/gu)].map(([part]) => ({
    surface: part,
    notation: /^[\p{L}\p{M}]+$/u.test(part) && HEBREW_SCRIPT.test(part) ? projectWord(part) : null
  }));
}

/** Returns null when any Hebrew word is outside the pointed reading rules. */
export function romanizeHebrew(text) {
  const units = hebrewReadingUnits(text);
  if (!units.some(unit => unit.notation)) return null;
  if (units.some(unit => /^[\p{L}\p{M}]+$/u.test(unit.surface)
    && HEBREW_SCRIPT.test(unit.surface) && !unit.notation)) return null;
  return units.map(unit => unit.notation ?? unit.surface).join("");
}
