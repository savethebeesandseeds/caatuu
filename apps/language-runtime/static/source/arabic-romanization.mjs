// A pedagogical projection of the course's written vowels, not a claim of
// native-reviewed pronunciation or a complete bibliographic transliteration.
// Keep connected Arabic words intact: a ruby unit is never an isolated letter.
const CONSONANTS = Object.freeze({
  ب: "b", ت: "t", ث: "th", ج: "j", ح: "ḥ", خ: "kh", د: "d", ذ: "dh",
  ر: "r", ز: "z", س: "s", ش: "sh", ص: "ṣ", ض: "ḍ", ط: "ṭ", ظ: "ẓ",
  ع: "ʿ", غ: "gh", ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n",
  ه: "h", و: "w", ي: "y", ء: "ʾ", أ: "ʾ", إ: "ʾ", ؤ: "ʾ", ئ: "ʾ"
});
const VOWELS = Object.freeze({ "َ": "a", "ُ": "u", "ِ": "i", "ً": "an", "ٌ": "un", "ٍ": "in" });
const SUN_LETTERS = new Set("تثدذرزسشصضطظلن");
const MARKS = /^[\u064b-\u0652\u0670]*$/u;
const ARABIC_WORD = /^[\u0621-\u063a\u0641-\u064a\u064b-\u0652\u0670\u0671]+$/u;

// These common words omit predictable vowel letters in normal Arabic spelling.
// The repairs are exact lexical authorities, never a rule that fills arbitrary
// missing vowels. The authored Arabic surfaces remain unchanged.
const SPELLING_REPAIRS = new Map(Object.entries({
  "يا": "يَا", "لا": "لَا", "ما": "مَا", "لي": "لِي", "في": "فِي",
  "هَذَا": "هَاذَا", "هَذِهِ": "هَاذِهِ", "هَذَانِ": "هَاذَانِ",
  "ذَلِكَ": "ذَالِكَ", "لِذَلِكَ": "لِذَالِكَ",
  "لِهَذَا": "لِهَاذَا", "لِهَذِهِ": "لِهَاذِهِ", "كَهَذَا": "كَهَاذَا",
  "كَهَذِهِ": "كَهَاذِهِ", "بِهَذِهِ": "بِهَاذِهِ",
  "اسْمي": "اِسْمِي", "سَاعِدْني": "سَاعِدْنِي", "أُخْتي": "أُخْتِي",
  "حَقِيبَتي": "حَقِيبَتِي", "سَنَلْتَقي": "سَنَلْتَقِي", "لِأَنَّني": "لِأَنَّنِي",
  "سَاعَدَتْني": "سَاعَدَتْنِي", "نَصَحْتَني": "نَصَحْتَنِي",
  "المُؤَكَّدةِ": "المُؤَكَّدَةِ",
  "إِلى": "إِلَى", "لِينا": "لِينَا", "أَنا": "أَنَا", "آتيَ": "آتِيَ"
}).map(([surface, repair]) => [surface.normalize("NFC"), repair.normalize("NFC")]));
const LEXICAL_READINGS = new Map(Object.entries({
  "الَّذِي": "alladhī", "الَّتي": "allatī", "الَّتِي": "allatī",
  "الَّذِينَ": "alladhīna", "اللَّذَانِ": "alladhāni", "اللَّذَيْنِ": "alladhayni",
  "اللَّاتِي": "allātī"
}).map(([surface, reading]) => [surface.normalize("NFC"), reading]));

function repairSpelling(word) {
  if (SPELLING_REPAIRS.has(word)) return SPELLING_REPAIRS.get(word);
  // Every current inflection of lākin retains its conventional unwritten ā.
  return word.replace(/^([وف]َ)?لَكِن/u, "$1لَاكِن");
}

function clusters(word) {
  return [...word.matchAll(/[^\p{M}]\p{M}*/gu)].map(([surface]) => ({
    letter: surface[0], marks: surface.slice(1)
  }));
}

function shortVowel(marks) {
  const found = [...marks].filter(mark => Object.hasOwn(VOWELS, mark));
  return found.length === 1 ? VOWELS[found[0]] : found.length === 0 ? "" : null;
}

function isAttachedPrefix({ letter, marks }) {
  const vowel = shortVowel(marks);
  return (["و", "ف", "ك"].includes(letter) && vowel === "a")
    || (["ب", "ل"].includes(letter) && vowel === "i");
}

