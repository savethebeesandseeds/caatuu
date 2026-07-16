const DEFAULT_RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];

function safeItems(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object" && item.id && item.payload);
}

function fallbackId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class FeedbackOutbox {
  constructor({
    storage = null,
    storageKey = "caatuu.feedbackOutbox.v1",
    send,
    now = () => Date.now(),
    random = () => Math.random(),
    idFactory = fallbackId,
    online = () => true,
    visible = () => true,
    saveData = () => false,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    maxItems = 50
  } = {}) {
    if (typeof send !== "function") throw new TypeError("FeedbackOutbox requires a send function.");
    this.storage = storage;
    this.storageKey = storageKey;
    this.itemKeyPrefix = `${storageKey}.item.`;
    this.send = send;
    this.now = now;
    this.random = random;
    this.idFactory = idFactory;
    this.online = online;
    this.visible = visible;
    this.saveData = saveData;
    this.retryDelaysMs = retryDelaysMs;
    this.maxItems = maxItems;
    this.migrateLegacyQueue();
    this.items = this.load();
    this.flushing = null;
  }

  itemStorageKey(id) {
    return `${this.itemKeyPrefix}${encodeURIComponent(String(id || ""))}`;
  }

  migrateLegacyQueue() {
    if (typeof this.storage?.getItem !== "function" || typeof this.storage?.setItem !== "function") return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;
      const legacyItems = safeItems(JSON.parse(raw));
      for (const item of legacyItems) {
        const key = this.itemStorageKey(item.id);
        if (!this.storage.getItem(key)) {
          this.storage.setItem(key, JSON.stringify({ ...item, persisted: true }));
        }
      }
      this.storage.removeItem?.(this.storageKey);
    } catch (error) {
      // Leave the legacy queue untouched so a later startup can retry migration.
    }
  }

  load() {
    const rows = new Map();
    try {
      const legacy = safeItems(JSON.parse(this.storage?.getItem?.(this.storageKey) || "[]"));
      for (const item of legacy) rows.set(String(item.id), { ...item, persisted: true });
    } catch (error) {
      // A malformed legacy queue must not hide independently stored reports.
    }
    if (typeof this.storage?.key === "function") {
      let length = 0;
      try {
        length = Number(this.storage.length || 0);
      } catch (error) {
        length = 0;
      }
      for (let index = 0; index < length; index += 1) {
        let key = null;
        try {
          key = this.storage.key(index);
        } catch (error) {
          continue;
        }
        if (!key?.startsWith(this.itemKeyPrefix)) continue;
        try {
          const item = JSON.parse(this.storage.getItem(key) || "null");
          if (safeItems([item]).length) rows.set(String(item.id), { ...item, persisted: true });
        } catch (error) {
          // Corrupt one-item records are isolated so later reports still load.
        }
      }
    }
    return [...rows.values()].sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
  }

  refreshFromStorage() {
    const rows = new Map(this.load().map((item) => [String(item.id), item]));
    for (const item of this.items) {
      if (item.persisted === false && !rows.has(String(item.id))) rows.set(String(item.id), item);
    }
    this.items = [...rows.values()]
      .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
  }

  persistItem(item) {
    if (typeof this.storage?.setItem !== "function") return false;
    try {
      this.storage.setItem(this.itemStorageKey(item.id), JSON.stringify({ ...item, persisted: true }));
      return true;
    } catch (error) {
      // The in-memory queue remains useful when persistent storage is unavailable.
      return false;
    }
  }

  hasPersistedItem(id) {
    try {
      return Boolean(this.storage?.getItem?.(this.itemStorageKey(id)));
    } catch (error) {
      return false;
    }
  }

  removePersistedItem(id) {
    try {
      this.storage?.removeItem?.(this.itemStorageKey(id));
    } catch (error) {
      // Server acknowledgement is authoritative even if local cleanup is delayed.
    }
  }

  list() {
    return this.items.map((item) => ({ ...item }));
  }

  enqueue(payload, { id = "", dedupeKey = "" } = {}) {
    this.refreshFromStorage();
    const normalizedDedupeKey = String(dedupeKey || "").trim();
    const duplicate = normalizedDedupeKey
      ? this.items.find((item) => item.dedupeKey === normalizedDedupeKey)
      : null;
    if (duplicate) {
      return {
        id: duplicate.id,
        queued: true,
        duplicate: true,
        persisted: duplicate.persisted !== false
      };
    }
    if (this.items.length >= this.maxItems) {
      return { id: "", queued: false, duplicate: false, persisted: false, full: true };
    }

    const item = {
      id: String(id || this.idFactory()),
      dedupeKey: normalizedDedupeKey,
      payload,
      createdAt: this.now(),
      attempts: 0,
      nextAttemptAt: 0,
      lastError: "",
      persisted: true
    };
    this.items.push(item);
    item.persisted = this.persistItem(item);
    return { id: item.id, queued: true, duplicate: false, persisted: item.persisted };
  }

  canFlush() {
    return this.online() && this.visible() && !this.saveData();
  }

  nextDelayMs() {
    this.refreshFromStorage();
    if (!this.items.length) return null;
    return Math.max(0, Math.min(...this.items.map((item) => Number(item.nextAttemptAt || 0))) - this.now());
  }

  retryDelayMs(attempts) {
    const index = Math.min(Math.max(0, attempts - 1), this.retryDelaysMs.length - 1);
    const base = Number(this.retryDelaysMs[index] || this.retryDelaysMs.at(-1) || 30_000);
    const jitter = 0.9 + Math.max(0, Math.min(1, Number(this.random()))) * 0.2;
    return Math.round(base * jitter);
  }

  flush({ maxItems = 1 } = {}) {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushInternal(maxItems).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async flushInternal(maxItems) {
    const sent = [];
    this.refreshFromStorage();
    if (!this.canFlush()) return { sent, pending: this.items.length, paused: true };

    for (let count = 0; count < Math.max(1, maxItems); count += 1) {
      const now = this.now();
      const item = this.items.find((candidate) => Number(candidate.nextAttemptAt || 0) <= now);
      if (!item) break;
      try {
        const result = await this.send(item.payload);
        if (result?.ok !== true) throw new Error(result?.message || "Feedback delivery was not acknowledged.");
        this.items = this.items.filter((candidate) => candidate.id !== item.id);
        this.removePersistedItem(item.id);
        sent.push(item.id);
      } catch (error) {
        if (item.persisted !== false && !this.hasPersistedItem(item.id)) {
          this.items = this.items.filter((candidate) => candidate.id !== item.id);
          break;
        }
        item.attempts = Number(item.attempts || 0) + 1;
        item.nextAttemptAt = this.now() + this.retryDelayMs(item.attempts);
        item.lastError = String(error?.message || error || "Delivery failed").slice(0, 240);
        item.persisted = this.persistItem(item) || this.hasPersistedItem(item.id);
        this.items = this.items.map((candidate) => candidate.id === item.id ? item : candidate);
        break;
      }
    }
    return { sent, pending: this.items.length, paused: false };
  }
}

export function feedbackDedupeKey({ kind = "", sentence = "", reason = "" } = {}) {
  return [kind, sentence, reason]
    .map((value) => String(value || "").normalize("NFC").trim().toLocaleLowerCase())
    .join("|");
}
