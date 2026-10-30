// The learner record is the on-device progress a later export file will copy.
// Caches, repair copies, and calculated embeddings stay out of it.

const SNAPSHOT_SCHEMA = "caatuu-learner-snapshot-v1";
const FILE_SCHEMA = "caatuu-learner-file-v1";
const REGISTRY_SCHEMA = "caatuu-learner-registry-v1";
const BACKUP_DATABASE = "caatuu.learner-backup.v1";
const BACKUP_STORE = "backups";
const BACKUP_KEY = "current";

const SEMANTIC_STORES = Object.freeze(["attempts", "ledger", "receipts", "evidence", "meta"]);
const SEMANTIC_INDEXES = Object.freeze({
  attempts: [["occurredAtMs", "occurredAtMs"], ["activityId", "activityId"], ["itemId", "itemId"]],
  ledger: [["kind", "kind"], ["lastOccurredAtMs", "lastOccurredAtMs"]],
  receipts: [["compactedAtMs", "compactedAtMs"]],
  evidence: [["kind", "kind"], ["lastOccurredAtMs", "lastOccurredAtMs"]],
  embeddings: [["modelId", "modelId"], ["textHash", "textHash"], ["createdAtMs", "createdAtMs"]]
});

const SHARED_FIELDS = Object.freeze([
  ["streak", "caatuu.learning.streak.v1", "progress", "json", 1],
  ["theme", "caatuu.appearance.theme.v1", "preference", "string", null],
  ["fontSize", "caatuu.appearance.font-size.v1", "preference", "string", null],
  ["speechPace", "caatuu.speech.pace.v1", "preference", "string", null],
  ["speechMuted", "caatuu.speech.muted.v1", "preference", "string", null],
  ["speechVolume", "caatuu.speech.volume.v1", "preference", "string", null],
  ["speechAutoplay", "caatuu.speech.autoplay.v1", "preference", "string", null],
  ["music", "caatuu.music.v1", "preference", "json", null],
  ["selectedCourse", "caatuu.setup.selected-course.v1", "preference", "string", null],
  ["setupSource", "caatuu.setup.source", "preference", "string", null]
]);

const STORAGE_LITERALS = Object.freeze({
  "caatuu.learning.streak.v1": "progress",
  "caatuu.appearance.theme.v1": "preference",
  "caatuu.appearance.font-size.v1": "preference",
  "caatuu.speech.pace.v1": "preference",
  "caatuu.speech.muted.v1": "preference",
  "caatuu.speech.volume.v1": "preference",
  "caatuu.speech.autoplay.v1": "preference",
  "caatuu.music.v1": "preference",
  "caatuu.music.position.v1": "cache",
  "caatuu.setup.selected-course.v1": "preference",
  "caatuu.setup.source": "preference",
  "caatuu.setup.pending-course.v1": "session",
  "caatuu.setup.last-ship.v1": "cache",
  "caatuu.pendingAppUpdate.v1": "session",
  "caatuu.progress-locks.v1": "session",
  "caatuu.feedbackOutbox.v1": "cache",
  "caatuu.learner-backup.v1": "repair"
});

