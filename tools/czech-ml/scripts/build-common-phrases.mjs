#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fromRoot } from "./paths.mjs";

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const outDatasetDir = path.resolve(argValue("--out-dataset-dir", fromRoot("data", "curriculum", "common-phrases-v0.1")));
const outCuratedFile = path.resolve(argValue("--out-file", path.join(outDatasetDir, "curated", "common-phrases.en.jsonl")));
const outSourcesFile = path.resolve(argValue("--sources-file", path.join(outDatasetDir, "source-manifest.jsonl")));
const outValidationFile = path.resolve(argValue("--validation-file", path.join(outDatasetDir, "validation", "en.json")));
const outReportFile = path.resolve(argValue("--report-file", path.join(outDatasetDir, "reports", "common-phrases.json")));
const outReportMarkdownFile = path.resolve(argValue("--report-md-file", path.join(outDatasetDir, "reports", "common-phrases.md")));
const expectedRows = Number(argValue("--count", "500"));

const categories = [
  {
    category: "greetings_intro",
    conversation_function: "greet_and_introduce",
    phrases: [
      "Hello.",
      "Hi.",
      "Good morning.",
      "Good afternoon.",
      "Good evening.",
      "How are you?",
      "I'm fine.",
      "How's it going?",
      "Nice to meet you.",
      "Good to see you.",
      "What is your name?",
      "My name is Anna.",
      "This is my friend.",
      "Welcome.",
      "Come in.",
      "See you later.",
      "See you tomorrow.",
      "Goodbye.",
      "See you soon.",
      "Have a nice day.",
      "How was your day?",
      "It was good.",
      "I'm happy to see you.",
      "Are you new here?",
      "Let's say hello.",
    ],
  },
  {
    category: "courtesy",
    conversation_function: "be_polite",
    phrases: [
      "Please.",
      "Thank you.",
      "Thanks a lot.",
      "You're welcome.",
      "No problem.",
      "Excuse me.",
      "I'm sorry.",
      "That's okay.",
      "No worries.",
      "May I come in?",
      "May I sit here?",
      "Can I have this?",
      "Here you are.",
      "After you.",
      "Please wait.",
      "Just a moment.",
      "I didn't mean it.",
      "Thanks for waiting.",
      "Can I borrow this?",
      "I will give it back.",
      "That was nice of you.",
      "You are very kind.",
      "Please be careful.",
      "Please speak softly.",
      "Thank you for helping.",
    ],
  },
  {
    category: "classroom_learning",
    conversation_function: "learn_in_class",
    phrases: [
      "Open your book.",
      "Close your book.",
      "Listen carefully.",
      "Repeat after me.",
      "Read the sentence.",
      "Write your name.",
      "Raise your hand.",
      "Look at the board.",
      "Take out your pencil.",
      "Put away your book.",
      "I know the answer.",
      "I don't know.",
      "Can I answer?",
      "What does this mean?",
      "How do you spell it?",
      "Can you spell it?",
      "Say it again.",
      "Read it aloud.",
      "Work with a partner.",
      "Check your answer.",
      "It's my turn.",
      "It's your turn.",
      "I made a mistake.",
      "Let's try again.",
      "The lesson is over.",
    ],
  },
  {
    category: "help_clarification",
    conversation_function: "ask_for_help",
    phrases: [
      "Can you help me?",
      "I need help.",
      "Please help me.",
      "I don't understand.",
      "I understand now.",
      "Can you say that again?",
      "Can you speak slowly?",
      "Can you show me?",
      "What should I do?",
      "Where do I start?",
      "Is this right?",
      "Is this wrong?",
      "I am not sure.",
      "I have a question.",
      "Can I ask a question?",
      "What happened?",
      "Why is that?",
      "How does it work?",
      "Can you explain it?",
      "Please point to it.",
      "Which one is it?",
      "I can't find it.",
      "I found it.",
      "Let me try.",
      "I need more time.",
    ],
  },
  {
    category: "feelings_needs",
    conversation_function: "express_feelings_and_needs",
    phrases: [
      "I'm happy.",
      "I'm sad.",
      "I'm tired.",
      "I'm hungry.",
      "I'm thirsty.",
      "I'm cold.",
      "I'm hot.",
      "I'm scared.",
      "I'm excited.",
      "I'm bored.",
      "I feel better.",
      "I don't feel well.",
      "My head hurts.",
      "My stomach hurts.",
      "I need water.",
      "I need a break.",
      "I need to rest.",
      "I want to sleep.",
      "I want to play.",
      "I want to go home.",
      "I'm ready.",
      "I'm not ready.",
      "I'm busy.",
      "I'm nervous.",
      "I'm proud.",
    ],
  },
  {
    category: "family_people",
    conversation_function: "talk_about_people",
    phrases: [
      "This is my mother.",
      "This is my father.",
      "This is my sister.",
      "This is my brother.",
      "This is my grandma.",
      "This is my grandpa.",
      "My family is here.",
      "My friend is coming.",
      "Where is your friend?",
      "Who is that?",
      "That is my teacher.",
      "He is my neighbor.",
      "She is my classmate.",
      "They are my friends.",
      "We are a team.",
      "My baby brother is sleeping.",
      "My sister likes music.",
      "My father is at work.",
      "My mother is at home.",
      "Grandma is cooking.",
      "Grandpa is reading.",
      "I love my family.",
      "I miss my friend.",
      "Can we play together?",
      "Let's help each other.",
    ],
  },
  {
    category: "daily_routine",
    conversation_function: "talk_about_daily_routine",
    phrases: [
      "I wake up early.",
      "I get dressed.",
      "I brush my teeth.",
      "I wash my hands.",
      "I comb my hair.",
      "I eat breakfast.",
      "I go to school.",
      "I come home.",
      "I do my homework.",
      "I eat dinner.",
      "I take a bath.",
      "I go to bed.",
      "It's time to wake up.",
      "It's time to eat.",
      "It's time for school.",
      "It's time to play.",
      "It's time to sleep.",
      "Put on your shoes.",
      "Take off your coat.",
      "Wash your face.",
      "Clean your room.",
      "Make your bed.",
      "Pack your bag.",
      "Turn off the light.",
      "Close the door.",
    ],
  },
  {
    category: "time_calendar",
    conversation_function: "talk_about_time",
    phrases: [
      "What time is it?",
      "It is morning.",
      "It is afternoon.",
      "It is evening.",
      "It is late.",
      "It is early.",
      "Today is Monday.",
      "Tomorrow is Tuesday.",
      "Yesterday was Sunday.",
      "See you next week.",
      "I will come later.",
      "I am here now.",
      "Wait until noon.",
      "The bus comes soon.",
      "School starts at eight.",
      "Lunch is at twelve.",
      "We leave at five.",
      "I have time.",
      "I don't have time.",
      "Hurry up.",
      "Slow down.",
      "One more minute.",
      "Five minutes left.",
      "The day is over.",
      "What day is it?",
    ],
  },
  {
    category: "location_directions",
    conversation_function: "ask_and_give_directions",
    phrases: [
      "Where are you?",
      "I am here.",
      "Come here.",
      "Go there.",
      "Look over there.",
      "It's on the table.",
      "It's under the chair.",
      "It's in the bag.",
      "It's next to the door.",
      "It's behind the box.",
      "It's in front of you.",
      "Turn left.",
      "Turn right.",
      "Go straight.",
      "Stop here.",
      "Wait at the door.",
      "Please wait by the door.",
      "The park is near.",
      "The school is far.",
      "Where is the bathroom?",
      "Where is the classroom?",
      "I lost my way.",
      "Can you show me the way?",
      "Follow me.",
      "We are almost there.",
    ],
  },
  {
    category: "food_drink",
    conversation_function: "talk_about_food",
    phrases: [
      "Let's eat.",
      "Breakfast is ready.",
      "Lunch is ready.",
      "Dinner is ready.",
      "I like apples.",
      "I like bananas.",
      "I don't like onions.",
      "Can I have water?",
      "Can I have milk?",
      "I want some juice.",
      "This tastes good.",
      "This is too hot.",
      "This is too cold.",
      "The soup is warm.",
      "The bread is fresh.",
      "Please pass the spoon.",
      "I need a plate.",
      "I need a cup.",
      "I spilled my drink.",
      "May I have more?",
      "I'm full.",
      "No more, thank you.",
      "Let's share the cookie.",
      "Wash the fruit.",
      "Don't eat too fast.",
    ],
  },
  {
    category: "shopping_money",
    conversation_function: "shop_and_pay",
    phrases: [
      "How much is it?",
      "It costs two dollars.",
      "I want to buy this.",
      "Can I pay now?",
      "Here is the money.",
      "I need change.",
      "Do you have a bag?",
      "I am just looking.",
      "This is too expensive.",
      "This one costs less.",
      "I like this one.",
      "I don't need it.",
      "Can I try it on?",
      "It is too big.",
      "It is too small.",
      "Do you have another color?",
      "Where do we pay?",
      "Do we wait in line here?",
      "The store is open.",
      "The store is closed.",
      "I need bread.",
      "I need milk.",
      "Let's buy fruit.",
      "Put it in the basket.",
      "Thank you, goodbye.",
    ],
  },
  {
    category: "weather_clothing",
    conversation_function: "talk_about_weather_and_clothes",
    phrases: [
      "It is sunny.",
      "It is raining.",
      "It is windy.",
      "It is snowing.",
      "It is cloudy.",
      "The sky is blue.",
      "The weather is nice.",
      "The weather is bad.",
      "Take your coat.",
      "Wear your hat.",
      "Put on your jacket.",
      "Take an umbrella.",
      "My shoes are wet.",
      "My socks are dry.",
      "The shirt is clean.",
      "The pants are dirty.",
      "I need a sweater.",
      "This coat is warm.",
      "This dress is pretty.",
      "These shoes fit.",
      "The hat is too small.",
      "The jacket is too big.",
      "Hang up your coat.",
      "Fold your shirt.",
      "Put clothes away.",
    ],
  },
  {
    category: "play_hobbies",
    conversation_function: "play_and_share",
    phrases: [
      "Let's play.",
      "Do you want to play?",
      "Can I play too?",
      "It's my game.",
      "It's your game.",
      "Let's take turns.",
      "You go first.",
      "I go next.",
      "Throw the ball.",
      "Catch the ball.",
      "Kick the ball.",
      "Build a tower.",
      "Draw a picture.",
      "Color the flower.",
      "Sing a song.",
      "Dance with me.",
      "Read a story.",
      "Play music.",
      "Open the puzzle box.",
      "Find the missing piece.",
      "The game is fun.",
      "I won.",
      "You won.",
      "Good game.",
      "Let's play again.",
    ],
  },
  {
    category: "health_safety",
    conversation_function: "stay_safe",
    phrases: [
      "Are you okay?",
      "I am okay.",
      "Be careful.",
      "Watch out.",
      "Stop, please.",
      "Don't run.",
      "Don't touch that.",
      "Stay with me.",
      "Hold my hand.",
      "Look both ways.",
      "Call a teacher.",
      "Get help, please.",
      "I need a bandage.",
      "I hurt my knee.",
      "My hand hurts.",
      "Sit down.",
      "Drink some water.",
      "Take a deep breath.",
      "Rest for a minute.",
      "The floor is wet.",
      "The door is closed.",
      "This is not safe.",
      "Move away.",
      "Stay calm.",
      "Everything is okay.",
    ],
  },
  {
    category: "home_chores",
    conversation_function: "talk_about_home",
    phrases: [
      "I am home.",
      "Welcome home.",
      "The room is clean.",
      "The room is messy.",
      "Put it away.",
      "Pick up your toys.",
      "Sweep the floor.",
      "Wipe the table.",
      "Wash the dishes.",
      "Take out the trash.",
      "Feed the cat.",
      "Feed the dog.",
      "Water the plant.",
      "Open the window.",
      "Close the window.",
      "Turn on the light.",
      "Turn off the fan.",
      "The bed is soft.",
      "The sofa is comfortable.",
      "The key is on the shelf.",
      "Where is my bag?",
      "I found my keys.",
      "The clock is slow.",
      "The doorbell is ringing.",
      "Let's clean together.",
    ],
  },
  {
    category: "travel_transport",
    conversation_function: "use_transport",
    phrases: [
      "Where is the bus?",
      "The bus is here.",
      "The train is late.",
      "The car is full.",
      "Put on your seat belt.",
      "Sit by the window.",
      "We are on the bus.",
      "We are on the train.",
      "We are in the car.",
      "The station is busy.",
      "The ticket is in my bag.",
      "I need a ticket.",
      "The boat is big.",
      "The plane is flying.",
      "The bike is outside.",
      "Ride slowly.",
      "Stop at the corner.",
      "Cross the street.",
      "Wait for the light.",
      "The road is long.",
      "Are we there yet?",
      "We are almost home.",
      "I see the station.",
      "Let's get off here.",
      "Don't forget your bag.",
    ],
  },
  {
    category: "choices_opinions",
    conversation_function: "choose_and_give_opinion",
    phrases: [
      "I like it.",
      "I don't like it.",
      "I love it.",
      "I don't want it.",
      "I want this one.",
      "I want that one.",
      "Which one do you want?",
      "This one is better.",
      "That one is nice.",
      "It looks good.",
      "It looks funny.",
      "It is easy.",
      "It is hard.",
      "It is too loud.",
      "It is too quiet.",
      "I think so.",
      "I don't think so.",
      "Maybe later.",
      "Not today.",
      "Yes, please.",
      "No, thank you.",
      "I agree.",
      "I disagree.",
      "That's a good idea.",
      "Let's choose together.",
    ],
  },
  {
    category: "social_responses",
    conversation_function: "respond_socially",
    phrases: [
      "Yes.",
      "No.",
      "Maybe.",
      "Really?",
      "Of course.",
      "Sure.",
      "Not yet.",
      "Me too.",
      "Me neither.",
      "I can do it.",
      "You can do it.",
      "We can do it.",
      "That's great.",
      "That's funny.",
      "That's interesting.",
      "That's enough.",
      "Good job.",
      "Well done.",
      "Try again.",
      "Don't worry.",
      "I don't mind.",
      "It doesn't matter.",
      "I forgot.",
      "I remember.",
      "I am listening.",
    ],
  },
  {
    category: "plans_invitations",
    conversation_function: "make_plans",
    phrases: [
      "Let's go together.",
      "Let's go outside.",
      "Let's go inside.",
      "Let's go home.",
      "Let's go to school.",
      "Let's go to the park.",
      "Do you want to come?",
      "Can you come today?",
      "I can come tomorrow.",
      "I can't come today.",
      "What are you doing?",
      "I am going to play.",
      "I am going to read.",
      "I am going to eat.",
      "We can meet later.",
      "See you at school.",
      "Let's play in the park.",
      "Let's make a plan.",
      "What should we do?",
      "Let's start now.",
      "Let's finish later.",
      "Are you ready to go?",
      "I am ready to go.",
      "Wait for me.",
      "Don't be late.",
    ],
  },
  {
    category: "phone_technology",
    conversation_function: "use_simple_technology",
    phrases: [
      "Call me.",
      "Text me.",
      "Answer the phone.",
      "The phone is ringing.",
      "My phone is off.",
      "The battery is low.",
      "Charge the phone.",
      "Turn on the tablet.",
      "Turn off the computer.",
      "Open the app.",
      "Close the app.",
      "Press the button.",
      "Tap the picture.",
      "Take a photo.",
      "Send the message.",
      "I can't hear you.",
      "I can hear you.",
      "The sound is too loud.",
      "The screen is bright.",
      "The video is loading.",
      "The internet is slow.",
      "Try again later.",
      "Save your work.",
      "Don't share your password.",
      "Ask an adult first.",
    ],
  },
];

