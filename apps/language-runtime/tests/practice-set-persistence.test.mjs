import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { loadCourseCatalog } from "../../../tools/language-packs/lib/course-contract.mjs";

const source = await readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8");
const performanceKey = "caatuu-czech.learning.performance.v1";
const practiceKey = "caatuu-czech.learning.practice.v1";
const games = ["word-world", "verb-nebula", "grammar-gravity", "conjugation-comet", "case-cosmos", "sound-quasar", "naturalization-nucleus"];
const registered = ["czech", "zh-hans", "spanish", "english-from-spanish", "norwegian-bokmal", "arabic-standard", "latin-scientific", "georgian"];
let sequence = 0;

function sharedLocks() {
  let queue = Promise.resolve();
  return { locks: { request(_name, action) {
    const operation = queue.then(action);
    queue = operation.catch(() => {});
    return operation;
  } } };
}

function context(options = {}) {
  const rows = options.rows || new Map();
  const events = [];
  let indexedKeys = [];
  const namespace = `caatuu-${options.course || "czech"}`;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : ["2026-10-14T09:00:00.000Z"])); }
    static now() { return Date.parse("2026-10-14T09:00:00.000Z"); }
  }
  const localStorage = {
    get length() { indexedKeys = [...rows.keys()]; return rows.size; },
    key(index) { return indexedKeys[index] ?? null; },
    getItem(key) { options.beforeRead?.(key, rows); return rows.get(key) ?? null; },
    setItem(key, value) { options.beforeWrite?.(key, value, rows); rows.set(key, String(value)); },
    removeItem(key) { options.beforeRemove?.(key, rows); rows.delete(key); }
  };
  const window = {
    localStorage, navigator: options.navigator || sharedLocks(),
    crypto: { randomUUID: options.nextId || (() => `event-${String(++sequence).padStart(8, "0")}`) },
    CustomEvent: class { constructor(type, value) { this.type = type; this.detail = value.detail; } },
    dispatchEvent(event) { events.push(event); },
    CaatuuCourse: { id: options.courseId || options.course || "czech", storage: { namespace,
      learningPerformance: `${namespace}.learning.performance.v1` }, games,
      courseSelector: { courses: registered.map(id => ({ id,
        storage: { learningPerformance: `caatuu-${id}.learning.performance.v1` } })) } }
  };
  if (options.noSelector) delete window.CaatuuCourse.courseSelector;
  vm.runInNewContext(options.profileSource ?? source, { window, Date: Clock }, { filename: "learning-profile.js" });
  return { learning: window.CaatuuLearning, rows, events };
}

function word(learning, correct = true) {
  learning.record("word-world", { attempts: 1, successes: Number(correct), xp: correct ? 3 : 0, rounds: 1 });
}
function set(learning) { for (let index = 0; index < 8; index += 1) word(learning); }
function storedPerformance(rounds, xp = 9) {
  return JSON.stringify({ schemaVersion: 1, games: { "word-world": { rounds, xp } } });
}
const plain = value => JSON.parse(JSON.stringify(value));
const legacyCheckpoint = overrides => ({ schemaVersion: 1, generation: "legacy", legacyCoins: 17,
  seeded: true, revision: 50, effort: 11, completedSets: 10, setXp: 4, staged: {},
  rewards: [{ id: "practice:already-earned", xp: 6, coins: 1, gems: 1 }], claimed: [],
  actors: { "old-actor": [[1, 50]] }, applied: ["old-unversioned-id"], ...overrides });
const legacyWork = (index, overrides = {}) => ({ schemaVersion: 1, type: "work", id: `old-work-${index}`,
  generation: "legacy", legacyCoins: 17, order: index, actor: "old-actor", sequence: index,
  gameId: "grammar-gravity", at: "2026-10-14T09:00:00.000Z",
  delta: { activities: 1, attempts: 1, successes: 1, xp: 1, rounds: 0 }, ...overrides });

test("passive challenge loading cannot earn practice effort at any loader boundary", async () => {
  const { learning } = context();
  for (let index = 0; index < 12; index++) {
    learning.record("word-world", { activities: 1 });
    learning.completePracticeBoundary("word-world");
    learning.record("grammar-gravity", { activities: 1 });
    learning.completePracticeBoundary("grammar-gravity");
  }
  assert.equal(learning.practiceSet().effort, 0);
  assert.equal(learning.practiceSet().completedSets, 0);
  assert.equal(learning.practiceSet().pending, null);
  assert.equal(learning.snapshot().summary.activities, 24, "activity evidence keeps its existing meaning");
  await learning.retryPendingSaves();
  set(learning);
  assert.equal(learning.practiceSet().completedSets, 1, "submitted reconstructions still count");
  assert.equal(learning.practiceSet().effort, 0);
});

test("course-scoped practice survives reload without rewarding a page load or old rounds", async () => {
  const rows = new Map([[performanceKey, storedPerformance(17)],
    ["caatuu-zh-hans.learning.performance.v1", storedPerformance(3)]]);
  const first = context({ rows });
  assert.equal(first.learning.practiceSet().coins, 17);
  assert.equal(first.learning.practiceSet().pending, null);
  assert.equal(first.learning.snapshot().rewards.coins, 20);
  assert.equal(rows.has(practiceKey), false, "reading historical balances does not migrate or celebrate");
  set(first.learning);
  assert.equal(first.learning.practiceSet().completedSets, 1);
  assert.equal(first.learning.practiceSet().coins, 18);
  assert.equal(first.learning.snapshot().rewards.coins, 21);
  assert.equal(first.learning.snapshot().summary.rounds, 25, "historical round statistics keep their meaning");
  await first.learning.retryPendingSaves();
  const reloaded = context({ rows });
  assert.equal(reloaded.learning.practiceSet().coins, 18);
  assert.equal(reloaded.learning.practiceSet().pending.xp, 24);
  assert.equal(reloaded.events.length, 0);
  assert.equal(reloaded.learning.completePracticeBoundary("word-world").coins, 18);
  assert.equal(reloaded.events.length, 0);
});

