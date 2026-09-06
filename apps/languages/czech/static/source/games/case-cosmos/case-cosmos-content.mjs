import { validateAuthoredExample } from "./case-cosmos-cs-policy.mjs?v=case-cosmos-policy-1";

export const CZECH_CASES = Object.freeze([
  Object.freeze({ case: "Nominative", meaning: "naming or subject", question: "Who or what is the subject?" }),
  Object.freeze({ case: "Genitive", meaning: "belonging, origin, or absence", question: "Whose? From or without whom or what?" }),
  Object.freeze({ case: "Dative", meaning: "receiver or beneficiary", question: "Who or what receives or benefits?" }),
  Object.freeze({ case: "Accusative", meaning: "direct target", question: "Who or what is the target?" }),
  Object.freeze({ case: "Vocative", meaning: "direct address", question: "Who or what is addressed?" }),
  Object.freeze({ case: "Locative", meaning: "place or topic after a preposition", question: "Where, or about whom or what?" }),
  Object.freeze({ case: "Instrumental", meaning: "companion or means", question: "With whom, or using what?" })
]);

// Prefer these checked forms as distractors, then fill from the other cases.
// Equal surface forms are deduplicated: a syncretic form is never a false answer.
export const CASE_CONTRASTS = Object.freeze(Object.fromEntries(Object.entries({
  Nominative: ["Accusative", "Vocative"],
  Genitive: ["Accusative", "Dative"],
  Dative: ["Locative", "Accusative"],
  Accusative: ["Nominative", "Genitive"],
  Vocative: ["Nominative", "Accusative"],
  Locative: ["Dative", "Instrumental"],
  Instrumental: ["Locative", "Dative"]
}).map(([name, alternatives]) => [name, Object.freeze(alternatives)])));

function requiredText(value, location, maxLength) {
  if (typeof value !== "string" || !value || value !== value.trim()
      || value !== value.normalize("NFC") || value.length > maxLength
      || /[\p{Cc}\p{Cf}<>]/u.test(value)) {
    throw new Error(`${location} needs bounded, normalized plain text without controls or markup.`);
  }
}

function exactKeys(value, keys, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${location} may contain only ${keys.join(", ")}.`);
  }
}

export function targetSpan(czech, form) {
  requiredText(czech, "Czech sentence", 160);
  requiredText(form, "Target form", 48);
  if (!/^[\p{Script=Latin}\p{M}]+$/u.test(form)) throw new Error("The target must be one Czech word.");
  const target = form.toLocaleLowerCase("cs-CZ");
  const tokens = [...czech.matchAll(/[\p{L}\p{M}\p{N}_]+(?:[-’'][\p{L}\p{M}\p{N}_]+)*/gu)];
  const matches = tokens.filter(([text]) => text.toLocaleLowerCase("cs-CZ") === target);
  if (matches.length !== 1) throw new Error("The sentence must contain exactly one whole-word target, never a substring or repeated target.");
  return Object.freeze({ start: matches[0].index, end: matches[0].index + matches[0][0].length });
}

export function validatePack(value) {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new Error("The noun bank must be a nonempty bounded list.");
  const nouns = new Set();
  const difficulties = new Set();
  const allSentences = new Set();
  const result = value.map((entry) => {
    exactKeys(entry, ["noun", "difficulty", "cases"], "Noun record");
    requiredText(entry.noun, "Noun", 48);
    const nounKey = entry.noun.toLocaleLowerCase("cs-CZ");
    if (nouns.has(nounKey)) throw new Error(`The noun bank repeats ${entry.noun}.`);
    nouns.add(nounKey);
    if (!Number.isInteger(entry.difficulty) || entry.difficulty < 1 || entry.difficulty > 3) throw new Error(`${entry.noun} needs difficulty 1, 2, or 3.`);
    difficulties.add(entry.difficulty);
    exactKeys(entry.cases, CZECH_CASES.map(({ case: name }) => name), entry.noun);
    const cases = Object.fromEntries(CZECH_CASES.map(({ case: name }, index) => {
      const example = entry.cases[name];
      exactKeys(example, ["form", "english", "czech"], `${entry.noun}, ${name}`);
      requiredText(example.english, "English translation", 200);
      const span = targetSpan(example.czech, example.form);
      const sentenceKey = example.czech.toLocaleLowerCase("cs-CZ");
      if (allSentences.has(sentenceKey)) throw new Error(`Repeated Czech sentence: ${example.czech}`);
      allSentences.add(sentenceKey);
      validateAuthoredExample(entry.noun, name, index, example, span);
      return [name, Object.freeze({ form: example.form, english: example.english, czech: example.czech })];
    }));
    return Object.freeze({ noun: entry.noun, difficulty: entry.difficulty, cases: Object.freeze(cases) });
  });
  if (difficulties.size !== 3) throw new Error("The noun bank must support all three difficulty levels.");
  return Object.freeze(result);
}

export function buildRounds(pack, difficulty) {
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) throw new Error("Invalid Case Cosmos difficulty.");
  return Object.freeze(validatePack(pack).filter((entry) => entry.difficulty <= difficulty)
    .sort((a, b) => a.difficulty - b.difficulty)
    .map((entry) => Object.freeze({ noun: entry.noun, difficulty: entry.difficulty,
      matches: Object.freeze(CZECH_CASES.map((definition) => Object.freeze({ ...definition, ...entry.cases[definition.case] })))
    })));
}

function randomIndex(length, random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Question randomness must be a number in [0, 1).");
  return Math.floor(value * length);
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomIndex(index + 1, random);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function buildQuestions(round, random = Math.random) {
  if (!round || round.matches?.length !== 7 || new Set(round.matches.map((entry) => entry.case)).size !== 7
      || round.matches.some((entry) => !Object.hasOwn(CASE_CONTRASTS, entry.case))) {
    throw new Error("A noun round must contain exactly one example of each Czech case.");
  }
  for (const example of round.matches) {
    const caseIndex = CZECH_CASES.findIndex((entry) => entry.case === example.case);
    requiredText(example.english, "English translation", 200);
    validateAuthoredExample(round.noun, example.case, caseIndex, example, targetSpan(example.czech, example.form));
  }
  return Object.freeze(shuffled(round.matches, random).map((example) => {
    const actualCase = CZECH_CASES.find((entry) => entry.case === example.case);
    const target = targetSpan(example.czech, example.form);
    const preferred = CASE_CONTRASTS[example.case].map((name) => round.matches.find((entry) => entry.case === name).form);
    const forms = [...new Set([...preferred, ...shuffled(round.matches, random).map((entry) => entry.form)])]
      .filter((form) => form !== example.form);
    const alternatives = forms.slice(0, 1 + randomIndex(3, random));
    const candidates = shuffled([...alternatives, example.form], random).map((form) => {
      const visible = target.start === 0 ? form[0].toLocaleUpperCase("cs-CZ") + form.slice(1) : form;
      const czech = example.czech.slice(0, target.start) + visible + example.czech.slice(target.end);
      return Object.freeze({ ...actualCase, form, czech, english: example.english,
        target: targetSpan(czech, form), matches: form === example.form });
    });
    return Object.freeze({ ...actualCase, form: example.form, czech: example.czech,
      english: example.english, target, candidates: Object.freeze(candidates) });
  }));
}
