import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import {
  buildLearnerRegistry,
  captureLearnerSnapshot,
  checksumLearnerSnapshot,
  classifyStorageKey,
  createIndexedDbBackup,
  createLearnerFile,
  createSemanticPort,
  hasActualProgress,
  importLearnerFile,
  readLearnerFile,
  memoryBackupSlot,
  memoryLocalStore,
  migrateStorageAlias,
  prepareLearnerReplace,
  restoreLearnerBackup,
  restoreLearnerRecord
} from "../static/source/learner-record.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const courseRoot = path.join(repoRoot, "apps/languages");
const registryPath = path.join(repoRoot, "apps/language-runtime/static/data/learner-record-registry.json");
const sourceRoot = path.join(repoRoot, "apps/language-runtime/static/source");

const courseDirectories = [
  ["arabic-standard", "ar"],
  ["czech", "cz"],
  ["english-from-spanish", "es-en"],
  ["georgian", "ka"],
  ["latin-scientific", "la"],
  ["mandarin-simplified", "zh"],
  ["norwegian-bokmal", "nb"],
  ["spanish", "es"],
  ["russian", "ru"]
];

async function loadCourses() {
  const courses = [];
  for (const [directory, id] of courseDirectories) {
    const course = JSON.parse(await readFile(path.join(courseRoot, directory, "course.json"), "utf8"));
    assert.equal(course.id, id);
    courses.push(course);
  }
  return courses;
}

function semanticPort(initial = new Map()) {
  const databases = new Map(initial);
  return {
    databases,
    async read(name) { return databases.has(name) ? structuredClone(databases.get(name)) : null; },
    async replace(name, value) { databases.set(name, structuredClone(value)); }
  };
}

test("registry matches every course manifest and gives Czech the shared storage names", async () => {
  const registry = buildLearnerRegistry(await loadCourses());
  assert.deepEqual(JSON.parse(await readFile(registryPath, "utf8")), registry);
  const czech = registry.courses.find((course) => course.id === "cz");
  const mandarin = registry.courses.find((course) => course.id === "zh");
  assert.equal(czech.records.find((record) => record.name === "wordWorldTranslationMode").alias, undefined);
  assert.equal(czech.records.some((record) => record.name === "verbMemoryLegacy"), false);
  assert.equal(czech.records.find((record) => record.name === "wordWorldRecentSentences").key, "caatuu-czech.word-world.recent-sentences.v1");
  assert.equal(czech.records.find((record) => record.name === "chatSettings").key, "caatuu-czech.chat.settings.v1");
  assert.equal(mandarin.records.some((record) => record.name === "chatSettings"), false);
  assert.equal(mandarin.records.find((record) => record.name === "learningContent").key, "caatuu-zh-hans.learning.content.v2");
});

