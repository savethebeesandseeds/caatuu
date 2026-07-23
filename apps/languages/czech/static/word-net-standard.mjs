const DEFAULT_MANIFEST_URL = "./data/word-world/manifest.json";
const DEFAULT_USAGE_CAPACITY = 8192;

function boundedDifficulty(value) {
  const level = Math.floor(Number(value));
  return level >= 1 && level <= 3 ? level : 1;
}

export function normalizeStandardWord(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/^[^\p{L}\p{M}\d]+|[^\p{L}\p{M}\d]+$/gu, "")
    .trim()
    .toLocaleLowerCase("cs-CZ");
}

function normalizeTarget(target = {}) {
  const surface = String(target.surface || "").normalize("NFC").trim();
  const normalized = normalizeStandardWord(target.normalized || surface);
  const tokenIndex = Number.isInteger(target.tokenIndex) && target.tokenIndex >= 0
    ? target.tokenIndex
    : null;
  if (!surface || !normalized) return null;
  return {
    surface,
    normalized,
    tokenIndex,
    playable: target.playable !== false
  };
}

export function normalizeStandardRecord(record = {}, index = 0) {
  const id = String(record.id || `standard-${index + 1}`).trim();
  const cs = String(record.cs || "").normalize("NFC").replace(/\s+/g, " ").trim();
  const en = String(record.en || "").normalize("NFC").replace(/\s+/g, " ").trim();
  const difficulty = Math.floor(Number(record.difficulty));
  if (!id || !cs || !en || difficulty < 1 || difficulty > 3) return null;
  const alternateSeen = new Set([en.toLocaleLowerCase("en-US")]);
  const enAlternates = (Array.isArray(record.enAlternates) ? record.enAlternates : [])
    .map((value) => String(value || "").normalize("NFC").replace(/\s+/g, " ").trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase("en-US");
      if (!value || alternateSeen.has(key)) return false;
      alternateSeen.add(key);
      return true;
    });
  const targetSeen = new Set();
  const targets = (Array.isArray(record.targets) ? record.targets : [])
    .map(normalizeTarget)
    .filter((target) => {
      if (!target) return false;
      const key = `${target.normalized}|${target.tokenIndex ?? ""}`;
      if (targetSeen.has(key)) return false;
      targetSeen.add(key);
      return true;
    });
  return {
    id,
    cs,
    en,
    enAlternates,
    difficulty,
    cefr: String(record.cefr || "").trim(),
    topic: String(record.topic || "general").trim() || "general",
    targets,
    grammar: Array.isArray(record.grammar)
      ? record.grammar.map((value) => String(value || "").trim()).filter(Boolean)
      : record.grammar && typeof record.grammar === "object"
        ? { ...record.grammar }
        : [],
    learning: record.learning && typeof record.learning === "object" ? { ...record.learning } : {},
    sceneQuery: String(record.sceneQuery || en).normalize("NFC").replace(/\s+/g, " ").trim() || en,
    sceneAssetIds: Array.isArray(record.sceneAssetIds)
      ? [...new Set(record.sceneAssetIds.map((value) => String(value || "").trim()).filter(Boolean))]
      : [],
    provenance: record.provenance && typeof record.provenance === "object" ? { ...record.provenance } : {},
    review: record.review && typeof record.review === "object" ? { ...record.review } : {}
  };
}

function normalizedUsageEntry(value) {
  if (Array.isArray(value)) {
    return {
      count: Math.max(0, Math.floor(Number(value[0]) || 0)),
      lastSeen: Math.max(0, Math.floor(Number(value[1]) || 0))
    };
  }
  return {
    count: Math.max(0, Math.floor(Number(value?.count) || 0)),
    lastSeen: Math.max(0, Math.floor(Number(value?.lastSeen) || 0))
  };
}

export class WordWorldUsageLedger {
  constructor({ corpusVersion = "", entries = {}, now = () => Date.now(), capacity = DEFAULT_USAGE_CAPACITY } = {}) {
    this.corpusVersion = String(corpusVersion || "");
    this.now = now;
    this.capacity = Math.max(64, Math.floor(Number(capacity) || DEFAULT_USAGE_CAPACITY));
    this.entries = new Map();
    const storedEntries = entries instanceof Map
      ? [...entries.entries()]
      : Array.isArray(entries)
        ? entries
        : Object.entries(entries || {});
    for (const [id, value] of storedEntries) {
      const key = String(id || "").trim();
      if (!key) continue;
      this.entries.set(key, normalizedUsageEntry(value));
    }
    this.trim();
  }

  get(id) {
    return this.entries.get(String(id || "")) || { count: 0, lastSeen: 0 };
  }

  mark(id) {
    const key = String(id || "").trim();
    if (!key) return this.get("");
    const current = this.get(key);
    const next = { count: current.count + 1, lastSeen: Math.max(0, Math.floor(this.now())) };
    this.entries.set(key, next);
    this.trim();
    return { ...next };
  }

