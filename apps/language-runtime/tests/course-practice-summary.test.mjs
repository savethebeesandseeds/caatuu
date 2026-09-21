import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { learnerBankState } from "../static/source/learner-state.mjs";
import { loadCourseCatalog, generateCourseProfileObject } from "../../../tools/language-packs/lib/course-contract.mjs";

const source = await readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8");
const catalog = await loadCourseCatalog({ repoRoot: new URL("../../../", import.meta.url) });
const profiles = catalog.courses.map(({ course }) => generateCourseProfileObject(course));
const now = Date.UTC(2026, 8, 20, 12);
const day = 24 * 60 * 60 * 1000;
const profile = { id: "test", storage: { namespace: "caatuu-test" }, games: ["sound-quasar", "word-net"] };
const contentKey = "caatuu-test.learning.content.v2";
const legacyKey = "caatuu-test.learning.content.v1";
const plain = value => JSON.parse(JSON.stringify(value));
const zero = { encounteredItems: 0, independentItems: 0, supportedOnlyItems: 0, unknownItems: 0,
  legacyItems: 0, legacyOnlyItems: 0, dueItems: 0 };

function browser({ course = profile, storage, initial = {}, clock = { now } } = {}) {
  const app = createBrowserHarness({ course, localStorageValues: initial });
  if (storage) app.window.localStorage = storage;
  app.window.navigator.locks = { request: async (_name, action) => action() };
  app.context.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  };
  Object.defineProperty(app.window, "CaatuuSemanticLearning", {
    get() { assert.fail("practice summaries must not read the optional semantic provider"); }
  });
  vm.runInContext(source, app.context);
  return { ...app, learning: app.window.CaatuuLearning, clock };
}

function record(app, itemId, changes = {}) {
  const { gameId = "sound-quasar", ...event } = changes;
  app.learning.recordExposure(gameId, { itemId, encounterId: `visit-${itemId}`, bankId: "words", ...event });
}
const countsFor = (summary, gameId, bankId) => summary.games.find(game => game.gameId === gameId)
  .banks.find(bank => bank.bankId === bankId).counts;

test("all registered courses expose empty declared games without writes, model access, or other-course reads", () => {
  for (const course of profiles) {
    const app = browser({ course, initial: {
      "caatuu-unrelated.learning.content.v2": "{unreadable-other-course",
      "caatuu-unrelated.learning.performance.v1": "{unreadable-other-course",
      "caatuu-unrelated.learning.content.v2.pending.other": "{unreadable-other-course"
    } });
    const before = app.localStorage.snapshot();
    const get = app.localStorage.getItem.bind(app.localStorage);
    app.localStorage.getItem = key => {
      assert.ok(key.startsWith(`${course.storage.namespace}.`), `cross-course read: ${key}`);
      return get(key);
    };
    app.localStorage.setItem = () => assert.fail("summary wrote storage");
    app.localStorage.removeItem = () => assert.fail("summary removed storage");
    const result = plain(app.learning.practiceSummary());
    assert.equal(result.courseId, course.id);
    assert.equal(result.status, "ready");
    assert.equal(result.asOf, new Date(now).toISOString());
    assert.deepEqual(result.totals, zero);
    const canonical = id => id === "verb-lab" ? "verb-nebula" : id === "word-net" ? "word-world" : id;
    assert.deepEqual(new Set(result.games.map(game => game.gameId)), new Set(course.games.map(canonical)));
    assert.ok(result.games.every(game => game.banks.length === 0));
    assert.ok(result.games.every(game => Object.values(game.counts).every(count => count === 0)));
    assert.deepEqual(app.localStorage.snapshot(), before);
  }
});