const source = {
  id: "caatuu-authored-common-phrases-v0.1",
  name: "Caatuu authored everyday English phrase bank",
  license: "MIT",
  source_type: "authored",
  notes: "No external phrase list was copied. Categories cover common ESL conversation functions and Caatuu learning-app needs.",
};

const rows = buildRows();
const validation = validateRows(rows);
if (validation.validation_errors.length > 0) {
  console.error(JSON.stringify(validation, null, 2));
  process.exit(1);
}

await writeJsonl(outCuratedFile, rows);
await writeJsonl(outSourcesFile, [source]);
await writeJson(outValidationFile, validation);
const report = buildReport(rows, validation);
await writeJson(outReportFile, report);
await fs.writeFile(outReportMarkdownFile, reportMarkdown(report), "utf8");

console.log(JSON.stringify({
  ok: true,
  rows: rows.length,
  output_file: outCuratedFile,
  validation_file: outValidationFile,
  report_file: outReportFile,
}, null, 2));

function buildRows() {
  const out = [];
  let rank = 1;
  for (const group of categories) {
    if (group.phrases.length !== 25) {
      throw new Error(`${group.category} must contain exactly 25 phrases; found ${group.phrases.length}`);
    }
    for (const phrase of group.phrases) {
      out.push(rowForPhrase(phrase, group, rank));
      rank += 1;
    }
  }
  if (out.length !== expectedRows) {
    throw new Error(`Expected ${expectedRows} phrases, generated ${out.length}`);
  }
  return out;
}