test("shared weights group substantial work across games, with a safe completed-board boundary", () => {
  const { learning, events } = context({ navigator: {} });
  word(learning);
  learning.record("naturalization-nucleus", { activities: 1, attempts: 1, successes: 1, xp: 1, rounds: 1 });
  for (let index = 0; index < 6; index += 1) learning.record("verb-nebula", { activities: 1, attempts: 1, successes: 1, xp: 1 });
  assert.equal(learning.practiceSet().effort, 8, "an open matching board is staged");
  learning.record("verb-nebula", { rounds: 1 });
  assert.equal(learning.practiceSet().completedSets, 0);
  assert.equal(learning.practiceSet().effort, 14);
  learning.record("naturalization-nucleus", { attempts: 1, successes: 1, xp: 1, rounds: 1 });
  learning.record("case-cosmos", { attempts: 1, successes: 1, xp: 1, rounds: 1 });
  word(learning);
  assert.equal(learning.practiceSet().completedSets, 1);
  assert.equal(learning.practiceSet().effort, 0);
  assert.deepEqual(plain(learning.practiceSet().pending), { id: learning.practiceSet().pending.id, xp: 15, coins: 1, gems: 0 });
  assert.equal(events.filter(event => event.type === "caatuu:practice-boundary").length, 6);
});

test("coins earned after a pre-feature reset are preserved when practice rewards begin", async () => {
  const generation = "reset-before-practice-sets";
  const rows = new Map([[`${performanceKey}.reset`, generation], [performanceKey,
    JSON.stringify({ schemaVersion: 1, journalGeneration: generation,
      games: { "word-world": { rounds: 17, xp: 9 } } })]]);
  const { learning } = context({ rows });
  assert.equal(learning.practiceSet().coins, 17);
  set(learning);
  await learning.retryPendingSaves();
  assert.equal(context({ rows }).learning.practiceSet().coins, 18);
  assert.equal(learning.practiceSet().gems, 0);
});

test("logical practice order preserves staging when a fixed clock and random IDs disagree with call order", () => {
  let id = 1000;
  const { learning } = context({ navigator: {}, nextId: () => `descending-${--id}` });
  for (let index = 0; index < 4; index += 1) {
    learning.record("conjugation-comet", { activities: 1, attempts: 1, successes: 1, xp: 6 });
    learning.completePracticeBoundary("conjugation-comet");
  }
  assert.equal(learning.practiceSet().completedSets, 1);
  assert.equal(learning.practiceSet().pending.xp, 24);
});

test("journey wallet includes the active course even when the selector is absent", () => {
  const { learning } = context({ noSelector: true, navigator: {} });
  set(learning);
  assert.equal(learning.snapshot().rewards.coins, 1);
  assert.equal(learning.snapshot().rewards.completedSets, 1);
});

test("XP-only study and challenge loading do not advance effort, while mistakes can complete a set", () => {
  const { learning } = context({ navigator: {} });
  learning.record("word-world", { activities: 20 });
  learning.record("word-world", { xp: 10 });
  assert.equal(learning.practiceSet().effort, 0);
  assert.equal(learning.practiceSet().pending, null);
  for (let index = 0; index < 24; index += 1) learning.record("grammar-gravity", { activities: 1, attempts: 1 });
  assert.equal(learning.practiceSet().completedSets, 1);
  assert.equal(learning.practiceSet().pending.coins, 1);
  assert.equal(learning.practiceSet().pending.xp, 10);
  assert.equal(learning.snapshot().summary.xp, 10);
});

test("matching retries are capped until a real boundary, including across reload", async () => {
  const first = context({ navigator: {} });
  for (let index = 0; index < 100; index += 1) first.learning.record("verb-nebula", { activities: 1, attempts: 1 });
  await first.learning.retryPendingSaves();
  const second = context({ rows: first.rows, navigator: {} });
  second.learning.completePracticeBoundary("verb-nebula");
  assert.equal(second.learning.practiceSet().effort, 0, "restoring staged work is not a live boundary");
  second.learning.record("verb-nebula", { activities: 1, attempts: 1 });
  second.learning.completePracticeBoundary("verb-nebula");
  assert.equal(second.learning.practiceSet().effort, 2);
  second.learning.completePracticeBoundary("verb-nebula");
  assert.equal(second.learning.practiceSet().effort, 2, "duplicate show/hold notifications do not credit again");
});

test("form XP reflects conjugation work once, and gems occur only every sixteen new sets", async () => {
  const { learning } = context();
  for (let index = 0; index < 64; index += 1) {
    learning.record("conjugation-comet", { activities: 1, attempts: 1, successes: 1, xp: 6 });
    learning.record("conjugation-comet", { rounds: 1 });
  }
  assert.equal(learning.practiceSet().completedSets, 16);
  assert.equal(learning.practiceSet().coins, 16);
  assert.equal(learning.practiceSet().gems, 1);
  let gems = 0;
  for (let reward = learning.practiceSet().pending; reward; reward = learning.practiceSet().pending) {
    gems += reward.gems;
    assert.equal(await learning.claimPracticeSetReward(reward.id), true);
  }
  assert.equal(gems, 1);
  assert.equal(learning.snapshot().summary.xp, 384);
});

