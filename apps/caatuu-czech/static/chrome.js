(() => {
  const course = window.CaatuuCourse;
  if (!course) throw new Error("Caatuu course profile must load before shared Chrome.");

  const themeStorageKey = course.storage.theme;
  const targetLanguage = course.targetLanguage;
  const darkModeIconSrc = "logos/dark_mode.png";
  let sharedSettingsTrigger = null;
  const themeOptions = {
    light: { themeColor: "#f5efe5", label: "Use dark theme" },
    dark: { themeColor: "#151a18", label: "Dark theme enabled" }
  };
  const learning = window.CaatuuLearning;
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
      key: "settings",
      label: "Settings",
      iconSrc: "/assets/icons/settings_icon.png",
      href: course.routes.settings
    }
  ];
  const gameNavigationStorageKey = `${course.storage.namespace || `caatuu-${course.id}`}.navigation.active-game.v1`;
  const gameNavigationQueryKey = "game";
  const gamePresentations = {
    "verb-lab": {
      title: "Verb Nebula",
      iconSrc: "/assets/planets/nebula.png",
      href: `index.html?${gameNavigationQueryKey}=verb-lab#verbs`
    },
    "word-net": {
      title: "Word World",
      iconSrc: "/assets/planets/planet_A.png",
      href: "word-net.html"
    },
    "memory-moon": {
      title: "Memory Moon",
      iconSrc: "/assets/planets/planet_C.png",
      href: `index.html?${gameNavigationQueryKey}=memory-moon#verbs`
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
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
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
      <button type="button" data-difficulty-level="${option.level}" aria-label="Difficulty ${option.level}: ${option.label}">
        <b>${option.level}</b>
        <span>${option.label}</span>
      </button>
    `).join("");
  }

  function renderLearningControls(root = document) {
    if (!learning) return;
    const profile = learning.snapshot();
    root.querySelectorAll("[data-difficulty-level]").forEach((button) => {
      const selected = Number(button.dataset.difficultyLevel) === profile.difficulty;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const description = root.querySelector("#difficultyDescription");
    if (description) description.textContent = profile.difficultyOption.summary;
    const level = root.querySelector("#difficultyLevelSummary");
    if (level) level.textContent = `Level ${profile.difficulty} · ${profile.difficultyOption.label}`;
    const activities = root.querySelector("#courseProgressActivities");
    if (activities) activities.textContent = String(profile.summary.activities);
    const successes = root.querySelector("#courseProgressSuccesses");
    if (successes) successes.textContent = String(profile.summary.successes);
    const accuracy = root.querySelector("#courseProgressAccuracy");
    if (accuracy) accuracy.textContent = profile.summary.accuracy === null ? "—" : `${profile.summary.accuracy}%`;
    const summary = root.querySelector("#courseProgressSummary");
    if (summary) {
      summary.textContent = profile.summary.activities
        ? `${profile.summary.rounds} completed ${profile.summary.rounds === 1 ? "round" : "rounds"} across ${profile.summary.activeGames} ${profile.summary.activeGames === 1 ? "game" : "games"}.`
        : "Your learning record will begin with the next activity.";
    }
  }

  function bindLearningControls() {
    document.addEventListener("click", (event) => {
      const difficultyButton = event.target.closest?.("[data-difficulty-level]");
      if (difficultyButton) {
        event.preventDefault();
        learning?.setDifficulty(difficultyButton.dataset.difficultyLevel);
        renderLearningControls(document);
        const status = document.querySelector("#learningStatus");
        const selected = learning?.difficultyOption();
        if (status && selected) status.textContent = `Difficulty saved: Level ${selected.level}, ${selected.label}.`;
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
      activeSection === item.view ||
      (activeSection === "train" && item.key === "games");
  }

  function createNavItem(item, options) {
    const useViewButton = options.viewButtons && item.view;
    const useSettingsButton = item.key === "settings" && options.settingsTarget;
    const element = document.createElement(useViewButton || useSettingsButton ? "button" : "a");

    element.className = navClasses(item, options.activeSection, useViewButton);
    element.dataset.navKey = item.key;
    if (item.view) element.dataset.navView = item.view;
    if (element.tagName === "BUTTON") {
      element.type = "button";
      if (useViewButton) element.dataset.view = item.view;
      if (useSettingsButton) element.id = options.settingsTarget;
    } else {
      element.href = item.key === "settings"
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
      settingsHref: nav.dataset.settingsHref || "index.html#settings"
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
      syncBottomNavActive(nav, active ? "settings" : "");
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

    const labelWrap = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = course.brandLabel;

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

    const theme = document.createElement("button");
    theme.className = "theme-toggle";
    theme.type = "button";
    theme.dataset.themeToggle = "";

    const themeIcon = document.createElement("img");
    themeIcon.className = "theme-toggle-icon";
    themeIcon.dataset.themeToggleIcon = "";
    themeIcon.src = darkModeIconSrc;
    themeIcon.alt = "";
    themeIcon.setAttribute("aria-hidden", "true");

    const actions = document.createElement("span");
    actions.className = "header-actions";

    mark.append(icon);
    labelWrap.append(label);
    brand.append(mark, labelWrap);
    screenCenter.append(screenTitle);
    theme.append(themeIcon);
    actions.append(theme, language);
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
      <section class="settings-sheet app-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <header class="settings-sheet-head">
          <div class="settings-title-row">
            <span class="settings-brand-mark" aria-hidden="true">
              <img src="icons/caatuu-czech-512.png" alt="">
            </span>
            <div class="settings-title-copy">
              <p class="settings-kicker kicker">Caatuu</p>
              <h2 id="settingsTitle">Settings</h2>
            </div>
          </div>
        </header>

        <div class="settings-sheet-body">
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
                <img class="theme-control-icon" src="logos/dark_mode.png" alt="" aria-hidden="true">
                <b>Dark</b>
              </button>
            </div>
          </section>

          <section class="settings-card side-card learning-settings-card" aria-label="Difficulty and progress">
            <div class="settings-card-head side-head learning-settings-head">
              <div>
                <p class="settings-kicker kicker">Learning</p>
                <h3>Difficulty and progress</h3>
              </div>
              <small id="difficultyLevelSummary">Level 2 · Traveler</small>
            </div>
            <div class="difficulty-setting-row">
              <div class="difficulty-control" role="group" aria-label="Course difficulty">
                ${learningDifficultyButtons()}
              </div>
              <p id="difficultyDescription">A balanced course profile for variety, support, and challenge.</p>
            </div>
            <div class="course-progress-overview" aria-label="Learning performance">
              <div>
                <span>Activities</span>
                <strong id="courseProgressActivities">0</strong>
              </div>
              <div>
                <span>Correct</span>
                <strong id="courseProgressSuccesses">0</strong>
              </div>
              <div>
                <span>Accuracy</span>
                <strong id="courseProgressAccuracy">—</strong>
              </div>
            </div>
            <div class="learning-progress-note">
              <p id="courseProgressSummary">Your learning record will begin with the next activity.</p>
              <small>Achievements, rewards, and certificates can build on this course-wide record later.</small>
            </div>
            <p class="learning-status" id="learningStatus" role="status" aria-live="polite" aria-atomic="true"></p>
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
                  <a class="advanced-link" href="index.html?advanced=${course.id}-dictionary#dictionary">${course.id}-dictionary</a>
                  <a class="advanced-link" href="embedding-images.html">embedding-images</a>
                </nav>
              </div>
            </details>
          </section>

          <section class="settings-card side-card update-card" aria-label="App version and updates">
            <div class="settings-card-head side-head">
              <p class="settings-kicker kicker">Caatuu app</p>
              <h3>Version and updates</h3>
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
                <a class="pwa-install-action android-install-action" id="installAndroidAction" href="/android/caatuu.apk" download>Android</a>
              </span>
            </div>
            <p class="pwa-install-help" id="pwaInstallHelp" hidden>Use the browser menu and choose Install app or Add to Home screen.</p>
          </section>

          <section class="settings-card side-card about-card" aria-label="About">
            <div class="settings-card-head side-head">
              <p class="settings-kicker kicker">About</p>
              <h3>Details</h3>
            </div>
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

          <footer class="settings-sheet-footer">
            <a class="footer-brand settings-footer-brand" href="https://www.waajacu.com/" rel="noopener">
              <img class="footer-logo" src="icons/caatuu-czech-512.png" alt="">
              <span>by Waajacu<sup class="brand-trademark" aria-hidden="true">™</sup></span>
            </a>
          </footer>
        </div>
      </section>
    `;
    bindSettingsReport(panel);
    bindBrowserRefresh(panel);
    renderLearningControls(panel);
  }

  function bindBrowserRefresh(panel) {
    const button = panel.querySelector("#refreshBrowserAction");
    if (!button) return;
    button.hidden = window.CaatuuRuntime?.env === "android";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Updating";
      try {
        const registration = await navigator.serviceWorker?.getRegistration?.();
        await registration?.update?.();
      } catch (error) {
        // Reload still asks the active service worker for the latest same-origin files.
      }
      window.location.reload();
    });
  }

  function openSharedSettings() {
    const panel = document.querySelector("#settingsPanel");
    if (!panel) return;
    sharedSettingsTrigger = document.activeElement;
    panel.hidden = false;
    document.body.classList.add("settings-open");
    setSettingsNavActive(true);
    document.dispatchEvent(new CustomEvent("caatuu:settings-open"));
    panel.querySelector(".settings-sheet-body")?.focus?.();
  }

  function closeSharedSettings({ restoreFocus = true } = {}) {
    const panel = document.querySelector("#settingsPanel");
    if (!panel) return;
    panel.hidden = true;
    document.body.classList.remove("settings-open");
    setSettingsNavActive(false);
    if (restoreFocus && typeof sharedSettingsTrigger?.focus === "function") sharedSettingsTrigger.focus();
  }

  function bindSharedSettingsPanel() {
    document.addEventListener("click", (event) => {
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
    button.classList.remove("is-confirming");
    delete button.dataset.confirmArmed;
    delete button.dataset.confirmOriginalLabel;
  }

  function confirmButtonPress(button, options = {}) {
    if (!button) return true;
    if (button.dataset.confirmArmed === "true") {
      resetConfirmButton(button);
      return true;
    }

    button.dataset.confirmArmed = "true";
    button.dataset.confirmOriginalLabel = button.textContent;
    button.textContent = options.confirmLabel || "Press again";
    button.classList.add("is-confirming");
    if (options.message) button.setAttribute("aria-label", options.message);
    button._caatuuConfirmTimer = window.setTimeout(() => {
      resetConfirmButton(button);
    }, options.timeoutMs || 6500);
    return false;
  }

  function initChrome() {
    applyTheme(readStoredTheme(), { persist: false });
    document.querySelectorAll(".app-header").forEach(renderAppHeader);
    document.querySelectorAll("#settingsPanel, [data-caatuu-settings-panel]").forEach(renderSettingsPanel);
    document.querySelectorAll("[data-caatuu-bottom-nav]").forEach(renderBottomNav);
    document.querySelectorAll("[data-caatuu-language-switch]").forEach(renderLanguageSwitch);
    restoreRequestedGame();
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
    closeSharedSettings
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