function projectClusters(letters, omitInitialHamza = true) {
  let reading = "";
  for (let index = 0; index < letters.length; index += 1) {
    const { letter, marks } = letters[index];
    if (!MARKS.test(marks)) return null;
    const vowel = shortVowel(marks);
    if (vowel === null || (vowel && marks.includes("ْ"))) return null;
    const last = index === letters.length - 1;
    const previous = letters[index - 1];
    if (letter === "ا" || letter === "ى" || letter === "ٱ") {
      if (index === 0) {
        if (letter === "ى") return null;
        // Written wasl vowel wins. Otherwise the fully vowel-marked imperative
        // has initial u before a third-letter u; the other course wasl forms
        // begin with i. No short vowels are inferred inside the stem.
        const wasl = vowel || (letters[2]?.marks.includes("ُ") ? "u" : "i");
        reading += wasl;
      } else if (letter !== "ى" && index <= 2 && letters.slice(0, index).every(isAttachedPrefix)
        && (letters[index + 1]?.marks.includes("ْ") || letters[index + 1]?.marks.includes("ّ"))) {
        // Hamzat al-wasl disappears after an attached preposition/conjunction.
      } else if (!vowel && reading.endsWith("an")) {
        // Accusative tanwin's support alif (or alif maqsura) is silent.
      } else if (!vowel && letter === "ا" && last && previous?.letter === "و"
        && (reading.endsWith("ū") || previous.marks.includes("ْ"))) {
        // The plural verb ending's orthographic alif is silent: -ū / -aw.
      } else if (!vowel && reading.endsWith("a")) {
        reading = `${reading.slice(0, -1)}ā`;
      } else {
        return null;
      }
      continue;
    }
    if (letter === "آ") {
      if (vowel || marks.includes("ّ") || marks.includes("ْ")) return null;
      reading += index === 0 && omitInitialHamza ? "ā" : "ʾā";
      continue;
    }
    if (letter === "ة") {
      if (!last) return null;
      if (vowel) reading += `t${vowel}`;
      else if (reading.endsWith("ā")) reading += "h";
      else if (!reading.endsWith("a")) return null;
      continue;
    }
    const consonant = CONSONANTS[letter];
    if (!consonant) return null;
    if ((letter === "و" || letter === "ي") && !marks) {
      const short = letter === "و" ? "u" : "i";
      if (reading.endsWith(short)) {
        reading = `${reading.slice(0, -1)}${letter === "و" ? "ū" : "ī"}`;
        continue;
      }
    }
    // Omitted final case vowels are ordinary citation forms. Missing vowels
    // inside a word would create an invented reading, so do not annotate it.
    if (!vowel && !marks.includes("ْ") && !last) return null;
    const initialHamza = omitInitialHamza && index === 0 && ["ء", "أ", "إ", "ؤ", "ئ"].includes(letter);
    reading += initialHamza ? "" : consonant;
    if (marks.includes("ّ")) reading += consonant;
    reading += vowel;
    if (marks.includes("ٰ")) {
      if (!reading.endsWith("a")) return null;
      reading = `${reading.slice(0, -1)}ā`;
    }
  }
  return reading || null;
}

function projectWord(surface) {
  let word = surface.normalize("NFC");
  if (!ARABIC_WORD.test(word)) return null;
  if (LEXICAL_READINGS.has(word)) return LEXICAL_READINGS.get(word);
  word = repairSpelling(word);
  const letters = clusters(word);
  let articleIndex = -1, articleLength = 2;
  for (let index = 0; index <= 2 && index < letters.length - 2; index += 1) {
    const prefix = letters.slice(0, index);
    const allowedPrefix = prefix.every(isAttachedPrefix);
    const afterLam = letters[index + 2];
    const waslStem = SUN_LETTERS.has(afterLam?.letter) && !afterLam.marks.includes("ّ");
    const lamVowel = shortVowel(letters[index + 1]?.marks ?? "");
    const articleLam = !lamVowel || (lamVowel === "i" && afterLam?.letter === "ا");
    if (allowedPrefix && letters[index]?.letter === "ا" && letters[index + 1]?.letter === "ل"
      && articleLam && !waslStem) {
      articleIndex = index;
      break;
    }
  }
  if (articleIndex < 0 && letters[0]?.letter === "ل" && shortVowel(letters[0].marks) === "i"
    && letters[1]?.letter === "ل" && letters.length > 2) {
    articleIndex = 1;
    articleLength = 1;
  }
  if (articleIndex < 0) return projectClusters(letters);
  const prefix = articleIndex > 0 ? projectClusters(letters.slice(0, articleIndex)) : "";
  if (prefix === null) return null;
  const stem = letters.slice(articleIndex + articleLength).map(cluster => ({ ...cluster }));
  const first = stem[0];
  const assimilated = SUN_LETTERS.has(first?.letter) && first.marks.includes("ّ");
  if (assimilated) first.marks = first.marks.replace("ّ", "");
  const stemReading = projectClusters(stem, false);
  if (!stemReading) return null;
  return `${prefix ? `${prefix}-` : ""}${articleIndex === 0 ? "a" : ""}${assimilated ? CONSONANTS[first.letter] : "l"}-${stemReading}`;
}

/** Exact, whole-word alignment; whitespace and punctuation carry no guide. */
export function arabicReadingUnits(text) {
  const surface = String(text ?? "");
  return [...surface.matchAll(/[\p{L}\p{M}]+|[^\p{L}\p{M}]+/gu)].map(([part]) => ({
    surface: part,
    notation: /\p{Script=Arabic}/u.test(part) ? projectWord(part) : null
  }));
}

/** Returns null for any Arabic word whose written vowels are insufficient. */
export function romanizeArabic(text) {
  const units = arabicReadingUnits(text);
  if (!units.some(unit => unit.notation)) return null;
  if (units.some(unit => /\p{Script=Arabic}/u.test(unit.surface) && !unit.notation)) return null;
  return units.map(unit => unit.notation ?? unit.surface).join("");
}