test("immediately journaled work and presentation acknowledgement survive unsupported compaction and reload", async () => {
  const first = context({ navigator: {} });
  set(first.learning);
  assert.equal([...first.rows.keys()].filter(key => key.startsWith(`${practiceKey}.pending.`)).length, 8);
  const reloaded = context({ rows: first.rows, navigator: {} });
  const reward = reloaded.learning.practiceSet().pending;
  assert.equal(reward.coins, 1);
  assert.equal(await reloaded.learning.claimPracticeSetReward(reward.id), false, "unsupported locking retains the pending presentation");
  const supported = context({ rows: first.rows });
  assert.equal(await supported.learning.claimPracticeSetReward(reward.id), true);
  assert.equal(await supported.learning.claimPracticeSetReward(reward.id), false);
  const afterAck = context({ rows: first.rows, navigator: {} });
  assert.equal(afterAck.learning.practiceSet().pending, null);
  assert.equal(afterAck.learning.practiceSet().coins, 1);
});

test("two tabs combine independent work and only one can claim the same presentation", async () => {
  const rows = new Map();
  const navigator = sharedLocks();
  const first = context({ rows, navigator });
  const second = context({ rows, navigator });
  for (let index = 0; index < 4; index += 1) { word(first.learning); word(second.learning); }
  assert.equal(first.learning.practiceSet().completedSets, 1);
  const id = first.learning.practiceSet().pending.id;
  const claims = await Promise.all([first.learning.claimPracticeSetReward(id), second.learning.claimPracticeSetReward(id)]);
  assert.equal(claims.filter(Boolean).length, 1);
  await Promise.all([first.learning.retryPendingSaves(), second.learning.retryPendingSaves()]);
  assert.equal(context({ rows }).learning.practiceSet().coins, 1);
  assert.equal(context({ rows }).learning.practiceSet().pending, null);
});

test("a failed practice append is recoverable from the durable score event after immediate reload", async () => {
  const first = context({ beforeWrite(key) {
    if (key.startsWith(`${practiceKey}.pending.`)) throw new Error("practice journal unavailable");
  } });
  set(first.learning);
  await first.learning.retryPendingSaves();
  assert.equal(first.learning.saveStatus().status, "error");
  assert.equal(first.learning.practiceSet().completedSets, 1);
  assert.equal([...first.rows.keys()].filter(key => key.startsWith(`${performanceKey}.pending.`)).length, 8);
  const reloaded = context({ rows: first.rows });
  assert.equal(reloaded.learning.practiceSet().coins, 1);
  await reloaded.learning.retryPendingSaves();
  assert.equal(reloaded.learning.saveStatus().status, "saved");
  assert.equal(context({ rows: first.rows }).learning.practiceSet().completedSets, 1);
});

test("a delayed failed append cannot re-credit work another tab recovered and compacted", async () => {
  let unavailable = true;
  const first = context({ beforeWrite(key) {
    if (unavailable && key.startsWith(`${practiceKey}.pending.`)) throw new Error("practice append unavailable");
  } });
  set(first.learning);
  await first.learning.retryPendingSaves();
  const second = context({ rows: first.rows });
  await second.learning.retryPendingSaves();
  set(second.learning);
  await second.learning.retryPendingSaves();
  assert.equal(second.learning.practiceSet().completedSets, 2);
  unavailable = false;
  await first.learning.retryPendingSaves();
  assert.equal(first.learning.practiceSet().completedSets, 2);
  assert.equal(context({ rows: first.rows }).learning.practiceSet().coins, 2);
});

test("10,000 work events compact exact dedup receipts into one actor interval", async () => {
  const rows = new Map();
  for (let index = 1; index <= 10000; index += 1) {
    const event = { schemaVersion: 2, policyVersion: 2, difficulty: 1, type: "work", id: `stress-${index}`, gameId: "word-world",
      generation: "legacy", legacyCoins: 0, order: index, actor: "stress-actor", sequence: index,
      at: "2026-10-14T09:00:00.000Z", delta: { activities: 1, attempts: 1, successes: 0, xp: 0, rounds: 0 } };
    rows.set(`${practiceKey}.pending.${event.id}`, JSON.stringify(event));
  }
  const { learning } = context({ rows });
  await learning.retryPendingSaves();
  const saved = JSON.parse(rows.get(practiceKey));
  assert.deepEqual(saved.actors, { "stress-actor": [[1, 10000]] });
  assert.deepEqual(saved.applied, []);
  assert.deepEqual(saved.claimed, []);
  assert.ok(rows.get(practiceKey).length < 1000, "receipt storage grows with actors and gaps rather than answer count");
  const duplicate = { schemaVersion: 1, type: "work", id: "late-stress-copy", gameId: "word-world",
    generation: "legacy", legacyCoins: 0, order: 1, actor: "stress-actor", sequence: 1,
    at: "2026-10-14T09:00:00.000Z", delta: { activities: 1, attempts: 1, successes: 0, xp: 0, rounds: 0 } };
  rows.set(`${practiceKey}.pending.${duplicate.id}`, JSON.stringify(duplicate));
  const reloaded = context({ rows });
  await reloaded.learning.retryPendingSaves();
  assert.equal(JSON.parse(rows.get(practiceKey)).staged["word-world"]["1"].attempts, 10000);
});

test("failed mirrored practice checkpoints and cleanup retain event receipts without duplicate rewards", async () => {
  let blocked = true;
  const first = context({ beforeWrite(key) {
    if (blocked && key === `${practiceKey}.backup`) throw new Error("backup interrupted");
  } });
  set(first.learning);
  await first.learning.retryPendingSaves();
  assert.equal(first.learning.practiceSet().coins, 1);
  const second = context({ rows: first.rows, beforeRemove(key) {
    if (key.startsWith(`${practiceKey}.pending.`)) throw new Error("cleanup interrupted");
  } });
  await second.learning.retryPendingSaves();
  assert.equal(second.learning.practiceSet().coins, 1);
  blocked = false;
  const final = context({ rows: first.rows });
  await final.learning.retryPendingSaves();
  assert.equal(final.learning.practiceSet().coins, 1);
  assert.equal(final.learning.practiceSet().completedSets, 1);
});

