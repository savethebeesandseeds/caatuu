import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const [courseProfileSource, learningProfileSource, chromeSource, appSource, wordWorldSource] = await Promise.all([
  readFile(new URL("course-profile.js", staticRoot), "utf8"),
  readFile(new URL("learning-profile.js", staticRoot), "utf8"),
  readFile(new URL("chrome.js", staticRoot), "utf8"),
  readFile(new URL("app.js", staticRoot), "utf8"),
  readFile(new URL("word-net.js", staticRoot), "utf8")
]);

function createLearningContext(initial = {}) {
  const rows = new Map(Object.entries(initial));
  const events = [];
  const localStorage = {
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
  learning.record("word-world", { activities: 3 });
  const profile = learning.snapshot();
  assert.equal(profile.summary.activities, 5);
  assert.equal(profile.summary.successes, 1);
  assert.equal(profile.summary.rounds, 1);
  assert.equal(profile.summary.accuracy, 50);
  assert.equal(profile.summary.activeGames, 2);
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
  assert.ok(rows.has("caatuu-czech.learning.performance.v1"));
  learning.record("verb-nebula", { activities: 1, attempts: 1, successes: 1 });
  assert.equal(learning.snapshot().summary.attempts, 8);
});

test("restarting progress preserves difficulty while clearing global and legacy scores", () => {
  const { learning, rows, events } = createLearningContext();
  learning.setDifficulty(3);
  learning.record("verb-nebula", { activities: 4, attempts: 4, successes: 3, rounds: 1 });
  rows.set("caatuu-czech.verb-memory.v2", JSON.stringify({ schemaVersion: 2, stats: { attempts: 4 } }));
  learning.resetProgress();
  assert.equal(learning.difficulty(), 3);
  assert.equal(learning.snapshot().summary.activities, 0);
  assert.equal(rows.has("caatuu-czech.verb-memory.v2"), false);
  assert.ok(events.some((event) => event.detail.reason === "progress-reset"));
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
  assert.match(chromeSource, /xp: profile\.summary\.successes/);
  assert.match(chromeSource, /coins: profile\.summary\.rounds/);
  assert.match(chromeSource, /settingsResetCourseProgress/);
  assert.match(appSource, /CaatuuLearning\?\.record\("verb-nebula"/);
  assert.match(wordWorldSource, /CaatuuLearning\?\.record\("word-world"/);
  assert.doesNotMatch(chromeSource, /Difficulty and progress/);
  assert.doesNotMatch(chromeSource, /settingsResetVerbMemory/);
});