  trim() {
    if (this.entries.size <= this.capacity) return;
    const victims = [...this.entries.entries()]
      .sort((left, right) => left[1].lastSeen - right[1].lastSeen || left[1].count - right[1].count)
      .slice(0, this.entries.size - this.capacity);
    for (const [id] of victims) this.entries.delete(id);
  }

  snapshot() {
    return {
      version: 1,
      corpusVersion: this.corpusVersion,
      entries: Object.fromEntries([...this.entries.entries()].map(([id, value]) => [
        id,
        [value.count, value.lastSeen]
      ]))
    };
  }
}

function weightedTier(level, availableTiers, random) {
  const weights = level === 1
    ? [[1, 1]]
    : level === 2
      ? [[2, 0.82], [1, 0.18]]
      : [[3, 0.7], [2, 0.25], [1, 0.05]];
  const choices = weights.filter(([tier]) => availableTiers.has(tier));
  if (!choices.length) return null;
  const total = choices.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * total;
  for (const [tier, weight] of choices) {
    cursor -= weight;
    if (cursor < 0) return tier;
  }
  return choices[choices.length - 1][0];
}

export class StandardWordWorldProvider {
  constructor({ manifest = {}, pack = {}, usageLedger, random = Math.random } = {}) {
    this.manifest = manifest && typeof manifest === "object" ? { ...manifest } : {};
    this.corpusVersion = String(pack?.corpusVersion || manifest?.corpusVersion || "unknown");
    this.schemaVersion = String(pack?.schemaVersion || manifest?.schemaVersion || "");
    this.random = random;
    this.usage = usageLedger || new WordWorldUsageLedger({ corpusVersion: this.corpusVersion });
    const seenIds = new Set();
    const seenSentences = new Set();
    this.records = (Array.isArray(pack) ? pack : Array.isArray(pack?.records) ? pack.records : [])
      .map(normalizeStandardRecord)
      .filter((record) => {
        if (!record) return false;
        const sentenceKey = record.cs.toLocaleLowerCase("cs-CZ");
        if (seenIds.has(record.id) || seenSentences.has(sentenceKey)) return false;
        seenIds.add(record.id);
        seenSentences.add(sentenceKey);
        return true;
      });
    this.targetIndex = new Map();
    for (const record of this.records) {
      for (const target of record.targets) {
        if (!target.playable) continue;
        const rows = this.targetIndex.get(target.normalized) || [];
        rows.push(record);
        this.targetIndex.set(target.normalized, rows);
      }
    }
  }

  get size() {
    return this.records.length;
  }

  difficultyCounts() {
    return this.records.reduce((counts, record) => {
      counts[record.difficulty] = (counts[record.difficulty] || 0) + 1;
      return counts;
    }, { 1: 0, 2: 0, 3: 0 });
  }

  eligible(level = 1, records = this.records) {
    const difficulty = boundedDifficulty(level);
    return records.filter((record) => record.difficulty <= difficulty);
  }

  choose(records, { difficulty = 1, excludeIds = [], allowExcludedFallback = true } = {}) {
    const eligible = this.eligible(difficulty, records);
    if (!eligible.length) return null;
    const excluded = new Set((Array.isArray(excludeIds) ? excludeIds : []).map(String));
    const unexcluded = eligible.filter((record) => !excluded.has(record.id));
    const candidates = unexcluded.length ? unexcluded : allowExcludedFallback ? eligible : [];
    if (!candidates.length) return null;
    const tiers = new Set(candidates.map((record) => record.difficulty));
    const tier = weightedTier(boundedDifficulty(difficulty), tiers, this.random);
    const tierCandidates = candidates.filter((record) => record.difficulty === tier);
    const minimumCount = Math.min(...tierCandidates.map((record) => this.usage.get(record.id).count));
    const leastUsed = tierCandidates.filter((record) => this.usage.get(record.id).count === minimumCount);
    const oldestSeen = Math.min(...leastUsed.map((record) => this.usage.get(record.id).lastSeen));
    const oldest = leastUsed.filter((record) => this.usage.get(record.id).lastSeen === oldestSeen);
    const index = Math.min(oldest.length - 1, Math.floor(Math.max(0, Number(this.random()) || 0) * oldest.length));
    return oldest[index] || oldest[0] || null;
  }

  nextRandom(options = {}) {
    const record = this.choose(this.records, options);
    return record ? { record, fallback: false, requestedWord: "" } : null;
  }

  nextForWord(word, options = {}) {
    const requestedWord = normalizeStandardWord(word);
    const exactRecords = this.targetIndex.get(requestedWord) || [];
    const exact = this.choose(exactRecords, { ...options, allowExcludedFallback: false });
    if (exact) return { record: exact, fallback: false, requestedWord };
    const random = this.nextRandom(options);
    return random ? { ...random, fallback: true, requestedWord } : null;
  }