test("independent errors count as assessment; later ambiguous assistance stays conservative", async () => {
  const app = browser();
  record(app, "independent-success", { evidence: "independent", correct: true });
  record(app, "independent-error", { evidence: "independent", correct: false });
  record(app, "supported-success", { evidence: "assisted", correct: true });
  record(app, "support-only", { evidence: "assisted" });
  record(app, "error-then-support", { evidence: "independent", correct: false });
  record(app, "error-then-support", { encounterId: "later-hint", evidence: "assisted" });
  record(app, "success-then-support", { evidence: "independent", correct: true });
  record(app, "success-then-support", { encounterId: "later-hint", evidence: "assisted" });
  record(app, "exposure");
  record(app, "unclassified-error", { correct: false });
  const result = plain(app.learning.practiceSummary({ now: now + day }));
  assert.deepEqual(result.totals, { ...zero, encounteredItems: 8, independentItems: 3,
    supportedOnlyItems: 3, unknownItems: 2, dueItems: 7 });
  const states = learnerBankState({ courseId: profile.id, gameId: "sound-quasar", bankId: "words",
    history: app.learning.contentHistory("sound-quasar", "words"), now: now + day });
  assert.equal(result.totals.independentItems, states.filter(item => item.evidenceStatus === "independently-assessed").length);
  assert.equal(result.totals.supportedOnlyItems, states.filter(item => item.evidenceStatus === "supported").length);
  assert.equal(result.totals.unknownItems, states.filter(item => item.evidenceStatus === "exposure-only").length);
  assert.equal(app.learning.practiceSummary({ now: now - 1 }).totals.dueItems, 0);
  await app.learning.retryPendingSaves();
  const reloaded = browser({ storage: app.localStorage });
  assert.deepEqual(plain(reloaded.learning.practiceSummary({ now: now + day })), result);
});

test("item identities remain separate across games, banks, and every real course", async () => {
  const first = browser({ course: profiles[0] });
  record(first, "same", { evidence: "independent", correct: true, bankId: "target-to-base" });
  record(first, "same", { evidence: "assisted", correct: true, bankId: "base-to-target" });
  record(first, "same", { gameId: "word-world", bankId: "base-to-target" });
  record(first, "__proto__", { gameId: "historic-game", bankId: "constructor" });
  record(first, "same", { evidence: "independent", correct: true, bankId: "target-to-base" });
  await first.learning.retryPendingSaves();
  const result = plain(first.learning.practiceSummary({ now }));
  assert.deepEqual(result.totals, { ...zero, encounteredItems: 4, independentItems: 1, supportedOnlyItems: 1, unknownItems: 2 });
  assert.equal(countsFor(result, "sound-quasar", "target-to-base").independentItems, 1);
  assert.equal(countsFor(result, "sound-quasar", "base-to-target").supportedOnlyItems, 1);
  assert.equal(countsFor(result, "word-world", "base-to-target").unknownItems, 1);
  assert.equal(countsFor(result, "historic-game", "constructor").encounteredItems, 1);
  for (const course of profiles.slice(1)) {
    const other = browser({ course, storage: first.localStorage });
    assert.deepEqual(plain(other.learning.practiceSummary().totals), zero, course.id);
    record(other, "same", { evidence: "independent", correct: false });
    await other.learning.retryPendingSaves();
    assert.equal(other.learning.practiceSummary().totals.independentItems, 1);
    assert.deepEqual(plain(first.learning.practiceSummary({ now })), result);
  }
});