const KEY_SUFFIXES = Object.freeze([
  [".learning.performance.v1", "progress"],
  [".learning.preferences.v1", "preference"],
  [".learning.game-settings.v1", "preference"],
  [".learning.practice.v1", "progress"],
  [".learning.content.v2", "progress"],
  [".learning.content.v1", "repair"],
  [".learning.goal.v1", "preference"],
  [".verb-memory.v3", "progress"],
  [".verb-memory.v2", "repair"],
  [".verbNebula.targetTextPreferences.v1", "preference"],
  [".verbNebula.speakOnTap.v1", "preference"],
  [".word-world.recent-sentences.v1", "progress"],
  [".word-world.translation-cache.v1", "cache"],
  [".word-world.translation-mode", "preference"],
  [".wordNet.recentSentences.v1", "repair"],
  [".wordNet.translationCache.v1", "cache"],
  [".wordNet.translationMode", "repair"],
  [".wordNet.wordCardPreferences.v1", "preference"],
  [".wordNet.targetTextPreferences.v1", "preference"],
  [".wordNet.challengePromptMode.v1", "preference"],
  [".wordNet.standardUsage.v1", "cache"],
  [".wordNet.preparedQueue.v2", "progress"],
  [".wordNet.speechAutoplay.v2", "preference"],
  [".wordNet.generationMode", "preference"],
  [".wordNet.learningUnit.v1", "preference"],
  [".wordNet.contentMode.v1", "preference"],
  [".wordNet.history.v2", "progress"],
  [".wordNet.history.v1", "repair"],
  [".navigation.backpack-view.v1", "preference"],
  [".navigation.request.v1", "session"],
  [".progress-epoch.v1", "progress"],
  [".semantic-learning", "progress"],
  [".chat.settings.v1", "preference"],
  [".speech.voice.v1", "preference"],
  [".speech.pace.v1", "repair"],
  [".font-size", "preference"],
  [".theme", "preference"]
]);

const DERIVED_RECORDS = Object.freeze([
  ["learningGoal", "learning.goal.v1", "preference", "json", 1],
  ["learningGameSettings", "learning.game-settings.v1", "preference", "json", null],
  ["learningPractice", "learning.practice.v1", "progress", "json", 2],
  ["learningContent", "learning.content.v2", "progress", "json", 3],
  ["learningContentLegacy", "learning.content.v1", "progress", "json", 1],
  ["speechVoice", "speech.voice.v1", "preference", "string", null]
]);

const DECLARED_RECORDS = Object.freeze({
  learningPreferences: ["preference", "json", 1],
  learningPerformance: ["progress", "json", 1],
  verbMemory: ["progress", "json", 3],
  wordWorldTranslationMode: ["preference", "string", null],
  wordWorldRecentSentences: ["progress", "json", null],
  chatSettings: ["preference", "json", null]
});

const RESUME_RECORDS = Object.freeze([
  ["wordNetHistory", "wordNet.history.v2", "progress", "json", null],
  ["wordNetHistoryLegacy", "wordNet.history.v1", "progress", "json", null],
  ["wordNetPreparedQueue", "wordNet.preparedQueue.v2", "progress", "json", null],
  ["wordNetGenerationMode", "wordNet.generationMode", "preference", "string", null],
  ["wordNetContentMode", "wordNet.contentMode.v1", "preference", "string", null],
  ["wordNetChallengePromptMode", "wordNet.challengePromptMode.v1", "preference", "string", null],
  ["wordNetLearningUnit", "wordNet.learningUnit.v1", "preference", "json", null],
  ["wordNetWordCardPreferences", "wordNet.wordCardPreferences.v1", "preference", "json", null],
  ["wordNetTargetTextPreferences", "wordNet.targetTextPreferences.v1", "preference", "json", null],
  ["wordNetSpeechAutoplay", "wordNet.speechAutoplay.v2", "preference", "string", null],
  ["verbSpeakOnTap", "verbNebula.speakOnTap.v1", "preference", "string", null],
  ["verbTargetTextPreferences", "verbNebula.targetTextPreferences.v1", "preference", "json", null]
]);

const RETIRED_RECORD_KEYS = Object.freeze({
  wordWorldTranslationMode: "wordNet.translationMode",
  wordWorldRecentSentences: "wordNet.recentSentences.v1"
});

const OBSOLETE_SUFFIXES = Object.freeze([
  ".wordNet.translationMode",
  ".wordNet.recentSentences.v1",
  ".verb-memory.v2"
]);

const field = (name, key, classification, encoding, maxSchemaVersion, alias = null) => ({
  name, key, class: classification, encoding, maxSchemaVersion, ...(alias ? { alias } : {})
});

