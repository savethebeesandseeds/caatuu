import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { loadCourseCatalog } from "../../../../tools/language-packs/lib/course-contract.mjs";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const languageRuntimeStatic = new URL("../../../../apps/language-runtime/static/", import.meta.url);
const [courseProfileSource, learningProfileSource, chromeSource, appSource, wordWorldSource, interfaceSource] = await Promise.all([
  readFile(new URL("source/shared/course-profile.js", staticRoot), "utf8"),
  readFile(new URL("source/learning-profile.js", languageRuntimeStatic), "utf8"),
  readFile(new URL("source/caatuu-chrome.js", languageRuntimeStatic), "utf8"),
  readFile(new URL("source/caatuu-workspace.js", languageRuntimeStatic), "utf8"),
  readFile(new URL("source/product-word-world.mjs", languageRuntimeStatic), "utf8"),
  readFile(new URL("data/interface/en.v1.json", languageRuntimeStatic), "utf8")
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
  let now = new Date(options.now ?? Date.now()).getTime();
  class ScenarioDate extends Date {
    constructor(...arguments_) {
      super(...(arguments_.length ? arguments_ : [now]));
    }

    static now() {
      return now;
    }
  }
  const rows = options.rows || new Map(Object.entries(initial));
  const events = [];
  const localStorage = {
    get length() {
      return rows.size;
    },
    key(index) {
      return [...rows.keys()][index] ?? null;
    },
    getItem(key) {
      options.beforeRead?.(key, rows);
      return rows.has(key) ? rows.get(key) : null;
    },
    setItem(key, value) {
      options.beforeWrite?.(key, value, rows);
      rows.set(key, String(value));
    },
    removeItem(key) {
      options.beforeRemove?.(key, rows);
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
    Date: options.now === undefined ? Date : ScenarioDate,
    window: {
      localStorage,
      addEventListener(type, handler) { options.listeners?.set(type, handler); },
      navigator: options.navigator || { locks: { request: async (_name, action) => action() } },
      CustomEvent: TestCustomEvent,
      dispatchEvent(event) {
        events.push(event);
      }
    }
  };
  vm.runInNewContext(courseProfileSource, context, { filename: "course-profile.js" });
  if (options.course) context.window.CaatuuCourse = options.course;
  if (options.selectorCourses) {
    context.window.CaatuuCourse = {
      ...context.window.CaatuuCourse,
      courseSelector: {
        ...context.window.CaatuuCourse.courseSelector,
        courses: options.selectorCourses
      }
    };
  }
  vm.runInNewContext(options.profileSource ?? learningProfileSource, context, { filename: "learning-profile.js" });
  return {
    learning: context.window.CaatuuLearning,
    window: context.window,
    rows,
    events,
    setNow(value) {
      now = new Date(value).getTime();
      return new Date(now);
    }
  };
}

test("new learners start at zero and difficulty is constrained to levels 0-3", () => {
  const { learning, rows, events } = createLearningContext();
  assert.equal(learning.difficulty(), 0);
  assert.equal(learning.difficultyOption().label, "Starting out");
  assert.equal(createLearningContext(Object.fromEntries(rows)).learning.difficulty(), 0);
  assert.equal(learning.setDifficulty(3), 3);
  assert.equal(learning.difficulty(), 3);
  assert.equal(learning.setDifficulty(99), 1);
  assert.equal(learning.difficulty(), 1);
  assert.equal(JSON.parse(rows.get("caatuu-czech.learning.preferences.v1")).difficulty, 1);
  assert.ok(events.some((event) => event.detail.reason === "difficulty"));
});

test("only an actual difficulty change announces a reset and earned progress stays saved", () => {
  const { learning, rows, events } = createLearningContext();
  learning.record("word-net", { xp: 5, rounds: 1, successes: 1, attempts: 1 });
  const performance = rows.get("caatuu-czech.learning.performance.v1");
  events.length = 0;
  learning.setDifficulty(0);
  assert.equal(events.length, 0);
  learning.setDifficulty(2);
  learning.setDifficulty(2);
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.reason, "difficulty");
  assert.equal(rows.get("caatuu-czech.learning.performance.v1"), performance);
});

test("an explicit saved difficulty is preserved when the default changes", () => {
  const { learning } = createLearningContext({
    "caatuu-czech.learning.preferences.v1": JSON.stringify({ schemaVersion: 1, difficulty: 2 })
  });
  assert.equal(learning.difficulty(), 2);
  assert.equal(learning.difficultyOption().label, "Traveler");
});

test("all existing badges and legacy course histories retain their previous selection", () => {
  for (const difficulty of [0, 1, 2, 3]) {
    const preferences = JSON.stringify({ schemaVersion: 1, difficulty });
    const { learning, rows } = createLearningContext({ "caatuu-czech.learning.preferences.v1": preferences });
    assert.equal(learning.difficulty(), difficulty);
    assert.equal(rows.get("caatuu-czech.learning.preferences.v1"), preferences);
  }
  const performance = JSON.stringify({ schemaVersion: 1, games: {} });
  const { learning, rows } = createLearningContext({ "caatuu-czech.learning.performance.v1": performance });
  assert.equal(learning.difficulty(), 1);
  assert.equal(rows.get("caatuu-czech.learning.performance.v1"), performance);
  assert.equal(rows.has("caatuu-czech.learning.preferences.v1"), false);
});

test("missing, blank or malformed preferences never coerce to the new zero badge", () => {
  for (const difficulty of [null, "", " ", true, false, {}, [], -1, 4]) {
    const { learning } = createLearningContext({
      "caatuu-czech.learning.preferences.v1": JSON.stringify({ schemaVersion: 1, difficulty })
    });
    assert.equal(learning.difficulty(), 1, JSON.stringify(difficulty));
  }
});

test("display and setup preferences do not make an unpracticed learner skip zero", () => {
  const { learning } = createLearningContext({ "caatuu-czech.theme": "dark",
    "caatuu-czech.font-size": "largest", "caatuu-czech.setup.v1": JSON.stringify({ ready: true }) });
  assert.equal(learning.difficulty(), 0);
});

test("a new learner remains at zero after practice, reload and a display change", async () => {
  const { learning, rows } = createLearningContext();
  learning.record("word-world", { attempts: 1, successes: 1, rounds: 1, xp: 3 });
  await learning.retryPendingSaves();
  rows.set("caatuu-czech.theme", "dark");
  const reloaded = createLearningContext(Object.fromEntries(rows)).learning;
  assert.equal(reloaded.difficulty(), 0);
  assert.equal(reloaded.snapshot().summary.rounds, 1);
  assert.equal(reloaded.practiceSet().progression.stage.difficulty, 0);
});

test("game controls default to the selected difficulty in every course", async () => {
  const { courses } = await loadCourseCatalog();
  const expected = [
    { verbPairs: 2, nucleusTiles: 5, soundChoices: 4, soundMode: "words", grammarMeaningChoices: 3 },
    { verbPairs: 4, nucleusTiles: 5, soundChoices: 4, soundMode: "sentences", grammarMeaningChoices: 3 },
    { verbPairs: 6, nucleusTiles: 9, soundChoices: 6, soundMode: "sentences", grammarMeaningChoices: 6 },
    { verbPairs: 8, nucleusTiles: 9, soundChoices: 6, soundMode: "sentences", grammarMeaningChoices: 6 }
  ];
  for (const { course } of courses) for (const difficulty of [0, 1, 2, 3]) {
    const key = course.storage.learningPreferences || `${course.storage.namespace}.learning.preferences.v1`;
    const { learning } = createLearningContext({ [key]: JSON.stringify({ schemaVersion: 1, difficulty }) }, { course });
    for (const [name, value] of Object.entries(expected[difficulty])) {
      assert.equal(learning.gameSetting(name), value, `${course.id}/${difficulty}/${name}`);
    }
  }
});

test("manual game settings survive reload and selecting the same badge", () => {
  const first = createLearningContext();
  const overrides = { verbPairs: 8, nucleusTiles: 9, soundChoices: 6,
    soundMode: "sentences", grammarMeaningChoices: 6 };
  for (const [name, value] of Object.entries(overrides)) assert.equal(first.learning.setGameSetting(name, value), true);
  first.learning.setDifficulty(0);
  assert.equal(first.events.filter(event => event.detail?.reason === "difficulty").length, 0);
  const reloaded = createLearningContext({}, { rows: first.rows });
  for (const [name, value] of Object.entries(overrides)) assert.equal(reloaded.learning.gameSetting(name), value);
  assert.equal(reloaded.learning.setGameSetting("soundChoices", 2), false);
  assert.equal(reloaded.learning.gameSetting("soundChoices"), 6);
});

test("changing difficulty resets every game before notification, including unopened games and round trips", () => {
  const { learning, window, rows } = createLearningContext();
  learning.setGameSetting("verbPairs", 8);
  learning.setGameSetting("nucleusTiles", 9);
  learning.setGameSetting("soundChoices", 6);
  learning.setGameSetting("soundMode", "sentences");
  learning.setGameSetting("grammarMeaningChoices", 6);
  const unchanged = [learning.storage.performanceStorageKey, learning.storage.practiceStorageKey,
    learning.storage.contentStorageKey].map(key => [key, rows.get(key)]);
  const seen = [];
  window.dispatchEvent = event => {
    if (event.detail?.reason !== "difficulty") return;
    seen.push([event.detail.difficulty, learning.gameSetting("verbPairs"), learning.gameSetting("soundMode")]);
  };
  learning.setDifficulty(3);
  learning.setGameSetting("verbPairs", 2);
  learning.setGameSetting("soundMode", "words");
  learning.setDifficulty(1);
  learning.setDifficulty(0);
  assert.deepEqual(seen, [[3, 8, "sentences"], [1, 4, "sentences"], [0, 2, "words"]]);
  const reloaded = createLearningContext({}, { rows }).learning;
  assert.deepEqual(["verbPairs", "nucleusTiles", "soundChoices", "soundMode", "grammarMeaningChoices"]
    .map(name => reloaded.gameSetting(name)), [2, 5, 4, "words", 3]);
  for (const [key, value] of unchanged) assert.equal(rows.get(key), value, `progress unchanged: ${key}`);
});

test("an external badge change resets defaults without overwriting a newer manual choice", () => {
  const first = createLearningContext();
  const listeners = new Map();
  const second = createLearningContext({}, { rows: first.rows, listeners });
  first.learning.setDifficulty(3);
  first.learning.setGameSetting("nucleusTiles", 5);
  listeners.get("storage")({ key: first.learning.storage.preferenceStorageKey });
  assert.equal(second.learning.gameSetting("nucleusTiles"), 5);
  first.rows.set(first.learning.storage.preferenceStorageKey, JSON.stringify({ schemaVersion: 1, difficulty: 1 }));
  listeners.get("storage")({ key: first.learning.storage.preferenceStorageKey });
  assert.equal(second.learning.gameSetting("verbPairs"), 4);
  assert.equal(second.learning.gameSetting("soundMode"), "sentences");
});

test("game settings remain usable in memory when their storage is denied", () => {
  const { learning } = createLearningContext({}, { beforeWrite(key) {
    if (key.includes(".game-settings.")) throw new Error("Storage denied");
  } });
  assert.equal(learning.setGameSetting("soundChoices", 6), false);
  assert.equal(learning.gameSetting("soundChoices"), 6);
  learning.setDifficulty(3);
  assert.equal(learning.gameSetting("verbPairs"), 8);
  learning.setDifficulty(0);
  assert.equal(learning.gameSetting("soundChoices"), 4);
  assert.equal(learning.gameSetting("soundMode"), "words");
});

test("queued cross-window badge round trips notify mounted games even when the final badge is unchanged", () => {
  const first = createLearningContext();
  first.learning.setGameSetting("verbPairs", 8);
  first.learning.setGameSetting("nucleusTiles", 9);
  const listeners = new Map();
  const second = createLearningContext({}, { rows: first.rows, listeners });
  first.learning.setDifficulty(3);
  first.learning.setDifficulty(0);
  for (let index = 0; index < 2; index += 1) {
    listeners.get("storage")({ key: first.learning.storage.preferenceStorageKey });
  }
  const notifications = second.events.filter(event => event.detail?.reason === "difficulty");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].detail.difficulty, 0);
  assert.equal(notifications[0].detail.settingsReset, true);
  assert.equal(second.learning.gameSetting("verbPairs"), 2);
  assert.equal(second.learning.gameSetting("nucleusTiles"), 5);
});

