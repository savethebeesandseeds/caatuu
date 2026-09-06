// Bounded English -> Czech singular-noun policy, not a general grammar generator.
// Adding a noun or construction requires an explicit content review and tests.
// Evidence and review limits: docs/CASE_COSMOS_CONTENT.md.
const entries = [
  ["Petr", "Petr", "Petr", "Petr Petra Petrovi Petra Petře Petrovi Petrem"],
  ["Jana", "Jana", "Jana", "Jana Jany Janě Janu Jano Janě Janou"],
  ["kamarád", "a friend", "Friend", "kamarád kamaráda kamarádovi kamaráda kamaráde kamarádovi kamarádem"],
  ["učitelka", "the teacher", "Teacher", "učitelka učitelky učitelce učitelku učitelko učitelce učitelkou"],
  ["kotě", "the kitten", "Kitten", "kotě kotěte kotěti kotě kotě kotěti kotětem"],
  ["Tomáš", "Tomáš", "Tomáš", "Tomáš Tomáše Tomášovi Tomáše Tomáši Tomášovi Tomášem"],
  ["doktor", "the doctor", "Doctor", "doktor doktora doktorovi doktora doktore doktorovi doktorem"],
  ["maminka", "Mom", "Mom", "maminka maminky mamince maminku maminko mamince maminkou"],
  ["Marie", "Marie", "Marie", "Marie Marie Marii Marii Marie Marii Marií"],
  ["Karel", "Karel", "Karel", "Karel Karla Karlovi Karla Karle Karlovi Karlem"],
  ["tatínek", "Dad", "Dad", "tatínek tatínka tatínkovi tatínka tatínku tatínkovi tatínkem"],
  ["hrdina", "the hero", "Hero", "hrdina hrdiny hrdinovi hrdinu hrdino hrdinovi hrdinou"],
  ["Anna", "Anna", "Anna", "Anna Anny Anně Annu Anno Anně Annou"],
  ["Eva", "Eva", "Eva", "Eva Evy Evě Evu Evo Evě Evou"],
  ["Martin", "Martin", "Martin", "Martin Martina Martinovi Martina Martine Martinovi Martinem"],
  ["David", "David", "David", "David Davida Davidovi Davida Davide Davidovi Davidem"],
  ["student", "the student", "Student", "student studenta studentovi studenta studente studentovi studentem"],
  ["soused", "the neighbor", "Neighbor", "soused souseda sousedovi souseda sousede sousedovi sousedem"]
];

export const NOUN_POLICY = Object.freeze(Object.fromEntries(entries.map(([noun, english, address, forms]) =>
  [noun, Object.freeze({ english, address, forms: Object.freeze(forms.split(" ")) })])));

