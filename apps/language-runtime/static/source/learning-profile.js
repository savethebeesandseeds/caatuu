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
      const value = JSON.parse(raw || "null");
      if (value && typeof value.schemaVersion === "number" && value.schemaVersion > maximumVersion) {
        damagedValues.set(key, { raw, future: true });
        throw new Error("Progress was saved by a newer app version.");
      }
      if (value !== null && gameStateValidators.has(key) && !gameStateValidators.get(key)(value)) {
        throw new Error("Stored game progress needs recovery.");
      }
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
      if (performanceStoragePattern.test(key) || pendingValues.has(key)) continue;
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
    const retries = await Promise.allSettled([...retryHandlers].map((handler) => Promise.resolve().then(handler)));
    const failed = retries.find((result) => result.status === "rejected");
    if (failed) reportSaveFailure("retry", failed.reason);
    else clearSaveFailure("retry");
    return saveStatus();
  };

  const readDifficulty = () => normalizeDifficulty(readJson(preferenceStorageKey)?.difficulty);

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
    } catch (error) {
      reportSaveFailure("reset-cleanup", error);
    }
    void scheduleCompaction();
    announceChange("progress-reset");
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
