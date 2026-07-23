function defaultSentenceKey(sentence) {
  return String(sentence || "")
    .normalize("NFC")
    .toLocaleLowerCase("cs-CZ")
    .replace(/\s+/g, " ")
    .trim();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export class WordNetBranchQueue {
  constructor({
    capacity = 512,
    freshReserve = 24,
    ttlMs = 0,
    now = () => Date.now(),
    normalizeKey,
    sentenceKey = defaultSentenceKey,
    random = Math.random,
    entries = []
  } = {}) {
    if (typeof normalizeKey !== "function") throw new TypeError("WordNetBranchQueue requires normalizeKey.");
    this.capacity = Math.max(1, Number(capacity) || 512);
    this.freshReserve = Math.max(0, Math.min(this.capacity, Number(freshReserve) || 0));
    this.ttlMs = Math.max(0, Number(ttlMs) || 0);
    this.now = now;
    this.normalizeKey = normalizeKey;
    this.sentenceKey = sentenceKey;
    this.random = random;
    this.entries = [];
    this.restore(entries);
  }

  keyFor(word) {
    return String(this.normalizeKey(word) || "").toLocaleLowerCase("cs-CZ");
  }

  sentenceKeyFor(sentence) {
    return String(this.sentenceKey(sentence) || "");
  }

  normalizeWords(word, words = []) {
    const normalized = [word, ...(Array.isArray(words) ? words : [])]
      .map((value) => this.keyFor(value))
      .filter(Boolean);
    return [...new Set(normalized)];
  }

  prune() {
    if (!this.ttlMs) return;
    const cutoff = this.now() - this.ttlMs;
    this.entries = this.entries.filter((entry) => entry.createdAt >= cutoff);
  }

  trim() {
    while (this.entries.length > this.capacity) {
      const fresh = this.entries.filter((entry) => entry.useCount === 0);
      const used = this.entries.filter((entry) => entry.useCount > 0);
      const candidates = fresh.length > this.freshReserve
        ? fresh
        : used.length
          ? used
          : fresh;
      const victim = [...candidates].sort((left, right) => (
        finiteNumber(left.lastUsedAt, 0) - finiteNumber(right.lastUsedAt, 0)
        || left.createdAt - right.createdAt
      ))[0];
      this.entries = this.entries.filter((entry) => entry.id !== victim.id);
    }
  }

  clone(entry) {
    return entry ? { ...entry, words: [...entry.words] } : null;
  }

  choose(entries) {
    if (!entries.length) return null;
    const minimumUseCount = Math.min(...entries.map((entry) => entry.useCount));
    const leastUsed = entries.filter((entry) => entry.useCount === minimumUseCount);
    const index = Math.min(leastUsed.length - 1, Math.floor(Math.max(0, this.random()) * leastUsed.length));
    return leastUsed[index] || leastUsed[0];
  }

  use(entry) {
    if (!entry) return null;
    entry.useCount += 1;
    entry.lastUsedAt = this.now();
    return {
      ...this.clone(entry),
      queueId: entry.id,
      originalSource: entry.source,
      source: "saved-queue"
    };
  }

  get size() {
    this.prune();
    return this.entries.length;
  }

  get freshSize() {
    this.prune();
    return this.entries.filter((entry) => entry.useCount === 0).length;
  }

  has(word) {
    const key = this.keyFor(word);
    this.prune();
    return Boolean(key && this.entries.some((entry) => entry.words.includes(key)));
  }

  hasSentence(sentence) {
    const id = this.sentenceKeyFor(sentence);
    this.prune();
    return Boolean(id && this.entries.some((entry) => entry.id === id));
  }

  count(word, { freshOnly = false, excludeFingerprints = [] } = {}) {
    const key = this.keyFor(word);
    const excluded = new Set(excludeFingerprints.map((value) => String(value || "")).filter(Boolean));
    this.prune();
    return this.entries.filter((entry) => (
      key
      && entry.words.includes(key)
      && (!freshOnly || entry.useCount === 0)
      && !excluded.has(entry.id)
    )).length;
  }

  put(word, candidate) {
    const primaryWord = this.keyFor(word);
    const sentence = String(candidate?.sentence || "").normalize("NFC").trim();
    const id = this.sentenceKeyFor(sentence);
    if (!primaryWord || !sentence || !id) return false;
    this.prune();

    const words = this.normalizeWords(primaryWord, candidate?.words);
    const existing = this.entries.find((entry) => entry.id === id);
    if (existing) {
      existing.words = [...new Set([...existing.words, ...words])];
      existing.createdAt = Math.min(existing.createdAt, finiteNumber(candidate?.createdAt, existing.createdAt));
      existing.lastUsedAt = Math.max(existing.lastUsedAt, finiteNumber(candidate?.lastUsedAt, 0));
      existing.useCount = Math.max(existing.useCount, Math.max(0, Math.floor(finiteNumber(candidate?.useCount, 0))));
      const translation = String(candidate?.translation || "").normalize("NFC").trim();
      if (translation) existing.translation = translation;
      return false;
    }

    const createdAt = finiteNumber(candidate?.createdAt, this.now());
    this.entries.push({
      id,
      word: primaryWord,
      words,
      sentence,
      translation: String(candidate?.translation || "").normalize("NFC").trim(),
      source: String(candidate?.source || "unknown").slice(0, 48),
      createdAt,
      lastUsedAt: Math.max(0, finiteNumber(candidate?.lastUsedAt, 0)),
      useCount: Math.max(0, Math.floor(finiteNumber(candidate?.useCount, 0)))
    });
    this.trim();
    return this.entries.some((entry) => entry.id === id);
  }

  take(word, { excludeFingerprints = [], preferTranslated = false } = {}) {
    const key = this.keyFor(word);
    const excluded = new Set(excludeFingerprints.map((value) => String(value || "")).filter(Boolean));
    this.prune();
    const matches = this.entries.filter((entry) => key && entry.words.includes(key) && !excluded.has(entry.id));
    const primaryMatches = matches.filter((entry) => entry.word === key);
    const pool = primaryMatches.length ? primaryMatches : matches;
    const translated = preferTranslated ? pool.filter((entry) => entry.translation) : [];
    return this.use(this.choose(translated.length ? translated : pool));
  }

  takeAny({ preferredWords = [], excludeWords = [], excludeFingerprints = [], preferTranslated = false } = {}) {
    const preferred = new Set(preferredWords.map((word) => this.keyFor(word)).filter(Boolean));
    const excludedWords = new Set(excludeWords.map((word) => this.keyFor(word)).filter(Boolean));
    const excludedSentences = new Set(excludeFingerprints.map((value) => String(value || "")).filter(Boolean));
    this.prune();
    const candidates = this.entries.filter((entry) => (
      !excludedWords.has(entry.word)
      && !excludedSentences.has(entry.id)
    ));
    const preferredCandidates = candidates.filter((entry) => entry.words.some((word) => preferred.has(word)));
    const pool = preferredCandidates.length ? preferredCandidates : candidates;
    const translated = preferTranslated ? pool.filter((entry) => entry.translation) : [];
    return this.use(this.choose(translated.length ? translated : pool));
  }

  markUsed(sentence) {
    const id = this.sentenceKeyFor(sentence);
    this.prune();
    return this.use(this.entries.find((entry) => entry.id === id));
  }

  setTranslation(sentence, translation) {
    const id = this.sentenceKeyFor(sentence);
    const value = String(translation || "").normalize("NFC").trim();
    if (!id || !value) return false;
    this.prune();
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) return false;
    entry.translation = value;
    return true;
  }

  delete(word) {
    const key = this.keyFor(word);
    const previousSize = this.entries.length;
    this.entries = this.entries.filter((entry) => !entry.words.includes(key));
    return this.entries.length !== previousSize;
  }

  words() {
    this.prune();
    return [...new Set(this.entries.map((entry) => entry.word))];
  }

  values() {
    this.prune();
    return this.entries.map((entry) => this.clone(entry));
  }

  snapshot() {
    return this.values();
  }

  restore(entries) {
    if (!Array.isArray(entries)) return 0;
    let restored = 0;
    for (const entry of entries) {
      if (this.put(entry?.word, entry)) restored += 1;
    }
    return restored;
  }
}
