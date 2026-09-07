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

function freezeChecked(value) {
  if (value && typeof value === "object") Object.values(value).forEach(freezeChecked);
  return value && typeof value === "object" ? Object.freeze(value) : value;
}

// Additive v2 pilot authority. These are checked authored tuples, never templates
// for generating new sentences. Separate editorial review is still pending.
// Form variants checked 2026-09-07 in Masaryk University's DICTIO:
// https://www.dictio.info/cs/translate/czj/text/st%C5%AFl/76391
// https://www.dictio.info/cs/translate/czj/text/pes/64130?lang=cs
// Student plural forms: https://prirucka.ujc.cas.cz/?slovo=student
export const CHECKED_PARADIGMS = freezeChecked({
  "cz.case.paradigm.kniha.singular": {
    "id": "cz.case.paradigm.kniha.singular",
    "noun": "kniha",
    "number": "singular",
    "forms": [
      "kniha",
      "knihy",
      "knize",
      "knihu",
      "knihou"
    ]
  },
  "cz.case.paradigm.pes.singular": {
    "id": "cz.case.paradigm.pes.singular",
    "noun": "pes",
    "number": "singular",
    "forms": [
      "pes",
      "psa",
      "psovi",
      "psu",
      "psem"
    ]
  },
  "cz.case.paradigm.okno.singular": {
    "id": "cz.case.paradigm.okno.singular",
    "noun": "okno",
    "number": "singular",
    "forms": [
      "okno",
      "okna",
      "oknu",
      "okně",
      "oknem"
    ]
  },
  "cz.case.paradigm.kvetina.singular": {
    "id": "cz.case.paradigm.kvetina.singular",
    "noun": "květina",
    "number": "singular",
    "forms": [
      "květina",
      "květiny",
      "květině",
      "květinu",
      "květinou"
    ]
  },
  "cz.case.paradigm.destnik.singular": {
    "id": "cz.case.paradigm.destnik.singular",
    "noun": "deštník",
    "number": "singular",
    "forms": [
      "deštník",
      "deštníku",
      "deštníkem"
    ]
  },
  "cz.case.paradigm.skola.singular": {
    "id": "cz.case.paradigm.skola.singular",
    "noun": "škola",
    "number": "singular",
    "forms": [
      "škola",
      "školy",
      "škole",
      "školu",
      "školou"
    ]
  },
  "cz.case.paradigm.dum.singular": {
    "id": "cz.case.paradigm.dum.singular",
    "noun": "dům",
    "number": "singular",
    "forms": [
      "dům",
      "domu",
      "domě",
      "domem"
    ]
  },
  "cz.case.paradigm.cukr.singular": {
    "id": "cz.case.paradigm.cukr.singular",
    "noun": "cukr",
    "number": "singular",
    "forms": [
      "cukr",
      "cukru",
      "cukrem"
    ]
  },
  "cz.case.paradigm.stul.singular": {
    "id": "cz.case.paradigm.stul.singular",
    "noun": "stůl",
    "number": "singular",
    "forms": [
      "stůl",
      "stolu",
      "stole",
      "stolem"
    ]
  },
  "cz.case.paradigm.zahrada.singular": {
    "id": "cz.case.paradigm.zahrada.singular",
    "noun": "zahrada",
    "number": "singular",
    "forms": [
      "zahrada",
      "zahrady",
      "zahradě",
      "zahradu",
      "zahradou"
    ]
  },
  "cz.case.paradigm.park.singular": {
    "id": "cz.case.paradigm.park.singular",
    "noun": "park",
    "number": "singular",
    "forms": [
      "park",
      "parku",
      "parkem"
    ]
  },
  "cz.case.paradigm.tuzka.singular": {
    "id": "cz.case.paradigm.tuzka.singular",
    "noun": "tužka",
    "number": "singular",
    "forms": [
      "tužka",
      "tužky",
      "tužce",
      "tužku",
      "tužkou"
    ]
  },
  "cz.case.paradigm.lzice.singular": {
    "id": "cz.case.paradigm.lzice.singular",
    "noun": "lžíce",
    "number": "singular",
    "forms": [
      "lžíce",
      "lžíci",
      "lžící",
      "lžicí"
    ]
  },
  "cz.case.paradigm.autobus.singular": {
    "id": "cz.case.paradigm.autobus.singular",
    "noun": "autobus",
    "number": "singular",
    "forms": [
      "autobus",
      "autobusu",
      "autobuse",
      "autobusem"
    ]
  },
  "cz.case.paradigm.student.plural": {
    "id": "cz.case.paradigm.student.plural",
    "noun": "student",
    "number": "plural",
    "forms": [
      "studenti",
      "studentů",
      "studentům",
      "studenty",
      "studentech"
    ]
  },
  "cz.case.paradigm.kniha.plural": {
    "id": "cz.case.paradigm.kniha.plural",
    "noun": "kniha",
    "number": "plural",
    "forms": [
      "knihy",
      "knih",
      "knihám",
      "knihách",
      "knihami"
    ]
  },
  "cz.case.paradigm.okno.plural": {
    "id": "cz.case.paradigm.okno.plural",
    "noun": "okno",
    "number": "plural",
    "forms": [
      "okna",
      "oken",
      "oknům",
      "oknech",
      "okny"
    ]
  },
  "cz.case.paradigm.soused.plural": {
    "id": "cz.case.paradigm.soused.plural",
    "noun": "soused",
    "number": "plural",
    "forms": [
      "sousedé",
      "sousedi",
      "sousedů",
      "sousedům",
      "sousedy",
      "sousedech"
    ]
  },
  "cz.case.paradigm.pavel.singular": {
    "id": "cz.case.paradigm.pavel.singular",
    "noun": "Pavel",
    "number": "singular",
    "forms": [
      "Pavel",
      "Pavla",
      "Pavlovi",
      "Pavle",
      "Pavlem"
    ]
  },
  "cz.case.paradigm.jana.singular": {
    "id": "cz.case.paradigm.jana.singular",
    "noun": "Jana",
    "number": "singular",
    "forms": [
      "Jana",
      "Jany",
      "Janě",
      "Janu",
      "Jano",
      "Janou"
    ]
  },
  "cz.case.paradigm.marie.singular": {
    "id": "cz.case.paradigm.marie.singular",
    "noun": "Marie",
    "number": "singular",
    "forms": [
      "Marie",
      "Marii",
      "Marií"
    ]
  },
  "cz.case.paradigm.petr.singular": {
    "id": "cz.case.paradigm.petr.singular",
    "noun": "Petr",
    "number": "singular",
    "forms": [
      "Petr",
      "Petra",
      "Petrovi",
      "Petře",
      "Petrem"
    ]
  }
});