test("a failed acknowledgement keeps the reward available for the next safe boundary", async () => {
  let blockAck = false;
  const { learning } = context({ beforeWrite(key, raw) {
    if (blockAck && key.startsWith(`${practiceKey}.pending.`) && JSON.parse(raw).type === "ack") throw new Error("cannot acknowledge");
  } });
  set(learning);
  const id = learning.practiceSet().pending.id;
  blockAck = true;
  assert.equal(await learning.claimPracticeSetReward(id), false);
  assert.equal(learning.practiceSet().pending.id, id);
  blockAck = false;
  assert.equal(await learning.claimPracticeSetReward(id), true);
  assert.equal(learning.practiceSet().pending, null);
});

test("partial sidecar reads and malformed pending records cannot acknowledge an incomplete reward state", async () => {
  const first = context({ navigator: {} });
  set(first.learning);
  const id = first.learning.practiceSet().pending.id;
  const hiddenKey = [...first.rows.keys()].find(key => key.startsWith(`${practiceKey}.pending.`));
  let blocked = true;
  const second = context({ rows: first.rows, beforeRead(key) {
    if (blocked && key === hiddenKey) throw new Error("partial journal read");
  } });
  assert.equal(await second.learning.claimPracticeSetReward(id), false);
  assert.ok(first.rows.has(hiddenKey));
  blocked = false;
  const malformedKey = `${practiceKey}.pending.malformed`;
  first.rows.set(malformedKey, "{damaged");
  assert.equal(await second.learning.claimPracticeSetReward(id), false);
  assert.equal(first.rows.get(malformedKey), "{damaged");
  first.rows.delete(malformedKey);
  assert.equal(await second.learning.claimPracticeSetReward(id), true);
});

test("practice cleanup failures remain visible through successful reads and clear after another tab recovers", async () => {
  const first = context({ beforeRemove(key) {
    if (key.startsWith(`${practiceKey}.pending.`)) throw new Error("cleanup interrupted");
  } });
  set(first.learning);
  await first.learning.retryPendingSaves();
  first.learning.snapshot();
  assert.equal(first.learning.saveStatus().status, "error");
  const second = context({ rows: first.rows });
  await second.learning.retryPendingSaves();
  await first.learning.retryPendingSaves();
  assert.equal(first.learning.saveStatus().status, "saved");
  assert.equal(first.learning.practiceSet().coins, 1);
});

test("reset fences pending rewards and queued compactors while preserving new work", async () => {
  let unlock;
  const gate = new Promise(resolve => { unlock = resolve; });
  const navigator = { locks: { request: async (_name, action) => { await gate; return action(); } } };
  const first = context({ navigator });
  set(first.learning);
  const oldId = first.learning.practiceSet().pending.id;
  const second = context({ rows: first.rows, navigator });
  second.learning.resetProgress();
  assert.equal(second.learning.practiceSet().coins, 0);
  set(second.learning);
  unlock();
  await Promise.all([first.learning.retryPendingSaves(), second.learning.retryPendingSaves()]);
  assert.equal(await second.learning.claimPracticeSetReward(oldId), false);
  assert.equal(second.learning.practiceSet().completedSets, 1);
  assert.equal(second.learning.practiceSet().coins, 1);
});

test("future or malformed practice data is preserved and cannot be claimed or overwritten", async () => {
  for (const raw of [JSON.stringify({ schemaVersion: 99, privateFutureData: "preserve" }), "{damaged"]) {
    const rows = new Map([[practiceKey, raw]]);
    const { learning } = context({ rows });
    set(learning);
    await learning.retryPendingSaves();
    assert.equal(rows.get(practiceKey), raw);
    assert.equal(learning.saveStatus().status, "error");
    assert.equal(await learning.claimPracticeSetReward(learning.practiceSet().pending?.id), false);
  }
});

test("the same shared practice policy serves every registered course without course edits", async () => {
  for (const course of registered) {
    const { learning } = context({ course });
    set(learning);
    assert.equal(learning.practiceSet().completedSets, 1, course);
    assert.equal(learning.snapshot().rewards.coins, 1, course);
    assert.equal(learning.snapshot().rewards.gems, 0, course);
    await learning.retryPendingSaves();
  }
});

test("12/5 migration preserves earned balances, exact pending receipts and unattributed partial effort", async () => {
  const legacy = legacyCheckpoint();
  const rows = new Map([[practiceKey, JSON.stringify(legacy)], [performanceKey, storedPerformance(80)]]);
  const { learning, events } = context({ rows });
  const before = learning.practiceSet();
  assert.equal(before.target, 24);
  assert.equal(before.effort, 11);
  assert.equal(before.completedSets, 10);
  assert.equal(before.newCompletedSets, 0);
  assert.equal(before.coins, 27);
  assert.equal(before.gems, 2);
  assert.deepEqual(plain(before.pending), legacy.rewards[0]);
  assert.deepEqual(plain(before.cycle), { sets: 0, completed: 0, target: 16 });
  assert.equal(before.progression.stages.every(stage => stage.completedSets === 0 && stage.effort === 0), true);
  assert.equal(events.length, 0, "migration never announces a reward or promotes a badge");
  await learning.retryPendingSaves();
  assert.equal(JSON.parse(rows.get(practiceKey)).schemaVersion, 2);
  assert.deepEqual(JSON.parse(rows.get(practiceKey)).actors["old-actor"], [[1, 50]]);
  assert.deepEqual(JSON.parse(rows.get(practiceKey)).applied, ["old-unversioned-id"]);
  for (let index = 0; index < 13; index += 1) learning.record("grammar-gravity", { attempts: 1, xp: 1 });
  assert.equal(learning.practiceSet().coins, 28);
  assert.equal(learning.practiceSet().effort, 0);
  assert.equal(learning.practiceSet().progression.stage.effort, 13, "unclassified old units cannot advance a difficulty stage");
  assert.equal(learning.practiceSet().progression.stage.completedSets, 0);
  assert.deepEqual(plain(learning.practiceSet().pending), legacy.rewards[0]);
});

