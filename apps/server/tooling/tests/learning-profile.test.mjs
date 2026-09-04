import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const languageRuntimeStatic = new URL("../../../../apps/language-runtime/static/", import.meta.url);
const [courseProfileSource, learningProfileSource, chromeSource, appSource, wordWorldSource] = await Promise.all([
  readFile(new URL("source/shared/course-profile.js", staticRoot), "utf8"),
  readFile(new URL("source/learning-profile.js", languageRuntimeStatic), "utf8"),
  readFile(new URL("source/caatuu-chrome.js", languageRuntimeStatic), "utf8"),
  readFile(new URL("source/caatuu-workspace.js", languageRuntimeStatic), "utf8"),
  readFile(new URL("source/product-word-world.mjs", languageRuntimeStatic), "utf8")
]);

const selectorCourses = [
  {
    id: "cz",
    sourceLanguage: { id: "en" },
    targetLanguage: { id: "cs" },
    storage: { learningPerformance: "caatuu-czech.learning.performance.v1" }
  },
  {
    id: "zh",
    sourceLanguage: { id: "en" },
    targetLanguage: { id: "zh" },
    storage: { learningPerformance: "caatuu-zh-hans.learning.performance.v1" }
  }
];

function createLearningContext(initial = {}, options = {}) {
  const rows = new Map(Object.entries(initial));
  const events = [];
  const localStorage = {
    get length() {
      return rows.size;
    },
    key(index) {
      return [...rows.keys()][index] ?? null;
    },
    getItem(key) {
      return rows.has(key) ? rows.get(key) : null;
    },
    setItem(key, value) {
      rows.set(key, String(value));
    },
    removeItem(key) {
      rows.delete(key);
    }
  };
  class TestCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const context = {
    window: {
      localStorage,
      CustomEvent: TestCustomEvent,
      dispatchEvent(event) {
        events.push(event);
      }
    }
  };
  vm.runInNewContext(courseProfileSource, context, { filename: "course-profile.js" });
  if (options.selectorCourses) {
    context.window.CaatuuCourse = {
      ...context.window.CaatuuCourse,
      courseSelector: {
        ...context.window.CaatuuCourse.courseSelector,
        courses: options.selectorCourses
      }
    };
  }
  vm.runInNewContext(learningProfileSource, context, { filename: "learning-profile.js" });
  return { learning: context.window.CaatuuLearning, rows, events };
}

test("difficulty is course-scoped, constrained to levels 1-3, and saved independently", () => {
  const { learning, rows, events } = createLearningContext();
  assert.equal(learning.difficulty(), 1);
  assert.equal(learning.difficultyOption().label, "Explorer");
  assert.equal(learning.setDifficulty(3), 3);
  assert.equal(learning.difficulty(), 3);
  assert.equal(learning.setDifficulty(99), 1);
  assert.equal(learning.difficulty(), 1);
  assert.equal(JSON.parse(rows.get("caatuu-czech.learning.preferences.v1")).difficulty, 1);
  assert.ok(events.some((event) => event.detail.reason === "difficulty"));
});

test("an explicit saved difficulty is preserved when the default changes", () => {
  const { learning } = createLearningContext({
    "caatuu-czech.learning.preferences.v1": JSON.stringify({ schemaVersion: 1, difficulty: 2 })
  });
  assert.equal(learning.difficulty(), 2);
  assert.equal(learning.difficultyOption().label, "Traveler");
});

test("performance aggregates game activity without inventing achievements", () => {
  const { learning } = createLearningContext();
  learning.record("verb-nebula", { activities: 2, attempts: 2, successes: 1, rounds: 1 });
  learning.record("word-world", { activities: 3, attempts: 1, successes: 1, xp: 3, rounds: 1 });
  const profile = learning.snapshot();
  assert.equal(profile.summary.activities, 5);
  assert.equal(profile.summary.successes, 2);
  assert.equal(profile.summary.xp, 4);
  assert.equal(profile.summary.rounds, 2);
  assert.equal(profile.summary.accuracy, 67);
  assert.equal(profile.summary.activeGames, 2);
});