export function classifyStorageKey(key) {
  if (typeof key !== "string" || !key) return null;
  if (key.endsWith(".backup") || key.endsWith(".damaged") || key.includes(".pending.") || key.includes(".pending-attempt.")) return "repair";
  if (key.endsWith(".reset")) return "progress";
  if (Object.hasOwn(STORAGE_LITERALS, key)) return STORAGE_LITERALS[key];
  const suffix = KEY_SUFFIXES.find(([ending]) => key.endsWith(ending));
  return suffix ? suffix[1] : null;
}

export function buildLearnerRegistry(courses) {
  const records = courses.map((course) => courseRecord(course)).sort((left, right) => left.id < right.id ? -1 : 1);
  return {
    schemaVersion: REGISTRY_SCHEMA,
    shared: SHARED_FIELDS.map(([name, key, classification, encoding, maxSchemaVersion]) => field(name, key, classification, encoding, maxSchemaVersion)),
    courses: records
  };
}

function courseRecord(course) {
  const namespace = course.storage?.namespace;
  if (typeof namespace !== "string" || !namespace.startsWith("caatuu-")) {
    throw new Error(`Course ${course.id || "unknown"} needs a caatuu- storage namespace.`);
  }
  const storage = course.storage || {};
  const records = [];
  for (const [name, suffix, classification, encoding, maxSchemaVersion] of DERIVED_RECORDS) {
    const declared = storage[name];
    const key = `${namespace}.${suffix}`;
    if (declared !== undefined && declared !== key) {
      throw new Error(`${course.id} storage.${name} must be ${key}.`);
    }
    records.push(field(name, key, classification, encoding, maxSchemaVersion));
  }
  for (const [name, [classification, encoding, maxSchemaVersion]] of Object.entries(DECLARED_RECORDS)) {
    if (typeof storage[name] !== "string") continue;
    const aliasName = `${name}Alias`;
    records.push(field(name, storage[name], classification, encoding, maxSchemaVersion, storage[aliasName] || null));
  }
  if (storage.verbMemory || course.games?.includes("verb-lab")) {
    for (const [name, suffix, classification, encoding, maxSchemaVersion] of RESUME_RECORDS.filter(([recordName]) => recordName.startsWith("verb"))) {
      records.push(field(name, `${namespace}.${suffix}`, classification, encoding, maxSchemaVersion));
    }
  }
  if (storage.wordWorldRecentSentences || course.games?.includes("word-net")) {
    for (const [name, suffix, classification, encoding, maxSchemaVersion] of RESUME_RECORDS.filter(([recordName]) => recordName.startsWith("wordNet"))) {
      records.push(field(name, `${namespace}.${suffix}`, classification, encoding, maxSchemaVersion));
    }
  }
  const resetKey = typeof storage.learningPerformance === "string" ? `${storage.learningPerformance}.reset` : `${namespace}.learning.performance.v1.reset`;
  records.push(field("learningReset", resetKey, "progress", "string", null));
  const semanticDatabase = storage.semanticLearningDatabase || `${namespace}.semantic-learning`;
  records.push(field("semanticProgressEpoch", `${semanticDatabase}.progress-epoch.v1`, "progress", "string", null));
  records.sort((left, right) => left.name < right.name ? -1 : 1);
  return {
    id: course.id,
    namespace,
    semanticDatabase,
    mirrors: {
      theme: storage.theme || `${namespace}.theme`,
      fontSize: storage.fontSize || `${namespace}.font-size`
    },
    records
  };
}

export function migrateStorageAlias(local, canonicalKey, aliasKey) {
  if (!local || !canonicalKey || !aliasKey || aliasKey === canonicalKey) return false;
  const legacy = local.getItem(aliasKey);
  if (legacy == null) return false;
  const copied = local.getItem(canonicalKey) == null;
  if (copied) local.setItem(canonicalKey, legacy);
  local.removeItem(aliasKey);
  return copied;
}

export function hasActualProgress(snapshot) {
  if (snapshot?.schemaVersion !== SNAPSHOT_SCHEMA) return false;
  if (streakHasProgress(snapshot.shared?.streak)) return true;
  return Object.values(snapshot.courses || {}).some((course) => courseHasProgress(course));
}

