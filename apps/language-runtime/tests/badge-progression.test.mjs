import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { installBadgeProgression } from "../static/source/badge-progression.mjs";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { englishInterfaceContent } from "./helpers/english-interface-content.mjs";

const settle = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const ready = { status: "ready", suggestedDifficulty: 2, recommended: true };

function fixture({ complete = true, result = ready, evaluator, preferences = new Map(), level = 1, failedWrite = false } = {}) {
  const browser = createBrowserHarness();
  const { document, window } = browser;
  const slot = document.createElement("div");
  slot.setAttribute("data-caatuu-badge-progression", "");
  const meter = document.createElement("div");
  meter.setAttribute("data-caatuu-practice-meter", "");
  const status = document.createElement("p");
  status.id = "learningStatus";
  document.body.append(slot, meter, status);
  for (let index = 0; index <= 3; index++) {
    const button = document.createElement("button");
    button.setAttribute("data-difficulty-level", String(index));
    document.body.append(button);
  }
  let reset = "first", current = level, stageComplete = complete, available = true;
  const stageTargets = { 0: 100, 1: 225, 2: 425, 3: 200 };
  const equipped = [], calls = [], opened = [];
  window.CaatuuChrome = { openSharedSettings: value => opened.push(value) };
  const course = { id: "test", storage: { namespace: "caatuu-test" } };
  const learning = {
    difficulty: () => current,
    difficultyOption: value => ({ label: ["Starting out", "Explorer", "Traveler", "Navigator"][value] }),
    contentGeneration: () => reset,
    storage: { performanceStorageKey: "course.performance.v1", practiceStorageKey: "course.practice.v1", contentStorageKey: "course.content.v2" },
    practiceSet: () => ({ target: 24, effort: 5, completedSets: 134,
      cycle: { sets: 6, completed: 8, target: 16 }, progression: { available, stage: { difficulty: current,
        completedSets: stageComplete ? (stageTargets[current] || 200) * 16 : 6,
        completedCycles: stageComplete ? (stageTargets[current] || 200) : 0,
        targetCycles: stageTargets[current] ?? null, stageComplete } } }),
    readGameState: key => preferences.get(key) || null,
    writeGameState(key, value) { if (failedWrite) return false; preferences.set(key, structuredClone(value)); return true; },
    setDifficulty(value) { equipped.push(value); current = value; stageComplete = false;
      window.dispatchEvent({ type: "caatuu:learning-change", detail: { reason: "difficulty" } }); }
  };
  const engine = { evaluate: args => { calls.push(args); return evaluator ? evaluator(args) : Promise.resolve(result); } };
  const controller = installBadgeProgression({ scope: window, document, learning, course,
    i18n: englishInterfaceContent, evaluator: engine });
  const emit = reason => window.dispatchEvent({ type: "caatuu:learning-change", detail: { reason } });
  const change = ({ difficulty, generation, complete, readable } = {}) => {
    if (difficulty !== undefined) current = difficulty;
    if (generation !== undefined) reset = generation;
    if (complete !== undefined) stageComplete = complete;
    if (readable !== undefined) available = readable;
    emit("progress-reset");
  };
  const find = selector => document.body.querySelector(selector);
  return { ...browser, slot, meter, learning, controller, preferences, calls, equipped, opened, find, change, emit };
}

test("incomplete stages show current-band cycles without fetching readiness or changing difficulty", async () => {
  const f = fixture({ complete: false });
  await settle();
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.getState().status, "practice-needed");
  assert.match(f.slot.textContent, /Explorer.*0 \/ 225 cycles/);
  assert.match(f.slot.textContent, /6 \/ 16 sets/);
  assert.equal(f.find(".caatuu-badge-equip"), null);
  assert.deepEqual(f.equipped, []);
  f.controller.destroy();
});

test("zero can dismiss, reload and voluntarily equip the Explorer invitation", async () => {
  const preferences = new Map();
  const result = { status: "ready", suggestedDifficulty: 1, recommended: true };
  const first = fixture({ level: 0, result, preferences });
  await settle();
  assert.match(first.slot.textContent, /Explorer/);
  first.slot.querySelector(".caatuu-badge-dismiss").dispatchEvent({ type: "click" });
  first.controller.destroy();
  const next = fixture({ level: 0, result, preferences });
  await settle();
  assert.equal(next.slot.querySelector(".caatuu-badge-equip"), null);
  next.slot.querySelector(".caatuu-badge-review").dispatchEvent({ type: "click" });
  await settle();
  next.slot.querySelector(".caatuu-badge-equip").dispatchEvent({ type: "click" });
  await settle();
  assert.deepEqual(next.equipped, [1]);
  next.controller.destroy();
});