test("journey rewards aggregate only selector-declared course records", () => {
  const { learning } = createLearningContext({
    "caatuu-czech.learning.performance.v1": JSON.stringify({
      schemaVersion: 1,
      updatedAt: "",
      games: { "verb-nebula": { activities: 3, attempts: 2, successes: 1, xp: 2, rounds: 1 } }
    }),
    "caatuu-zh-hans.learning.performance.v1": JSON.stringify({
      schemaVersion: 1,
      updatedAt: "",
      games: { "word-world": { activities: 4, attempts: 3, successes: 3, xp: 7, rounds: 2 } }
    }),
    "caatuu-undeclared.learning.performance.v1": JSON.stringify({
      schemaVersion: 1,
      updatedAt: "",
      games: { fake: { activities: 99, xp: 99, rounds: 99 } }
    })
  }, { selectorCourses });
  const journey = learning.snapshot().journey.summary;
  assert.equal(journey.activities, 7);
  assert.equal(journey.xp, 9);
  assert.equal(journey.rounds, 3);
  assert.equal(journey.activeGames, 2);
  assert.equal(journey.activeCourses, 2);
});

test("course summaries expose safe per-course effort and ignore corrupt catalog entries", () => {
  const catalog = [
    ...selectorCourses,
    {
      id: "unsafe",
      sourceLanguage: { id: "en" },
      targetLanguage: { id: "xx" },
      storage: { learningPerformance: "outside-the-caatuu-namespace" }
    }
  ];
  const { learning } = createLearningContext({
    "caatuu-czech.learning.performance.v1": JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-09-03T12:00:00.000Z",
      games: {
        "verb-nebula": { activities: 4, attempts: 3, successes: 2, xp: 1250, rounds: 3 },
        broken: null
      }
    }),
    "caatuu-zh-hans.learning.performance.v1": JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-09-03T13:00:00.000Z",
      games: null
    }),
    "caatuu-undeclared.learning.performance.v1": JSON.stringify({
      schemaVersion: 1,
      games: { fake: { activities: 90, xp: 9000, rounds: 90 } }
    }),
    "outside-the-caatuu-namespace": "{not-json"
  }, { selectorCourses: catalog });

  const courses = learning.courseSummaries();
  assert.equal(courses.length, 2);
  assert.equal(courses[0].id, "cz");
  assert.equal(courses[0].sourceLanguageId, "en");
  assert.equal(courses[0].targetLanguageId, "cs");
  assert.equal(courses[0].updatedAt, "2026-09-03T12:00:00.000Z");
  assert.equal(courses[0].hasProgress, true);
  assert.equal(courses[0].summary.activities, 4);
  assert.equal(courses[0].summary.attempts, 3);
  assert.equal(courses[0].summary.successes, 2);
  assert.equal(courses[0].summary.xp, 1250);
  assert.equal(courses[0].summary.rounds, 3);
  assert.equal(courses[0].summary.accuracy, 67);
  assert.equal(courses[0].summary.activeGames, 1);
  assert.equal(courses[1].id, "zh");
  assert.equal(courses[1].sourceLanguageId, "en");
  assert.equal(courses[1].targetLanguageId, "zh");
  assert.equal(courses[1].updatedAt, "");
  assert.equal(courses[1].hasProgress, false);
  assert.equal(courses[1].summary.xp, 0);
  assert.equal(courses[1].summary.rounds, 0);

  const snapshotCourses = JSON.parse(JSON.stringify(learning.snapshot().journey.courses));
  assert.deepEqual(snapshotCourses, JSON.parse(JSON.stringify(courses)));
  assert.equal(learning.snapshot().journey.summary.xp, 1250);
  assert.equal(learning.snapshot().journey.summary.rounds, 3);
  assert.equal(learning.snapshot().journey.summary.activeCourses, 1);
});

