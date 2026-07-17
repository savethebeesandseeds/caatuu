(() => {
  const course = window.CaatuuCourse;
  if (!course) throw new Error("Caatuu course profile must load before the learning profile.");

  const namespace = course.storage.namespace || `caatuu-${course.id}`;
  const preferenceStorageKey = course.storage.learningPreferences || `${namespace}.learning.preferences.v1`;
  const performanceStorageKey = course.storage.learningPerformance || `${namespace}.learning.performance.v1`;
  const schemaVersion = 1;
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
    return difficultyLevels.some((option) => option.level === level) ? level : 2;
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

  const normalizeGamePerformance = (value = {}) => ({
    activities: safeCount(value.activities),
    attempts: safeCount(value.attempts),
    successes: safeCount(value.successes),
    rounds: safeCount(value.rounds),
    lastPlayedAt: typeof value.lastPlayedAt === "string" ? value.lastPlayedAt : ""
  });

  const normalizePerformance = (value) => {
    const performance = emptyPerformance();
    if (!value || value.schemaVersion !== schemaVersion || typeof value.games !== "object") {
      return performance;
    }
    performance.updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : "";
    Object.entries(value.games).forEach(([gameId, game]) => {
      if (!/^[a-z0-9-]{1,40}$/.test(gameId)) return;
      performance.games[gameId] = normalizeGamePerformance(game);
    });
    return performance;
  };

  const migrateLegacyPerformance = () => {
    const performance = emptyPerformance();
    const legacyVerb = readJson(course.storage.verbMemory);
    const attempts = safeCount(legacyVerb?.stats?.attempts);
    const successes = safeCount(legacyVerb?.stats?.matches);
    const rounds = safeCount(legacyVerb?.stats?.rounds);
    if (attempts || successes || rounds) {
      performance.games["verb-nebula"] = {
        activities: attempts,
        attempts,
        successes,
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
    difficultyLevels.find((option) => option.level === normalizeDifficulty(level)) || difficultyLevels[1]
  );

  const summarize = (performance = readPerformance()) => {
    const totals = Object.values(performance.games).reduce((summary, game) => ({
      activities: summary.activities + game.activities,
      attempts: summary.attempts + game.attempts,
      successes: summary.successes + game.successes,
      rounds: summary.rounds + game.rounds
    }), { activities: 0, attempts: 0, successes: 0, rounds: 0 });
    return {
      ...totals,
      accuracy: totals.attempts ? Math.round((totals.successes / totals.attempts) * 100) : null,
      activeGames: Object.values(performance.games).filter((game) => game.activities || game.rounds).length
    };
  };

  const snapshot = () => {
    const difficulty = readDifficulty();
    const performance = readPerformance();
    return {
      schemaVersion,
      difficulty,
      difficultyOption: difficultyOption(difficulty),
      performance,
      summary: summarize(performance)
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
      rounds: current.rounds + safeCount(delta.rounds),
      lastPlayedAt: new Date().toISOString()
    };
    performance.games[id] = next;
    performance.updatedAt = next.lastPlayedAt;
    writeJson(performanceStorageKey, performance);
    announceChange("performance");
    return snapshot();
  };

  const resetProgress = () => {
    try {
      window.localStorage.removeItem(performanceStorageKey);
      if (course.storage.verbMemory) window.localStorage.removeItem(course.storage.verbMemory);
    } catch (error) {
      // In-memory game state can still respond to the reset event.
    }
    writeJson(performanceStorageKey, emptyPerformance());
    announceChange("progress-reset");
    return snapshot();
  };

  window.CaatuuLearning = Object.freeze({
    schemaVersion,
    storage: Object.freeze({ preferenceStorageKey, performanceStorageKey }),
    difficultyLevels,
    difficulty: readDifficulty,
    difficultyOption,
    setDifficulty,
    performance: readPerformance,
    summarize,
    snapshot,
    record,
    resetProgress
  });
})();
