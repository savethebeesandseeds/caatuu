#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fromRoot } from "./paths.mjs";

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const sourceDatasetDir = path.resolve(argValue("--source-dataset-dir", fromRoot("data", "curriculum", "core-v0.1")));
const outDatasetDir = path.resolve(argValue("--out-dataset-dir", fromRoot("data", "curriculum", "core-v0.2")));
const sourceCuratedFile = path.resolve(argValue("--input-file", path.join(sourceDatasetDir, "curated", "curriculum-core.en.jsonl")));
const sourceQualityFile = path.resolve(
  argValue("--quality-file", path.join(sourceDatasetDir, "validation", "vector-quality.json")),
);
const outCuratedFile = path.resolve(argValue("--out-file", path.join(outDatasetDir, "curated", "curriculum-core.en.jsonl")));
const outReportFile = path.resolve(argValue("--report-file", path.join(outDatasetDir, "reports", "diversity-cleanup.json")));
const outReportMarkdownFile = path.resolve(
  argValue("--report-md-file", path.join(outDatasetDir, "reports", "diversity-cleanup.md")),
);
const maxChanges = Number(argValue("--max-changes", "220"));
const maxMirrorScanChanges = Number(argValue("--max-mirror-scan-changes", "120"));
const maxSemanticChanges = Number(argValue("--max-semantic-changes", "80"));

const PEOPLE_WORDS = new Set([
  "baby",
  "boy",
  "brother",
  "child",
  "father",
  "friend",
  "girl",
  "grandma",
  "grandpa",
  "mother",
  "neighbor",
  "parent",
  "sister",
  "student",
  "teacher",
]);

const ANIMAL_WORDS = new Set(["bird", "butterfly", "cat", "dog", "fish"]);
const FUNCTION_WORDS = new Set(["a", "an", "are", "be", "can", "does", "is", "please", "the", "you", "where"]);
const PROPERTY_WORDS = new Set([
  "big",
  "black",
  "blue",
  "bright",
  "brown",
  "clean",
  "clear",
  "cold",
  "dry",
  "empty",
  "full",
  "fun",
  "good",
  "green",
  "happy",
  "hard",
  "hot",
  "little",
  "long",
  "new",
  "old",
  "open",
  "pretty",
  "red",
  "small",
  "soft",
  "sweet",
  "warm",
  "wet",
  "white",
  "yellow",
]);
const VERBISH_WORDS = new Set([
  "are",
  "be",
  "build",
  "builds",
  "can",
  "carries",
  "carry",
  "choose",
  "chooses",
  "close",
  "closes",
  "does",
  "drink",
  "drinks",
  "eats",
  "enjoys",
  "find",
  "finds",
  "folds",
  "give",
  "gives",
  "has",
  "hold",
  "holds",
  "is",
  "like",
  "likes",
  "look",
  "looks",
  "moves",
  "needs",
  "open",
  "opens",
  "plays",
  "please",
  "points",
  "puts",
  "read",
  "reads",
  "rides",
  "see",
  "sees",
  "shares",
  "show",
  "take",
  "takes",
  "tastes",
  "touch",
  "touches",
  "uses",
  "want",
  "wants",
  "wears",
  "where",
]);
const PLACE_WORDS = new Set([
  "bag",
  "basket",
  "box",
  "chair",
  "classroom",
  "desk",
  "garden",
  "park",
  "path",
  "plate",
  "room",
  "shelf",
  "station",
  "street",
  "table",
  "tree",
]);
const LIQUID_WORDS = new Set(["juice", "milk", "water"]);
const SOFT_FOOD_WORDS = new Set(["cereal", "honey", "rice", "salad", "soup", "yogurt"]);
const SOLID_FOOD_WORDS = new Set(["apple", "banana", "bread", "cake", "carrot", "cookie", "pasta", "potato", "sandwich", "tomato"]);
const CLOTHING_WORDS = new Set(["coat", "dress", "jacket", "pants", "shirt", "shoe", "sock"]);
const SCHOOL_WORDS = new Set(["book", "desk", "eraser", "notebook", "pen", "pencil", "picture", "ruler"]);
const PLAY_WORDS = new Set(["ball", "doll", "drum", "puzzle", "robot", "swing", "toy"]);
const NATURE_WORDS = new Set(["flower", "grass", "leaf", "moon", "mud", "seed", "sky", "star", "stone", "tree"]);
const TRANSPORT_WORDS = new Set(["bike", "boat", "bus", "car", "plane", "station", "ticket"]);
const HOME_WORDS = new Set(["basket", "bed", "blanket", "box", "clock", "cup", "key", "rope", "shelf", "sofa", "spoon"]);

const rows = (await readJsonl(sourceCuratedFile)).map(withCzechTextField);
const quality = JSON.parse(await fs.readFile(sourceQualityFile, "utf8"));
const byId = new Map(rows.map((row) => [row.id, row]));
const existingTexts = new Set(rows.map((row) => normalizeText(row.english_text)));
const selected = selectRowsToRewrite(quality.near_duplicate_candidates || []);
const changes = [];
const changedIds = new Set();

for (const item of selected) {
  const row = byId.get(item.id);
  if (!row) continue;
  const rewrite = rewriteRow(row, item, changes.length);
  if (!rewrite) continue;

  const normalized = normalizeText(rewrite.english_text);
  if (!normalized || existingTexts.has(normalized)) continue;
  existingTexts.delete(normalizeText(row.english_text));
  existingTexts.add(normalized);

  changes.push({
    id: row.id,
    reason: item.reason,
    pair_id: item.pairId,
    old_text: row.english_text,
    new_text: rewrite.english_text,
    old_topic: row.topic,
    new_topic: rewrite.topic,
    old_difficulty: row.difficulty,
    new_difficulty: rewrite.difficulty,
    old_target_words: row.target_words,
    new_target_words: rewrite.target_words,
    old_grammar_tags: row.grammar_tags,
    new_grammar_tags: rewrite.grammar_tags,
  });
  changedIds.add(row.id);

  Object.assign(row, rewrite, { czech_text: "", notes: "" });
  if (changes.length >= maxChanges) break;
}