test("migration reduces visible old journals and score fallback using their original 12/5 policy exactly once", async () => {
  const finish = legacyWork(51);
  const score = { ...finish, type: undefined, practiceLegacyCoins: 17, practiceOrder: 51,
    practiceActor: finish.actor, practiceSequence: finish.sequence };
  const rows = new Map([[practiceKey, JSON.stringify(legacyCheckpoint())],
    [`${practiceKey}.pending.${finish.id}`, JSON.stringify(finish)],
    [`${performanceKey}.pending.${finish.id}`, JSON.stringify(score)]]);
  const first = context({ rows, navigator: {} });
  assert.equal(first.learning.practiceSet().coins, 28);
  assert.equal(first.learning.practiceSet().completedSets, 11);
  assert.equal(first.learning.practiceSet().newCompletedSets, 0);
  assert.equal(first.learning.practiceSet().effort, 0);
  assert.equal(first.learning.practiceSet().gems, 2);
  assert.equal(first.learning.practiceSet().progression.stage.completedSets, 0);
  const second = context({ rows });
  await second.learning.retryPendingSaves();
  const saved = JSON.parse(rows.get(practiceKey));
  assert.equal(saved.rewards.find(reward => reward.id === `practice:${finish.id}`).xp, 5);
  assert.equal(saved.rewards.find(reward => reward.id === `practice:${finish.id}`).coins, 1);
  rows.set(`${practiceKey}.pending.${finish.id}`, JSON.stringify(finish));
  assert.equal(context({ rows }).learning.practiceSet().coins, 28, "a late copy remains fenced by its old actor receipt");
});

test("new gem cycles count only new-policy sets and retain the old gem balance", async () => {
  const rows = new Map([[practiceKey, JSON.stringify(legacyCheckpoint({ effort: 0, setXp: 0 }))]]);
  const { learning } = context({ rows });
  await learning.retryPendingSaves();
  for (let index = 0; index < 15; index += 1) set(learning);
  assert.equal(learning.practiceSet().gems, 2);
  assert.equal(learning.practiceSet().cycle.sets, 15);
  set(learning);
  assert.equal(learning.practiceSet().gems, 3);
  assert.equal(learning.practiceSet().completedSets, 26);
  assert.equal(learning.practiceSet().newCompletedSets, 16);
  assert.equal(learning.practiceSet().coins, 43);
  assert.deepEqual(plain(learning.practiceSet().cycle), { sets: 0, completed: 1, target: 16 });
});

test("late legacy clients cannot reseed migrated balances or invent difficulty progress", async () => {
  const rows = new Map([[practiceKey, JSON.stringify(legacyCheckpoint({ effort: 0 }))]]);
  const first = context({ rows });
  await first.learning.retryPendingSaves();
  for (let index = 51; index <= 58; index += 1) {
    const event = legacyWork(index, { legacyCoins: 0, gameId: "word-world",
      delta: { activities: 1, attempts: 1, successes: 1, xp: 3, rounds: 1 } });
    rows.set(`${practiceKey}.pending.${event.id}`, JSON.stringify(event));
  }
  const second = context({ rows });
  assert.equal(second.learning.practiceSet().coins, 28);
  assert.equal(second.learning.practiceSet().gems, 2);
  assert.equal(second.learning.practiceSet().completedSets, 11);
  assert.equal(second.learning.practiceSet().newCompletedSets, 1);
  assert.equal(second.learning.practiceSet().progression.stages.every(stage => stage.effort === 0 && stage.completedSets === 0), true);
  await second.learning.retryPendingSaves();
  const duplicate = legacyWork(51, { id: "late-old-duplicate", legacyCoins: 0 });
  rows.set(`${practiceKey}.pending.${duplicate.id}`, JSON.stringify(duplicate));
  assert.equal(context({ rows }).learning.practiceSet().coins, 28);
});

test("a quiet interrupted migration repairs its mirrored checkpoint and fences an older reader", async () => {
  const oldRaw = JSON.stringify(legacyCheckpoint());
  const rows = new Map([[practiceKey, oldRaw], [`${practiceKey}.backup`, oldRaw]]);
  const first = context({ rows, beforeWrite(key, raw) {
    if (key === `${practiceKey}.backup` && JSON.parse(raw).schemaVersion === 2) throw new Error("migration backup interrupted");
  } });
  await first.learning.retryPendingSaves();
  assert.equal(first.learning.saveStatus().status, "error");
  assert.equal(JSON.parse(rows.get(practiceKey)).schemaVersion, 2);
  assert.equal(rows.get(`${practiceKey}.backup`), oldRaw);
  assert.ok([...rows.keys()].some(key => key.startsWith(`${practiceKey}.pending.`)), "migration keeps a durable retry fence");
  const older = context({ rows, navigator: {} });
  older.learning.readGameState(practiceKey, { maxSchemaVersion: 1, validate: value => value.schemaVersion === 1 });
  assert.equal(older.learning.writeGameState(practiceKey, legacyCheckpoint({ completedSets: 0 })), false);
  assert.equal(JSON.parse(rows.get(practiceKey)).schemaVersion, 2);
  const recovered = context({ rows });
  await recovered.learning.retryPendingSaves();
  assert.equal(rows.get(practiceKey), rows.get(`${practiceKey}.backup`));
  assert.equal(recovered.learning.practiceSet().coins, 27);
  assert.equal(recovered.learning.practiceSet().gems, 2);
});

