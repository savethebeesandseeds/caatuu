import { readFileSync } from "node:fs";
import { join } from "node:path";
import { provisionalComplexity } from "./provisional-complexity.mjs";

export const BANK_DIRECTORY = "apps/languages/shared/semantic-banks";

const GAME_FILES = Object.freeze({
  "word-net": directory => `apps/languages/${directory}/content/word-world/content.json`,
  "verb-lab": directory => `apps/languages/${directory}/static/data/games/verb-nebula/content.json`,
  "memory-moon": directory => `apps/languages/${directory}/static/data/games/memory-moon/content.json`,
  "conjugation-comet": directory => `apps/languages/${directory}/static/data/games/conjugation-comet/content.json`,
  "grammar-gravity": directory => `apps/languages/${directory}/static/data/games/grammar-gravity/content.json`,
  "naturalization-nucleus": directory => `apps/languages/${directory}/static/data/games/naturalization-nucleus/content.json`,
  "case-cosmos": directory => `apps/languages/${directory}/static/data/games/case-cosmos/content.json`
});

export function bankDigits(bankId) {
  const match = /^sb\.[a-z0-9-]+\.(\d{6})$/u.exec(bankId || "");
  if (!match) throw new Error(`Invalid semantic bank id ${bankId}`);
  return match[1];
}

export function courseRecordId(courseId, game, bankId) {
  const digits = bankDigits(bankId);
  if (game === "memory-moon") return `mm-${courseId}-${digits}`;
  if (game === "conjugation-comet") return `${courseId}-conjugation-comet-${digits}`;
  return `${courseId}.${game}.${digits}`;
}

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

export function loadCourses(root) {
  const catalog = readJson(root, "apps/languages/catalog.json");
  return catalog.courses.map(entry => {
    const course = readJson(root, entry.manifest);
    return {
      id: course.id,
      directoryName: course.directoryName,
      games: new Set(course.games || []),
      sourceLocale: course.sourceLanguage.locale,
      targetLocale: course.targetLanguage.locale,
      targetLanguageId: course.targetLanguage.id
    };
  });
}

export function loadBanks(root) {
  const banks = new Map();
  for (const game of Object.keys(GAME_FILES)) {
    const rows = readJson(root, `${BANK_DIRECTORY}/${game}.json`);
    banks.set(game, rows);
  }
  return banks;
}

function wordNetRecord(course, row) {
  const englishLearner = course.sourceLocale.startsWith("en");
  return {
    id: courseRecordId(course.id, "word-net", row.id),
    semanticBankId: row.id,
    reviewStatus: "untranslated",
    difficulty: row.difficulty,
    usefulness: row.usefulness,
    complexity: provisionalComplexity(row.difficulty),
    topic: "general",
    englishText: row.englishText,
    embeddingText: row.englishText,
    englishAlternates: [],
    targetText: "",
    pronunciation: null,
    tokens: [],
    learnerBase: englishLearner ? null : { text: "", tokenMeanings: [] },
    sceneQuery: row.englishText,
    sceneAssetIds: [],
    annotations: {}
  };
}

function verbRecord(course, row) {
  const learningEnglish = course.id === "es-en";
  return {
    id: courseRecordId(course.id, "verb-lab", row.id),
    semanticBankId: row.id,
    kind: "verb",
    source: learningEnglish ? "" : row.englishText,
    target: learningEnglish ? row.englishText : "",
    difficulty: row.difficulty,
    usefulness: row.usefulness,
    complexity: provisionalComplexity(row.difficulty),
    reviewStatus: "untranslated"
  };
}

function memoryRecord(course, row) {
  return {
    id: courseRecordId(course.id, "memory-moon", row.id),
    semanticBankId: row.id,
    reviewStatus: "untranslated",
    revision: 1,
    difficulty: row.difficulty,
    usefulness: row.usefulness,
    complexity: provisionalComplexity(row.difficulty),
    topic: "general",
    familyId: `mm-${course.id}-bank`,
    targetText: "",
    learnerBaseText: row.englishText,
    englishText: row.englishText,
    embeddingText: row.englishText
  };
}

function conjugationRecord(course, row) {
  return {
    id: courseRecordId(course.id, "conjugation-comet", row.id),
    semanticBankId: row.id,
    reviewStatus: "untranslated",
    revision: 1,
    difficulty: row.difficulty,
    usefulness: row.usefulness,
    complexity: provisionalComplexity(row.difficulty),
    meaningChoiceBaseText: row.englishText,
    englishAuditText: row.englishText,
    forms: []
  };
}

function grammarRecord(course, row) {
  return {
    id: courseRecordId(course.id, "grammar-gravity", row.id),
    semanticBankId: row.id,
    reviewStatus: "untranslated",
    revision: 1,
    difficulty: row.difficulty,
    usefulness: row.usefulness,
    complexity: provisionalComplexity(row.difficulty),
    englishAuditText: row.englishText
  };
}

function naturalizationRecord(course, row) {
  return {
    id: courseRecordId(course.id, "naturalization-nucleus", row.id),
    semanticBankId: row.id,
    reviewStatus: "untranslated",
    target: "",
    reading: "",
    translation: "",
    englishAuditText: row.englishText,
    difficulty: row.difficulty,
    usefulness: row.usefulness,
    complexity: provisionalComplexity(row.difficulty)
  };
}

function caseRecord(course, row) {
  return {
    id: courseRecordId(course.id, "case-cosmos", row.id),
    semanticBankId: row.id,
    reviewStatus: "untranslated",
    english: row.englishText,
    czech: "",
    difficulty: row.difficulty,
    usefulness: row.usefulness,
    complexity: provisionalComplexity(row.difficulty)
  };
}

const RECORD_BUILDERS = Object.freeze({
  "word-net": wordNetRecord,
  "verb-lab": verbRecord,
  "memory-moon": memoryRecord,
  "conjugation-comet": conjugationRecord,
  "grammar-gravity": grammarRecord,
  "naturalization-nucleus": naturalizationRecord,
  "case-cosmos": caseRecord
});

export function deriveCourseDocument(course, game, rows, envelope) {
  const records = rows.map(row => RECORD_BUILDERS[game](course, row));
  if (game === "verb-lab") return records;
  if (game === "word-net") return { ...envelope, records };
  if (game === "memory-moon") return { ...envelope, challenges: records };
  if (game === "conjugation-comet") return { ...envelope, verbs: records };
  if (game === "grammar-gravity") return { ...envelope, challenges: records };
  if (game === "naturalization-nucleus") return { ...envelope, challenges: records };
  return { ...envelope, legacyNouns: [], contexts: records };
}

export function planDerivations(root) {
  const courses = loadCourses(root);
  const banks = loadBanks(root);
  const plans = [];
  for (const [game, pathFor] of Object.entries(GAME_FILES)) {
    const rows = banks.get(game);
    for (const course of courses) {
      if (!course.games.has(game)) continue;
      const relativePath = pathFor(course.directoryName);
      const envelope = game === "verb-lab" ? null : readJsonSafe(root, relativePath);
      plans.push({
        courseId: course.id,
        game,
        relativePath,
        document: deriveCourseDocument(course, game, rows, envelope),
        count: rows.length
      });
    }
  }
  return plans;
}

function readJsonSafe(root, relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}