test("level zero has exactly 100 cycles in every course while later bands retain their corpus budgets", async () => {
  const { courses } = await loadCourseCatalog();
  for (const { course } of courses) {
    const { learning } = createLearningContext({}, { course });
    const practice = learning.practiceSet();
    assert.equal(practice.target, 24);
    assert.equal(practice.cycle.target, 16);
    for (const stage of practice.progression.stages) {
      if (stage.difficulty === 0) {
        assert.equal(stage.targetCycles, 100, course.id);
        assert.equal(stage.budget.fixedCycles, 100, course.id);
      } else {
        const expected = Math.max(200, 25 * Math.ceil(6 * stage.budget.corpusEffort / (384 * 25)));
        assert.equal(stage.targetCycles, expected, `${course.id}/${stage.difficulty}`);
        assert.equal(stage.budget.minimumCycles, 200);
      }
    }
  }
});

test("larger future banks keep zero at 100 cycles and retain later corpus scaling", () => {
  const corpus = { cz: { 0: { units: 50000, effort: 100000 }, 1: { units: 5000, effort: 12801 },
    2: { units: 5000, effort: 25601 }, 3: { units: 0, effort: 0 } } };
  const profileSource = learningProfileSource.replace(/\/\/ BEGIN GENERATED PRACTICE CORPUS[\s\S]*?\/\/ END GENERATED PRACTICE CORPUS/u,
    `// BEGIN GENERATED PRACTICE CORPUS\n  const practiceCorpusWorkloads = Object.freeze(${JSON.stringify(corpus)});\n  // END GENERATED PRACTICE CORPUS`);
  assert.notEqual(profileSource, learningProfileSource);
  const { learning } = createLearningContext({}, { profileSource });
  const stages = learning.practiceSet().progression.stages;
  assert.deepEqual(Array.from(stages, stage => stage.targetCycles), [100, 225, 425, 200]);
});