function courseHasProgress(course) {
  const records = course?.records || {};
  if (performanceHasProgress(records.learningPerformance)) return true;
  if (contentHasProgress(records.learningContent) || contentHasProgress(records.learningContentLegacy)) return true;
  if (practiceHasProgress(records.learningPractice)) return true;
  if (verbHasProgress(records.verbMemory)) return true;
  if (arrayHasEntries(records.wordWorldRecentSentences)) return true;
  if (arrayHasEntries(records.wordNetHistory) || arrayHasEntries(records.wordNetHistoryLegacy)) return true;
  if (arrayHasEntries(records.wordNetPreparedQueue)) return true;
  if ((course.pending || []).length > 0 || (course.semanticPending || []).length > 0) return true;
  const semantic = course.semantic;
  return Boolean(semantic && (arrayHasEntries(semantic.attempts) || arrayHasEntries(semantic.evidence)));
}

function arrayHasEntries(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === "object" && Array.isArray(value.entries) && value.entries.length > 0);
}

function performanceHasProgress(value) {
  const games = value?.games;
  if (!games || typeof games !== "object") return false;
  return Object.values(games).some((game) => ["activities", "attempts", "successes", "xp", "rounds"]
    .some((name) => Number(game?.[name]) > 0));
}

function contentHasProgress(value) {
  const banks = value?.banks;
  if (!banks || typeof banks !== "object") return false;
  return Object.values(banks).some((bank) => bank && typeof bank === "object" && Object.keys(bank).length > 0);
}

function practiceHasProgress(value) {
  if (!value || typeof value !== "object") return false;
  if (["revision", "effort", "completedSets", "legacyCoins", "coinsEarned", "gemsEarned", "setXp"]
    .some((name) => Number(value[name]) > 0)) return true;
  return Boolean(value.staged && typeof value.staged === "object" && Object.keys(value.staged).length > 0);
}

function streakHasProgress(value) {
  if (!value || typeof value !== "object") return false;
  return Number(value.currentDays) > 0 || Number(value.highestDays) > 0 || Boolean(value.lastQualifiedAt);
}

function verbHasProgress(value) {
  if (!value || typeof value !== "object") return false;
  if (arrayHasEntries(value.settlementIds) || arrayHasEntries(value.matchedIds) || arrayHasEntries(value.roundIds)) return true;
  if (countedStudy(value.stats)) return true;
  const families = value.families;
  if (!families || typeof families !== "object") return false;
  return Object.values(families).some((family) => {
    if (!family || typeof family !== "object") return false;
    if (arrayHasEntries(family.matchedIds) || arrayHasEntries(family.roundIds)) return true;
    if (countedStudy(family.stats)) return true;
    const round = family.round;
    return Boolean(round && ["roundIds", "matchedIds", "englishRoundIds"].some((name) => arrayHasEntries(round[name])));
  });
}

function countedStudy(stats) {
  return Boolean(stats && typeof stats === "object"
    && ["attempts", "matches", "rounds"].some((name) => Number(stats[name]) > 0));
}

export async function captureLearnerSnapshot(registry, ports) {
  if (registry?.schemaVersion !== REGISTRY_SCHEMA) throw new Error("Learner registry is not the current format.");
  if (typeof ports?.flush === "function") {
    const status = await ports.flush();
    if (status?.status === "error") throw new Error("Progress could not be saved before it was read.");
  }
  const local = requireLocal(ports);
  const shared = {};
  for (const record of registry.shared) shared[record.name] = readRecord(local, record);
  const courses = {};
  for (const course of registry.courses) {
    for (const record of course.records) {
      if (record.alias) migrateStorageAlias(local, record.key, record.alias);
    }
    adoptRetiredCourseKeys(local, course);
    const records = {};
    for (const record of course.records) records[record.name] = readRecord(local, record);
    const pending = pendingEntries(local, course);
    const semanticPending = semanticPendingEntries(local, course);
    const semantic = normalizeSemantic(typeof ports.semantic?.read === "function"
      ? await ports.semantic.read(course.semanticDatabase)
      : null);
    courses[course.id] = { namespace: course.namespace, records, pending, semanticPending, semantic };
  }
  return { schemaVersion: SNAPSHOT_SCHEMA, shared, courses };
}

