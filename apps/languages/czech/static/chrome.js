(() => {
  const course = window.CaatuuCourse;
  if (!course) throw new Error("Caatuu course profile must load before shared Chrome.");

  const themeStorageKey = course.storage.theme;
  const targetLanguage = course.targetLanguage;
  const darkModeIconSrc = "/assets/icons/dark_mode.png";
  let sharedSettingsTrigger = null;
  let appFreshnessBound = false;
  const themeOptions = {
    light: { themeColor: "#f5efe5", label: "Use dark theme" },
    dark: { themeColor: "#151a18", label: "Use light theme" }
  };
  const learning = window.CaatuuLearning;
  const semanticSkillCompassAxisPack = Object.freeze({
    id: "cz-everyday-compass",
    version: "1.1.0",
    modelId: "all-minilm-l6-v2-qint8-v0.1",
    axes: Object.freeze([
      {
        id: "people",
        label: "People & feelings",
        chartLabel: "People",
        emblem: "people",
        probe: {
          locale: "en",
          revision: "1",
          text: "Talk about people, relationships, feelings, greetings, help, and personal needs in Czech."
        }
      },
      {
        id: "home-school",
        label: "Home & school",
        chartLabel: "Home & school",
        emblem: "home",
        probe: {
          locale: "en",
          revision: "1",
          text: "Handle home objects, school activities, learning, play, and everyday technology in Czech."
        }
      },
      {
        id: "food-shopping",
        label: "Food & choices",
        chartLabel: "Food & choices",
        emblem: "food",
        probe: {
          locale: "en",
          revision: "1",
          text: "Discuss food and meals, shop with money and prices, make choices, and ask politely in Czech."
        }
      },
      {
        id: "places-travel",
        label: "Places & journeys",
        chartLabel: "Places & travel",
        emblem: "journey",
        probe: {
          locale: "en",
          revision: "1",
          text: "Find places, understand directions, describe movement, and use transport safely in Czech."
        }
      },
      {
        id: "actions-abilities",
        label: "Actions & abilities",
        chartLabel: "Actions",
        emblem: "actions",
        probe: {
          locale: "en",
          revision: "1",
          text: "Describe actions, abilities, instructions, and what people or things are doing in Czech."
        }
      },
      {
        id: "time-plans",
        label: "Time & plans",
        chartLabel: "Time & plans",
        emblem: "time",
        probe: {
          locale: "en",
          revision: "1",
          text: "Tell time, describe daily routines, follow sequences, and make future plans in Czech."
        }
      },
      {
        id: "world-description",
        label: "World & description",
        chartLabel: "World",
        emblem: "world",
        probe: {
          locale: "en",
          revision: "1",
          text: "Describe animals, nature, weather, clothing, colors, and other qualities in Czech."
        }
      }
    ])
  });
  const semanticSkillCompassLayout = Object.freeze({
    width: 340,
    height: 290,
    centerX: 170,
    centerY: 145,
    radius: 80,
    emblemRadius: 112,
    labelRadius: 137,
    rings: Object.freeze([0.25, 0.5, 0.75, 1])
  });
  const semanticSkillCompassMinimumConfidence = 0.12;
  const semanticSkillCompassControllers = new WeakMap();
  const navItems = [
    {
      key: "home",
      label: "Home",
      iconSrc: "/assets/icons/home_icon.png",
      href: course.routes.home
    },
    {
      key: "games",
      label: "Games",
      iconSrc: "/assets/icons/games_icon.png",
      href: course.routes.games,
      capability: "verbs",
      view: "verbs"
    },
    {
      key: "backpack",
      label: "Backpack",
      iconSrc: "/assets/icons/backpack_icon.png",
      href: course.routes.settings
    }
  ];
  const gameNavigationStorageKey = `${course.storage.namespace || `caatuu-${course.id}`}.navigation.active-game.v1`;
  const gameNavigationQueryKey = "game";
  const gamePresentations = {
    "verb-lab": {
      title: "Verb Nebula",
      iconSrc: "/assets/planets/nebula.png",
      href: `index.html?${gameNavigationQueryKey}=verb-lab`
    },
    "word-net": {
      title: "Word World",
      iconSrc: "/assets/planets/planet_A.png",
      href: "word-net.html"
    },
    "memory-moon": {
      title: "Memory Moon",
      iconSrc: "/assets/planets/planet_C.png",
      href: `index.html?${gameNavigationQueryKey}=memory-moon`
    }
  };
  const gameIdsByTitle = new Map(
    Object.entries(gamePresentations).map(([id, presentation]) => [presentation.title, id])
  );

  function normalizeGameId(value) {
    const gameId = String(value || "").trim();
    if (gameId === "galaxy") return gameId;
    return Object.prototype.hasOwnProperty.call(gamePresentations, gameId) ? gameId : "";
  }

  function rememberActiveGame(gameId) {
    const normalizedGameId = normalizeGameId(gameId);
    if (!normalizedGameId) return;
    try {
      localStorage.setItem(gameNavigationStorageKey, normalizedGameId);
    } catch (error) {
      // Navigation remains usable when storage is unavailable.
    }
  }

  function readRememberedGame() {
    try {
      return normalizeGameId(localStorage.getItem(gameNavigationStorageKey)) || "galaxy";
    } catch (error) {
      return "galaxy";
    }
  }

  function gameNavigationHref(gameId = readRememberedGame()) {
    const normalizedGameId = normalizeGameId(gameId);
    return gamePresentations[normalizedGameId]?.href || course.routes.games;
  }

  function currentGameId() {
    if (document.querySelector(".word-net-page")) return "word-net";
    if (document.querySelector("#trainPanelVerbLab:not([hidden])")) return "verb-lab";
    if (document.querySelector("#trainPanelWordNet:not([hidden])")) return "word-net";
    if (document.querySelector("#trainPanelMemoryMoon:not([hidden])")) return "memory-moon";
    if (document.querySelector("#trainPanelGalaxy:not([hidden])")) return "galaxy";
    const title = document.querySelector(".app-header-title")?.textContent?.trim() || "";
    return gameIdsByTitle.get(title) || "";
  }

  function requestedGameId() {
    try {
      return normalizeGameId(new URL(window.location.href).searchParams.get(gameNavigationQueryKey));
    } catch (error) {
      return "";
    }
  }

  function clearRequestedGameId() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has(gameNavigationQueryKey)) return;
      url.searchParams.delete(gameNavigationQueryKey);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    } catch (error) {
      // A retained restore parameter is harmless when History is unavailable.
    }
  }

  function restoreRequestedGame() {
    const gameId = requestedGameId();
    if (!gameId || gameId === "galaxy" || document.querySelector(".word-net-page")) return;
    const panelIds = {
      "verb-lab": "trainPanelVerbLab",
      "word-net": "trainPanelWordNet",
      "memory-moon": "trainPanelMemoryMoon"
    };
    const panel = document.getElementById(panelIds[gameId]);
    const trigger = document.querySelector(`[data-train-tab="${gameId}"]`);
    if (!panel || !trigger) return;

    let attempts = 0;
    const tryRestore = () => {
      attempts += 1;
      if (panel.hidden) trigger.click();
      if (!panel.hidden) {
        rememberActiveGame(gameId);
        clearRequestedGameId();
        return;
      }
      if (attempts < 200) window.setTimeout(tryRestore, 50);
    };
    window.setTimeout(tryRestore, 0);
  }

  function bindSharedGameNavigation() {
    document.addEventListener("click", (event) => {
      const back = event.target.closest?.(".app-header-back");
      if (back && currentGameId() && currentGameId() !== "galaxy") {
        rememberActiveGame("galaxy");
      }

      const trainTarget = event.target.closest?.("[data-train-tab]");
      if (trainTarget) rememberActiveGame(trainTarget.dataset.trainTab);

      const gameNav = event.target.closest?.('[data-caatuu-bottom-nav] [data-nav-key="games"]');
      if (!gameNav) return;
      const activeGameId = currentGameId();
      if (activeGameId && activeGameId !== "galaxy") {
        rememberActiveGame(activeGameId);
        const settingsPanel = document.querySelector("#settingsPanel");
        if (settingsPanel && !settingsPanel.hidden) closeSharedSettings({ restoreFocus: false });
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (gameNav.tagName === "A") gameNav.href = gameNavigationHref();
    }, true);
  }

  function isNativeShell() {
    return window.CaatuuRuntime?.env === "android";
  }

  function normalizeTheme(theme) {
    return theme === "light" || theme === "dark" ? theme : "dark";
  }

  function readStoredTheme() {
    try {
      return normalizeTheme(localStorage.getItem(themeStorageKey));
    } catch (error) {
      return "dark";
    }
  }

  function updateThemeControls(theme) {
    document.querySelectorAll("[data-theme-option]").forEach((button) => {
      const active = button.dataset.themeOption === theme;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const darkActive = theme === "dark";
      const option = themeOptions[theme] || themeOptions.dark;
      button.dataset.themeToggle = darkActive ? "light" : "dark";
      button.classList.toggle("is-selected", darkActive);
      button.classList.remove("is-disabled");
      button.removeAttribute("disabled");
      button.removeAttribute("aria-disabled");
      button.setAttribute("aria-pressed", String(darkActive));
      button.setAttribute("aria-label", option.label);
      button.setAttribute("title", option.label);
      const icon = button.querySelector("[data-theme-toggle-icon]");
      if (icon) icon.setAttribute("src", darkModeIconSrc);
    });
  }

  function syncNativeSystemTheme(theme) {
    window.CaatuuRuntime?.appearance?.setSystemTheme?.(normalizeTheme(theme));
  }

  function applyTheme(theme, { persist = true } = {}) {
    const normalizedTheme = normalizeTheme(theme);
    document.documentElement.dataset.theme = normalizedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      themeOptions[normalizedTheme]?.themeColor || themeOptions.dark.themeColor
    );
    if (persist) {
      try {
        localStorage.setItem(themeStorageKey, normalizedTheme);
      } catch (error) {
        // Storage can be unavailable in constrained WebView contexts.
      }
    }
    updateThemeControls(normalizedTheme);
    syncNativeSystemTheme(normalizedTheme);
  }

  function toggleTheme(button) {
    applyTheme(button.dataset.themeToggle || "dark");
  }

  function learningDifficultyButtons() {
    const levels = learning?.difficultyLevels || [];
    return levels.map((option) => `
      <button type="button" data-difficulty-level="${option.level}" aria-label="${option.label} challenge badge, level ${option.level}">
        <b>${option.level}</b>
        <span>${option.label}</span>
      </button>
    `).join("");
  }

  function renderLearningControls(root = document) {
    if (!learning) return;
    const profile = learning.snapshot();
    const rewards = {
      xp: profile.summary.successes,
      coins: profile.summary.rounds
    };
    root.querySelectorAll("[data-difficulty-level]").forEach((button) => {
      const selected = Number(button.dataset.difficultyLevel) === profile.difficulty;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const description = root.querySelector("#difficultyDescription");
    if (description) description.textContent = profile.difficultyOption.summary;
    const level = root.querySelector("#difficultyLevelSummary");
    if (level) level.textContent = `Level ${profile.difficulty}`;
    const badgeName = root.querySelector("#difficultyBadgeName");
    if (badgeName) badgeName.textContent = profile.difficultyOption.label;
    const xp = root.querySelector("#courseProgressXp");
    if (xp) xp.textContent = String(rewards.xp);
    const coins = root.querySelector("#courseProgressCoins");
    if (coins) coins.textContent = String(rewards.coins);
    const activities = root.querySelector("#courseProgressActivities");
    if (activities) activities.textContent = String(profile.summary.activities);
    const accuracy = root.querySelector("#courseProgressAccuracy");
    if (accuracy) accuracy.textContent = profile.summary.accuracy === null ? "—" : `${profile.summary.accuracy}%`;
    const summary = root.querySelector("#courseProgressSummary");
    if (summary) {
      summary.textContent = profile.summary.activities
        ? `${profile.summary.rounds} completed ${profile.summary.rounds === 1 ? "round" : "rounds"} across ${profile.summary.activeGames} ${profile.summary.activeGames === 1 ? "game" : "games"}.`
        : "Your learning record will begin with the next activity.";
    }
  }

  function clampSemanticCompassValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
  }

  function semanticCompassPoint(index, count, value = 1, radius = semanticSkillCompassLayout.radius) {
    const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / count);
    const distance = radius * clampSemanticCompassValue(value);
    return {
      x: semanticSkillCompassLayout.centerX + (Math.cos(angle) * distance),
      y: semanticSkillCompassLayout.centerY + (Math.sin(angle) * distance)
    };
  }

  function semanticCompassPolygonPoints(values, radius = semanticSkillCompassLayout.radius) {
    return values.map((value, index) => {
      const point = semanticCompassPoint(index, values.length, value, radius);
      return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    }).join(" ");
  }

  function semanticCompassPercent(value) {
    return `${Math.round(clampSemanticCompassValue(value) * 100)}%`;
  }

  function semanticCompassSvgElement(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }

  function semanticCompassAxisEmblem(axis, attributes = {}) {
    const { class: extraClass = "", ...rest } = attributes;
    const svg = semanticCompassSvgElement("svg", {
      viewBox: "0 0 24 24",
      class: `skill-compass-axis-emblem is-${axis.id} ${extraClass}`.trim(),
      "data-axis-id": axis.id,
      "aria-hidden": "true",
      focusable: "false",
      ...rest
    });
    svg.append(semanticCompassSvgElement("rect", {
      class: "skill-compass-emblem-disc",
      x: 1.35,
      y: 1.35,
      width: 21.3,
      height: 21.3,
      rx: 6.2
    }));
    svg.append(semanticCompassSvgElement("rect", {
      class: "skill-compass-emblem-ring",
      x: 3.1,
      y: 3.1,
      width: 17.8,
      height: 17.8,
      rx: 4.8
    }));
    const mark = semanticCompassSvgElement("g", { class: "skill-compass-emblem-mark" });
    const add = (name, values) => mark.append(semanticCompassSvgElement(name, values));

    switch (axis.emblem) {
      case "people":
        add("path", { d: "M4.4 6.1h9.2c1.5 0 2.6 1.1 2.6 2.6v3.2c0 1.5-1.1 2.6-2.6 2.6H9l-3.1 2.4v-2.4H4.4c-1.5 0-2.6-1.1-2.6-2.6V8.7c0-1.5 1.1-2.6 2.6-2.6Z" });
        add("path", { d: "M15.3 10.7h3.1c1.5 0 2.6 1.1 2.6 2.6v2.2c0 1.5-1.1 2.6-2.6 2.6h-.8v2l-2.6-2h-2.1c-1.2 0-2.2-.8-2.5-1.9" });
        add("path", { class: "skill-compass-emblem-fill", d: "M8.9 12.5s-2.2-1.3-2.2-2.8c0-1.4 1.8-1.9 2.2-.5.4-1.4 2.2-.9 2.2.5 0 1.5-2.2 2.8-2.2 2.8Z" });
        break;
      case "home":
        add("path", { class: "skill-compass-emblem-fill", d: "m3.5 10.4 8.5-6.7 8.5 6.7-1.6 1.5L12 6.6l-6.9 5.3-1.6-1.5Z" });
        add("path", { d: "M5.8 10.6v8.7h12.4v-8.7M9.8 19.3v-5.2h4.4v5.2" });
        add("path", { d: "M7.6 13h1.3M15.1 13h1.3" });
        break;
      case "food":
        add("path", { d: "M4.2 10.2h15.6l-1.4 8.7H5.6l-1.4-8.7ZM7.1 10.2c.4-3 2.1-4.5 4.9-4.5s4.5 1.5 4.9 4.5" });
        add("path", { class: "skill-compass-emblem-fill", d: "M12 10.1c-1.8-1.7-4.6-.5-4.2 2 .5 3.2 4.2 4.8 4.2 4.8s3.7-1.6 4.2-4.8c.4-2.5-2.4-3.7-4.2-2Z" });
        add("path", { d: "M12 9.2c-.1-1.7.7-2.8 2.2-3.4" });
        break;
      case "journey":
        add("path", { d: "M11.6 4v16M8.2 20h6.8" });
        add("path", { class: "skill-compass-emblem-fill", d: "M4 6.1h11.9l2.5 2.5-2.5 2.5H4V6.1Z" });
        add("path", { class: "skill-compass-emblem-fill", d: "M20 12.6H8.1l-2.5 2.5 2.5 2.5H20v-5Z" });
        break;
      case "actions":
        add("path", { class: "skill-compass-emblem-fill", d: "m13.7 3.5-6.2 9h4.2l-1.3 8 6.2-9.2h-4.1l1.2-7.8Z" });
        add("path", { d: "M4.3 7.5h3.2M3.3 11.3h3.2M4.3 15.1h3.2" });
        break;
      case "time":
        add("rect", { x: 4.2, y: 5.4, width: 15.6, height: 14.1, rx: 2.2 });
        add("path", { d: "M4.2 9.3h15.6M8 3.7v3.5M16 3.7v3.5" });
        add("path", { class: "skill-compass-emblem-fill", d: "m8.1 14 2.5 2.5 5.4-5.4 1.3 1.4-6.7 6.6-3.8-3.8L8.1 14Z" });
        break;
      case "world":
        add("circle", { class: "skill-compass-emblem-fill", cx: 17.1, cy: 7, r: 2.2 });
        add("path", { class: "skill-compass-emblem-fill", d: "m3.7 18.8 4.6-6.5 2.6 3.3 3.4-5 6 8.2H3.7Z" });
        add("path", { d: "m8.3 12.3 1.2 1.5 1.4 1.8M14.3 10.6l1.8 2.5" });
        break;
      default:
        add("circle", { cx: 12, cy: 12, r: 4.5 });
    }
    svg.append(mark);
    return svg;
  }

  function semanticSkillCompassController(panel) {
    if (!semanticSkillCompassControllers.has(panel)) {
      semanticSkillCompassControllers.set(panel, {
        revision: 0,
        renderedRevision: -1,
        request: 0,
        loading: false,
        rendered: false,
        abortController: null
      });
    }
    return semanticSkillCompassControllers.get(panel);
  }

  function semanticSkillCompassIsVisible(panel) {
    const details = panel?.querySelector("#semanticSkillCompass");
    const stats = panel?.querySelector("#statsViewPanel");
    return Boolean(details?.open && !panel.hidden && stats && !stats.hidden);
  }

  function setSemanticSkillCompassStatus(panel, state, message, summary) {
    const details = panel.querySelector("#semanticSkillCompass");
    const body = panel.querySelector("#semanticSkillCompassBody");
    const status = panel.querySelector("#semanticSkillCompassStatus");
    const summaryState = panel.querySelector("#semanticSkillCompassSummaryState");
    const retry = panel.querySelector("#semanticSkillCompassRetry");
    const progress = panel.querySelector("#semanticSkillCompassProgress");
    if (details) details.dataset.state = state;
    if (body) body.setAttribute("aria-busy", String(state === "loading"));
    if (status) status.textContent = message;
    if (summaryState) summaryState.textContent = summary;
    if (retry) retry.hidden = state !== "error";
    if (progress && state !== "loading") progress.hidden = true;
  }

  function renderSemanticSkillCompassAxisList(panel, projectedAxes = []) {
    const list = panel.querySelector("#semanticSkillCompassAxes");
    if (!list) return;
    const projectedById = new Map(projectedAxes.map((axis) => [axis.id, axis]));
    list.replaceChildren();
    for (const axis of semanticSkillCompassAxisPack.axes) {
      const projected = projectedById.get(axis.id);
      const confidence = clampSemanticCompassValue(projected?.assessmentConfidence);
      const strengthIsReady = Number.isFinite(projected?.mastery)
        && confidence >= semanticSkillCompassMinimumConfidence;
      const item = document.createElement("li");
      item.dataset.axisId = axis.id;
      item.title = axis.probe.text;
      item.style.setProperty(
        "--axis-practice",
        projected ? semanticCompassPercent(projected.coverage) : "0%"
      );
      const heading = document.createElement("span");
      heading.className = "skill-compass-axis-heading";
      const name = document.createElement("strong");
      name.textContent = axis.label;
      heading.append(semanticCompassAxisEmblem(axis), name);

      const metrics = document.createElement("dl");
      metrics.className = "skill-compass-axis-metrics";
      const metricValues = [
        ["Practice", projected ? semanticCompassPercent(projected.coverage) : "Not mapped"],
        ["Strength", !projected
          ? "Not mapped"
          : (strengthIsReady
            ? semanticCompassPercent(projected.mastery)
            : (Number.isFinite(projected.mastery) ? "Building" : "Not assessed"))],
        ["Confidence", projected ? semanticCompassPercent(confidence) : "Not mapped"]
      ];
      for (const [label, value] of metricValues) {
        const metric = document.createElement("div");
        metric.className = `is-${label.toLowerCase()}`;
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        metric.append(term, description);
        if (label === "Practice") {
          const meter = document.createElement("span");
          meter.className = "skill-compass-axis-practice-meter";
          meter.setAttribute("aria-hidden", "true");
          metric.append(meter);
        }
        metrics.append(metric);
      }
      item.append(heading, metrics);
      list.append(item);
    }
  }

  function renderSemanticSkillCompassFrame(panel) {
    const svg = panel.querySelector("#semanticSkillCompassChart");
    if (!svg) return;
    const axisCount = semanticSkillCompassAxisPack.axes.length;
    const title = semanticCompassSvgElement("title", { id: "semanticSkillCompassChartTitle" });
    title.textContent = "Lifetime Czech skill compass";
    const description = semanticCompassSvgElement("desc", { id: "semanticSkillCompassChartDescription" });
    description.textContent = "Practice and assessed strength across seven everyday Czech topics, each marked by its own emblem.";

    const grid = semanticCompassSvgElement("g", { class: "skill-compass-grid", "aria-hidden": "true" });
    for (const ring of semanticSkillCompassLayout.rings) {
      grid.append(semanticCompassSvgElement("polygon", {
        points: semanticCompassPolygonPoints(Array(axisCount).fill(ring))
      }));
    }
    const axes = semanticCompassSvgElement("g", { class: "skill-compass-spokes", "aria-hidden": "true" });
    semanticSkillCompassAxisPack.axes.forEach((axis, index) => {
      const end = semanticCompassPoint(index, axisCount);
      axes.append(semanticCompassSvgElement("line", {
        x1: semanticSkillCompassLayout.centerX,
        y1: semanticSkillCompassLayout.centerY,
        x2: end.x.toFixed(2),
        y2: end.y.toFixed(2)
      }));
      const emblemPoint = semanticCompassPoint(index, axisCount, 1, semanticSkillCompassLayout.emblemRadius);
      axes.append(semanticCompassAxisEmblem(axis, {
        x: (emblemPoint.x - 13).toFixed(2),
        y: (emblemPoint.y - 13).toFixed(2),
        width: 26,
        height: 26
      }));
      const labelPoint = semanticCompassPoint(index, axisCount, 1, semanticSkillCompassLayout.labelRadius);
      const label = semanticCompassSvgElement("text", {
        x: labelPoint.x.toFixed(2),
        y: labelPoint.y.toFixed(2),
        "text-anchor": Math.abs(labelPoint.x - semanticSkillCompassLayout.centerX) < 4
          ? "middle"
          : (labelPoint.x < semanticSkillCompassLayout.centerX ? "end" : "start"),
        dy: "0.34em"
      });
      label.textContent = axis.chartLabel || axis.label;
      axes.append(label);
    });

    const practice = semanticCompassSvgElement("polygon", {
      class: "skill-compass-practice-shape is-hidden",
      points: semanticCompassPolygonPoints(Array(axisCount).fill(0)),
      "data-semantic-compass-practice": ""
    });
    const strength = semanticCompassSvgElement("polygon", {
      class: "skill-compass-strength-shape is-hidden",
      points: semanticCompassPolygonPoints(Array(axisCount).fill(0)),
      "data-semantic-compass-strength": ""
    });
    const strengthPoints = semanticCompassSvgElement("g", {
      class: "skill-compass-strength-points",
      "data-semantic-compass-strength-points": "",
      "aria-hidden": "true"
    });
    const center = semanticCompassSvgElement("circle", {
      class: "skill-compass-center",
      cx: semanticSkillCompassLayout.centerX,
      cy: semanticSkillCompassLayout.centerY,
      r: 2.5,
      "aria-hidden": "true"
    });
    svg.replaceChildren(title, description, grid, axes, practice, strength, strengthPoints, center);
    renderSemanticSkillCompassAxisList(panel);
    setSemanticSkillCompassStatus(
      panel,
      "idle",
      "Your saved learning evidence becomes the shape shown here.",
      "Lifetime map"
    );
  }

  function clearSemanticSkillCompassShapes(panel) {
    const axisCount = semanticSkillCompassAxisPack.axes.length;
    for (const selector of ["[data-semantic-compass-practice]", "[data-semantic-compass-strength]"]) {
      const polygon = panel.querySelector(selector);
      if (!polygon) continue;
      polygon.setAttribute("points", semanticCompassPolygonPoints(Array(axisCount).fill(0)));
      polygon.classList.add("is-hidden");
    }
    panel.querySelector("[data-semantic-compass-strength-points]")?.replaceChildren();
  }

  function renderSemanticSkillCompassEmpty(panel) {
    clearSemanticSkillCompassShapes(panel);
    renderSemanticSkillCompassAxisList(panel);
    const description = panel.querySelector("#semanticSkillCompassChartDescription");
    if (description) description.textContent = "No semantic learning evidence has been recorded yet.";
    setSemanticSkillCompassStatus(
      panel,
      "empty",
      "Play Verb Nebula or explore Word World to begin your compass.",
      "No map yet"
    );
  }

  function renderSemanticSkillCompassProjection(panel, projection) {
    const projectedById = new Map((projection?.axes || []).map((axis) => [axis.id, axis]));
    const projectedAxes = semanticSkillCompassAxisPack.axes.map((axis) => projectedById.get(axis.id) || {
      id: axis.id,
      coverage: 0,
      mastery: null,
      assessmentConfidence: 0
    });
    const practiceValues = projectedAxes.map((axis) => clampSemanticCompassValue(axis.coverage));
    const practice = panel.querySelector("[data-semantic-compass-practice]");
    if (practice) {
      practice.setAttribute("points", semanticCompassPolygonPoints(practiceValues));
      practice.classList.toggle("is-hidden", !practiceValues.some((value) => value > 0));
    }

    const strengthValues = projectedAxes.map((axis) => {
      const confidence = clampSemanticCompassValue(axis.assessmentConfidence);
      return Number.isFinite(axis.mastery) && confidence >= semanticSkillCompassMinimumConfidence
        ? clampSemanticCompassValue(axis.mastery)
        : null;
    });
    const strength = panel.querySelector("[data-semantic-compass-strength]");
    if (strength) {
      const complete = strengthValues.every((value) => value !== null);
      if (complete) strength.setAttribute("points", semanticCompassPolygonPoints(strengthValues));
      strength.classList.toggle("is-hidden", !complete);
    }
    const strengthPoints = panel.querySelector("[data-semantic-compass-strength-points]");
    if (strengthPoints) {
      strengthPoints.replaceChildren();
      strengthValues.forEach((value, index) => {
        if (value === null) return;
        const point = semanticCompassPoint(index, strengthValues.length, value);
        strengthPoints.append(semanticCompassSvgElement("circle", {
          cx: point.x.toFixed(2),
          cy: point.y.toFixed(2),
          r: 3
        }));
      });
    }

    renderSemanticSkillCompassAxisList(panel, projectedAxes);
    const practicedCount = practiceValues.filter((value) => value > 0).length;
    const strengthCount = strengthValues.filter((value) => value !== null).length;
    const description = panel.querySelector("#semanticSkillCompassChartDescription");
    if (description) {
      description.textContent = `Lifetime semantic map with practice evidence on ${practicedCount} of ${projectedAxes.length} topics and reportable strength on ${strengthCount}.`;
    }
    if (!practicedCount) {
      setSemanticSkillCompassStatus(
        panel,
        "ready",
        "Your saved evidence has not reached these topic axes yet. Keep exploring.",
        "Lifetime map"
      );
    } else if (!strengthCount) {
      setSemanticSkillCompassStatus(
        panel,
        "ready",
        "Practice is mapped. More scored activities will reveal Strength.",
        "Lifetime map"
      );
    } else if (strengthCount < projectedAxes.length) {
      setSemanticSkillCompassStatus(
        panel,
        "ready",
        "Lifetime practice is mapped. More scored activities will complete the Strength shape.",
        "Lifetime map"
      );
    } else {
      setSemanticSkillCompassStatus(
        panel,
        "ready",
        "Lifetime map ready. Topic axes can overlap and do not add to 100%.",
        "Lifetime map"
      );
    }
  }

  async function loadSemanticSkillCompass(panel, { force = false } = {}) {
    const controller = semanticSkillCompassController(panel);
    if (force) controller.revision += 1;
    if (!semanticSkillCompassIsVisible(panel) || controller.loading) return;
    if (controller.rendered && controller.renderedRevision === controller.revision) return;

    controller.loading = true;
    controller.abortController = new AbortController();
    const signal = controller.abortController.signal;
    const request = ++controller.request;
    const revision = controller.revision;
    const progress = panel.querySelector("#semanticSkillCompassProgress");
    if (progress) {
      progress.hidden = false;
      progress.removeAttribute("value");
    }
    setSemanticSkillCompassStatus(panel, "loading", "Mapping your journey...", "Mapping");

    try {
      const semanticLearning = window.CaatuuSemanticLearning;
      if (typeof semanticLearning?.readEvidence !== "function"
        || typeof semanticLearning?.projectRadar !== "function") {
        throw new Error("Semantic learning is unavailable.");
      }
      const evidence = await semanticLearning.readEvidence();
      if (request !== controller.request || signal.aborted) return;
      if (!evidence.length) {
        renderSemanticSkillCompassEmpty(panel);
        controller.rendered = true;
        controller.renderedRevision = revision;
        return;
      }
      const projection = await semanticLearning.projectRadar(semanticSkillCompassAxisPack, {
        signal,
        onProgress({ completed, total }) {
          if (request !== controller.request || signal.aborted || !progress) return;
          progress.max = Math.max(1, Number(total) || 1);
          progress.value = Math.max(0, Number(completed) || 0);
        }
      });
      if (request !== controller.request || signal.aborted) return;
      renderSemanticSkillCompassProjection(panel, projection);
      controller.rendered = true;
      controller.renderedRevision = revision;
    } catch (error) {
      if (request !== controller.request) return;
      if (error?.name !== "AbortError") {
        setSemanticSkillCompassStatus(
          panel,
          "error",
          "The compass could not be mapped just now. Your progress is still saved.",
          "Try again"
        );
        controller.rendered = true;
        controller.renderedRevision = revision;
      }
    } finally {
      if (request !== controller.request) return;
      controller.loading = false;
      controller.abortController = null;
      panel.querySelector("#semanticSkillCompassBody")?.setAttribute("aria-busy", "false");
      if (controller.renderedRevision !== controller.revision && semanticSkillCompassIsVisible(panel)) {
        Promise.resolve().then(() => loadSemanticSkillCompass(panel));
      }
    }
  }

  function pauseSemanticSkillCompass(panel) {
    const controller = semanticSkillCompassController(panel);
    const wasLoading = controller.loading;
    controller.request += 1;
    controller.loading = false;
    controller.abortController?.abort("Skill compass hidden");
    controller.abortController = null;
    panel.querySelector("#semanticSkillCompassBody")?.setAttribute("aria-busy", "false");
    const progress = panel.querySelector("#semanticSkillCompassProgress");
    if (progress) {
      progress.hidden = true;
      progress.removeAttribute("value");
    }
    if (wasLoading) {
      setSemanticSkillCompassStatus(
        panel,
        controller.rendered ? "ready" : "idle",
        controller.rendered
          ? "Your saved learning evidence changed. Open the compass to refresh."
          : "Open the compass when you want to map your saved learning evidence.",
        controller.rendered ? "Update ready" : "Open to map"
      );
    }
  }

  function bindSemanticSkillCompass(panel) {
    const details = panel.querySelector("#semanticSkillCompass");
    if (!details) return;
    renderSemanticSkillCompassFrame(panel);
    details.addEventListener("toggle", () => {
      if (details.open) void loadSemanticSkillCompass(panel);
      else pauseSemanticSkillCompass(panel);
    });
    panel.querySelector("#semanticSkillCompassRetry")?.addEventListener("click", () => {
      void loadSemanticSkillCompass(panel, { force: true });
    });
    document.addEventListener("caatuu:settings-open", () => {
      if (details.open) void loadSemanticSkillCompass(panel);
    });
    window.addEventListener("caatuu:semantic-learning-change", () => {
      const controller = semanticSkillCompassController(panel);
      controller.revision += 1;
      controller.abortController?.abort("Semantic evidence changed");
      if (semanticSkillCompassIsVisible(panel)) void loadSemanticSkillCompass(panel);
      else if (controller.rendered) {
        const summary = panel.querySelector("#semanticSkillCompassSummaryState");
        if (summary) summary.textContent = "Update ready";
      }
    });
  }

  function bindLearningControls() {
    document.addEventListener("click", async (event) => {
      const difficultyButton = event.target.closest?.("[data-difficulty-level]");
      if (difficultyButton) {
        event.preventDefault();
        learning?.setDifficulty(difficultyButton.dataset.difficultyLevel);
        renderLearningControls(document);
        const status = document.querySelector("#learningStatus");
        const selected = learning?.difficultyOption();
        if (status && selected) status.textContent = `Badge equipped: Level ${selected.level}, ${selected.label}.`;
        return;
      }

      const resetButton = event.target.closest?.("#settingsResetCourseProgress");
      if (!resetButton || !learning) return;
      event.preventDefault();
      if (!confirmButtonPress(resetButton, {
        confirmLabel: "Confirm restart",
        message: "Restart course progress? Difficulty and downloaded files will be kept."
      })) return;
      learning.resetProgress();
      await window.CaatuuSemanticLearning?.whenIdle?.();
      renderLearningControls(document);
      const status = document.querySelector("#learningStatus");
      if (status) status.textContent = "Course progress restarted. Difficulty and downloads were preserved.";
    });

    window.addEventListener("caatuu:learning-change", () => renderLearningControls(document));
  }

  function bindThemeToggle() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-theme-toggle]");
      if (!button) return;
      event.preventDefault();
      toggleTheme(button);
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-theme-option]");
      if (!button) return;
      event.preventDefault();
      applyTheme(button.dataset.themeOption);
    });
  }

  function appendNavContent(element, item) {
    const icon = document.createElement("span");
    icon.className = "app-nav-icon";
    icon.setAttribute("aria-hidden", "true");
    if (item.iconSrc) {
      const image = document.createElement("img");
      image.className = "app-nav-icon-img";
      image.src = item.iconSrc;
      image.alt = "";
      icon.append(image);
    } else {
      icon.textContent = item.icon;
    }

    const label = document.createElement("span");
    label.textContent = item.label;

    element.append(icon, label);
  }

  function navClasses(item, activeSection, isViewButton) {
    const isActive = isNavItemActive(item, activeSection);
    return [
      isViewButton ? "nav-tab" : "",
      "app-nav-item",
      isActive ? "is-active" : ""
    ].filter(Boolean).join(" ");
  }

  function isNavItemActive(item, activeSection) {
    return activeSection === item.key ||
      (activeSection === "settings" && item.key === "backpack") ||
      activeSection === item.view ||
      (activeSection === "train" && item.key === "games");
  }

  function createNavItem(item, options) {
    const useViewButton = options.viewButtons && item.view;
    const useSettingsButton = item.key === "backpack" && options.settingsTarget;
    const element = document.createElement(useViewButton || useSettingsButton ? "button" : "a");

    element.className = navClasses(item, options.activeSection, useViewButton);
    element.dataset.navKey = item.key;
    if (item.view) element.dataset.navView = item.view;
    if (element.tagName === "BUTTON") {
      element.type = "button";
      if (useViewButton) element.dataset.view = item.view;
      if (useSettingsButton) element.id = options.settingsTarget;
    } else {
      element.href = item.key === "backpack"
        ? options.settingsHref
        : item.key === "games"
          ? gameNavigationHref()
          : item.href;
    }

    appendNavContent(element, item);
    return element;
  }

  function renderBottomNav(nav) {
    const options = {
      activeSection: nav.dataset.activeSection || "",
      viewButtons: nav.dataset.viewButtons === "true",
      settingsTarget: nav.dataset.settingsTarget || "",
      settingsHref: nav.dataset.settingsHref || "index.html?settings=1"
    };
    const availableItems = navItems.filter((item) => !item.capability || course.capabilities[item.capability]);
    nav.replaceChildren(...availableItems.map((item) => createNavItem(item, options)));
  }

  function syncBottomNavActive(nav, activeSection = "") {
    const section = activeSection || nav.dataset.activeSection || "";
    nav.querySelectorAll(".app-nav-item").forEach((item) => {
      const navItem = {
        key: item.dataset.navKey || "",
        view: item.dataset.navView || ""
      };
      const active = isNavItemActive(navItem, section);
      item.classList.toggle("is-active", active);
      if (item.tagName === "BUTTON") item.setAttribute("aria-pressed", String(active));
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  function setSettingsNavActive(active) {
    document.querySelectorAll("[data-caatuu-bottom-nav]").forEach((nav) => {
      syncBottomNavActive(nav, active ? "backpack" : "");
    });
  }

  function renderLanguageSwitch(element) {
    const flag = document.createElement("img");
    flag.className = targetLanguage.flagClass;
    flag.src = targetLanguage.flagSrc;
    flag.alt = "";

    const code = document.createElement("span");
    code.className = "language-code";
    code.textContent = element.dataset.label || targetLanguage.shortCode;

    element.replaceChildren(flag, code);

    if (element.tagName === "A") {
      if (isNativeShell()) {
        element.href = "home.html";
        element.setAttribute("aria-label", "Czech");
      } else {
        element.href = element.dataset.href || element.getAttribute("href") || "/";
        element.setAttribute("aria-label", `Back to language selection from ${targetLanguage.label}`);
      }
    }
  }

  function renderAppHeader(header) {
    header.replaceChildren();

    const brand = document.createElement("a");
    brand.className = "brand-link";
    brand.href = course.routes.home;
    brand.setAttribute("aria-label", `Open ${course.workspaceLabel} home`);

    const mark = document.createElement("span");
    mark.className = "brand-mark";
    mark.setAttribute("aria-hidden", "true");

    const icon = document.createElement("img");
    icon.className = "brand-icon";
    icon.src = "icons/caatuu-czech-512.png";
    icon.alt = "";

    const screenTitle = document.createElement("strong");
    screenTitle.className = "app-header-title";
    screenTitle.hidden = true;

    const screenBack = document.createElement("a");
    screenBack.className = "app-header-back";
    screenBack.hidden = true;

    const screenCenter = document.createElement("span");
    screenCenter.className = "app-header-center";

    const language = document.createElement("a");
    language.className = "language-pill language-switch";
    language.href = course.routes.languageSelection;
    language.dataset.caatuuLanguageSwitch = "";
    language.dataset.label = targetLanguage.shortCode;

    const actions = document.createElement("span");
    actions.className = "header-actions";

    mark.append(icon);
    brand.append(mark);
    screenCenter.append(screenTitle);
    actions.append(language);
    header.append(brand, screenBack, screenCenter, actions);
    renderLanguageSwitch(language);
    updateThemeControls(readStoredTheme());

    const initialTitle = String(header.dataset.caatuuHeaderTitle || "").trim();
    if (initialTitle) {
      setHeaderTitle(initialTitle, {
        backLabel: header.dataset.caatuuHeaderBackLabel || "Back to menu",
        backHref: header.dataset.caatuuHeaderBackHref || ""
      });
    }
  }

  function setHeaderTitle(title = "", options = {}) {
    const normalizedTitle = String(title || "").trim();
    document.querySelectorAll(".app-header-center").forEach((center) => {
      const header = center.closest(".app-header");
      const element = center.querySelector(".app-header-title");
      const back = header?.querySelector(".app-header-back");
      if (!element || !back) return;

      const gameId = gameIdsByTitle.get(normalizedTitle) || "";
      const presentation = gamePresentations[gameId];
      element.replaceChildren();
      if (presentation?.iconSrc) {
        const titleIcon = document.createElement("img");
        titleIcon.className = "app-header-title-icon";
        titleIcon.src = presentation.iconSrc;
        titleIcon.alt = "";
        titleIcon.setAttribute("aria-hidden", "true");
        element.append(titleIcon);
      }
      if (normalizedTitle) {
        const titleLabel = document.createElement("span");
        titleLabel.className = "app-header-title-label";
        titleLabel.textContent = normalizedTitle;
        element.append(titleLabel);
      }
      element.hidden = !normalizedTitle;
      if (gameId) rememberActiveGame(gameId);
      if (header) {
        if (gameId) header.dataset.caatuuActiveGame = gameId;
        else delete header.dataset.caatuuActiveGame;
      }

      const backHref = String(options.backHref || "").trim();
      const rawBackLabel = String(options.backLabel || "Back to menu").trim();
      const conciseBackLabel = rawBackLabel.replace(/^[←‹]\s*/, "").trim();
      const accessibleBackLabel = /^back\b/i.test(conciseBackLabel)
        ? conciseBackLabel
        : conciseBackLabel
          ? `Back to ${conciseBackLabel.toLowerCase()}`
          : "Go back";
      back.replaceChildren();
      const backIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      backIcon.classList.add("app-header-back-icon");
      backIcon.setAttribute("viewBox", "0 0 24 24");
      backIcon.setAttribute("aria-hidden", "true");
      const backPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      backPath.setAttribute("d", "M15 5.5 8.5 12l6.5 6.5");
      backIcon.append(backPath);
      back.append(backIcon);
      back.setAttribute("aria-label", accessibleBackLabel);
      back.title = accessibleBackLabel;
      back.hidden = !normalizedTitle || !backHref;
      if (back.hidden) {
        back.removeAttribute("href");
        delete back.dataset.trainTab;
      } else {
        back.href = backHref;
        if (options.trainTab) back.dataset.trainTab = options.trainTab;
        else delete back.dataset.trainTab;
      }
      center.hidden = !normalizedTitle;
      header.classList.toggle("has-screen-title", Boolean(normalizedTitle));
    });
  }

  function renderSettingsPanel(panel) {
    panel.id = "settingsPanel";
    panel.className = "settings-backdrop app-settings-backdrop";
    panel.hidden = true;
    panel.innerHTML = `
      <section class="settings-sheet app-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" data-settings-current-view="items">
        <header class="settings-sheet-head">
          <div class="settings-title-row">
            <span class="settings-brand-mark" aria-hidden="true">
              <img src="/assets/icons/backpack_icon.png" alt="">
            </span>
            <div class="settings-title-copy">
              <p class="settings-kicker kicker" id="settingsViewKicker">Items &amp; rewards</p>
              <h2 id="settingsTitle">Backpack</h2>
            </div>
          </div>
          <a
            class="language-pill settings-language-pill language-switch"
            href="${course.routes.languageSelection}"
            data-caatuu-language-switch
            data-label="${targetLanguage.shortCode}"
          ></a>
        </header>

        <div class="settings-sheet-body" tabindex="-1">
          <section class="settings-view-panel is-active" id="itemsViewPanel" data-settings-view-panel="items" role="tabpanel" aria-labelledby="itemsViewTab">
            <section class="backpack-card side-card" aria-label="Traveler backpack">
              <header class="backpack-profile-head">
                <div class="traveler-badge" aria-label="Current traveler badge">
                  <span class="traveler-badge-level" id="difficultyLevelSummary">Level 2</span>
                  <span class="traveler-badge-emblem" aria-hidden="true">
                    <img src="/assets/icons/backpack_icon.png" alt="">
                  </span>
                  <strong id="difficultyBadgeName">Traveler</strong>
                </div>
                <div class="backpack-profile-copy">
                  <p class="settings-kicker kicker">Journey record</p>
                  <h3>Your Czech adventure</h3>
                  <p>Everything earned while exploring Caatuu travels with you here.</p>
                </div>
              </header>

              <div class="backpack-wallet" aria-label="Experience and coins">
                <div class="backpack-wallet-item backpack-wallet-xp">
                  <span class="wallet-token wallet-token-xp" aria-hidden="true">&#10022;</span>
                  <span class="wallet-copy">
                    <span>Experience</span>
                    <strong><b id="courseProgressXp">0</b> XP</strong>
                    <small>Correct answers</small>
                  </span>
                </div>
                <div class="backpack-wallet-item backpack-wallet-coins">
                  <span class="wallet-token wallet-token-coin" aria-hidden="true"></span>
                  <span class="wallet-copy">
                    <span>Coins</span>
                    <strong id="courseProgressCoins">0</strong>
                    <small>Completed rounds</small>
                  </span>
                </div>
              </div>

              <details class="badge-collection" open>
                <summary>
                  <span>
                    <small>Challenge</small>
                    <strong>Traveler badge</strong>
                  </span>
                  <small>Choose your pace</small>
                </summary>
                <div class="difficulty-setting-row">
                  <div class="difficulty-control" role="group" aria-label="Course difficulty badges">
                    ${learningDifficultyButtons()}
                  </div>
                  <p id="difficultyDescription">A balanced course profile for variety, support, and challenge.</p>
                </div>
              </details>

              <div class="learning-progress-note">
                <p id="courseProgressSummary">Your learning record will begin with the next activity.</p>
                <small>New rewards and achievements will join the backpack as the journey grows.</small>
              </div>
              <p class="learning-status" id="learningStatus" role="status" aria-live="polite" aria-atomic="true"></p>
            </section>
          </section>

          <section class="settings-view-panel" id="statsViewPanel" data-settings-view-panel="stats" role="tabpanel" aria-labelledby="statsViewTab" hidden>
            <section class="backpack-card backpack-stats-card side-card" aria-label="Learning statistics">
              <header class="backpack-section-intro">
                <img src="/assets/icons/stats_icon.png" alt="" aria-hidden="true">
                <span>
                  <span class="settings-kicker kicker">Journey record</span>
                  <strong>Learning stats</strong>
                  <small>Your lifetime practice map and measured performance.</small>
                </span>
              </header>
              <div id="backpackStatsMount">
                <div class="journey-ledger" aria-label="Journey performance">
                  <div>
                    <span>Activities</span>
                    <strong id="courseProgressActivities">0</strong>
                  </div>
                  <div>
                    <span>Accuracy</span>
                    <strong id="courseProgressAccuracy">—</strong>
                  </div>
                </div>

                <details class="skill-compass" id="semanticSkillCompass" data-state="idle" open>
                  <summary aria-controls="semanticSkillCompassBody">
                    <span class="skill-compass-summary-copy">
                      <small>Your learning shape</small>
                      <strong>Skill compass</strong>
                    </span>
                    <span class="skill-compass-summary-state" id="semanticSkillCompassSummaryState">Lifetime map</span>
                  </summary>
                  <div class="skill-compass-body" id="semanticSkillCompassBody" aria-busy="false">
                    <div class="skill-compass-map">
                      <figure class="skill-compass-figure">
                        <svg class="skill-compass-chart" id="semanticSkillCompassChart" viewBox="0 0 340 290" role="img" aria-labelledby="semanticSkillCompassChartTitle semanticSkillCompassChartDescription"></svg>
                        <figcaption class="skill-compass-legend" aria-label="Chart legend">
                          <span><i class="is-practice" aria-hidden="true"></i>Practice</span>
                          <span><i class="is-strength" aria-hidden="true"></i>Strength</span>
                        </figcaption>
                      </figure>
                      <ol class="skill-compass-axis-list" id="semanticSkillCompassAxes" aria-label="Skill compass values"></ol>
                    </div>
                    <progress class="skill-compass-progress" id="semanticSkillCompassProgress" aria-label="Skill compass mapping progress" hidden></progress>
                    <div class="skill-compass-footer">
                      <p id="semanticSkillCompassStatus" role="status" aria-live="polite" aria-atomic="true">Your saved learning evidence becomes the shape shown here.</p>
                      <button type="button" id="semanticSkillCompassRetry" hidden>Try again</button>
                    </div>
                  </div>
                </details>
              </div>
            </section>
          </section>

          <section class="settings-view-panel" id="settingsViewPanel" data-settings-view-panel="settings" role="tabpanel" aria-labelledby="settingsViewTab" hidden>
          <section class="settings-card side-card appearance-card settings-card-compact" aria-label="Appearance">
            <div class="settings-card-head side-head">
              <p class="settings-kicker kicker">Appearance</p>
              <h3>Theme</h3>
            </div>
            <div class="theme-control" role="group" aria-label="Theme">
              <button type="button" data-theme-option="light">
                <span aria-hidden="true">&#9788;</span>
                <b>Light</b>
              </button>
              <button type="button" data-theme-option="dark">
                <img class="theme-control-icon" src="/assets/icons/dark_mode.png" alt="" aria-hidden="true">
                <b>Dark</b>
              </button>
            </div>
          </section>

          <section class="settings-card side-card ai-settings-card" aria-label="Chat settings">
            <details class="settings-details">
              <summary class="settings-collapsible-summary">
                <span class="settings-summary-title">
                  <span class="settings-kicker kicker">AI</span>
                  <strong>Generation model</strong>
                </span>
                <small>controls</small>
              </summary>
              <div class="settings-details-body">
                <label class="setting-select">
                  <span>
                    <b>Model</b>
                    <small id="modelChoiceSummary">Word Sentence CZ</small>
                  </span>
                  <select id="settingsModel">
                    <option value="cstinyllama-1.2b-czech-word-sentence-001" selected>Word Sentence CZ</option>
                    <option value="qwen3-1.7b-translation-cs-en-001">Czech to English Qwen</option>
                  </select>
                </label>

                <div class="preset-control" role="group" aria-label="Generation preset">
                  <button type="button" data-preset="fast">Fast</button>
                  <button type="button" data-preset="chat">Chat</button>
                  <button type="button" data-preset="careful">Careful</button>
                </div>
                <p class="settings-summary" id="settingsSummary">Chat preset selected.</p>

                <div class="settings-grid">
                  <label class="setting-toggle">
                    <span>
                      <b>Thinking</b>
                      <small id="thinkingSupport">Runtime support checking</small>
                    </span>
                    <input id="thinkingEnabled" type="checkbox">
                  </label>

                  <label class="setting-field">
                    <span>
                      <b>Max tokens</b>
                      <output id="maxTokensValue">384</output>
                    </span>
                    <input id="maxTokens" type="range" min="64" max="1024" step="32" value="384">
                  </label>

                  <label class="setting-field">
                    <span>
                      <b>Temperature</b>
                      <output id="temperatureValue">0.2</output>
                    </span>
                    <input id="temperature" type="range" min="0" max="1" step="0.1" value="0.2">
                    <small id="temperatureSupport">Saved for the model runtime</small>
                  </label>

                  <label class="setting-select">
                    <span>
                      <b>Context</b>
                      <small id="contextSupport">Saved for native runtime</small>
                    </span>
                    <select id="contextSize">
                      <option value="768">768 tokens</option>
                      <option value="1024">1024 tokens</option>
                      <option value="2048" selected>2048 tokens</option>
                      <option value="4096">4096 tokens</option>
                      <option value="8192">8192 tokens</option>
                    </select>
                  </label>

                  <label class="setting-select">
                    <span>
                      <b>Reasoning display</b>
                      <small>Visible output</small>
                    </span>
                    <select id="reasoningDisplay">
                      <option value="collapsed" selected>Collapsed</option>
                      <option value="expanded">Expanded</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </label>
                </div>
                <p class="capability-note" id="capabilityNote">These settings are shared across Caatuu screens.</p>
              </div>
            </details>
            <details class="settings-details developer-tools-details">
              <summary class="settings-collapsible-summary">
                <span class="settings-summary-title">
                  <span class="settings-kicker kicker">Developer</span>
                  <strong>Developer tools</strong>
                </span>
              </summary>
              <div class="settings-details-body">
                <nav class="advanced-link-list" aria-label="Developer tools">
                  <a class="advanced-link" href="chat.html?advanced=debug-chat">debug-chat</a>
                  <a class="advanced-link" href="index.html?advanced=${course.id}-dictionary&amp;view=dictionary">${course.id}-dictionary</a>
                  <a class="advanced-link" href="embedding-images.html">embedding-images</a>
                  <a class="advanced-link" href="verb-difficulty.html">verb-difficulty</a>
                </nav>
              </div>
            </details>
          </section>

          <section class="settings-card side-card maintenance-card" aria-label="App settings">
            <div class="settings-card-head side-head">
              <p class="settings-kicker kicker">App</p>
              <h3>Course and storage</h3>
            </div>
            <dl class="meta-list course-meta">
              <div>
                <dt>Course</dt>
                <dd>${course.sourceLanguage.label} to ${targetLanguage.label}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>${course.workspaceLabel}</dd>
              </div>
            </dl>
            <div class="maintenance-action-list">
              <div class="maintenance-action-row">
                <span class="maintenance-action-copy">
                  <strong>Cache</strong>
                  <small>Remove temporary files. Course progress stays saved.</small>
                </span>
                <button class="maintenance-row-control settings-cache-action" type="button" id="clearCache">Clear</button>
              </div>
              <div class="maintenance-action-row">
                <span class="maintenance-action-copy">
                  <strong>Course progress</strong>
                  <small>Clear the learning record and start again. Difficulty stays saved.</small>
                </span>
                <button class="maintenance-row-control settings-danger-action course-reset-action" type="button" id="settingsResetCourseProgress">Restart</button>
              </div>
            </div>
            <div class="maintenance-install-row" id="browserInstallActions">
              <span class="maintenance-action-copy">
                <strong>Install</strong>
                <small id="pwaInstallStatus">Browser</small>
              </span>
              <span class="maintenance-install-actions">
                <button class="pwa-install-action" type="button" id="installPwaAction" disabled>Browser</button>
                <a class="pwa-install-action android-install-action" id="installAndroidAction" aria-disabled="true">Checking</a>
              </span>
            </div>
            <p class="pwa-install-help" id="pwaInstallHelp" hidden>Use the browser menu and choose Install app or Add to Home screen.</p>
          </section>

          <section class="settings-card side-card about-card" aria-label="About">
            <div class="settings-card-head side-head">
              <p class="settings-kicker kicker">About</p>
              <h3>Details</h3>
            </div>
            <section class="about-update-region" aria-label="Version and updates">
              <div class="about-update-head">
                <p class="settings-kicker kicker">Caatuu app</p>
                <h4>Version and updates</h4>
              </div>
              <div class="version-refresh-row">
                <p class="version-note" id="settingsVersion" data-fallback-version="Version check pending">Version check pending</p>
                <button class="maintenance-row-control browser-refresh-action" type="button" id="refreshBrowserAction">Update</button>
              </div>
              <div class="maintenance-action-row maintenance-update-row" data-maintenance-action-row hidden>
                <span class="maintenance-action-copy">
                  <strong>Android update</strong>
                  <small data-update-app-copy>Check the installed version against the Android update channel.</small>
                </span>
                <button class="maintenance-row-control pwa-install-action" type="button" id="updateApp" aria-describedby="maintenanceStatus" hidden>Check for updates</button>
              </div>
              <p class="maintenance-status" id="maintenanceStatus" role="status" aria-live="polite" aria-atomic="true"></p>
            </section>
            <dialog class="settings-update-dialog" id="appUpdateConfirmDialog" aria-labelledby="appUpdateConfirmTitle" aria-describedby="appUpdateConfirmVersions appUpdateConfirmNote">
              <form class="settings-update-dialog-card" method="dialog">
                <p class="settings-kicker kicker">App update</p>
                <h3 id="appUpdateConfirmTitle">Install Caatuu update?</h3>
                <p id="appUpdateConfirmVersions">Version information is loading.</p>
                <p class="settings-update-dialog-note" id="appUpdateConfirmNote">Caatuu will open Setup, lock the other sections, download the verified APK, and then open Android's installer.</p>
                <div class="settings-update-dialog-actions">
                  <button type="submit" value="cancel">Not now</button>
                  <button class="is-primary" id="appUpdateConfirmAction" type="submit" value="confirm">Continue to Setup</button>
                </div>
              </form>
            </dialog>
            <p class="about-brand-note">Caatuu is a language-learning project from <a href="https://www.waajacu.com/" rel="noopener">Waajacu<sup class="brand-trademark" aria-hidden="true">™</sup></a>.</p>
            <p class="version-note">Development preview. A governed public beta has not been declared.</p>
            <div class="legal-notice" role="note">
              <span class="legal-notice-icon" aria-hidden="true">!</span>
              <div>
                <strong>AI learning assistant</strong>
                <p>You are interacting with an AI system. Its locally generated responses may be wrong. Use Caatuu for language practice; do not use it for professional, legal, medical, financial, or safety decisions.</p>
              </div>
            </div>
            <details class="settings-details model-details legal-details">
              <summary class="settings-collapsible-summary">
                <span class="settings-summary-title">
                  <span class="settings-kicker kicker">Legal</span>
                  <strong>Licenses</strong>
                </span>
                <small id="licenseMetaSummary">Component-specific terms</small>
              </summary>
              <div class="settings-details-body">
                <div class="license-copy">
                  <p>Caatuu's first-party software is licensed AGPL-3.0-only and is provided without warranty. <a href="https://github.com/savethebeesandseeds/caatuu" rel="noopener">View the corresponding source and license</a>. Models, dictionaries, datasets, artwork, branding, and third-party components keep their separate terms.</p>
                  <p class="license-link-row"><a href="https://github.com/savethebeesandseeds/caatuu/blob/main/docs/PRIVACY.md" rel="noopener">Privacy</a> · <a href="https://github.com/savethebeesandseeds/caatuu/blob/main/.github/SECURITY.md" rel="noopener">Security</a> · <a href="https://github.com/savethebeesandseeds/caatuu/blob/main/.github/SUPPORT.md" rel="noopener">Support</a> · <a href="https://github.com/savethebeesandseeds/caatuu/blob/main/docs/PRODUCT_READINESS.md" rel="noopener">Product status</a></p>
                </div>
                <dl class="meta-list model-license-list" id="modelLicenseList">
                  <div>
                    <dt>Word Sentence CZ</dt>
                    <dd>Base model: BUT-FIT/CSTinyLlama-1.2B, Apache-2.0. Derived artifact review pending.</dd>
                  </div>
                  <div>
                    <dt>Czech to English</dt>
                    <dd>Base model: Qwen/Qwen3-1.7B, Apache-2.0. Derived artifact review pending.</dd>
                  </div>
                  <div>
                    <dt>Caatuu Curriculum and Asset Embeddings</dt>
                    <dd>all-MiniLM-L6-v2 base model, Apache-2.0. Curriculum and asset provenance review pending; embeds English text only.</dd>
                  </div>
                </dl>
              </div>
            </details>
          </section>
          </section>

          <footer class="settings-sheet-footer">
            <a class="footer-brand settings-footer-brand" href="https://www.waajacu.com/" rel="noopener">
              <img class="footer-logo" src="icons/caatuu-czech-512.png" alt="">
              <span>by Waajacu<sup class="brand-trademark" aria-hidden="true">™</sup></span>
            </a>
          </footer>
        </div>
        <nav class="settings-section-switcher" role="tablist" aria-label="Backpack sections">
          <button class="is-active" type="button" role="tab" id="itemsViewTab" data-settings-view="items" aria-controls="itemsViewPanel" aria-selected="true">
            <img src="/assets/icons/items_icon.png?v=items-2" alt="" aria-hidden="true">
            <span>Items</span>
          </button>
          <button type="button" role="tab" id="statsViewTab" data-settings-view="stats" aria-controls="statsViewPanel" aria-selected="false">
            <img src="/assets/icons/stats_icon.png" alt="" aria-hidden="true">
            <span>Stats</span>
          </button>
          <button type="button" role="tab" id="settingsViewTab" data-settings-view="settings" aria-controls="settingsViewPanel" aria-selected="false">
            <img src="/assets/icons/gear_icon.png" alt="" aria-hidden="true">
            <span>Settings</span>
          </button>
        </nav>
      </section>
    `;
    bindSettingsReport(panel);
    bindBrowserRefresh(panel);
    bindAndroidInstallDiscovery(panel);
    bindSemanticSkillCompass(panel);
    renderLearningControls(panel);
    setSettingsView(panel, "items");
  }

  function setSettingsView(panel, requestedView = "items") {
    if (!panel) return;
    const view = ["items", "stats", "settings"].includes(requestedView) ? requestedView : "items";
    if (view !== "stats") pauseSemanticSkillCompass(panel);
    const sheet = panel.querySelector(".settings-sheet");
    if (sheet) sheet.dataset.settingsCurrentView = view;
    panel.querySelectorAll("[data-settings-view]").forEach((button) => {
      const active = button.dataset.settingsView === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    panel.querySelectorAll("[data-settings-view-panel]").forEach((viewPanel) => {
      const active = viewPanel.dataset.settingsViewPanel === view;
      viewPanel.classList.toggle("is-active", active);
      viewPanel.hidden = !active;
    });
    const kicker = panel.querySelector("#settingsViewKicker");
    if (kicker) {
      kicker.textContent = {
        items: "Items & rewards",
        stats: "Learning stats",
        settings: "App controls"
      }[view];
    }
    const body = panel.querySelector(".settings-sheet-body");
    if (body) body.scrollTop = 0;
    if (view === "stats") void loadSemanticSkillCompass(panel);
  }

  function validAndroidChannelManifest(channel, manifest) {
    if (manifest?.package_name !== "com.waajacu.caatuu") return false;
    if (channel.kind === "preview") {
      return manifest.build_type === "debug" && manifest.debuggable === true;
    }
    return manifest.build_type === "release" && manifest.debuggable === false;
  }

  async function bindAndroidInstallDiscovery(panel) {
    const action = panel.querySelector("#installAndroidAction");
    const status = panel.querySelector("#pwaInstallStatus");
    if (!action || window.CaatuuRuntime?.env === "android") return;

    const channels = [
      { kind: "release", manifest: "/android/caatuu.json", artifact: "/android/caatuu.apk" },
      { kind: "preview", manifest: "/android/caatuu-preview.json", artifact: "/android/caatuu-preview.apk" }
    ];
    const request = Number(panel.dataset.androidInstallRequest || 0) + 1;
    panel.dataset.androidInstallRequest = String(request);
    if (panel.dataset.androidInstallRefreshBound !== "true") {
      panel.dataset.androidInstallRefreshBound = "true";
      document.addEventListener("caatuu:settings-open", () => bindAndroidInstallDiscovery(panel));
    }
    action.removeAttribute("href");
    action.removeAttribute("download");
    action.removeAttribute("role");
    action.removeAttribute("tabindex");
    action.setAttribute("aria-disabled", "true");
    action.dataset.state = "checking";
    action.textContent = "Checking";

    for (const channel of channels) {
      try {
        const manifestUrl = new URL(channel.manifest, window.location.origin);
        manifestUrl.searchParams.set("caatuu_check", `${channel.kind}-${Date.now()}`);
        const response = await fetch(`${manifestUrl.pathname}${manifestUrl.search}`, { cache: "no-store" });
        if (!response.ok) continue;
        const manifest = await response.json();
        if (request !== Number(panel.dataset.androidInstallRequest)) return;
        if (!validAndroidChannelManifest(channel, manifest)) continue;
        const artifactUrl = new URL(channel.artifact, window.location.origin);
        const release = manifest.version_code || manifest.version_name || String(manifest.sha256 || "").slice(0, 16);
        if (release) artifactUrl.searchParams.set("caatuu_release", String(release));
        action.href = `${artifactUrl.pathname}${artifactUrl.search}`;
        action.setAttribute("download", "");
        action.removeAttribute("aria-disabled");
        action.removeAttribute("role");
        action.removeAttribute("tabindex");
        action.dataset.state = "available";
        action.onclick = null;
        action.onkeydown = null;
        action.textContent = channel.kind === "preview" ? "Preview" : "Android";
        if (status) status.textContent = channel.kind === "preview"
          ? "Browser · Android preview available"
          : "Browser · Android release available";
        return;
      } catch (error) {
        // Try the next explicitly supported channel.
      }
    }

    if (request !== Number(panel.dataset.androidInstallRequest)) return;
    action.removeAttribute("href");
    action.removeAttribute("download");
    action.removeAttribute("aria-disabled");
    action.setAttribute("role", "button");
    action.setAttribute("tabindex", "0");
    action.dataset.state = "retry";
    action.textContent = "Check again";
    action.onclick = (event) => {
      event.preventDefault();
      bindAndroidInstallDiscovery(panel);
    };
    action.onkeydown = (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      bindAndroidInstallDiscovery(panel);
    };
    if (status) status.textContent = "Browser · Android temporarily unavailable";
  }

  function bindBrowserRefresh(panel) {
    const button = panel.querySelector("#refreshBrowserAction");
    if (!button) return;
    button.hidden = window.CaatuuRuntime?.env === "android";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Updating";
      try {
        const updateBrowserApp = window.CaatuuRuntime?.maintenance?.updateApp;
        if (typeof updateBrowserApp === "function") {
          const result = await updateBrowserApp();
          if (!result?.reloaded) {
            button.disabled = false;
            button.textContent = result?.offline ? "Retry" : "Update";
          }
          return;
        }
        const registration = await navigator.serviceWorker?.getRegistration?.();
        await registration?.update?.();
      } catch (error) {
        // The compatibility fallback below still reloads same-origin files.
      }
      window.location.reload();
    });
  }

  function openSharedSettings() {
    const panel = document.querySelector("#settingsPanel");
    if (!panel) return;
    sharedSettingsTrigger = document.activeElement;
    setSettingsView(panel, "items");
    panel.hidden = false;
    document.body.classList.add("settings-open");
    setSettingsNavActive(true);
    document.dispatchEvent(new CustomEvent("caatuu:settings-open"));
    panel.querySelector(".settings-sheet-body")?.focus?.();
  }

  function closeSharedSettings({ restoreFocus = true } = {}) {
    const panel = document.querySelector("#settingsPanel");
    if (!panel) return;
    pauseSemanticSkillCompass(panel);
    panel.hidden = true;
    document.body.classList.remove("settings-open");
    setSettingsNavActive(false);
    if (restoreFocus && typeof sharedSettingsTrigger?.focus === "function") sharedSettingsTrigger.focus();
  }

  function bindSharedSettingsPanel() {
    document.addEventListener("click", (event) => {
      const settingsView = event.target.closest?.("[data-settings-view]");
      if (settingsView) {
        const panel = settingsView.closest("#settingsPanel");
        if (panel) {
          event.preventDefault();
          setSettingsView(panel, settingsView.dataset.settingsView);
          return;
        }
      }
      const open = event.target.closest?.("#openSettings");
      if (open && document.querySelector("#settingsPanel")) {
        event.preventDefault();
        openSharedSettings();
        return;
      }
      const panel = document.querySelector("#settingsPanel");
      const navigationAction = event.target.closest?.("[data-caatuu-bottom-nav] a, [data-caatuu-bottom-nav] button");
      if (navigationAction && navigationAction.id !== "openSettings" && panel && !panel.hidden) {
        closeSharedSettings({ restoreFocus: false });
        return;
      }
      const advancedLink = event.target.closest?.(".advanced-link");
      if (advancedLink && panel && !panel.hidden) {
        closeSharedSettings({ restoreFocus: false });
        return;
      }
      if (event.target === document.querySelector("#settingsPanel")) closeSharedSettings();
    });
    document.addEventListener("keydown", (event) => {
      const currentView = event.target.closest?.(".settings-section-switcher [data-settings-view]");
      if (currentView) {
        const tabs = Array.from(currentView.parentElement?.querySelectorAll("[data-settings-view]") || []);
        const currentIndex = tabs.indexOf(currentView);
        let nextIndex = -1;
        if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        if (nextIndex >= 0) {
          event.preventDefault();
          const nextView = tabs[nextIndex];
          const viewPanel = nextView.closest("#settingsPanel");
          setSettingsView(viewPanel, nextView.dataset.settingsView);
          nextView.focus();
          return;
        }
      }
      const panel = document.querySelector("#settingsPanel");
      if (event.key === "Escape" && panel && !panel.hidden) closeSharedSettings();
    });
  }

  function clampReportText(value, maxLength = 600) {
    const text = String(value ?? "").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function settingsReportPayload(comment) {
    const versionText = document.querySelector("#settingsVersion")?.textContent?.trim() || "";
    const maintenanceText = document.querySelector("#maintenanceStatus")?.textContent?.trim() || "";
    const activeNav = document.querySelector("[data-caatuu-bottom-nav] .is-active")?.dataset?.navKey || "";
    return {
      kind: "settings_report",
      title: "Settings report",
      message: clampReportText(comment || "User submitted a settings report without a comment."),
      app: {
        versionText: clampReportText(versionText, 120),
        runtime: window.CaatuuRuntime?.env || "unknown",
        location: clampReportText(window.location.href, 320),
        activeNav: clampReportText(activeNav, 40)
      },
      device: {
        userAgent: clampReportText(navigator.userAgent, 360),
        platform: clampReportText(navigator.platform || "", 80),
        language: clampReportText(navigator.language || "", 32),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        screen: window.screen ? `${window.screen.width}x${window.screen.height}` : ""
      },
      events: [
        {
          kind: "settings",
          title: "Maintenance status",
          detail: clampReportText(maintenanceText, 320),
          time: new Date().toISOString()
        }
      ]
    };
  }

  function bindSettingsReport(panel) {
    const toggleButton = panel.querySelector("#settingsReportToggle");
    const reportPanel = panel.querySelector("#settingsReportPanel");
    const reportButton = panel.querySelector("#settingsReportBug");
    const reportComment = panel.querySelector("#settingsBugComment");
    const reportStatus = panel.querySelector("#settingsReportStatus");
    if (!reportButton || !reportComment || !reportStatus) return;

    toggleButton?.addEventListener("click", () => {
      if (!reportPanel) return;
      const nextOpen = reportPanel.hidden;
      reportPanel.hidden = !nextOpen;
      toggleButton.setAttribute("aria-expanded", String(nextOpen));
      toggleButton.textContent = nextOpen ? "Close" : "Report";
      if (nextOpen) reportComment.focus();
    });

    reportButton.addEventListener("click", async () => {
      if (reportButton.disabled) return;
      const runtime = window.CaatuuRuntime;
      if (!runtime?.maintenance?.reportBug) {
        reportStatus.textContent = "Report service is not available.";
        return;
      }

      reportButton.disabled = true;
      reportButton.textContent = "Sending";
      reportStatus.textContent = "Preparing report.";
      try {
        const result = await runtime.maintenance.reportBug(settingsReportPayload(reportComment.value));
        if (result?.ok === false) throw new Error(result.message || "Could not send report.");
        const reportId = result?.report_id || result?.reportId || "saved";
        reportStatus.textContent = `Report sent: ${reportId}`;
        reportComment.value = "";
        if (reportPanel && toggleButton) {
          reportPanel.hidden = true;
          toggleButton.setAttribute("aria-expanded", "false");
          toggleButton.textContent = "Report";
        }
      } catch (error) {
        reportStatus.textContent = error?.message || "Could not send report.";
      } finally {
        reportButton.disabled = false;
        reportButton.textContent = "Send report";
      }
    });
  }

  function resetConfirmButton(button) {
    if (!button) return;
    if (button._caatuuConfirmTimer) {
      window.clearTimeout(button._caatuuConfirmTimer);
      button._caatuuConfirmTimer = null;
    }
    if (button.dataset.confirmOriginalLabel) {
      button.textContent = button.dataset.confirmOriginalLabel;
    }
    if (button.dataset.confirmOriginalAriaLabel) {
      button.setAttribute("aria-label", button.dataset.confirmOriginalAriaLabel);
    } else {
      button.removeAttribute("aria-label");
    }
    button.classList.remove("is-confirming");
    delete button.dataset.confirmArmed;
    delete button.dataset.confirmOriginalLabel;
    delete button.dataset.confirmOriginalAriaLabel;
  }

  function confirmButtonPress(button, options = {}) {
    if (!button) return true;
    if (button.dataset.confirmArmed === "true") {
      resetConfirmButton(button);
      return true;
    }

    button.dataset.confirmArmed = "true";
    button.dataset.confirmOriginalLabel = button.textContent;
    button.dataset.confirmOriginalAriaLabel = button.getAttribute("aria-label") || "";
    button.textContent = options.confirmLabel || "Press again";
    button.classList.add("is-confirming");
    if (options.message) button.setAttribute("aria-label", options.message);
    button._caatuuConfirmTimer = window.setTimeout(() => {
      resetConfirmButton(button);
    }, options.timeoutMs || 6500);
    return false;
  }

  function handleAndroidBack() {
    const settingsPanel = document.querySelector("#settingsPanel, [data-caatuu-settings-panel]");
    if (settingsPanel && !settingsPanel.hidden) {
      closeSharedSettings({ restoreFocus: false });
      return true;
    }

    const back = document.querySelector(".app-header-back:not([hidden])");
    if (!back?.getAttribute("href")) return false;
    back.click();
    return true;
  }

  function ensureAppFreshnessNotice() {
    let notice = document.querySelector("#appFreshnessNotice");
    if (notice || !document.body) return notice;
    notice = document.createElement("aside");
    notice.id = "appFreshnessNotice";
    notice.className = "app-freshness-notice";
    notice.hidden = true;
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.setAttribute("aria-atomic", "true");
    const message = document.createElement("span");
    message.dataset.freshnessMessage = "";
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.freshnessAction = "";
    action.addEventListener("click", async () => {
      if (action.disabled) return;
      action.disabled = true;
      const state = notice.dataset.state;
      renderAppFreshnessNotice("refreshing");
      try {
        if (state === "update-ready") {
          const result = await window.CaatuuRuntime?.maintenance?.updateApp?.();
          if (result?.offline) renderAppFreshnessNotice("offline");
        } else {
          const reachable = await window.CaatuuRuntime?.registerServiceWorker?.();
          if (!reachable) renderAppFreshnessNotice("offline");
        }
      } catch (error) {
        renderAppFreshnessNotice("offline");
      } finally {
        action.disabled = false;
      }
    });
    notice.append(message, action);
    document.body.append(notice);
    return notice;
  }

  function renderAppFreshnessNotice(state) {
    const notice = ensureAppFreshnessNotice();
    if (!notice) return;
    const message = notice.querySelector("[data-freshness-message]");
    const action = notice.querySelector("[data-freshness-action]");
    notice.dataset.state = state;
    if (["current", "checking"].includes(state)) {
      notice.hidden = true;
      return;
    }
    notice.hidden = false;
    if (state === "offline") {
      if (message) message.textContent = "Offline copy — the latest Caatuu version cannot be checked yet.";
      if (action) {
        action.hidden = false;
        action.textContent = "Retry";
      }
      return;
    }
    if (state === "update-ready") {
      if (message) message.textContent = "A newer Caatuu version is ready.";
      if (action) {
        action.hidden = false;
        action.textContent = "Refresh";
      }
      return;
    }
    if (message) message.textContent = "Loading the latest Caatuu version...";
    if (action) action.hidden = true;
  }

  function bindAppFreshness() {
    if (appFreshnessBound || window.CaatuuRuntime?.env !== "browser") return;
    appFreshnessBound = true;
    window.addEventListener("caatuu:app-freshness", (event) => {
      renderAppFreshnessNotice(String(event?.detail?.state || "checking"));
    });
    void window.CaatuuRuntime.registerServiceWorker().then((reachable) => {
      if (!reachable) renderAppFreshnessNotice("offline");
    });
  }

  function initChrome() {
    applyTheme(readStoredTheme(), { persist: false });
    document.querySelectorAll(".app-header").forEach(renderAppHeader);
    document.querySelectorAll("#settingsPanel, [data-caatuu-settings-panel]").forEach(renderSettingsPanel);
    document.querySelectorAll("[data-caatuu-bottom-nav]").forEach(renderBottomNav);
    document.querySelectorAll("[data-caatuu-language-switch]").forEach(renderLanguageSwitch);
    restoreRequestedGame();
    bindAppFreshness();
  }

  window.CaatuuChrome = {
    renderAppHeader,
    renderBottomNav,
    renderLanguageSwitch,
    renderSettingsPanel,
    setHeaderTitle,
    setSettingsNavActive,
    confirmButtonPress,
    resetConfirmButton,
    openSharedSettings,
    closeSharedSettings,
    handleAndroidBack
  };

  const chromeTargetsReady = () =>
    Boolean(document.querySelector(".app-header, #settingsPanel, [data-caatuu-settings-panel], [data-caatuu-bottom-nav], [data-caatuu-language-switch]"));

  if (document.readyState === "loading" && !chromeTargetsReady()) {
    document.addEventListener("DOMContentLoaded", initChrome);
  } else {
    initChrome();
  }

  bindThemeToggle();
  bindLearningControls();
  bindSharedGameNavigation();
  bindSharedSettingsPanel();
})();
