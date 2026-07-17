#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fromRoot } from "./paths.mjs";
import { shuffle, toJsonl, writeJson } from "./jsonl.mjs";

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function argInt(name, fallback) {
  const value = argValue(name, null);
  return value === null ? fallback : Number.parseInt(value, 10);
}

const seed = argInt("--seed", 41);
const maxItems = argInt("--max-items", 5000);
const outDir = path.resolve(argValue("--out-dir", fromRoot("data", "curriculum", "core-v0.1")));

const topicRows = {
  animals: [
    ["dog", "animal"], ["cat", "animal"], ["bird", "animal"], ["fish", "animal"],
    ["rabbit", "animal"], ["horse", "animal"], ["duck", "animal"], ["mouse", "animal"],
    ["cow", "animal"], ["sheep", "animal"], ["goat", "animal"], ["chicken", "animal"],
    ["frog", "animal"], ["turtle", "animal"], ["bee", "animal"], ["butterfly", "animal"],
    ["ant", "animal"], ["bear", "animal"], ["lion", "animal"], ["elephant", "animal"],
    ["monkey", "animal"], ["pig", "animal"], ["deer", "animal"], ["fox", "animal"],
  ],
  people: [
    ["mother", "person"], ["father", "person"], ["sister", "person"], ["brother", "person"],
    ["child", "person"], ["baby", "person"], ["friend", "person"], ["teacher", "person"],
    ["girl", "person"], ["boy", "person"], ["parent", "person"], ["grandma", "person"],
    ["grandpa", "person"], ["student", "person"], ["neighbor", "person"], ["family", "group"],
  ],
  home: [
    ["house", "place"], ["room", "place"], ["bed", "object"], ["chair", "object"],
    ["table", "object"], ["door", "object"], ["window", "object"], ["garden", "place"],
    ["kitchen", "place"], ["bathroom", "place"], ["bedroom", "place"], ["floor", "object"],
    ["wall", "object"], ["lamp", "object"], ["cup", "object"], ["plate", "object"],
    ["spoon", "object"], ["blanket", "object"], ["pillow", "object"], ["clock", "object"],
    ["shelf", "object"], ["sofa", "object"], ["basket", "object"], ["key", "object"],
  ],
  school: [
    ["school", "place"], ["classroom", "place"], ["library", "place"], ["book", "object"],
    ["pen", "object"], ["pencil", "object"], ["bag", "object"], ["paper", "object"],
    ["notebook", "object"], ["lesson", "event"], ["desk", "object"], ["picture", "object"],
    ["ruler", "object"], ["crayon", "object"], ["board", "object"], ["eraser", "object"],
    ["page", "object"], ["story", "object"], ["letter", "object"], ["number", "object"],
  ],
  food: [
    ["apple", "food"], ["bread", "food"], ["water", "drink"], ["milk", "drink"],
    ["rice", "food"], ["soup", "food"], ["banana", "food"], ["cake", "food"],
    ["cheese", "food"], ["egg", "food"], ["cookie", "food"], ["carrot", "food"],
    ["potato", "food"], ["sandwich", "food"], ["juice", "drink"], ["tea", "drink"],
    ["orange", "food"], ["pear", "food"], ["cereal", "food"], ["yogurt", "food"],
    ["tomato", "food"], ["salad", "food"], ["honey", "food"], ["pasta", "food"],
  ],
  nature: [
    ["tree", "object"], ["flower", "object"], ["sun", "object"], ["rain", "event"],
    ["sky", "object"], ["river", "place"], ["park", "place"], ["hill", "place"],
    ["grass", "object"], ["leaf", "object"], ["stone", "object"], ["cloud", "object"],
    ["snow", "event"], ["wind", "event"], ["moon", "object"], ["star", "object"],
    ["beach", "place"], ["lake", "place"], ["path", "place"], ["forest", "place"],
    ["seed", "object"], ["sand", "object"], ["mud", "object"], ["field", "place"],
  ],
  play: [
    ["ball", "object"], ["toy", "object"], ["game", "event"], ["song", "event"],
    ["bike", "object"], ["kite", "object"], ["box", "object"], ["block", "object"],
    ["doll", "object"], ["puzzle", "object"], ["drum", "object"], ["swing", "object"],
    ["slide", "object"], ["rope", "object"], ["boat", "object"], ["train", "object"],
    ["car", "object"], ["plane", "object"], ["robot", "object"], ["castle", "object"],
  ],
  body: [
    ["hand", "body_part"], ["foot", "body_part"], ["eye", "body_part"], ["ear", "body_part"],
    ["nose", "body_part"], ["mouth", "body_part"], ["hair", "body_part"], ["face", "body_part"],
    ["arm", "body_part"], ["leg", "body_part"], ["head", "body_part"], ["tooth", "body_part"],
  ],
  clothing: [
    ["shirt", "clothing"], ["shoe", "clothing"], ["hat", "clothing"], ["coat", "clothing"],
    ["sock", "clothing"], ["dress", "clothing"], ["scarf", "clothing"], ["glove", "clothing"],
    ["jacket", "clothing"], ["pants", "clothing"], ["skirt", "clothing"], ["boot", "clothing"],
  ],
  transport: [
    ["bus", "object"], ["car", "object"], ["train", "object"], ["bike", "object"],
    ["boat", "object"], ["plane", "object"], ["road", "place"], ["station", "place"],
    ["stop", "place"], ["street", "place"], ["bridge", "place"], ["ticket", "object"],
  ],
  routine: [
    ["morning", "time"], ["day", "time"], ["night", "time"], ["homework", "event"],
    ["breakfast", "event"], ["lunch", "event"], ["dinner", "event"], ["bath", "event"],
    ["walk", "event"], ["nap", "event"], ["story", "object"], ["music", "event"],
  ],
};

const intransitiveActions = [
  ["run", "runs"], ["walk", "walks"], ["jump", "jumps"], ["sit", "sits"],
  ["sleep", "sleeps"], ["play", "plays"], ["sing", "sings"], ["smile", "smiles"],
  ["laugh", "laughs"], ["swim", "swims"], ["dance", "dances"], ["wait", "waits"],
  ["listen", "listens"], ["rest", "rests"], ["clap", "claps"], ["wave", "waves"],
];