function adoptRetiredCourseKeys(local, course) {
  for (const record of course.records) {
    const retired = RETIRED_RECORD_KEYS[record.name];
    if (retired) migrateStorageAlias(local, record.key, `${course.namespace}.${retired}`);
  }
}

function removeObsoleteCourseKeys(local, namespace) {
  for (const suffix of OBSOLETE_SUFFIXES) {
    const key = `${namespace}${suffix}`;
    removePrefixed(local, `${key}.pending.`);
    local.removeItem(`${key}.backup`);
    local.removeItem(`${key}.damaged`);
    local.removeItem(key);
  }
}

function emptySemantic() {
  return { attempts: [], ledger: [], receipts: [], evidence: [], meta: [] };
}

function normalizeSemantic(value) {
  const semantic = emptySemantic();
  if (!value) return semantic;
  for (const name of SEMANTIC_STORES) semantic[name] = Array.isArray(value[name]) ? value[name] : [];
  return semantic;
}

function pendingEntries(local, course) {
  const prefixes = course.records
    .filter((record) => record.class === "progress" && record.name.startsWith("learning"))
    .map((record) => `${record.key}.pending.`);
  return prefixedEntries(local, prefixes);
}

function semanticPendingEntries(local, course) {
  return prefixedEntries(local, [`${course.semanticDatabase}.pending-attempt.v1.`]);
}

function prefixedEntries(local, prefixes) {
  return local.keys()
    .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
    .sort()
    .map((key) => ({ key, value: local.getItem(key) }));
}