test("storage literals in the runtime are classified", async () => {
  const unclassified = [];
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, "utf8");
    const literals = new Set();
    for (const match of source.matchAll(/(?:localStorage|sessionStorage)\.(?:get|set|remove)Item\(\s*["']([^"']+)["']/g)) literals.add(match[1]);
    for (const match of source.matchAll(/indexedDB\.open\(\s*["']([^"']+)["']/g)) literals.add(match[1]);
    for (const match of source.matchAll(/(?:STORAGE_KEY|StorageKey)\s*=\s*["']([^"']+)["']/g)) literals.add(match[1]);
    for (const match of source.matchAll(/(?:STORAGE_KEY|StorageKey)\s*=\s*`\$\{[^}]+\}\.([^`$]+)`/g)) literals.add(`caatuu-course.${match[1]}`);
    for (const match of source.matchAll(/const\s+[A-Za-z0-9]+\s*=\s*["'](caatuu[^"']+)["']/g)) literals.add(match[1]);
    for (const key of literals) {
      // Saved progress files use the .caatuu suffix. They are not storage keys.
      if (key.endsWith(".caatuu")) continue;
      if (classifyStorageKey(key) == null) unclassified.push(`${path.relative(repoRoot, file)} ${key}`);
    }
  }
  assert.deepEqual(unclassified, []);
});

test("an old key is copied once and then removed", () => {
  const local = memoryLocalStore({ "caatuu-czech.wordNet.translationMode": "timer-5" });
  assert.equal(migrateStorageAlias(local, "caatuu-czech.word-world.translation-mode", "caatuu-czech.wordNet.translationMode"), true);
  assert.equal(local.getItem("caatuu-czech.word-world.translation-mode"), "timer-5");
  assert.equal(local.getItem("caatuu-czech.wordNet.translationMode"), null);
  local.setItem("caatuu-czech.wordNet.translationMode", "off");
  assert.equal(migrateStorageAlias(local, "caatuu-czech.word-world.translation-mode", "caatuu-czech.wordNet.translationMode"), false);
  assert.equal(local.getItem("caatuu-czech.word-world.translation-mode"), "timer-5");
  assert.equal(local.getItem("caatuu-czech.wordNet.translationMode"), null);
});

test("snapshot refuses a newer format and damaged progress", async () => {
  const registry = buildLearnerRegistry(await loadCourses());
  const performance = registry.courses.find((course) => course.id === "zh").records
    .find((record) => record.name === "learningPerformance");
  await assert.rejects(
    () => captureLearnerSnapshot(registry, { local: memoryLocalStore({ [performance.key]: JSON.stringify({ schemaVersion: 9 }) }) }),
    /newer app/
  );
  await assert.rejects(
    () => captureLearnerSnapshot(registry, { local: memoryLocalStore({ [`${performance.key}.damaged`]: "{}" }) }),
    /needs recovery/
  );
});

test("settings alone do not create a backup, and one practice event does", async () => {
  const registry = buildLearnerRegistry(await loadCourses());
  const mandarin = registry.courses.find((course) => course.id === "zh");
  const goal = mandarin.records.find((record) => record.name === "learningGoal");
  const practice = mandarin.records.find((record) => record.name === "learningPractice");
  const emptyBackup = memoryBackupSlot();
  const settings = await prepareLearnerReplace(registry, {
    local: memoryLocalStore({
      "caatuu.appearance.theme.v1": "night",
      [goal.key]: JSON.stringify({ schemaVersion: 1, goal: "balanced" })
    }),
    backup: emptyBackup
  });
  assert.equal(settings.backup, false);
  assert.equal(await emptyBackup.read(), null);

  const kept = memoryBackupSlot();
  const practiced = await prepareLearnerReplace(registry, {
    local: memoryLocalStore({ [practice.key]: JSON.stringify({ schemaVersion: 2, revision: 1 }) }),
    backup: kept
  });
  assert.equal(practiced.backup, true);
  assert.equal((await kept.read()).courses.zh.records.learningPractice.revision, 1);
  assert.equal(Object.hasOwn((await kept.read()).courses.zh.semantic, "embeddings"), false);
  await assert.rejects(
    () => prepareLearnerReplace(registry, {
      local: memoryLocalStore({ [practice.key]: JSON.stringify({ schemaVersion: 2, revision: 1 }) }),
      backup: { async write() { throw new Error("disk full"); } }
    }),
    /disk full/
  );
});

test("restore replaces progress, keeps cache, and can put the backup back", async () => {
  const registry = buildLearnerRegistry(await loadCourses());
  const mandarin = registry.courses.find((course) => course.id === "zh");
  const performance = mandarin.records.find((record) => record.name === "learningPerformance");
  const cacheKey = "caatuu-zh-hans.wordNet.translationCache.v1";
  const local = memoryLocalStore({
    [performance.key]: JSON.stringify({ schemaVersion: 1, games: { "word-world": { attempts: 2, successes: 1, activities: 0, xp: 1, rounds: 1 } } }),
    [cacheKey]: "[\"cached\"]"
  });
  const semantic = semanticPort(new Map([[
    mandarin.semanticDatabase,
    { attempts: [{ id: "a", statementKey: "keep" }], ledger: [], receipts: [], evidence: [{ statementKey: "seen" }], meta: [{ key: "semantic-progress-epoch", token: "epoch-1" }], embeddings: [{ key: "vector" }] }
  ]]));
  const backup = memoryBackupSlot();
  const ports = { local, semantic, backup };
  assert.equal((await prepareLearnerReplace(registry, ports)).backup, true);
  assert.equal(Object.hasOwn((await backup.read()).courses.zh.semantic, "embeddings"), false);
  const imported = structuredClone(await backup.read());
  imported.courses.zh.records.learningPerformance.games["word-world"].attempts = 9;
  imported.courses.zh.semantic = { attempts: [{ id: "b" }], ledger: [], receipts: [], evidence: [], meta: [] };
  await restoreLearnerRecord(registry, ports, imported);
  assert.equal(JSON.parse(local.getItem(performance.key)).games["word-world"].attempts, 9);
  assert.equal(local.getItem(cacheKey), "[\"cached\"]");
  assert.deepEqual(semantic.databases.get(mandarin.semanticDatabase).attempts, [{ id: "b" }]);
  assert.equal(semantic.databases.get(mandarin.semanticDatabase).embeddings, undefined);
  await restoreLearnerBackup(registry, ports);
  assert.equal(JSON.parse(local.getItem(performance.key)).games["word-world"].attempts, 2);
  assert.equal(hasActualProgress(await backup.read()), true);
});

test("a flushed familiar answer survives snapshot and restore once", async () => {
  const registry = buildLearnerRegistry(await loadCourses());
  const harness = createBrowserHarness({
    course: {
      id: "zh",
      storage: { namespace: "caatuu-zh-hans", learningPerformance: "caatuu-zh-hans.learning.performance.v1" },
      learningGoals: [],
      courseSelector: { courses: [] }
    }
  });
  harness.window.navigator.locks = { request: async (_name, action) => action() };
  const source = await readFile(new URL("../static/source/learning-profile.js", import.meta.url), "utf8");
  vm.runInContext(source, harness.context);
  const learning = harness.window.CaatuuLearning;
  learning.record("sound-quasar", { attempts: 1, successes: 1, rounds: 1, xp: 1 });
  learning.recordExposure("sound-quasar", {
    bankId: "words", itemId: "item-a", encounterId: "visit-1", correct: true, evidence: "independent"
  });
  const local = adaptLocalStorage(harness.localStorage);
  const ports = {
    local,
    semantic: semanticPort(),
    async flush() { return learning.retryPendingSaves(); }
  };
  const snapshot = await captureLearnerSnapshot(registry, ports);
  assert.equal(snapshot.courses.zh.pending.length, 0);
  assert.equal(snapshot.courses.zh.records.learningPerformance.games["sound-quasar"].attempts, 1);
  const item = snapshot.courses.zh.records.learningContent.banks;
  assert.ok(Object.keys(item).length > 0);
  const fresh = memoryLocalStore();
  await restoreLearnerRecord(registry, { local: fresh, semantic: semanticPort() }, snapshot);
  const again = await captureLearnerSnapshot(registry, { local: fresh, semantic: semanticPort() });
  assert.deepEqual(again.courses.zh.records.learningPerformance, snapshot.courses.zh.records.learningPerformance);
  assert.deepEqual(again.courses.zh.records.learningContent, snapshot.courses.zh.records.learningContent);
  assert.equal(again.courses.zh.pending.length, 0);
});

test("queue entries and verb study count, while a known-pair list does not", async () => {
  const registry = buildLearnerRegistry(await loadCourses());
  const mandarin = registry.courses.find((course) => course.id === "zh");
  const queue = mandarin.records.find((record) => record.name === "wordNetPreparedQueue");
  const verb = mandarin.records.find((record) => record.name === "verbMemory");
  const queued = await prepareLearnerReplace(registry, {
    local: memoryLocalStore({ [queue.key]: JSON.stringify({ version: 2, savedAt: 1, entries: [{ sentence: "kept" }] }) }),
    backup: memoryBackupSlot()
  });
  assert.equal(queued.backup, true);
  const studied = await prepareLearnerReplace(registry, {
    local: memoryLocalStore({
      [verb.key]: JSON.stringify({ schemaVersion: 3, families: { meaning: { stats: { attempts: 2, matches: 1, rounds: 1 } } } })
    }),
    backup: memoryBackupSlot()
  });
  assert.equal(studied.backup, true);
  const pool = await prepareLearnerReplace(registry, {
    local: memoryLocalStore({
      [verb.key]: JSON.stringify({ schemaVersion: 3, families: { meaning: { knownPairIds: ["pair"] } } })
    }),
    backup: memoryBackupSlot()
  });
  assert.equal(pool.backup, false);
});

test("replace removes leftovers the app would copy back", async () => {
  const registry = buildLearnerRegistry(await loadCourses());
  const czech = registry.courses.find((course) => course.id === "cz");
  const recent = czech.records.find((record) => record.name === "wordWorldRecentSentences");
  const content = czech.records.find((record) => record.name === "learningContentLegacy");
  const history = czech.records.find((record) => record.name === "wordNetHistoryLegacy");
  const retiredRecent = `${czech.namespace}.wordNet.recentSentences.v1`;
  const retiredVerb = `${czech.namespace}.verb-memory.v2`;
  const pendingAttempt = `${czech.semanticDatabase}.pending-attempt.v1.kept`;
  const local = memoryLocalStore({
    [retiredRecent]: JSON.stringify(["old sentence"]),
    [content.key]: JSON.stringify({ schemaVersion: 1, generation: "g", banks: { words: { item: { exposures: 1 } } }, applied: [] }),
    [`${content.key}.pending.event`]: "{\"id\":\"event\"}",
    [history.key]: JSON.stringify([{ sentence: "old history" }]),
    [retiredVerb]: JSON.stringify({ schemaVersion: 2, stats: { attempts: 3, matches: 1, rounds: 1 } }),
    [pendingAttempt]: "{\"attempt\":{\"id\":\"kept\"}}"
  });
  const snapshot = await captureLearnerSnapshot(registry, { local, semantic: semanticPort() });
  assert.deepEqual(snapshot.courses.cz.records.wordWorldRecentSentences, ["old sentence"]);
  assert.equal(snapshot.courses.cz.records.learningContentLegacy.banks.words.item.exposures, 1);
  assert.equal(snapshot.courses.cz.semanticPending[0].key, pendingAttempt);
  const fresh = memoryLocalStore({
    [retiredRecent]: JSON.stringify(["previous learner"]),
    [recent.key]: JSON.stringify(["previous learner"]),
    [`${czech.namespace}.wordNet.translationMode`]: "visible",
    [`${czech.namespace}.wordNet.translationCache.v1`]: "[]",
    [content.key]: JSON.stringify({ schemaVersion: 1, banks: { other: {} } }),
    [`${content.key}.pending.old`]: "{}",
    [history.key]: JSON.stringify([{ sentence: "previous" }]),
    [retiredVerb]: JSON.stringify({ schemaVersion: 2, stats: { attempts: 9 } }),
    [`${czech.semanticDatabase}.pending-attempt.v1.previous`]: "{}"
  });
  await restoreLearnerRecord(registry, { local: fresh, semantic: semanticPort() }, snapshot);
  assert.equal(fresh.getItem(retiredRecent), null);
  assert.equal(fresh.getItem(`${czech.namespace}.wordNet.translationMode`), null);
  assert.equal(fresh.getItem(`${czech.namespace}.wordNet.translationCache.v1`), "[]");
  assert.equal(fresh.getItem(retiredVerb), null);
  assert.deepEqual(JSON.parse(fresh.getItem(recent.key)), ["old sentence"]);
  assert.equal(JSON.parse(fresh.getItem(content.key)).banks.words.item.exposures, 1);
  assert.equal(fresh.getItem(`${content.key}.pending.event`), "{\"id\":\"event\"}");
  assert.equal(fresh.getItem(`${content.key}.pending.old`), null);
  assert.equal(JSON.parse(fresh.getItem(history.key))[0].sentence, "old history");
  assert.equal(fresh.getItem(pendingAttempt), "{\"attempt\":{\"id\":\"kept\"}}");
  assert.equal(fresh.getItem(`${czech.semanticDatabase}.pending-attempt.v1.previous`), null);
});

test("a learner file round-trips and a changed file is refused", async () => {
  const registry = buildLearnerRegistry(await loadCourses());
  const practice = registry.courses.find((course) => course.id === "zh").records
    .find((record) => record.name === "learningPractice");
  const local = memoryLocalStore({
    [practice.key]: JSON.stringify({ schemaVersion: 2, revision: 4 })
  });
  const file = await createLearnerFile(registry, { local, semantic: semanticPort() });
  assert.equal(file.schemaVersion, "caatuu-learner-file-v1");
  assert.equal(file.checksum, await checksumLearnerSnapshot(file.snapshot));
  assert.equal((await readLearnerFile(file)).courses.zh.records.learningPractice.revision, 4);
  await assert.rejects(() => readLearnerFile({ ...file, checksum: "f".repeat(64) }), /changed/);
});

test("import writes a backup before asking, and replaces only after confirmation", async () => {
  const registry = buildLearnerRegistry(await loadCourses());
  const practice = registry.courses.find((course) => course.id === "zh").records
    .find((record) => record.name === "learningPractice");
  const local = memoryLocalStore({
    [practice.key]: JSON.stringify({ schemaVersion: 2, revision: 2 })
  });
  const file = await createLearnerFile(registry, { local: memoryLocalStore({
    [practice.key]: JSON.stringify({ schemaVersion: 2, revision: 9 })
  }), semantic: semanticPort() });
  const backup = memoryBackupSlot();
  const ports = { local, semantic: semanticPort(), backup };
  let asked = false;
  const declined = await importLearnerFile(registry, ports, file, (prepared) => {
    asked = prepared.backup === true;
    return false;
  });
  assert.equal(asked, true);
  assert.equal(declined.imported, false);
  assert.equal(JSON.parse(local.getItem(practice.key)).revision, 2);
  assert.equal((await backup.read()).courses.zh.records.learningPractice.revision, 2);
  const accepted = await importLearnerFile(registry, ports, file, async () => true);
  assert.equal(accepted.imported, true);
  assert.equal(JSON.parse(local.getItem(practice.key)).revision, 9);
  const blocked = memoryLocalStore({
    [practice.key]: JSON.stringify({ schemaVersion: 2, revision: 3 })
  });
  await assert.rejects(
    () => importLearnerFile(registry, {
      local: blocked,
      semantic: semanticPort(),
      backup: { async write() { throw new Error("disk full"); } }
    }, file, () => { throw new Error("should not ask"); }),
    /disk full/
  );
  assert.equal(JSON.parse(blocked.getItem(practice.key)).revision, 3);
});

test("semantic reads do not create a database, and a blocked open fails", async () => {
  const opened = [];
  const missingList = createSemanticPort({ open(name) { opened.push(name); return {}; } });
  await assert.rejects(() => missingList.read("caatuu-zh-hans.semantic-learning"), /could not be listed/);
  assert.deepEqual(opened, []);

  const listed = {
    async databases() { return [{ name: "caatuu-zh-hans.semantic-learning" }]; },
    open(name) {
      opened.push(name);
      const request = {};
      queueMicrotask(() => {
        request.error = new Error("stop");
        request.onerror?.();
      });
      return request;
    }
  };
  assert.equal(await createSemanticPort(listed).read("caatuu-czech.semantic-learning"), null);
  await assert.rejects(() => createSemanticPort(listed).read("caatuu-zh-hans.semantic-learning"), /stop/);
  assert.deepEqual(opened, ["caatuu-zh-hans.semantic-learning"]);

  const indexes = [];
  let cleared = false;
  const upgrading = {
    async databases() { return [{ name: "db", version: 1 }]; },
    open(name, version) {
      assert.equal(version, 2);
      const request = {};
      const store = {
        indexNames: { contains: () => false },
        createIndex(indexName) { indexes.push(indexName); },
        clear() { cleared = true; }
      };
      const database = {
        objectStoreNames: { contains: (storeName) => storeName === "embeddings" },
        createObjectStore() { return store; },
        close() {}
      };
      queueMicrotask(() => {
        request.result = database;
        request.transaction = { objectStore: () => store };
        request.onupgradeneeded?.({ oldVersion: 1 });
        request.onblocked?.();
      });
      return request;
    }
  };
  await assert.rejects(() => createSemanticPort(upgrading).read("db"), /blocked/);
  assert.ok(indexes.includes("createdAtMs"));
  assert.equal(cleared, true);
  await assert.rejects(() => createIndexedDbBackup({
    open() {
      const request = {};
      queueMicrotask(() => request.onblocked?.());
      return request;
    }
  }).write({ schemaVersion: "caatuu-learner-snapshot-v1" }), /blocked/);
});

function adaptLocalStorage(localStorage) {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
    keys() {
      const names = [];
      for (let index = 0; index < localStorage.length; index += 1) names.push(localStorage.key(index));
      return names;
    }
  };
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(fullPath));
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) files.push(fullPath);
  }
  return files;
}