  primaryWord(record, requestedWord = "") {
    const normalizedRequested = normalizeStandardWord(requestedWord);
    const requestedTarget = record?.targets?.find((target) => (
      target.playable && target.normalized === normalizedRequested
    ));
    return requestedTarget?.surface
      || record?.targets?.find((target) => target.playable)?.surface
      || record?.targets?.[0]?.surface
      || String(record?.cs || "").split(/\s+/u)[0]
      || "";
  }

  markUsed(recordOrId) {
    return this.usage.mark(typeof recordOrId === "string" ? recordOrId : recordOrId?.id);
  }
}

function resolveRuntimeUrl(manifestUrl, manifest) {
  const runtimeFile = String(
    manifest?.runtimeFile
    || manifest?.runtime_file
    || manifest?.pack
    || manifest?.file
    || manifest?.files?.runtime
    || ""
  ).trim();
  if (!runtimeFile) throw new Error("The Standard Word World manifest does not name a runtime file.");
  return new URL(runtimeFile, new URL(manifestUrl, globalThis.location?.href || "http://localhost/")).toString();
}

async function verifyRuntimePackText(text, expectedSha256) {
  const expected = String(expectedSha256 || "").trim().toLocaleLowerCase("en-US");
  if (!expected || !globalThis.crypto?.subtle || typeof TextEncoder !== "function") return;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const actual = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== expected) throw new Error("The Standard Word World records failed their integrity check.");
}

export async function loadStandardWordWorldCorpus({
  manifestUrl = DEFAULT_MANIFEST_URL,
  fetchImpl = globalThis.fetch,
  usageEntries = {},
  now,
  random
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  // Refresh the tiny manifest so it can point at a new content-addressed pack;
  // the service worker still supplies its cached copy when the network is down.
  const manifestResponse = await fetchImpl(manifestUrl, { cache: "reload" });
  if (!manifestResponse?.ok) throw new Error(`Could not load the Standard Word World manifest (${manifestResponse?.status || "network"}).`);
  const manifest = await manifestResponse.json();
  const runtimeUrl = resolveRuntimeUrl(manifestResponse.url || manifestUrl, manifest);
  const packResponse = await fetchImpl(runtimeUrl, { cache: "force-cache" });
  if (!packResponse?.ok) throw new Error(`Could not load the Standard Word World records (${packResponse?.status || "network"}).`);
  let pack;
  if (typeof packResponse.text === "function") {
    const packText = await packResponse.text();
    await verifyRuntimePackText(packText, manifest?.contentSha256);
    pack = JSON.parse(packText);
  } else {
    // Test doubles and older adapters may expose json() only.
    pack = await packResponse.json();
  }
  const corpusVersion = String(pack?.corpusVersion || manifest?.corpusVersion || "unknown");
  const ledgerPayload = usageEntries?.corpusVersion === corpusVersion ? usageEntries.entries : {};
  const usageLedger = new WordWorldUsageLedger({ corpusVersion, entries: ledgerPayload, now });
  const provider = new StandardWordWorldProvider({ manifest, pack, usageLedger, random });
  if (!provider.size) throw new Error("The Standard Word World corpus is empty.");
  return provider;
}

export function normalizeWordWorldHistoryEntry(entry = {}) {
  const sentence = String(entry.cs || entry.sentence || "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 180);
  const word = String(entry.word || "").normalize("NFC").trim();
  if (!sentence || !word) return null;
  const contentMode = entry.contentMode === "standard" ? "standard" : "generative";
  const difficulty = Number(entry.difficulty);
  return {
    id: String(entry.id || entry.entryId || "").trim(),
    word,
    sentence,
    en: String(entry.en || entry.translation || "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 220),
    contentMode,
    source: String(entry.source || (contentMode === "standard" ? "standard-corpus" : "history")).trim().slice(0, 64),
    corpusVersion: String(entry.corpusVersion || "").trim().slice(0, 64),
    difficulty: difficulty >= 1 && difficulty <= 3 ? Math.floor(difficulty) : null,
    sceneQuery: String(entry.sceneQuery || entry.en || entry.translation || "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 220)
  };
}

export function migrateWordWorldHistory(entries, { limit = 256 } = {}) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : [])
    .map(normalizeWordWorldHistoryEntry)
    .filter((entry) => {
      if (!entry) return false;
      const key = entry.sentence.toLocaleLowerCase("cs-CZ").replace(/[^\p{L}\p{M}\d]+/gu, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Number(limit) || 256));
}

export function selectStandardTurn(provider, {
  generationMode = "random",
  selectedWord = "",
  difficulty = 1,
  excludeIds = []
} = {}) {
  if (!(provider instanceof StandardWordWorldProvider)) throw new TypeError("A Standard Word World provider is required.");
  return generationMode === "selected"
    ? provider.nextForWord(selectedWord, { difficulty, excludeIds })
    : provider.nextRandom({ difficulty, excludeIds });
}