test("streak advances once per local day, preserves its best, and keeps a recoverable lapse", () => {
  const { learning } = createLearningContext();
  const firstDay = new Date(2026, 8, 3, 12, 0, 0);
  const sameDay = new Date(2026, 8, 3, 22, 0, 0);
  const nextDay = new Date(2026, 8, 4, 8, 0, 0);

  assert.equal(learning.qualifyStreak(firstDay).currentDays, 1);
  assert.equal(learning.qualifyStreak(sameDay).currentDays, 1);
  const active = learning.qualifyStreak(nextDay);
  assert.equal(active.currentDays, 2);
  assert.equal(active.highestDays, 2);
  const expiry = new Date(active.expiresAt);
  assert.equal(expiry.getFullYear(), 2026);
  assert.equal(expiry.getMonth(), 8);
  assert.equal(expiry.getDate(), 6);
  assert.equal(expiry.getHours(), 0);

  const lapsed = learning.refreshStreak(new Date(expiry.getTime() + 1));
  assert.equal(lapsed.currentDays, 0);
  assert.equal(lapsed.highestDays, 2);
  assert.equal(lapsed.lastLapse.days, 2);
  assert.equal(lapsed.lastLapse.expiredAt, expiry.toISOString());

  const restarted = learning.qualifyStreak(new Date(2026, 8, 7, 9, 0, 0));
  assert.equal(restarted.currentDays, 1);
  assert.equal(restarted.highestDays, 2);
});

test("streak reminders are due once at five and three hours before the active deadline", () => {
  const { learning } = createLearningContext();
  const active = learning.qualifyStreak(new Date(2026, 8, 3, 12, 0, 0));
  const expiry = new Date(active.expiresAt).getTime();

  assert.equal(learning.dueStreakReminders(new Date(expiry - (6 * 60 * 60 * 1000))).length, 0);
  const fiveHour = learning.dueStreakReminders(new Date(expiry - (5 * 60 * 60 * 1000)));
  assert.equal(fiveHour.map(({ hours }) => hours).join(","), "5");
  assert.ok(learning.streakArtwork.includes(fiveHour[0].imagePath));
  learning.markStreakReminderDelivered(active.expiresAt, 5);
  assert.equal(learning.dueStreakReminders(new Date(expiry - (4 * 60 * 60 * 1000))).length, 0);

  const threeHour = learning.dueStreakReminders(new Date(expiry - (3 * 60 * 60 * 1000)));
  assert.equal(threeHour.map(({ hours }) => hours).join(","), "3");
  learning.markStreakReminderDelivered(active.expiresAt, 3);
  assert.equal(learning.dueStreakReminders(new Date(expiry - (2 * 60 * 60 * 1000))).length, 0);
});

test("only a successfully completed round qualifies the shared streak", () => {
  const { learning } = createLearningContext();
  learning.record("word-world", { attempts: 1, rounds: 1 });
  assert.equal(learning.snapshot().streak.currentDays, 0);
  learning.record("word-world", { xp: 1 });
  assert.equal(learning.snapshot().streak.currentDays, 0);
  learning.record("word-world", { attempts: 1, successes: 1, rounds: 1 });
  assert.equal(learning.snapshot().streak.currentDays, 1);
});

test("corrupt active streak data fails closed without erasing the recorded best", () => {
  const { learning } = createLearningContext({
    "caatuu.learning.streak.v1": JSON.stringify({
      schemaVersion: 1,
      currentDays: 8,
      highestDays: 14,
      lastQualifiedAt: "not-a-date",
      lastQualifiedLocalDate: "2026-99-99",
      expiresAt: "also-not-a-date"
    })
  });
  const streak = learning.snapshot().streak;
  assert.equal(streak.currentDays, 0);
  assert.equal(streak.highestDays, 14);
});

test("legacy game records use successes as XP until an explicit XP total exists", () => {
  const performance = JSON.stringify({
    schemaVersion: 1,
    updatedAt: "",
    games: {
      "word-world": { activities: 2, attempts: 2, successes: 1, rounds: 2 }
    }
  });
  const { learning } = createLearningContext({
    "caatuu-czech.learning.performance.v1": performance
  });
  assert.equal(learning.snapshot().summary.xp, 1);
  learning.record("word-world", { activities: 1, attempts: 1, successes: 1, xp: 3, rounds: 1 });
  assert.equal(learning.snapshot().summary.xp, 4);
  assert.equal(learning.snapshot().summary.successes, 2);
});

