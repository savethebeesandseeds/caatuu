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

  const readJson = (key) => {
    try {
      return JSON.parse(window.localStorage.getItem(key) || "null");
    } catch (error) {
      return null;
    }
  };

  const writeJson = (key, value) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
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
      performance.games[gameId] = normalizeGamePerformance(game);
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

  const readPerformance = () => {
    const stored = readJson(performanceStorageKey);
    if (stored?.schemaVersion === schemaVersion) return normalizePerformance(stored);
    const migrated = migrateLegacyPerformance();
    if (Object.keys(migrated.games).length) writeJson(performanceStorageKey, migrated);
    return migrated;
  };

  const readDifficulty = () => normalizeDifficulty(readJson(preferenceStorageKey)?.difficulty);

  const difficultyOption = (level = readDifficulty()) => (
    difficultyLevels.find((option) => option.level === normalizeDifficulty(level)) || difficultyLevels[0]
  );

  const summarize = (performance = readPerformance()) => {
    const totals = Object.values(performance.games).reduce((summary, game) => ({
      activities: summary.activities + game.activities,
      attempts: summary.attempts + game.attempts,
      successes: summary.successes + game.successes,
      xp: summary.xp + game.xp,
      rounds: summary.rounds + game.rounds
    }), { activities: 0, attempts: 0, successes: 0, xp: 0, rounds: 0 });
    return {
      ...totals,
      accuracy: totals.attempts ? Math.round((totals.successes / totals.attempts) * 100) : null,
      activeGames: Object.values(performance.games).filter((game) => game.activities || game.rounds).length
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
      const stored = storageKey === performanceStorageKey
        ? readPerformance()
        : readJson(storageKey);
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
    writeJson(preferenceStorageKey, { schemaVersion, difficulty });
    announceChange("difficulty");
    return difficulty;
  };

  const record = (gameId, delta = {}) => {
    const id = String(gameId || "").trim();
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return snapshot();
    const performance = readPerformance();
    const current = normalizeGamePerformance(performance.games[id]);
    const next = {
      activities: current.activities + safeCount(delta.activities),
      attempts: current.attempts + safeCount(delta.attempts),
      successes: current.successes + safeCount(delta.successes),
      xp: current.xp + safeCount(delta.xp ?? delta.successes),
      rounds: current.rounds + safeCount(delta.rounds),
      lastPlayedAt: new Date().toISOString()
    };
    performance.games[id] = next;
    performance.updatedAt = next.lastPlayedAt;
    writeJson(performanceStorageKey, performance);
    if (
      safeCount(delta.rounds)
      && (safeCount(delta.successes) || safeCount(delta.xp) || delta.streakEligible === true)
    ) updateStreakForQualification(next.lastPlayedAt);
    announceChange("performance");
    return snapshot();
  };

  const resetProgress = () => {
    try {
      window.localStorage.removeItem(performanceStorageKey);
      if (course.storage.verbMemory) window.localStorage.removeItem(course.storage.verbMemory);
      if (course.storage.verbMemoryLegacy) window.localStorage.removeItem(course.storage.verbMemoryLegacy);
    } catch (error) {
      // In-memory game state can still respond to the reset event.
    }
    writeJson(performanceStorageKey, emptyPerformance());
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
    resetProgress
  });
})();