const transitiveActions = [
  ["see", "sees"], ["watch", "watches"], ["find", "finds"], ["hold", "holds"],
  ["carry", "carries"], ["take", "takes"], ["choose", "chooses"], ["open", "opens"],
  ["close", "closes"], ["wash", "washes"], ["touch", "touches"], ["push", "pushes"],
  ["pull", "pulls"], ["make", "makes"], ["draw", "draws"], ["read", "reads"],
];

const requestActions = [
  ["take", "take"], ["open", "open"], ["close", "close"], ["read", "read"],
  ["draw", "draw"], ["find", "find"], ["hold", "hold"], ["wash", "wash"],
];

const properties = [
  ["small", "size"], ["big", "size"], ["little", "size"], ["long", "size"],
  ["short", "size"], ["red", "color"], ["blue", "color"], ["green", "color"],
  ["yellow", "color"], ["white", "color"], ["black", "color"], ["brown", "color"],
  ["happy", "feeling"], ["sad", "feeling"], ["quiet", "quality"], ["clean", "quality"],
  ["warm", "quality"], ["cold", "quality"], ["soft", "quality"], ["hard", "quality"],
  ["fast", "quality"], ["slow", "quality"], ["new", "quality"], ["old", "quality"],
  ["full", "quality"], ["empty", "quality"], ["wet", "quality"], ["dry", "quality"],
];

const places = [
  ["garden", "home", "in"], ["park", "nature", "in"], ["room", "home", "in"],
  ["school", "school", "at"], ["kitchen", "home", "in"], ["yard", "home", "in"],
  ["hill", "nature", "on"], ["river", "nature", "by"], ["classroom", "school", "in"],
  ["library", "school", "in"], ["forest", "nature", "in"], ["beach", "nature", "at"],
  ["lake", "nature", "by"], ["path", "nature", "on"], ["station", "transport", "at"],
  ["street", "transport", "on"], ["bridge", "transport", "on"], ["bedroom", "home", "in"],
  ["bathroom", "home", "in"], ["house", "home", "in"], ["field", "nature", "in"],
  ["stop", "transport", "at"], ["table", "home", "at"], ["door", "home", "by"],
];

const sourceRegistry = [
  {
    source_id: "caatuu-original-seeds-v0.1",
    lane: "clean_core",
    status: "ingested",
    title: "Caatuu original curriculum seed rows",
    license_id: "project-local",
    commercial_use_allowed: true,
    derivatives_allowed: true,
    sharealike_required: false,
    attribution_required: false,
    notes: "Programmatically authored from controlled vocabulary and sentence patterns.",
  },
  {
    source_id: "book-dash",
    lane: "attribution_core",
    status: "candidate_not_ingested",
    title: "Book Dash open picture books",
    source_url: "https://bookdash.org/re-using-the-book-dash-content/",
    license_id: "CC-BY-4.0",
    commercial_use_allowed: true,
    derivatives_allowed: true,
    sharealike_required: false,
    attribution_required: true,
  },
  {
    source_id: "storyweaver",
    lane: "attribution_core",
    status: "candidate_not_ingested",
    title: "Pratham Books StoryWeaver",
    source_url: "https://storyweaver.org.in/en/attributions",
    license_id: "CC-BY-4.0",
    commercial_use_allowed: true,
    derivatives_allowed: true,
    sharealike_required: false,
    attribution_required: true,
  },
  {
    source_id: "global-digital-library",
    lane: "attribution_core",
    status: "candidate_not_ingested",
    title: "Global Digital Library",
    source_url: "https://digitallibrary.io/about/license/",
    license_id: "per-item-open-license",
    commercial_use_allowed: null,
    derivatives_allowed: null,
    sharealike_required: null,
    attribution_required: null,
    notes: "Check and store each item license before ingestion.",
  },
  {
    source_id: "common-voice-sentences",
    lane: "clean_core",
    status: "candidate_not_ingested",
    title: "Mozilla Common Voice sentence text",
    source_url: "https://common-voice.github.io/community-playbook/sub_pages/text.html",
    license_id: "CC0-1.0",
    commercial_use_allowed: true,
    derivatives_allowed: true,
    sharealike_required: false,
    attribution_required: false,
    notes: "Useful as short-sentence candidates, not as curriculum authority.",
  },
  {
    source_id: "tatoeba-cc0-subset",
    lane: "clean_core",
    status: "candidate_not_ingested",
    title: "Tatoeba CC0 subset",
    source_url: "https://tatoeba.org/en/downloads",
    license_id: "CC0-1.0",
    commercial_use_allowed: true,
    derivatives_allowed: true,
    sharealike_required: false,
    attribution_required: false,
    notes: "Use only the CC0 subset for clean core. Default Tatoeba text is CC BY 2.0 FR.",
  },
  {
    source_id: "project-gutenberg-verified",
    lane: "clean_core",
    status: "candidate_not_ingested",
    title: "Project Gutenberg texts after per-ebook verification",
    source_url: "https://www.gutenberg.org/policy/license.html",
    license_id: "public-domain-or-permission-by-ebook",
    commercial_use_allowed: null,
    derivatives_allowed: null,
    sharealike_required: false,
    attribution_required: false,
    notes: "Inspect each ebook license block and strip Gutenberg trademark/license material before derived use.",
  },
  {
    source_id: "wikimedia-simple",
    lane: "sharealike_quarantine",
    status: "candidate_not_ingested",
    title: "Simple English Wikipedia and related Wikimedia text",
    license_id: "CC-BY-SA-4.0",
    commercial_use_allowed: true,
    derivatives_allowed: true,
    sharealike_required: true,
    attribution_required: true,
    notes: "Quarantine because share-alike inheritance is awkward for the clean product corpus.",
  },
  {
    source_id: "tinystories",
    lane: "research_only",
    status: "candidate_not_ingested",
    title: "TinyStories",
    source_url: "https://huggingface.co/datasets/roneneldan/TinyStories",
    license_id: "CDLA-Sharing-1.0",
    commercial_use_allowed: null,
    derivatives_allowed: null,
    sharealike_required: true,
    attribution_required: true,
    notes: "Use for style/eval study only, not as canonical Caatuu corpus data.",
  },
];