test("future or malformed backup bytes fence both legacy migration and current-policy writes", async () => {
  const current = context();
  set(current.learning);
  await current.learning.retryPendingSaves();
  const currentRaw = current.rows.get(practiceKey);
  for (const primary of [JSON.stringify(legacyCheckpoint()), currentRaw]) {
    for (const backup of [JSON.stringify({ schemaVersion: 99, futureBalance: 900 }), "{broken-backup"]) {
      const rows = new Map([[practiceKey, primary], [`${practiceKey}.backup`, backup]]);
      const { learning } = context({ rows });
      assert.equal(learning.practiceSet().progression.available, false, "unknown backup data cannot support a badge recommendation");
      assert.equal(await learning.claimPracticeSetReward(learning.practiceSet().pending?.id), false);
      assert.equal(learning.writeGameState(practiceKey, legacyCheckpoint({ legacyCoins: 0 })), false);
      word(learning);
      await learning.retryPendingSaves();
      assert.equal(rows.get(practiceKey), primary);
      assert.equal(rows.get(`${practiceKey}.backup`), backup);
      assert.equal(learning.saveStatus().status, "error");
      assert.equal([...rows.keys()].some(key => key.startsWith(`${practiceKey}.pending.`)), false,
        "unknown backup data prevents practice journal mutation too");
    }
  }
});

test("a durable policy snapshot freezes migration if primary writing fails before a late legacy answer arrives", async () => {
  const oldRaw = JSON.stringify(legacyCheckpoint());
  const rows = new Map([[practiceKey, oldRaw], [`${practiceKey}.backup`, oldRaw]]);
  const first = context({ rows, beforeWrite(key) {
    if (key === practiceKey) throw new Error("primary migration write interrupted");
  } });
  await first.learning.retryPendingSaves();
  assert.equal(rows.get(practiceKey), oldRaw);
  const fenceKey = [...rows.keys()].find(key => key.startsWith(`${practiceKey}.pending.`));
  const fence = JSON.parse(rows.get(fenceKey));
  assert.equal(fence.type, "policy");
  assert.equal(fence.checkpoint.coinsEarned, 27);
  assert.equal(fence.checkpoint.effort, 11);
  const late = legacyWork(51, { legacyCoins: 0 });
  rows.set(`${practiceKey}.pending.${late.id}`, JSON.stringify(late));
  const second = context({ rows });
  assert.equal(second.learning.practiceSet().coins, 27, "the captured migration seed cannot be lowered");
  assert.equal(second.learning.practiceSet().gems, 2);
  assert.equal(second.learning.practiceSet().effort, 12, "the late answer uses the new 24-unit policy");
  assert.equal(second.learning.practiceSet().newCompletedSets, 0);
  assert.equal(second.learning.practiceSet().progression.stage.effort, 0);
  await second.learning.retryPendingSaves();
  assert.equal(JSON.parse(rows.get(practiceKey)).schemaVersion, 2);
  assert.equal(rows.get(practiceKey), rows.get(`${practiceKey}.backup`));
  rows.set(`${practiceKey}.pending.${late.id}`, JSON.stringify(late));
  assert.equal(context({ rows }).learning.practiceSet().effort, 12, "receipt membership also fences its delayed duplicate");
});

test("accepted content evidence invalidates recommendation consumers without full learning snapshots or duplicate events", async () => {
  const { learning, events } = context();
  assert.equal(learning.storage.contentStorageKey, "caatuu-czech.learning.content.v2");
  const generation = learning.contentGeneration();
  const encounter = { itemId: "verb-item", encounterId: "first-encounter", generation,
    evidence: "independent", correct: true };
  learning.recordExposure("verb-nebula", encounter);
  const changes = () => events.filter(event => event.type === "caatuu:content-practice-change");
  assert.equal(changes().length, 1);
  assert.deepEqual(plain(changes()[0].detail), { gameId: "verb-nebula", bankId: "default", generation });
  assert.equal(events.some(event => event.type === "caatuu:learning-change"), false);
  learning.recordExposure("verb-nebula", encounter);
  assert.equal(changes().length, 1, "duplicate receipt retries do not invalidate again");
  learning.recordExposure("verb-nebula", { ...encounter, evidence: "assisted", correct: null });
  assert.equal(changes().length, 2, "an unscored hint can invalidate retained assessment support");
  assert.equal(learning.recordExposure("verb-nebula", { ...encounter, generation: "outdated-generation" }), false);
  assert.equal(changes().length, 2);
  await learning.retryPendingSaves();
});

test("two tabs migrate the same legacy checkpoint without duplicating balances or captured stage credit", async () => {
  let unlock;
  const gate = new Promise(resolve => { unlock = resolve; });
  const locks = sharedLocks();
  const navigator = { locks: { request: async (name, action) => { await gate; return locks.locks.request(name, action); } } };
  const rows = new Map([[practiceKey, JSON.stringify(legacyCheckpoint())]]);
  const first = context({ rows, navigator });
  const second = context({ rows, navigator });
  word(first.learning); word(second.learning); word(first.learning); word(second.learning); word(first.learning);
  assert.equal(first.learning.practiceSet().coins, 28);
  assert.equal(first.learning.practiceSet().effort, 2);
  assert.equal(first.learning.practiceSet().progression.stage.effort, 15);
  unlock();
  await Promise.all([first.learning.retryPendingSaves(), second.learning.retryPendingSaves()]);
  const reloaded = context({ rows });
  assert.equal(reloaded.learning.practiceSet().coins, 28);
  assert.equal(reloaded.learning.practiceSet().gems, 2);
  assert.equal(reloaded.learning.practiceSet().newCompletedSets, 1);
  assert.equal(reloaded.learning.practiceSet().progression.stage.effort, 15);
});