test("real shared profile counters render correctly without fixture-only fields", async () => {
  const source = await readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8");
  const course = { id: "real-profile", storage: { namespace: "caatuu-real-profile" }, games: ["word-net"] };
  const f = createBrowserHarness({ course });
  vm.runInContext(source, f.context);
  const slot = f.document.createElement("div");
  slot.setAttribute("data-caatuu-badge-progression", "");
  f.document.body.append(slot);
  const controller = installBadgeProgression({ scope: f.window, learning: f.window.CaatuuLearning, course,
    i18n: englishInterfaceContent, evaluator: { evaluate: () => ready } });
  for (let index = 0; index < 8; index++) f.window.CaatuuLearning.record("word-world", { attempts: 1, successes: 1, xp: 3, rounds: 1 });
  await settle();
  assert.equal(f.window.CaatuuLearning.practiceSet().cycle.target, 16);
  assert.match(slot.querySelector(".caatuu-badge-stage-sets").textContent, /1 \/ 16 sets/);
  const practice = f.window.CaatuuLearning.practiceSet();
  assert.equal(practice.progression.stage.difficulty, 0);
  assert.equal(practice.progression.stage.targetCycles, 100);
  assert.equal(slot.querySelector("progress").max, practice.progression.stage.targetCycles * practice.cycle.target);
  assert.equal(slot.querySelector("progress").value, 1);
  assert.doesNotMatch(slot.textContent, /NaN|undefined/);
  controller.destroy();
});

test("a ready recommendation stays advisory and equips only after an explicit, freshly validated click", async () => {
  const f = fixture();
  await settle();
  assert.equal(f.controller.getState().status, "ready");
  assert.deepEqual(f.equipped, []);
  assert.equal(f.calls[0].stageComplete, true);
  assert.equal(f.calls[0].difficulty, 1);
  assert.equal(f.find('[data-difficulty-level="2"]').classList.contains("is-recommended"), true);
  f.find(".caatuu-practice-badge-offer").dispatchEvent({ type: "click" });
  assert.deepEqual(f.opened, [{ view: "items" }]);
  f.find(".caatuu-badge-equip").dispatchEvent({ type: "click" });
  await settle();
  assert.deepEqual(f.equipped, [2]);
  assert.equal(f.calls.length, 2, "equipping revalidates the evidence");
  assert.equal(f.controller.getState().status, "practice-needed");
  assert.match(f.find("#learningStatus").textContent, /Traveler/);
  f.controller.destroy();
});

test("reaching the milestone with insufficient or unavailable evidence leaves rewards and difficulty alone", async () => {
  for (const status of ["evidence-needed", "unknown"]) {
    const f = fixture({ result: { status } });
    await settle();
    assert.equal(f.controller.getState().status, status);
    assert.equal(f.find(".caatuu-badge-equip"), null);
    assert.deepEqual(f.equipped, []);
    assert.equal(f.learning.practiceSet().completedSets, 134);
    f.controller.destroy();
  }
});

test("a dismissal survives refresh and reload until the learner explicitly reviews it", async () => {
  const preferences = new Map();
  const first = fixture({ preferences });
  await settle();
  first.find(".caatuu-badge-dismiss").dispatchEvent({ type: "click" });
  await first.controller.refresh();
  assert.equal(first.find(".caatuu-badge-equip"), null);
  assert.equal(first.find(".caatuu-practice-badge-offer").hidden, true);
  first.controller.destroy();
  const reload = fixture({ preferences });
  await settle();
  assert.equal(reload.find(".caatuu-badge-equip"), null);
  reload.find(".caatuu-badge-review").dispatchEvent({ type: "click" });
  await settle();
  assert.ok(reload.find(".caatuu-badge-equip"));
  assert.deepEqual(reload.equipped, []);
  reload.controller.destroy();
});

test("a saved choice from before a progress reset cannot suppress the new course generation", async () => {
  const f = fixture();
  await settle();
  f.find(".caatuu-badge-dismiss").dispatchEvent({ type: "click" });
  f.change({ generation: "after-reset" });
  await settle();
  assert.ok(f.find(".caatuu-badge-equip"));
  f.controller.destroy();
});