test("zero completes on its 100th cycle without automatically changing difficulty or later progress", async () => {
  const first = createLearningContext();
  const submit = learning => learning.record("word-world", { attempts: 1, successes: 1, rounds: 1, xp: 3 });
  submit(first.learning);
  await first.learning.retryPendingSaves();
  const key = "caatuu-czech.learning.practice.v1";
  const saved = JSON.parse(first.rows.get(key));
  saved.stages[0] = { completedSets: 1599, effort: 21 };
  saved.stages[1] = { completedSets: 17, effort: 6 };
  saved.stages[2] = { completedSets: 23, effort: 9 };
  const raw = JSON.stringify(saved);
  first.rows.set(key, raw);
  first.rows.set(`${key}.backup`, raw);
  const app = createLearningContext({}, { rows: first.rows });
  const before = app.learning.practiceSet();
  assert.equal(before.progression.stage.completedCycles, 99);
  assert.equal(before.progression.stage.cycle.sets, 15);
  assert.equal(before.progression.stage.stageComplete, false);
  submit(app.learning);
  const after = app.learning.practiceSet();
  assert.equal(after.progression.stage.completedCycles, 100);
  assert.equal(after.progression.stage.completedSets, 1600);
  assert.equal(after.progression.stage.stageComplete, true);
  assert.equal(app.learning.difficulty(), 0);
  assert.deepEqual(Array.from(after.progression.stages).slice(1), Array.from(before.progression.stages).slice(1));
  await app.learning.retryPendingSaves();
  const reloaded = createLearningContext({}, { rows: first.rows });
  assert.equal(reloaded.learning.practiceSet().progression.stage.stageComplete, true);
  assert.equal(reloaded.learning.difficulty(), 0);
});