test("reset during a queued legacy migration fences the old balances and pending receipts", async () => {
  let unlock;
  const gate = new Promise(resolve => { unlock = resolve; });
  const navigator = { locks: { request: async (_name, action) => { await gate; return action(); } } };
  const rows = new Map([[practiceKey, JSON.stringify(legacyCheckpoint())]]);
  const first = context({ rows, navigator });
  const second = context({ rows, navigator });
  second.learning.resetProgress();
  set(second.learning);
  unlock();
  await Promise.all([first.learning.retryPendingSaves(), second.learning.retryPendingSaves()]);
  assert.equal(second.learning.practiceSet().coins, 1);
  assert.equal(second.learning.practiceSet().gems, 0);
  assert.equal(second.learning.practiceSet().completedSets, 1);
  assert.equal(second.learning.practiceSet().progression.stage.completedSets, 1);
  assert.equal(await second.learning.claimPracticeSetReward("practice:already-earned"), false);
});

test("captured difficulty buckets share one capped board reward without shifting credit to the current badge", async () => {
  const { learning } = context();
  for (let index = 0; index < 2; index += 1) learning.record("verb-nebula", { attempts: 1, successes: 1, xp: 1 });
  learning.setDifficulty(2);
  for (let index = 0; index < 2; index += 1) learning.record("verb-nebula", { attempts: 1, successes: 1, xp: 1 });
  learning.setDifficulty(3);
  learning.record("verb-nebula", { rounds: 1 });
  const practice = learning.practiceSet();
  assert.equal(practice.effort, 4);
  assert.equal(practice.coins, 0);
  assert.deepEqual(plain(practice.progression.stages.map(stage => stage.effort)), [2, 2, 0]);
  assert.equal(practice.progression.stage.difficulty, 3);
  await learning.retryPendingSaves();
});

test("restored old board work keeps monetary credit while only new decisions enter a captured difficulty stage", async () => {
  const rows = new Map([[practiceKey, JSON.stringify(legacyCheckpoint({ completedSets: 0, effort: 0, rewards: [],
    staged: { "verb-nebula": { attempts: 3, successes: 3, activities: 3, xp: 3 } } }))]]);
  const { learning } = context({ rows });
  await learning.retryPendingSaves();
  learning.setDifficulty(2);
  learning.record("verb-nebula", { attempts: 1, successes: 1, xp: 1 });
  learning.setDifficulty(3);
  learning.completePracticeBoundary("verb-nebula");
  const practice = learning.practiceSet();
  assert.equal(practice.effort, 4);
  assert.equal(practice.coins, 17);
  assert.deepEqual(plain(practice.progression.stages.map(stage => stage.effort)), [0, 1, 0]);
});

test("Explorer and Traveler stage thresholds are independent and never switch the selected difficulty", async () => {
  const first = context({ courseId: "cz" });
  word(first.learning);
  await first.learning.retryPendingSaves();
  const before = first.learning.practiceSet();
  const explorerTarget = before.progression.stages[0].targetCycles;
  const travelerTarget = before.progression.stages[1].targetCycles;
  const setsPerCycle = before.cycle.target;
  const saved = JSON.parse(first.rows.get(practiceKey));
  saved.stages["1"] = { completedSets: explorerTarget * setsPerCycle - 1, effort: 21 };
  saved.stages["2"] = { completedSets: travelerTarget * setsPerCycle - 1, effort: 21 };
  first.rows.set(practiceKey, JSON.stringify(saved));
  const { learning } = context({ rows: first.rows, courseId: "cz" });
  assert.equal(learning.practiceSet().progression.stages[0].stageComplete, false);
  assert.equal(learning.practiceSet().progression.stages[1].stageComplete, false);
  word(learning);
  const explorer = learning.practiceSet().progression.stages[0];
  assert.equal(explorer.completedSets, explorerTarget * setsPerCycle);
  assert.equal(explorer.completedCycles, explorerTarget);
  assert.equal(explorer.targetCycles, explorerTarget);
  assert.equal(explorer.stageComplete, true);
  assert.equal(learning.difficulty(), 1);
  learning.setDifficulty(2);
  word(learning);
  const traveler = learning.practiceSet().progression.stage;
  assert.equal(traveler.completedSets, travelerTarget * setsPerCycle);
  assert.equal(traveler.completedCycles, travelerTarget);
  assert.equal(traveler.targetCycles, travelerTarget);
  assert.equal(traveler.stageComplete, true);
  assert.equal(learning.difficulty(), 2);
  assert.equal(learning.practiceSet().progression.stages[2].targetCycles, null);
});

test("registered courses derive stage quotas from the generated corpus budget without changing 24/16 rewards", async () => {
  const { courses } = await loadCourseCatalog();
  for (const { course } of courses) {
    const { learning } = context({ courseId: course.id, navigator: {} });
    const practice = learning.practiceSet();
    assert.equal(practice.target, 24, course.id);
    assert.equal(practice.cycle.target, 16, course.id);
    for (const stage of practice.progression.stages.slice(0, 2)) {
      const budget = stage.budget;
      assert.equal(budget.version, "corpus-replay-1", course.id);
      assert.equal(budget.source, "playable-corpus", course.id);
      assert.equal(budget.replayPasses, 6);
      assert.equal(budget.minimumCycles, 200);
      assert.equal(budget.cycleStep, 25);
      assert.equal(Number.isSafeInteger(budget.corpusUnits) && budget.corpusUnits >= 0, true, course.id);
      assert.equal(Number.isSafeInteger(budget.corpusEffort) && budget.corpusEffort >= 0, true, course.id);
      const expected = Math.max(budget.minimumCycles, Math.ceil(
        budget.replayPasses * budget.corpusEffort / (practice.target * practice.cycle.target * budget.cycleStep)
      ) * budget.cycleStep);
      assert.equal(stage.targetCycles, expected, `${course.id} difficulty ${stage.difficulty}`);
      assert.equal(stage.targetCycles % budget.cycleStep, 0);
      assert.equal(stage.stageComplete, false);
    }
    assert.equal(practice.progression.stages[2].targetCycles, null);
  }
});

