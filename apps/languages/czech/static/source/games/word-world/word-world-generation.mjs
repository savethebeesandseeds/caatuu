import { normalizeWord, tokenizeCzechSentence,
  isPlausibleSentence, sentenceTargets } from "../../../../../../language-runtime/static/source/word-net-core.mjs?v=word-net-core-23";

const targetLocale = "cs-CZ";

export function stripModelEcho(text) {
  let value = String(text || "").replace(/\r/g, "\n").trim();
  value = value.replace(/<\|[^>]+?\|>/g, " ").replace(/\s+/g, " ").trim();

  const sentenceMarker = value.match(/(?:věta|veta|sentence)\s*:\s*(.+)$/iu);
  if (sentenceMarker) value = sentenceMarker[1].trim();

  value = value
    .replace(/^(?:[-*•]|\d+[.)])\s*/u, "")
    .replace(/^["'„“”]+|["'„“”]+$/gu, "")
    .trim();

  const firstSentence = value.match(/^[^.!?]+[.!?]/u);
  if (firstSentence) value = firstSentence[0].trim();
  return value;
}

const irregularTargetForms = Object.freeze({
  pes: ["psa", "psovi", "psem", "psi", "psy", "psů", "psům", "pse"],
  dům: ["domu", "domě", "domem", "domy", "domů", "domům"],
  den: ["dne", "dni", "dny", "dnů", "dnům", "dnem"],
  dítě: ["dítěte", "dítěti", "dítětem", "děti", "dětí", "dětem", "dětmi"],
  člověk: ["člověka", "člověku", "člověkem", "člověče", "lidé", "lidí", "lidem", "lidmi"],
  stůl: ["stolu", "stole", "stolem", "stoly", "stolů", "stolům"],
  přítel: ["přítele", "příteli", "přítelem", "přátelé", "přátel", "přátelům", "přáteli"],
  kočka: ["kočce"],
  ruka: ["ruce", "rukou"],
  kniha: ["knize"],
  práce: ["práci", "prací"]
});

const vowelEndingSuffixes = Object.freeze({
  a: /^(?:a|y|u|ou|e|ě|o|ám|ami|ách)$/u,
  o: /^(?:o|a|u|ě|em|y|ům|ech)$/u,
  e: /^(?:e|i|í|eho|emu|em|eti|ete|etem|mi)$/u,
  ě: /^(?:ě|i|í|eho|emu|em|eti|ete|etem|mi)$/u
});

const consonantEndingSuffix = /^(?:a|u|ovi|em|e|i|y|ů|ům|ech|ové|é|mi)$/u;

function matchesInflectedForm(candidate, target) {
  const token = normalizeWord(candidate).toLocaleLowerCase("cs-CZ");
  const lemma = normalizeWord(target).toLocaleLowerCase("cs-CZ");
  if (!token || !lemma) return false;
  if (token === lemma) return true;
  if (irregularTargetForms[lemma]?.includes(token)) return true;

  const finalLetter = lemma.slice(-1);
  const vowelSuffixPattern = vowelEndingSuffixes[finalLetter];
  if (vowelSuffixPattern) {
    const stem = lemma.slice(0, -1);
    return stem.length >= 2 && token.startsWith(stem) && vowelSuffixPattern.test(token.slice(stem.length));
  }

  return token.startsWith(lemma) && consonantEndingSuffix.test(token.slice(lemma.length));
}

export function wordMatchesTarget(candidate, target) {
  return matchesInflectedForm(candidate, target) || matchesInflectedForm(target, candidate);
}

export function sentenceIncludesWord(sentence, word) {
  return tokenizeCzechSentence(sentence)
    .filter((token) => token.type === "word")
    .some((token) => wordMatchesTarget(token.text, word));
}

const seedWords = [
  "dům",
  "škola",
  "máma",
  "táta",
  "pes",
  "kočka",
  "voda",
  "jablko",
  "kniha",
  "kamarád",
  "město",
  "zahrada",
  "hra",
  "slunce",
  "stůl",
  "vlak",
  "ruka",
  "okno",
  "les",
  "dítě"
];

const fallbackTemplates = [
  (word) => `Ve větě se objevuje slovo „${word}“.`,
  (word) => `Dnes zkoumáme slovo „${word}“.`,
  (word) => `Slovo „${word}“ patří do našeho příběhu.`,
  (word) => `Na kartě je napsáno „${word}“.`,
  (word) => `Hra nám ukazuje slovo „${word}“.`,
  (word) => `Učitel dnes vysvětluje slovo „${word}“.`,
  (word) => `V příběhu jsme našli slovo „${word}“.`,
  (word) => `Dítě si zapisuje slovo „${word}“.`,
  (word) => `Na tabuli vidíme slovo „${word}“.`,
  (word) => `Kamarád se ptá na význam slova „${word}“.`
];

const seedEnglish = {
  dům: "house",
  škola: "school",
  máma: "mom",
  táta: "dad",
  pes: "dog",
  kočka: "cat",
  voda: "water",
  jablko: "apple",
  kniha: "book",
  kamarád: "friend",
  město: "city",
  zahrada: "garden",
  hra: "game",
  slunce: "sun",
  stůl: "table",
  vlak: "train",
  ruka: "hand",
  okno: "window",
  les: "forest",
  dítě: "child"
};

function sentencePrompt(word, { attempt = 0, recentSentences = [] } = {}) {
  const variations = [
    "Popiš konkrétní každodenní děj.",
    "Použij jiný slovesný děj a přirozený kontext.",
    "Napiš živou, ale jednoduchou větu z běžného života."
  ];
  const avoid = recentSentences.slice(0, 5).map((sentence) => `- ${sentence}`).join("\n");
  return [
    `Cíl: ${word}`,
    "Napiš jednu krátkou běžnou českou větu, která přirozeně použije cílové slovo nebo jeho správný tvar.",
    variations[Math.min(attempt, variations.length - 1)],
    avoid ? `Neopakuj tyto nedávné věty:\n${avoid}` : "",
    "Nevysvětluj. Vrať pouze větu.",
    "Věta:"
  ].filter(Boolean).join("\n");
}

function translationPrompt(sentence) {
  return `Translate this Czech sentence into simple English.\nReturn only the English sentence.\nCzech: ${sentence}\nEnglish:`;
}

function englishWordFor(word) {
  const normalized = normalizeWord(word).toLocaleLowerCase(targetLocale);
  const key = seedWords.find((seed) => wordMatchesTarget(normalized, seed)) || normalized;
  return seedEnglish[key] || key || "word";
}

function fallbackWordMeaning(word) {
  const normalized = normalizeWord(word).toLocaleLowerCase(targetLocale);
  const key = seedWords.find((seed) => wordMatchesTarget(normalized, seed)) || normalized;
  return seedEnglish[key] || "";
}

function localTranslation(sentence, word) {
  const english = englishWordFor(word);
  const capitalEnglish = english.charAt(0).toLocaleUpperCase("en-US") + english.slice(1);
  if (/^Vidím\s/i.test(sentence)) return `I see ${english} at home.`;
  if (/^Dnes máme\s/i.test(sentence)) return `Today we have ${english} in the game.`;
  if (/^Malé dítě říká\s/i.test(sentence)) return `A small child says ${english}.`;
  if (/^Ve škole slyším\s/i.test(sentence)) return `At school I hear ${english}.`;
  if (sentence.includes(" je tady")) return `${capitalEnglish} is here.`;
  return `A sentence with ${english}.`;
}

// Course-owned implementation. The shared lifecycle validates this exact declaration.
export const wordWorldGenerationProvider = Object.freeze({
  schemaVersion: 1,
  id: "czech-local-word-world-v1",
  targetLanguageTag: targetLocale,
  auditLanguageTag: "en",
  learnerBaseLanguageTag: "en",
  sentenceModelKey: "cstinyllama-1.2b-czech-word-sentence-001",
  translationModelKey: "qwen3-1.7b-translation-cs-en-001",
  seedWords: Object.freeze(seedWords),
  stopWords: Object.freeze(["a", "ale", "do", "i", "je", "jsou", "k", "na", "ne", "o", "od", "po", "pro", "se", "si", "s", "u", "v", "ve", "z", "za", "že"]),
  sentenceModelLabel: "Word Sentence CZ",
  translationModelLabel: "Czech → English Qwen",
  sentencePrompt,
  translationPrompt,
  fallbackSentences: (word) => fallbackTemplates.map(template => template(word)),
  fallbackMeaning: fallbackWordMeaning,
  fallbackTranslation: localTranslation,
  prepareSentence: stripModelEcho,
  sentenceValid: (sentence, word) => sentenceIncludesWord(sentence, word) && isPlausibleSentence(sentence),
  sentenceTargets
});

export function cleanGeneratedSentence(output, word, fallback) {
  const cleaned = stripModelEcho(output);
  return cleaned && sentenceIncludesWord(cleaned, word) ? cleaned : fallback(word);
}