test("late readiness responses cannot cross a reset or difficulty change", async () => {
  for (const change of [{ generation: "reset", complete: false }, { difficulty: 2, complete: false }]) {
    const gate = deferred();
    const f = fixture({ evaluator: () => gate.promise });
    await settle();
    f.change(change);
    gate.resolve(ready);
    await settle();
    assert.equal(f.controller.getState().status, "practice-needed");
    assert.equal(f.find(".caatuu-badge-equip"), null);
    assert.deepEqual(f.equipped, []);
    f.controller.destroy();
  }
});

test("hiding or leaving the page aborts pending checks and restoration refreshes quietly", async () => {
  const gate = deferred();
  const f = fixture({ evaluator: () => gate.promise });
  await settle();
  f.document.visibilityState = "hidden";
  f.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(f.calls[0].signal.aborted, true);
  gate.resolve(ready);
  await settle();
  assert.equal(f.controller.getState(), null);
  assert.equal(f.find(".caatuu-badge-equip"), null);
  f.document.visibilityState = "visible";
  f.document.dispatchEvent({ type: "visibilitychange" });
  await settle();
  assert.equal(f.controller.getState().status, "ready");
  f.window.dispatchEvent({ type: "pagehide" });
  f.emit("performance");
  await settle();
  assert.equal(f.controller.getState(), null);
  f.window.dispatchEvent({ type: "pageshow" });
  await settle();
  assert.equal(f.controller.getState().status, "ready");
  f.controller.destroy();
});

test("a stale visible offer cannot equip a badge after fresh evidence no longer supports it", async () => {
  let evidence = ready;
  const f = fixture({ evaluator: () => Promise.resolve(evidence) });
  await settle();
  evidence = { status: "evidence-needed" };
  f.find(".caatuu-badge-equip").dispatchEvent({ type: "click" });
  await settle();
  assert.deepEqual(f.equipped, []);
  assert.equal(f.controller.getState().status, "evidence-needed");
  f.controller.destroy();
});

test("failed preference writes do not silently dismiss a recommendation", async () => {
  const f = fixture({ failedWrite: true });
  await settle();
  f.find(".caatuu-badge-dismiss").dispatchEvent({ type: "click" });
  assert.ok(f.find(".caatuu-badge-equip"));
  assert.equal(f.preferences.size, 0);
  f.controller.destroy();
});

test("real-profile failed or future-format dismissal writes never become pending accepted preferences", async () => {
  const source = await readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8");
  for (const failure of ["write", "future"]) {
    const course = { id: "real-preferences", storage: { namespace: "caatuu-real-preferences" }, games: ["word-net"] };
    const f = createBrowserHarness({ course });
    let lockTail = Promise.resolve();
    f.window.navigator.locks = { request(_name, action) {
      const operation = lockTail.then(action); lockTail = operation.catch(() => {}); return operation;
    } };
    vm.runInContext(source, f.context);
    const learning = f.window.CaatuuLearning;
    learning.setDifficulty(1);
    learning.record("word-world", { attempts: 1, successes: 1, xp: 3, rounds: 1 });
    await learning.retryPendingSaves();
    // Seed only the practiced milestone; this test isolates preference persistence
    // from the independently tested readiness policy.
    const checkpoint = learning.readGameState(learning.storage.practiceStorageKey);
    const practice = learning.practiceSet();
    checkpoint.stages["1"].completedSets = practice.progression.stage.targetCycles * practice.cycle.target;
    learning.writeGameState(learning.storage.practiceStorageKey, checkpoint, false);
    const key = "caatuu-real-preferences.learning.badge-recommendations.v1";
    const future = JSON.stringify({ schemaVersion: 99, privatePreference: "preserve" });
    const originalWrite = f.localStorage.setItem.bind(f.localStorage);
    if (failure === "future") originalWrite(key, future);
    else f.localStorage.setItem = (name, value) => {
      if (name === key) throw new Error("Storage is full");
      originalWrite(name, value);
    };
    const slot = f.document.createElement("div");
    slot.setAttribute("data-caatuu-badge-progression", "");
    f.document.body.append(slot);
    const controller = installBadgeProgression({ scope: f.window, learning, course,
      i18n: englishInterfaceContent, evaluator: { evaluate: () => ready } });
    await settle();
    slot.querySelector(".caatuu-badge-dismiss").dispatchEvent({ type: "click" });
    await controller.refresh();
    assert.equal(Boolean(slot.querySelector(".caatuu-badge-equip")), true);
    assert.equal(Boolean(slot.querySelector(".caatuu-badge-review")), false);
    assert.equal(f.localStorage.getItem(key), failure === "future" ? future : null);
    controller.destroy();
  }
});