test("a larger future corpus raises advisory targets above the minimum and preserves exact stage boundaries", async () => {
  const corpus = { "future-course": { 1: { units: 5000, effort: 12801 },
    2: { units: 5000, effort: 25601 }, 3: { units: 0, effort: 0 } } };
  const profileSource = source.replace(/\/\/ BEGIN GENERATED PRACTICE CORPUS[\s\S]*?\/\/ END GENERATED PRACTICE CORPUS/u,
    `// BEGIN GENERATED PRACTICE CORPUS\n  const practiceCorpusWorkloads = Object.freeze(${JSON.stringify(corpus)});\n  // END GENERATED PRACTICE CORPUS`);
  assert.notEqual(profileSource, source, "the synthetic fixture replaces only the generated corpus table");
  const first = context({ courseId: "future-course", profileSource });
  const initial = first.learning.practiceSet();
  assert.equal(initial.progression.stages[0].targetCycles, 225);
  assert.equal(initial.progression.stages[1].targetCycles, 425);
  assert.equal(initial.progression.stages[0].budget.corpusEffort, 12801);
  assert.equal(initial.progression.stages[1].budget.corpusEffort, 25601);
  assert.equal(initial.target, 24);
  assert.equal(initial.cycle.target, 16);
  word(first.learning);
  await first.learning.retryPendingSaves();
  const saved = JSON.parse(first.rows.get(practiceKey));
  saved.stages["1"] = { completedSets: 225 * initial.cycle.target - 1, effort: 21 };
  saved.stages["2"] = { completedSets: 425 * initial.cycle.target - 1, effort: 21 };
  first.rows.set(practiceKey, JSON.stringify(saved));
  const { learning } = context({ rows: first.rows, courseId: "future-course", profileSource });
  assert.equal(learning.practiceSet().progression.stages[0].stageComplete, false);
  assert.equal(learning.practiceSet().progression.stages[1].stageComplete, false);
  word(learning);
  assert.equal(learning.practiceSet().progression.stage.completedCycles, 225);
  assert.equal(learning.practiceSet().progression.stage.stageComplete, true);
  assert.equal(learning.difficulty(), 1);
  learning.setDifficulty(2);
  word(learning);
  assert.equal(learning.practiceSet().progression.stage.completedCycles, 425);
  assert.equal(learning.practiceSet().progression.stage.stageComplete, true);
  assert.equal(learning.difficulty(), 2);
});

test("unknown course IDs use the conservative advisory minimum without inventing a corpus inventory", () => {
  const { learning } = context({ courseId: "unregistered-course", navigator: {} });
  for (const stage of learning.practiceSet().progression.stages.slice(0, 2)) {
    assert.equal(stage.targetCycles, 200);
    assert.equal(stage.budget.source, "minimum");
    assert.equal(stage.budget.corpusUnits, null);
    assert.equal(stage.budget.corpusEffort, null);
    assert.equal(stage.stageComplete, false);
  }
});

test("raising advisory quotas preserves equipped badges and exact reward checkpoints", async () => {
  const original = context({ courseId: "cz" });
  original.learning.setDifficulty(2);
  set(original.learning);
  await original.learning.retryPendingSaves();
  const saved = JSON.parse(original.rows.get(practiceKey));
  saved.stages["1"] = { completedSets: 128, effort: 7 };
  saved.stages["2"] = { completedSets: 256, effort: 11 };
  saved.effort = 17;
  saved.setXp = 5;
  const primary = JSON.stringify(saved);
  original.rows.set(practiceKey, primary);
  original.rows.set(`${practiceKey}.backup`, primary);
  const preferenceKey = original.learning.storage.preferenceStorageKey;
  const equippedPreference = original.rows.get(preferenceKey);
  const reloaded = context({ rows: original.rows, courseId: "cz" });
  const practice = reloaded.learning.practiceSet();
  assert.equal(reloaded.learning.difficulty(), 2, "an increased invitation budget does not unequip Traveler");
  assert.equal(practice.effort, saved.effort);
  assert.equal(practice.completedSets, saved.completedSets);
  assert.equal(practice.newCompletedSets, saved.newCompletedSets);
  assert.equal(practice.coins, saved.coinsEarned);
  assert.equal(practice.gems, saved.gemsEarned);
  assert.deepEqual(plain(practice.pending), saved.rewards[0]);
  assert.deepEqual(plain(practice.progression.stages.map(stage => ({ effort: stage.effort, completedSets: stage.completedSets }))),
    [saved.stages["1"], saved.stages["2"], saved.stages["3"]]);
  assert.equal(practice.progression.stages[0].stageComplete, false, "eight old cycles no longer satisfy the higher budget");
  assert.equal(practice.progression.stages[1].stageComplete, false, "sixteen old cycles no longer satisfy the higher budget");
  await reloaded.learning.retryPendingSaves();
  assert.equal(original.rows.get(practiceKey), primary);
  assert.equal(original.rows.get(`${practiceKey}.backup`), primary);
  assert.equal(original.rows.get(preferenceKey), equippedPreference);
  assert.equal(JSON.parse(original.rows.get(practiceKey)).policyVersion, 2, "the currency ledger does not migrate for an advisory quota change");
});