test("legacy checkpoints and pending journals retain provenance without becoming independent or due", async () => {
  const at = new Date(now - 30 * day).toISOString();
  const item = { exposures: 50, successes: 45, mistakes: 5, lastSeenAt: at, lastCorrect: true, encounters: ["old"] };
  const legacy = { schemaVersion: 1, generation: "legacy", banks: {
    '["sound-quasar","words"]': { "old-only": item, mixed: item }
  }, applied: ["already-applied"] };
  const event = { schemaVersion: 1, id: "pending", generation: "legacy", gameId: "sound-quasar", bankId: "words",
    itemId: "pending-only", encounterId: "old-pending", correct: true, at };
  const app = browser({ initial: {
    [legacyKey]: JSON.stringify(legacy),
    [`${legacyKey}.pending.pending`]: JSON.stringify(event),
    [`${legacyKey}.pending.already-applied`]: JSON.stringify({ ...event, id: "already-applied", itemId: "ignored-applied" }),
    [`${legacyKey}.pending.old-generation`]: JSON.stringify({ ...event, id: "old-generation", generation: "older", itemId: "ignored-generation" })
  } });
  record(app, "mixed", { correct: true, evidence: "independent" });
  await app.learning.retryPendingSaves();
  const before = app.localStorage.snapshot();
  const result = plain(app.learning.practiceSummary({ now: now + day }));
  assert.deepEqual(result.totals, { ...zero, encounteredItems: 3, independentItems: 1, unknownItems: 2,
    legacyItems: 3, legacyOnlyItems: 2, dueItems: 1 });
  assert.deepEqual(app.localStorage.snapshot(), before);
  const reloaded = browser({ storage: app.localStorage });
  assert.deepEqual(plain(reloaded.learning.practiceSummary({ now: now + day })), result);
  app.learning.resetProgress();
  assert.deepEqual(plain(app.learning.practiceSummary().totals), zero);
  assert.equal(app.localStorage.getItem(legacyKey), JSON.stringify(legacy));
  await app.learning.retryPendingSaves();
});

test("damaged, future, and unreadable data are partial rather than an authoritative empty history", () => {
  for (const key of [contentKey, legacyKey]) {
    for (const raw of ["{broken", JSON.stringify({ schemaVersion: 999 })]) {
      const app = browser({ initial: { [key]: raw } });
      const before = app.localStorage.snapshot();
      const result = app.learning.practiceSummary();
      assert.equal(result.status, "partial");
      assert.deepEqual(plain(result.totals), zero);
      assert.deepEqual(app.localStorage.snapshot(), before);
    }
  }
  for (const key of [contentKey, `${contentKey}.pending.bad`, `${legacyKey}.pending.bad`, "caatuu-test.learning.performance.v1.reset"]) {
    const app = browser({ initial: key.includes(".pending.") ? { [key]: "{broken" } : {} });
    const get = app.localStorage.getItem.bind(app.localStorage);
    if (!key.includes(".pending.")) app.localStorage.getItem = name => {
      if (name === key) throw new Error("unavailable");
      return get(name);
    };
    assert.equal(app.learning.practiceSummary().status, "partial", key);
  }
});

test("a readable backup and valid journal are counted while a damaged primary stays partial", async () => {
  const first = browser();
  record(first, "saved", { correct: false, evidence: "independent" });
  await first.learning.retryPendingSaves();
  first.localStorage.setItem(contentKey, "{broken");
  const before = first.localStorage.snapshot();
  const reloaded = browser({ storage: first.localStorage });
  const result = reloaded.learning.practiceSummary();
  assert.equal(result.status, "partial");
  assert.equal(result.totals.independentItems, 1);
  assert.deepEqual(first.localStorage.snapshot(), before);
});

test("summary output cannot mutate stored history and invalid clocks are rejected", async () => {
  const app = browser();
  record(app, "saved", { correct: true, evidence: "independent" });
  await app.learning.retryPendingSaves();
  const result = app.learning.practiceSummary();
  result.totals.independentItems = 1000;
  result.games.find(game => game.gameId === "sound-quasar").banks.length = 0;
  assert.equal(app.learning.practiceSummary().totals.independentItems, 1);
  assert.equal(app.learning.contentHistory("sound-quasar", "words").saved.independentSuccesses, 1);
  for (const invalid of [NaN, Infinity, "2026-09-20", 1e100]) {
    assert.throws(() => app.learning.practiceSummary({ now: invalid }), /valid epoch milliseconds/);
  }
});