function rowForPhrase(phrase, group, rank) {
  const tokens = tokenize(phrase);
  const difficulty = difficultyFor(tokens, rank);
  return {
    id: `cc-${String(rank).padStart(6, "0")}`,
    english_text: phrase,
    czech_text: "",
    difficulty,
    cefr: difficulty === 1 ? "Pre-A1/A1" : difficulty === 2 ? "A1" : "A1/A2",
    age_band: difficulty === 3 ? "7-10" : "6-8",
    topic: topicForCategory(group.category),
    target_words: targetWords(tokens),
    grammar_tags: grammarTags(phrase, group.category, tokens),
    child_safe: true,
    modern_english: true,
    concrete: concreteForCategory(group.category),
    context_independent: true,
    naturalness_score: 5,
    simplicity_score: tokens.length <= 5 ? 5 : 4,
    notes: "",
  };
}

function difficultyFor(tokens, rank) {
  if (rank <= 175 && tokens.length <= 4) return 1;
  if (tokens.length <= 6) return 2;
  return 3;
}

function topicForCategory(category) {
  const map = {
    classroom_learning: "school",
    daily_routine: "routine",
    family_people: "people",
    feelings_needs: "people",
    food_drink: "food",
    health_safety: "routine",
    home_chores: "home",
    location_directions: "location",
    phone_technology: "technology",
    play_hobbies: "play",
    shopping_money: "shopping",
    time_calendar: "time",
    travel_transport: "transport",
    weather_clothing: "weather",
  };
  return map[category] || "conversation";
}