test("an unknown reset generation cannot produce a recommendation", async () => {
  const f = fixture();
  await settle();
  f.change({ generation: null });
  await settle();
  assert.equal(f.controller.getState().status, "unknown");
  assert.equal(Boolean(f.find(".caatuu-badge-equip")), false);
  f.controller.destroy();
});

test("unreadable authoritative stage progress hides recommendations even when its old primary looks complete", async () => {
  const f = fixture();
  await settle();
  f.change({ readable: false });
  await settle();
  assert.equal(f.controller.getState().status, "unknown");
  assert.equal(Boolean(f.find(".caatuu-badge-equip")), false);
  f.controller.destroy();
});

test("content-only changes invalidate a visible recommendation in this tab and another tab", async () => {
  for (const crossTab of [false, true]) {
    let evidence = ready;
    const f = fixture({ evaluator: () => Promise.resolve(evidence) });
    await settle();
    evidence = { status: "evidence-needed" };
    f.window.dispatchEvent(crossTab ? { type: "storage", key: "course.content.v2.pending.answer" }
      : { type: "caatuu:content-practice-change" });
    await settle();
    assert.equal(f.controller.getState().status, "evidence-needed");
    assert.equal(Boolean(f.find(".caatuu-badge-equip")), false);
    f.controller.destroy();
  }
});

test("buttons retained after controller destruction cannot write dismissal preferences", async () => {
  const f = fixture();
  await settle();
  const dismiss = f.find(".caatuu-badge-dismiss");
  f.controller.destroy();
  dismiss.dispatchEvent({ type: "click" });
  assert.equal(f.preferences.size, 0);
});

test("Navigator shows its finite completed stage with no invented fourth difficulty", async () => {
  const f = fixture({ level: 3 });
  await settle();
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.getState().status, "max-level");
  const practice = f.learning.practiceSet();
  const stage = practice.progression.stage;
  const progress = f.find(".caatuu-badge-stage-meter");
  assert.equal(progress.max, stage.targetCycles * practice.cycle.target);
  assert.equal(progress.value, progress.max);
  assert.equal(f.find(".caatuu-badge-stage-sets").textContent,
    englishInterfaceContent.t("practice.stage.sets", { sets: practice.cycle.target, target: practice.cycle.target }));
  assert.equal(f.find(".caatuu-badge-equip"), null);
  assert.equal(f.find(".caatuu-badge-review"), null);
  assert.equal(f.find(".caatuu-badge-recommendation").textContent, "");
  f.controller.destroy();
});

test("difficulty stage summaries restore remembered sets and remain full at the cap", async () => {
  const f = fixture({ complete: false });
  let stage = { difficulty: 1, target: 24, effort: 9, completedSets: 19, completedCycles: 1,
    targetCycles: 200, stageComplete: false, cycle: { target: 16, completed: 1, sets: 3 } };
  const originalPracticeSet = f.learning.practiceSet;
  f.learning.practiceSet = () => ({ ...originalPracticeSet(), progression: { available: true, stage } });
  for (const next of [stage, { ...stage, difficulty: 2, effort: 0, completedSets: 0, completedCycles: 0,
    cycle: { target: 16, completed: 0, sets: 0 } }, stage,
  { ...stage, effort: 24, completedSets: 3200, completedCycles: 200, stageComplete: true,
    cycle: { target: 16, completed: 200, sets: 16 } }]) {
    stage = next;
    f.change({ difficulty: stage.difficulty });
    await settle();
    assert.equal(f.find(".caatuu-badge-stage-sets").textContent,
      englishInterfaceContent.t("practice.stage.sets", { sets: stage.cycle.sets, target: stage.cycle.target }));
    assert.equal(f.find(".caatuu-badge-stage-meter").value, stage.completedSets);
  }
  f.controller.destroy();
});

test("destroyed controllers cannot mount a late readiness response", async () => {
  const gate = deferred();
  const f = fixture({ evaluator: () => gate.promise });
  await settle();
  f.controller.destroy();
  assert.equal(f.calls[0].signal.aborted, true);
  gate.resolve(ready);
  await settle();
  assert.equal(f.find(".caatuu-badge-equip"), null);
  assert.equal(f.find(".caatuu-practice-badge-offer"), null);
});