let mirrorScanChanges = 0;
for (const row of propertyMirrorRows(rows)) {
  if (changedIds.has(row.id)) continue;
  const rewrite = rewritePropertyMirror(row, mirrorScanChanges);
  if (!rewrite) continue;

  const normalized = normalizeText(rewrite.english_text);
  if (!normalized || existingTexts.has(normalized)) continue;
  existingTexts.delete(normalizeText(row.english_text));
  existingTexts.add(normalized);

  changes.push({
    id: row.id,
    reason: "property_mirror_scan",
    pair_id: "",
    old_text: row.english_text,
    new_text: rewrite.english_text,
    old_topic: row.topic,
    new_topic: rewrite.topic,
    old_difficulty: row.difficulty,
    new_difficulty: rewrite.difficulty,
    old_target_words: row.target_words,
    new_target_words: rewrite.target_words,
    old_grammar_tags: row.grammar_tags,
    new_grammar_tags: rewrite.grammar_tags,
  });
  changedIds.add(row.id);

  Object.assign(row, rewrite, { czech_text: "", notes: "" });
  mirrorScanChanges += 1;
  if (mirrorScanChanges >= maxMirrorScanChanges) break;
}

let semanticChanges = 0;
for (const row of rows) {
  if (changedIds.has(row.id)) continue;
  const rewrite = semanticRewriteRow(row, semanticChanges);
  if (!rewrite) continue;

  const normalized = normalizeText(rewrite.english_text);
  if (!normalized || existingTexts.has(normalized)) continue;
  existingTexts.delete(normalizeText(row.english_text));
  existingTexts.add(normalized);

  changes.push({
    id: row.id,
    reason: "semantic_naturalness",
    pair_id: "",
    old_text: row.english_text,
    new_text: rewrite.english_text,
    old_topic: row.topic,
    new_topic: rewrite.topic,
    old_difficulty: row.difficulty,
    new_difficulty: rewrite.difficulty,
    old_target_words: row.target_words,
    new_target_words: rewrite.target_words,
    old_grammar_tags: row.grammar_tags,
    new_grammar_tags: rewrite.grammar_tags,
  });
  changedIds.add(row.id);

  Object.assign(row, rewrite, { czech_text: "", notes: "" });
  semanticChanges += 1;
  if (semanticChanges >= maxSemanticChanges) break;
}

await copySmallCompanionFiles();
await writeJsonl(outCuratedFile, rows);
const report = buildReport(rows, changes, quality);
await writeJson(outReportFile, report);
await fs.writeFile(outReportMarkdownFile, reportMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: true,
  source_rows: rows.length,
  changed_rows: changes.length,
  output_file: outCuratedFile,
  report_file: outReportFile,
  report_markdown_file: outReportMarkdownFile,
}, null, 2));

function selectRowsToRewrite(candidates) {
  const selectedById = new Map();
  const touchedPairs = new Set();
  for (const candidate of candidates) {
    const kind = classifyCandidate(candidate);
    if (!kind) continue;
    const id = chooseRewriteId(candidate, kind);
    if (!id || selectedById.has(id)) continue;
    const pairId = `${candidate.id_a}:${candidate.id_b}`;
    if (touchedPairs.has(pairId)) continue;
    selectedById.set(id, { id, reason: kind, pairId, candidate });
    touchedPairs.add(pairId);
    if (selectedById.size >= maxChanges * 4) break;
  }
  return [...selectedById.values()];
}

function classifyCandidate(candidate) {
  const a = candidate.text_a || "";
  const b = candidate.text_b || "";
  if (isPropertyQuestion(a) || isPropertyQuestion(b)) return "statement_question_mirror";
  if (/\bgives the\b/i.test(a) && /\bgives the\b/i.test(b)) return "role_swap_gives";
  if (/\bputs the\b/i.test(a) && /\bputs the\b/i.test(b)) return "object_place_swap";
  if (/^Please\b/.test(a) || /^Please\b/.test(b)) return "polite_request_template";
  if (/^Can you\b/.test(a) || /^Can you\b/.test(b)) return "can_you_template";
  if (/^Where is\b/.test(a) || /^Where is\b/.test(b)) return "where_template";
  if ((candidate.vector_score ?? 0) >= 0.92) return "generic_template_repetition";
  return null;
}

function chooseRewriteId(candidate, kind) {
  if (kind === "statement_question_mirror") {
    const rowA = byId.get(candidate.id_a);
    const rowB = byId.get(candidate.id_b);
    if (isPropertyQuestion(candidate.text_a) && rowB?.difficulty <= 1) return candidate.id_a;
    if (isPropertyQuestion(candidate.text_b) && rowA?.difficulty <= 1) return candidate.id_b;
    return rowB?.difficulty >= rowA?.difficulty ? candidate.id_b : candidate.id_a;
  }
  return candidate.id_b || candidate.id_a;
}

function rewriteRow(row, item, index) {
  switch (item.reason) {
    case "statement_question_mirror":
      return rewritePropertyMirror(row, index);
    case "role_swap_gives":
      return rewriteRoleSwap(row, index);
    case "object_place_swap":
      return rewriteObjectPlaceSwap(row, index);
    case "polite_request_template":
      return rewritePoliteRequest(row, index);
    case "can_you_template":
      return rewriteCanYou(row, index);
    case "where_template":
      return rewriteWhere(row, index);
    case "generic_template_repetition":
      return rewriteGeneric(row, index);
    default:
      return null;
  }
}

function propertyMirrorRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const signature = propertySignature(row.english_text);
    if (!signature) continue;
    if (!groups.has(signature.key)) groups.set(signature.key, { questions: [], statements: [] });
    groups.get(signature.key)[signature.kind === "question" ? "questions" : "statements"].push(row);
  }

  const out = [];
  for (const group of groups.values()) {
    if (!group.questions.length || !group.statements.length) continue;
    out.push(...group.questions);
  }
  return out.sort((left, right) => left.id.localeCompare(right.id));
}

function propertySignature(text) {
  const value = String(text || "").trim();
  const question = value.match(/^(?:Is|Are) the ([a-z]+) ([a-z]+)\?$/i);
  if (question) {
    return { kind: "question", key: `${question[1].toLowerCase()}:${question[2].toLowerCase()}` };
  }
  const statement = value.match(/^The ([a-z]+) (?:is|are) ([a-z]+)\.$/i);
  if (statement) {
    return { kind: "statement", key: `${statement[1].toLowerCase()}:${statement[2].toLowerCase()}` };
  }
  return null;
}

function rewritePropertyMirror(row, index) {
  const words = row.target_words || [];
  const noun = words.find((word) => !isPropertyWord(word)) || nounFromPropertySentence(row.english_text);
  const property = words.find((word) => isPropertyWord(word)) || propertyFromPropertySentence(row.english_text);
  if (!noun || !property) return null;
  const result = sentenceForPropertyNoun(noun, property, row.topic, index);
  if (!result) return null;
  const { text, targetWords, topic, extraTags = [] } = result;
  return {
    english_text: sentenceCase(text),
    difficulty: index % 4 === 3 ? 3 : 2,
    cefr: index % 4 === 3 ? "A1/A2" : "A1",
    age_band: index % 4 === 3 ? "7-10" : "6-8",
    topic,
    target_words: targetWords,
    grammar_tags: grammarForActionText(text, extraTags),
    naturalness_score: 5,
    simplicity_score: 4,
  };
}

function rewriteRoleSwap(row, index) {
  const words = row.target_words || [];
  const people = words.filter(isPersonWord);
  const object = concreteObjectFromWords(words, row.topic, index) || "toy";
  const giver = people[0] || actorFor(row.topic, index);
  const receiver = differentActor(people[1] || actorFor(row.topic, index + 1), giver, row.topic, index + 2);
  const adjective = hasWord(words, "small") && objectCanBeSmall(object) ? "small " : "";
  const templates = [
    `${article(giver)} ${giver} puts the ${adjective}${object} beside the ${receiver}.`,
    `${article(receiver)} ${receiver} looks at the ${adjective}${object} with the ${giver}.`,
    `${article(giver)} ${giver} keeps the ${adjective}${object} for later.`,
    `The ${adjective}${object} is between the ${giver} and the ${receiver}.`,
  ];
  const text = sentenceCase(templates[index % templates.length]);
  return {
    english_text: text,
    topic: topicForNoun(object, row.topic),
    target_words: uniqueWords([giver, receiver, actionWord(text), adjective.trim(), object]),
    grammar_tags: grammarForActionText(text, ["locative_phrase"]),
    naturalness_score: 5,
    simplicity_score: 4,
  };
}

function rewriteObjectPlaceSwap(row, index) {
  const words = row.target_words || [];
  const actor = words.find(isPersonWord) || actorFor(row.topic, index);
  const nouns = words.filter((word) => isConcreteObject(word) && !["puts", "put"].includes(normalizeToken(word)));
  const object = nouns[0] || objectForTopic(row.topic, index);
  const place = differentPlace(nouns[1] || placeForTopic(row.topic, index), object, row.topic, index);
  const templates = [
    `${article(actor)} ${actor} takes the ${object} out of the ${place}.`,
    `${article(actor)} ${actor} looks for the ${object} near the ${place}.`,
    `${article(actor)} ${actor} moves the ${object} away from the ${place}.`,
    `The ${object} is next to the ${place}.`,
  ];
  const text = sentenceCase(templates[index % templates.length]);
  return {
    english_text: text,
    topic: topicForNoun(object, row.topic),
    target_words: uniqueWords([actor, actionWord(text), object, place]),
    grammar_tags: grammarForActionText(text, ["prepositional_phrase"]),
    naturalness_score: 5,
    simplicity_score: 4,
  };
}

function rewritePoliteRequest(row, index) {
  const words = row.target_words || [];
  const object = concreteObjectFromWords(words, row.topic, index) || objectForTopic(row.topic, index);
  const place = differentPlace(words.find(isPlaceWord) || placeForTopic(row.topic, index), object, row.topic, index);
  const actor = actorFor(row.topic, index);
  const templates = [
    `${article(actor)} ${actor} puts the ${object} near the ${place}.`,
    `I can find the ${object} on the ${place}.`,
    `The ${object} is ready on the ${place}.`,
    `${article(actor)} ${actor} carries the ${object} to the ${place}.`,
  ];
  const text = sentenceCase(templates[index % templates.length]);
  return {
    english_text: text,
    topic: topicForNoun(object, row.topic),
    target_words: uniqueWords([actor, actionWord(text), object, place]),
    grammar_tags: grammarForActionText(text, ["direct_object"]),
    difficulty: 2,
    cefr: "A1",
    naturalness_score: 5,
    simplicity_score: 4,
  };
}