test("existing Verb Nebula statistics migrate once into the global learning record", () => {
  const legacy = JSON.stringify({
    schemaVersion: 2,
    stats: { attempts: 7, matches: 5, rounds: 2 }
  });
  const { learning, rows } = createLearningContext({
    "caatuu-czech.verb-memory.v2": legacy
  });
  assert.equal(learning.snapshot().summary.accuracy, 71);
  assert.equal(learning.snapshot().summary.xp, 5);
  assert.ok(rows.has("caatuu-czech.learning.performance.v1"));
  learning.record("verb-nebula", { activities: 1, attempts: 1, successes: 1 });
  assert.equal(learning.snapshot().summary.attempts, 8);
});

test("restarting progress preserves difficulty while clearing global and legacy scores", () => {
  const { learning, rows, events } = createLearningContext();
  learning.setDifficulty(3);
  learning.record("verb-nebula", { activities: 4, attempts: 4, successes: 3, rounds: 1 });
  const streakBeforeReset = learning.snapshot().streak;
  rows.set("caatuu-czech.verb-memory.v2", JSON.stringify({ schemaVersion: 2, stats: { attempts: 4 } }));
  learning.resetProgress();
  assert.equal(learning.difficulty(), 3);
  assert.equal(learning.snapshot().summary.activities, 0);
  assert.equal(learning.snapshot().streak.currentDays, streakBeforeReset.currentDays);
  assert.equal(learning.snapshot().streak.highestDays, streakBeforeReset.highestDays);
  assert.equal(rows.has("caatuu-czech.verb-memory.v2"), false);
  assert.ok(events.some((event) => event.detail.reason === "progress-reset"));
});

test("progress-reset preparers drain before reset, can unregister, and fail without clearing", async () => {
  const { learning } = createLearningContext();
  const order = [];
  let releasePreparation;
  const gate = new Promise((resolve) => { releasePreparation = resolve; });
  learning.record("verb-nebula", { activities: 2, attempts: 1, successes: 1 });
  learning.registerProgressResetPreparation(async () => {
    order.push("prepare-start");
    await gate;
    order.push("prepare-finish");
  });
  const unregister = learning.registerProgressResetPreparation(() => {
    order.push("unregistered");
  });
  unregister();

  const preparation = learning.prepareProgressReset();
  await Promise.resolve();
  assert.deepEqual(order, ["prepare-start"]);
  assert.equal(learning.snapshot().summary.activities, 2);
  releasePreparation();
  await preparation;
  learning.resetProgress();
  assert.deepEqual(order, ["prepare-start", "prepare-finish"]);
  assert.equal(learning.snapshot().summary.activities, 0);

  learning.record("word-world", { activities: 3, attempts: 1, successes: 1 });
  learning.registerProgressResetPreparation(async () => {
    throw new Error("lifecycle drain failed");
  });
  await assert.rejects(learning.prepareProgressReset(), /lifecycle drain failed/);
  assert.equal(
    learning.snapshot().summary.activities,
    3,
    "a rejected preparation must leave global progress untouched"
  );
});