function readRecord(local, record) {
  const damagedKey = `${record.key}.damaged`;
  if (record.class !== "cache" && record.class !== "session" && local.getItem(damagedKey) != null) {
    throw new Error(`Progress at ${record.key} needs recovery before it can be copied.`);
  }
  const raw = local.getItem(record.key);
  if (raw == null) return null;
  if (record.encoding === "string") return raw;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Progress at ${record.key} is unreadable.`);
  }
  if (record.maxSchemaVersion != null && value && typeof value.schemaVersion === "number" && value.schemaVersion > record.maxSchemaVersion) {
    throw new Error(`Progress at ${record.key} was saved by a newer app.`);
  }
  return value;
}

export async function restoreLearnerRecord(registry, ports, snapshot) {
  if (snapshot?.schemaVersion !== SNAPSHOT_SCHEMA) throw new Error("Learner snapshot is not the current format.");
  if (registry?.schemaVersion !== REGISTRY_SCHEMA) throw new Error("Learner registry is not the current format.");
  const local = requireLocal(ports);
  for (const record of registry.shared) writeRecord(local, record, snapshot.shared?.[record.name] ?? null);
  const known = new Set(registry.courses.map((course) => course.id));
  for (const courseId of Object.keys(snapshot.courses || {})) {
    if (!known.has(courseId)) throw new Error(`Learner snapshot names an unknown course ${courseId}.`);
  }
  for (const course of registry.courses) {
    const saved = snapshot.courses?.[course.id];
    for (const record of course.records) {
      writeRecord(local, record, saved?.records?.[record.name] ?? null);
      removePrefixed(local, `${record.key}.pending.`);
      local.removeItem(`${record.key}.backup`);
      local.removeItem(`${record.key}.damaged`);
      if (record.alias) {
        local.removeItem(record.alias);
        removePrefixed(local, `${record.alias}.pending.`);
        local.removeItem(`${record.alias}.backup`);
        local.removeItem(`${record.alias}.damaged`);
      }
    }
    removeObsoleteCourseKeys(local, course.namespace);
    for (const entry of saved?.pending || []) {
      if (!course.records.some((record) => entry.key?.startsWith(`${record.key}.pending.`))) {
        throw new Error(`Learner snapshot has a pending record outside ${course.id}.`);
      }
      local.setItem(entry.key, entry.value);
    }
    const semanticPendingPrefix = `${course.semanticDatabase}.pending-attempt.v1.`;
    removePrefixed(local, semanticPendingPrefix);
    for (const entry of saved?.semanticPending || []) {
      if (!entry.key?.startsWith(semanticPendingPrefix)) {
        throw new Error(`Learner snapshot has a semantic attempt outside ${course.id}.`);
      }
      local.setItem(entry.key, entry.value);
    }
    if (snapshot.shared?.theme != null) local.setItem(course.mirrors.theme, snapshot.shared.theme);
    else local.removeItem(course.mirrors.theme);
    if (snapshot.shared?.fontSize != null) local.setItem(course.mirrors.fontSize, snapshot.shared.fontSize);
    else local.removeItem(course.mirrors.fontSize);
    if (typeof ports.semantic?.replace === "function") {
      await ports.semantic.replace(course.semanticDatabase, saved?.semantic || emptySemantic());
    }
  }
}

function writeRecord(local, record, value) {
  if (value == null) {
    local.removeItem(record.key);
    return;
  }
  local.setItem(record.key, record.encoding === "string" ? String(value) : JSON.stringify(value));
}

function removePrefixed(local, prefix) {
  for (const key of local.keys()) {
    if (key.startsWith(prefix)) local.removeItem(key);
  }
}

export async function prepareLearnerReplace(registry, ports) {
  const snapshot = await captureLearnerSnapshot(registry, ports);
  if (!hasActualProgress(snapshot)) return { backup: false };
  if (typeof ports.backup?.write !== "function") throw new Error("A learner backup could not be saved.");
  await ports.backup.write(snapshot);
  return { backup: true };
}

export async function restoreLearnerBackup(registry, ports) {
  if (typeof ports.backup?.read !== "function") throw new Error("No learner backup is saved.");
  const snapshot = await ports.backup.read();
  if (!snapshot) throw new Error("No learner backup is saved.");
  await restoreLearnerRecord(registry, ports, snapshot);
  return snapshot;
}

export async function checksumLearnerSnapshot(snapshot) {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createLearnerFile(registry, ports) {
  const snapshot = await captureLearnerSnapshot(registry, ports);
  return {
    schemaVersion: FILE_SCHEMA,
    snapshot,
    checksum: await checksumLearnerSnapshot(snapshot)
  };
}

export async function readLearnerFile(value) {
  if (!value || value.schemaVersion !== FILE_SCHEMA || !value.snapshot || typeof value.checksum !== "string") {
    throw new Error("This file is not a Caatuu learner record.");
  }
  if (value.snapshot.schemaVersion !== SNAPSHOT_SCHEMA) {
    throw new Error("This learner file is not the current format.");
  }
  const checksum = await checksumLearnerSnapshot(value.snapshot);
  if (checksum !== value.checksum.toLowerCase()) {
    throw new Error("This learner file was changed and cannot be read.");
  }
  return value.snapshot;
}

export async function importLearnerFile(registry, ports, fileValue, confirm) {
  const snapshot = await readLearnerFile(fileValue);
  const prepared = await prepareLearnerReplace(registry, ports);
  if (typeof confirm !== "function" || await confirm(prepared) !== true) {
    return { imported: false, backup: prepared.backup };
  }
  await restoreLearnerRecord(registry, ports, snapshot);
  return { imported: true, backup: prepared.backup };
}

function requireLocal(ports) {
  const local = ports?.local;
  if (!local || typeof local.getItem !== "function" || typeof local.setItem !== "function"
    || typeof local.removeItem !== "function" || typeof local.keys !== "function") {
    throw new Error("Learner storage is unavailable.");
  }
  return local;
}

export function memoryLocalStore(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    keys: () => [...values.keys()]
  };
}

export function memoryBackupSlot() {
  let current = null;
  return {
    async read() { return current ? structuredClone(current) : null; },
    async write(snapshot) { current = structuredClone(snapshot); }
  };
}

export function createIndexedDbBackup(indexedDB) {
  return {
    async read() {
      const database = await openBackupDatabase(indexedDB);
      try {
        return await requestResult(database.transaction(BACKUP_STORE, "readonly").objectStore(BACKUP_STORE).get(BACKUP_KEY))
          .then((row) => row?.snapshot || null);
      } finally {
        database.close();
      }
    },
    async write(snapshot) {
      const database = await openBackupDatabase(indexedDB);
      try {
        const transaction = database.transaction(BACKUP_STORE, "readwrite");
        transaction.objectStore(BACKUP_STORE).put({ key: BACKUP_KEY, snapshot });
        await transactionFinished(transaction);
      } finally {
        database.close();
      }
    }
  };
}

export function createSemanticPort(indexedDB) {
  return {
    async read(databaseName) { return readSemanticDatabase(indexedDB, databaseName); },
    async replace(databaseName, semantic) { return writeSemanticDatabase(indexedDB, databaseName, semantic || emptySemantic()); }
  };
}

async function openBackupDatabase(indexedDB) {
  if (!indexedDB) throw new Error("A learner backup could not be saved.");
  const request = indexedDB.open(BACKUP_DATABASE, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(BACKUP_STORE)) database.createObjectStore(BACKUP_STORE, { keyPath: "key" });
  };
  return requestResult(request, "Opening the learner backup was blocked by another tab.");
}

async function readSemanticDatabase(indexedDB, databaseName) {
  if (!indexedDB) return null;
  if (typeof indexedDB.databases !== "function") throw new Error("Semantic progress could not be listed.");
  const existing = await indexedDB.databases();
  if (!existing.some((entry) => entry.name === databaseName)) return null;
  const database = await openSemanticDatabase(indexedDB, databaseName);
  try {
    if (!SEMANTIC_STORES.every((name) => database.objectStoreNames.contains(name))) return emptySemantic();
    const transaction = database.transaction(SEMANTIC_STORES, "readonly");
    const rows = {};
    for (const name of SEMANTIC_STORES) rows[name] = await requestResult(transaction.objectStore(name).getAll());
    await transactionFinished(transaction);
    return rows;
  } finally {
    database.close();
  }
}

async function writeSemanticDatabase(indexedDB, databaseName, semantic) {
  if (!indexedDB) throw new Error(`Semantic progress for ${databaseName} could not be saved.`);
  const database = await openSemanticDatabase(indexedDB, databaseName);
  try {
    const names = [...SEMANTIC_STORES, "embeddings"];
    const transaction = database.transaction(names, "readwrite");
    for (const name of names) transaction.objectStore(name).clear();
    for (const name of SEMANTIC_STORES) {
      for (const row of semantic[name] || []) transaction.objectStore(name).put(row);
    }
    await transactionFinished(transaction);
  } finally {
    database.close();
  }
}

function openSemanticDatabase(indexedDB, databaseName) {
  const request = indexedDB.open(databaseName, 2);
  request.onupgradeneeded = (event) => {
    const database = request.result;
    const transaction = request.transaction;
    for (const name of [...SEMANTIC_STORES, "embeddings"]) {
      const store = database.objectStoreNames.contains(name)
        ? transaction.objectStore(name)
        : database.createObjectStore(name, { keyPath: semanticKeyPath(name) });
      for (const [indexName, keyPath] of SEMANTIC_INDEXES[name] || []) {
        if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath);
      }
      if (name === "embeddings" && event.oldVersion > 0 && event.oldVersion < 2) store.clear();
    }
  };
  return requestResult(request, `Opening ${databaseName} was blocked by another tab.`);
}

function semanticKeyPath(name) {
  if (name === "ledger" || name === "evidence") return "statementKey";
  if (name === "meta" || name === "embeddings") return "key";
  return "id";
}

function requestResult(request, blockedMessage = "IndexedDB request was blocked.") {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    request.onblocked = () => reject(new Error(blockedMessage));
  });
}

function transactionFinished(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}