function rewriteCanYou(row, index) {
  const words = row.target_words || [];
  const object = concreteObjectFromWords(words, row.topic, index) || objectForTopic(row.topic, index);
  const place = differentPlace(placeForTopic(row.topic, index), object, row.topic, index);
  const templates = [
    `I can see the ${object} near the ${place}.`,
    `The ${object} is beside the ${place}.`,
    `A child points to the ${object}.`,
    `We look at the ${object} together.`,
  ];
  const text = sentenceCase(templates[index % templates.length]);
  return {
    english_text: text,
    target_words: uniqueWords([actionWord(text), object, place]),
    grammar_tags: grammarForActionText(text, ["direct_object"]),
    difficulty: 2,
    cefr: "A1",
    naturalness_score: 5,
    simplicity_score: 4,
  };
}

function rewriteWhere(row, index) {
  const words = row.target_words || [];
  const object = concreteObjectFromWords(words, row.topic, index) || objectForTopic(row.topic, index);
  const place = differentPlace(placeForTopic(row.topic, index), object, row.topic, index);
  const templates = [
    `The ${object} is on the ${place}.`,
    `I put the ${object} beside the ${place}.`,
    `A child finds the ${object} near the ${place}.`,
  ];
  const text = sentenceCase(templates[index % templates.length]);
  return {
    english_text: text,
    target_words: uniqueWords([object, place, actionWord(text)]),
    grammar_tags: grammarForActionText(text, ["locative_phrase"]),
    difficulty: 2,
    cefr: "A1",
    naturalness_score: 5,
    simplicity_score: 4,
  };
}

function rewriteGeneric(row, index) {
  const words = row.target_words || [];
  const actor = words.find(isPersonWord) || actorFor(row.topic, index);
  const object = concreteObjectFromWords(words, row.topic, index, { fallback: false });
  if (!object) return null;
  const result = sentenceForObjectAction(actor, object, row.topic, index);
  if (!result) return null;
  const { text, targetWords, topic } = result;
  return {
    english_text: sentenceCase(text),
    topic,
    target_words: targetWords,
    grammar_tags: grammarForActionText(text, []),
    difficulty: 2,
    cefr: "A1",
    naturalness_score: 5,
    simplicity_score: 4,
  };
}

function semanticRewriteRow(row, index) {
  const text = String(row.english_text || "");

  const smallStory = text.match(/^A ([a-z]+) gives the ([a-z]+) a small story\.$/i);
  if (smallStory && isPersonWord(smallStory[1]) && isPersonWord(smallStory[2])) {
    const listener = normalizeToken(smallStory[1]);
    const reader = normalizeToken(smallStory[2]);
    return rewriteFromSentenceResult(
      sentenceResult(`${article(reader)} ${reader} reads a short story to the ${listener}.`, "story", "short", "school"),
      row,
    );
  }

  const animalTouch = text.match(/^A ([a-z]+) touches the ([a-z]+)\.$/i);
  if (animalTouch && ANIMAL_WORDS.has(normalizeToken(animalTouch[1]))) {
    const object = normalizeToken(animalTouch[2]);
    const result = sentenceForAnimalTouchObject(object, row.id, row.topic, index);
    return result ? rewriteFromSentenceResult(result, row) : null;
  }

  const likeWant = text.match(/^Do you (?:like|want) a ([a-z]+)\?$/i);
  if (likeWant) {
    const object = normalizeToken(likeWant[1]);
    if (!["potato", "story"].includes(object)) return null;
    const result = sentenceForAwkwardQuestionObject(object, row.id);
    return result ? rewriteFromSentenceResult(result, row) : null;
  }

  return null;
}

function sentenceForAnimalTouchObject(object, rowId, fallbackTopic, index) {
  const key = normalizeToken(object);
  const variant = rowVariant(rowId);
  if (key === "soup") {
    const templates = [
      () => sentenceResult("A child tastes the soup with a spoon.", "soup", "", "food"),
      () => sentenceResult("A mother puts the soup on the table.", "soup", "", "food"),
      () => sentenceResult("A friend eats the soup at lunch.", "soup", "", "food"),
      () => sentenceResult("A teacher tastes the soup at the table.", "soup", "", "food"),
      () => sentenceResult("A child puts the soup on a plate.", "soup", "", "food"),
    ];
    return templates[variant % templates.length]();
  }
  if (key === "puzzle") {
    const templates = [
      () => sentenceResult("A child opens the puzzle box.", "puzzle", "", "play"),
      () => sentenceResult("A friend puts the puzzle on the table.", "puzzle", "", "play"),
      () => sentenceResult("A brother plays with the puzzle after school.", "puzzle", "", "play"),
      () => sentenceResult("A student looks at the puzzle in class.", "puzzle", "", "play"),
    ];
    return templates[variant % templates.length]();
  }
  if (key === "toy") {
    const templates = [
      () => sentenceResult("A child puts the toy in a box.", "toy", "", "play"),
      () => sentenceResult("A friend keeps the toy on the shelf.", "toy", "", "play"),
      () => sentenceResult("A brother plays with the toy after school.", "toy", "", "play"),
      () => sentenceResult("A student looks at the toy in class.", "toy", "", "play"),
    ];
    return templates[variant % templates.length]();
  }
  if (key === "basket") {
    const templates = [
      () => sentenceResult("A child finds the basket near the table.", "basket", "", "home"),
      () => sentenceResult("A mother carries the basket to the room.", "basket", "", "home"),
      () => sentenceResult("A friend puts the basket on the shelf.", "basket", "", "home"),
    ];
    return templates[variant % templates.length]();
  }
  const actor = actorFor(topicForNoun(key, fallbackTopic), index + variant);
  return sentenceForObjectAction(actor, key, fallbackTopic, index + variant);
}