test("the backpack progression hub and both active games use the global learning contract", () => {
  assert.match(chromeSource, /label: "Backpack"/);
  assert.match(chromeSource, /data-settings-view="items"/);
  assert.match(chromeSource, /data-settings-view="stats"/);
  assert.match(chromeSource, /data-settings-view="settings"/);
  assert.match(chromeSource, /Traveler badge/);
  assert.match(chromeSource, /data-difficulty-level/);
  assert.match(chromeSource, /courseProgressXp/);
  assert.match(chromeSource, /courseProgressCoins/);
  assert.match(chromeSource, /courseProgressActivities/);
  assert.match(chromeSource, /const journey = profile\.journey\?\.summary \|\| profile\.summary/);
  assert.match(chromeSource, /xp: journey\.xp/);
  assert.match(chromeSource, /coins: journey\.rounds/);
  assert.match(chromeSource, /data-caatuu-streak-count/);
  assert.match(chromeSource, /data-streak-reminder-toggle/);
  assert.match(chromeSource, /settingsResetCourseProgress/);
  assert.ok(
    chromeSource.indexOf("await learning.prepareProgressReset?.()")
      < chromeSource.indexOf("learning.resetProgress()"),
    "active game work must drain before the global progress-reset event is announced"
  );
  assert.doesNotMatch(chromeSource, /CaatuuCurriculum/);
  assert.match(appSource, /registerProgressResetPreparation\?\.\(prepareVerbProgressReset\)/);
  assert.match(appSource, /async function prepareVerbProgressReset[\s\S]*?lifecycle\?\.abort\?\.\(\)/);
  assert.match(wordWorldSource, /registerProgressResetPreparation\?\.\(prepareGuidedWordProgressReset\)/);
  assert.match(wordWorldSource, /async function prepareGuidedWordProgressReset[\s\S]*?lifecycle\.abort\(\)/);
  assert.match(appSource, /CaatuuLearning\?\.record\("verb-nebula"/);
  assert.match(wordWorldSource, /CaatuuLearning\?\.record\("word-world"/);
  assert.doesNotMatch(chromeSource, /Difficulty and progress/);
  assert.doesNotMatch(chromeSource, /settingsResetVerbMemory/);
});

test("the shared header rewards and global audio mute use stable cross-course hooks", () => {
  assert.match(chromeSource, /function formatCompactRewardCount\(/u);
  assert.match(chromeSource, /headerStats\.className = "app-header-stats"/u);
  assert.match(chromeSource, /stat\.className = `app-header-stat app-header-\$\{kind\}`/u);
  assert.match(chromeSource, /stat\.setAttribute\(`data-caatuu-header-\$\{kind\}`/u);
  assert.match(chromeSource, /statCount\.setAttribute\(`data-caatuu-header-\$\{kind\}-count`/u);
  assert.match(chromeSource, /createHeaderStat\("xp", experienceIconSrc\)/u);
  assert.match(chromeSource, /createHeaderStat\("coins", coinIconSrc\)/u);
  assert.match(chromeSource, /createHeaderStat\("streak", streakIconSrc\)/u);
  assert.match(chromeSource, /streak\.setAttribute\("data-caatuu-streak", ""\)/u);
  assert.match(chromeSource, /setAttribute\("data-caatuu-streak-count", ""\)/u);
  assert.match(chromeSource, /element\.textContent = formatCompactRewardCount\(count\)/u);
  assert.match(chromeSource, /renderHeaderReward\(root, "xp", rewards\.xp/u);
  assert.match(chromeSource, /renderHeaderReward\(root, "coins", rewards\.coins/u);

  assert.match(chromeSource, /const speechMutedStorageKey = "caatuu\.speech\.muted\.v1"/u);
  assert.match(chromeSource, /function getSpeechMuted\(\)/u);
  assert.match(chromeSource, /function setSpeechMuted\(value\)/u);
  assert.match(chromeSource, /function updateSpeechMuteControls\(root = document\)/u);
  assert.match(chromeSource, /caatuu:speech-mute-change/u);
  const speakTextStart = chromeSource.indexOf("  async function speakText(");
  const speakTextEnd = chromeSource.indexOf("  async function refreshSpeechVoiceControl(", speakTextStart);
  assert.ok(speakTextStart >= 0 && speakTextEnd > speakTextStart);
  assert.match(chromeSource.slice(speakTextStart, speakTextEnd), /getSpeechMuted\(\)/u);
  for (const apiName of ["getSpeechMuted", "setSpeechMuted", "updateSpeechMuteControls"]) {
    assert.match(
      chromeSource,
      new RegExp(`window\\.CaatuuChrome = \\{[\\s\\S]*?\\b${apiName},`, "u"),
      `CaatuuChrome must export ${apiName}.`
    );
  }
});