test("lowering zero's target preserves previously earned work, rewards and preferences", async () => {
  const first = createLearningContext();
  first.learning.record("word-world", { attempts: 1, successes: 1, rounds: 1, xp: 3 });
  await first.learning.retryPendingSaves();
  const key = "caatuu-czech.learning.practice.v1";
  const saved = JSON.parse(first.rows.get(key));
  saved.stages[0] = { completedSets: 2400, effort: 17 };
  const raw = JSON.stringify(saved);
  first.rows.set(key, raw);
  first.rows.set(`${key}.backup`, raw);
  const existing = new Map(first.rows);
  const app = createLearningContext({}, { rows: first.rows });
  const practice = app.learning.practiceSet();
  assert.equal(practice.progression.stage.completedCycles, 100);
  assert.equal(practice.progression.stage.stageComplete, true);
  assert.equal(practice.completedSets, saved.completedSets);
  assert.equal(practice.effort, saved.effort);
  assert.equal(practice.coins, saved.coinsEarned);
  assert.equal(practice.gems, saved.gemsEarned);
  assert.deepEqual(JSON.parse(JSON.stringify(practice.pending)), saved.rewards[0] ?? null);
  assert.equal(app.learning.difficulty(), 0);
  await app.learning.retryPendingSaves();
  assert.deepEqual(first.rows, existing, "reading a shorter advisory stage must not rewrite saved evidence");
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

for (const legacyId of ["agreement-aurora", "triangular-thermosphere"]) {
test(`Grammar Gravity preserves ${legacyId} progress without migration writes or extra credit`, async () => {
  const key = "caatuu-czech.learning.performance.v1";
  const saved = JSON.stringify({
    schemaVersion: 1,
    updatedAt: "2026-09-04T12:00:00.000Z",
    games: {
      [legacyId]: {
        activities: 6, attempts: 7, successes: 5, rounds: 2,
        lastPlayedAt: "2026-09-04T12:00:00.000Z"
      }
    }
  });
  const { learning, rows, events } = createLearningContext({ [key]: saved });
  for (let read = 0; read < 3; read += 1) {
    const profile = learning.snapshot();
    assert.deepEqual(Object.keys(profile.performance.games), ["grammar-gravity"]);
    assert.equal(profile.summary.xp, 5, "legacy successes still supply the historical XP fallback");
    assert.equal(profile.summary.activeGames, 1);
    assert.equal(profile.performance.games["grammar-gravity"].lastPlayedAt, "2026-09-04T12:00:00.000Z");
    assert.equal(rows.get(key), saved, "reading progress must not rewrite the user's profile");
    assert.equal(events.length, 0);
  }
  for (const gameId of ["grammar-gravity", "agreement-aurora", "triangular-thermosphere"]) {
    learning.record(gameId, { activities: 1, attempts: 1, successes: 1 });
  }
  await learning.retryPendingSaves();
  const stored = JSON.parse(rows.get(key));
  assert.deepEqual(Object.keys(stored.games), ["grammar-gravity"]);
  assert.equal(stored.games["grammar-gravity"].activities, 9);
  assert.equal(stored.games["grammar-gravity"].xp, 8);
  assert.equal(learning.snapshot().summary.xp, 8);
  assert.equal(learning.snapshot().summary.activeGames, 1);
  const reloaded = createLearningContext(Object.fromEntries(rows));
  assert.equal(reloaded.learning.snapshot().summary.xp, 8);
  assert.equal(reloaded.learning.snapshot().summary.activeGames, 1);
  assert.equal(reloaded.events.length, 0, "reloading normalized progress must not award credit");
});
}

test("all three historical game identities coalesce once in profile and journey summaries", async () => {
  const games = {
    "agreement-aurora": {
      activities: 6, attempts: 7, successes: 5, xp: 5, rounds: 2,
      lastPlayedAt: "2026-09-03T12:00:00.000Z"
    },
    "triangular-thermosphere": {
      activities: 3, attempts: 3, successes: 3, xp: 4, rounds: 1,
      lastPlayedAt: "2026-09-04T12:00:00.000Z"
    },
    "grammar-gravity": {
      activities: 2, attempts: 2, successes: 2, xp: 3, rounds: 1,
      lastPlayedAt: "2026-09-05T12:00:00.000Z"
    },
    "word-world": { activities: 1, xp: 1 }
  };
  for (const orderedGames of [games, Object.fromEntries(Object.entries(games).reverse())]) {
    const record = { schemaVersion: 1, updatedAt: "", games: orderedGames };
    const { learning, rows } = createLearningContext({
      "caatuu-czech.learning.performance.v1": JSON.stringify(record),
      "caatuu-zh-hans.learning.performance.v1": JSON.stringify(record)
    }, { selectorCourses });
    const performance = learning.performance();
    assert.equal(performance.games["agreement-aurora"], undefined);
    assert.equal(performance.games["triangular-thermosphere"], undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(performance.games["grammar-gravity"])), {
      activities: 11, attempts: 12, successes: 10, xp: 12, rounds: 4,
      lastPlayedAt: "2026-09-05T12:00:00.000Z"
    });
    assert.equal(learning.summarize(record).activeGames, 2);
    assert.equal(learning.snapshot().journey.summary.xp, 26);
    assert.equal(learning.snapshot().journey.summary.activeGames, 4);
    for (const gameId of ["grammar-gravity", "agreement-aurora", "triangular-thermosphere"]) {
      learning.record(gameId, { xp: 1 });
    }
    assert.equal(learning.snapshot().journey.summary.xp, 29);
    assert.equal(learning.snapshot().journey.summary.xp, 29, "repeated reads must not remigrate counters");
    await learning.retryPendingSaves();
    const stored = JSON.parse(rows.get("caatuu-czech.learning.performance.v1"));
    assert.equal(stored.games["agreement-aurora"], undefined);
    assert.equal(stored.games["triangular-thermosphere"], undefined);
    assert.equal(stored.games["grammar-gravity"].xp, 15);
    const reloaded = createLearningContext(Object.fromEntries(rows), { selectorCourses });
    assert.equal(reloaded.learning.snapshot().journey.summary.xp, 29);
    assert.equal(reloaded.learning.snapshot().journey.summary.activeGames, 4);
    assert.equal(reloaded.events.length, 0);
  }
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
  const firstDay = new Date(2026, 8, 3, 12, 0, 0);
  const sameDay = new Date(2026, 8, 3, 22, 0, 0);
  const nextDay = new Date(2026, 8, 4, 8, 0, 0);
  // Change announcements take a fresh snapshot using the runtime clock too.
  const { learning, setNow } = createLearningContext({}, { now: firstDay });

  assert.equal(learning.qualifyStreak(setNow(firstDay)).currentDays, 1);
  assert.equal(learning.qualifyStreak(setNow(sameDay)).currentDays, 1);
  const active = learning.qualifyStreak(setNow(nextDay));
  assert.equal(active.currentDays, 2);
  assert.equal(active.highestDays, 2);
  const expiry = new Date(active.expiresAt);
  assert.equal(expiry.getFullYear(), 2026);
  assert.equal(expiry.getMonth(), 8);
  assert.equal(expiry.getDate(), 6);
  assert.equal(expiry.getHours(), 0);

  const lapsed = learning.refreshStreak(setNow(expiry.getTime() + 1));
  assert.equal(lapsed.currentDays, 0);
  assert.equal(lapsed.highestDays, 2);
  assert.equal(lapsed.lastLapse.days, 2);
  assert.equal(lapsed.lastLapse.expiredAt, expiry.toISOString());

  const restarted = learning.qualifyStreak(setNow(new Date(2026, 8, 7, 9, 0, 0)));
  assert.equal(restarted.currentDays, 1);
  assert.equal(restarted.highestDays, 2);
});

test("streak reminders are due once at five and three hours before the active deadline", () => {
  const firstDay = new Date(2026, 8, 3, 12, 0, 0);
  const { learning, setNow } = createLearningContext({}, { now: firstDay });
  const active = learning.qualifyStreak(firstDay);
  const expiry = new Date(active.expiresAt).getTime();

  assert.equal(learning.dueStreakReminders(setNow(expiry - (6 * 60 * 60 * 1000))).length, 0);
  const fiveHour = learning.dueStreakReminders(setNow(expiry - (5 * 60 * 60 * 1000)));
  assert.equal(fiveHour.map(({ hours }) => hours).join(","), "5");
  assert.ok(learning.streakArtwork.includes(fiveHour[0].imagePath));
  learning.markStreakReminderDelivered(active.expiresAt, 5);
  assert.equal(learning.dueStreakReminders(setNow(expiry - (4 * 60 * 60 * 1000))).length, 0);

  const threeHour = learning.dueStreakReminders(setNow(expiry - (3 * 60 * 60 * 1000)));
  assert.equal(threeHour.map(({ hours }) => hours).join(","), "3");
  learning.markStreakReminderDelivered(active.expiresAt, 3);
  assert.equal(learning.dueStreakReminders(setNow(expiry - (2 * 60 * 60 * 1000))).length, 0);
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

test("existing Verb Nebula statistics migrate once into the global learning record", async () => {
  const legacy = JSON.stringify({
    schemaVersion: 2,
    stats: { attempts: 7, matches: 5, rounds: 2 }
  });
  const { learning, rows } = createLearningContext({
    "caatuu-czech.verb-memory.v2": legacy
  });
  assert.equal(learning.snapshot().summary.accuracy, 71);
  assert.equal(learning.snapshot().summary.xp, 5);
  await learning.retryPendingSaves();
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

const progressKey = "caatuu-czech.learning.performance.v1";
const pendingProgressKeys = (rows) => [...rows.keys()].filter((key) => key.startsWith(`${progressKey}.pending.`));
const savedProgress = (xp) => JSON.stringify({ schemaVersion: 1, games: { "word-world": { xp, activities: xp } } });

test("an answer survives immediate reload before asynchronous compaction, including without Web Locks", async () => {
  const rows = new Map();
  const first = createLearningContext({}, { rows, navigator: {} });
  first.learning.record("word-world", { xp: 3, activities: 1 });
  assert.equal(pendingProgressKeys(rows).length, 1, "the journal must exist before record returns");
  assert.equal(rows.has(progressKey), false);
  const reloaded = createLearningContext({}, { rows, navigator: {} });
  assert.equal(reloaded.learning.snapshot().summary.xp, 3);
  await reloaded.learning.retryPendingSaves();
  assert.equal(pendingProgressKeys(rows).length, 1, "an unsupported lock must retain the durable answer");
  const supported = createLearningContext({}, { rows });
  await supported.learning.retryPendingSaves();
  assert.equal(supported.learning.snapshot().summary.xp, 3);
  assert.equal(pendingProgressKeys(rows).length, 0);
});

test("two tabs contribute independent answers before either can compact", async () => {
  const rows = new Map([[progressKey, savedProgress(7)]]);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let serial = Promise.resolve();
  const navigator = { locks: { request(_name, action) {
    serial = serial.then(async () => { await gate; return action(); });
    return serial;
  } } };
  const first = createLearningContext({}, { rows, navigator });
  const second = createLearningContext({}, { rows, navigator });
  first.learning.record("word-world", { xp: 2 });
  second.learning.record("word-world", { xp: 3 });
  assert.equal(pendingProgressKeys(rows).length, 2);
  assert.equal(first.learning.snapshot().summary.xp, 12);
  release();
  await Promise.all([first.learning.retryPendingSaves(), second.learning.retryPendingSaves()]);
  assert.equal(createLearningContext({}, { rows }).learning.snapshot().summary.xp, 12);
  assert.equal(pendingProgressKeys(rows).length, 0);
});

test("a failed mirrored checkpoint survives reload and retries without double credit", async () => {
  const rows = new Map([[progressKey, savedProgress(7)], [`${progressKey}.backup`, savedProgress(7)]]);
  const first = createLearningContext({}, { rows, beforeWrite(key) {
    if (key === `${progressKey}.backup`) throw new Error("disk full");
  } });
  first.learning.record("word-world", { xp: 3 });
  await first.learning.retryPendingSaves();
  assert.equal(first.learning.saveStatus().status, "error");
  assert.equal(pendingProgressKeys(rows).length, 1);
  assert.equal(JSON.parse(rows.get(progressKey)).games["word-world"].xp, 10);
  const reloaded = createLearningContext({}, { rows });
  await reloaded.learning.retryPendingSaves();
  assert.equal(reloaded.learning.snapshot().summary.xp, 10);
  assert.equal(pendingProgressKeys(rows).length, 0);
  assert.equal(rows.get(progressKey), rows.get(`${progressKey}.backup`));
});

test("a committed answer left behind by failed cleanup is never credited twice", async () => {
  const rows = new Map();
  const first = createLearningContext({}, { rows, beforeRemove(key) {
    if (key.startsWith(`${progressKey}.pending.`)) throw new Error("cleanup interrupted");
  } });
  first.learning.record("word-world", { xp: 3 });
  await first.learning.retryPendingSaves();
  assert.equal(first.learning.saveStatus().status, "error");
  assert.equal(pendingProgressKeys(rows).length, 1);
  const reloaded = createLearningContext({}, { rows });
  reloaded.learning.record("word-world", { xp: 2 });
  await reloaded.learning.retryPendingSaves();
  assert.equal(reloaded.learning.snapshot().summary.xp, 5);
  assert.equal(pendingProgressKeys(rows).length, 0);
});

test("failed journal writes remain visible in memory, report failure, and retry exactly once", async () => {
  let full = true;
  const { learning, rows, events } = createLearningContext({}, { beforeWrite(key) {
    if (full && key.startsWith(`${progressKey}.pending.`)) throw new Error("quota exceeded");
  } });
  learning.record("word-world", { xp: 3 });
  await learning.retryPendingSaves();
  assert.equal(learning.snapshot().summary.xp, 3);
  assert.equal(learning.saveStatus().status, "error");
  assert.equal(rows.has(progressKey), false, "never commit an undurable event receipt");
  full = false;
  await learning.retryPendingSaves();
  await learning.retryPendingSaves();
  assert.equal(learning.snapshot().summary.xp, 3);
  assert.equal(learning.saveStatus().status, "saved");
  assert.deepEqual(events.filter((event) => event.type === "caatuu:progress-save-status")
    .map((event) => event.detail.status), ["error", "saved"]);
});

test("a damaged primary recovers from its backup while preserving the unreadable original", async () => {
  const rows = new Map([[progressKey, "{interrupted"], [`${progressKey}.backup`, savedProgress(7)]]);
  const { learning } = createLearningContext({}, { rows });
  assert.equal(learning.snapshot().summary.xp, 7);
  learning.record("word-world", { xp: 3 });
  await learning.retryPendingSaves();
  assert.equal(learning.snapshot().summary.xp, 10);
  assert.equal(rows.get(`${progressKey}.damaged`), "{interrupted");
  assert.equal(learning.saveStatus().status, "saved");
});

test("Retry repairs readable recovery copies without requiring the learner to play again", async () => {
  const historyKey = "caatuu-test.history";
  const rows = new Map([[progressKey, "{broken"], [`${progressKey}.backup`, savedProgress(7)],
    [historyKey, "{broken-history"], [`${historyKey}.backup`, JSON.stringify(["earned phrase"])]]);
  const { learning } = createLearningContext({}, { rows });
  assert.equal(learning.snapshot().summary.xp, 7);
  assert.equal(learning.readGameState(historyKey, { validate: Array.isArray })[0], "earned phrase");
  await learning.retryPendingSaves();
  assert.equal(learning.saveStatus().status, "saved");
  assert.equal(JSON.parse(rows.get(progressKey)).games["word-world"].xp, 7);
  assert.deepEqual(JSON.parse(rows.get(historyKey)), ["earned phrase"]);
  assert.equal(rows.get(`${historyKey}.damaged`), "{broken-history");
});

for (const unreadable of ["{broken", JSON.stringify({ schemaVersion: 99, games: { "word-world": { xp: 20 } } })]) {
  test(`unrecoverable or newer progress is preserved, never replaced by defaults: ${unreadable}`, async () => {
    const { learning, rows } = createLearningContext({ [progressKey]: unreadable });
    learning.record("word-world", { xp: 3 });
    await learning.retryPendingSaves();
    assert.equal(rows.get(progressKey), unreadable);
    assert.equal(pendingProgressKeys(rows).length, 1);
    assert.equal(learning.saveStatus().status, "error");
  });
}

test("a temporary read failure cannot replace existing totals and recovers on retry", async () => {
  let blocked = true;
  const { learning, rows } = createLearningContext({ [progressKey]: savedProgress(7) }, { beforeRead(key) {
    if (blocked && key === progressKey) throw new Error("storage unavailable");
  } });
  learning.record("word-world", { xp: 3 });
  await learning.retryPendingSaves();
  assert.equal(rows.get(progressKey), savedProgress(7));
  blocked = false;
  await learning.retryPendingSaves();
  assert.equal(learning.snapshot().summary.xp, 10);
  assert.equal(learning.saveStatus().status, "saved");
});

test("partial journal reads cannot drop receipts or delete unseen answers", async () => {
  const rows = new Map();
  const seed = createLearningContext({}, { rows, navigator: {} });
  seed.learning.record("word-world", { xp: 3 });
  const hiddenKey = pendingProgressKeys(rows)[0];
  let blocked = true;
  const { learning } = createLearningContext({}, { rows, beforeRead(key) {
    if (blocked && key === hiddenKey) throw new Error("read interrupted");
  } });
  learning.record("word-world", { xp: 2 });
  await learning.retryPendingSaves();
  assert.equal(pendingProgressKeys(rows).length, 2);
  assert.equal(rows.has(progressKey), false);
  blocked = false;
  await learning.retryPendingSaves();
  assert.equal(learning.snapshot().summary.xp, 5);
  assert.equal(learning.saveStatus().status, "saved");
});

test("unreadable journal records remain untouched and do not crash profile reads", async () => {
  const malformedKey = `${progressKey}.pending.12`;
  const malformed = JSON.stringify({ schemaVersion: 1, id: 12, gameId: "word-world", at: null, delta: {}, generation: "legacy" });
  const { learning, rows } = createLearningContext({ [malformedKey]: malformed });
  learning.record("word-world", { xp: 3 });
  await learning.retryPendingSaves();
  assert.equal(learning.snapshot().summary.xp, 3);
  assert.equal(rows.get(malformedKey), malformed);
  assert.equal(learning.saveStatus().status, "error");
});

test("a journal recovered by another tab releases the local retry warning", async () => {
  let failRemoval = true;
  const rows = new Map();
  const first = createLearningContext({}, { rows, beforeRemove(key) {
    if (failRemoval && key.startsWith(`${progressKey}.pending.`)) throw new Error("cleanup interrupted");
  } });
  first.learning.record("word-world", { xp: 3 });
  await first.learning.retryPendingSaves();
  assert.equal(first.learning.saveStatus().status, "error");
  const second = createLearningContext({}, { rows });
  await second.learning.retryPendingSaves();
  assert.equal(pendingProgressKeys(rows).length, 0);
  failRemoval = false;
  await first.learning.retryPendingSaves();
  assert.equal(first.learning.saveStatus().status, "saved");
  assert.equal(first.learning.snapshot().summary.xp, 3);
});

test("a failed provider retry is reported without an unhandled rejection and can recover", async () => {
  const { learning } = createLearningContext();
  let unavailable = true;
  learning.registerSaveRetry(() => {
    if (unavailable) throw new Error("provider unavailable");
  });
  assert.equal((await learning.retryPendingSaves()).status, "error");
  unavailable = false;
  assert.equal((await learning.retryPendingSaves()).status, "saved");
});

test("a reset fences queued compaction and retains answers earned after the latest reset", async () => {
  const rows = new Map([[progressKey, savedProgress(7)]]);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const navigator = { locks: { request: async (_name, action) => { await gate; return action(); } } };
  const first = createLearningContext({}, { rows, navigator });
  const second = createLearningContext({}, { rows, navigator });
  first.learning.record("word-world", { xp: 3 });
  second.learning.resetProgress();
  first.learning.record("word-world", { xp: 2 });
  second.learning.resetProgress();
  first.learning.record("word-world", { xp: 4 });
  release();
  await Promise.all([first.learning.retryPendingSaves(), second.learning.retryPendingSaves()]);
  assert.equal(createLearningContext({}, { rows }).learning.snapshot().summary.xp, 4);
});

test("a failed explicit reset leaves earned progress intact", async () => {
  const { learning, rows } = createLearningContext({ [progressKey]: savedProgress(7) }, { beforeWrite(key) {
    if (key === `${progressKey}.reset`) throw new Error("reset cannot save");
  } });
  assert.throws(() => learning.resetProgress(), /reset cannot save/);
  assert.equal(learning.snapshot().summary.xp, 7);
  assert.equal(rows.get(progressKey), savedProgress(7));
});

test("the backpack progression hub and both active games use the global learning contract", () => {
  const messages = JSON.parse(interfaceSource).messages;
  assert.match(chromeSource, /label: interfaceMessage\("nav\.backpack"\)/u);
  assert.equal(messages["nav.backpack"], "Backpack");
  assert.match(chromeSource, /data-settings-view="items"/);
  assert.match(chromeSource, /data-settings-view="stats"/);
  assert.match(chromeSource, /data-settings-view="settings"/);
  assert.match(chromeSource, /interfaceHtml\("settings\.backpack\.travelerbadge"\)/u);
  assert.equal(messages["settings.backpack.travelerbadge"], "Difficulty");
  assert.match(chromeSource, /data-difficulty-level/);
  assert.match(chromeSource, /courseProgressXp/);
  assert.match(chromeSource, /courseProgressCoins/);
  assert.match(chromeSource, /courseProgressActivities/);
  assert.match(chromeSource, /const journey = profile\.journey\?\.summary \|\| profile\.summary/);
  assert.match(chromeSource, /xp: journey\.xp/);
  assert.match(chromeSource, /coins: profile\.rewards\?\.coins/);
  assert.match(chromeSource, /gems: profile\.rewards\?\.gems/);
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