function sentenceForAwkwardQuestionObject(object, rowId) {
  const key = normalizeToken(object);
  const variant = rowVariant(rowId);
  if (key === "story") {
    const templates = [
      () => sentenceResult("A teacher reads the story after lunch.", "story", "", "school"),
      () => sentenceResult("A friend reads the story aloud.", "story", "", "school"),
      () => sentenceResult("A child reads a short story in class.", "story", "short", "school"),
    ];
    return templates[variant % templates.length]();
  }
  if (key === "potato") {
    const templates = [
      () => sentenceResult("A child eats the potato at the table.", "potato", "", "food"),
      () => sentenceResult("A mother shares the potato at lunch.", "potato", "", "food"),
      () => sentenceResult("A friend puts the potato on a plate.", "potato", "", "food"),
      () => sentenceResult("A teacher puts the potato on the table.", "potato", "", "food"),
    ];
    return templates[variant % templates.length]();
  }
  return null;
}

function rowVariant(rowId) {
  const digits = String(rowId || "").match(/\d+/)?.[0] || "0";
  return Number(digits);
}

function rewriteFromSentenceResult(result, row) {
  const difficulty = Math.min(Math.max(Number(row.difficulty) || 2, 1), 3);
  return {
    english_text: sentenceCase(result.text),
    difficulty,
    cefr: difficulty === 3 ? "A1/A2" : "A1",
    age_band: difficulty === 3 ? "7-10" : "6-8",
    topic: result.topic,
    target_words: result.targetWords,
    grammar_tags: grammarForActionText(result.text, result.extraTags || []),
    naturalness_score: 5,
    simplicity_score: 4,
  };
}

function grammarForActionText(text, extra = []) {
  const lower = text.toLowerCase();
  const tags = new Set(["present_simple"]);
  if (lower.includes("?")) tags.add("question");
  if (/\bcan\b/.test(lower)) tags.add("modal_can");
  if (/\bnot\b/.test(lower)) tags.add("negative");
  if (/\b on the |\b in the |\b near the |\b beside the |\b between |\b next to |\b out of |\b away from |\b to the /.test(lower)) {
    tags.add("locative_phrase");
  }
  if (/\bbuilds?\b|\bcarries?\b|\bchooses?\b|\bdrinks?\b|\beats?\b|\benjoys?\b|\bfinds?\b|\bfolds?\b|\bholds?\b|\bkeeps?\b|\blooks?\b|\bmoves?\b|\bopens?\b|\bplays?\b|\bpoints?\b|\bputs?\b|\breads?\b|\brides?\b|\bsees?\b|\bshares?\b|\btakes?\b|\btastes?\b|\btouches?\b|\buses?\b|\bwants?\b|\bwears?\b/.test(lower)) {
    tags.add("direct_object");
  }
  for (const tag of extra) tags.add(tag);
  return [...tags];
}

function buildReport(rows, changes, sourceQuality) {
  const openings = countOpenings(rows);
  const targetCounts = countTargets(rows);
  return {
    generated_at: new Date().toISOString(),
    source_dataset_dir: sourceDatasetDir,
    output_dataset_dir: outDatasetDir,
    source_near_duplicate_candidates: sourceQuality.near_duplicate_candidates?.length ?? 0,
    changed_rows: changes.length,
    exact_duplicate_texts: exactDuplicateTexts(rows),
    common_openings_top_20: topEntries(openings, 20),
    target_words_top_20: topEntries(targetCounts, 20),
    changes,
  };
}