function concreteForCategory(category) {
  return !["choices_opinions", "social_responses", "courtesy"].includes(category);
}

function grammarTags(phrase, category, tokens) {
  const tags = new Set(["common_phrase"]);
  const lower = phrase.toLowerCase();
  if (phrase.includes("?")) tags.add("question");
  if (/^(please |open |close |listen |repeat |read |write |raise |look |take |put |say |work |check |wait |turn |go |come |stop |meet |follow |wash |wear |hang |fold |throw |catch |kick |build |draw |color |sing |dance |play |find |be |watch |stay |hold |call |get |sit |drink |rest |move |pick |sweep |wipe |feed |water |ride |cross |text |answer |charge |press |click |tap |send |save |ask )/i.test(phrase)) {
    tags.add("imperative");
  }
  if (/\b(can|may|will|should)\b/i.test(phrase)) tags.add("modal");
  if (/\bdon't|can't|didn't|doesn't|not\b/i.test(lower)) tags.add("negative");
  if (/\b(is|are|am|was)\b/i.test(lower)) tags.add("be_present");
  if (/\b(my|your|his|her|our)\b/i.test(lower)) tags.add("possessive");
  if (/\b(on|in|under|behind|near|outside|inside|at|to|from|with|next)\b/i.test(lower)) tags.add("prepositional_phrase");
  if (tokens.length <= 3) tags.add("short_formula");
  tags.add(`function_${conversationFunctionForCategory(category)}`);
  tags.add(`category_${category}`);
  return [...tags];
}

