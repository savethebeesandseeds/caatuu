(() => {
  const course = window.CaatuuCourse;
  if (!course) throw new Error("Caatuu course profile must load before the learning profile.");

  const namespace = course.storage.namespace || `caatuu-${course.id}`;
  const preferenceStorageKey = course.storage.learningPreferences || `${namespace}.learning.preferences.v1`;
  const performanceStorageKey = course.storage.learningPerformance || `${namespace}.learning.performance.v1`;
  const streakStorageKey = "caatuu.learning.streak.v1";
  const schemaVersion = 1;
  const dayMillis = 24 * 60 * 60 * 1000;
  const streakReminderHours = Object.freeze([5, 3]);
  const streakArtwork = Object.freeze([
    "/assets/miscellaneous/burrow-review_001.png",
    "/assets/miscellaneous/burrow-review_002.png",
    "/assets/miscellaneous/burrow-review_003.png",
    "/assets/miscellaneous/burrow-review_004.png",
    "/assets/miscellaneous/burrow-review_005.png",
    "/assets/miscellaneous/burrow-review_006.png",
    "/assets/miscellaneous/burrow-review_007.png",
    "/assets/miscellaneous/burrow-review_008.png",
    "/assets/miscellaneous/burrow-review_009.png",
    "/assets/miscellaneous/burrow-review_010.png",
    "/assets/miscellaneous/burrow-review_011.png",
    "/assets/miscellaneous/burrow-review_012.png",
    "/assets/miscellaneous/burrow-review_014.png",
    "/assets/miscellaneous/burrow-review_015.png",
    "/assets/miscellaneous/burrow-review_016.png",
    "/assets/miscellaneous/burrow-review_033.png"
  ]);
  const performanceStoragePattern = /^caatuu-[a-z0-9-]{1,64}\.learning\.performance\.v1$/u;
  const progressResetPreparers = new Set();
  const difficultyLevels = Object.freeze([
    Object.freeze({
      level: 1,
      label: "Explorer",
      summary: "Core vocabulary, more guidance, and calmer repetition."
    }),
    Object.freeze({
      level: 2,
      label: "Traveler",
      summary: "A balanced course profile for variety, support, and challenge."
    }),
    Object.freeze({
      level: 3,
      label: "Navigator",
      summary: "Broader vocabulary, lighter guidance, and tougher choices."
    })
  ]);

  const safeCount = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  };

  const normalizeDifficulty = (value) => {
    const level = Number(value);
    return difficultyLevels.some((option) => option.level === level) ? level : 1;
  };

  const saveFailures = new Map();
  const retryHandlers = new Set();
  const pendingValues = new Map();
  const damagedValues = new Map();
  const gameStateVersions = new Map();
  const gameStateValidators = new Map();
  const journalPrefix = `${performanceStorageKey}.pending.`;
  const resetKey = `${performanceStorageKey}.reset`;
  // Separate from the legacy score journal: older cached clients may compact
  // scores but must never discard item familiarity they do not understand.
  const legacyContentStorageKey = `${namespace}.learning.content.v1`;
  const contentStorageKey = `${namespace}.learning.content.v2`;
  const contentJournalPrefix = `${contentStorageKey}.pending.`;
  const pendingContentEvents = new Map();
  let contentCompaction = null;
  let contentJsonCache = null;
  const pendingEvents = new Map();
  const uniqueId = () => window.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  let lastSaveStatus = "saved";
  let compaction = null;
  let lockDatabase = null;

  const saveStatus = () => ({ status: saveFailures.size ? "error" : "saved" });
  const announceSaveStatus = () => {
    const status = saveStatus();
    if (status.status === lastSaveStatus) return;
    lastSaveStatus = status.status;
    if (typeof window.CustomEvent === "function") {
      window.dispatchEvent?.(new window.CustomEvent("caatuu:progress-save-status", { detail: status }));
    }
  };
  const reportSaveFailure = (key, error) => {
    saveFailures.set(key, error);
    announceSaveStatus();
  };
  const clearSaveFailure = (key) => {
    saveFailures.delete(key);
    announceSaveStatus();
  };

  // Keep a second committed copy. Never replace unreadable/future data with defaults.
  const readJson = (key, options = {}, includePending = true) => {
    if (!key) return null;
    if (Number.isInteger(options.maxSchemaVersion)) gameStateVersions.set(key, options.maxSchemaVersion);
    if (typeof options.validate === "function") gameStateValidators.set(key, options.validate);
    if (includePending && pendingValues.has(key)) return pendingValues.get(key);
    const maximumVersion = gameStateVersions.get(key)
      ?? ([performanceStorageKey, preferenceStorageKey, streakStorageKey].includes(key) ? schemaVersion : Infinity);
    const decode = (raw) => {
      const cacheable = key === contentStorageKey && options.contentCheckpoint === true;
      const validator = gameStateValidators.get(key);
      if (cacheable && contentJsonCache?.raw === raw && contentJsonCache.maximumVersion === maximumVersion
        && contentJsonCache.validator === validator) return contentJsonCache.value;
      const value = JSON.parse(raw || "null");
      if (value && typeof value.schemaVersion === "number" && value.schemaVersion > maximumVersion) {
        damagedValues.set(key, { raw, future: true });
        throw new Error("Progress was saved by a newer app version.");
      }
      if (value !== null && gameStateValidators.has(key) && !gameStateValidators.get(key)(value)) {
        throw new Error("Stored game progress needs recovery.");
      }
      if (cacheable) contentJsonCache = { raw, value, maximumVersion, validator };
      return value;
    };
    let raw;
    try {
      raw = window.localStorage.getItem(key);
      const value = decode(raw);
      const result = value === null ? decode(window.localStorage.getItem(`${key}.backup`)) : value;
      damagedValues.delete(key);
      clearSaveFailure(`read:${key}`);
      return result;
    } catch (error) {
      if (typeof raw === "string" && !damagedValues.has(key)) damagedValues.set(key, { raw });
      reportSaveFailure(`read:${key}`, error);
      try {
        const backup = decode(window.localStorage.getItem(`${key}.backup`));
        if (damagedValues.has(key)) damagedValues.get(key).recoverable = backup !== null;
        return backup;
      }
      catch { return null; }
    }
  };

  const writeJson = (key, value, retainPending = true) => {
    try {
      const damaged = damagedValues.get(key);
      if (saveFailures.has(`read:${key}`) && !damaged) throw new Error("Existing progress could not be read safely.");
      if (damaged) {
        if (damaged.future) throw new Error("A newer progress format must not be overwritten.");
        if (!damaged.recoverable) throw new Error("Unreadable progress must be recovered before replacing it.");
        const preserved = window.localStorage.getItem(`${key}.damaged`);
        if (preserved !== null && preserved !== damaged.raw) throw new Error("Unrecovered progress already exists.");
        window.localStorage.setItem(`${key}.damaged`, damaged.raw);
      }
      const raw = JSON.stringify(value);
      window.localStorage.setItem(key, raw);
      window.localStorage.setItem(`${key}.backup`, raw);
      if (key === contentStorageKey && value?.schemaVersion === 3 && decodedContentCheckpoints.has(value)) {
        contentJsonCache = { raw, value, maximumVersion: 3, validator: validContentCheckpoint };
      }
      pendingValues.delete(key);
      damagedValues.delete(key);
      clearSaveFailure(`read:${key}`);
      clearSaveFailure(`write:${key}`);
      return true;
    } catch (error) {
      if (retainPending) pendingValues.set(key, value);
      reportSaveFailure(`write:${key}`, error);
      return false;
    }
  };

  const removeGameState = (key) => {
    try {
      window.localStorage.removeItem(`${key}.backup`);
      window.localStorage.removeItem(key);
      pendingValues.delete(key);
      damagedValues.delete(key);
      clearSaveFailure(`read:${key}`);
      clearSaveFailure(`write:${key}`);
      return true;
    } catch (error) { reportSaveFailure(`write:${key}`, error); throw error; }
  };

  // Every answer is synchronously journaled before returning to gameplay. The
  // compact totals remain at their historical key for browser/APK compatibility.
  // Only compaction needs a cross-tab lock; unique journal entries never collide.
  const withProgressLock = (action) => {
    if (window.navigator?.locks?.request) return window.navigator.locks.request("caatuu-progress", action);
    if (!window.indexedDB) return Promise.resolve(); // Keep the durable journal intact.
    lockDatabase ||= new Promise((resolve, reject) => {
      const request = window.indexedDB.open("caatuu.progress-locks.v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("lock");
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); lockDatabase = null; };
        resolve(database);
      };
      request.onerror = () => { lockDatabase = null; reject(request.error); };
      request.onblocked = () => { lockDatabase = null; reject(new Error("Progress storage is busy.")); };
    });
    return lockDatabase.then((database) => new Promise((resolve, reject) => {
      const transaction = database.transaction("lock", "readwrite");
      const request = transaction.objectStore("lock").get("writer");
      request.onsuccess = () => {
        try { action(); } catch (error) { transaction.abort(); reject(error); }
      };
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error("Progress save interrupted."));
    }));
  };

  const emptyPerformance = () => ({
    schemaVersion,
    updatedAt: "",
    games: {}
  });

  const normalizeGamePerformance = (value = {}) => {
    const game = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      activities: safeCount(game.activities),
      attempts: safeCount(game.attempts),
      successes: safeCount(game.successes),
      xp: safeCount(game.xp ?? game.successes),
      rounds: safeCount(game.rounds),
      lastPlayedAt: typeof game.lastPlayedAt === "string" ? game.lastPlayedAt : ""
    };
  };

  // The learning profile loads before shell policy. Keep these historical
  // storage aliases local so old clients and new game events share one aggregate.
  const canonicalPerformanceGameId = (value) => {
    const gameId = String(value || "").trim();
    return gameId === "agreement-aurora" || gameId === "triangular-thermosphere"
      ? "grammar-gravity"
      : gameId;
  };

  const mergeGamePerformance = (previous, incoming) => {
    const left = normalizeGamePerformance(previous);
    const right = normalizeGamePerformance(incoming);
    const leftTime = Date.parse(left.lastPlayedAt);
    const rightTime = Date.parse(right.lastPlayedAt);
    return {
      activities: left.activities + right.activities,
      attempts: left.attempts + right.attempts,
      successes: left.successes + right.successes,
      xp: left.xp + right.xp,
      rounds: left.rounds + right.rounds,
      lastPlayedAt: Number.isFinite(rightTime) && (!Number.isFinite(leftTime) || rightTime > leftTime)
        ? right.lastPlayedAt
        : left.lastPlayedAt || right.lastPlayedAt
    };
  };

  const normalizePerformance = (value) => {
    const performance = emptyPerformance();
    if (
      !value
      || typeof value !== "object"
      || value.schemaVersion !== schemaVersion
      || !value.games
      || typeof value.games !== "object"
      || Array.isArray(value.games)
    ) {
      return performance;
    }
    performance.updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : "";
    Object.entries(value.games).forEach(([gameId, game]) => {
      if (!/^[a-z0-9-]{1,40}$/.test(gameId)) return;
      const canonicalId = canonicalPerformanceGameId(gameId);
      performance.games[canonicalId] = mergeGamePerformance(performance.games[canonicalId], game);
    });
    return performance;
  };

  const validDate = (value) => {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  };

  const isoString = (value) => validDate(value)?.toISOString() || "";

  const localDateKey = (value) => {
    const date = validDate(value);
    if (!date) return "";
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const localDateOrdinal = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ""));
    if (!match) return null;
    const ordinal = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / dayMillis;
    const validation = new Date(ordinal * dayMillis);
    if (
      validation.getUTCFullYear() !== Number(match[1])
      || validation.getUTCMonth() !== Number(match[2]) - 1
      || validation.getUTCDate() !== Number(match[3])
    ) return null;
    return ordinal;
  };

  const currentTimeZone = () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
    } catch (error) {
      return "local";
    }
  };

  const streakExpiryFor = (value) => {
    const date = validDate(value);
    if (!date) return "";
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 2).toISOString();
  };

  const randomStreakArtwork = () => (
    streakArtwork[Math.floor(Math.random() * streakArtwork.length)] || streakArtwork[0]
  );

  const emptyStreak = () => ({
    schemaVersion,
    currentDays: 0,
    highestDays: 0,
    lastQualifiedAt: "",
    lastQualifiedLocalDate: "",
    timeZone: currentTimeZone(),
    expiresAt: "",
    lastLapse: null,
    reminderCycle: null,
    remindersEnabled: false,
    updatedAt: ""
  });

  const normalizeLapse = (value) => {
    if (!value || typeof value !== "object") return null;
    const expiredAt = isoString(value.expiredAt);
    const days = safeCount(value.days);
    if (!expiredAt || !days) return null;
    return {
      id: String(value.id || `${expiredAt}:${days}`).slice(0, 160),
      days,
      expiredAt,
      recoveredAt: isoString(value.recoveredAt)
    };
  };

  const normalizeReminderCycle = (value, expiresAt) => {
    if (!value || typeof value !== "object" || isoString(value.expiresAt) !== expiresAt) return null;
    const imagePath = streakArtwork.includes(value.imagePath) ? value.imagePath : randomStreakArtwork();
    const deliveredHours = [...new Set(
      (Array.isArray(value.deliveredHours) ? value.deliveredHours : [])
        .map(Number)
        .filter((hours) => streakReminderHours.includes(hours))
    )];
    return { expiresAt, imagePath, deliveredHours };
  };

  const normalizeStreak = (value) => {
    const streak = emptyStreak();
    if (!value || value.schemaVersion !== schemaVersion || typeof value !== "object") return streak;
    streak.currentDays = safeCount(value.currentDays);
    streak.highestDays = Math.max(streak.currentDays, safeCount(value.highestDays));
    streak.lastQualifiedAt = isoString(value.lastQualifiedAt);
    streak.lastQualifiedLocalDate = localDateOrdinal(value.lastQualifiedLocalDate) === null
      ? ""
      : String(value.lastQualifiedLocalDate);
    streak.timeZone = typeof value.timeZone === "string" && value.timeZone.trim()
      ? value.timeZone.trim().slice(0, 80)
      : currentTimeZone();
    streak.expiresAt = isoString(value.expiresAt);
    streak.lastLapse = normalizeLapse(value.lastLapse);
    streak.reminderCycle = normalizeReminderCycle(value.reminderCycle, streak.expiresAt);
    streak.remindersEnabled = value.remindersEnabled === true;
    streak.updatedAt = isoString(value.updatedAt);
    if (
      streak.currentDays
      && (!streak.lastQualifiedAt || !streak.lastQualifiedLocalDate || !streak.expiresAt)
    ) streak.currentDays = 0;
    if (!streak.currentDays) streak.expiresAt = "";
    if (!streak.expiresAt) streak.reminderCycle = null;
    return streak;
  };

  const readStreak = () => normalizeStreak(readJson(streakStorageKey));

  const writeStreak = (streak) => {
    const normalized = normalizeStreak(streak);
    writeJson(streakStorageKey, normalized);
    return normalized;
  };

  const refreshStreak = (now = new Date()) => {
    const instant = validDate(now) || new Date();
    const streak = readStreak();
    const expiry = validDate(streak.expiresAt);
    if (!streak.currentDays || !expiry || instant.getTime() < expiry.getTime()) return streak;
    const lapsedDays = streak.currentDays;
    streak.currentDays = 0;
    streak.expiresAt = "";
    streak.reminderCycle = null;
    streak.lastLapse = {
      id: `${expiry.toISOString()}:${lapsedDays}`,
      days: lapsedDays,
      expiredAt: expiry.toISOString(),
      recoveredAt: ""
    };
    streak.updatedAt = instant.toISOString();
    return writeStreak(streak);
  };

  const updateStreakForQualification = (now = new Date()) => {
    const instant = validDate(now) || new Date();
    const today = localDateKey(instant);
    const streak = refreshStreak(instant);
    const previousOrdinal = localDateOrdinal(streak.lastQualifiedLocalDate);
    const todayOrdinal = localDateOrdinal(today);
    if (streak.currentDays && previousOrdinal !== null && todayOrdinal !== null && todayOrdinal <= previousOrdinal) {
      return streak;
    }
    streak.currentDays = streak.currentDays && previousOrdinal !== null && todayOrdinal === previousOrdinal + 1
      ? streak.currentDays + 1
      : 1;
    streak.highestDays = Math.max(streak.highestDays, streak.currentDays);
    streak.lastQualifiedAt = instant.toISOString();
    streak.lastQualifiedLocalDate = today;
    streak.timeZone = currentTimeZone();
    streak.expiresAt = streakExpiryFor(instant);
    streak.reminderCycle = {
      expiresAt: streak.expiresAt,
      imagePath: randomStreakArtwork(),
      deliveredHours: []
    };
    streak.updatedAt = instant.toISOString();
    return writeStreak(streak);
  };

  const qualifyStreak = (now = new Date()) => {
    const streak = updateStreakForQualification(now);
    announceChange("streak");
    return streak;
  };

  const dueStreakReminders = (now = new Date()) => {
    const instant = validDate(now) || new Date();
    const streak = refreshStreak(instant);
    const expiry = validDate(streak.expiresAt);
    if (!streak.currentDays || !expiry || !streak.reminderCycle) return [];
    const remaining = expiry.getTime() - instant.getTime();
    if (remaining <= 0) return [];
    const delivered = new Set(streak.reminderCycle.deliveredHours);
    const dueHours = remaining <= 3 * 60 * 60 * 1000
      ? (delivered.has(3) ? [] : [3])
      : remaining <= 5 * 60 * 60 * 1000 && !delivered.has(5)
        ? [5]
        : [];
    return dueHours.map((hours) => ({
      hours,
      currentDays: streak.currentDays,
      highestDays: streak.highestDays,
      expiresAt: streak.reminderCycle.expiresAt,
      imagePath: streak.reminderCycle.imagePath
    }));
  };

  const markStreakReminderDelivered = (expiresAt, hours) => {
    const streak = readStreak();
    const normalizedHours = Number(hours);
    if (
      !streak.reminderCycle
      || streak.reminderCycle.expiresAt !== isoString(expiresAt)
      || !streakReminderHours.includes(normalizedHours)
    ) return streak;
    streak.reminderCycle.deliveredHours = [...new Set([
      ...streak.reminderCycle.deliveredHours,
      normalizedHours
    ])];
    streak.updatedAt = new Date().toISOString();
    return writeStreak(streak);
  };

  const setStreakRemindersEnabled = (enabled) => {
    const streak = readStreak();
    streak.remindersEnabled = enabled === true;
    streak.updatedAt = new Date().toISOString();
    const saved = writeStreak(streak);
    announceChange("streak-reminders");
    return saved.remindersEnabled;
  };

  const migrateLegacyPerformance = () => {
    const performance = emptyPerformance();
    const storedVerb = readJson(course.storage.verbMemory);
    const legacyVerb = storedVerb?.schemaVersion === 3
      ? (storedVerb.families?.meaning || readJson(course.storage.verbMemoryLegacy))
      : (storedVerb || readJson(course.storage.verbMemoryLegacy));
    const attempts = safeCount(legacyVerb?.stats?.attempts);
    const successes = safeCount(legacyVerb?.stats?.matches);
    const rounds = safeCount(legacyVerb?.stats?.rounds);
    if (attempts || successes || rounds) {
      performance.games["verb-nebula"] = {
        activities: attempts,
        attempts,
        successes,
        xp: successes,
        rounds,
        lastPlayedAt: ""
      };
    }
    return performance;
  };

  const validPerformance = (value) => value?.schemaVersion === schemaVersion
    && value.games && typeof value.games === "object" && !Array.isArray(value.games);

  const journalEntries = (storageKey = performanceStorageKey) => {
    const prefix = `${storageKey}.pending.`;
    const entries = new Map(storageKey === performanceStorageKey ? pendingEvents : []);
    try {
      const storage = window.localStorage;
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) {
        if (!key?.startsWith(prefix)) continue;
        try {
          const entry = JSON.parse(storage.getItem(key));
          if (entry === null) continue; // Another tab finished compaction.
          if (entry.schemaVersion !== 1 || typeof entry.id !== "string" || key !== `${prefix}${entry.id}`
            || !/^[a-z0-9-]{1,40}$/.test(entry.gameId) || !entry.delta
            || typeof entry.delta !== "object" || Array.isArray(entry.delta)
            || typeof entry.generation !== "string" || typeof entry.at !== "string" || !validDate(entry.at)) {
            throw new Error("Unreadable pending progress must be preserved.");
          }
          entries.set(entry.id, entry);
          clearSaveFailure(`journal:${key}`);
        } catch (error) { reportSaveFailure(`journal:${key}`, error); }
      }
      for (const failure of saveFailures.keys()) {
        if (!failure.startsWith(`journal:${prefix}`)) continue;
        const key = failure.slice("journal:".length);
        if (!pendingEvents.has(key.slice(prefix.length)) && storage.getItem(key) === null) clearSaveFailure(failure);
      }
      clearSaveFailure(`journal-read:${storageKey}`);
    } catch (error) { reportSaveFailure(`journal-read:${storageKey}`, error); }
    return [...entries.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  };

  const performanceState = (storageKey = performanceStorageKey) => {
    let stored = readJson(storageKey);
    if (stored !== null && !validPerformance(stored)) {
      try {
        const raw = window.localStorage.getItem(storageKey);
        damagedValues.set(storageKey, { raw, future: stored?.schemaVersion > schemaVersion });
        const backup = JSON.parse(window.localStorage.getItem(`${storageKey}.backup`) || "null");
        stored = validPerformance(backup) ? backup : null;
        damagedValues.get(storageKey).recoverable = stored !== null;
      } catch { stored = null; }
      reportSaveFailure(`read:${storageKey}`, new Error("Stored progress needs recovery."));
    }
    let blocked = (saveFailures.has(`read:${storageKey}`) && (!stored || !damagedValues.has(storageKey)))
      || (damagedValues.has(storageKey) && (!stored || damagedValues.get(storageKey).future));
    let base = stored || (storageKey === performanceStorageKey && !blocked ? migrateLegacyPerformance() : emptyPerformance());
    // A separate atomic reset marker fences out a compactor in another tab that
    // started before the reset. Its old totals cannot resurrect cleared progress.
    try {
      const reset = window.localStorage.getItem(`${storageKey}.reset`);
      if (reset && reset !== base.journalGeneration) base = { ...emptyPerformance(), journalGeneration: reset };
    } catch (error) { blocked = true; reportSaveFailure(`read:${storageKey}`, error); }
    const performance = normalizePerformance(base);
    const generation = typeof base.journalGeneration === "string" ? base.journalGeneration : "legacy";
    const applied = new Set(Array.isArray(base.journalApplied) ? base.journalApplied : []);
    const entries = journalEntries(storageKey).filter((entry) => entry.generation === generation);
    for (const entry of entries) {
      if (applied.has(entry.id)) continue;
      const current = normalizeGamePerformance(performance.games[entry.gameId]);
      for (const field of ["activities", "attempts", "successes", "xp", "rounds"]) current[field] += safeCount(entry.delta[field]);
      if (!current.lastPlayedAt || entry.at > current.lastPlayedAt) current.lastPlayedAt = entry.at;
      performance.games[entry.gameId] = current;
      if (!performance.updatedAt || entry.at > performance.updatedAt) performance.updatedAt = entry.at;
    }
    return { performance, generation, entries, blocked, applied };
  };

  const readPerformance = () => performanceState().performance;

  const persistEvent = (entry) => {
    const key = `${journalPrefix}${entry.id}`;
    try {
      window.localStorage.setItem(key, JSON.stringify(entry));
      pendingEvents.delete(entry.id);
      clearSaveFailure(`journal:${key}`);
      return true;
    } catch (error) {
      pendingEvents.set(entry.id, entry);
      reportSaveFailure(`journal:${key}`, error);
      return false;
    }
  };

  const compactProgress = () => {
    for (const entry of [...pendingEvents.values()]) persistEvent(entry);
    if (pendingEvents.size) throw new Error("An answer is still waiting to be journaled.");
    const state = performanceState();
    if (state.blocked) throw new Error("Existing progress must be recovered before replacing it.");
    if ([...saveFailures.keys()].some((key) => key.startsWith(`journal:${journalPrefix}`)
      || key === `journal-read:${performanceStorageKey}`)) throw new Error("Pending progress could not be read completely.");
    if (!state.entries.length && !damagedValues.has(performanceStorageKey)
      && (window.localStorage.getItem(performanceStorageKey) !== null
      || !Object.keys(state.performance.games).length)) return;
    const applied = new Set(state.entries.map((entry) => entry.id));
    for (const id of state.applied) {
      if (window.localStorage.getItem(`${journalPrefix}${id}`) !== null) applied.add(id);
    }
    const value = { ...state.performance, journalGeneration: state.generation, journalApplied: [...applied] };
    if (!writeJson(performanceStorageKey, value, false)) throw new Error("Progress checkpoint could not be saved.");
    for (const entry of state.entries) {
      if (entry.delta.rounds && (entry.delta.successes || entry.delta.xp || entry.delta.streakEligible)) {
        updateStreakForQualification(entry.at);
      }
    }
    if (saveFailures.has(`write:${streakStorageKey}`)) throw new Error("Streak save is still pending.");
    // Both copies contain receipts before deletion. A crash at any intermediate
    // point therefore replays the journal without duplicating earned progress.
    for (const entry of state.entries) {
      const key = `${journalPrefix}${entry.id}`;
      try {
        window.localStorage.removeItem(key);
        pendingEvents.delete(entry.id);
        clearSaveFailure(`journal:${key}`);
      } catch (error) { reportSaveFailure(`journal:${key}`, error); }
    }
  };

  const scheduleCompaction = () => {
    if (compaction) return compaction;
    compaction = Promise.resolve().then(() => withProgressLock(compactProgress))
      .then(() => { clearSaveFailure("checkpoint"); })
      .catch((error) => { reportSaveFailure("checkpoint", error); })
      .finally(() => { compaction = null; });
    return compaction;
  };

  const retryPendingSaves = async () => {
    for (const key of [...damagedValues.keys()]) {
      if (key === legacyContentStorageKey || performanceStoragePattern.test(key) || pendingValues.has(key)) continue;
      const recovered = readJson(key, {}, false);
      const damaged = damagedValues.get(key);
      if (damaged?.recoverable && !damaged.future) writeJson(key, recovered);
    }
    for (const [key, value] of pendingValues) {
      readJson(key, {}, false);
      writeJson(key, value);
    }
    for (const entry of [...pendingEvents.values()]) persistEvent(entry);
    if (compaction) await compaction;
    await scheduleCompaction();
    await scheduleContentCompaction();
    const retries = await Promise.allSettled([...retryHandlers].map((handler) => Promise.resolve().then(handler)));
    const failed = retries.find((result) => result.status === "rejected");
    if (failed) reportSaveFailure("retry", failed.reason);
    else clearSaveFailure("retry");
    return saveStatus();
  };

  const readDifficulty = () => normalizeDifficulty(readJson(preferenceStorageKey)?.difficulty);

  const contentObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const contentIdentifier = value => typeof value === "string" && value.length > 0 && value.length <= 256
    && !/[\u0000-\u001f\u007f]/u.test(value);
  const validLegacyContentState = value => value?.schemaVersion === 1 && typeof value.generation === "string"
    && contentObject(value.banks) && Array.isArray(value.applied)
    && value.applied.every(contentIdentifier)
    && Object.values(value.banks).every(bank => contentObject(bank) && Object.values(bank).every(item =>
      contentObject(item) && ["exposures", "successes", "mistakes"].every(key => Number.isSafeInteger(item[key]) && item[key] >= 0)
      && typeof item.lastSeenAt === "string" && Boolean(validDate(item.lastSeenAt))
      && [null, true, false].includes(item.lastCorrect) && Array.isArray(item.encounters)
      && item.encounters.every(contentIdentifier)));
  const validLegacyContentEvent = event => event?.schemaVersion === 1 && contentIdentifier(event.id)
    && /^[a-z0-9-]{1,40}$/u.test(event.gameId) && contentIdentifier(event.bankId)
    && contentIdentifier(event.itemId) && contentIdentifier(event.encounterId)
    && typeof event.generation === "string" && typeof event.at === "string" && Boolean(validDate(event.at))
    && [null, true, false].includes(event.correct);
  const contentEvidence = value => ["exposure", "assisted", "independent"].includes(value);
  const nullableContentDate = value => value === null || (typeof value === "string" && Boolean(validDate(value)));
  const contentCounts = ["exposures", "successes", "mistakes", "independentSuccesses", "assistedSuccesses",
    "spacedSuccesses", "independentDays", "intervalMs", "lapses"];
  const contentDates = ["firstSeenAt", "lastSeenAt", "lastIndependentAt", "lastAttemptAt", "lastAssistedAt", "dueAt", "spacingAnchorAt"];
  const validContentState = value => value?.schemaVersion === 2 && typeof value.generation === "string"
    && Number.isSafeInteger(value.revision) && value.revision >= 0
    && contentObject(value.banks) && Array.isArray(value.applied) && value.applied.every(contentIdentifier)
    && Object.values(value.banks).every(bank => contentObject(bank) && Object.values(bank).every(item =>
      contentObject(item) && contentCounts.every(key => Number.isSafeInteger(item[key]) && item[key] >= 0)
      && (item.practiceDays === undefined || (Number.isSafeInteger(item.practiceDays) && item.practiceDays >= 0))
      && (item.lastPracticeDayAt === undefined || nullableContentDate(item.lastPracticeDayAt))
      && contentDates.every(key => nullableContentDate(item[key])) && item.firstSeenAt !== null && item.lastSeenAt !== null
      && [null, true, false].includes(item.lastCorrect) && contentEvidence(item.lastEvidence)
      && contentObject(item.encounters) && Object.entries(item.encounters).every(([id, receipt]) => contentIdentifier(id)
        && contentObject(receipt) && Number.isSafeInteger(receipt.flags) && receipt.flags >= 0 && receipt.flags <= 127
        && typeof receipt.at === "string" && Boolean(validDate(receipt.at))
        && (receipt.reviewAt === undefined || (typeof receipt.reviewAt === "string" && Boolean(validDate(receipt.reviewAt)))))));
  const validContentEvent = event => event?.schemaVersion === 2 && contentEvidence(event.evidence)
    && Number.isSafeInteger(event.order) && event.order >= 0
    && (event.previousExposureAt === undefined || nullableContentDate(event.previousExposureAt))
    && validLegacyContentEvent({ ...event, schemaVersion: 1 });
  const contentJournalEntries = (storageKey = contentStorageKey) => {
    const legacy = storageKey === legacyContentStorageKey;
    const prefix = `${storageKey}.pending.`;
    const failurePrefix = legacy ? "legacy-content-journal" : "content-journal";
    const entries = new Map(legacy ? [] : pendingContentEvents);
    try {
      const storage = window.localStorage;
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) {
        if (!key?.startsWith(prefix)) continue;
        try {
          const event = JSON.parse(storage.getItem(key));
          if (event === null) continue;
          if (!(legacy ? validLegacyContentEvent : validContentEvent)(event) || key !== `${prefix}${event.id}`) throw new Error("Pending content exposure needs recovery.");
          entries.set(event.id, event);
          clearSaveFailure(`${failurePrefix}:${key}`);
        } catch (error) { reportSaveFailure(`${failurePrefix}:${key}`, error); }
      }
      clearSaveFailure(`${failurePrefix}-read`);
    } catch (error) { reportSaveFailure(`${failurePrefix}-read`, error); }
    // The logical order preserves sequential encounters within one millisecond
    // without inventing elapsed time. Truly concurrent ties prefer a mistake.
    const resultOrder = event => event.correct === false ? 0 : event.correct === null ? 1 : 2;
    return [...entries.values()].sort((a, b) => (legacy ? 0 : a.order - b.order) || a.at.localeCompare(b.at)
      || resultOrder(a) - resultOrder(b) || a.id.localeCompare(b.id));
  };
  const emptyContentItem = at => ({ exposures: 0, successes: 0, mistakes: 0, firstSeenAt: at, lastSeenAt: at,
    lastCorrect: null, independentSuccesses: 0, assistedSuccesses: 0, lastIndependentAt: null,
    spacedSuccesses: 0, independentDays: 0, intervalMs: 0, dueAt: null, lapses: 0,
    lastEvidence: "exposure", lastAttemptAt: null, lastAssistedAt: null, spacingAnchorAt: null,
    practiceDays: 0, lastPracticeDayAt: null, encounters: {} });
  const receiptFlags = Object.freeze({ success: 1, mistake: 2, independent: 4, assisted: 8, support: 16, day: 32, spaced: 64 });
  const contentReviewDelay = 10 * 60 * 1000;
  const setOwnContent = (object, key, value) => Object.defineProperty(object, key,
    { value, enumerable: true, configurable: true, writable: true });
  // v3 only changes the checkpoint representation. Journals and the public
  // history remain v2-shaped. Every receipt survives: a fixed-size history tail
  // would let delayed callbacks manufacture encounters after a reload.
  const compactContentCounts = [...contentCounts, "practiceDays"];
  const compactContentDates = [...contentDates, "lastPracticeDayAt"];
  const compactContentEvidence = ["exposure", "assisted", "independent"];
  const compactContentOutcomes = [null, true, false];
  const compactContentFields = new Set([...compactContentCounts, ...compactContentDates, "lastCorrect", "lastEvidence", "encounters"]);
  const decodedContentCheckpoints = new WeakMap();
  const packedDigit = value => String.fromCharCode(256 + value);
  const unpackedDigit = (text, index) => {
    const value = text.charCodeAt(index) - 256;
    if (!Number.isInteger(value) || value < 0 || value >= 32768) throw new Error("Invalid packed content digit.");
    return value;
  };
  const packContentInteger = value => {
    if (!Number.isSafeInteger(value)) throw new Error("Content time delta cannot be packed losslessly.");
    let remaining = Math.abs(value);
    let digits = "";
    do { digits += packedDigit(remaining % 32768); remaining = Math.floor(remaining / 32768); } while (remaining);
    return packedDigit(digits.length + (value < 0 ? 8 : 0)) + digits;
  };
  const unpackContentInteger = (text, cursor) => {
    const header = unpackedDigit(text, cursor.index++);
    const length = header & 7;
    if (header > 12 || length < 1 || length > 4) throw new Error("Invalid packed content integer.");
    let value = 0;
    for (let index = 0; index < length; index += 1) value += unpackedDigit(text, cursor.index++) * (32768 ** index);
    if (!Number.isSafeInteger(value) || (length > 1 && unpackedDigit(text, cursor.index - 1) === 0)
      || ((header & 8) && value === 0)) throw new Error("Noncanonical packed content integer.");
    return header & 8 ? -value : value;
  };
  const packContentId = id => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id)) return `s${id}`;
    const hex = id.replaceAll("-", "");
    let bits = 0; let buffer = 0; let result = "u";
    for (let index = 0; index < hex.length; index += 2) {
      buffer |= Number.parseInt(hex.slice(index, index + 2), 16) << bits;
      bits += 8;
      if (bits >= 15) { result += packedDigit(buffer & 32767); buffer >>>= 15; bits -= 15; }
    }
    if (bits) result += packedDigit(buffer);
    return result;
  };
  const unpackContentId = packed => {
    if (packed.startsWith("s")) {
      const id = packed.slice(1);
      if (!contentIdentifier(id) || packContentId(id) !== packed) throw new Error("Invalid packed content ID.");
      return id;
    }
    if (!packed.startsWith("u") || packed.length !== 10) throw new Error("Invalid packed UUID.");
    let bits = 0; let buffer = 0; let hex = "";
    for (let index = 1; index < packed.length; index += 1) {
      const digit = unpackedDigit(packed, index);
      if (index === 9 && digit > 255) throw new Error("Invalid packed UUID tail.");
      buffer |= digit << bits; bits += 15;
      while (bits >= 8 && hex.length < 32) {
        hex += (buffer & 255).toString(16).padStart(2, "0"); buffer >>>= 8; bits -= 8;
      }
    }
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const compactContentDate = value => {
    if (value === null) return null;
    const at = Date.parse(value);
    return new Date(at).toISOString() === value ? at : value;
  };
  const expandContentDate = value => {
    if (value === null || typeof value === "string") return value;
    if (!Number.isSafeInteger(value)) throw new Error("Invalid compact content date.");
    return new Date(value).toISOString();
  };
  const packContentReceipt = (receipt, baseAt) => {
    const at = Date.parse(receipt.at) - baseAt;
    const reviewAt = receipt.reviewAt === undefined ? null : Date.parse(receipt.reviewAt) - baseAt;
    // Preserve unusual but readable legacy timestamps exactly.
    if (Object.keys(receipt).some(field => !["flags", "at", "reviewAt"].includes(field))
      || typeof compactContentDate(receipt.at) !== "number" || !Number.isSafeInteger(at)
      || (reviewAt !== null && (typeof compactContentDate(receipt.reviewAt) !== "number" || !Number.isSafeInteger(reviewAt)))) return { ...receipt };
    const sameReviewTime = reviewAt !== null && reviewAt === at;
    return packedDigit(receipt.flags | (reviewAt === null ? 0 : 128) | (sameReviewTime ? 256 : 0)) + packContentInteger(at)
      + (reviewAt === null || sameReviewTime ? "" : packContentInteger(reviewAt));
  };
  const unpackContentReceipt = (packed, baseAt) => {
    if (contentObject(packed)) return { ...packed };
    if (typeof packed !== "string") throw new Error("Invalid compact content receipt.");
    const flags = unpackedDigit(packed, 0);
    if (flags > 511 || ((flags & 256) && !(flags & 128))) throw new Error("Invalid compact content flags.");
    const cursor = { index: 1 };
    const at = baseAt + unpackContentInteger(packed, cursor);
    const receipt = { flags: flags & 127, at: expandContentDate(at) };
    if (flags & 128) receipt.reviewAt = flags & 256 ? receipt.at : expandContentDate(baseAt + unpackContentInteger(packed, cursor));
    if (cursor.index !== packed.length) throw new Error("Trailing compact content data.");
    return receipt;
  };
  const packContentCheckpoint = value => {
    const packed = { ...value, schemaVersion: 3,
    banks: Object.fromEntries(Object.entries(value.banks).map(([bankId, bank]) => [bankId,
      Object.fromEntries(Object.entries(bank).map(([id, item]) => {
        const extras = Object.fromEntries(Object.entries(item).filter(([field]) => !compactContentFields.has(field)));
        return [id, [
        [...compactContentCounts.map(field => item[field] ?? 0),
          ...compactContentDates.map(field => compactContentDate(item[field] ?? null)),
          compactContentOutcomes.indexOf(item.lastCorrect), compactContentEvidence.indexOf(item.lastEvidence)],
        Object.fromEntries(Object.entries(item.encounters).map(([encounterId, receipt]) =>
          [packContentId(encounterId), packContentReceipt(receipt, Date.parse(item.firstSeenAt))])),
        ...(Object.keys(extras).length ? [extras] : [])
      ]]; }))])) };
    decodedContentCheckpoints.set(packed, value);
    return packed;
  };
  const unpackContentCheckpoint = value => {
    if (value?.schemaVersion === 2) return value;
    if (decodedContentCheckpoints.has(value)) return decodedContentCheckpoints.get(value);
    if (value?.schemaVersion !== 3 || !contentObject(value.banks)) throw new Error("Invalid compact content checkpoint.");
    const banks = {};
    for (const [bankId, bank] of Object.entries(value.banks)) {
      if (!contentObject(bank)) throw new Error("Invalid compact content bank.");
      const expanded = {};
      for (const [id, tuple] of Object.entries(bank)) {
        if (!Array.isArray(tuple) || ![2, 3].includes(tuple.length) || !Array.isArray(tuple[0])
          || tuple[0].length !== compactContentCounts.length + compactContentDates.length + 2
          || !contentObject(tuple[1]) || (tuple.length === 3 && (!contentObject(tuple[2])
            || Object.keys(tuple[2]).some(field => compactContentFields.has(field))))) throw new Error("Invalid compact content item.");
        const [summary, receipts, extras = {}] = tuple; const item = { ...extras }; let index = 0;
        for (const field of compactContentCounts) item[field] = summary[index++];
        for (const field of compactContentDates) item[field] = expandContentDate(summary[index++]);
        if (!Number.isInteger(summary[index]) || summary[index] < 0 || summary[index] >= compactContentOutcomes.length
          || !Number.isInteger(summary[index + 1]) || summary[index + 1] < 0 || summary[index + 1] >= compactContentEvidence.length) {
          throw new Error("Invalid compact content outcome.");
        }
        item.lastCorrect = compactContentOutcomes[summary[index++]];
        item.lastEvidence = compactContentEvidence[summary[index++]];
        item.encounters = {};
        for (const [packedId, packedReceipt] of Object.entries(receipts)) {
          const encounterId = unpackContentId(packedId);
          if (Object.hasOwn(item.encounters, encounterId)) throw new Error("Repeated compact content ID.");
          setOwnContent(item.encounters, encounterId, unpackContentReceipt(packedReceipt, Date.parse(item.firstSeenAt)));
        }
        setOwnContent(expanded, id, item);
      }
      setOwnContent(banks, bankId, expanded);
    }
    const expanded = { ...value, schemaVersion: 2, banks };
    if (!validContentState(expanded)) throw new Error("Invalid expanded content checkpoint.");
    decodedContentCheckpoints.set(value, expanded);
    return expanded;
  };
  const validContentCheckpoint = value => {
    try { return validContentState(unpackContentCheckpoint(value)); } catch { return false; }
  };
  const latestReceiptAt = (item, flag) => Object.values(item.encounters).filter(receipt => receipt.flags & flag)
    .map(receipt => receipt.at).sort().at(-1) || null;
  const bringContentReviewForward = (item, at, receipt) => {
    // A fresh attempt starts a new short review interval, including when its
    // previous deadline has expired. Re-delivery/correction of that encounter
    // cannot keep postponing the review.
    if (receipt.reviewAt !== undefined) return;
    receipt.reviewAt = at;
    item.intervalMs = Math.min(item.intervalMs || contentReviewDelay, contentReviewDelay);
    item.dueAt = new Date(Date.parse(at) + item.intervalMs).toISOString();
  };
  const applyContentEvent = (item, event) => {
    const flags = receiptFlags;
    const previousPracticeAt = Math.max(...[item.lastSeenAt, item.lastAttemptAt, event.previousExposureAt]
      .map(value => Date.parse(value)).filter(Number.isFinite));
    const exists = Object.hasOwn(item.encounters, event.encounterId);
    const receipt = exists ? item.encounters[event.encounterId] : { flags: 0, at: event.at };
    item.practiceDays ??= 0;
    item.lastPracticeDayAt ??= null;
    if (!exists) {
      item.exposures += 1;
      item.firstSeenAt = item.firstSeenAt < event.at ? item.firstSeenAt : event.at;
      setOwnContent(item.encounters, event.encounterId, receipt);
      // Spaced participation is only an exploration signal. It never grants
      // independent recall, enlarges a review interval, or removes uncertainty.
      if (item.lastPracticeDayAt === null || (event.at.slice(0, 10) !== item.lastPracticeDayAt.slice(0, 10)
        && Date.parse(event.at) - Date.parse(item.lastPracticeDayAt) >= dayMillis)) {
        item.practiceDays += 1;
        item.lastPracticeDayAt = event.at;
      }
    }
    let changed = !exists;
    if (event.correct === false && !(receipt.flags & flags.mistake)) {
      item.mistakes += 1; item.lapses += 1; changed = true;
      receipt.flags |= flags.mistake;
      // Concurrent/delayed delivery must not transform a corrected mistake into
      // unaided recall, even if its success was checkpointed first.
      if (receipt.flags & flags.independent) {
        item.independentSuccesses -= 1; receipt.flags &= ~flags.independent;
        if (receipt.flags & flags.day) { item.independentDays -= 1; receipt.flags &= ~flags.day; }
        if (receipt.flags & flags.spaced) { item.spacedSuccesses -= 1; receipt.flags &= ~flags.spaced; }
        item.lastIndependentAt = latestReceiptAt(item, flags.independent);
        item.spacingAnchorAt = latestReceiptAt(item, flags.day);
      }
      bringContentReviewForward(item, event.at, receipt);
    }
    if (event.evidence === "assisted" && !(receipt.flags & flags.support)) {
      receipt.flags |= flags.support; changed = true;
      item.lastAssistedAt = !item.lastAssistedAt || event.at > item.lastAssistedAt ? event.at : item.lastAssistedAt;
      bringContentReviewForward(item, event.at, receipt);
    }
    if (event.correct === true && !(receipt.flags & flags.success)) {
      receipt.flags |= flags.success; item.successes += 1; changed = true;
      if (!exists && event.evidence === "independent" && !(receipt.flags & (flags.mistake | flags.support))) {
        receipt.flags |= flags.independent; item.independentSuccesses += 1;
        item.lastIndependentAt = !item.lastIndependentAt || event.at > item.lastIndependentAt ? event.at : item.lastIndependentAt;
        const first = item.spacingAnchorAt === null;
        const elapsed = first ? 0 : Date.parse(event.at) - Date.parse(item.spacingAnchorAt);
        const spaced = !first && event.at.slice(0, 10) !== item.spacingAnchorAt.slice(0, 10)
          && elapsed >= Math.max(dayMillis, item.intervalMs)
          && Date.parse(event.at) - previousPracticeAt >= Math.max(dayMillis, item.intervalMs);
        if (first || spaced) {
          receipt.flags |= flags.day; item.independentDays += 1;
          if (spaced) { receipt.flags |= flags.spaced; item.spacedSuccesses += 1; }
          item.intervalMs = first ? dayMillis : Math.min(30 * dayMillis,
            Math.round(Math.max(dayMillis, item.intervalMs) * 1.8));
          item.spacingAnchorAt = event.at;
          item.dueAt = new Date(Date.parse(event.at) + item.intervalMs).toISOString();
        } else if (Date.parse(event.at) >= previousPracticeAt) {
          // Rehearsal restarts the current interval without enlarging it or
          // earning spaced credit. A clock rollback cannot pull it backward.
          item.dueAt = new Date(Date.parse(event.at) + item.intervalMs).toISOString();
        }
      }
    }
    if ((receipt.flags & flags.success) && !(receipt.flags & (flags.independent | flags.assisted))
      && ((receipt.flags & (flags.mistake | flags.support)) || (event.correct === true && event.evidence !== "exposure"
        && (exists || event.evidence === "assisted")))) {
      receipt.flags |= flags.assisted; item.assistedSuccesses += 1; changed = true;
      item.lastAssistedAt = !item.lastAssistedAt || event.at > item.lastAssistedAt ? event.at : item.lastAssistedAt;
      bringContentReviewForward(item, event.at, receipt);
    }
    if (changed) {
      if (event.at > item.lastSeenAt) item.lastSeenAt = event.at;
      if (event.correct !== null && (!item.lastAttemptAt || event.at >= item.lastAttemptAt)) {
        item.lastAttemptAt = event.at;
        item.lastCorrect = receipt.flags & flags.mistake ? false : event.correct;
        item.lastEvidence = receipt.flags & flags.assisted ? "assisted"
          : receipt.flags & flags.independent ? "independent" : event.evidence;
      } else if (event.evidence === "assisted" && (!item.lastAttemptAt || event.at >= item.lastAttemptAt)) {
        item.lastEvidence = "assisted";
      }
    }
    return changed;
  };
  const contentState = () => {
    // Cache only an exact, validated checkpoint string. Reset markers and
    // journals are still read afresh, and the decoded state below is cloned
    // before applying events. Public readGameState callers receive fresh data.
    const checkpoint = readJson(contentStorageKey, { maxSchemaVersion: 3, validate: validContentCheckpoint, contentCheckpoint: true });
    const stored = checkpoint ? unpackContentCheckpoint(checkpoint) : null;
    let generation = stored?.generation || "legacy";
    try {
      generation = window.localStorage.getItem(resetKey) || "legacy";
      clearSaveFailure("content-generation");
    }
    catch (error) { reportSaveFailure("content-generation", error); }
    const value = stored?.generation === generation ? JSON.parse(JSON.stringify(stored))
      : { schemaVersion: 2, generation, revision: 0, banks: {}, applied: [] };
    const applied = new Set(value.applied);
    const entries = contentJournalEntries().filter(event => event.generation === generation);
    for (const event of entries) {
      value.revision = Math.max(value.revision, event.order);
      if (event.generation !== generation || applied.has(event.id)) continue;
      const key = JSON.stringify([canonicalPerformanceGameId(event.gameId), event.bankId]);
      const bank = Object.hasOwn(value.banks, key) ? value.banks[key] : {};
      const item = Object.hasOwn(bank, event.itemId) ? bank[event.itemId] : emptyContentItem(event.at);
      applyContentEvent(item, event);
      setOwnContent(bank, event.itemId, item);
      value.banks[key] = bank;
    }
    return { value, entries };
  };
  const legacyContentBank = (gameId, bankId, generation) => {
    const stored = readJson(legacyContentStorageKey, { maxSchemaVersion: 1, validate: validLegacyContentState });
    const key = JSON.stringify([canonicalPerformanceGameId(gameId), bankId]);
    const bank = stored?.generation === generation && Object.hasOwn(stored.banks, key)
      ? JSON.parse(JSON.stringify(stored.banks[key])) : {};
    const applied = new Set(stored?.generation === generation ? stored.applied : []);
    for (const event of contentJournalEntries(legacyContentStorageKey)) {
      if (event.generation !== generation || applied.has(event.id) || canonicalPerformanceGameId(event.gameId) !== canonicalPerformanceGameId(gameId)
        || event.bankId !== bankId) continue;
      const item = Object.hasOwn(bank, event.itemId) ? bank[event.itemId]
        : { exposures: 0, successes: 0, mistakes: 0, lastSeenAt: event.at, lastCorrect: null, encounters: [] };
      if (item.encounters.includes(event.encounterId)) continue;
      item.exposures += 1; item.successes += Number(event.correct === true); item.mistakes += Number(event.correct === false);
      if (event.at >= item.lastSeenAt) { item.lastSeenAt = event.at; item.lastCorrect = event.correct; }
      item.encounters.push(event.encounterId); setOwnContent(bank, event.itemId, item);
    }
    return bank;
  };
  const contentHistory = (gameId, bankId = "default") => {
    const key = JSON.stringify([canonicalPerformanceGameId(gameId), bankId]);
    const { value } = contentState();
    const bank = value.banks[key] || {};
    // Keep v1 immutable: cached v1 compactors may still run. Its old scores
    // contribute exposure history, never independent or spaced evidence.
    const legacy = legacyContentBank(gameId, bankId, value.generation);
    return Object.fromEntries([...new Set([...Object.keys(bank), ...Object.keys(legacy)])].map(id => {
      const item = Object.hasOwn(bank, id) ? bank[id] : emptyContentItem(legacy[id].lastSeenAt);
      const { encounters, spacingAnchorAt, ...summary } = item;
      summary.practiceDays ??= 0;
      summary.lastPracticeDayAt ??= null;
      if (Object.hasOwn(legacy, id)) {
        const old = legacy[id];
        for (const field of ["exposures", "successes", "mistakes"]) summary[field] += old[field];
        summary.firstSeenAt = old.lastSeenAt < summary.firstSeenAt ? old.lastSeenAt : summary.firstSeenAt;
        summary.lastSeenAt = old.lastSeenAt > summary.lastSeenAt ? old.lastSeenAt : summary.lastSeenAt;
        if (!summary.lastAttemptAt) summary.lastCorrect = old.lastCorrect;
      }
      return [id, summary];
    }));
  };
  const persistContentEvent = event => {
    const key = `${contentJournalPrefix}${event.id}`;
    try {
      window.localStorage.setItem(key, JSON.stringify(event));
      pendingContentEvents.delete(event.id);
      clearSaveFailure(`content-journal:${key}`);
    } catch (error) {
      pendingContentEvents.set(event.id, event);
      reportSaveFailure(`content-journal:${key}`, error);
    }
  };
  const compactContent = () => {
    for (const event of [...pendingContentEvents.values()]) persistContentEvent(event);
    if (pendingContentEvents.size) throw new Error("Content exposure is waiting to be saved.");
    const { value, entries } = contentState();
    if ([...saveFailures.keys()].some(key => key === `read:${contentStorageKey}`
      || key === "content-generation" || key === "content-journal-read" || key.startsWith("content-journal:"))) {
      throw new Error("Existing content progress needs recovery.");
    }
    if (!entries.length) return;
    value.applied = entries.filter(event => event.generation === value.generation).map(event => event.id);
    if (!writeJson(contentStorageKey, packContentCheckpoint(value), false)) throw new Error("Content checkpoint could not be saved.");
    // A reset can interleave across tabs even during synchronous localStorage
    // operations. Never delete encounters belonging to a newer generation.
    if ((window.localStorage.getItem(resetKey) || "legacy") !== value.generation) return;
    for (const event of entries) {
      const key = `${contentJournalPrefix}${event.id}`;
      try { window.localStorage.removeItem(key); clearSaveFailure(`content-journal:${key}`); }
      catch (error) { reportSaveFailure(`content-journal:${key}`, error); }
    }
  };
  const scheduleContentCompaction = () => {
    if (contentCompaction) return contentCompaction;
    contentCompaction = Promise.resolve().then(() => withProgressLock(compactContent))
      .then(() => clearSaveFailure("content-checkpoint"))
      .catch(error => reportSaveFailure("content-checkpoint", error))
      .finally(() => { contentCompaction = null; });
    return contentCompaction;
  };
  const contentGeneration = () => {
    try {
      const generation = window.localStorage.getItem(resetKey) || "legacy";
      clearSaveFailure("content-generation");
      return generation;
    } catch (error) {
      reportSaveFailure("content-generation", error);
      return null;
    }
  };
  const recordExposure = (gameId, { bankId = "default", itemId, encounterId, correct = null, generation, evidence = "exposure", previousExposureAt } = {}) => {
    const state = contentState();
    // Presentations capture their generation before a possible cross-tab reset.
    // Legacy callers may omit it; an explicitly unknown generation fails closed.
    if (generation !== undefined && (typeof generation !== "string"
      || generation !== state.value.generation || saveFailures.has("content-generation"))) return false;
    if (evidence !== "exposure" && saveFailures.has("content-generation")) return false;
    const event = { schemaVersion: 2, id: uniqueId(), generation: state.value.generation, order: state.value.revision + 1,
      gameId: canonicalPerformanceGameId(gameId), bankId, itemId, encounterId, correct, evidence, at: new Date().toISOString() };
    if (previousExposureAt !== undefined) event.previousExposureAt = previousExposureAt;
    if (!validContentEvent(event)) throw new TypeError("A completed content encounter needs valid IDs, a boolean or null result, and exposure, assisted or independent evidence.");
    const bank = state.value.banks[JSON.stringify([event.gameId, bankId])];
    if (bank && Object.hasOwn(bank, itemId) && !applyContentEvent(JSON.parse(JSON.stringify(bank[itemId])), event)) return contentHistory(event.gameId, bankId);
    const old = legacyContentBank(event.gameId, bankId, state.value.generation);
    if (Object.hasOwn(old, itemId) && old[itemId].encounters.includes(encounterId)) return contentHistory(event.gameId, bankId);
    persistContentEvent(event);
    void scheduleContentCompaction();
    return contentHistory(event.gameId, bankId);
  };

  const difficultyOption = (level = readDifficulty()) => (
    difficultyLevels.find((option) => option.level === normalizeDifficulty(level)) || difficultyLevels[0]
  );

  const summarize = (performance = readPerformance()) => {
    const games = normalizePerformance(performance).games;
    const totals = Object.values(games).reduce((summary, game) => ({
      activities: summary.activities + game.activities,
      attempts: summary.attempts + game.attempts,
      successes: summary.successes + game.successes,
      xp: summary.xp + game.xp,
      rounds: summary.rounds + game.rounds
    }), { activities: 0, attempts: 0, successes: 0, xp: 0, rounds: 0 });
    return {
      ...totals,
      accuracy: totals.attempts ? Math.round((totals.successes / totals.attempts) * 100) : null,
      activeGames: Object.values(games).filter((game) => game.activities || game.rounds).length
    };
  };

  const courseSummaries = () => {
    const selectorCourses = Array.isArray(course.courseSelector?.courses)
      ? course.courseSelector.courses
      : [];
    const seenCourseIds = new Set();
    const seenStorageKeys = new Set();
    return selectorCourses.flatMap((record) => {
      if (!record || typeof record !== "object") return [];
      const id = String(record.id || "").trim();
      const storageKey = String(record.storage?.learningPerformance || "").trim();
      if (
        !/^[a-z0-9-]{1,64}$/u.test(id)
        || !performanceStoragePattern.test(storageKey)
        || seenCourseIds.has(id)
        || seenStorageKeys.has(storageKey)
      ) return [];
      seenCourseIds.add(id);
      seenStorageKeys.add(storageKey);
      const stored = performanceState(storageKey).performance;
      const performance = stored?.schemaVersion === schemaVersion
        ? normalizePerformance(stored)
        : emptyPerformance();
      const summary = summarize(performance);
      return [{
        id,
        sourceLanguageId: String(record.sourceLanguage?.id || ""),
        targetLanguageId: String(record.targetLanguage?.id || ""),
        updatedAt: performance.updatedAt,
        hasProgress: Boolean(
          summary.activities
          || summary.attempts
          || summary.successes
          || summary.xp
          || summary.rounds
        ),
        summary
      }];
    });
  };

  const summarizeCourseRows = (courses) => {
    const totals = courses.reduce((totals, courseSummary) => ({
      activities: totals.activities + courseSummary.summary.activities,
      attempts: totals.attempts + courseSummary.summary.attempts,
      successes: totals.successes + courseSummary.summary.successes,
      xp: totals.xp + courseSummary.summary.xp,
      rounds: totals.rounds + courseSummary.summary.rounds,
      activeGames: totals.activeGames + courseSummary.summary.activeGames,
      activeCourses: totals.activeCourses + (courseSummary.hasProgress ? 1 : 0)
    }), {
      activities: 0,
      attempts: 0,
      successes: 0,
      xp: 0,
      rounds: 0,
      activeGames: 0,
      activeCourses: 0
    });
    return {
      ...totals,
      accuracy: totals.attempts ? Math.round((totals.successes / totals.attempts) * 100) : null
    };
  };

  const summarizeJourney = () => summarizeCourseRows(courseSummaries());

  const snapshot = () => {
    const difficulty = readDifficulty();
    const performance = readPerformance();
    const courses = courseSummaries();
    return {
      schemaVersion,
      difficulty,
      difficultyOption: difficultyOption(difficulty),
      performance,
      summary: summarize(performance),
      journey: { summary: summarizeCourseRows(courses), courses },
      streak: refreshStreak()
    };
  };

  const announceChange = (reason) => {
    if (typeof window.CustomEvent !== "function" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new window.CustomEvent("caatuu:learning-change", {
      detail: { reason, ...snapshot() }
    }));
  };

  const setDifficulty = (value) => {
    const difficulty = normalizeDifficulty(value);
    if (difficulty === readDifficulty()) return difficulty;
    writeJson(preferenceStorageKey, { schemaVersion, difficulty });
    announceChange("difficulty");
    return difficulty;
  };

  const record = (gameId, delta = {}) => {
    const id = canonicalPerformanceGameId(gameId);
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return snapshot();
    const entry = { schemaVersion: 1, id: uniqueId(), generation: performanceState().generation,
      gameId: id, at: new Date().toISOString(), delta: {
        activities: safeCount(delta.activities), attempts: safeCount(delta.attempts),
        successes: safeCount(delta.successes), xp: safeCount(delta.xp ?? delta.successes),
        rounds: safeCount(delta.rounds), streakEligible: delta.streakEligible === true
      } };
    persistEvent(entry);
    if (
      safeCount(delta.rounds)
      && (safeCount(delta.successes) || safeCount(delta.xp) || delta.streakEligible === true)
    ) updateStreakForQualification(entry.at);
    void scheduleCompaction();
    announceChange("performance");
    return snapshot();
  };

  const resetProgress = () => {
    const previous = performanceState();
    const previousContent = contentState();
    if (previous.blocked) throw new Error("Progress could not be reset safely.");
    const generation = uniqueId();
    try { window.localStorage.setItem(resetKey, generation); }
    catch (error) { reportSaveFailure(`write:${resetKey}`, error); throw error; }
    clearSaveFailure(`write:${resetKey}`);
    try {
      if (course.storage.verbMemory) removeGameState(course.storage.verbMemory);
      if (course.storage.verbMemoryLegacy) removeGameState(course.storage.verbMemoryLegacy);
      for (const entry of previous.entries) {
        window.localStorage.removeItem(`${journalPrefix}${entry.id}`);
        pendingEvents.delete(entry.id);
      }
      for (const entry of previousContent.entries) {
        window.localStorage.removeItem(`${contentJournalPrefix}${entry.id}`);
        pendingContentEvents.delete(entry.id);
      }
    } catch (error) {
      reportSaveFailure("reset-cleanup", error);
    }
    void scheduleCompaction();
    announceChange("progress-reset");
    void scheduleContentCompaction();
    return snapshot();
  };

  const registerProgressResetPreparation = (prepare) => {
    if (typeof prepare !== "function") throw new TypeError("Progress reset preparation must be a function.");
    progressResetPreparers.add(prepare);
    return () => progressResetPreparers.delete(prepare);
  };

  const prepareProgressReset = async () => {
    await Promise.all([...progressResetPreparers].map((prepare) => prepare()));
  };

  window.CaatuuLearning = Object.freeze({
    schemaVersion,
    storage: Object.freeze({ preferenceStorageKey, performanceStorageKey, streakStorageKey }),
    streakArtwork,
    streakReminderHours,
    difficultyLevels,
    difficulty: readDifficulty,
    difficultyOption,
    setDifficulty,
    performance: readPerformance,
    summarize,
    courseSummaries,
    summarizeJourney,
    snapshot,
    record,
    contentHistory,
    contentGeneration,
    recordExposure,
    refreshStreak,
    qualifyStreak,
    dueStreakReminders,
    markStreakReminderDelivered,
    setStreakRemindersEnabled,
    registerProgressResetPreparation,
    prepareProgressReset,
    saveStatus,
    retryPendingSaves,
    reportSaveFailure,
    clearSaveFailure,
    readGameState: readJson,
    writeGameState: writeJson,
    removeGameState,
    registerSaveRetry(handler) { retryHandlers.add(handler); return () => retryHandlers.delete(handler); },
    resetProgress
  });
  window.addEventListener?.("pageshow", () => { void retryPendingSaves(); });
  window.addEventListener?.("focus", () => { void retryPendingSaves(); });
  window.document?.addEventListener?.("visibilitychange", () => {
    if (window.document.visibilityState === "visible") void retryPendingSaves();
  });
  // Persistence is optional in WebView. A denial never blocks learning.
  window.document?.addEventListener?.("pointerdown", () => {
    try { void window.navigator?.storage?.persist?.().catch(() => {}); } catch { /* Optional protection. */ }
  }, { once: true });
  if (journalEntries().length) void scheduleCompaction();
})();