function reportMarkdown(report) {
  const lines = [
    "# Curriculum Diversity Cleanup",
    "",
    `Generated: ${report.generated_at}`,
    "",
    `Changed rows: ${report.changed_rows}`,
    `Exact duplicate texts after cleanup: ${report.exact_duplicate_texts.length}`,
    "",
    "## Strategy",
    "",
    "- Keep row IDs stable.",
    "- Rewrite only one side of high-confidence near-duplicate pairs.",
    "- Prefer grammar/scene changes over tiny synonym changes.",
    "- Keep notes blank.",
    "",
    "## Common Openings After Cleanup",
    "",
    ...report.common_openings_top_20.map(([opening, count]) => `- ${opening}: ${count}`),
    "",
    "## Sample Changes",
    "",
    ...report.changes.slice(0, 40).flatMap((change) => [
      `- ${change.id} (${change.reason})`,
      `  - before: ${change.old_text}`,
      `  - after: ${change.new_text}`,
    ]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function copySmallCompanionFiles() {
  await fs.mkdir(outDatasetDir, { recursive: true });
  for (const fileName of ["source-manifest.jsonl", "concept-inventory.jsonl"]) {
    await copyIfExists(path.join(sourceDatasetDir, fileName), path.join(outDatasetDir, fileName));
  }
  await copyDirIfExists(path.join(sourceDatasetDir, "prompts"), path.join(outDatasetDir, "prompts"));
}

async function copyIfExists(source, target) {
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function copyDirIfExists(source, target) {
  try {
    const entries = await fs.readdir(source, { withFileTypes: true });
    await fs.mkdir(target, { recursive: true });
    for (const entry of entries) {
      if (entry.isFile()) await fs.copyFile(path.join(source, entry.name), path.join(target, entry.name));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        error.message = `${file}:${index + 1}: ${error.message}`;
        throw error;
      }
    });
}

function withCzechTextField(row) {
  const { id, english_text, czech_text = "", ...rest } = row;
  return {
    id,
    english_text,
    czech_text: typeof czech_text === "string" ? czech_text : String(czech_text ?? ""),
    ...rest,
  };
}

async function writeJsonl(file, rows) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function exactDuplicateTexts(rows) {
  const seen = new Map();
  const duplicates = [];
  for (const row of rows) {
    const key = normalizeText(row.english_text);
    if (seen.has(key)) duplicates.push([seen.get(key), row.id, row.english_text]);
    else seen.set(key, row.id);
  }
  return duplicates;
}

function countOpenings(rows) {
  const counts = {};
  for (const row of rows) {
    const opening = tokenize(row.english_text).slice(0, 3).join(" ");
    if (opening) counts[opening] = (counts[opening] || 0) + 1;
  }
  return counts;
}

function countTargets(rows) {
  const counts = {};
  for (const row of rows) {
    for (const word of row.target_words || []) {
      const key = normalizeToken(word);
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

function topEntries(object, limit) {
  return Object.entries(object)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function isPropertyQuestion(text) {
  return /^(Is|Are) the .+\?$/.test(text || "");
}

function nounFromPropertySentence(text) {
  const match = String(text || "").match(/^(?:Is|Are|The) the ([a-z]+) (?:is |are )?([a-z]+)\??$/i);
  return match?.[1]?.toLowerCase() || "";
}

function propertyFromPropertySentence(text) {
  const match = String(text || "").match(/^(?:Is|Are) the [a-z]+ ([a-z]+)\?$|^The [a-z]+ (?:is|are) ([a-z]+)\.$/i);
  return (match?.[1] || match?.[2] || "").toLowerCase();
}

function sentenceForPropertyNoun(noun, property, fallbackTopic, index) {
  const key = normalizeToken(noun);
  const topic = topicForNoun(key, fallbackTopic);
  const actor = actorFor(topic, index);
  const modifier = safeModifierForNoun(key, property);
  const phrase = modifier ? `${modifier} ${key}` : key;

  if (!key || isPersonWord(key) || isVerbish(key) || FUNCTION_WORDS.has(key)) return null;

  if (LIQUID_WORDS.has(key)) {
    return sentenceResult(`${article(actor)} ${actor} drinks the ${phrase} after lunch.`, key, modifier, topic);
  }
  if (key === "honey" || key === "yogurt") {
    return sentenceResult(`${article(actor)} ${actor} tastes the ${phrase} with a spoon.`, key, modifier, topic);
  }
  if (SOFT_FOOD_WORDS.has(key) || SOLID_FOOD_WORDS.has(key)) {
    const verb = key === "cake" || key === "cookie" ? "shares" : "eats";
    return sentenceResult(`${article(actor)} ${actor} ${verb} the ${phrase} after lunch.`, key, modifier, topic);
  }
  if (CLOTHING_WORDS.has(key)) {
    const verb = modifier === "warm" || ["coat", "dress", "jacket", "shoe"].includes(key) ? "wears" : "folds";
    return sentenceResult(`${article(actor)} ${actor} ${verb} the ${phrase}.`, key, modifier, topic);
  }
  if (key === "story") {
    const storyPhrase = modifier === "short" ? "a short story" : `the ${phrase}`;
    return sentenceResult(`${article(actor)} ${actor} reads ${storyPhrase} before bed.`, key, modifier, "school");
  }
  if (SCHOOL_WORDS.has(key)) {
    const verb = ["book", "notebook"].includes(key) ? "opens" : key === "picture" ? "looks at" : "uses";
    return sentenceResult(`${article(actor)} ${actor} ${verb} the ${phrase} in class.`, key, modifier, topic);
  }
  if (PLAY_WORDS.has(key) || key === "castle") {
    const verb = key === "castle" ? "builds" : "plays with";
    return sentenceResult(`${article(actor)} ${actor} ${verb} the ${phrase} after school.`, key, modifier, topic);
  }
  if (key === "sky") {
    return sentenceResult(`We look at the ${phrase} after rain.`, key, modifier, topic);
  }
  if (key === "moon" || key === "star") {
    return sentenceResult(`I can see the ${phrase} at night.`, key, modifier, topic);
  }
  if (key === "mud") {
    return sentenceResult(`${article(actor)} ${actor} sees the ${phrase} on the path.`, key, modifier, topic);
  }
  if (NATURE_WORDS.has(key) || ANIMAL_WORDS.has(key)) {
    const place = key === "fish" ? "water" : "garden";
    return sentenceResult(`${article(actor)} ${actor} finds the ${phrase} in the ${place}.`, key, modifier, topic);
  }
  if (TRANSPORT_WORDS.has(key)) {
    if (key === "bike") return sentenceResult(`${article(actor)} ${actor} rides the ${phrase} on the path.`, key, modifier, topic);
    if (key === "ticket") return sentenceResult(`${article(actor)} ${actor} holds the ${phrase} at the station.`, key, modifier, topic);
    return sentenceResult(`${article(actor)} ${actor} sees the ${phrase} near the station.`, key, modifier, topic);
  }
  if (HOME_WORDS.has(key)) {
    if (key === "bed") return sentenceResult(`The ${phrase} is in the room.`, key, modifier, topic);
    if (key === "sofa" || key === "shelf") return sentenceResult(`The ${phrase} is in the room.`, key, modifier, topic);
    if (key === "blanket") return sentenceResult(`${article(actor)} ${actor} folds the ${phrase}.`, key, modifier, topic);
    if (key === "box") return sentenceResult(`${article(actor)} ${actor} opens the ${phrase} on the table.`, key, modifier, topic);
    if (key === "cup") return sentenceResult(`${article(actor)} ${actor} puts the ${phrase} on the table.`, key, modifier, topic);
    if (key === "spoon") return sentenceResult(`${article(actor)} ${actor} uses the ${phrase} for soup.`, key, modifier, topic);
    return sentenceResult(`${article(actor)} ${actor} carries the ${phrase} to the room.`, key, modifier, topic);
  }

  return sentenceForObjectAction(actor, key, fallbackTopic, index);
}

function sentenceForObjectAction(rawActor, object, fallbackTopic, index) {
  const key = normalizeToken(object);
  if (!key || isPersonWord(key) || isVerbish(key) || isPropertyWord(key) || FUNCTION_WORDS.has(key)) return null;
  const topic = topicForNoun(key, fallbackTopic);
  const actor = normalizeToken(rawActor) || actorFor(topic, index);

  if (LIQUID_WORDS.has(key)) return sentenceResult(`${article(actor)} ${actor} drinks the ${key} after lunch.`, key, "", topic);
  if (key === "honey" || key === "yogurt") return sentenceResult(`${article(actor)} ${actor} tastes the ${key} with a spoon.`, key, "", topic);
  if (SOFT_FOOD_WORDS.has(key) || SOLID_FOOD_WORDS.has(key)) {
    const verb = key === "cake" || key === "cookie" ? "shares" : "eats";
    return sentenceResult(`${article(actor)} ${actor} ${verb} the ${key} after lunch.`, key, "", topic);
  }
  if (CLOTHING_WORDS.has(key)) return sentenceResult(`${article(actor)} ${actor} wears the ${key} today.`, key, "", topic);
  if (key === "story") return sentenceResult(`${article(actor)} ${actor} reads the story before bed.`, key, "", "school");
  if (SCHOOL_WORDS.has(key)) {
    const verb = ["book", "notebook"].includes(key) ? "opens" : key === "picture" ? "looks at" : "uses";
    return sentenceResult(`${article(actor)} ${actor} ${verb} the ${key} in class.`, key, "", topic);
  }
  if (PLAY_WORDS.has(key) || key === "castle") {
    const verb = key === "castle" ? "builds" : "plays with";
    return sentenceResult(`${article(actor)} ${actor} ${verb} the ${key} after school.`, key, "", topic);
  }
  if (NATURE_WORDS.has(key) || ANIMAL_WORDS.has(key)) {
    const place = key === "fish" ? "water" : "garden";
    return sentenceResult(`${article(actor)} ${actor} finds the ${key} in the ${place}.`, key, "", topic);
  }
  if (TRANSPORT_WORDS.has(key)) {
    if (key === "bike") return sentenceResult(`${article(actor)} ${actor} rides the bike on the path.`, key, "", topic);
    if (key === "ticket") return sentenceResult(`${article(actor)} ${actor} holds the ticket at the station.`, key, "", topic);
    return sentenceResult(`${article(actor)} ${actor} sees the ${key} near the station.`, key, "", topic);
  }
  if (HOME_WORDS.has(key)) {
    if (key === "bed" || key === "sofa" || key === "shelf") return sentenceResult(`The ${key} is in the room.`, key, "", topic);
    const place = differentPlace(placeForTopic(topic, index), key, topic, index);
    return sentenceResult(`${article(actor)} ${actor} carries the ${key} to the ${place}.`, key, "", topic);
  }

  return null;
}

function sentenceResult(text, noun, modifier, topic) {
  const tokens = tokenize(text);
  const actors = tokens.filter(isPersonWord);
  const place = tokens.find((token) => isPlaceWord(token) && token !== noun);
  const targetWords = uniqueWords([...actors, actionWord(text), modifier, noun, place]);
  const extraTags = modifier ? ["adjective_modifier"] : [];
  return { text, targetWords, topic: topicForNoun(noun, topic), extraTags };
}

function safeModifierForNoun(noun, property) {
  const key = normalizeToken(noun);
  const prop = normalizeToken(property);
  if (!prop) return "";

  const allowed = {
    apple: ["green", "red"],
    banana: ["yellow"],
    basket: ["full", "green", "small"],
    bed: ["clean", "red", "soft"],
    bike: ["small", "new"],
    blanket: ["brown", "clean", "new", "warm"],
    boat: ["dry"],
    book: ["clean", "new", "old"],
    box: ["empty", "full", "open", "small"],
    bus: ["empty"],
    cake: ["sweet"],
    car: ["full", "new", "red"],
    carrot: ["red"],
    coat: ["clean", "warm", "yellow"],
    cookie: ["small", "sweet"],
    cup: ["clean", "full", "red", "small"],
    doll: ["small", "yellow"],
    dress: ["clean", "pretty"],
    drum: ["small", "yellow"],
    eraser: ["clean", "small"],
    flower: ["green", "pretty", "red", "white", "yellow"],
    grass: ["green", "long"],
    honey: ["sweet"],
    jacket: ["clean", "warm"],
    juice: ["cold"],
    leaf: ["green"],
    milk: ["cold"],
    moon: ["bright"],
    mud: ["wet"],
    notebook: ["clean", "new", "old"],
    pasta: ["hot"],
    pants: ["clean"],
    pen: ["new"],
    picture: ["clean", "old", "pretty"],
    plane: ["new", "small"],
    potato: ["warm"],
    rice: ["hot"],
    rope: ["hard", "red"],
    seed: ["small"],
    shirt: ["clean"],
    shoe: ["clean", "new"],
    sky: ["blue", "clear"],
    sock: ["clean"],
    sofa: ["new", "small", "soft"],
    spoon: ["clean", "small"],
    star: ["bright"],
    stone: ["hard", "small"],
    story: ["fun", "good", "long", "old"],
    swing: ["small"],
    ticket: ["new", "small"],
    tomato: ["red"],
    toy: ["small", "yellow"],
    water: ["cold"],
    yogurt: ["cold", "sweet"],
  };

  if (key === "story" && prop === "small") return "short";
  return allowed[key]?.includes(prop) ? prop : "";
}

function concreteObjectFromWords(words, topic, index, options = {}) {
  const fallback = options.fallback ?? true;
  const candidates = words.map(normalizeToken).filter(isConcreteObject);
  return candidates.find((word) => !ANIMAL_WORDS.has(word)) || candidates[0] || (fallback ? objectForTopic(topic, index) : "");
}

function isConcreteObject(word) {
  const key = normalizeToken(word);
  return Boolean(key && !FUNCTION_WORDS.has(key) && !isPersonWord(key) && !isVerbish(key) && !isPropertyWord(key));
}

function differentActor(actor, avoid, topic, index) {
  const key = normalizeToken(actor);
  const blocked = normalizeToken(avoid);
  if (key && key !== blocked) return key;
  for (let offset = 0; offset < 4; offset += 1) {
    const candidate = actorFor(topic, index + offset);
    if (candidate !== blocked) return candidate;
  }
  return blocked === "child" ? "friend" : "child";
}

function differentPlace(place, object, topic, index) {
  const blocked = normalizeToken(object);
  const key = normalizeToken(place);
  if (key && key !== blocked) return key;
  for (let offset = 0; offset < 5; offset += 1) {
    const candidate = placeForTopic(topic, index + offset);
    if (candidate !== blocked) return candidate;
  }
  return blocked === "table" ? "room" : "table";
}

function isPlaceWord(word) {
  return PLACE_WORDS.has(normalizeToken(word));
}

function hasWord(words, target) {
  const key = normalizeToken(target);
  return words.some((word) => normalizeToken(word) === key);
}

function objectCanBeSmall(word) {
  return !LIQUID_WORDS.has(normalizeToken(word));
}

function actorFor(topic, index) {
  const actors = {
    animals: ["child", "friend", "teacher"],
    clothing: ["child", "sister", "brother"],
    colors: ["child", "student", "friend"],
    food: ["child", "mother", "friend"],
    home: ["father", "mother", "neighbor"],
    nature: ["child", "teacher", "friend"],
    people: ["student", "teacher", "friend"],
    play: ["child", "friend", "brother"],
    routine: ["child", "parent", "student"],
    school: ["student", "teacher", "child"],
    transport: ["father", "mother", "child"],
  };
  const list = actors[topic] || ["child", "friend", "student"];
  return list[index % list.length];
}

function objectForTopic(topic, index) {
  const objects = {
    animals: ["bird", "fish", "leaf"],
    clothing: ["shirt", "sock", "jacket"],
    colors: ["flower", "blanket", "ball"],
    food: ["apple", "banana", "sandwich"],
    home: ["cup", "box", "clock"],
    nature: ["leaf", "flower", "stone"],
    people: ["bag", "book", "ticket"],
    play: ["ball", "toy", "drum"],
    routine: ["bag", "cup", "book"],
    school: ["pencil", "notebook", "ruler"],
    transport: ["bus", "ticket", "bike"],
  };
  const list = objects[topic] || ["book", "ball", "bag"];
  return list[index % list.length];
}

function placeForTopic(topic, index) {
  const places = {
    animals: ["garden", "park", "tree"],
    clothing: ["chair", "bag", "shelf"],
    colors: ["table", "box", "basket"],
    food: ["table", "bag", "plate"],
    home: ["table", "shelf", "basket"],
    nature: ["garden", "park", "path"],
    people: ["classroom", "park", "room"],
    play: ["box", "table", "basket"],
    routine: ["room", "bag", "table"],
    school: ["desk", "bag", "classroom"],
    transport: ["bus", "station", "street"],
  };
  const list = places[topic] || ["table", "bag", "room"];
  return list[index % list.length];
}

function topicForNoun(noun, fallback) {
  const key = normalizeToken(noun);
  if (LIQUID_WORDS.has(key) || SOFT_FOOD_WORDS.has(key) || SOLID_FOOD_WORDS.has(key) || ["spoon", "cup"].includes(key)) return "food";
  if (CLOTHING_WORDS.has(key)) return "clothing";
  if (SCHOOL_WORDS.has(key) || key === "story") return "school";
  if (PLAY_WORDS.has(key) || key === "castle") return "play";
  if (NATURE_WORDS.has(key) || ANIMAL_WORDS.has(key)) return "nature";
  if (TRANSPORT_WORDS.has(key)) return "transport";
  if (HOME_WORDS.has(key)) return "home";
  return fallback || "home";
}

function isPersonWord(word) {
  return PEOPLE_WORDS.has(normalizeToken(word));
}

function isVerbish(word) {
  return VERBISH_WORDS.has(normalizeToken(word));
}

function isPropertyWord(word) {
  return PROPERTY_WORDS.has(normalizeToken(word));
}

function actionWord(text) {
  const verbs = ["builds", "carries", "chooses", "drinks", "eats", "enjoys", "finds", "folds", "holds", "keeps", "looks", "moves", "opens", "plays", "points", "puts", "reads", "rides", "see", "sees", "shares", "takes", "tastes", "touches", "uses", "wants", "wears"];
  const tokens = tokenize(text);
  return tokens.find((token) => verbs.includes(token)) || tokens.find((token) => ["is", "are"].includes(token)) || "";
}

function uniqueWords(words) {
  const out = [];
  const seen = new Set();
  for (const word of words) {
    const key = normalizeToken(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.slice(0, 6);
}

function article(word) {
  return /^[aeiou]/i.test(word) ? "An" : "A";
}

function sentenceCase(text) {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function normalizeText(text) {
  return tokenize(text).join(" ");
}

function normalizeToken(text) {
  return tokenize(text)[0] || "";
}

function tokenize(text) {
  const tokens = [];
  let current = "";
  for (const char of String(text || "").toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(char)) {
      current += char;
    } else if (current) {
      tokens.push(current);
      current = "";
    }
  }
  if (current) tokens.push(current);
  return tokens;
}