function conversationFunctionForCategory(category) {
  return categories.find((group) => group.category === category)?.conversation_function || "general_conversation";
}

function targetWords(tokens) {
  const stop = new Set([
    "a",
    "am",
    "an",
    "and",
    "are",
    "at",
    "can",
    "could",
    "couldn",
    "didn",
    "does",
    "doesn",
    "don",
    "do",
    "for",
    "had",
    "has",
    "have",
    "how",
    "i",
    "in",
    "is",
    "it",
    "let",
    "ll",
    "m",
    "may",
    "me",
    "my",
    "of",
    "one",
    "on",
    "out",
    "re",
    "s",
    "shouldn",
    "t",
    "the",
    "this",
    "that",
    "to",
    "too",
    "up",
    "was",
    "wasn",
    "we",
    "ve",
    "weren",
    "what",
    "where",
    "which",
    "who",
    "why",
    "will",
    "would",
    "wouldn",
    "you",
    "your",
  ]);
  const out = [];
  const seen = new Set();
  for (const token of tokens) {
    if (stop.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= 6) break;
  }
  return out;
}

function validateRows(rows) {
  const errors = [];
  const seenIds = new Set();
  const seenText = new Map();
  const categoryCounts = {};
  const difficultyCounts = {};
  for (const [index, row] of rows.entries()) {
    const expectedId = `cc-${String(index + 1).padStart(6, "0")}`;
    if (row.id !== expectedId) errors.push(`row ${index + 1}: expected id ${expectedId}, found ${row.id}`);
    for (const field of ["common_rank", "category", "conversation_function", "provenance"]) {
      if (field in row) errors.push(`row ${index + 1}: removed field is present: ${field}`);
    }
    if (seenIds.has(row.id)) errors.push(`row ${index + 1}: duplicate id ${row.id}`);
    seenIds.add(row.id);
    const normalized = normalizeText(row.english_text);
    if (!normalized) errors.push(`row ${index + 1}: blank english_text`);
    if (seenText.has(normalized)) {
      errors.push(`row ${index + 1}: duplicate english_text with row ${seenText.get(normalized) + 1}`);
    }
    seenText.set(normalized, index);
    if (typeof row.czech_text !== "string") errors.push(`row ${index + 1}: czech_text must be a string`);
    if (!Array.isArray(row.target_words)) errors.push(`row ${index + 1}: target_words must be an array`);
    if (!Array.isArray(row.grammar_tags)) errors.push(`row ${index + 1}: grammar_tags must be an array`);
    if (row.notes !== "") errors.push(`row ${index + 1}: notes must be blank`);
    for (const flag of ["child_safe", "modern_english", "concrete", "context_independent"]) {
      if (typeof row[flag] !== "boolean") errors.push(`row ${index + 1}: ${flag} must be boolean`);
    }
    const category = categoryFromRow(row);
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    difficultyCounts[row.difficulty] = (difficultyCounts[row.difficulty] || 0) + 1;
  }
  if (rows.length !== expectedRows) errors.push(`expected ${expectedRows} rows, found ${rows.length}`);
  return {
    generated_at: new Date().toISOString(),
    schema_version: "caatuu-curriculum-flat-v0.2",
    rows: rows.length,
    unique_ids: seenIds.size,
    duplicate_text_groups: rows.length - seenText.size,
    notes_blank: rows.every((row) => row.notes === ""),
    czech_text_filled: rows.filter((row) => String(row.czech_text || "").trim()).length,
    czech_text_blank: rows.filter((row) => !String(row.czech_text || "").trim()).length,
    category_counts: sortObject(categoryCounts),
    difficulty_counts: sortObject(difficultyCounts),
    validation_errors: errors,
  };
}