// These pairs CHECK an already-authored utterance. They never produce playable
// sentences by substituting arbitrary nouns. Unlisted contexts fail closed.
const contexts = {
  Nominative: [
    ["{noun} čte.", "{noun} is reading."],
    ["{noun} pracuje.", "{noun} is working."],
    ["{noun} čeká.", "{noun} is waiting."],
    ["{noun} mluví.", "{noun} is speaking."],
    ["{noun} spí.", "{noun} is sleeping."],
    ["{noun} volá.", "{noun} is calling."],
    ["{noun} přichází.", "{noun} is arriving."],
    ["{noun} kreslí.", "{noun} is drawing."],
    ["{noun} plave.", "{noun} is swimming."],
    ["{noun} fotografuje.", "{noun} is taking photographs."],
    ["{noun} běží.", "{noun} is running."],
    ["{noun} se ptá.", "{noun} is asking a question."],
    ["{noun} odpočívá.", "{noun} is resting."]
  ],
  Genitive: [
    ["Dopis je od {noun}.", "The letter is from {noun}."],
    ["Dárek je od {noun}.", "The gift is from {noun}."],
    ["Zpráva je od {noun}.", "The message is from {noun}."],
    ["E-mail je od {noun}.", "The email is from {noun}."],
    ["Pohlednice je od {noun}.", "The postcard is from {noun}."],
    ["Balíček je od {noun}.", "The package is from {noun}."],
    ["Tato kniha je od {noun}.", "This book is from {noun}."],
    ["To je miska {noun}.", "This is {noun}'s bowl."]
  ],
  Dative: [
    ["Dávám {noun} knihu.", "I am giving {noun} a book."],
    ["Dávám {noun} lístek.", "I am giving {noun} a ticket."],
    ["Dávám {noun} vodu.", "I am giving {noun} water."],
    ["Dávám {noun} klíč.", "I am giving {noun} the key."],
    ["Dávám {noun} dokument.", "I am giving {noun} a document."],
    ["Dávám {noun} mapu.", "I am giving {noun} a map."],
    ["Píšu {noun}.", "I am writing to {noun}."],
    ["Pomáhám {noun}.", "I am helping {noun}."],
    ["Půjčuji {noun} tužku.", "I am lending {noun} a pencil."],
    ["Ukazuji {noun} mapu.", "I am showing {noun} the map."],
    ["Neseme {noun} balíček.", "We are bringing {noun} a package."]
  ],
  Accusative: [
    ["Vidím {noun}.", "I see {noun}."],
    ["Znám {noun}.", "I know {noun}."]
  ],
  Vocative: [
    ["{noun}, pojď sem!", "{noun}, come here!"],
    ["{noun}, poslouchej!", "{noun}, listen!"],
    ["{noun}, počkej!", "{noun}, wait!"],
    ["Paní {noun}, prosím, podívejte se!", "{noun}, please look!"],
    ["{noun}, posaď se!", "{noun}, sit down!"],
    ["Pane {noun}, prosím, pojďte dál!", "{noun}, please come in!"],
    ["{noun}, zavolej mi!", "{noun}, call me!"],
    ["{noun}, vrať se!", "{noun}, come back!"],
    ["{noun}, pojď dál!", "{noun}, come in!"],
    ["{noun}, podívej se!", "{noun}, look!"],
    ["{noun}, prosím, pojďte dál!", "{noun}, please come in!"],
    ["{noun}, prosím, počkejte!", "{noun}, please wait!"]
  ],
  Locative: [
    ["Mluvím o {noun}.", "I am talking about {noun}."],
    ["Mluvíme o {noun}.", "We are talking about {noun}."]
  ],
  Instrumental: [
    ["Jdu s {noun}.", "I am going with {noun}."],
    ["Jdu se {noun}.", "I am going with {noun}."],
    ["Cestuji s {noun}.", "I am travelling with {noun}."],
    ["Mluvím s {noun}.", "I am talking with {noun}."],
    ["Pracuji s {noun}.", "I am working with {noun}."],
    ["Pracuji se {noun}.", "I am working with {noun}."]
  ]
};
export const CONTEXT_POLICY = Object.freeze(Object.fromEntries(Object.entries(contexts).map(([name, pairs]) =>
  [name, Object.freeze(pairs.map((pair) => Object.freeze(pair)))])));

export function assertEnglishCzechCourse(course) {
  if (course?.id !== "cz" || course.sourceLanguage?.id !== "en"
      || !/^en(?:-[A-Za-z]+)*$/u.test(course.sourceLanguage?.locale || "")
      || course.targetLanguage?.id !== "cs" || course.targetLanguage?.locale !== "cs-CZ") {
    throw new Error("Case Cosmos content requires the English -> Czech course.");
  }
}

export function validateAuthoredExample(noun, caseName, caseIndex, example, span) {
  const policy = Object.hasOwn(NOUN_POLICY, noun) ? NOUN_POLICY[noun] : null;
  if (!policy) throw new Error(`${noun} has no checked singular-noun policy; review it before adding content.`);
  if (example.form !== policy.forms[caseIndex]) throw new Error(`${noun}, ${caseName}: form differs from the checked singular form.`);
  const frame = example.czech.slice(0, span.start) + "{noun}" + example.czech.slice(span.end);
  const pair = CONTEXT_POLICY[caseName].find(([czech]) => czech === frame);
  if (!pair) throw new Error(`${noun}, ${caseName}: Czech context is outside the checked construction policy.`);
  // Titles and s/se variants are lexical constraints, not arbitrary alternatives.
  if ((frame.startsWith("Paní ") && noun !== "učitelka")
      || (frame.startsWith("Pane ") && noun !== "doktor")
      || (frame.startsWith("To je miska ") && noun !== "kotě")
      || (caseName === "Instrumental" && frame.includes(" se ") !== ["student", "soused"].includes(noun))) {
    throw new Error(`${noun}, ${caseName}: construction is not permitted for this noun.`);
  }
  const label = caseName === "Vocative" ? policy.address : policy.english;
  const translation = pair[1].replace("{noun}", label);
  const expected = translation[0].toLocaleUpperCase("en") + translation.slice(1);
  if (example.english !== expected) throw new Error(`${noun}, ${caseName}: English translation does not match its checked Czech context.`);
}