const massNouns = new Set(["bread", "water", "milk", "rice", "soup", "cheese", "juice", "tea", "cereal", "yogurt", "honey", "pasta", "grass", "sand", "mud", "music", "homework"]);
const drinkNouns = new Set(["milk", "water", "juice", "tea"]);
const foodNouns = new Set(topicRows.food.filter(([, type]) => type === "food").map(([label]) => label));
const clothingNouns = new Set(topicRows.clothing.map(([label]) => label));
const bodyPartNouns = new Set(topicRows.body.map(([label]) => label));
const personNouns = new Set(topicRows.people.filter(([, type]) => type === "person").map(([label]) => label));
const colorProperties = new Set(properties.filter(([, kind]) => kind === "color").map(([label]) => label));
const feelingProperties = new Set(properties.filter(([, kind]) => kind === "feeling").map(([label]) => label));

function article(noun) {
  return /^[aeiou]/i.test(noun) ? "an" : "a";
}

function nounPhrase(noun, { definite = false, plural = false } = {}) {
  if (definite) return `the ${noun}`;
  if (plural) return `some ${pluralize(noun)}`;
  if (massNouns.has(noun)) return `some ${noun}`;
  return `${article(noun)} ${noun}`;
}

function pluralize(noun) {
  if (noun.endsWith("y")) return `${noun.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/u.test(noun)) return `${noun}es`;
  if (noun === "tooth") return "teeth";
  if (noun === "foot") return "feet";
  return `${noun}s`;
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function wordCount(text) {
  return String(text).match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
}

function normalizeText(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cefrForDifficulty(difficulty) {
  if (difficulty <= 1) return "Pre-A1/A1";
  if (difficulty === 2) return "A1";
  return "A1/A2";
}

function conceptId(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function topicFor(label) {
  for (const [topic, rows] of Object.entries(topicRows)) {
    if (rows.some(([value]) => value === label)) return topic;
  }
  return "general";
}

function makeConceptRows() {
  const conceptMap = new Map();
  for (const [topic, rows] of Object.entries(topicRows)) {
    for (const [label, type] of rows) {
      conceptMap.set(conceptId(label), {
        id: conceptId(label),
        english_label: label,
        concept_type: type,
        topic,
        difficulty: 1,
        imageable: !["time", "event", "group"].includes(type),
        child_safe: true,
      });
    }
  }
  for (const [id] of [...intransitiveActions, ...transitiveActions, ...requestActions]) {
    if (!conceptMap.has(id)) {
      conceptMap.set(id, {
        id,
        english_label: id,
        concept_type: "event",
        topic: "actions",
        difficulty: 1,
        imageable: true,
        child_safe: true,
      });
    }
  }
  for (const [label, kind] of properties) {
    conceptMap.set(conceptId(label), {
      id: conceptId(label),
      english_label: label,
      concept_type: kind,
      topic: kind === "color" ? "colors" : "qualities",
      difficulty: 1,
      imageable: kind !== "feeling",
      child_safe: true,
    });
  }
  for (const id of ["ask_location", "ask_choice", "ask_property", "like", "want", "need", "give", "put", "wear", "please", "not", "show", "can"]) {
    conceptMap.set(id, {
      id,
      english_label: id.replace(/_/g, " "),
      concept_type: "function",
      topic: "functions",
      difficulty: id === "not" ? 2 : 3,
      imageable: false,
      child_safe: true,
    });
  }
  return Array.from(conceptMap.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function nounRows(topicName) {
  return topicRows[topicName].map(([label, type]) => ({ id: conceptId(label), label, type, topic: topicName }));
}

function allRows() {
  return Object.keys(topicRows).flatMap(nounRows);
}

function rowsByType(type) {
  return allRows().filter((item) => item.type === type);
}

function concreteObjects() {
  return allRows().filter((item) => ["object", "food", "drink", "body_part", "clothing"].includes(item.type));
}

function imageableSubjects() {
  return allRows().filter((item) => ["person", "animal"].includes(item.type));
}

function people() {
  return allRows().filter((item) => item.type === "person");
}

function animals() {
  return allRows().filter((item) => item.type === "animal");
}

function foodRows() {
  return allRows().filter((item) => foodNouns.has(item.label));
}

function drinkRows() {
  return allRows().filter((item) => drinkNouns.has(item.label));
}

function clothingRows() {
  return allRows().filter((item) => clothingNouns.has(item.label));
}

function bodyRows() {
  return allRows().filter((item) => bodyPartNouns.has(item.label));
}

function placeRows() {
  const seen = new Map();
  for (const [label, topic, preposition] of places) {
    seen.set(conceptId(label), { id: conceptId(label), label, type: "place", topic, preposition });
  }
  for (const row of rowsByType("place")) {
    if (!seen.has(row.id)) seen.set(row.id, { ...row, preposition: "in" });
  }
  return Array.from(seen.values());
}

const largeOrFixedObjects = new Set([
  "bed", "chair", "table", "door", "window", "floor", "wall", "shelf", "sofa",
  "swing", "slide", "bike", "car", "bus", "train", "plane", "boat", "road",
  "station", "street", "bridge", "stop", "sun", "moon", "sky", "river", "lake",
  "forest", "field", "park", "hill", "school", "classroom", "library", "kitchen",
  "bathroom", "bedroom", "house", "garden", "path", "beach", "yard", "desk",
  "board", "star", "cloud", "rain", "snow", "wind",
]);
const animalActionAllowlist = new Set(["run", "walk", "jump", "sit", "sleep", "play", "swim", "rest"]);
const swimmingAnimals = new Set(["fish", "duck", "frog", "turtle"]);

function portableObjects() {
  return concreteObjects().filter((item) => !largeOrFixedObjects.has(item.label) && item.type !== "body_part");
}

function visibleObjects() {
  return concreteObjects().filter((item) => item.type !== "body_part");
}

function propertyObjects() {
  return visibleObjects().filter((item) => !["music", "homework"].includes(item.label));
}

function compatiblePlacesForAction(event, placesList) {
  const allowed = {
    swim: ["river", "lake", "beach"],
    sleep: ["room", "bedroom", "house"],
    rest: ["room", "bedroom", "house", "garden", "park"],
    listen: ["room", "classroom", "school", "library", "house"],
    sit: ["room", "classroom", "kitchen", "garden", "park", "table"],
    run: ["garden", "park", "yard", "field", "path", "school"],
    walk: ["garden", "park", "yard", "field", "path", "street", "school"],
    jump: ["garden", "park", "yard", "field", "classroom"],
    play: ["garden", "park", "yard", "room", "classroom", "school"],
    sing: ["room", "classroom", "school", "garden", "park", "house"],
    dance: ["room", "classroom", "school", "garden", "house"],
    smile: ["room", "classroom", "school", "garden", "park", "house"],
    laugh: ["room", "classroom", "school", "garden", "park", "house"],
    wait: ["room", "classroom", "school", "station", "stop", "door"],
    clap: ["room", "classroom", "school"],
    wave: ["room", "classroom", "school", "garden", "park", "door"],
  };
  const labels = allowed[event];
  if (!labels) return placesList;
  return placesList.filter((place) => labels.includes(place.label));
}

function objectsForAction(event, sets) {
  const byLabel = (labels) => sets.allPortable.filter((item) => labels.includes(item.label));
  if (event === "read") return byLabel(["book", "story", "letter", "page", "notebook"]);
  if (event === "draw") return byLabel(["picture", "flower", "tree", "house", "cat", "dog", "bird", "star", "sun"]).filter((item) => item.label === "picture");
  if (event === "wash") return byLabel(["cup", "plate", "shirt", "shoe", "sock"]);
  if (event === "open" || event === "close") return allRows().filter((item) => ["door", "window", "book", "bag", "box", "notebook"].includes(item.label));
  if (event === "push" || event === "pull") return allRows().filter((item) => ["door", "chair", "box", "toy", "car", "bike"].includes(item.label));
  if (event === "make") return byLabel(["cake", "sandwich", "picture", "kite", "boat"]);
  if (event === "watch") return allRows().filter((item) => ["bird", "fish", "duck", "butterfly", "train", "bus", "car", "plane", "game"].includes(item.label));
  if (event === "see") return sets.allVisible;
  return sets.allPortable;
}

function actionObjectPhrase(item, event) {
  if (["choose", "make", "draw"].includes(event)) return nounPhrase(item.label);
  return nounPhrase(item.label, { definite: true });
}

function isAwkwardProperty(noun, property) {
  if (feelingProperties.has(property)) return !personNouns.has(noun) && !animals().some((row) => row.label === noun);
  if (colorProperties.has(property)) return ["music", "homework", "lesson", "game", "song", "story", "walk", "nap"].includes(noun);
  if (["wet", "dry"].includes(property)) return ["sun", "moon", "star", "music", "homework"].includes(noun);
  if (["full", "empty"].includes(property)) return !["cup", "plate", "box", "bag", "basket", "room", "classroom", "bus", "train", "boat", "car"].includes(noun);
  return false;
}

function makeRow({ templateId, text, frame, targetConcepts, topic, difficulty, grammarTags, curriculumGoal, communicativeFunction }) {
  return {
    templateId,
    text,
    item: {
      id: "",
      version: "0.1",
      status: "draft",
      source_id: "caatuu-original-seeds-v0.1",
      source_lane: "clean_core",
      semantic_frame: frame,
      communicative_function: communicativeFunction,
      target_concepts: targetConcepts,
      topic,
      difficulty,
      cefr: cefrForDifficulty(difficulty),
      age_band: difficulty <= 1 ? "6-8" : "7-10",
      grammar_intent: grammarTags,
      curriculum_goal: curriculumGoal,
      scene_imageable: true,
      concrete_score: 5,
      culture_load: "low",
      translatability: "easy",
      adaptation_policy: "natural_target_language_over_literal_translation",
      forbidden_features: ["idiom", "proper_noun", "religion", "violence", "brand", "humiliation"],
      safety_tags: ["child_safe", "everyday", "context_independent"],
      provenance: {
        transformation: "original_controlled_seed",
        model_used: null,
        prompt_version: null,
        human_review_status: "not_reviewed",
      },
    },
    en: {
      source_id: "",
      language: "en",
      text,
      realization_type: "english_anchor",
      difficulty,
      cefr: cefrForDifficulty(difficulty),
      word_count: wordCount(text),
      lemmas: targetConcepts,
      grammar_tags: grammarTags,
      target_links: targetConcepts.map((id) => ({ concept_id: id, surface_hint: id.replace(/_/g, " ") })),
      child_safe: true,
      modern_english: true,
      context_independent: true,
      naturalness_score: 4,
      simplicity_score: difficulty === 1 ? 5 : 4,
      review_status: "draft",
    },
  };
}

function addCandidate(candidates, row) {
  if (!row.text || wordCount(row.text) > 16 || wordCount(row.text) < 3) return;
  if (/\b(a|an) (water|milk|rice|soup|bread|juice|tea|cheese|cereal|yogurt|honey|pasta|music|homework)\b/iu.test(row.text)) return;
  candidates.push(row);
}

function generateRows() {
  const candidates = [];
  const agents = imageableSubjects();
  const peopleRows = people();
  const animalRows = animals();
  const objectRows = visibleObjects();
  const allPortable = portableObjects();
  const allVisible = visibleObjects();
  const actionSets = { allPortable, allVisible };
  const placesList = placeRows();
  const foods = foodRows();
  const drinks = drinkRows();
  const clothes = clothingRows();
  const schoolObjects = nounRows("school").filter((item) => item.type === "object");
  const toys = nounRows("play").filter((item) => item.type === "object");
  const homeObjects = nounRows("home").filter((item) => item.type === "object");
  const portableSchoolObjects = schoolObjects.filter((item) => !largeOrFixedObjects.has(item.label));
  const portableToys = toys.filter((item) => !largeOrFixedObjects.has(item.label));
  const portableHomeObjects = homeObjects.filter((item) => !largeOrFixedObjects.has(item.label));
  const possessionObjects = [...portableSchoolObjects, ...portableHomeObjects, ...portableToys, ...clothes, ...foods.slice(0, 12)];
  const putPlaces = [
    { id: "table", label: "table", topic: "home", preposition: "on" },
    { id: "desk", label: "desk", topic: "school", preposition: "on" },
    { id: "shelf", label: "shelf", topic: "home", preposition: "on" },
    { id: "bed", label: "bed", topic: "home", preposition: "on" },
    { id: "floor", label: "floor", topic: "home", preposition: "on" },
    { id: "box", label: "box", topic: "play", preposition: "in" },
    { id: "bag", label: "bag", topic: "school", preposition: "in" },
    { id: "basket", label: "basket", topic: "home", preposition: "in" },
    { id: "room", label: "room", topic: "home", preposition: "in" },
  ];

  for (const agent of agents) {
    for (const [event, surface] of intransitiveActions) {
      if (agent.type === "animal" && !animalActionAllowlist.has(event)) continue;
      if (agent.type === "animal" && event === "swim" && !swimmingAnimals.has(agent.label)) continue;
      for (const place of compatiblePlacesForAction(event, placesList)) {
        addCandidate(candidates, makeRow({
          templateId: "agent_intransitive_place",
          text: `${titleCase(nounPhrase(agent.label))} ${surface} ${place.preposition} the ${place.label}.`,
          frame: { event, agent: agent.id, object: null, place: place.id, time: "present_general" },
          targetConcepts: [agent.id, event, place.id],
          topic: agent.topic,
          difficulty: 1,
          grammarTags: ["present_simple", "singular_subject", "locative_phrase"],
          curriculumGoal: "practice a concrete subject, present action, and place",
          communicativeFunction: "describe_action",
        }));
      }
    }
  }

  for (const agent of agents) {
    for (const food of foods) {
      addCandidate(candidates, makeRow({
        templateId: "agent_eats_food",
        text: `${titleCase(nounPhrase(agent.label))} eats ${nounPhrase(food.label)}.`,
        frame: { event: "eat", agent: agent.id, object: food.id, place: null, time: "present_general" },
        targetConcepts: [agent.id, "eat", food.id],
        topic: "food",
        difficulty: 1,
        grammarTags: ["present_simple", "singular_subject", "direct_object"],
        curriculumGoal: "practice food nouns with a concrete action",
        communicativeFunction: "describe_action",
      }));
    }
    for (const drink of drinks) {
      addCandidate(candidates, makeRow({
        templateId: "agent_drinks",
        text: `${titleCase(nounPhrase(agent.label))} drinks ${nounPhrase(drink.label)}.`,
        frame: { event: "drink", agent: agent.id, object: drink.id, place: null, time: "present_general" },
        targetConcepts: [agent.id, "drink", drink.id],
        topic: "food",
        difficulty: 1,
        grammarTags: ["present_simple", "singular_subject", "direct_object"],
        curriculumGoal: "practice drink words with a concrete action",
        communicativeFunction: "describe_action",
      }));
    }
  }

  for (const agent of peopleRows) {
    for (const item of possessionObjects) {
      addCandidate(candidates, makeRow({
        templateId: "person_has_object",
        text: `${titleCase(nounPhrase(agent.label))} has ${nounPhrase(item.label)}.`,
        frame: { event: "have", agent: agent.id, object: item.id, place: null, time: "present_general" },
        targetConcepts: [agent.id, "have", item.id],
        topic: item.topic,
        difficulty: 1,
        grammarTags: ["present_simple", "possession", "direct_object"],
        curriculumGoal: "practice possession with everyday objects",
        communicativeFunction: "describe_possession",
      }));
    }
  }

  for (const agent of peopleRows) {
    for (const [event, surface] of transitiveActions) {
      for (const item of objectsForAction(event, actionSets)) {
        addCandidate(candidates, makeRow({
          templateId: `person_${event}_object`,
          text: `${titleCase(nounPhrase(agent.label))} ${surface} ${actionObjectPhrase(item, event)}.`,
          frame: { event, agent: agent.id, object: item.id, place: null, time: "present_general" },
          targetConcepts: [agent.id, event, item.id],
          topic: item.topic,
          difficulty: 2,
          grammarTags: ["present_simple", "direct_object", "definite_object"],
          curriculumGoal: "practice a common action with an everyday object",
          communicativeFunction: "describe_action",
        }));
      }
    }
  }

  for (const animal of animalRows) {
    for (const item of [...foods, ...portableToys.slice(0, 8), ...portableHomeObjects.slice(0, 8)]) {
      for (const [event, surface] of [["see", "sees"], ["find", "finds"], ["touch", "touches"]]) {
        addCandidate(candidates, makeRow({
          templateId: `animal_${event}_object`,
          text: `${titleCase(nounPhrase(animal.label))} ${surface} the ${item.label}.`,
          frame: { event, agent: animal.id, object: item.id, place: null, time: "present_general" },
          targetConcepts: [animal.id, event, item.id],
          topic: animal.topic,
          difficulty: 2,
          grammarTags: ["present_simple", "direct_object", "definite_object"],
          curriculumGoal: "practice animal subject plus everyday object",
          communicativeFunction: "describe_action",
        }));
      }
    }
  }

  for (const item of propertyObjects()) {
    for (const [property, propertyKind] of properties) {
      if (isAwkwardProperty(item.label, property)) continue;
      addCandidate(candidates, makeRow({
        templateId: "object_is_property",
        text: `The ${item.label} is ${property}.`,
        frame: { event: "be", agent: item.id, property: conceptId(property), object: null, place: null, time: "present_general" },
        targetConcepts: [item.id, conceptId(property), "be"],
        topic: propertyKind === "color" ? "colors" : item.topic,
        difficulty: 1,
        grammarTags: ["be_present", "adjective_predicate"],
        curriculumGoal: "practice a simple noun and property",
        communicativeFunction: "describe_property",
      }));
    }
  }

  for (const person of peopleRows) {
    for (const clothing of clothes) {
      addCandidate(candidates, makeRow({
        templateId: "person_wears_clothing",
        text: `${titleCase(nounPhrase(person.label))} wears ${nounPhrase(clothing.label)}.`,
        frame: { event: "wear", agent: person.id, object: clothing.id, place: null, time: "present_general" },
        targetConcepts: [person.id, "wear", clothing.id],
        topic: "clothing",
        difficulty: 2,
        grammarTags: ["present_simple", "clothing", "direct_object"],
        curriculumGoal: "practice clothing words with a common verb",
        communicativeFunction: "describe_action",
      }));
    }
  }

  for (const person of peopleRows) {
    for (const other of peopleRows) {
      if (person.id === other.id) continue;
      addCandidate(candidates, makeRow({
        templateId: "person_helps_person",
        text: `${titleCase(nounPhrase(person.label))} helps ${nounPhrase(other.label, { definite: true })}.`,
        frame: { event: "help", agent: person.id, object: other.id, place: null, time: "present_general" },
        targetConcepts: [person.id, "help", other.id],
        topic: "people",
        difficulty: 2,
        grammarTags: ["present_simple", "direct_object", "social_action"],
        curriculumGoal: "practice helping language and people words",
        communicativeFunction: "describe_action",
      }));
    }
  }

  for (const person of peopleRows) {
    for (const item of [...foods, ...portableToys, ...portableSchoolObjects, ...clothes]) {
      for (const [event, surface] of [["like", "likes"], ["want", "wants"], ["need", "needs"]]) {
        addCandidate(candidates, makeRow({
          templateId: `person_${event}_object`,
          text: `${titleCase(nounPhrase(person.label))} ${surface} ${nounPhrase(item.label)}.`,
          frame: { event, agent: person.id, object: item.id, place: null, time: "present_general" },
          targetConcepts: [person.id, event, item.id],
          topic: item.topic,
          difficulty: 2,
          grammarTags: ["present_simple", "direct_object", "mental_or_need_verb"],
          curriculumGoal: "practice likes, wants, and needs with everyday items",
          communicativeFunction: "describe_preference_or_need",
        }));
      }
    }
  }

  for (const person of peopleRows) {
    for (const item of [...portableSchoolObjects, ...portableToys, ...portableHomeObjects.slice(0, 10)]) {
      for (const place of putPlaces) {
        addCandidate(candidates, makeRow({
          templateId: "person_puts_object_place",
          text: `${titleCase(nounPhrase(person.label))} puts the ${item.label} ${place.preposition} the ${place.label}.`,
          frame: { event: "put", agent: person.id, object: item.id, place: place.id, time: "present_general" },
          targetConcepts: [person.id, "put", item.id, place.id],
          topic: item.topic,
          difficulty: 3,
          grammarTags: ["present_simple", "direct_object", "locative_phrase"],
          curriculumGoal: "practice object placement with a place phrase",
          communicativeFunction: "describe_action",
        }));
      }
    }
  }

  for (const person of peopleRows) {
    for (const item of [...foods.slice(0, 12), ...portableSchoolObjects, ...portableToys.slice(0, 10)]) {
      for (const other of peopleRows.slice(0, 8)) {
        if (person.id === other.id) continue;
        addCandidate(candidates, makeRow({
          templateId: "person_gives_object_person",
          text: `${titleCase(nounPhrase(person.label))} gives ${nounPhrase(other.label, { definite: true })} ${nounPhrase(item.label)}.`,
          frame: { event: "give", agent: person.id, object: item.id, recipient: other.id, place: null, time: "present_general" },
          targetConcepts: [person.id, "give", other.id, item.id],
          topic: item.topic,
          difficulty: 3,
          grammarTags: ["present_simple", "ditransitive", "direct_object"],
          curriculumGoal: "practice giving with people and everyday objects",
          communicativeFunction: "describe_action",
        }));
      }
    }
  }

  for (const item of allVisible) {
    addCandidate(candidates, makeRow({
      templateId: "where_is_object",
      text: `Where is the ${item.label}?`,
      frame: { event: "ask_location", agent: item.id, object: null, place: "unknown", time: "present_general" },
      targetConcepts: [item.id, "ask_location"],
      topic: item.topic,
      difficulty: 2,
      grammarTags: ["question", "be_present", "location_question"],
      curriculumGoal: "practice simple location questions",
      communicativeFunction: "ask_location",
    }));
  }

  for (const item of allVisible) {
    addCandidate(candidates, makeRow({
      templateId: "can_you_see_object",
      text: `Can you see the ${item.label}?`,
      frame: { event: "see", agent: "listener", object: item.id, place: null, time: "present_question" },
      targetConcepts: [item.id, "see", "can"],
      topic: item.topic,
      difficulty: 3,
      grammarTags: ["question", "modal_can", "direct_object"],
      curriculumGoal: "practice simple yes-no questions with visible objects",
      communicativeFunction: "ask_perception",
    }));
  }

  for (const item of propertyObjects()) {
    for (const [property, propertyKind] of properties) {
      if (isAwkwardProperty(item.label, property)) continue;
      addCandidate(candidates, makeRow({
        templateId: "is_object_property",
        text: `Is the ${item.label} ${property}?`,
        frame: { event: "ask_property", agent: item.id, property: conceptId(property), object: null, place: null, time: "present_question" },
        targetConcepts: [item.id, conceptId(property), "ask_property"],
        topic: propertyKind === "color" ? "colors" : item.topic,
        difficulty: 3,
        grammarTags: ["question", "be_present", "adjective_predicate"],
        curriculumGoal: "practice simple property questions",
        communicativeFunction: "ask_property",
      }));
    }
  }

  for (const item of [...portableSchoolObjects, ...portableHomeObjects, ...portableToys, ...clothes]) {
    for (const [event, imperative] of requestActions) {
      if (event === "read" && !["book", "story", "letter", "page", "notebook"].includes(item.label)) continue;
      if (event === "draw" && !["picture"].includes(item.label)) continue;
      if (event === "wash" && !["cup", "plate", "shirt", "shoe"].includes(item.label)) continue;
      addCandidate(candidates, makeRow({
        templateId: `please_${event}_object`,
        text: `Please ${imperative} the ${item.label}.`,
        frame: { event, agent: "listener", object: item.id, place: null, time: "present_request" },
        targetConcepts: [item.id, event, "please"],
        topic: item.topic,
        difficulty: 3,
        grammarTags: ["polite_request", "imperative", "direct_object"],
        curriculumGoal: "practice polite requests with everyday objects",
        communicativeFunction: "polite_request",
      }));
    }
  }

  for (const item of [...foods, ...portableToys, ...portableSchoolObjects, ...clothes]) {
    addCandidate(candidates, makeRow({
      templateId: "do_you_like_object",
      text: `Do you like ${nounPhrase(item.label)}?`,
      frame: { event: "ask_choice", agent: "listener", object: item.id, place: null, time: "present_general" },
      targetConcepts: [item.id, "like", "ask_choice"],
      topic: item.topic,
      difficulty: 3,
      grammarTags: ["question", "do_support", "direct_object"],
      curriculumGoal: "practice simple preference questions",
      communicativeFunction: "ask_preference",
    }));
  }

  for (const item of [...foods, ...portableToys, ...portableSchoolObjects, ...clothes]) {
    addCandidate(candidates, makeRow({
      templateId: "do_you_want_object",
      text: `Do you want ${nounPhrase(item.label)}?`,
      frame: { event: "ask_choice", agent: "listener", object: item.id, place: null, time: "present_question" },
      targetConcepts: [item.id, "want", "ask_choice"],
      topic: item.topic,
      difficulty: 3,
      grammarTags: ["question", "do_support", "direct_object"],
      curriculumGoal: "practice simple want questions",
      communicativeFunction: "ask_preference",
    }));
  }

  for (const item of [...portableSchoolObjects, ...portableHomeObjects, ...portableToys, ...clothes, ...foods]) {
    addCandidate(candidates, makeRow({
      templateId: "please_show_object",
      text: `Please show me the ${item.label}.`,
      frame: { event: "show", agent: "listener", object: item.id, recipient: "speaker", place: null, time: "present_request" },
      targetConcepts: [item.id, "show", "please"],
      topic: item.topic,
      difficulty: 3,
      grammarTags: ["polite_request", "imperative", "direct_object"],
      curriculumGoal: "practice polite requests and object words",
      communicativeFunction: "polite_request",
    }));
  }

  for (const item of [...portableSchoolObjects, ...portableHomeObjects, ...portableToys]) {
    addCandidate(candidates, makeRow({
      templateId: "please_put_object_table",
      text: `Please put the ${item.label} on the table.`,
      frame: { event: "put", agent: "listener", object: item.id, place: "table", time: "present_request" },
      targetConcepts: [item.id, "put", "table", "please"],
      topic: item.topic,
      difficulty: 3,
      grammarTags: ["polite_request", "imperative", "direct_object", "locative_phrase"],
      curriculumGoal: "practice polite requests with object placement",
      communicativeFunction: "polite_request",
    }));
  }

  for (const person of peopleRows) {
    for (const [event] of [["read", "reads"], ["draw", "draws"], ["play", "plays"], ["walk", "walks"], ["sleep", "sleeps"], ["sing", "sings"], ["run", "runs"], ["jump", "jumps"]]) {
      addCandidate(candidates, makeRow({
        templateId: "person_does_not_action",
        text: `${titleCase(nounPhrase(person.label))} does not ${event}.`,
        frame: { event, agent: person.id, object: null, negated: true, place: null, time: "present_general" },
        targetConcepts: [person.id, event, "not"],
        topic: person.topic,
        difficulty: 3,
        grammarTags: ["negative", "present_simple", "do_support"],
        curriculumGoal: "practice simple negative sentences",
        communicativeFunction: "describe_negative_action",
      }));
    }
  }

  for (const animal of animalRows) {
    for (const [event] of [["run", "runs"], ["jump", "jumps"], ["sleep", "sleeps"], ["swim", "swims"], ["sit", "sits"]]) {
      addCandidate(candidates, makeRow({
        templateId: "animal_does_not_action",
        text: `${titleCase(nounPhrase(animal.label))} does not ${event}.`,
        frame: { event, agent: animal.id, object: null, negated: true, place: null, time: "present_general" },
        targetConcepts: [animal.id, event, "not"],
        topic: animal.topic,
        difficulty: 3,
        grammarTags: ["negative", "present_simple", "do_support"],
        curriculumGoal: "practice simple negative sentences",
        communicativeFunction: "describe_negative_action",
      }));
    }
  }

  return candidates;
}

function selectBalanced(candidates, count) {
  const seenText = new Set();
  const templateCounts = new Map();
  const topicCounts = new Map();
  const selected = [];
  const ordered = shuffle([...candidates], seed);
  const maxSameTemplate = Math.max(80, Math.ceil(count * 0.09));
  const maxSameTopic = Math.max(120, Math.ceil(count * 0.16));

  function canAdd(row) {
    const normalized = normalizeText(row.text);
    if (seenText.has(normalized)) return false;
    if ((templateCounts.get(row.templateId) ?? 0) >= maxSameTemplate) return false;
    if ((topicCounts.get(row.item.topic) ?? 0) >= maxSameTopic) return false;
    return true;
  }

  function add(row) {
    if (!canAdd(row)) return false;
    const normalized = normalizeText(row.text);
    seenText.add(normalized);
    templateCounts.set(row.templateId, (templateCounts.get(row.templateId) ?? 0) + 1);
    topicCounts.set(row.item.topic, (topicCounts.get(row.item.topic) ?? 0) + 1);
    selected.push(row);
    return true;
  }

  function countBy(predicate) {
    return selected.filter(predicate).length;
  }

  function pickUntil(predicate, target) {
    for (const row of ordered) {
      if (selected.length >= count || countBy(predicate) >= target) break;
      if (predicate(row)) add(row);
    }
  }

  const scale = count / 5000;
  const floors = [
    [(row) => row.item.communicative_function === "ask_location", Math.round(120 * scale)],
    [(row) => row.item.communicative_function === "ask_preference", Math.round(240 * scale)],
    [(row) => row.item.communicative_function === "ask_perception", Math.round(180 * scale)],
    [(row) => row.item.communicative_function === "ask_property", Math.round(260 * scale)],
    [(row) => row.item.communicative_function === "polite_request", Math.round(320 * scale)],
    [(row) => row.item.communicative_function === "describe_negative_action", Math.round(180 * scale)],
    [(row) => row.item.communicative_function === "describe_possession", Math.round(360 * scale)],
    [(row) => row.item.communicative_function === "describe_property", Math.round(550 * scale)],
    [(row) => row.item.communicative_function === "describe_preference_or_need", Math.round(550 * scale)],
  ];
  for (const [predicate, target] of floors) pickUntil(predicate, target);

  const difficultyTargets = {
    1: Math.round(count * 0.5),
    2: Math.round(count * 0.34),
    3: count,
  };
  pickUntil((row) => row.item.difficulty === 1, difficultyTargets[1]);
  pickUntil((row) => row.item.difficulty === 2, difficultyTargets[2]);

  for (const row of ordered) {
    if (selected.length >= count) break;
    add(row);
  }
  return shuffle([...selected], seed ^ 0x9e3779b9);
}

async function readExistingCorpusCounts() {
  const counts = {};
  const files = [
    ["czech_seed_sentences", fromRoot("data", "corpus", "processed", "czech_seed_sentences.txt")],
    ["planet_wordnet_sentences", fromRoot("data", "corpus", "planet-wordnet", "processed", "sentences.jsonl")],
  ];
  for (const [key, file] of files) {
    try {
      const text = await fs.readFile(file, "utf8");
      counts[key] = text.split(/\r?\n/u).filter(Boolean).length;
    } catch {
      counts[key] = null;
    }
  }
  return counts;
}

function summarize(items, realizations) {
  const byTopic = {};
  const byDifficulty = {};
  const grammarTagCounts = {};
  const communicativeFunctionCounts = {};
  const templateCounts = {};
  for (const item of items) {
    byTopic[item.topic] = (byTopic[item.topic] ?? 0) + 1;
    byDifficulty[item.difficulty] = (byDifficulty[item.difficulty] ?? 0) + 1;
    communicativeFunctionCounts[item.communicative_function] = (communicativeFunctionCounts[item.communicative_function] ?? 0) + 1;
  }
  for (const row of realizations) {
    for (const tag of row.grammar_tags) grammarTagCounts[tag] = (grammarTagCounts[tag] ?? 0) + 1;
  }
  return { item_count: items.length, by_topic: byTopic, by_difficulty: byDifficulty, grammar_tag_counts: grammarTagCounts, communicative_function_counts: communicativeFunctionCounts, template_counts: templateCounts };
}

async function main() {
  const candidates = generateRows();
  const selected = selectBalanced(candidates, maxItems);
  const items = [];
  const english = [];
  selected.forEach((row, idx) => {
    const id = `caatuu-core-v0.1-${String(idx + 1).padStart(6, "0")}`;
    items.push({ ...row.item, id, anchor_realization_id: `${id}:en`, template_id: row.templateId });
    english.push({ ...row.en, id: `${id}:en`, source_id: id });
  });

  const concepts = makeConceptRows();
  const reportsDir = path.join(outDir, "reports");
  const realizationsDir = path.join(outDir, "realizations");
  const promptsDir = path.join(outDir, "prompts");
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.mkdir(realizationsDir, { recursive: true });
  await fs.mkdir(promptsDir, { recursive: true });

  await fs.writeFile(path.join(outDir, "source-manifest.jsonl"), toJsonl(sourceRegistry), "utf8");
  await fs.writeFile(path.join(outDir, "concept-inventory.jsonl"), toJsonl(concepts), "utf8");
  await fs.writeFile(path.join(outDir, "curriculum-items.jsonl"), toJsonl(items), "utf8");
  await fs.writeFile(path.join(realizationsDir, "curriculum-realizations.en.jsonl"), toJsonl(english), "utf8");

  const existingCounts = await readExistingCorpusCounts();
  const summary = summarize(items, english);
  for (const item of items) {
    summary.template_counts[item.template_id] = (summary.template_counts[item.template_id] ?? 0) + 1;
  }
  await writeJson(path.join(reportsDir, "diversity_report.json"), {
    generated_at: new Date().toISOString(),
    seed,
    requested_items: maxItems,
    candidate_count: candidates.length,
    selected_count: items.length,
    existing_local_corpus_counts: existingCounts,
    ...summary,
  });

  await fs.writeFile(
    path.join(reportsDir, "corpus_card.md"),
    `# Caatuu Curriculum Core v0.1\n\n` +
      `Status: draft production-scale seed package.\n\n` +
      `This package contains ${items.length} language-neutral curriculum items and ${english.length} English realizations.\n\n` +
      `These rows are controlled Caatuu original seeds. They should still pass OpenAI curation and human spot review before training.\n\n` +
      `The current local Czech seed corpus remains useful as raw material, but it is not the canonical curriculum source.\n\n` +
      `Existing local counts at build time:\n\n` +
      `- Czech seed sentences: ${existingCounts.czech_seed_sentences ?? "unknown"}\n` +
      `- Planet Word Net Czech sentence candidates: ${existingCounts.planet_wordnet_sentences ?? "unknown"}\n\n` +
      `Next step: run the OpenAI batch curation pass on English realizations, review approvals/revisions, then adapt approved rows into Czech.\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(reportsDir, "license_report.md"),
    `# License Report\n\n` +
      `The generated seed rows come from Caatuu original controlled vocabulary and templates and are marked as project-local.\n\n` +
      `External sources listed in source-manifest.jsonl are candidates only. They have not been ingested into this package unless their status is "ingested".\n\n` +
      `Keep CC BY sources in attribution_core, CC BY-SA sources in sharealike_quarantine, and TinyStories-style datasets in research_only unless the policy changes.\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(promptsDir, "curate-en-v0.1.md"),
    `You are curating child-level English curriculum rows for Caatuu.\n` +
      `Return strict JSON. Prefer simple, concrete, modern English. Reject unsafe, abstract, archaic, moralizing, or context-dependent content.\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(promptsDir, "adapt-cs-v0.1.md"),
    `You are adapting language-neutral Caatuu curriculum items into natural beginner Czech.\n` +
      `Do not translate English word-for-word. Preserve the intended meaning and use natural Czech morphology.\n`,
    "utf8",
  );

  console.log(JSON.stringify({ outDir, selected: items.length, candidates: candidates.length, existingCounts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