function categoryFromRow(row) {
  return (row.grammar_tags || [])
    .find((tag) => String(tag).startsWith("category_"))
    ?.replace(/^category_/, "") || "unknown";
}

function buildReport(rows, validation) {
  const tokenCounts = {};
  const openingCounts = {};
  const targetCounts = {};
  for (const row of rows) {
    const tokens = tokenize(row.english_text);
    tokenCounts[tokens.length] = (tokenCounts[tokens.length] || 0) + 1;
    const opening = tokens.slice(0, 3).join(" ");
    if (opening) openingCounts[opening] = (openingCounts[opening] || 0) + 1;
    for (const target of row.target_words) targetCounts[target] = (targetCounts[target] || 0) + 1;
  }
  return {
    generated_at: new Date().toISOString(),
    rows: rows.length,
    source_id: source.id,
    license: source.license,
    caveat: "This is an authored common conversation phrase bank, not a copied external frequency list.",
    validation,
    sentence_length_counts: sortObject(tokenCounts),
    top_openings: topEntries(openingCounts, 25),
    top_target_words: topEntries(targetCounts, 40),
  };
}

function reportMarkdown(report) {
  const lines = [
    "# Common English Phrases v0.1",
    "",
    `Generated: ${report.generated_at}`,
    `Rows: ${report.rows}`,
    `Source: ${report.source_id}`,
    `License: ${report.license}`,
    "",
    `Caveat: ${report.caveat}`,
    "",
    "## Category Counts",
    "",
    ...Object.entries(report.validation.category_counts).map(([key, count]) => `- ${key}: ${count}`),
    "",
    "## Difficulty Counts",
    "",
    ...Object.entries(report.validation.difficulty_counts).map(([key, count]) => `- ${key}: ${count}`),
    "",
    "## Top Target Words",
    "",
    ...report.top_target_words.slice(0, 20).map(([key, count]) => `- ${key}: ${count}`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function writeJsonl(file, rows) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function topEntries(object, limit) {
  return Object.entries(object)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => String(left).localeCompare(String(right))));
}

function normalizeText(text) {
  return tokenize(text).join(" ");
}

function tokenize(text) {
  return String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}