export const CHECKED_CONTEXTS = freezeChecked({
  "cz.case.roles.book-subject": {
    "id": "cz.case.roles.book-subject",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.kniha.singular",
    "case": "Nominative",
    "form": "kniha",
    "acceptedForms": [],
    "czech": "Kniha leží na stole.",
    "english": "The book is lying on the table.",
    "difficulty": 1,
    "objectiveId": "cz.case.roles",
    "phase": "practice",
    "context": "Say what is lying on the table.",
    "explanation": "Kniha is the subject of leží, so it uses the nominative singular."
  },
  "cz.case.roles.read-book": {
    "id": "cz.case.roles.read-book",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.kniha.singular",
    "case": "Accusative",
    "form": "knihu",
    "acceptedForms": [],
    "czech": "Čtu knihu.",
    "english": "I am reading a book.",
    "difficulty": 1,
    "objectiveId": "cz.case.roles",
    "phase": "practice",
    "context": "Say what you are reading.",
    "explanation": "The book is the direct object of čtu. The singular accusative of kniha is knihu."
  },
  "cz.case.roles.give-dog-water": {
    "id": "cz.case.roles.give-dog-water",
    "revision": 2,
    "paradigmId": "cz.case.paradigm.pes.singular",
    "case": "Dative",
    "form": "psovi",
    "acceptedForms": [
      "psu"
    ],
    "czech": "Dávám psovi vodu.",
    "english": "I am giving the dog water.",
    "difficulty": 1,
    "objectiveId": "cz.case.roles",
    "phase": "practice",
    "context": "Identify the animal receiving the water.",
    "explanation": "The dog receives the water. Both psovi and psu are accepted dative singular forms of pes; the water is the direct object."
  },
  "cz.case.roles.open-window": {
    "id": "cz.case.roles.open-window",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.okno.singular",
    "case": "Accusative",
    "form": "okno",
    "acceptedForms": [],
    "czech": "Otevírám okno.",
    "english": "I am opening the window.",
    "difficulty": 1,
    "objectiveId": "cz.case.roles",
    "phase": "practice",
    "context": "Say what you are opening.",
    "explanation": "Okno is the direct object. Its accusative singular has the same surface form as its nominative."
  },
  "cz.case.roles.water-flower": {
    "id": "cz.case.roles.water-flower",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.kvetina.singular",
    "case": "Dative",
    "form": "květině",
    "acceptedForms": [],
    "czech": "Dávám květině vodu.",
    "english": "I am giving the flower water.",
    "difficulty": 1,
    "objectiveId": "cz.case.roles",
    "phase": "transfer",
    "context": "Use the recipient role in a plant-care situation.",
    "explanation": "The flower receives the water, so květina takes the dative form květině."
  },
  "cz.case.absence.without-umbrella": {
    "id": "cz.case.absence.without-umbrella",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.destnik.singular",
    "case": "Genitive",
    "form": "deštníku",
    "acceptedForms": [],
    "czech": "Jdu bez deštníku.",
    "english": "I am going without an umbrella.",
    "difficulty": 1,
    "objectiveId": "cz.case.absence",
    "phase": "practice",
    "context": "Say which object you do not have with you.",
    "explanation": "Bez takes the genitive. Deštníku names the umbrella that is absent."
  },
  "cz.case.absence.from-school": {
    "id": "cz.case.absence.from-school",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.skola.singular",
    "case": "Genitive",
    "form": "školy",
    "acceptedForms": [],
    "czech": "Vracím se ze školy.",
    "english": "I am coming back from school.",
    "difficulty": 1,
    "objectiveId": "cz.case.absence",
    "phase": "practice",
    "context": "Name the place you are returning from.",
    "explanation": "Ze, a form of z, takes the genitive to express origin here. Školy is the genitive singular of škola."
  },
  "cz.case.absence.house-doors": {
    "id": "cz.case.absence.house-doors",
    "revision": 2,
    "paradigmId": "cz.case.paradigm.dum.singular",
    "case": "Genitive",
    "form": "domu",
    "acceptedForms": [],
    "czech": "Dveře domu jsou zavřené.",
    "english": "The door of the house is closed.",
    "difficulty": 1,
    "objectiveId": "cz.case.absence",
    "phase": "practice",
    "context": "Say which building the door belongs to.",
    "explanation": "Domu is genitive singular and identifies the house. Czech dveře is grammatically plural even when it names one door."
  },
  "cz.case.absence.without-sugar": {
    "id": "cz.case.absence.without-sugar",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.cukr.singular",
    "case": "Genitive",
    "form": "cukru",
    "acceptedForms": [],
    "czech": "Čaj je bez cukru.",
    "english": "The tea is without sugar.",
    "difficulty": 1,
    "objectiveId": "cz.case.absence",
    "phase": "transfer",
    "context": "Apply the absence pattern to a drink order.",
    "explanation": "Bez requires the genitive here: cukr becomes cukru."
  },
  "cz.case.place.table-location": {
    "id": "cz.case.place.table-location",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.stul.singular",
    "case": "Locative",
    "form": "stole",
    "acceptedForms": [
      "stolu"
    ],
    "czech": "Kniha je na stole.",
    "english": "The book is on the table.",
    "difficulty": 2,
    "objectiveId": "cz.case.place",
    "phase": "practice",
    "context": "Describe where the book is.",
    "explanation": "Na takes the locative for this location. Both na stole and na stolu are accepted for a table."
  },
  "cz.case.place.table-destination": {
    "id": "cz.case.place.table-destination",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.stul.singular",
    "case": "Accusative",
    "form": "stůl",
    "acceptedForms": [],
    "czech": "Pokládám knihu na stůl.",
    "english": "I am putting the book on the table.",
    "difficulty": 2,
    "objectiveId": "cz.case.place",
    "phase": "practice",
    "context": "Describe the surface onto which you place the book.",
    "explanation": "Na takes the accusative for this destination: na stůl. The chosen preposition and meaning determine the case."
  },
  "cz.case.place.garden-location": {
    "id": "cz.case.place.garden-location",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.zahrada.singular",
    "case": "Locative",
    "form": "zahradě",
    "acceptedForms": [],
    "czech": "Hrajeme si na zahradě.",
    "english": "We are playing in the garden.",
    "difficulty": 2,
    "objectiveId": "cz.case.place",
    "phase": "practice",
    "context": "Describe the place where the play happens.",
    "explanation": "Na zahradě uses the locative for the place of the activity. An action does not automatically require accusative."
  },
  "cz.case.place.garden-destination": {
    "id": "cz.case.place.garden-destination",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.zahrada.singular",
    "case": "Accusative",
    "form": "zahradu",
    "acceptedForms": [],
    "czech": "Jdeme na zahradu.",
    "english": "We are going into the garden.",
    "difficulty": 2,
    "objectiveId": "cz.case.place",
    "phase": "practice",
    "context": "Describe the garden as your destination.",
    "explanation": "Na zahradu uses accusative to express this destination."
  },
  "cz.case.place.school-location": {
    "id": "cz.case.place.school-location",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.skola.singular",
    "case": "Locative",
    "form": "škole",
    "acceptedForms": [],
    "czech": "Jsme ve škole.",
    "english": "We are at school.",
    "difficulty": 2,
    "objectiveId": "cz.case.place",
    "phase": "practice",
    "context": "Say where you are.",
    "explanation": "Ve, a form of v, takes the locative for this location: ve škole."
  },
  "cz.case.place.school-destination": {
    "id": "cz.case.place.school-destination",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.skola.singular",
    "case": "Genitive",
    "form": "školy",
    "acceptedForms": [],
    "czech": "Jdeme do školy.",
    "english": "We are going to school.",
    "difficulty": 2,
    "objectiveId": "cz.case.place",
    "phase": "practice",
    "context": "Name school as your destination.",
    "explanation": "Do takes the genitive, including for a destination. Movement is not a general rule for choosing accusative."
  },
  "cz.case.place.running-in-park": {
    "id": "cz.case.place.running-in-park",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.park.singular",
    "case": "Locative",
    "form": "parku",
    "acceptedForms": [],
    "czech": "Běhám v parku.",
    "english": "I am running in the park.",
    "difficulty": 2,
    "objectiveId": "cz.case.place",
    "phase": "transfer",
    "context": "Describe the place where running happens.",
    "explanation": "V parku uses the locative for the location of running. The movement happens within that place."
  },
  "cz.case.means.write-pencil": {
    "id": "cz.case.means.write-pencil",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.tuzka.singular",
    "case": "Instrumental",
    "form": "tužkou",
    "acceptedForms": [],
    "czech": "Píšu tužkou.",
    "english": "I am writing with a pencil.",
    "difficulty": 2,
    "objectiveId": "cz.case.means",
    "phase": "practice",
    "context": "Name the tool used for writing.",
    "explanation": "Tužkou is instrumental singular: it names the tool used to write."
  },
  "cz.case.means.eat-soup-spoon": {
    "id": "cz.case.means.eat-soup-spoon",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.lzice.singular",
    "case": "Instrumental",
    "form": "lžící",
    "acceptedForms": ["lžicí"],
    "czech": "Jím polévku lžící.",
    "english": "I am eating soup with a spoon.",
    "difficulty": 2,
    "objectiveId": "cz.case.means",
    "phase": "practice",
    "context": "Name the utensil used to eat the soup.",
    "explanation": "Lžící is instrumental singular and names the utensil used to eat the soup. Lžicí is also an accepted standard form."
  },
  "cz.case.means.walk-with-dog": {
    "id": "cz.case.means.walk-with-dog",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.pes.singular",
    "case": "Instrumental",
    "form": "psem",
    "acceptedForms": [],
    "czech": "Jdu se psem.",
    "english": "I am walking with the dog.",
    "difficulty": 2,
    "objectiveId": "cz.case.means",
    "phase": "practice",
    "context": "Name the companion on a walk.",
    "explanation": "Se takes the instrumental for this companion. Psem is the instrumental singular of pes."
  },
  "cz.case.means.travel-by-bus": {
    "id": "cz.case.means.travel-by-bus",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.autobus.singular",
    "case": "Instrumental",
    "form": "autobusem",
    "acceptedForms": [],
    "czech": "Jedu autobusem.",
    "english": "I am travelling by bus.",
    "difficulty": 2,
    "objectiveId": "cz.case.means",
    "phase": "transfer",
    "context": "Use the means pattern for transport.",
    "explanation": "Autobusem is instrumental singular and names the means of transport."
  },
  "cz.case.plural.students-subject": {
    "id": "cz.case.plural.students-subject",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.student.plural",
    "case": "Nominative",
    "form": "studenti",
    "acceptedForms": [],
    "czech": "Studenti čekají před školou.",
    "english": "The students are waiting in front of the school.",
    "difficulty": 3,
    "objectiveId": "cz.case.plural",
    "phase": "practice",
    "context": "Identify the people who are waiting.",
    "explanation": "Studenti is the nominative plural subject. The masculine animate accusative plural is different: studenty."
  },
  "cz.case.plural.students-object": {
    "id": "cz.case.plural.students-object",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.student.plural",
    "case": "Accusative",
    "form": "studenty",
    "acceptedForms": [],
    "czech": "Vidím studenty.",
    "english": "I see the students.",
    "difficulty": 3,
    "objectiveId": "cz.case.plural",
    "phase": "practice",
    "context": "Identify the people being seen.",
    "explanation": "Studenty is the accusative plural direct object. It is not the nominative plural studenti."
  },
  "cz.case.plural.books-object": {
    "id": "cz.case.plural.books-object",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.kniha.plural",
    "case": "Accusative",
    "form": "knihy",
    "acceptedForms": [],
    "czech": "Čtu knihy.",
    "english": "I am reading books.",
    "difficulty": 3,
    "objectiveId": "cz.case.plural",
    "phase": "practice",
    "context": "Say what you are reading in the plural.",
    "explanation": "Knihy is accusative plural here. For this feminine noun, nominative and accusative plural have the same surface form."
  },
  "cz.case.plural.windows-subject": {
    "id": "cz.case.plural.windows-subject",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.okno.plural",
    "case": "Nominative",
    "form": "okna",
    "acceptedForms": [],
    "czech": "Okna jsou otevřená.",
    "english": "The windows are open.",
    "difficulty": 3,
    "objectiveId": "cz.case.plural",
    "phase": "practice",
    "context": "Name the things that are open.",
    "explanation": "Okna is the nominative plural subject. This neuter noun has the same form in the accusative plural."
  },
  "cz.case.plural.talk-students": {
    "id": "cz.case.plural.talk-students",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.student.plural",
    "case": "Instrumental",
    "form": "studenty",
    "acceptedForms": [],
    "czech": "Mluvím se studenty.",
    "english": "I am talking with the students.",
    "difficulty": 3,
    "objectiveId": "cz.case.plural",
    "phase": "practice",
    "context": "Name several people you are talking with.",
    "explanation": "Se takes the instrumental. Studenty is instrumental plural here, with the same surface form as accusative plural in Vidím studenty."
  },
  "cz.case.plural.talk-neighbors": {
    "id": "cz.case.plural.talk-neighbors",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.soused.plural",
    "case": "Instrumental",
    "form": "sousedy",
    "acceptedForms": [],
    "czech": "Mluvím se sousedy.",
    "english": "I am talking with the neighbors.",
    "difficulty": 3,
    "objectiveId": "cz.case.plural",
    "phase": "transfer",
    "context": "Apply the companion pattern to several people.",
    "explanation": "Se takes the instrumental. Sousedy is instrumental plural here; an identical form can serve a different role in another sentence."
  },
  "cz.case.address.call-pavel": {
    "id": "cz.case.address.call-pavel",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.pavel.singular",
    "case": "Vocative",
    "form": "Pavle",
    "acceptedForms": [],
    "czech": "Pavle, pojď sem!",
    "english": "Pavel, come here!",
    "difficulty": 3,
    "objectiveId": "cz.case.address",
    "phase": "practice",
    "context": "Call Pavel directly.",
    "explanation": "Direct address uses the vocative: Pavel becomes Pavle."
  },
  "cz.case.address.call-jana": {
    "id": "cz.case.address.call-jana",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.jana.singular",
    "case": "Vocative",
    "form": "Jano",
    "acceptedForms": [],
    "czech": "Jano, počkej!",
    "english": "Jana, wait!",
    "difficulty": 3,
    "objectiveId": "cz.case.address",
    "phase": "practice",
    "context": "Ask Jana directly to wait.",
    "explanation": "Jano is the vocative form used to address Jana."
  },
  "cz.case.address.call-marie": {
    "id": "cz.case.address.call-marie",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.marie.singular",
    "case": "Vocative",
    "form": "Marie",
    "acceptedForms": [],
    "czech": "Marie, zavolej mi!",
    "english": "Marie, call me!",
    "difficulty": 3,
    "objectiveId": "cz.case.address",
    "phase": "practice",
    "context": "Ask Marie directly to call you.",
    "explanation": "Marie has the same nominative and vocative surface form. Direct address and the sentence context identify its role here."
  },
  "cz.case.address.call-petr": {
    "id": "cz.case.address.call-petr",
    "revision": 1,
    "paradigmId": "cz.case.paradigm.petr.singular",
    "case": "Vocative",
    "form": "Petře",
    "acceptedForms": [],
    "czech": "Petře, poslouchej!",
    "english": "Petr, listen!",
    "difficulty": 3,
    "objectiveId": "cz.case.address",
    "phase": "transfer",
    "context": "Apply direct address to another familiar name in a new request.",
    "explanation": "Petře is the vocative of Petr. The direct request is addressed to him."
  }
});

function sameAuthoredValue(actual, expected) {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length
    && expected.every((value, index) => sameAuthoredValue(actual[index], value));
  if (expected && typeof expected === "object") return actual && typeof actual === "object"
    && Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => sameAuthoredValue(actual[key], value));
  return actual === expected;
}

export function validateCheckedParadigm(paradigm) {
  const checked = CHECKED_PARADIGMS[paradigm?.id];
  if (!checked || !sameAuthoredValue(paradigm, checked)) {
    throw new Error("Case Cosmos paradigm differs from its checked noun, number, or form pool.");
  }
}

export function validateCheckedContext(context) {
  const checked = CHECKED_CONTEXTS[context?.id];
  if (!checked || !sameAuthoredValue(context, checked)) {
    throw new Error("Case Cosmos context differs from its checked case, form, meaning, or teaching metadata.");
  }
}
