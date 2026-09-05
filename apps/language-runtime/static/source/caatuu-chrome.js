(() => {
  const course = window.CaatuuCourse;
  if (!course) throw new Error("Caatuu course profile must load before shared Chrome.");

  function interfaceMessage(messageId, parameters = {}) {
    const content = globalThis.CaatuuI18n;
    if (!content || typeof content.t !== "function") {
      throw new Error("Caatuu interface content must load before shared Chrome.");
    }
    const message = content.t(messageId, parameters);
    if (typeof message !== "string" || !message.trim()) {
      throw new Error(`Caatuu interface message ${messageId} must be a non-empty string.`);
    }
    return message;
  }

  function interfaceLanguageName(language) {
    const content = globalThis.CaatuuI18n;
    const name = content?.languageName?.(language);
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("Caatuu interface content must resolve every visible language name.");
    }
    return name.trim();
  }

  const courseThemeStorageKey = course.storage.theme;
  const courseFontSizeStorageKey = course.storage.fontSize;
  const themeStorageKey = "caatuu.appearance.theme.v1";
  const fontSizeStorageKey = "caatuu.appearance.font-size.v1";
  const speechVoiceStorageKey = `${course.storage.namespace || `caatuu-${course.id}`}.speech.voice.v1`;
  const legacySpeechPaceStorageKey = `${course.storage.namespace || `caatuu-${course.id}`}.speech.pace.v1`;
  const speechPaceStorageKey = "caatuu.speech.pace.v1";
  const speechMutedStorageKey = "caatuu.speech.muted.v1";
  const backpackViewStorageKey = `${course.storage.namespace || `caatuu-${course.id}`}.navigation.backpack-view.v1`;
  const navigationRequestStorageKey = `${course.storage.namespace || `caatuu-${course.id}`}.navigation.request.v1`;
  const experienceIconSrc = "/assets/icons/icon_gem.png";
  const coinIconSrc = "/assets/icons/coin_icon_ui.png";
  const streakIconSrc = "/assets/icons/streak_icon.png";
  const targetLanguage = course.targetLanguage;
  const targetLanguageName = interfaceLanguageName(targetLanguage);
  const speechLocale = String(
    targetLanguage.speechLocale
    || targetLanguage.locale
    || targetLanguage.id
    || "und"
  ).trim().replace(/_/gu, "-");
  const shellPolicy = window.CaatuuShellPolicy || {};
  const lightModeIconSrc = "/assets/icons/light_mode_ui.png";
  const darkModeIconSrc = "/assets/icons/dark_mode_ui.png";
  let sharedSettingsTrigger = null;
  let sharedHomeMenuTrigger = null;
  let sharedGameMenuTrigger = null;
  let activeHomeMenuTarget = "home";
  let lastStoreArtwork = "";
  let bottomDockResizeObserver = null;
  let appFreshnessBound = false;
  let browserSpeechVoiceEventsBound = false;
  let activeBrowserSpeechSession = null;
  let speechMutedFallback = false;
  let activeLanguageSelectorHost = null;
  let languageSelectorSequence = 0;
  let languageSelectorDismissalBound = false;
  let streakReminderTimer = 0;
  let streakReminderCheckPromise = null;
  const speechTestText = String(targetLanguage.nativeLabel || targetLanguageName).trim();
  const themeOptions = {
    light: { themeColor: "#f5efe5", label: interfaceMessage("settings.theme.usedark") },
    dark: { themeColor: "#151a18", label: interfaceMessage("settings.theme.uselight") }
  };
  const fontSizeOptions = Object.freeze({
    standard: { label: interfaceMessage("settings.textsize.smaller") },
    large: { label: interfaceMessage("settings.textsize.small") },
    largest: { label: interfaceMessage("settings.textsize.standard") }
  });
  const speechPaceOptions = Object.freeze({
    slower: Object.freeze({ label: interfaceMessage("speech.pace.slower"), rate: 0.5 }),
    slow: Object.freeze({ label: interfaceMessage("speech.pace.slow"), rate: 0.6 }),
    normal: Object.freeze({ label: interfaceMessage("speech.pace.normal"), rate: 1 })
  });
  const speechPaceOrder = Object.freeze(["slower", "slow", "normal"]);
  const speechPaceByDifficulty = Object.freeze({ 1: "slower", 2: "slow", 3: "normal" });
  const activeToolbarPopovers = new Set();
  const toolbarPopoverFrames = new WeakMap();
  const backpackViewOptions = Object.freeze({
    items: { label: interfaceMessage("nav.items"), iconSrc: "/assets/icons/items_icon.png?v=items-2" },
    stats: { label: interfaceMessage("nav.stats"), iconSrc: "/assets/icons/stats_icon.png" },
    settings: { label: interfaceMessage("nav.settings"), iconSrc: "/assets/icons/gear_icon.png" }
  });
  const homeMenuOptions = Object.freeze({
    home: Object.freeze({
      id: "homeBaseTab",
      label: interfaceMessage("nav.home"),
      iconSrc: "/assets/icons/homebase_icon.png",
      controls: "homeBaseView"
    }),
    social: Object.freeze({
      id: "homeSocialTab",
      label: interfaceMessage("nav.social"),
      iconSrc: "/assets/icons/social_icon.png",
      controls: "homeSocialView",
      status: interfaceMessage("common.indevelopment")
    }),
    store: Object.freeze({
      id: "homeStoreTab",
      label: interfaceMessage("nav.store"),
      iconSrc: "/assets/icons/store_icon.png",
      controls: "homeStoreView"
    })
  });
  const storeArtworkPaths = Object.freeze(Array.from(
    { length: 16 },
    (_, index) => `/assets/stores/stores%20(${index + 1}).png`
  ));
  const learning = window.CaatuuLearning;
  const semanticSkillCompassAxisPack = course.capabilities?.skillCompass === true
    && course.skillCompass
    && Array.isArray(course.skillCompass.axes)
    && course.skillCompass.axes.length >= 3
    ? course.skillCompass
    : null;
  const semanticSkillCompassAvailable = Boolean(semanticSkillCompassAxisPack);
  const semanticSkillCompassCopy = semanticSkillCompassAxisPack?.copy || null;
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
  const semanticSkillCompassMinimumConfidence = semanticSkillCompassAxisPack?.minimumConfidence ?? 0;
  const semanticSkillCompassControllers = new WeakMap();
  let semanticSkillCompassPrepared = null;
  let semanticSkillCompassPreparation = null;
  let semanticSkillCompassPreparationRevision = 0;
  const navItems = [
    {
      key: "home",
      label: interfaceMessage("nav.home"),
      iconSrc: "/assets/icons/home_icon.png",
      href: course.routes.home,
      view: "home"
    },
    {
      key: "games",
      label: interfaceMessage("nav.games"),
      iconSrc: "/assets/icons/games_icon.png",
      href: course.routes.games,
      requiresGames: true,
      view: "verbs"
    },
    {
      key: "backpack",
      label: interfaceMessage("nav.backpack"),
      iconSrc: "/assets/icons/backpack_icon.png",
      href: course.routes.settings
    }
  ];

  function toolbarPopoverBounds() {
    const viewport = window.visualViewport;
    const margin = 12;
    const left = (viewport?.offsetLeft || 0) + margin;
    const top = (viewport?.offsetTop || 0) + margin;
    const right = (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth) - margin;
    let bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight) - margin;
    const dock = document.querySelector("[data-caatuu-bottom-nav]");
    const dockRect = dock?.getBoundingClientRect?.();
    if (dockRect && dockRect.height > 0) bottom = Math.min(bottom, dockRect.top - 8);
    return { left, top, right, bottom };
  }

  function positionToolbarPopover(popover) {
    if (!popover || popover.hidden || !popover.isConnected) return;
    popover.classList.remove("caatuu-toolbar-popover-fixed");
    for (const property of ["left", "top", "right", "bottom", "width", "maxHeight"]) {
      popover.style[property] = "";
    }
    const natural = popover.getBoundingClientRect();
    const bounds = toolbarPopoverBounds();
    const availableWidth = Math.max(1, bounds.right - bounds.left);
    const availableHeight = Math.max(1, bounds.bottom - bounds.top);
    const width = Math.min(natural.width, availableWidth);
    const height = Math.min(natural.height, availableHeight);
    const left = Math.min(Math.max(natural.left, bounds.left), bounds.right - width);
    const top = Math.min(Math.max(natural.top, bounds.top), bounds.bottom - height);
    popover.classList.add("caatuu-toolbar-popover-fixed");
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
    popover.style.width = `${Math.round(width)}px`;
    popover.style.maxHeight = `${Math.round(availableHeight)}px`;
  }

  function constrainToolbarPopover(popover) {
    if (!popover) return;
    activeToolbarPopovers.add(popover);
    const pending = toolbarPopoverFrames.get(popover);
    if (pending) window.cancelAnimationFrame(pending);
    toolbarPopoverFrames.set(popover, window.requestAnimationFrame(() => {
      toolbarPopoverFrames.delete(popover);
      if (activeToolbarPopovers.has(popover)) positionToolbarPopover(popover);
    }));
  }

  function releaseToolbarPopover(popover) {
    if (!popover) return;
    activeToolbarPopovers.delete(popover);
    const pending = toolbarPopoverFrames.get(popover);
    if (pending) window.cancelAnimationFrame(pending);
    toolbarPopoverFrames.delete(popover);
    popover.classList.remove("caatuu-toolbar-popover-fixed");
    for (const property of ["left", "top", "right", "bottom", "width", "maxHeight"]) {
      popover.style[property] = "";
    }
  }

  function refreshToolbarPopovers() {
    activeToolbarPopovers.forEach((popover) => constrainToolbarPopover(popover));
  }
  const gameNavigationStorageKey = `${course.storage.namespace || `caatuu-${course.id}`}.navigation.active-game.v1`;
  const gamePresentationDefinitions = Object.freeze({
    campaign: Object.freeze({
      titleId: "games.campaign.title",
      summaryId: "games.campaign.summary",
      iconSrc: "/assets/planets/campaign-mode.png",
      href: "index.html"
    }),
    "verb-lab": Object.freeze({
      titleId: "games.verblab.title",
      summaryId: "games.verblab.summary",
      iconSrc: "/assets/planets/verb-nebula.png",
      href: "index.html"
    }),
    "word-net": Object.freeze({
      titleId: "games.wordworld.title",
      summaryId: "games.wordworld.summary",
      iconSrc: "/assets/planets/word-world.png",
      href: "index.html"
    }),
    "conjugation-comet": Object.freeze({
      titleId: "games.conjugationcomet.title",
      summaryId: "games.conjugationcomet.summary",
      iconSrc: "/assets/planets/conjugation-comet.png",
      href: "index.html"
    }),
    "case-cosmos": Object.freeze({
      titleId: "games.casecosmos.title",
      summaryId: "games.casecosmos.summary",
      iconSrc: "/assets/planets/case-cosmos.png",
      href: "index.html"
    }),
    "agreement-aurora": Object.freeze({
      titleId: "games.agreementaurora.title",
      summaryId: "games.agreementaurora.summary",
      iconSrc: "/assets/planets/agreement-aurora.png?v=agreement-aurora-art-2",
      href: "index.html"
    }),
    "naturalization-nucleus": Object.freeze({
      titleId: "games.naturalizationnucleus.title",
      summaryId: "games.naturalizationnucleus.summary",
      iconSrc: "/assets/planets/naturalization-nucleus.png",
      href: "index.html"
    }),
    "memory-moon": Object.freeze({
      titleId: "games.memorymoon.title",
      summaryId: "games.memorymoon.summary",
      iconSrc: "/assets/planets/memory-moon.png",
      href: "index.html"
    }),
    "sound-quasar": Object.freeze({
      titleId: "games.soundsquasar.title",
      summaryId: "games.soundsquasar.summary",
      iconSrc: "/assets/planets/sounds-quasar.png",
      href: "index.html"
    })
  });

  function gamePresentation(gameId) {
    const definition = gamePresentationDefinitions[String(gameId || "").trim()];
    if (!definition) return null;
    return Object.freeze({
      ...definition,
      title: interfaceMessage(definition.titleId),
      summary: interfaceMessage(definition.summaryId)
    });
  }

  const gameIdsByTitle = new Map(
    Object.keys(gamePresentationDefinitions).map((id) => [gamePresentation(id).title, id])
  );

  function gamePresentationAvailable(gameId, presentation) {
    if (!presentation) return false;
    if (typeof shellPolicy.gameAvailable === "function") {
      return shellPolicy.gameAvailable(course, gameId);
    }
    if (gameId === "word-net") return course.capabilities?.wordWorld === true;
    if (gameId === "verb-lab") return course.games?.includes?.("verb-lab") && Boolean(course.routes?.verbNebula);
    if (gameId === "conjugation-comet") return course.capabilities?.conjugationComet === true;
    if (gameId === "case-cosmos") return course.capabilities?.verbs === true && course.capabilities?.dictionary === true;
    if (gameId === "agreement-aurora") return course.capabilities?.verbs === true;
    if (gameId === "naturalization-nucleus") {
      return course.games?.includes?.("naturalization-nucleus") && Boolean(course.routes?.naturalizationNucleus);
    }
    if (gameId === "memory-moon") return course.capabilities?.memory === true;
    if (gameId === "sound-quasar") {
      return shellPolicy.PLANET_GAME_CONTRACT?.planets?.[gameId]?.implementationState === "implemented"
        && course.capabilities?.speech === true
        && course.games?.includes?.("sound-quasar")
        && Boolean(course.routes?.soundQuasar);
    }
    if (gameId === "campaign") {
      return Object.keys(gamePresentationDefinitions)
        .filter((candidate) => candidate !== "campaign")
        .filter((candidate) => gamePresentationAvailable(candidate, gamePresentationDefinitions[candidate]))
        .length >= 1;
    }
    return false;
  }

  function gamePresentationState(gameId, presentation) {
    if (!presentation) return "hidden";
    if (typeof shellPolicy.gameState === "function") return shellPolicy.gameState(course, gameId);
    if (gamePresentationAvailable(gameId, presentation)) return "playable";
    return course.upcomingGames?.includes?.(gameId) ? "upcoming" : "hidden";
  }

  function normalizeGameId(value) {
    const gameId = String(value || "").trim();
    if (gameId === "galaxy") return gameId;
    const presentation = gamePresentationDefinitions[gameId];
    return gamePresentationAvailable(gameId, presentation) ? gameId : "";
  }

  function gamePresentationHref(gameId) {
    const normalizedGameId = normalizeGameId(gameId);
    const presentation = gamePresentation(normalizedGameId);
    if (!presentation) return course.routes.games;
    return presentation.href;
  }

  function gameLandingHref(gameId) {
    return course.routes.games;
  }

  function syncCourseGameTriggers() {
    document.querySelectorAll("[data-course-game]").forEach((trigger) => {
      const gameId = String(trigger.dataset.courseGame || "");
      const available = normalizeGameId(gameId) === gameId;
      trigger.hidden = !available;
    });

    if (currentGameId() !== "conjugation-comet" || !gamePresentationAvailable("conjugation-comet", gamePresentationDefinitions["conjugation-comet"])) return;
    const back = document.querySelector(".app-header-back");
    if (back) back.href = gameLandingHref("conjugation-comet");
  }

  function rememberActiveGame(gameId) {
    const normalizedGameId = normalizeGameId(gameId);
    if (!normalizedGameId) return;
    try {
      localStorage.setItem(gameNavigationStorageKey, normalizedGameId);
    } catch (error) {
      // Navigation remains usable when storage is unavailable.
    }
    syncGameNavigationIndicators(normalizedGameId);
  }

  function readRememberedGame() {
    try {
      return normalizeGameId(localStorage.getItem(gameNavigationStorageKey)) || "galaxy";
    } catch (error) {
      return "galaxy";
    }
  }

  function gameNavigationHref(gameId = readRememberedGame()) {
    return course.routes.games;
  }

  function syncGameNavigationIndicators(gameId = readRememberedGame()) {
    const normalizedGameId = normalizeGameId(gameId);
    const presentation = gamePresentation(normalizedGameId);
    document.querySelectorAll('[data-caatuu-bottom-nav] [data-nav-key="games"]').forEach((button) => {
      let badge = button.querySelector(".app-nav-submenu-icon");
      if (!presentation) {
        badge?.remove();
        delete button.dataset.activeGame;
        button.setAttribute("aria-label", interfaceMessage("nav.games"));
        button.title = interfaceMessage("nav.opengames");
        return;
      }

      if (!badge) {
        const icon = button.querySelector(".app-nav-icon");
        if (!icon) return;
        badge = document.createElement("img");
        badge.className = "app-nav-submenu-icon";
        badge.alt = "";
        badge.setAttribute("aria-hidden", "true");
        badge.decoding = "async";
        icon.append(badge);
      }
      badge.src = presentation.iconSrc;
      badge.dataset.activeGame = normalizedGameId;
      button.dataset.activeGame = normalizedGameId;
      button.setAttribute("aria-label", interfaceMessage("nav.gamescurrent", { game: presentation.title }));
      button.title = interfaceMessage("nav.opengamescurrent", { game: presentation.title });
    });
  }

  function availableGamePresentations() {
    return Object.entries(gamePresentationDefinitions)
      .filter(([gameId, presentation]) => gamePresentationAvailable(gameId, presentation))
      .map(([gameId]) => [gameId, gamePresentation(gameId)]);
  }

  function presentedGamePresentations() {
    return Object.entries(gamePresentationDefinitions)
      .filter(([gameId, presentation]) => gamePresentationState(gameId, presentation) !== "hidden")
      .map(([gameId]) => [gameId, gamePresentation(gameId)]);
  }

  function updateBottomDockHeight(dock) {
    if (!dock) return;
    const height = Math.ceil(dock.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--caatuu-bottom-dock-height", `${height}px`);
  }

  function pickStoreArtwork() {
    const candidates = storeArtworkPaths.length > 1 && lastStoreArtwork
      ? storeArtworkPaths.filter((path) => path !== lastStoreArtwork)
      : storeArtworkPaths;
    const randomIndex = Math.min(
      candidates.length - 1,
      Math.max(0, Math.floor(Math.random() * candidates.length))
    );
    lastStoreArtwork = candidates[randomIndex] || storeArtworkPaths[0] || "";
    return lastStoreArtwork;
  }

  function ensureBottomDock(nav = document.querySelector("[data-caatuu-bottom-nav]")) {
    if (!nav) return null;
    let dock = nav.closest("[data-caatuu-bottom-dock]");
    if (!dock) {
      dock = document.createElement("div");
      dock.className = "app-bottom-dock";
      dock.dataset.caatuuBottomDock = "";
      const menuHost = document.createElement("div");
      menuHost.className = "app-bottom-dock-menu";
      menuHost.dataset.caatuuBottomDockMenu = "";
      menuHost.hidden = true;
      nav.before(dock);
      dock.append(menuHost, nav);
    }
    if (!bottomDockResizeObserver && typeof ResizeObserver === "function") {
      bottomDockResizeObserver = new ResizeObserver((entries) => {
        const activeDock = entries.find((entry) => entry.target.matches?.("[data-caatuu-bottom-dock]"))?.target;
        updateBottomDockHeight(activeDock || document.querySelector("[data-caatuu-bottom-dock]"));
      });
      bottomDockResizeObserver.observe(dock);
    }
    updateBottomDockHeight(dock);
    return dock;
  }

  function mountBottomDockMenus(nav = document.querySelector("[data-caatuu-bottom-nav]")) {
    const dock = ensureBottomDock(nav);
    const host = dock?.querySelector("[data-caatuu-bottom-dock-menu]");
    if (!host) return dock;
    const homeMenu = document.querySelector(".home-section-switcher");
    const settingsMenu = document.querySelector(".settings-section-switcher");
    const gamesMenu = document.querySelector(".games-menu-sheet");
    [homeMenu, settingsMenu, gamesMenu].forEach((menu) => {
      if (!menu || menu.parentElement === host) return;
      menu.hidden = true;
      host.append(menu);
    });
    return dock;
  }

  function setBottomDockMenu(menu = "") {
    const dock = mountBottomDockMenus();
    const host = dock?.querySelector("[data-caatuu-bottom-dock-menu]");
    if (!dock || !host) return;
    const homeMenu = host.querySelector(".home-section-switcher");
    const settingsMenu = host.querySelector(".settings-section-switcher");
    const gamesMenu = host.querySelector(".games-menu-sheet");
    const normalizedMenu = ["home", "settings", "games"].includes(menu) ? menu : "";
    homeMenu?.toggleAttribute("hidden", normalizedMenu !== "home");
    settingsMenu?.toggleAttribute("hidden", normalizedMenu !== "settings");
    gamesMenu?.toggleAttribute("hidden", normalizedMenu !== "games");
    host.hidden = !normalizedMenu;
    if (normalizedMenu) dock.dataset.openMenu = normalizedMenu;
    else delete dock.dataset.openMenu;
    document.querySelectorAll("#openSettings")
      .forEach((button) => button.setAttribute("aria-expanded", normalizedMenu === "settings" ? "true" : "false"));
    document.querySelectorAll('[data-caatuu-bottom-nav] [data-nav-key="home"]')
      .forEach((button) => button.setAttribute("aria-expanded", normalizedMenu === "home" ? "true" : "false"));
    document.querySelectorAll('[data-caatuu-bottom-nav] [data-nav-key="games"]')
      .forEach((button) => button.setAttribute("aria-expanded", normalizedMenu === "games" ? "true" : "false"));
    updateBottomDockHeight(dock);
    window.requestAnimationFrame(() => updateBottomDockHeight(dock));
  }

  function syncHomeMenuSelection(target = activeHomeMenuTarget) {
    const normalizedTarget = ["social", "store"].includes(target) ? target : "home";
    activeHomeMenuTarget = normalizedTarget;
    const option = homeMenuOptions[normalizedTarget];
    document.querySelectorAll('[data-caatuu-bottom-nav] [data-nav-key="home"]').forEach((button) => {
      let badge = button.querySelector(".app-nav-submenu-icon");
      if (!badge) {
        const icon = button.querySelector(".app-nav-icon");
        if (!icon) return;
        badge = document.createElement("img");
        badge.className = "app-nav-submenu-icon";
        badge.alt = "";
        badge.setAttribute("aria-hidden", "true");
        badge.decoding = "async";
        icon.append(badge);
      }
      badge.src = option.iconSrc;
      badge.dataset.homeDestination = normalizedTarget;
      button.dataset.homeDestination = normalizedTarget;
      button.setAttribute("aria-label", normalizedTarget === "home"
        ? interfaceMessage("nav.home")
        : interfaceMessage("nav.homecurrent", { section: option.label }));
      button.title = normalizedTarget === "home"
        ? interfaceMessage("nav.openhome")
        : interfaceMessage("nav.openhomecurrent", { section: option.label });
    });
    document.querySelectorAll("[data-home-menu-target]").forEach((button) => {
      const current = button.dataset.homeMenuTarget === normalizedTarget;
      button.classList.toggle("is-current", current);
      button.setAttribute("aria-selected", String(current));
      button.tabIndex = current ? 0 : -1;
      if (current) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function renderHomeMenu() {
    if (!document.querySelector("#view-home")) return null;
    let panel = document.querySelector("#homeMenuPanel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "homeMenuPanel";
      panel.className = "home-menu-backdrop";
      panel.hidden = true;
      document.body.append(panel);
    }

    let menu = document.querySelector("#homeMenu");
    if (!menu) {
      menu = document.createElement("nav");
      menu.id = "homeMenu";
      menu.className = "home-section-switcher";
      menu.setAttribute("role", "tablist");
      menu.setAttribute("aria-label", interfaceMessage("nav.homesections"));

      const options = Object.entries(homeMenuOptions).map(([target, option]) => {
        const button = document.createElement("button");
        button.id = option.id;
        button.type = "button";
        button.dataset.homeMenuTarget = target;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", "false");
        button.setAttribute("aria-label", option.status
          ? `${option.label}. ${option.status}.`
          : option.label);
        if (option.controls) button.setAttribute("aria-controls", option.controls);
        if (option.disabled) {
          button.disabled = true;
          button.classList.add("is-disabled");
          button.setAttribute("aria-disabled", "true");
        }

        const image = document.createElement("img");
        image.src = option.iconSrc;
        image.alt = "";
        image.decoding = "async";
        image.setAttribute("aria-hidden", "true");

        const copy = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = option.label;
        copy.append(title);
        if (option.status) {
          const status = document.createElement("small");
          status.className = "home-menu-option-status";
          status.textContent = option.status;
          copy.append(status);
        }
        button.append(image, copy);
        return button;
      });
      menu.replaceChildren(...options);
      panel.append(menu);
    }

    syncHomeMenuSelection();
    mountBottomDockMenus();
    return panel;
  }

  function openHomeMenu(trigger) {
    const panel = renderHomeMenu();
    if (!panel) return;
    closeGameMenu({ restoreFocus: false });
    sharedHomeMenuTrigger = trigger || document.activeElement;
    panel.hidden = false;
    setBottomDockMenu("home");
    document.body.classList.add("home-menu-open");
    window.requestAnimationFrame(() => {
      const current = document.querySelector(".home-section-switcher [data-home-menu-target].is-current");
      (current || document.querySelector(".home-section-switcher [data-home-menu-target]:not(:disabled)"))?.focus?.();
    });
  }

  function closeHomeMenu({ restoreFocus = true } = {}) {
    const panel = document.querySelector("#homeMenuPanel");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    const dock = document.querySelector("[data-caatuu-bottom-dock]");
    if (dock?.dataset.openMenu === "home") setBottomDockMenu();
    document.body.classList.remove("home-menu-open");
    if (restoreFocus && typeof sharedHomeMenuTrigger?.focus === "function") sharedHomeMenuTrigger.focus();
  }

  function showHomeDestination(target = "home", { restoreMenuFocus = false } = {}) {
    const homeView = document.querySelector("#view-home");
    if (!homeView) return false;
    const normalizedTarget = ["social", "store"].includes(target) ? target : "home";
    closeHomeMenu({ restoreFocus: false });
    closeGameMenu({ restoreFocus: false });
    const settingsPanel = document.querySelector("#settingsPanel");
    if (settingsPanel && !settingsPanel.hidden) closeSharedSettings({ restoreFocus: false });
    document.querySelector("#setupDisplayMenu")?.removeAttribute("open");
    document.dispatchEvent(new CustomEvent("caatuu:home-request"));

    const homeBase = document.querySelector("#homeBaseView");
    const homeSocial = document.querySelector("#homeSocialView");
    const homeStore = document.querySelector("#homeStoreView");
    if (homeBase) homeBase.hidden = normalizedTarget !== "home";
    if (homeSocial) homeSocial.hidden = normalizedTarget !== "social";
    if (homeStore) homeStore.hidden = normalizedTarget !== "store";
    homeView.dataset.homeDestination = normalizedTarget;
    homeView.setAttribute("aria-labelledby", normalizedTarget === "store"
      ? "homeStoreTitle"
      : normalizedTarget === "social"
        ? "homeSocialTitle"
        : "homeTitle");
    if (normalizedTarget === "store") {
      const artwork = document.querySelector("#homeStoreArt");
      if (artwork) artwork.src = pickStoreArtwork();
    }
    setPagePresentation(normalizedTarget === "store"
      ? { kicker: "Caatuu", title: interfaceMessage("nav.store"), iconSrc: "/assets/icons/store_icon.png" }
      : normalizedTarget === "social"
        ? { kicker: "Caatuu", title: interfaceMessage("nav.social"), iconSrc: "/assets/icons/social_icon.png" }
        : { kicker: "Caatuu", title: interfaceMessage("nav.home"), iconSrc: "/assets/icons/home_icon.png" });
    setBottomNavSection("home");
    syncHomeMenuSelection(normalizedTarget);
    if (restoreMenuFocus) {
      const currentTrigger = document.querySelector('[data-caatuu-bottom-nav] [data-nav-key="home"]');
      const focusTarget = sharedHomeMenuTrigger?.isConnected === false
        ? currentTrigger
        : sharedHomeMenuTrigger || currentTrigger;
      focusTarget?.focus?.();
    }
    return true;
  }

  function renderGameMenu() {
    let panel = document.querySelector("#gamesMenuPanel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "gamesMenuPanel";
      panel.className = "games-menu-backdrop";
      panel.hidden = true;
      panel.innerHTML = `
        <section class="games-menu-sheet" role="dialog" aria-modal="true" aria-label="${interfaceMessage("nav.choosegame")}">
          <div class="games-menu-body">
            <nav class="games-menu-grid" role="tablist" aria-label="${interfaceMessage("nav.traininggames")}"></nav>
          </div>
        </section>
      `;
      document.body.append(panel);
    }

    // The games selector is transparent by design, so the current screen's
    // real header must remain visible. Remove stale cloned headers created by
    // older builds instead of replacing the active Home, game, or Backpack
    // header whenever the selector opens.
    panel.querySelectorAll(".games-menu-app-header").forEach((header) => header.remove());

    const activeGameId = currentGameId();
    const menu = document.querySelector(".games-menu-grid");
    const presentedGames = presentedGamePresentations();
    menu?.style.setProperty("--game-menu-count", String(presentedGames.length));
    const options = presentedGames.map(([gameId, presentation]) => {
      const gameState = gamePresentationState(gameId, presentation);
      const upcoming = gameState === "upcoming";
      const button = document.createElement("button");
      button.className = "games-menu-option";
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(!upcoming && activeGameId === gameId));
      button.setAttribute("aria-label", upcoming
        ? interfaceMessage("nav.gameupcoming", { game: presentation.title })
        : interfaceMessage("nav.gameoption", { game: presentation.title, summary: presentation.summary }));
      button.dataset.gameMenuTarget = gameId;
      button.dataset.gameState = gameState;
      button.classList.toggle("is-current", !upcoming && activeGameId === gameId);
      button.classList.toggle("is-upcoming", upcoming);
      if (upcoming) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      if (!upcoming && activeGameId === gameId) button.setAttribute("aria-current", "page");

      const image = document.createElement("img");
      image.src = presentation.iconSrc;
      image.alt = "";
      image.setAttribute("aria-hidden", "true");
      image.decoding = "async";

      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = presentation.title;
      copy.append(title);
      if (upcoming) {
        const status = document.createElement("small");
        status.className = "games-menu-option-status";
        status.textContent = interfaceMessage("common.cominglater");
        copy.append(status);
      }
      button.append(image, copy);
      return button;
    });
    menu?.replaceChildren(...options);
    mountBottomDockMenus();
    return panel;
  }

  function openGameMenu(trigger) {
    const panel = renderGameMenu();
    if (!panel) return;
    closeHomeMenu({ restoreFocus: false });
    sharedGameMenuTrigger = trigger || document.activeElement;
    panel.hidden = false;
    setBottomDockMenu("games");
    document.body.classList.add("games-menu-open");
    document.querySelectorAll('[data-caatuu-bottom-nav] [data-nav-key="games"]')
      .forEach((button) => button.setAttribute("aria-expanded", "true"));
    window.requestAnimationFrame(() => {
      const current = document.querySelector(".games-menu-option.is-current");
      (current || document.querySelector(".games-menu-option"))?.focus?.();
    });
  }

  function closeGameMenu({ restoreFocus = true } = {}) {
    const panel = document.querySelector("#gamesMenuPanel");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    setBottomDockMenu();
    document.body.classList.remove("games-menu-open");
    document.querySelectorAll('[data-caatuu-bottom-nav] [data-nav-key="games"]')
      .forEach((button) => button.setAttribute("aria-expanded", "false"));
    if (restoreFocus && typeof sharedGameMenuTrigger?.focus === "function") sharedGameMenuTrigger.focus();
  }

  function selectGameFromMenu(gameId) {
    const normalizedGameId = normalizeGameId(gameId);
    if (!normalizedGameId) return;
    const settingsPanel = document.querySelector("#settingsPanel");
    const sharedGamesView = document.querySelector("#view-verbs");
    const sameGameIsVisible = currentGameId() === normalizedGameId
      && (!sharedGamesView || sharedGamesView.classList.contains("is-active"));
    if (sameGameIsVisible) {
      closeGameMenu({ restoreFocus: false });
      if (settingsPanel && !settingsPanel.hidden) closeSharedSettings({ restoreFocus: false });
      return;
    }
    rememberActiveGame(normalizedGameId);
    closeGameMenu({ restoreFocus: false });
    if (settingsPanel && !settingsPanel.hidden) closeSharedSettings({ restoreFocus: false });

    const localTarget = document.querySelector(`[data-train-tab="${normalizedGameId}"]`);
    if (localTarget) {
      localTarget.click();
      return;
    }
    if (["campaign", "verb-lab", "word-net", "conjugation-comet", "case-cosmos", "agreement-aurora", "naturalization-nucleus", "memory-moon", "sound-quasar"].includes(normalizedGameId)) {
      rememberNavigationRequest(`game:${normalizedGameId}`);
      window.location.href = course.routes.games;
      return;
    }
    window.location.href = gamePresentationHref(normalizedGameId);
  }

  function currentGameId() {
    if (document.body?.dataset.campaignActive === "true") return "campaign";
    if (document.querySelector(".conjugation-comet-page")) return "conjugation-comet";
    if (document.querySelector(".case-cosmos-page")) return "case-cosmos";
    if (document.querySelector(".agreement-aurora-page")) return "agreement-aurora";
    if (document.querySelector(".word-net-page")) return "word-net";
    if (document.querySelector("#trainPanelVerbLab:not([hidden])")) return "verb-lab";
    if (document.querySelector("#trainPanelWordNet:not([hidden])")) return "word-net";
    if (document.querySelector("#trainPanelConjugationComet:not([hidden])")) return "conjugation-comet";
    if (document.querySelector("#trainPanelCaseCosmos:not([hidden])")) return "case-cosmos";
    if (document.querySelector("#trainPanelAgreementAurora:not([hidden])")) return "agreement-aurora";
    if (document.querySelector("#trainPanelNaturalizationNucleus:not([hidden])")) return "naturalization-nucleus";
    if (document.querySelector("#trainPanelMemoryMoon:not([hidden])")) return "memory-moon";
    if (document.querySelector("#trainPanelSoundQuasar:not([hidden])")) return "sound-quasar";
    if (document.querySelector("#trainPanelGalaxy:not([hidden])")) return "galaxy";
    const title = document.querySelector(".app-header-title")?.textContent?.trim() || "";
    return gameIdsByTitle.get(title) || "";
  }

  function rememberNavigationRequest(view) {
    try {
      sessionStorage.setItem(navigationRequestStorageKey, String(view || ""));
    } catch (error) {
      // The destination remains reachable when session storage is unavailable.
    }
  }

  function readNavigationRequest() {
    try {
      return String(sessionStorage.getItem(navigationRequestStorageKey) || "");
    } catch (error) {
      return "";
    }
  }

  function clearVisibleUrlState() {
    if (!window.location.search && !window.location.hash) return;
    try {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    } catch (error) {
      // URL cleanup is cosmetic when History is unavailable.
    }
  }

  function bindSharedGameNavigation() {
    document.addEventListener("click", (event) => {
      const homeMenuTarget = event.target.closest?.("[data-home-menu-target]");
      if (homeMenuTarget) {
        event.preventDefault();
        if (homeMenuTarget.disabled || homeMenuTarget.getAttribute("aria-disabled") === "true") return;
        showHomeDestination(homeMenuTarget.dataset.homeMenuTarget, { restoreMenuFocus: true });
        return;
      }

      const homeMenuPanel = document.querySelector("#homeMenuPanel");
      if (event.target === homeMenuPanel) {
        event.preventDefault();
        closeHomeMenu();
        return;
      }

      const homeNav = event.target.closest?.('[data-caatuu-bottom-nav] [data-nav-key="home"]');
      if (homeNav && document.querySelector("#view-home")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (homeMenuPanel && !homeMenuPanel.hidden) closeHomeMenu();
        else openHomeMenu(homeNav);
        return;
      }

      const gameMenuLauncher = event.target.closest?.("[data-game-menu-launcher]");
      if (gameMenuLauncher) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const openPanel = document.querySelector("#gamesMenuPanel");
        if (!openPanel || openPanel.hidden) {
          const gamesNav = document.querySelector('[data-caatuu-bottom-nav] [data-nav-key="games"]');
          openGameMenu(gamesNav || gameMenuLauncher);
        }
        return;
      }

      const homeNavigation = event.target.closest?.('[data-navigation-request="home"]');
      if (homeNavigation && document.querySelector("#view-home")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showHomeDestination("home");
        return;
      }

      const menuTarget = event.target.closest?.("[data-game-menu-target]");
      if (menuTarget) {
        event.preventDefault();
        selectGameFromMenu(menuTarget.dataset.gameMenuTarget);
        return;
      }
      const gameMenuPanel = document.querySelector("#gamesMenuPanel");
      if (event.target === gameMenuPanel) {
        event.preventDefault();
        closeGameMenu();
        return;
      }

      const navigationRequest = event.target.closest?.("[data-navigation-request]");
      if (navigationRequest) rememberNavigationRequest(navigationRequest.dataset.navigationRequest);

      const backpackNav = event.target.closest?.('[data-caatuu-bottom-nav] [data-nav-key="backpack"]');
      if (backpackNav?.tagName === "A") rememberNavigationRequest("backpack");

      const back = event.target.closest?.(".app-header-back");
      if (back && currentGameId() && currentGameId() !== "galaxy") {
        rememberActiveGame("galaxy");
      }

      const trainTarget = event.target.closest?.("[data-train-tab]");
      if (trainTarget) rememberActiveGame(String(trainTarget.dataset.trainTab || ""));

      const gameNav = event.target.closest?.('[data-caatuu-bottom-nav] [data-nav-key="games"]');
      if (gameNav) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (homeMenuPanel && !homeMenuPanel.hidden) closeHomeMenu({ restoreFocus: false });
        if (gameMenuPanel && !gameMenuPanel.hidden) closeGameMenu();
        else openGameMenu(gameNav);
        return;
      }
      const backpackButton = event.target.closest?.('[data-caatuu-bottom-nav] #openSettings');
      if (backpackButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (homeMenuPanel && !homeMenuPanel.hidden) closeHomeMenu({ restoreFocus: false });
        if (gameMenuPanel && !gameMenuPanel.hidden) closeGameMenu({ restoreFocus: false });
        const dock = mountBottomDockMenus();
        setBottomDockMenu(dock?.dataset.openMenu === "settings" ? "" : "settings");
        return;
      }
      const otherNavigation = event.target.closest?.("[data-caatuu-bottom-nav] a, [data-caatuu-bottom-nav] button");
      if (otherNavigation) {
        if (homeMenuPanel && !homeMenuPanel.hidden) closeHomeMenu({ restoreFocus: false });
        if (gameMenuPanel && !gameMenuPanel.hidden) closeGameMenu({ restoreFocus: false });
      }
    }, true);
    document.addEventListener("keydown", (event) => {
      const homePanel = document.querySelector("#homeMenuPanel");
      if (event.key === "Escape" && homePanel && !homePanel.hidden) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeHomeMenu();
        return;
      }

      const homeOption = event.target.closest?.(".home-section-switcher [data-home-menu-target]");
      if (homeOption && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        const options = Array.from(document.querySelectorAll(".home-section-switcher [data-home-menu-target]"))
          .filter((button) => !button.disabled && button.getAttribute("aria-disabled") !== "true");
        if (!options.length) return;
        event.preventDefault();
        const currentIndex = Math.max(0, options.indexOf(homeOption));
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
        options[nextIndex]?.focus?.();
        return;
      }

      const gamePanel = document.querySelector("#gamesMenuPanel");
      if (event.key === "Escape" && gamePanel && !gamePanel.hidden) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeGameMenu();
      }
    });
  }

  function isNativeShell() {
    return window.CaatuuRuntime?.env === "android"
      || typeof window.CaatuuAndroid?.postMessage === "function";
  }

  function isCourseBundledInNativeShell(courseId) {
    if (!isNativeShell()) return true;
    try {
      if (typeof window.CaatuuAndroid?.isCourseBundled === "function") {
        return window.CaatuuAndroid.isCourseBundled(String(courseId || "")) === true;
      }
    } catch (error) {
      // A legacy native shell may expose only postMessage. Keep its current
      // course available while failing closed for every other course.
    }
    return String(courseId || "") === String(course.id || "");
  }

  function normalizeTheme(theme) {
    return theme === "light" || theme === "dark" ? theme : "light";
  }

  function readStoredTheme() {
    let sharedTheme = "";
    let courseTheme = "";
    try {
      sharedTheme = localStorage.getItem(themeStorageKey);
      courseTheme = localStorage.getItem(courseThemeStorageKey);
    } catch (error) {
      return "light";
    }
    const normalizedTheme = sharedTheme === "light" || sharedTheme === "dark"
      ? sharedTheme
      : normalizeTheme(courseTheme);
    try {
      localStorage.setItem(themeStorageKey, normalizedTheme);
      localStorage.setItem(courseThemeStorageKey, normalizedTheme);
    } catch (error) {
      // Appearance still applies when storage is read-only.
    }
    return normalizedTheme;
  }

  function normalizeFontSize(fontSize) {
    const value = String(fontSize || "").trim();
    return Object.prototype.hasOwnProperty.call(fontSizeOptions, value) ? value : "largest";
  }

  function readStoredFontSize() {
    let sharedFontSize = "";
    let courseFontSize = "";
    try {
      sharedFontSize = localStorage.getItem(fontSizeStorageKey);
      courseFontSize = localStorage.getItem(courseFontSizeStorageKey);
    } catch (error) {
      return "largest";
    }
    const normalizedFontSize = Object.prototype.hasOwnProperty.call(fontSizeOptions, sharedFontSize)
      ? sharedFontSize
      : normalizeFontSize(courseFontSize);
    try {
      localStorage.setItem(fontSizeStorageKey, normalizedFontSize);
      localStorage.setItem(courseFontSizeStorageKey, normalizedFontSize);
    } catch (error) {
      // Appearance still applies when storage is read-only.
    }
    return normalizedFontSize;
  }

  function normalizeBackpackView(view) {
    const value = String(view || "").trim();
    return Object.prototype.hasOwnProperty.call(backpackViewOptions, value) ? value : "items";
  }

  function readRememberedBackpackView() {
    try {
      return normalizeBackpackView(localStorage.getItem(backpackViewStorageKey));
    } catch (error) {
      return "items";
    }
  }

  function rememberBackpackView(view) {
    const normalizedView = normalizeBackpackView(view);
    try {
      localStorage.setItem(backpackViewStorageKey, normalizedView);
    } catch (error) {
      // Storage can be unavailable in constrained WebView contexts.
    }
    return normalizedView;
  }

  function syncBackpackViewIndicators(view) {
    const normalizedView = normalizeBackpackView(view);
    const option = backpackViewOptions[normalizedView];
    document.querySelectorAll('[data-caatuu-bottom-nav] [data-nav-key="backpack"]').forEach((button) => {
      button.dataset.backpackView = normalizedView;
      button.setAttribute("aria-label", interfaceMessage("nav.backpackcurrent", { section: option.label }));
      button.title = interfaceMessage("nav.openbackpack", { section: option.label });
      const badge = button.querySelector(".app-nav-submenu-icon");
      if (!badge) return;
      badge.src = option.iconSrc;
      badge.dataset.backpackView = normalizedView;
    });
  }

  function updateFontSizeControls(fontSize) {
    document.querySelectorAll("[data-font-size-option]").forEach((button) => {
      const active = button.dataset.fontSizeOption === fontSize;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function applyFontSize(fontSize, { persist = true } = {}) {
    const normalizedFontSize = normalizeFontSize(fontSize);
    document.documentElement.dataset.fontSize = normalizedFontSize;
    if (persist) {
      try {
        localStorage.setItem(fontSizeStorageKey, normalizedFontSize);
        localStorage.setItem(courseFontSizeStorageKey, normalizedFontSize);
      } catch (error) {
        // Storage can be unavailable in constrained WebView contexts.
      }
    }
    updateFontSizeControls(normalizedFontSize);
  }

  function speechVoiceBackend() {
    return isNativeShell() ? "android" : "browser";
  }

  function normalizeStoredSpeechVoice(value) {
    const normalized = String(value || "").trim();
    if (!normalized || normalized.length > 320) return "";
    return /^(android|browser):[^\u0000-\u001f\u007f]+$/u.test(normalized) ? normalized : "";
  }

  function readStoredSpeechVoice() {
    try {
      return normalizeStoredSpeechVoice(localStorage.getItem(speechVoiceStorageKey));
    } catch (error) {
      return "";
    }
  }

  function getSpeechVoicePreference() {
    const backend = speechVoiceBackend();
    const prefix = `${backend}:`;
    const stored = readStoredSpeechVoice();
    return stored.startsWith(prefix) ? stored.slice(prefix.length) : "";
  }

  function writeStoredSpeechVoice(value) {
    const normalized = normalizeStoredSpeechVoice(value);
    try {
      if (normalized) localStorage.setItem(speechVoiceStorageKey, normalized);
      else localStorage.removeItem(speechVoiceStorageKey);
    } catch (error) {
      // Automatic pronunciation remains available when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent("caatuu:speech-voice-change", {
      detail: {
        backend: speechVoiceBackend(),
        voice: getSpeechVoicePreference()
      }
    }));
  }

  function normalizeStoredSpeechPace(value) {
    const normalized = String(value || "").trim().toLocaleLowerCase("en-US");
    return Object.prototype.hasOwnProperty.call(speechPaceOptions, normalized) ? normalized : "";
  }

  function readStoredSpeechPace() {
    try {
      const stored = localStorage.getItem(speechPaceStorageKey);
      if (stored !== null) return normalizeStoredSpeechPace(stored);
      const legacy = normalizeStoredSpeechPace(localStorage.getItem(legacySpeechPaceStorageKey));
      if (legacy) localStorage.setItem(speechPaceStorageKey, legacy);
      return legacy;
    } catch (error) {
      return "";
    }
  }

  function currentSpeechDifficulty() {
    const difficulty = Number(learning?.difficulty?.());
    return Object.prototype.hasOwnProperty.call(speechPaceByDifficulty, difficulty) ? difficulty : 1;
  }

  function getSpeechPacePreference() {
    return readStoredSpeechPace();
  }

  function resolveSpeechPace(difficulty = currentSpeechDifficulty()) {
    const normalizedDifficulty = Object.prototype.hasOwnProperty.call(speechPaceByDifficulty, Number(difficulty))
      ? Number(difficulty)
      : 1;
    const preference = readStoredSpeechPace();
    const key = preference || speechPaceByDifficulty[normalizedDifficulty];
    const option = speechPaceOptions[key];
    const badge = String(learning?.difficultyOption?.(normalizedDifficulty)?.label
      || interfaceMessage("progress.level", { level: normalizedDifficulty }));
    return {
      key,
      label: option.label,
      rate: option.rate,
      source: preference ? "override" : "badge",
      difficulty: normalizedDifficulty,
      badge
    };
  }

  function writeStoredSpeechPace(value) {
    const preference = normalizeStoredSpeechPace(value);
    try {
      if (preference) localStorage.setItem(speechPaceStorageKey, preference);
      else localStorage.setItem(speechPaceStorageKey, "auto");
    } catch (error) {
      // Badge-paced pronunciation remains available when storage is unavailable.
    }
    const pace = resolveSpeechPace();
    window.dispatchEvent(new CustomEvent("caatuu:speech-pace-change", {
      detail: { preference, pace }
    }));
    return pace;
  }

  function setSpeechPacePreference(value) {
    return writeStoredSpeechPace(value);
  }

  function getSpeechMuted() {
    try {
      return localStorage.getItem(speechMutedStorageKey) === "true";
    } catch (error) {
      return speechMutedFallback;
    }
  }

  function updateSpeechMuteControls(root = document) {
    const muted = getSpeechMuted();
    if (document.documentElement?.dataset) {
      document.documentElement.dataset.speechMuted = String(muted);
    }
    root.querySelectorAll?.("[data-speech-mute-toggle]").forEach((button) => {
      button.setAttribute("aria-checked", String(muted));
      button.classList.toggle("is-active", muted);
      const action = muted
        ? interfaceMessage("speech.audio.turnon")
        : interfaceMessage("speech.audio.mute");
      button.setAttribute("aria-label", action);
      button.title = action;
      const label = button.querySelector?.("[data-speech-mute-label]");
      if (label) label.textContent = interfaceMessage("speech.audio.muteall");
    });
    root.querySelectorAll?.("[data-speech-mute-status]").forEach((status) => {
      status.textContent = muted
        ? interfaceMessage("speech.audio.mutedstatus")
        : interfaceMessage("speech.audio.onstatus");
    });
    return muted;
  }

  function setSpeechMuted(value) {
    const muted = Boolean(value);
    speechMutedFallback = muted;
    try {
      localStorage.setItem(speechMutedStorageKey, String(muted));
    } catch (error) {
      // The preference remains active only where storage is unavailable.
    }
    if (muted) void stopSpeech();
    window.dispatchEvent(new CustomEvent("caatuu:speech-mute-change", {
      detail: { muted }
    }));
    return muted;
  }

  function updateSpeechPaceControls(root = document) {
    const pace = resolveSpeechPace();
    const preference = getSpeechPacePreference();
    root.querySelectorAll("[data-speech-pace-option]").forEach((button) => {
      const active = button.dataset.speechPaceOption === preference;
      const badgeDefault = !preference && button.dataset.speechPaceOption === pace.key;
      button.classList.toggle("is-active", active);
      button.classList.toggle("is-badge-default", badgeDefault);
      button.setAttribute("aria-pressed", String(active));
    });
    const paceIndex = Math.max(0, speechPaceOrder.indexOf(pace.key));
    const paceProgress = speechPaceOrder.length > 1
      ? `${(paceIndex / (speechPaceOrder.length - 1)) * 100}%`
      : "0%";
    root.querySelectorAll("[data-speech-pace-slider]").forEach((slider) => {
      slider.value = String(paceIndex);
      slider.style.setProperty("--speech-pace-position", paceProgress);
      slider.setAttribute("aria-valuetext", interfaceMessage("speech.pace.valuetext", {
        pace: pace.label,
        rate: pace.rate
      }));
      slider.dataset.paceSource = pace.source;
    });
    const status = root.querySelector("#settingsSpeechPaceStatus");
    if (status) {
      status.textContent = pace.source === "badge"
        ? interfaceMessage("speech.pace.badgestatus", {
          badge: pace.badge,
          pace: pace.label,
          rate: pace.rate
        })
        : interfaceMessage("speech.pace.manualstatus", { pace: pace.label, rate: pace.rate });
    }
    return pace;
  }

  function normalizeSpeechLocale(value) {
    return String(value || "").trim().replace(/_/gu, "-").toLocaleLowerCase("en-US");
  }

  function speechVoiceMatchRank(locale) {
    const requestedLocale = normalizeSpeechLocale(speechLocale);
    const voiceLocale = normalizeSpeechLocale(locale);
    if (!requestedLocale || !voiceLocale) return -1;
    if (requestedLocale === voiceLocale) return 0;
    const requestedLanguage = requestedLocale.split("-")[0];
    const voiceLanguage = voiceLocale.split("-")[0];
    return requestedLanguage === voiceLanguage ? 1 : -1;
  }

  function speechVoiceMatchesLocale(locale) {
    return speechVoiceMatchRank(locale) >= 0;
  }

  function browserSpeechVoiceOptions() {
    const synthesis = window.speechSynthesis;
    if (!synthesis || typeof synthesis.getVoices !== "function") return [];
    return synthesis.getVoices()
      .filter((voice) => speechVoiceMatchesLocale(voice.lang))
      .map((voice) => ({
        id: String(voice.voiceURI || voice.name || "").trim(),
        name: String(voice.name || voice.voiceURI || interfaceMessage("speech.voice.defaultname", {
          language: targetLanguageName
        })).trim(),
        locale: String(voice.lang || speechLocale),
        matchRank: speechVoiceMatchRank(voice.lang),
        localService: voice.localService !== false
      }))
      .filter((voice) => voice.id)
      .sort((left, right) => (
        left.matchRank - right.matchRank
        || Number(right.localService) - Number(left.localService)
        || left.name.localeCompare(right.name, "en", { sensitivity: "base" })
        || left.id.localeCompare(right.id, "en", { sensitivity: "base" })
      ))
      .map(({ matchRank, ...voice }) => voice);
  }

  function normalizeNativeSpeechVoiceOptions(voices) {
    if (!Array.isArray(voices)) return [];
    return voices
      .map((voice) => ({
        id: String(voice?.id || voice?.name || "").trim(),
        name: String(voice?.name || voice?.id || interfaceMessage("speech.voice.defaultname", {
          language: targetLanguageName
        })).trim(),
        locale: String(voice?.locale || speechLocale),
        matchRank: speechVoiceMatchRank(voice?.locale),
        localService: voice?.localService === true
      }))
      .filter((voice) => voice.id && voice.matchRank >= 0)
      .sort((left, right) => (
        left.matchRank - right.matchRank
        || Number(right.localService) - Number(left.localService)
        || left.name.localeCompare(right.name, "en", { sensitivity: "base" })
        || left.id.localeCompare(right.id, "en", { sensitivity: "base" })
      ))
      .map(({ matchRank, ...voice }) => voice);
  }

  function appendSpeechVoiceOption(select, backend, voice) {
    const option = document.createElement("option");
    option.value = `${backend}:${voice.id}`;
    const service = voice.localService
      ? interfaceMessage("speech.service.ondevice")
      : interfaceMessage("speech.service.network");
    option.textContent = interfaceMessage("speech.voice.option", {
      name: voice.name,
      locale: voice.locale,
      service
    });
    select.append(option);
  }

  async function listSpeechVoiceOptions() {
    const backend = speechVoiceBackend();
    let voices = [];
    let available = true;
    let speechStatus = {};
    try {
      if (backend === "android") {
        const response = await window.CaatuuRuntime?.speech?.status?.(
          speechLocale,
          { voice: getSpeechVoicePreference() }
        );
        speechStatus = response || {};
        voices = normalizeNativeSpeechVoiceOptions(response?.voices);
        available = response?.available === true;
      } else {
        available = Boolean(
          window.speechSynthesis
          && typeof window.speechSynthesis.speak === "function"
          && typeof window.speechSynthesis.cancel === "function"
          && window.SpeechSynthesisUtterance
        );
        voices = browserSpeechVoiceOptions();
        const requestedVoice = getSpeechVoicePreference();
        const selectedVoice = voices.find((voice) => voice.id === requestedVoice) || voices[0] || null;
        speechStatus = {
          reason: available && voices.length ? "" : "no-language-voice",
          voice: selectedVoice?.id || "",
          localService: selectedVoice?.localService,
          localVoiceAvailable: voices.some((voice) => voice.localService),
          requestedVoice,
          requestedVoiceAvailable: !requestedVoice || voices.some((voice) => voice.id === requestedVoice)
        };
      }
    } catch (error) {
      available = false;
      voices = [];
      speechStatus = { reason: "engine-unavailable" };
    }
    const activeVoice = String(speechStatus.voice || "").trim();
    const requestedVoice = String(speechStatus.requestedVoice ?? getSpeechVoicePreference()).trim();
    const localVoiceAvailable = typeof speechStatus.localVoiceAvailable === "boolean"
      ? speechStatus.localVoiceAvailable
      : voices.some((voice) => voice.localService);
    const reason = String(speechStatus.reason || "");
    return {
      backend,
      available,
      reason,
      activeVoice,
      activeVoiceLocal: speechStatus.localService === true,
      localVoiceAvailable,
      requestedVoice,
      requestedVoiceAvailable: speechStatus.requestedVoiceAvailable !== false,
      canInstallVoice: backend === "android" && (
        reason === "missing-language-data"
        || reason === "no-language-voice"
        || !localVoiceAvailable
      ),
      voices: voices.map((voice) => ({
        ...voice,
        value: `${backend}:${voice.id}`,
        service: voice.localService
          ? interfaceMessage("speech.service.ondevice")
          : interfaceMessage("speech.service.network")
      }))
    };
  }

  async function getSpeechVoiceControlState() {
    let result = await listSpeechVoiceOptions();
    let unavailablePreference = "";
    if (
      result.requestedVoice
      && !result.requestedVoiceAvailable
      && result.voices.length
    ) {
      unavailablePreference = result.requestedVoice;
      writeStoredSpeechVoice("");
      result = await listSpeechVoiceOptions();
    }
    return { ...result, unavailablePreference };
  }

  function speechVoiceName(result, voiceId) {
    const normalizedId = String(voiceId || "").trim();
    if (!normalizedId) return "";
    return result.voices.find((voice) => voice.id === normalizedId)?.name || normalizedId;
  }

  function describeSpeechVoiceState(result) {
    if (result.unavailablePreference) {
      const activeName = speechVoiceName(result, result.activeVoice);
      return activeName
        ? interfaceMessage("speech.voice.savedunavailableactive", { voice: activeName })
        : interfaceMessage("speech.voice.savedunavailableautomatic");
    }
    if (result.available && result.activeVoice) {
      const activeName = speechVoiceName(result, result.activeVoice);
      const service = result.activeVoiceLocal
        ? interfaceMessage("speech.service.ondeviceinline")
        : interfaceMessage("speech.service.networkinline");
      return result.requestedVoice
        ? interfaceMessage("speech.voice.using", { voice: activeName, service })
        : interfaceMessage("speech.voice.automaticuses", { voice: activeName, service });
    }
    if (result.available && result.voices.length) {
      return interfaceMessage("speech.voice.automaticbest", { language: targetLanguageName });
    }
    if (result.backend === "android" && result.reason === "missing-language-data") {
      return interfaceMessage("speech.voice.datanotinstalled", { language: targetLanguageName });
    }
    if (result.backend === "android" && result.reason === "no-language-voice") {
      return interfaceMessage("speech.voice.enginemissing", { language: targetLanguageName });
    }
    if (result.backend === "android") {
      return interfaceMessage("speech.voice.devicenotready", { language: targetLanguageName });
    }
    return interfaceMessage("speech.voice.browsermissing", { language: targetLanguageName });
  }

  async function previewSpeech() {
    const pace = resolveSpeechPace();
    return speakText(speechTestText, { rate: pace.rate });
  }

  async function installSpeechData() {
    if (!isNativeShell()) {
      return {
        runtime: "browser-web-speech",
        launched: false,
        reason: "browser-managed"
      };
    }
    const install = window.CaatuuRuntime?.speech?.installData;
    if (!install) throw new Error(interfaceMessage("speech.voice.installunavailable"));
    return install();
  }

  function setSpeechVoicePreference(value) {
    writeStoredSpeechVoice(value);
    return getSpeechVoicePreference();
  }

  function clampSpeechControl(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  }

  function callSpeechCallback(callback, ...args) {
    try {
      callback?.(...args);
    } catch (error) {
      // UI callbacks must never keep a speech request from settling.
    }
  }

  async function stopSpeech() {
    if (speechVoiceBackend() === "android") {
      return window.CaatuuRuntime?.speech?.stop?.();
    }
    if (activeBrowserSpeechSession) {
      return activeBrowserSpeechSession.stop();
    }
    window.speechSynthesis?.cancel?.();
    return { runtime: "browser-web-speech", stopped: true };
  }

  async function speakText(text, options = {}) {
    const normalizedText = String(text || "").normalize("NFC").trim();
    if (!normalizedText) {
      throw new Error(interfaceMessage("speech.text.required", { language: targetLanguageName }));
    }
    if (normalizedText.length > 1_000) {
      throw new Error(interfaceMessage("speech.text.toolong", { language: targetLanguageName, count: 1000 }));
    }
    const locale = speechLocale;
    const rate = clampSpeechControl(options.rate, 0.5, 1.5, resolveSpeechPace().rate);
    const pitch = clampSpeechControl(options.pitch, 0.5, 1.5, 1);
    const voice = String(options.voice ?? getSpeechVoicePreference()).trim().slice(0, 256);

    await stopSpeech();
    if (getSpeechMuted()) {
      const result = {
        runtime: "caatuu-shared-speech",
        outcome: "muted",
        muted: true,
        rate
      };
      callSpeechCallback(options.onEnd, result);
      return result;
    }
    if (speechVoiceBackend() === "android") {
      const speech = window.CaatuuRuntime?.speech;
      if (!speech?.speak) {
        throw new Error(interfaceMessage("speech.pronunciation.deviceunavailable", {
          language: targetLanguageName
        }));
      }
      const result = await speech.speak(
        normalizedText,
        { locale, rate, pitch, voice },
        {
          onEvent(event) {
            if (event?.kind === "speech" && event?.phase === "started") {
              callSpeechCallback(options.onStart, event);
            }
          }
        }
      );
      callSpeechCallback(options.onEnd, result);
      return result;
    }

    const synthesis = window.speechSynthesis;
    const Utterance = window.SpeechSynthesisUtterance;
    if (!synthesis || !Utterance) {
      throw new Error(interfaceMessage("speech.pronunciation.browserunavailable", {
        language: targetLanguageName
      }));
    }
    const utterance = new Utterance(normalizedText);
    utterance.lang = locale;
    utterance.rate = rate;
    utterance.pitch = pitch;
    let activeVoice = null;
    if (typeof synthesis.getVoices === "function") {
      const voiceOptions = browserSpeechVoiceOptions();
      const selectedOption = voiceOptions.find((candidate) => candidate.id === voice) || voiceOptions[0] || null;
      activeVoice = synthesis.getVoices().find((candidate) => (
        String(candidate?.voiceURI || candidate?.name || "") === selectedOption?.id
        && speechVoiceMatchesLocale(candidate?.lang)
      )) || null;
      if (voice && !voiceOptions.some((candidate) => candidate.id === voice)) writeStoredSpeechVoice("");
      if (activeVoice) utterance.voice = activeVoice;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout = null;
      const session = {
        stop() {
          const result = { runtime: "browser-web-speech", outcome: "stopped", stopped: true };
          finish(null, result);
          synthesis.cancel();
          return result;
        }
      };
      const finish = (error = null, result = {
        runtime: "browser-web-speech",
        outcome: "completed",
        voice: String(activeVoice?.voiceURI || activeVoice?.name || ""),
        localService: activeVoice?.localService !== false,
        rate
      }) => {
        if (settled) return;
        settled = true;
        if (timeout !== null) window.clearTimeout(timeout);
        utterance.onstart = null;
        utterance.onend = null;
        utterance.onerror = null;
        if (activeBrowserSpeechSession === session) activeBrowserSpeechSession = null;
        if (error) reject(error);
        else {
          callSpeechCallback(options.onEnd, result);
          resolve(result);
        }
      };
      activeBrowserSpeechSession = session;
      timeout = window.setTimeout(() => {
        finish(new Error(interfaceMessage("speech.test.timeout")));
        synthesis.cancel();
      }, 20_000);
      utterance.onstart = (event) => callSpeechCallback(options.onStart, event);
      utterance.onend = () => {
        finish();
      };
      utterance.onerror = (event) => {
        const reason = String(event?.error || interfaceMessage("speech.test.failed"));
        finish(new Error(reason));
      };
      try {
        synthesis.speak(utterance);
      } catch (error) {
        finish(error);
      }
    });
  }

  async function refreshSpeechVoiceControl(panel) {
    const select = panel?.querySelector("#settingsSpeechVoice");
    const status = panel?.querySelector("#settingsSpeechVoiceStatus");
    const testButton = panel?.querySelector("#settingsSpeechVoiceTest");
    const installButton = panel?.querySelector("#settingsSpeechVoiceInstall");
    if (!select || !status || !testButton) return;
    updateSpeechPaceControls(panel);
    const request = Number(panel.dataset.speechVoiceRequest || 0) + 1;
    panel.dataset.speechVoiceRequest = String(request);
    select.disabled = true;
    testButton.disabled = true;
    status.textContent = interfaceMessage("speech.voice.checking", { language: targetLanguageName });

    const result = await getSpeechVoiceControlState();
    if (request !== Number(panel.dataset.speechVoiceRequest)) return;
    const { backend, voices, available } = result;

    const automatic = document.createElement("option");
    automatic.value = "";
    automatic.textContent = interfaceMessage("speech.voice.automaticrecommended");
    select.replaceChildren(automatic);
    voices.forEach((voice) => appendSpeechVoiceOption(select, backend, voice));

    const preferredVoice = getSpeechVoicePreference();
    const selectedVoice = voices.find((voice) => voice.id === preferredVoice);
    select.value = selectedVoice ? `${backend}:${selectedVoice.id}` : "";
    const voiceControlAvailable = available || voices.length > 0;
    select.disabled = !voiceControlAvailable;
    select.dataset.available = String(available);
    select.dataset.voiceCount = String(voices.length);
    testButton.disabled = !available;
    testButton.dataset.available = String(available);
    const voiceName = selectedVoice?.name || interfaceMessage("speech.voice.automaticname", {
      language: targetLanguageName
    });
    testButton.setAttribute("aria-label", interfaceMessage("speech.voice.testlabel", { voice: voiceName }));
    status.textContent = describeSpeechVoiceState(result);
    if (installButton) {
      installButton.hidden = !result.canInstallVoice;
      installButton.disabled = false;
      installButton.textContent = interfaceMessage("speech.voice.install", { language: targetLanguageName });
    }
  }

  async function playSpeechSettingsPreview(panel) {
    const status = panel?.querySelector("#settingsSpeechVoiceStatus");
    if (status) {
      status.textContent = interfaceMessage("speech.voice.playingsample", { language: targetLanguageName });
    }
    try {
      const result = await previewSpeech();
      if (result?.muted) {
        if (status) status.textContent = interfaceMessage("speech.audio.mutednotice");
        return;
      }
    } catch (error) {
      if (status) {
        status.textContent = interfaceMessage("speech.voice.selectedunavailable", {
          language: targetLanguageName
        });
      }
      return;
    }
    await refreshSpeechVoiceControl(panel);
  }

  function bindSpeechVoiceControl(panel) {
    const select = panel?.querySelector("#settingsSpeechVoice");
    const testButton = panel?.querySelector("#settingsSpeechVoiceTest");
    const status = panel?.querySelector("#settingsSpeechVoiceStatus");
    const installButton = panel?.querySelector("#settingsSpeechVoiceInstall");
    if (!select || !testButton || !status || panel.dataset.speechVoiceBound === "true") return;
    panel.dataset.speechVoiceBound = "true";
    select.addEventListener("change", async () => {
      select.disabled = true;
      await stopSpeech();
      writeStoredSpeechVoice(select.value);
      await refreshSpeechVoiceControl(panel);
      await playSpeechSettingsPreview(panel);
    });
    testButton.addEventListener("click", async () => {
      if (testButton.disabled || testButton.getAttribute("aria-busy") === "true") return;
      const label = testButton.textContent;
      testButton.disabled = true;
      testButton.setAttribute("aria-busy", "true");
      testButton.textContent = interfaceMessage("speech.test.playing");
      const pace = resolveSpeechPace();
      status.textContent = interfaceMessage("speech.test.playingatpace", {
        language: targetLanguageName,
        pace: pace.label.toLocaleLowerCase(globalThis.CaatuuI18n.locale || "en")
      });
      try {
        const result = await speakText(speechTestText, { rate: pace.rate });
        if (result?.muted) status.textContent = interfaceMessage("speech.audio.mutednotice");
        else if (result?.outcome !== "stopped") {
          status.textContent = interfaceMessage("speech.test.finishedatpace", {
            pace: pace.label.toLocaleLowerCase(globalThis.CaatuuI18n.locale || "en")
          });
        }
      } catch (error) {
        status.textContent = interfaceMessage("speech.voice.deviceplaybackfailed", {
          language: targetLanguageName
        });
      } finally {
        testButton.removeAttribute("aria-busy");
        testButton.textContent = label;
        testButton.disabled = testButton.dataset.available !== "true";
        select.disabled = select.dataset.available !== "true" || select.dataset.voiceCount === "0";
      }
    });
    installButton?.addEventListener("click", async () => {
      if (installButton.disabled) return;
      installButton.disabled = true;
      status.textContent = interfaceMessage("speech.voice.openinginstall");
      try {
        const result = await installSpeechData();
        status.textContent = result?.launched === false
          ? interfaceMessage("speech.voice.addinsettings", { language: targetLanguageName })
          : interfaceMessage("speech.voice.finishandroidinstall", { language: targetLanguageName });
      } catch (error) {
        status.textContent = interfaceMessage("speech.voice.androidinstallfailed");
      } finally {
        installButton.disabled = false;
      }
    });

    if (!isNativeShell() && !browserSpeechVoiceEventsBound) {
      const synthesis = window.speechSynthesis;
      if (synthesis && typeof synthesis.addEventListener === "function") {
        browserSpeechVoiceEventsBound = true;
        synthesis.addEventListener("voiceschanged", () => {
          document.querySelectorAll("#settingsPanel, [data-caatuu-settings-panel]").forEach((settingsPanel) => {
            const sheet = settingsPanel.querySelector(".settings-sheet");
            if (!settingsPanel.hidden && sheet?.dataset.settingsCurrentView === "settings") {
              void refreshSpeechVoiceControl(settingsPanel);
            }
          });
        });
      }
    }
  }

  function bindSpeechPaceControl(panel) {
    const buttons = panel?.querySelectorAll("[data-speech-pace-option]");
    const sliders = panel?.querySelectorAll("[data-speech-pace-slider]");
    if ((!buttons?.length && !sliders?.length) || panel.dataset.speechPaceBound === "true") return;
    panel.dataset.speechPaceBound = "true";
    buttons.forEach((button) => {
      button.addEventListener("click", async () => {
        await stopSpeech();
        const selectedPace = button.dataset.speechPaceOption;
        const nextPreference = getSpeechPacePreference() === selectedPace ? "" : selectedPace;
        setSpeechPacePreference(nextPreference);
        updateSpeechPaceControls(panel);
        await playSpeechSettingsPreview(panel);
      });
    });
    sliders.forEach((slider) => {
      slider.addEventListener("input", () => {
        const paceIndex = Math.max(0, Math.min(
          speechPaceOrder.length - 1,
          Math.round(Number(slider.value) || 0)
        ));
        setSpeechPacePreference(speechPaceOrder[paceIndex]);
        updateSpeechPaceControls(panel);
      });
      slider.addEventListener("change", async () => {
        await stopSpeech();
        await playSpeechSettingsPreview(panel);
      });
    });
    updateSpeechPaceControls(panel);
  }

  function updateThemeControls(theme) {
    document.querySelectorAll("[data-theme-option]").forEach((button) => {
      const active = button.dataset.themeOption === theme;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const darkActive = theme === "dark";
      const option = themeOptions[theme] || themeOptions.light;
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
      themeOptions[normalizedTheme]?.themeColor || themeOptions.light.themeColor
    );
    if (persist) {
      try {
        localStorage.setItem(themeStorageKey, normalizedTheme);
        localStorage.setItem(courseThemeStorageKey, normalizedTheme);
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
      <button type="button" data-difficulty-level="${option.level}" aria-label="${interfaceMessage("progress.challengebadge", {
        badge: option.label,
        level: option.level
      })}">
        <b aria-hidden="true">
          <img src="/assets/icons/difficulty_medal_${option.level}_ui.png?v=ui-1" alt="" loading="lazy" decoding="async">
        </b>
        <span>${option.label}</span>
      </button>
    `).join("");
  }

  function normalizeRewardCount(value) {
    const count = Number(value);
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  }

  function formatCompactRewardCount(value) {
    const count = normalizeRewardCount(value);
    if (count < 1_000) return String(count);
    if (count >= 999_500_000) return "999M+";

    const divisor = count >= 999_500 ? 1_000_000 : 1_000;
    const suffix = divisor === 1_000_000 ? "M" : "K";
    const scaled = count / divisor;
    const rounded = scaled < 10 ? Math.round(scaled * 10) / 10 : Math.round(scaled);
    return `${String(rounded).replace(/\.0$/u, "")}${suffix}`;
  }

  function renderHeaderReward(root, kind, value, messageId) {
    const count = normalizeRewardCount(value);
    root.querySelectorAll(`[data-caatuu-header-${kind}-count]`).forEach((element) => {
      element.textContent = formatCompactRewardCount(count);
    });
    root.querySelectorAll(`[data-caatuu-header-${kind}]`).forEach((element) => {
      const label = interfaceMessage(messageId, { count });
      element.setAttribute("aria-label", label);
      element.setAttribute("title", label);
    });
  }

  function renderLearningControls(root = document) {
    if (!learning) return;
    const profile = learning.snapshot();
    const journey = profile.journey?.summary || profile.summary;
    const rewards = {
      xp: journey.xp,
      coins: journey.rounds
    };
    renderHeaderReward(root, "xp", rewards.xp, "progress.reward.experience");
    renderHeaderReward(root, "coins", rewards.coins, "progress.reward.coin");
    root.querySelectorAll("[data-difficulty-level]").forEach((button) => {
      const selected = Number(button.dataset.difficultyLevel) === profile.difficulty;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const description = root.querySelector("#difficultyDescription");
    if (description) description.textContent = profile.difficultyOption.summary;
    const level = root.querySelector("#difficultyLevelSummary");
    if (level) level.textContent = interfaceMessage("progress.level", { level: profile.difficulty });
    const badgeName = root.querySelector("#difficultyBadgeName");
    if (badgeName) badgeName.textContent = profile.difficultyOption.label;
    const xp = root.querySelector("#courseProgressXp");
    if (xp) xp.textContent = String(rewards.xp);
    const coins = root.querySelector("#courseProgressCoins");
    if (coins) coins.textContent = String(rewards.coins);
    const activities = root.querySelector("#courseProgressActivities");
    if (activities) activities.textContent = String(journey.activities);
    const accuracy = root.querySelector("#courseProgressAccuracy");
    if (accuracy) accuracy.textContent = journey.accuracy === null ? "—" : `${journey.accuracy}%`;
    const summary = root.querySelector("#courseProgressSummary");
    if (summary) {
      summary.textContent = journey.activities
        ? interfaceMessage("progress.summary.completed", {
          rounds: interfaceMessage("progress.summary.rounds", { count: journey.rounds }),
          games: interfaceMessage("progress.summary.games", { count: journey.activeGames })
        })
        : interfaceMessage("progress.record.empty");
    }
    const streak = profile.streak || { currentDays: 0, highestDays: 0, remindersEnabled: false };
    root.querySelectorAll("[data-caatuu-streak-count]").forEach((element) => {
      element.textContent = String(streak.currentDays);
    });
    root.querySelectorAll("[data-caatuu-streak-best]").forEach((element) => {
      element.textContent = String(streak.highestDays);
    });
    root.querySelectorAll("[data-caatuu-streak]").forEach((element) => {
      const currentLabel = interfaceMessage("progress.streak.days", { count: streak.currentDays });
      const bestLabel = interfaceMessage("progress.streak.days", { count: streak.highestDays });
      element.setAttribute("aria-label", interfaceMessage("progress.streak.arialabel", {
        current: currentLabel,
        best: bestLabel
      }));
      element.setAttribute("title", interfaceMessage("progress.streak.title", {
        current: currentLabel,
        best: bestLabel
      }));
    });
    renderStreakReminderControls(root, streak);
  }

  function streakNotificationSupported() {
    return window.CaatuuRuntime?.env === "browser"
      && Boolean(window.Notification)
      && window.isSecureContext !== false;
  }

  function streakNotificationPermission() {
    return streakNotificationSupported() ? String(window.Notification.permission || "default") : "unavailable";
  }

  function renderStreakReminderControls(root, streak = learning?.snapshot?.().streak) {
    const permission = streakNotificationPermission();
    root.querySelectorAll("[data-streak-reminder-toggle]").forEach((button) => {
      button.hidden = permission === "unavailable";
      button.disabled = permission === "denied";
      const enabled = permission === "granted" && streak?.remindersEnabled === true;
      button.setAttribute("aria-pressed", String(enabled));
      button.textContent = permission === "denied"
        ? interfaceMessage("progress.reminders.blocked")
        : enabled
          ? interfaceMessage("progress.reminders.on")
          : interfaceMessage("progress.reminders.enable");
      button.setAttribute("aria-label", enabled
        ? interfaceMessage("progress.reminders.turnoff")
        : interfaceMessage("progress.reminders.turnon"));
    });
  }

  function streakReminderCopy(reminder) {
    if (reminder.hours === 3) {
      return {
        title: interfaceMessage("progress.reminders.threehourtitle"),
        body: interfaceMessage("progress.reminders.threehourbody", { count: reminder.currentDays })
      };
    }
    return {
      title: interfaceMessage("progress.reminders.fivehourtitle"),
      body: interfaceMessage("progress.reminders.fivehourbody", { count: reminder.currentDays })
    };
  }

  function renderStreakReminderNotice(reminder) {
    let notice = document.getElementById("streakReminderNotice");
    if (!notice) {
      notice = document.createElement("aside");
      notice.id = "streakReminderNotice";
      notice.className = "streak-reminder-notice";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      document.body.append(notice);
    }
    const copy = streakReminderCopy(reminder);
    const artwork = document.createElement("img");
    artwork.className = "streak-reminder-artwork";
    artwork.src = reminder.imagePath;
    artwork.alt = "";
    artwork.decoding = "async";

    const text = document.createElement("span");
    text.className = "streak-reminder-copy";
    const title = document.createElement("strong");
    title.textContent = copy.title;
    const body = document.createElement("span");
    body.textContent = copy.body;
    text.append(title, body);

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = interfaceMessage("common.gotit");
    dismiss.setAttribute("aria-label", interfaceMessage("progress.reminders.dismiss"));
    dismiss.addEventListener("click", () => {
      notice.hidden = true;
    });
    notice.replaceChildren(artwork, text, dismiss);
    notice.hidden = false;
  }

  async function showStreakSystemNotification(reminder) {
    const streak = learning?.snapshot?.().streak;
    if (
      streakNotificationPermission() !== "granted"
      || streak?.remindersEnabled !== true
    ) return false;
    const copy = streakReminderCopy(reminder);
    const options = {
      body: copy.body,
      icon: streakIconSrc,
      badge: streakIconSrc,
      image: reminder.imagePath,
      tag: `caatuu-streak-${reminder.expiresAt}-${reminder.hours}`,
      renotify: false,
      data: { url: window.location.href }
    };
    try {
      const registration = await window.navigator?.serviceWorker?.ready;
      if (registration?.showNotification) {
        await registration.showNotification(copy.title, options);
        return true;
      }
      new window.Notification(copy.title, options);
      return true;
    } catch (error) {
      return false;
    }
  }

  function nextStreakReminderDelay(streak, now = Date.now()) {
    const expiry = Date.parse(streak?.expiresAt || "");
    if (!streak?.currentDays || !Number.isFinite(expiry) || expiry <= now) return null;
    const delivered = new Set(streak.reminderCycle?.deliveredHours || []);
    const candidates = [];
    if (!delivered.has(5)) candidates.push(expiry - (5 * 60 * 60 * 1000));
    if (!delivered.has(3)) candidates.push(expiry - (3 * 60 * 60 * 1000));
    candidates.push(expiry);
    const target = candidates.sort((left, right) => left - right).find((value) => value > now);
    return target ? Math.max(50, Math.min(2_147_483_647, target - now + 50)) : null;
  }

  function scheduleStreakReminderCheck({ immediate = false } = {}) {
    window.clearTimeout(streakReminderTimer);
    streakReminderTimer = 0;
    if (!learning) return;
    const delay = immediate ? 0 : nextStreakReminderDelay(learning.snapshot().streak);
    if (delay === null) return;
    streakReminderTimer = window.setTimeout(() => {
      void runStreakReminderCheck();
    }, delay);
  }

  function runStreakReminderCheck() {
    if (streakReminderCheckPromise) return streakReminderCheckPromise;
    streakReminderCheckPromise = (async () => {
      const reminders = learning?.dueStreakReminders?.(new Date()) || [];
      const mayNotifyInBackground = streakNotificationPermission() === "granted"
        && learning?.snapshot?.().streak?.remindersEnabled === true;
      if (document.visibilityState === "visible" || mayNotifyInBackground) {
        for (const reminder of reminders) {
          if (document.visibilityState === "visible") renderStreakReminderNotice(reminder);
          await showStreakSystemNotification(reminder);
          learning.markStreakReminderDelivered?.(reminder.expiresAt, reminder.hours);
        }
      }
      renderLearningControls(document);
    })().finally(() => {
      streakReminderCheckPromise = null;
      scheduleStreakReminderCheck();
    });
    return streakReminderCheckPromise;
  }

  async function toggleStreakReminders(button) {
    if (!learning || !streakNotificationSupported()) return;
    const active = learning.snapshot().streak.remindersEnabled === true
      && streakNotificationPermission() === "granted";
    if (active) {
      learning.setStreakRemindersEnabled(false);
      renderLearningControls(document);
      return;
    }
    let permission = streakNotificationPermission();
    if (permission === "default") permission = await window.Notification.requestPermission();
    learning.setStreakRemindersEnabled(permission === "granted");
    renderLearningControls(document);
    const status = document.querySelector("#learningStatus");
    if (status) {
      status.textContent = permission === "granted"
        ? interfaceMessage("progress.reminders.enabledstatus")
        : interfaceMessage("progress.reminders.inappstatus");
    }
    button?.focus?.();
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
        abortController: null,
        scheduledFrame: null,
        scheduledForce: false
      });
    }
    return semanticSkillCompassControllers.get(panel);
  }

  function semanticSkillCompassText(key, replacements = {}) {
    let value = String(semanticSkillCompassCopy?.[key] || "");
    for (const [name, replacement] of Object.entries(replacements)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
    return value;
  }

  function applySemanticSkillCompassCopy(panel) {
    if (!semanticSkillCompassAvailable) return;
    const textBindings = [
      ["#semanticSkillCompassEyebrow", "eyebrow"],
      ["#semanticSkillCompassTitle", "title"],
      ["#semanticSkillCompassSummaryState", "summary"]
    ];
    for (const [selector, key] of textBindings) {
      const target = panel.querySelector(selector);
      if (target) target.textContent = semanticSkillCompassText(key);
    }
    panel.querySelector("#semanticSkillCompassLegendPractice")
      ?.append(semanticSkillCompassText("practiceLabel"));
    panel.querySelector("#semanticSkillCompassLegendStrength")
      ?.append(semanticSkillCompassText("strengthLabel"));
    panel.querySelector(".skill-compass-legend")
      ?.setAttribute("aria-label", semanticSkillCompassText("legendLabel"));
    panel.querySelector("#semanticSkillCompassProgress")
      ?.setAttribute("aria-label", semanticSkillCompassText("progressLabel"));
  }

  function semanticSkillCompassIsVisible(panel) {
    const details = panel?.querySelector("#semanticSkillCompass");
    const stats = panel?.querySelector("#statsViewPanel");
    return Boolean(details?.open && !panel.hidden && stats && !stats.hidden);
  }

  function preparedSemanticSkillCompass() {
    return semanticSkillCompassPrepared?.revision === semanticSkillCompassPreparationRevision
      ? semanticSkillCompassPrepared
      : null;
  }

  async function preloadBackpackStats() {
    if (!semanticSkillCompassAvailable) return null;
    const prepared = preparedSemanticSkillCompass();
    if (prepared) return prepared;
    if (semanticSkillCompassPreparation) return semanticSkillCompassPreparation;

    const revision = semanticSkillCompassPreparationRevision;
    const semanticLearning = window.CaatuuSemanticLearning;
    if (typeof semanticLearning?.readEvidence !== "function"
      || typeof semanticLearning?.projectRadar !== "function") {
      throw new Error("Semantic learning is unavailable.");
    }

    const preparation = (async () => {
      const evidence = await semanticLearning.readEvidence();
      const result = evidence.length
        ? {
            revision,
            empty: false,
            projection: await semanticLearning.projectRadar(semanticSkillCompassAxisPack)
          }
        : { revision, empty: true, projection: null };
      if (revision === semanticSkillCompassPreparationRevision) {
        semanticSkillCompassPrepared = result;
      }
      return result;
    })();
    semanticSkillCompassPreparation = preparation;
    try {
      return await preparation;
    } finally {
      if (semanticSkillCompassPreparation === preparation) {
        semanticSkillCompassPreparation = null;
      }
    }
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
        ["practice", semanticSkillCompassText("practiceLabel"), projected ? semanticCompassPercent(projected.coverage) : semanticSkillCompassText("notMapped")],
        ["strength", semanticSkillCompassText("strengthLabel"), !projected
          ? semanticSkillCompassText("notMapped")
          : (strengthIsReady
            ? semanticCompassPercent(projected.mastery)
            : (Number.isFinite(projected.mastery) ? semanticSkillCompassText("building") : semanticSkillCompassText("notAssessed")))],
        ["confidence", semanticSkillCompassText("confidenceLabel"), projected ? semanticCompassPercent(confidence) : semanticSkillCompassText("notMapped")]
      ];
      for (const [metricId, label, value] of metricValues) {
        const metric = document.createElement("div");
        metric.className = `is-${metricId}`;
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        metric.append(term, description);
        if (metricId === "practice") {
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
    title.textContent = semanticSkillCompassText("chartTitle");
    const description = semanticCompassSvgElement("desc", { id: "semanticSkillCompassChartDescription" });
    description.textContent = semanticSkillCompassText("chartDescription");

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
      const labelPoint = axis.chartLabelBelow
        ? { x: emblemPoint.x, y: emblemPoint.y + 23 }
        : semanticCompassPoint(index, axisCount, 1, semanticSkillCompassLayout.labelRadius);
      const label = semanticCompassSvgElement("text", {
        x: labelPoint.x.toFixed(2),
        y: labelPoint.y.toFixed(2),
        "text-anchor": axis.chartLabelBelow || Math.abs(labelPoint.x - semanticSkillCompassLayout.centerX) < 4
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
      semanticSkillCompassText("idleMessage"),
      semanticSkillCompassText("summary")
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
    if (description) description.textContent = semanticSkillCompassText("emptyChartDescription");
    setSemanticSkillCompassStatus(
      panel,
      "empty",
      semanticSkillCompassText("emptyMessage"),
      semanticSkillCompassText("emptySummary")
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
      description.textContent = semanticSkillCompassText("projectionDescription", {
        practicedCount,
        topicCount: projectedAxes.length,
        strengthCount
      });
    }
    if (!practicedCount) {
      setSemanticSkillCompassStatus(
        panel,
        "ready",
        semanticSkillCompassText("unmappedMessage"),
        semanticSkillCompassText("summary")
      );
    } else if (!strengthCount) {
      setSemanticSkillCompassStatus(
        panel,
        "ready",
        semanticSkillCompassText("practiceOnlyMessage"),
        semanticSkillCompassText("summary")
      );
    } else if (strengthCount < projectedAxes.length) {
      setSemanticSkillCompassStatus(
        panel,
        "ready",
        semanticSkillCompassText("partialStrengthMessage"),
        semanticSkillCompassText("summary")
      );
    } else {
      setSemanticSkillCompassStatus(
        panel,
        "ready",
        semanticSkillCompassText("completeMessage"),
        semanticSkillCompassText("summary")
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
    setSemanticSkillCompassStatus(
      panel,
      "loading",
      semanticSkillCompassText("loadingMessage"),
      semanticSkillCompassText("loadingSummary")
    );

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
      if (revision === semanticSkillCompassPreparationRevision) {
        semanticSkillCompassPrepared = { revision, empty: false, projection };
      }
      renderSemanticSkillCompassProjection(panel, projection);
      controller.rendered = true;
      controller.renderedRevision = revision;
    } catch (error) {
      if (request !== controller.request) return;
      if (error?.name !== "AbortError") {
        setSemanticSkillCompassStatus(
          panel,
          "error",
          semanticSkillCompassText("errorMessage"),
          semanticSkillCompassText("errorSummary")
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

  function scheduleSemanticSkillCompassLoad(panel, { force = false } = {}) {
    const controller = semanticSkillCompassController(panel);
    controller.scheduledForce = controller.scheduledForce || force;
    if (controller.scheduledFrame !== null) return;
    controller.scheduledFrame = window.requestAnimationFrame(() => {
      controller.scheduledFrame = window.requestAnimationFrame(() => {
        controller.scheduledFrame = null;
        const scheduledForce = controller.scheduledForce;
        controller.scheduledForce = false;
        if (semanticSkillCompassIsVisible(panel)) {
          void loadSemanticSkillCompass(panel, { force: scheduledForce });
        }
      });
    });
  }

  function pauseSemanticSkillCompass(panel) {
    const controller = semanticSkillCompassController(panel);
    const wasLoading = controller.loading;
    if (controller.scheduledFrame !== null) {
      window.cancelAnimationFrame(controller.scheduledFrame);
      controller.scheduledFrame = null;
    }
    controller.scheduledForce = false;
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
          ? semanticSkillCompassText("changedMessage")
          : semanticSkillCompassText("closedMessage"),
        controller.rendered
          ? semanticSkillCompassText("updateReadySummary")
          : semanticSkillCompassText("closedSummary")
      );
    }
  }

  function bindSemanticSkillCompass(panel) {
    if (!semanticSkillCompassAvailable) return;
    const details = panel.querySelector("#semanticSkillCompass");
    if (!details) return;
    renderSemanticSkillCompassFrame(panel);
    details.addEventListener("toggle", () => {
      if (details.open) scheduleSemanticSkillCompassLoad(panel);
      else pauseSemanticSkillCompass(panel);
    });
    panel.querySelector("#semanticSkillCompassRetry")?.addEventListener("click", () => {
      scheduleSemanticSkillCompassLoad(panel, { force: true });
    });
    document.addEventListener("caatuu:settings-open", () => {
      if (details.open) scheduleSemanticSkillCompassLoad(panel);
    });
    window.addEventListener("caatuu:semantic-learning-change", () => {
      semanticSkillCompassPreparationRevision += 1;
      semanticSkillCompassPrepared = null;
      const controller = semanticSkillCompassController(panel);
      controller.revision += 1;
      controller.abortController?.abort("Semantic evidence changed");
      if (semanticSkillCompassIsVisible(panel)) scheduleSemanticSkillCompassLoad(panel);
      else if (controller.rendered) {
        const summary = panel.querySelector("#semanticSkillCompassSummaryState");
        if (summary) summary.textContent = semanticSkillCompassText("updateReadySummary");
      }
    });
  }

  function bindLearningControls() {
    document.addEventListener("click", async (event) => {
      const streakReminderButton = event.target.closest?.("[data-streak-reminder-toggle]");
      if (streakReminderButton) {
        event.preventDefault();
        await toggleStreakReminders(streakReminderButton);
        return;
      }

      const difficultyButton = event.target.closest?.("[data-difficulty-level]");
      if (difficultyButton) {
        event.preventDefault();
        learning?.setDifficulty(difficultyButton.dataset.difficultyLevel);
        renderLearningControls(document);
        const status = document.querySelector("#learningStatus");
        const selected = learning?.difficultyOption();
        if (status && selected) {
          status.textContent = interfaceMessage("progress.badge.equipped", {
            level: selected.level,
            badge: selected.label
          });
        }
        return;
      }

      const resetButton = event.target.closest?.("#settingsResetCourseProgress");
      if (!resetButton || !learning) return;
      event.preventDefault();
      if (!confirmButtonPress(resetButton, {
        confirmLabel: interfaceMessage("progress.restart.confirm"),
        message: interfaceMessage("progress.restart.prompt")
      })) return;
      try {
        await learning.prepareProgressReset?.();
      } catch (error) {
        window.dispatchEvent(new CustomEvent("caatuu:progress-reset-cancelled"));
        const status = document.querySelector("#learningStatus");
        if (status) status.textContent = interfaceMessage("progress.restart.failed");
        return;
      }
      learning.resetProgress();
      await window.CaatuuSemanticLearning?.whenIdle?.();
      renderLearningControls(document);
      const status = document.querySelector("#learningStatus");
      if (status) status.textContent = interfaceMessage("progress.restart.completed");
    });

    window.addEventListener("caatuu:learning-change", () => {
      renderLearningControls(document);
      scheduleStreakReminderCheck({ immediate: true });
      document.querySelectorAll("#settingsPanel, [data-caatuu-settings-panel]")
        .forEach((panel) => updateSpeechPaceControls(panel));
    });

    window.addEventListener("storage", (event) => {
      const key = String(event?.key || "");
      if (
        key !== learning?.storage?.streakStorageKey
        && !key.endsWith(".learning.performance.v1")
      ) return;
      renderLearningControls(document);
      scheduleStreakReminderCheck({ immediate: true });
    });
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

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-font-size-option]");
      if (!button) return;
      event.preventDefault();
      applyFontSize(button.dataset.fontSizeOption);
    });
  }

  function closeWorkspaceDisplayMenu({ restoreFocus = false } = {}) {
    const menu = document.querySelector("#setupDisplayMenu");
    if (!menu?.open) return;
    menu.open = false;
    if (restoreFocus) menu.querySelector("summary")?.focus();
  }

  function bindWorkspaceDisplayMenuDismissal() {
    document.addEventListener("click", (event) => {
      const menu = document.querySelector("#setupDisplayMenu");
      if (!menu?.open || menu.contains(event.target)) return;
      closeWorkspaceDisplayMenu();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !document.querySelector("#setupDisplayMenu")?.open) return;
      event.preventDefault();
      closeWorkspaceDisplayMenu({ restoreFocus: true });
    });
  }

  function bindSpeechPreferences() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-speech-mute-toggle]");
      if (!button) return;
      event.preventDefault();
      setSpeechMuted(!getSpeechMuted());
    });

    window.addEventListener("caatuu:speech-pace-change", () => {
      document.querySelectorAll("#settingsPanel, [data-caatuu-settings-panel]")
        .forEach((panel) => updateSpeechPaceControls(panel));
    });
    window.addEventListener("caatuu:speech-mute-change", () => {
      updateSpeechMuteControls(document);
    });
    window.addEventListener("storage", (event) => {
      const key = String(event?.key || "");
      if (key === speechPaceStorageKey) {
        void stopSpeech();
        window.dispatchEvent(new CustomEvent("caatuu:speech-pace-change", {
          detail: {
            preference: getSpeechPacePreference(),
            pace: resolveSpeechPace()
          }
        }));
        return;
      }
      if (key === speechMutedStorageKey) {
        const muted = getSpeechMuted();
        if (muted) void stopSpeech();
        window.dispatchEvent(new CustomEvent("caatuu:speech-mute-change", {
          detail: { muted }
        }));
      }
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
      image.decoding = "async";
      icon.append(image);
      if (item.key === "backpack") {
        const view = readRememberedBackpackView();
        const submenuImage = document.createElement("img");
        submenuImage.className = "app-nav-submenu-icon";
        submenuImage.src = backpackViewOptions[view].iconSrc;
        submenuImage.alt = "";
        submenuImage.setAttribute("aria-hidden", "true");
        submenuImage.decoding = "async";
        submenuImage.dataset.backpackView = view;
        icon.append(submenuImage);
      }
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
      if (item.key === "home") element.dataset.navigationRequest = "home";
    }
    if (item.key === "home" && useViewButton) {
      element.setAttribute("aria-controls", "homeMenu");
      element.setAttribute("aria-expanded", "false");
    }

    appendNavContent(element, item);
    return element;
  }

  function renderBottomNav(nav) {
    const options = {
      activeSection: nav.dataset.activeSection || "",
      viewButtons: nav.dataset.viewButtons === "true",
      settingsTarget: nav.dataset.settingsTarget || "",
      settingsHref: nav.dataset.settingsHref || "index.html"
    };
    const availableItems = navItems.filter((item) => !item.requiresGames || availableGamePresentations().length > 0);
    nav.replaceChildren(...availableItems.map((item) => createNavItem(item, options)));
    syncBackpackViewIndicators(readRememberedBackpackView());
    // A stored game is useful while that game is active, but it must not make
    // Home or the galaxy look as if a planet is currently selected.
    syncGameNavigationIndicators(currentGameId());
    renderHomeMenu();
    renderGameMenu();
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

  function setBottomNavSection(section = "") {
    document.querySelectorAll("[data-caatuu-bottom-nav]").forEach((nav) => {
      nav.dataset.activeSection = section;
      syncBottomNavActive(nav, section);
    });
  }

  function languageShortCode(language) {
    return String(language?.shortCode || language?.id || "")
      .trim()
      .toLocaleUpperCase("en-US")
      .slice(0, 8);
  }

  function currentCourseSelectorRecord() {
    return {
      id: course.id,
      status: course.status,
      routePrefix: course.routePrefix,
      entryPath: course.entryPath,
      sourceLanguage: course.sourceLanguage,
      targetLanguage,
      storage: {
        learningPerformance: course.storage?.learningPerformance
      }
    };
  }

  function courseSelectorRecords() {
    const configured = course.courseSelector?.schemaVersion === 1
      && Array.isArray(course.courseSelector.courses)
      ? course.courseSelector.courses
      : [];
    const records = configured.filter((record) => {
      const entryPath = String(record?.entryPath || "");
      return ["active", "development"].includes(record?.status)
        && String(record?.id || "").trim()
        && String(record?.sourceLanguage?.id || "").trim()
        && String(record?.sourceLanguage?.locale || "").trim()
        && String(record?.targetLanguage?.id || "").trim()
        && String(record?.targetLanguage?.locale || "").trim()
        && entryPath.startsWith("/")
        && !entryPath.startsWith("//");
    });
    if (!records.some((record) => record.id === course.id)) {
      records.unshift(currentCourseSelectorRecord());
    }
    return records;
  }

  function selectorLanguageKey(language) {
    return String(language?.locale || language?.id || "")
      .trim()
      .replace(/_/gu, "-")
      .toLocaleLowerCase("en-US");
  }

  function availableSourceLanguageSelectorRecords() {
    const records = courseSelectorRecords();
    const currentRecord = records.find((record) => record.id === course.id);
    const currentTargetKey = selectorLanguageKey(course.targetLanguage);
    const ordered = currentRecord
      ? [currentRecord, ...records.filter((record) => record !== currentRecord)]
      : records;
    const sources = new Map();
    for (const record of ordered) {
      const sourceKey = selectorLanguageKey(record.sourceLanguage);
      if (!sourceKey) continue;
      const candidate = {
        id: sourceKey,
        courseId: record.id,
        entryPath: record.entryPath,
        language: record.sourceLanguage,
        targetLanguageKey: selectorLanguageKey(record.targetLanguage)
      };
      const existing = sources.get(sourceKey);
      const candidateKeepsTarget = candidate.targetLanguageKey === currentTargetKey;
      const existingKeepsTarget = existing?.targetLanguageKey === currentTargetKey;
      if (!existing || (candidateKeepsTarget && !existingKeepsTarget)) {
        sources.set(sourceKey, candidate);
      }
    }
    return Array.from(sources.values());
  }

  function availableCourseSelectorRecords(sourceId = selectorLanguageKey(course.sourceLanguage)) {
    const normalizedSourceId = String(sourceId || "").trim().toLocaleLowerCase("en-US");
    return courseSelectorRecords().filter(
      (record) => selectorLanguageKey(record.sourceLanguage) === normalizedSourceId
    );
  }

  function selectorCourseSummaries() {
    try {
      if (typeof learning?.courseSummaries === "function") {
        const summaries = learning.courseSummaries();
        if (Array.isArray(summaries)) return summaries;
      }
      if (typeof learning?.snapshot === "function") {
        const summaries = learning.snapshot()?.journey?.courses;
        if (Array.isArray(summaries)) return summaries;
      }
    } catch (error) {
      // Progress is helpful context, but it must never block course selection.
    }
    return [];
  }

  function normalizeSelectorEffort(summary, hasProgress = false) {
    const normalized = summary && typeof summary === "object" ? summary : {};
    const xp = normalizeRewardCount(normalized.xp);
    const rounds = normalizeRewardCount(normalized.rounds);
    const attempts = normalizeRewardCount(normalized.attempts);
    const activities = normalizeRewardCount(normalized.activities);
    return {
      xp,
      rounds,
      hasProgress: Boolean(hasProgress || xp || rounds || attempts || activities)
    };
  }

  function courseSelectorEffort(record, summaries = selectorCourseSummaries()) {
    const matched = summaries.find((summary) => String(summary?.id || "") === String(record?.id || ""));
    if (matched) return normalizeSelectorEffort(matched.summary, matched.hasProgress);
    if (record?.id === course.id) {
      try {
        return normalizeSelectorEffort(learning?.snapshot?.()?.summary);
      } catch (error) {
        return normalizeSelectorEffort(null);
      }
    }
    return normalizeSelectorEffort(null);
  }

  function baseLanguageSelectorEffort(sourceId, summaries = selectorCourseSummaries()) {
    return availableCourseSelectorRecords(sourceId).reduce((total, record) => {
      const effort = courseSelectorEffort(record, summaries);
      total.xp += effort.xp;
      total.rounds += effort.rounds;
      total.hasProgress ||= effort.hasProgress;
      return total;
    }, { xp: 0, rounds: 0, hasProgress: false });
  }

  function selectorEffortLabels(effort) {
    if (!effort?.hasProgress) {
      return {
        visible: interfaceMessage("progress.effort.notstarted"),
        exact: interfaceMessage("progress.effort.none")
      };
    }
    const xp = normalizeRewardCount(effort.xp);
    const rounds = normalizeRewardCount(effort.rounds);
    return {
      visible: interfaceMessage("progress.effort.visible", {
        xp: formatCompactRewardCount(xp),
        rounds: interfaceMessage("progress.effort.rounds", {
          count: rounds,
          formattedcount: formatCompactRewardCount(rounds)
        })
      }),
      exact: interfaceMessage("progress.effort.exact", {
        experience: interfaceMessage("progress.reward.experience", { count: xp }),
        rounds: interfaceMessage("progress.effort.completedrounds", { count: rounds })
      })
    };
  }

  function courseSelectorAvailable(record) {
    return !isNativeShell() || isCourseBundledInNativeShell(record?.id);
  }

  function languageSelectorOptions(menu) {
    return Array.from(
      menu?.querySelectorAll('[data-language-selector-option]:not([aria-disabled="true"])') || []
    );
  }

  function closeLanguageSelectorHost(host, { restoreFocus = false } = {}) {
    if (!host) return;
    const trigger = host.caatuuLanguageSelectorOpener
      || host.querySelector("[data-caatuu-language-switch]");
    const menu = host.querySelector("[data-language-selector-menu]");
    if (!menu) return;
    menu.hidden = true;
    host.querySelectorAll("[data-language-selector-opener]")
      .forEach((opener) => opener.setAttribute("aria-expanded", "false"));
    host.classList.remove("is-open");
    if (activeLanguageSelectorHost === host) activeLanguageSelectorHost = null;
    if (restoreFocus) trigger?.focus();
    host.caatuuLanguageSelectorOpener = null;
  }

  function setLanguageSelectorOpen(host, open, { focusIndex = null, opener = null } = {}) {
    const trigger = opener || host?.querySelector("[data-caatuu-language-switch]");
    const menu = host?.querySelector("[data-language-selector-menu]");
    if (!trigger || !menu) return;
    if (!open) {
      closeLanguageSelectorHost(host);
      return;
    }
    if (activeLanguageSelectorHost && activeLanguageSelectorHost !== host) {
      closeLanguageSelectorHost(activeLanguageSelectorHost);
    }
    if (typeof menu.caatuuResetDraft === "function") menu.caatuuResetDraft();
    host.caatuuLanguageSelectorOpener = trigger;
    activeLanguageSelectorHost = host;
    menu.hidden = false;
    host.querySelectorAll("[data-language-selector-opener]")
      .forEach((candidate) => candidate.setAttribute("aria-expanded", "false"));
    trigger.setAttribute("aria-expanded", "true");
    host.classList.add("is-open");
    if (Number.isInteger(focusIndex)) {
      window.requestAnimationFrame(() => {
        const options = languageSelectorOptions(menu);
        if (!options.length) return;
        const normalizedIndex = (focusIndex + options.length) % options.length;
        options[normalizedIndex].focus();
      });
    }
  }

  function bindLanguageSelectorDismissal() {
    if (languageSelectorDismissalBound) return;
    languageSelectorDismissalBound = true;
    document.addEventListener("click", (event) => {
      if (!activeLanguageSelectorHost || activeLanguageSelectorHost.contains(event.target)) return;
      closeLanguageSelectorHost(activeLanguageSelectorHost);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !activeLanguageSelectorHost) return;
      event.preventDefault();
      closeLanguageSelectorHost(activeLanguageSelectorHost, { restoreFocus: true });
    });
  }

  function createLanguageFlag(language, extraClass = "") {
    const flag = document.createElement("img");
    flag.className = ["caatuu-language-flag", language?.flagClass, extraClass].filter(Boolean).join(" ");
    flag.src = language?.flagSrc || "";
    flag.alt = "";
    flag.width = 30;
    flag.height = 20;
    flag.decoding = "async";
    return flag;
  }

  function createCurrentLanguageFlag() {
    return createLanguageFlag(targetLanguage);
  }

  function renderLanguageIndicator(element) {
    if (!element || element.dataset.caatuuLanguageIndicatorRendered === "true") return;
    element.replaceChildren(createCurrentLanguageFlag());
    element.setAttribute("role", "img");
    element.setAttribute(
      "aria-label",
      interfaceMessage("courseselector.indicator.arialabel", { language: targetLanguageName })
    );
    element.setAttribute("title", interfaceMessage("courseselector.indicator.title", {
      language: targetLanguageName
    }));
    element.dataset.caatuuLanguageIndicatorRendered = "true";
  }

  function populateLanguageSelectorOption(option, language, { statusLabels = [], effort = null } = {}) {
    const localizedName = interfaceLanguageName(language);
    const flag = document.createElement("img");
    flag.className = ["language-selector-option-flag", "caatuu-language-flag", language.flagClass]
      .filter(Boolean)
      .join(" ");
    flag.src = language.flagSrc;
    flag.alt = "";
    flag.width = 30;
    flag.height = 20;
    flag.decoding = "async";

    const copy = document.createElement("span");
    copy.className = "language-selector-option-copy";
    const nativeLabel = document.createElement("strong");
    nativeLabel.lang = language.locale;
    nativeLabel.dir = language.direction || "auto";
    nativeLabel.textContent = String(language.nativeLabel || localizedName).trim();
    copy.append(nativeLabel);
    if (localizedName !== nativeLabel.textContent) {
      const translatedLabel = document.createElement("small");
      translatedLabel.textContent = localizedName;
      copy.append(translatedLabel);
    }
    if (effort) {
      const effortLabels = selectorEffortLabels(effort);
      const effortLabel = document.createElement("small");
      effortLabel.className = "language-selector-effort";
      effortLabel.textContent = effortLabels.visible;
      effortLabel.setAttribute("title", effortLabels.exact);
      copy.append(effortLabel);
      option.dataset.languageEffort = effortLabels.visible;
      option.dataset.languageEffortExact = effortLabels.exact;
    }

    const meta = document.createElement("span");
    meta.className = "language-selector-option-meta";
    const code = document.createElement("span");
    code.className = "language-selector-option-code";
    code.textContent = languageShortCode(language);
    meta.append(code);
    for (const label of statusLabels) {
      const status = document.createElement("span");
      status.className = "language-selector-status";
      status.textContent = label;
      meta.append(status);
    }

    option.append(flag, copy, meta);
  }

  function createBaseLanguageSelectorOption(record, state, summaries, onSelect) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "language-selector-option";
    option.dataset.languageSelectorOption = "";
    option.dataset.languageBaseOption = record.id;
    option.setAttribute("role", "radio");
    const selected = record.id === state.sourceId;
    option.setAttribute("aria-checked", String(selected));

    const compatibleCourses = availableCourseSelectorRecords(record.id);
    const unavailableInNativeShell = isNativeShell()
      && !compatibleCourses.some((candidate) => courseSelectorAvailable(candidate));
    if (unavailableInNativeShell) {
      option.setAttribute("aria-disabled", "true");
      option.disabled = true;
      option.tabIndex = -1;
    }

    const effort = baseLanguageSelectorEffort(record.id, summaries);
    const statusLabels = [];
    const current = record.id === selectorLanguageKey(course.sourceLanguage);
    if (current) statusLabels.push(interfaceMessage("common.current"));
    else if (selected) statusLabels.push(interfaceMessage("common.selected"));
    if (unavailableInNativeShell) statusLabels.push(interfaceMessage("common.browseronly"));
    populateLanguageSelectorOption(option, record.language, { statusLabels, effort });
    const effortLabels = selectorEffortLabels(effort);
    option.setAttribute(
      "aria-label",
      interfaceMessage("courseselector.option.arialabel", {
        language: interfaceLanguageName(record.language),
        effort: effortLabels.exact,
        status: statusLabels.length
          ? interfaceMessage("courseselector.option.status", { status: statusLabels.join(". ") })
          : ""
      })
    );
    option.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (unavailableInNativeShell) return;
      onSelect(record.id);
    });
    return option;
  }

  function createLanguageSelectorOption(record, state, summaries, onSelect) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "language-selector-option";
    option.dataset.languageSelectorOption = "";
    option.dataset.languageCourseOption = record.id;
    option.dataset.courseStatus = record.status;
    option.setAttribute("role", "radio");
    const selected = record.id === state.courseId;
    const current = record.id === course.id;
    option.setAttribute("aria-checked", String(selected));
    if (current) option.setAttribute("aria-current", "page");

    const unavailableInNativeShell = !courseSelectorAvailable(record);
    if (unavailableInNativeShell) {
      option.setAttribute("aria-disabled", "true");
      option.disabled = true;
      option.tabIndex = -1;
    }

    const statusLabels = [];
    if (current) statusLabels.push(interfaceMessage("common.current"));
    else if (selected) statusLabels.push(interfaceMessage("common.selected"));
    if (record.status === "development") {
      statusLabels.push(interfaceMessage("common.preview"));
    }
    if (unavailableInNativeShell) {
      statusLabels.push(interfaceMessage("common.browseronly"));
    }
    const effort = courseSelectorEffort(record, summaries);
    populateLanguageSelectorOption(option, record.targetLanguage, { statusLabels, effort });
    const effortLabels = selectorEffortLabels(effort);
    option.setAttribute(
      "aria-label",
      interfaceMessage("courseselector.option.arialabel", {
        language: interfaceLanguageName(record.targetLanguage),
        effort: effortLabels.exact,
        status: statusLabels.length
          ? interfaceMessage("courseselector.option.status", { status: statusLabels.join(". ") })
          : ""
      })
    );
    option.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (unavailableInNativeShell) return;
      onSelect(record.id);
    });
    return option;
  }

  function createLanguageSelectorMenu(host, trigger) {
    const menu = document.createElement("div");
    menu.className = "language-selector-menu home-language-selector-menu";
    menu.dataset.languageSelectorMenu = "";
    menu.id = "caatuuLanguageSelectorMenu" + (++languageSelectorSequence);
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-modal", "false");
    menu.hidden = true;

    const form = document.createElement("form");
    form.className = "language-selector-form";

    const heading = document.createElement("h3");
    heading.className = "language-selector-form-title";
    heading.id = menu.id + "Title";
    heading.textContent = interfaceMessage("courseselector.heading");
    menu.setAttribute("aria-labelledby", heading.id);

    const introduction = document.createElement("p");
    introduction.className = "language-selector-form-intro";
    introduction.textContent = interfaceMessage("courseselector.introduction");

    const choiceStage = document.createElement("div");
    choiceStage.className = "language-selector-choice-stage";
    choiceStage.dataset.languageSelectorChoiceStage = "";

    const sourceQuestion = document.createElement("fieldset");
    sourceQuestion.className = "language-selector-question";
    const sourceLegend = document.createElement("legend");
    sourceLegend.className = "language-selector-question-title";
    sourceLegend.id = menu.id + "SourceLabel";
    const sourceStep = document.createElement("span");
    sourceStep.setAttribute("aria-hidden", "true");
    sourceStep.textContent = "1";
    sourceLegend.append(sourceStep, ` ${interfaceMessage("courseselector.sourcequestion")}`);
    const sourceOptions = document.createElement("div");
    sourceOptions.className = "language-selector-options";
    sourceOptions.dataset.languageSourceOptions = "";
    sourceOptions.setAttribute("role", "radiogroup");
    sourceOptions.setAttribute("aria-labelledby", sourceLegend.id);
    sourceQuestion.append(sourceLegend, sourceOptions);

    const targetQuestion = document.createElement("fieldset");
    targetQuestion.className = "language-selector-question";
    const targetLegend = document.createElement("legend");
    targetLegend.className = "language-selector-question-title";
    targetLegend.id = menu.id + "TargetLabel";
    const targetStep = document.createElement("span");
    targetStep.setAttribute("aria-hidden", "true");
    targetStep.textContent = "2";
    targetLegend.append(targetStep, ` ${interfaceMessage("courseselector.targetquestion")}`);
    const targetOptions = document.createElement("div");
    targetOptions.className = "language-selector-options";
    targetOptions.dataset.languageTargetOptions = "";
    targetOptions.setAttribute("role", "radiogroup");
    targetOptions.setAttribute("aria-labelledby", targetLegend.id);
    targetQuestion.append(targetLegend, targetOptions);

    const selectionStatus = document.createElement("p");
    selectionStatus.className = "language-selector-selection-status";
    selectionStatus.dataset.languageSelectionStatus = "";
    selectionStatus.setAttribute("aria-live", "polite");

    const choiceActions = document.createElement("div");
    choiceActions.className = "language-selector-form-actions";
    const cancel = document.createElement("button");
    cancel.className = "language-selector-action is-secondary";
    cancel.type = "button";
    cancel.dataset.languageSelectorCancel = "";
    cancel.textContent = interfaceMessage("common.cancel");
    const review = document.createElement("button");
    review.className = "language-selector-action is-primary";
    review.type = "button";
    review.dataset.languageSelectorReview = "";
    review.textContent = interfaceMessage("common.continue");
    choiceActions.append(cancel, review);
    choiceStage.append(sourceQuestion, targetQuestion, selectionStatus, choiceActions);

    const reviewStage = document.createElement("section");
    reviewStage.className = "language-selector-review";
    reviewStage.dataset.languageSelectorReviewStage = "";
    reviewStage.hidden = true;
    const reviewKicker = document.createElement("p");
    reviewKicker.className = "language-selector-kicker";
    reviewKicker.textContent = interfaceMessage("courseselector.review.kicker");
    const reviewHeading = document.createElement("div");
    reviewHeading.className = "language-selector-review-heading";
    const reviewTitle = document.createElement("h4");
    reviewTitle.dataset.languageSelectorReviewTitle = "";
    reviewHeading.append(reviewTitle);
    const reviewCopy = document.createElement("p");
    reviewCopy.dataset.languageSelectorReviewCopy = "";
    const reviewStatus = document.createElement("p");
    reviewStatus.className = "language-selector-review-status";
    reviewStatus.dataset.languageSelectorReviewStatus = "";
    const reviewInfo = document.createElement("span");
    reviewInfo.className = "language-selector-review-info";
    reviewInfo.dataset.languageSelectorReviewInfo = "";
    reviewInfo.setAttribute("aria-hidden", "true");
    reviewInfo.textContent = "i";
    const reviewStatusCopy = document.createElement("span");
    reviewStatus.append(reviewInfo, reviewStatusCopy);
    const reviewActions = document.createElement("div");
    reviewActions.className = "language-selector-form-actions";
    const back = document.createElement("button");
    back.className = "language-selector-action is-secondary";
    back.type = "button";
    back.dataset.languageSelectorBack = "";
    back.textContent = interfaceMessage("common.back");
    const confirm = document.createElement("button");
    confirm.className = "language-selector-action is-primary";
    confirm.type = "button";
    confirm.dataset.languageSelectorConfirm = "";
    confirm.textContent = interfaceMessage("common.confirm");
    reviewActions.append(back, confirm);
    reviewStage.append(reviewKicker, reviewHeading, reviewCopy, reviewStatus, reviewActions);

    form.append(heading, introduction, choiceStage, reviewStage);
    menu.append(form);
    trigger.setAttribute("aria-controls", menu.id);
    trigger.setAttribute("aria-expanded", "false");

    const state = {
      sourceId: selectorLanguageKey(course.sourceLanguage),
      courseId: String(course.id || "")
    };

    function selectedCourseRecord() {
      return courseSelectorRecords().find((record) => record.id === state.courseId) || null;
    }

    function renderDraft() {
      const summaries = selectorCourseSummaries();
      sourceOptions.replaceChildren(...availableSourceLanguageSelectorRecords().map((record) => (
        createBaseLanguageSelectorOption(record, state, summaries, (sourceId) => {
          const draftTargetKey = selectorLanguageKey(selectedCourseRecord()?.targetLanguage);
          state.sourceId = sourceId;
          const compatible = availableCourseSelectorRecords(sourceId).filter(courseSelectorAvailable);
          if (!compatible.some((record) => record.id === state.courseId)) {
            const sameTarget = compatible.find(
              (record) => selectorLanguageKey(record.targetLanguage) === draftTargetKey
            );
            state.courseId = (sameTarget || compatible[0])?.id || "";
          }
          renderDraft();
        })
      )));

      targetOptions.replaceChildren(...availableCourseSelectorRecords(state.sourceId).map((record) => (
        createLanguageSelectorOption(record, state, summaries, (courseId) => {
          state.courseId = courseId;
          renderDraft();
        })
      )));

      const selected = selectedCourseRecord();
      const changed = Boolean(selected && selected.id !== course.id);
      review.disabled = !changed;
      review.setAttribute("aria-disabled", String(!changed));
      selectionStatus.textContent = changed
        ? interfaceMessage("courseselector.selection.changed", {
          language: interfaceLanguageName(selected.targetLanguage)
        })
        : interfaceMessage("courseselector.selection.current", { language: targetLanguageName });
    }

    function showChoices({ focusReview = false } = {}) {
      reviewStage.hidden = true;
      choiceStage.hidden = false;
      menu.classList.remove("is-reviewing");
      if (focusReview) review.focus();
    }

    function showReview() {
      const selected = selectedCourseRecord();
      if (!selected || selected.id === course.id || !courseSelectorAvailable(selected)) return;
      const targetName = interfaceLanguageName(selected.targetLanguage);
      reviewTitle.textContent = interfaceMessage("courseselector.review.title", { language: targetName });
      const reviewFlag = createLanguageFlag(selected.targetLanguage, "language-selector-review-flag");
      reviewFlag.dataset.languageSelectorReviewFlag = "";
      reviewHeading.replaceChildren(reviewTitle, reviewFlag);
      reviewCopy.textContent = interfaceMessage("courseselector.review.progress", {
        language: targetLanguageName
      });
      reviewStatusCopy.textContent = interfaceMessage("courseselector.review.sharedprogress", {
        language: targetLanguageName
      });
      choiceStage.hidden = true;
      reviewStage.hidden = false;
      menu.classList.add("is-reviewing");
      confirm.focus();
    }

    menu.caatuuResetDraft = () => {
      state.sourceId = selectorLanguageKey(course.sourceLanguage);
      state.courseId = String(course.id || "");
      renderDraft();
      showChoices();
    };

    menu.caatuuReviewCourse = (courseId) => {
      const selected = courseSelectorRecords().find((record) => record.id === courseId);
      if (!selected || selected.id === course.id || !courseSelectorAvailable(selected)) return false;
      state.sourceId = selectorLanguageKey(selected.sourceLanguage);
      state.courseId = selected.id;
      renderDraft();
      showReview();
      return true;
    };

    cancel.addEventListener("click", () => closeLanguageSelectorHost(host, { restoreFocus: true }));
    review.addEventListener("click", showReview);
    back.addEventListener("click", () => showChoices({ focusReview: true }));
    confirm.addEventListener("click", () => {
      const selected = selectedCourseRecord();
      if (!selected || selected.id === course.id || !courseSelectorAvailable(selected)) return;
      closeLanguageSelectorHost(host);
      if (typeof window.location.assign === "function") window.location.assign(selected.entryPath);
      else window.location.href = selected.entryPath;
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (reviewStage.hidden) showReview();
    });

    menu.caatuuResetDraft();
    menu.addEventListener("keydown", (event) => {
      const entries = languageSelectorOptions(menu);
      if (!entries.length) return;
      const currentIndex = entries.indexOf(document.activeElement);
      let nextIndex = null;
      if (currentIndex >= 0 && event.key === "ArrowDown") nextIndex = currentIndex + 1;
      if (currentIndex >= 0 && event.key === "ArrowUp") nextIndex = currentIndex - 1;
      if (currentIndex >= 0 && event.key === "Home") nextIndex = 0;
      if (currentIndex >= 0 && event.key === "End") nextIndex = entries.length - 1;
      if (nextIndex !== null) {
        event.preventDefault();
        entries[(nextIndex + entries.length) % entries.length].focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeLanguageSelectorHost(host, { restoreFocus: true });
      }
    });
    return menu;
  }

  function createHomeLanguagePair(record) {
    const flags = document.createElement("span");
    flags.className = "home-language-pair";
    flags.setAttribute("aria-hidden", "true");
    const sourceFlag = createLanguageFlag(record.sourceLanguage, "home-language-pair-flag");
    const routeArrow = document.createElement("span");
    routeArrow.className = "home-language-pair-arrow";
    routeArrow.textContent = "→";
    const targetFlag = createLanguageFlag(record.targetLanguage, "home-language-pair-flag");
    flags.append(sourceFlag, routeArrow, targetFlag);
    return flags;
  }

  function createHomeCurrentCourse() {
    const record = currentCourseSelectorRecord();
    const effortLabels = selectorEffortLabels(
      courseSelectorEffort(record, selectorCourseSummaries())
    );
    const current = document.createElement("div");
    current.className = "home-language-current-course";
    current.dataset.homeLanguageCurrentCourse = record.id;
    current.setAttribute("role", "group");
    current.setAttribute(
      "aria-label",
      interfaceMessage("courseselector.current.arialabel", {
        source: interfaceLanguageName(record.sourceLanguage),
        target: interfaceLanguageName(record.targetLanguage),
        effort: effortLabels.exact
      })
    );

    const copy = document.createElement("span");
    copy.className = "home-language-switch-copy";
    const kicker = document.createElement("span");
    kicker.className = "home-language-switch-kicker";
    kicker.textContent = interfaceMessage("courseselector.current.label");
    const routeLabel = document.createElement("strong");
    const sourceName = interfaceLanguageName(record.sourceLanguage);
    const targetName = interfaceLanguageName(record.targetLanguage);
    routeLabel.textContent = `${sourceName} → ${targetName}`;
    const effort = document.createElement("small");
    effort.className = "home-language-switch-effort";
    effort.textContent = effortLabels.visible;
    effort.setAttribute("title", effortLabels.exact);
    copy.append(kicker, routeLabel, effort);

    const status = document.createElement("span");
    status.className = "home-language-current-status";
    status.textContent = interfaceMessage("common.current");
    current.append(createHomeLanguagePair(record), copy, status);
    current.dataset.languageEffort = effortLabels.visible;
    current.dataset.languageEffortExact = effortLabels.exact;
    return current;
  }

  function createHomeLanguageQuickSwitches(host, menu, headingId) {
    const summaries = selectorCourseSummaries();
    const engaged = courseSelectorRecords()
      .filter((record) => record.id !== course.id)
      .map((record) => ({ record, effort: courseSelectorEffort(record, summaries) }))
      .filter(({ effort }) => effort.hasProgress);
    if (!engaged.length) return null;

    const list = document.createElement("nav");
    list.className = "home-language-quick-switches";
    list.dataset.homeLanguageQuickSwitches = "";
    list.setAttribute("aria-labelledby", headingId);
    for (const { record, effort } of engaged) {
      const available = courseSelectorAvailable(record);
      const effortLabels = selectorEffortLabels(effort);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "home-language-quick-switch";
      button.dataset.homeLanguageQuickCourse = record.id;
      button.dataset.languageSelectorOpener = "";
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", menu.id);
      button.setAttribute("aria-expanded", "false");
      if (!available) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }

      const copy = document.createElement("span");
      copy.className = "home-language-switch-copy";
      const kicker = document.createElement("span");
      kicker.className = "home-language-switch-kicker";
      kicker.textContent = record.status === "development"
        ? interfaceMessage("courseselector.course.preview")
        : interfaceMessage("courseselector.course.yours");
      const routeLabel = document.createElement("strong");
      const sourceName = interfaceLanguageName(record.sourceLanguage);
      const targetName = interfaceLanguageName(record.targetLanguage);
      routeLabel.textContent = `${sourceName} → ${targetName}`;
      const effortLabel = document.createElement("small");
      effortLabel.className = "home-language-switch-effort";
      effortLabel.textContent = effortLabels.visible;
      effortLabel.setAttribute("title", effortLabels.exact);
      copy.append(kicker, routeLabel, effortLabel);

      const action = document.createElement("span");
      action.className = "home-language-switch-action";
      const actionLabel = document.createElement("span");
      actionLabel.textContent = available
        ? interfaceMessage("courseselector.action.switch")
        : interfaceMessage("common.browseronly");
      const actionArrow = document.createElement("span");
      actionArrow.className = "home-language-switch-action-arrow";
      actionArrow.setAttribute("aria-hidden", "true");
      actionArrow.textContent = "›";
      action.append(actionLabel, actionArrow);
      button.append(createHomeLanguagePair(record), copy, action);
      button.dataset.languageEffort = effortLabels.visible;
      button.dataset.languageEffortExact = effortLabels.exact;
      const quickSwitchMessageId = available
        ? record.status === "development"
          ? "courseselector.quick.preview"
          : "courseselector.quick.available"
        : record.status === "development"
          ? "courseselector.quick.unavailablepreview"
          : "courseselector.quick.unavailable";
      button.setAttribute("aria-label", interfaceMessage(quickSwitchMessageId, {
        source: interfaceLanguageName(record.sourceLanguage),
        target: interfaceLanguageName(record.targetLanguage),
        effort: effortLabels.exact
      }));
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!available) return;
        setLanguageSelectorOpen(host, true, { opener: button });
        menu.caatuuReviewCourse?.(record.id);
      });
      list.append(button);
    }
    return list;
  }

  function createHomeLanguageOngoingCourses(host, menu, trigger) {
    const section = document.createElement("section");
    section.className = "home-language-ongoing-courses";
    section.dataset.homeLanguageOngoingCourses = "";
    const header = document.createElement("header");
    header.className = "home-language-ongoing-head";
    const heading = document.createElement("h3");
    heading.id = menu.id + "OngoingTitle";
    heading.textContent = interfaceMessage("courseselector.ongoing.heading");

    trigger.className = "home-language-manage";
    const manageIcon = document.createElement("span");
    manageIcon.className = "home-language-manage-icon";
    manageIcon.setAttribute("aria-hidden", "true");
    manageIcon.textContent = "+";
    const manageLabel = document.createElement("span");
    manageLabel.textContent = interfaceMessage("courseselector.newcourse");
    trigger.replaceChildren(manageIcon, manageLabel);
    trigger.setAttribute("aria-label", interfaceMessage("courseselector.startnew"));
    trigger.setAttribute("title", interfaceMessage("courseselector.startnew"));
    header.append(heading, trigger);
    section.append(header);

    const quickSwitches = createHomeLanguageQuickSwitches(host, menu, heading.id);
    if (quickSwitches) {
      host.classList.add("has-quick-courses");
      section.append(quickSwitches);
    } else {
      const empty = document.createElement("p");
      empty.className = "home-language-ongoing-empty";
      empty.textContent = interfaceMessage("courseselector.ongoing.empty");
      section.append(empty);
    }
    return section;
  }

  function renderLanguageSwitch(element) {
    if (!element || element.dataset.caatuuLanguageSelectorRendered === "true") return;
    const homeVariant = element.dataset.languageSwitchVariant === "home";
    const currentCourse = homeVariant ? createHomeCurrentCourse() : null;
    if (!homeVariant) {
      element.replaceChildren(createCurrentLanguageFlag());
    }
    if (element.tagName === "BUTTON") element.type = "button";
    else {
      element.removeAttribute("href");
      element.setAttribute("role", "button");
      element.tabIndex = 0;
    }
    element.setAttribute("aria-haspopup", "dialog");
    element.dataset.languageSelectorOpener = "";
    if (!element.getAttribute("aria-label")) {
      element.setAttribute(
        "aria-label",
        interfaceMessage("courseselector.trigger.arialabel", {
          source: interfaceLanguageName(course.sourceLanguage),
          target: targetLanguageName
        })
      );
    }

    const host = document.createElement("div");
    host.className = "language-selector";
    element.before(host);
    if (!homeVariant) host.append(element);
    const menu = createLanguageSelectorMenu(host, element);
    if (homeVariant) {
      host.classList.add("home-language-selector");
      host.append(currentCourse, createHomeLanguageOngoingCourses(host, menu, element));
    }
    host.append(menu);

    element.addEventListener("click", (event) => {
      event.preventDefault();
      setLanguageSelectorOpen(host, menu.hidden, { opener: element });
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setLanguageSelectorOpen(host, true, {
          focusIndex: event.key === "ArrowDown" ? 0 : -1,
          opener: element
        });
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeLanguageSelectorHost(host, { restoreFocus: true });
      } else if (element.tagName !== "BUTTON" && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        setLanguageSelectorOpen(host, menu.hidden, { opener: element });
      }
    });
    element.dataset.caatuuLanguageSelectorRendered = "true";
    bindLanguageSelectorDismissal();
  }

  function renderAppHeader(header) {
    header.replaceChildren();

    const rawPageKicker = String(
      header.dataset.caatuuPageKicker || course.workspaceLabel || course.brandLabel || "Caatuu"
    ).trim();
    const rawPageTitle = String(header.dataset.caatuuPageTitle || "Home").trim();
    const pageKicker = rawPageKicker === "Train" ? interfaceMessage("chrome.train") : rawPageKicker;
    const pageTitle = rawPageTitle === "Home"
      ? interfaceMessage("nav.home")
      : rawPageTitle === "Games"
        ? interfaceMessage("nav.games")
        : rawPageTitle;
    const pageIcon = String(header.dataset.caatuuPageIcon || "/language-runtime/static/assets/caatuu-shell-512.png").trim();

    const brandOpensGameMenu = rawPageTitle === "Games" || pageTitle === interfaceMessage("nav.games");
    const brand = document.createElement("a");
    brand.className = "brand-link";
    brand.href = brandOpensGameMenu ? course.routes.games : course.routes.home;
    if (brandOpensGameMenu) {
      brand.dataset.gameMenuLauncher = "";
      brand.setAttribute("aria-label", interfaceMessage("nav.opengamechooser"));
      brand.title = interfaceMessage("nav.opengamechooser");
    } else {
      brand.dataset.navigationRequest = "home";
      brand.setAttribute("aria-label", interfaceMessage("nav.openworkspacehome", {
        workspace: course.workspaceLabel
      }));
    }

    const mark = document.createElement("span");
    mark.className = "brand-mark";
    mark.setAttribute("aria-hidden", "true");

    const icon = document.createElement("img");
    icon.className = "brand-icon";
    icon.src = pageIcon;
    icon.alt = "";
    icon.decoding = "async";

    const pageCopy = document.createElement("span");
    pageCopy.className = "app-header-page-copy";

    const pageKickerLabel = document.createElement("span");
    pageKickerLabel.className = "app-header-page-kicker";
    pageKickerLabel.textContent = pageKicker;

    const pageTitleLabel = document.createElement("strong");
    pageTitleLabel.className = "app-header-page-title";
    pageTitleLabel.textContent = pageTitle;

    const screenTitle = document.createElement("strong");
    screenTitle.className = "app-header-title";
    screenTitle.hidden = true;

    const screenBack = document.createElement("a");
    screenBack.className = "app-header-back";
    screenBack.hidden = true;

    const screenCenter = document.createElement("span");
    screenCenter.className = "app-header-center";

    const language = document.createElement("span");
    language.className = "language-pill app-header-language-pill current-language-indicator";
    language.dataset.caatuuLanguageIndicator = "";

    const headerStats = document.createElement("span");
    headerStats.className = "app-header-stats";
    headerStats.setAttribute("aria-label", interfaceMessage("progress.journeyrewards"));

    const createHeaderStat = (kind, iconSrc) => {
      const stat = document.createElement("span");
      stat.className = `app-header-stat app-header-${kind}`;
      stat.setAttribute(`data-caatuu-header-${kind}`, "");

      const statIcon = document.createElement("img");
      statIcon.src = iconSrc;
      statIcon.alt = "";
      statIcon.decoding = "async";
      statIcon.setAttribute("aria-hidden", "true");

      const statCount = document.createElement("strong");
      statCount.setAttribute(`data-caatuu-header-${kind}-count`, "");
      statCount.textContent = "0";
      stat.append(statIcon, statCount);
      return stat;
    };

    const xp = createHeaderStat("xp", experienceIconSrc);
    const coins = createHeaderStat("coins", coinIconSrc);
    const streak = createHeaderStat("streak", streakIconSrc);
    streak.removeAttribute("data-caatuu-header-streak");
    streak.setAttribute("data-caatuu-streak", "");
    streak.querySelector("strong")?.removeAttribute("data-caatuu-header-streak-count");
    streak.querySelector("strong")?.setAttribute("data-caatuu-streak-count", "");
    headerStats.append(xp, coins, streak);

    const actions = document.createElement("span");
    actions.className = "header-actions";

    mark.append(icon);
    pageCopy.append(pageKickerLabel, pageTitleLabel);
    brand.append(mark, pageCopy);
    screenCenter.append(screenTitle);
    actions.append(headerStats, language);
    header.append(brand, screenBack, screenCenter, actions);
    renderLanguageIndicator(language);
    renderLearningControls(header);
    updateThemeControls(readStoredTheme());

    const initialTitle = String(header.dataset.caatuuHeaderTitle || "").trim();
    if (initialTitle) {
      setHeaderTitle(initialTitle, {
        backLabel: header.dataset.caatuuHeaderBackLabel || interfaceMessage("nav.backtomenu"),
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
      const presentation = gamePresentation(gameId);
      element.replaceChildren();
      if (presentation?.iconSrc) {
        const titleIcon = document.createElement("img");
        titleIcon.className = "app-header-title-icon";
        titleIcon.src = presentation.iconSrc;
        titleIcon.alt = "";
        titleIcon.decoding = "async";
        titleIcon.setAttribute("aria-hidden", "true");
        element.append(titleIcon);
      }
      if (normalizedTitle) {
        const titleCopy = document.createElement("span");
        titleCopy.className = "app-header-title-copy";

        const titleKicker = document.createElement("span");
        titleKicker.className = "app-header-title-kicker";
        titleKicker.textContent = interfaceMessage("chrome.train");

        const titleLabel = document.createElement("span");
        titleLabel.className = "app-header-title-label";
        titleLabel.textContent = normalizedTitle;
        titleCopy.append(titleKicker, titleLabel);
        element.append(titleCopy);
      }
      element.hidden = !normalizedTitle;
      if (gameId) rememberActiveGame(gameId);
      if (header) {
        if (gameId) header.dataset.caatuuActiveGame = gameId;
        else delete header.dataset.caatuuActiveGame;
      }

      const backHref = String(options.backHref || "").trim();
      const rawBackLabel = String(options.backLabel || interfaceMessage("nav.backtomenu")).trim();
      const conciseBackLabel = rawBackLabel.replace(/^[←‹]\s*/, "").trim();
      const accessibleBackLabel = /^[←‹]/u.test(rawBackLabel)
        ? interfaceMessage("nav.backto", { destination: conciseBackLabel })
        : conciseBackLabel || interfaceMessage("common.goback");
      back.replaceChildren();
      if (gameId) {
        const backArtwork = document.createElement("img");
        backArtwork.className = "app-header-back-image";
        backArtwork.src = "/assets/icons/games_icon.png";
        backArtwork.alt = "";
        backArtwork.decoding = "async";
        backArtwork.setAttribute("aria-hidden", "true");
        back.append(backArtwork);
      } else {
        const backIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        backIcon.classList.add("app-header-back-icon");
        backIcon.setAttribute("viewBox", "0 0 24 24");
        backIcon.setAttribute("aria-hidden", "true");
        const backPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        backPath.setAttribute("d", "M15 5.5 8.5 12l6.5 6.5");
        backIcon.append(backPath);
        back.append(backIcon);
      }
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

  function setPagePresentation({
    kicker = interfaceMessage("chrome.train"),
    title = interfaceMessage("nav.games"),
    iconSrc = "/assets/icons/games_icon.png"
  } = {}) {
    document.querySelectorAll(".app-header").forEach((header) => {
      header.dataset.caatuuPageKicker = kicker;
      header.dataset.caatuuPageTitle = title;
      header.dataset.caatuuPageIcon = iconSrc;
      renderAppHeader(header);
    });
  }

  function renderDeveloperToolLinks() {
    const capabilities = course.capabilities || {};
    const routes = course.routes || {};
    return [
      { href: routes.chat, label: "debug-chat", available: capabilities.chat === true },
      {
        href: routes.audioLab,
        label: "audio-lab",
        available: capabilities.speech === true && capabilities.offlineModels === true
      },
      {
        href: routes.dictionary,
        label: `${course.id}-dictionary`,
        navigationRequest: "dictionary",
        available: capabilities.dictionary === true
      },
      {
        href: routes.embeddingImages,
        label: "embedding-images",
        available: capabilities.embeddings === true
          && capabilities.semanticSearch === true
          && capabilities.offlineModels === true
      },
      { href: routes.verbDifficulty, label: "verb-difficulty", available: capabilities.verbs === true }
    ]
      .filter((tool) => tool.available && typeof tool.href === "string" && tool.href.length > 0)
      .map((tool) => {
        const navigationRequest = tool.navigationRequest
          ? ` data-navigation-request="${tool.navigationRequest}"`
          : "";
        return `<a class="advanced-link" href="${tool.href}"${navigationRequest}>${tool.label}</a>`;
      })
      .join("");
  }

  function reconcileDeveloperToolVisibility(panel, developerToolLinks) {
    if (developerToolLinks) return;
    const details = panel.querySelector(".developer-tools-details");
    const list = details?.querySelector(".advanced-link-list");
    if (!details || !list) return;
    details.dataset.capabilityState = "disabled";
    const message = document.createElement("p");
    message.className = "settings-unavailable-note";
    message.textContent = interfaceMessage("settings.developer.none");
    list.replaceChildren(message);
  }

  function configureAiSettingsAvailability(panel, supported) {
    if (supported) return;
    const card = panel.querySelector(".ai-settings-card");
    const controls = card?.querySelector(".settings-details:not(.developer-tools-details)");
    if (!card || !controls) return;

    const message = interfaceMessage("settings.ai.unavailable.detail");
    controls.dataset.capabilityState = "disabled";
    controls.setAttribute("aria-describedby", "capabilityNote");

    const controlsSummary = controls.querySelector(".settings-collapsible-summary small");
    if (controlsSummary) controlsSummary.textContent = interfaceMessage("common.unavailable");
    const modelSummary = controls.querySelector("#modelChoiceSummary");
    if (modelSummary) modelSummary.textContent = interfaceMessage("settings.course.notavailable");
    const settingsSummary = controls.querySelector("#settingsSummary");
    if (settingsSummary) settingsSummary.textContent = interfaceMessage("settings.ai.unavailable.short");
    for (const id of ["thinkingSupport", "temperatureSupport", "contextSupport"]) {
      const support = controls.querySelector(`#${id}`);
      if (support) support.textContent = interfaceMessage("settings.course.unavailable");
    }
    const capabilityNote = controls.querySelector("#capabilityNote");
    if (capabilityNote) {
      capabilityNote.textContent = message;
      capabilityNote.setAttribute("role", "note");
    }

    const modelSelect = controls.querySelector("#settingsModel");
    if (modelSelect) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = interfaceMessage("settings.course.notavailable");
      modelSelect.replaceChildren(option);
    }
    controls.querySelectorAll("button, input, select").forEach((control) => {
      control.disabled = true;
      control.setAttribute("aria-disabled", "true");
    });

    const legalNotice = panel.querySelector(".legal-notice");
    const legalTitle = legalNotice?.querySelector("strong");
    const legalCopy = legalNotice?.querySelector("p");
    if (legalTitle) legalTitle.textContent = interfaceMessage("settings.ai.legalunavailable");
    if (legalCopy) legalCopy.textContent = message;
  }

  function renderSettingsPanel(panel) {
    if (!panel || panel.dataset.caatuuSettingsRendered === "true") return panel;
    const developerToolLinks = renderDeveloperToolLinks();
    panel.id = "settingsPanel";
    panel.className = "settings-backdrop app-settings-backdrop";
    panel.hidden = true;
    panel.innerHTML = `
      <section class="settings-sheet app-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" data-settings-current-view="items">
        <header class="settings-sheet-head">
          <div class="settings-title-row">
            <button class="settings-brand-mark" type="button" data-settings-view="items" aria-label="${interfaceMessage("settings.backpack.openitems")}" aria-controls="itemsViewPanel" title="${interfaceMessage("settings.backpack.openitems")}">
              <img src="/assets/icons/backpack_icon.png" alt="" decoding="async">
            </button>
            <div class="settings-title-copy">
              <p class="settings-kicker kicker" id="settingsViewKicker">${interfaceMessage("settings.items.kicker")}</p>
              <h2 id="settingsTitle">${interfaceMessage("nav.backpack")}</h2>
            </div>
          </div>
          <span
            class="language-pill settings-language-pill current-language-indicator"
            data-caatuu-language-indicator
          ></span>
        </header>

        <div class="settings-sheet-body" tabindex="-1">
          <section class="settings-view-panel is-active" id="itemsViewPanel" data-settings-view-panel="items" role="tabpanel" aria-labelledby="itemsViewTab">
            <section class="backpack-card side-card" aria-label="${interfaceMessage("settings.backpack.traveleraria")}">
              <header class="backpack-profile-head">
                <div class="traveler-badge" aria-label="${interfaceMessage("settings.backpack.currentbadge")}">
                  <span class="traveler-badge-level" id="difficultyLevelSummary">${interfaceMessage("progress.level", { level: 2 })}</span>
                  <span class="traveler-badge-emblem" aria-hidden="true">
                    <img src="/assets/icons/backpack_icon.png" alt="" decoding="async">
                  </span>
                  <strong id="difficultyBadgeName">${interfaceMessage("settings.backpack.traveler")}</strong>
                </div>
                <div class="backpack-profile-copy">
                  <p class="settings-kicker kicker">${interfaceMessage("settings.journey.record")}</p>
                  <h3>${interfaceMessage("settings.adventure.title", { language: targetLanguageName })}</h3>
                  <p>${interfaceMessage("settings.adventure.description")}</p>
                </div>
              </header>

              <div class="backpack-wallet" aria-label="${interfaceMessage("progress.wallet.arialabel")}">
                <div class="backpack-wallet-item backpack-wallet-xp">
                  <span class="wallet-token wallet-token-xp" aria-hidden="true"></span>
                  <span class="wallet-copy">
                    <span>${interfaceMessage("progress.experience")}</span>
                    <strong><b id="courseProgressXp">0</b> XP</strong>
                    <small>${interfaceMessage("progress.correctanswers")}</small>
                  </span>
                </div>
                <div class="backpack-wallet-item backpack-wallet-coins">
                  <span class="wallet-token wallet-token-coin" aria-hidden="true">
                    <img src="/assets/icons/coin_icon_ui.png" alt="" loading="lazy" decoding="async">
                  </span>
                  <span class="wallet-copy">
                    <span>${interfaceMessage("progress.coins")}</span>
                    <strong id="courseProgressCoins">0</strong>
                    <small>${interfaceMessage("progress.completedrounds")}</small>
                  </span>
                </div>
                <div class="backpack-wallet-item backpack-wallet-streak" data-caatuu-streak>
                  <span class="wallet-token wallet-token-streak" aria-hidden="true">
                    <img src="${streakIconSrc}" alt="" loading="lazy" decoding="async">
                  </span>
                  <span class="wallet-copy">
                    <span>${interfaceMessage("progress.streak.label")}</span>
                    <strong><b data-caatuu-streak-count>0</b> ${interfaceMessage("progress.streak.dayword", { count: 0 })}</strong>
                    <small>${interfaceMessage("progress.streak.bestlabel")} <b data-caatuu-streak-best>0</b> ${interfaceMessage("progress.streak.dayword", { count: 0 })}</small>
                    <button class="streak-reminder-toggle" type="button" data-streak-reminder-toggle>${interfaceMessage("progress.reminders.enable")}</button>
                  </span>
                </div>
              </div>

              <details class="badge-collection" open>
                <summary>
                  <span>
                    <small>${interfaceMessage("settings.challenge")}</small>
                    <strong>${interfaceMessage("settings.backpack.travelerbadge")}</strong>
                  </span>
                  <small>${interfaceMessage("settings.choosepace")}</small>
                </summary>
                <div class="difficulty-setting-row">
                  <div class="difficulty-control" role="group" aria-label="${interfaceMessage("settings.difficulty.badges")}">
                    ${learningDifficultyButtons()}
                  </div>
                  <p id="difficultyDescription">${interfaceMessage("settings.difficulty.defaultsummary")}</p>
                </div>
              </details>

              <div class="learning-progress-note">
                <p id="courseProgressSummary">${interfaceMessage("progress.record.empty")}</p>
                <small>${interfaceMessage("settings.rewards.future")}</small>
              </div>
              <p class="learning-status" id="learningStatus" role="status" aria-live="polite" aria-atomic="true"></p>
            </section>
          </section>

          <section class="settings-view-panel" id="statsViewPanel" data-settings-view-panel="stats" role="tabpanel" aria-labelledby="statsViewTab" hidden>
            <section class="backpack-card backpack-stats-card side-card" aria-label="${interfaceMessage("settings.stats.arialabel")}">
              <header class="backpack-section-intro">
                <img src="/assets/icons/stats_icon.png" alt="" aria-hidden="true" loading="lazy" decoding="async">
                <span>
                  <span class="settings-kicker kicker">${interfaceMessage("settings.journey.record")}</span>
                  <strong>${interfaceMessage("settings.stats.title")}</strong>
                  <small>${interfaceMessage("settings.stats.description")}</small>
                </span>
              </header>
              <div id="backpackStatsMount">
                <div class="journey-ledger" aria-label="${interfaceMessage("settings.stats.performance")}">
                  <div>
                    <span>${interfaceMessage("progress.activities")}</span>
                    <strong id="courseProgressActivities">0</strong>
                  </div>
                  <div>
                    <span>${interfaceMessage("progress.accuracy")}</span>
                    <strong id="courseProgressAccuracy">—</strong>
                  </div>
                </div>

                <details class="skill-compass" id="semanticSkillCompass" data-state="idle" open>
                  <summary aria-controls="semanticSkillCompassBody">
                    <span class="skill-compass-summary-copy">
                      <small id="semanticSkillCompassEyebrow"></small>
                      <strong id="semanticSkillCompassTitle"></strong>
                    </span>
                    <span class="skill-compass-summary-state" id="semanticSkillCompassSummaryState"></span>
                  </summary>
                  <div class="skill-compass-body" id="semanticSkillCompassBody" aria-busy="false">
                    <div class="skill-compass-map">
                      <figure class="skill-compass-figure">
                        <svg class="skill-compass-chart" id="semanticSkillCompassChart" viewBox="0 0 340 290" role="img" aria-labelledby="semanticSkillCompassChartTitle semanticSkillCompassChartDescription"></svg>
                        <figcaption class="skill-compass-legend" aria-label="">
                          <span id="semanticSkillCompassLegendPractice"><i class="is-practice" aria-hidden="true"></i></span>
                          <span id="semanticSkillCompassLegendStrength"><i class="is-strength" aria-hidden="true"></i></span>
                        </figcaption>
                      </figure>
                    </div>
                    <progress class="skill-compass-progress" id="semanticSkillCompassProgress" aria-label="" hidden></progress>
                  </div>
                </details>
              </div>
            </section>
          </section>

          <section class="settings-view-panel" id="settingsViewPanel" data-settings-view-panel="settings" role="tabpanel" aria-labelledby="settingsViewTab" hidden>
          <section class="settings-card side-card settings-section-card appearance-card" aria-label="${interfaceMessage("settings.appearance.label")}">
            <details class="settings-section-details" id="settingsAppearanceDetails" open>
              <summary class="settings-section-summary">
                <span class="settings-section-title">
                  <span class="settings-kicker kicker">${interfaceMessage("settings.appearance.label")}</span>
                  <strong>${interfaceMessage("settings.appearance.display")}</strong>
                </span>
                <small>${interfaceMessage("settings.appearance.summary")}</small>
              </summary>
              <div class="settings-section-body appearance-settings-body">
                <p class="settings-summary appearance-settings-intro">${interfaceMessage("settings.appearance.description")}</p>
                <div class="appearance-controls">
              <div class="appearance-control-row">
                <span class="appearance-control-label">
                  <strong>${interfaceMessage("settings.theme.label")}</strong>
                  <small>${interfaceMessage("settings.theme.description")}</small>
                </span>
                <div class="theme-control" role="group" aria-label="${interfaceMessage("settings.theme.label")}">
                  <button type="button" data-theme-option="light">
                    <img class="theme-control-icon" src="${lightModeIconSrc}" alt="" aria-hidden="true" loading="lazy" decoding="async">
                    <b>${interfaceMessage("settings.theme.light")}</b>
                  </button>
                  <button type="button" data-theme-option="dark">
                    <img class="theme-control-icon" src="/assets/icons/dark_mode_ui.png" alt="" aria-hidden="true" loading="lazy" decoding="async">
                    <b>${interfaceMessage("settings.theme.dark")}</b>
                  </button>
                </div>
              </div>
              <div class="appearance-control-row">
                <span class="appearance-control-label">
                  <strong>${interfaceMessage("settings.textsize.label")}</strong>
                  <small>${interfaceMessage("settings.textsize.description")}</small>
                </span>
                <div class="font-size-control" role="group" aria-label="${interfaceMessage("settings.textsize.label")}">
                  <button type="button" data-font-size-option="largest" aria-label="${interfaceMessage("settings.textsize.usestandard")}">
                    <span class="font-size-sample is-largest" aria-hidden="true">A</span>
                    <b>${interfaceMessage("settings.textsize.standard")}</b>
                  </button>
                  <button type="button" data-font-size-option="large" aria-label="${interfaceMessage("settings.textsize.usesmall")}">
                    <span class="font-size-sample is-large" aria-hidden="true">A</span>
                    <b>${interfaceMessage("settings.textsize.small")}</b>
                  </button>
                  <button type="button" data-font-size-option="standard" aria-label="${interfaceMessage("settings.textsize.usesmaller")}">
                    <span class="font-size-sample is-standard" aria-hidden="true">A</span>
                    <b>${interfaceMessage("settings.textsize.smaller")}</b>
                  </button>
                </div>
              </div>
                </div>
              </div>
            </details>
          </section>

          <section class="settings-card side-card settings-section-card speech-settings-card" aria-label="${interfaceMessage("speech.pronunciation.label", { language: targetLanguageName })}">
            <details class="settings-section-details" id="settingsSpeechDetails">
              <summary class="settings-section-summary">
                <span class="settings-section-title">
                  <span class="settings-kicker kicker">${interfaceMessage("speech.audio.label")}</span>
                  <strong>${interfaceMessage("speech.voice.label", { language: targetLanguageName })}</strong>
                </span>
                <small>${interfaceMessage("speech.summary")}</small>
              </summary>
              <div class="settings-section-body speech-settings-body">
                <button class="speech-master-mute" type="button" role="switch" aria-checked="false" data-speech-mute-toggle>
                  <span>
                    <b data-speech-mute-label>${interfaceMessage("speech.audio.muteall")}</b>
                    <small data-speech-mute-status>${interfaceMessage("speech.audio.onstatus")}</small>
                  </span>
                  <i aria-hidden="true"></i>
                </button>
                <div class="speech-voice-row">
              <label class="speech-voice-label" for="settingsSpeechVoice">
                <b>${interfaceMessage("speech.voice.label", { language: targetLanguageName })}</b>
                <small>${interfaceMessage("speech.voice.source")}</small>
              </label>
              <div class="speech-voice-controls">
                <select id="settingsSpeechVoice" aria-describedby="settingsSpeechVoiceStatus" disabled>
                  <option value="">${interfaceMessage("speech.voice.automaticrecommended")}</option>
                </select>
                <button class="settings-raised-action speech-voice-test" type="button" id="settingsSpeechVoiceTest" aria-describedby="settingsSpeechVoiceStatus" disabled>${interfaceMessage("common.test")}</button>
                <button class="settings-raised-action speech-voice-install" type="button" id="settingsSpeechVoiceInstall" aria-describedby="settingsSpeechVoiceStatus" hidden>${interfaceMessage("speech.voice.install", { language: targetLanguageName })}</button>
                <p class="settings-summary" id="settingsSpeechVoiceStatus" role="status" aria-live="polite" aria-atomic="true">${interfaceMessage("speech.voice.automaticbest", { language: targetLanguageName })}</p>
              </div>
            </div>
            <div class="speech-rate-row">
              <span class="speech-voice-label">
                <b>${interfaceMessage("speech.pace.label")}</b>
                <small>${interfaceMessage("settings.choosepace")}</small>
              </span>
              <div class="speech-rate-controls">
                <div class="speech-pace-control" role="group" aria-label="${interfaceMessage("speech.pace.language", { language: targetLanguageName })}">
                  <input type="range" min="0" max="2" step="1" value="0" data-speech-pace-slider aria-label="${interfaceMessage("speech.pace.language", { language: targetLanguageName })}" aria-describedby="settingsSpeechPaceStatus">
                  <span class="speech-pace-ticks" aria-hidden="true">
                    <span><b>${interfaceMessage("speech.pace.slower")}</b><small>0.5×</small></span>
                    <span><b>${interfaceMessage("speech.pace.slow")}</b><small>0.6×</small></span>
                    <span><b>${interfaceMessage("speech.pace.normal")}</b><small>1×</small></span>
                  </span>
                </div>
                <p class="settings-summary" id="settingsSpeechPaceStatus" role="status" aria-live="polite" aria-atomic="true">${interfaceMessage("speech.pace.badgestatus", {
                  badge: interfaceMessage("settings.backpack.explorer"),
                  pace: interfaceMessage("speech.pace.slower"),
                  rate: 0.5
                })}</p>
              </div>
            </div>
              </div>
            </details>
          </section>

          <section class="settings-card side-card settings-section-card app-controls-card" aria-label="${interfaceMessage("settings.advanced.arialabel")}">
            <details class="settings-section-details">
              <summary class="settings-section-summary">
                <span class="settings-section-title">
                  <span class="settings-kicker kicker">${interfaceMessage("settings.app")}</span>
                  <strong>${interfaceMessage("settings.advanced.label")}</strong>
                </span>
                <small>${interfaceMessage("settings.advanced.summary")}</small>
              </summary>
              <div class="settings-section-body">
          <section class="settings-card side-card ai-settings-card" aria-label="${interfaceMessage("settings.ai.chatarialabel")}">
            <details class="settings-details">
              <summary class="settings-collapsible-summary">
                <span class="settings-summary-title">
                  <span class="settings-kicker kicker">${interfaceMessage("settings.ai.label")}</span>
                  <strong>${interfaceMessage("settings.ai.model")}</strong>
                </span>
                <small>${interfaceMessage("settings.controls")}</small>
              </summary>
              <div class="settings-details-body">
                <label class="setting-select">
                  <span>
                      <b>${interfaceMessage("settings.ai.modelshort")}</b>
                      <small id="modelChoiceSummary">${interfaceMessage("settings.ai.coursemodel")}</small>
                  </span>
                  <select id="settingsModel">
                    <option value="" selected>${interfaceMessage("settings.ai.coursemodel")}</option>
                  </select>
                </label>

                <div class="preset-control" role="group" aria-label="${interfaceMessage("settings.ai.preset")}">
                  <button type="button" data-preset="fast">${interfaceMessage("settings.ai.fast")}</button>
                  <button type="button" data-preset="chat">${interfaceMessage("settings.ai.chat")}</button>
                  <button type="button" data-preset="careful">${interfaceMessage("settings.ai.careful")}</button>
                </div>
                <p class="settings-summary" id="settingsSummary">${interfaceMessage("settings.ai.chatselected")}</p>

                <div class="settings-grid">
                  <label class="setting-toggle">
                    <span>
                      <b>${interfaceMessage("settings.ai.thinking")}</b>
                      <small id="thinkingSupport">${interfaceMessage("settings.ai.supportchecking")}</small>
                    </span>
                    <input id="thinkingEnabled" type="checkbox">
                  </label>

                  <label class="setting-field">
                    <span>
                      <b>${interfaceMessage("settings.ai.maxtokens")}</b>
                      <output id="maxTokensValue">384</output>
                    </span>
                    <input id="maxTokens" type="range" min="64" max="1024" step="32" value="384">
                  </label>

                  <label class="setting-field">
                    <span>
                      <b>${interfaceMessage("settings.ai.temperature")}</b>
                      <output id="temperatureValue">0.2</output>
                    </span>
                    <input id="temperature" type="range" min="0" max="1" step="0.1" value="0.2">
                    <small id="temperatureSupport">${interfaceMessage("settings.ai.modelsaved")}</small>
                  </label>

                  <label class="setting-select">
                    <span>
                      <b>${interfaceMessage("settings.ai.context")}</b>
                      <small id="contextSupport">${interfaceMessage("settings.ai.nativesaved")}</small>
                    </span>
                    <select id="contextSize">
                      <option value="768">${interfaceMessage("settings.ai.tokens", { count: 768 })}</option>
                      <option value="1024">${interfaceMessage("settings.ai.tokens", { count: 1024 })}</option>
                      <option value="2048" selected>${interfaceMessage("settings.ai.tokens", { count: 2048 })}</option>
                      <option value="4096">${interfaceMessage("settings.ai.tokens", { count: 4096 })}</option>
                      <option value="8192">${interfaceMessage("settings.ai.tokens", { count: 8192 })}</option>
                    </select>
                  </label>

                  <label class="setting-select">
                    <span>
                      <b>${interfaceMessage("settings.ai.reasoningdisplay")}</b>
                      <small>${interfaceMessage("settings.ai.visibleoutput")}</small>
                    </span>
                    <select id="reasoningDisplay">
                      <option value="collapsed" selected>${interfaceMessage("settings.ai.collapsed")}</option>
                      <option value="expanded">${interfaceMessage("settings.ai.expanded")}</option>
                      <option value="hidden">${interfaceMessage("settings.ai.hidden")}</option>
                    </select>
                  </label>
                </div>
                <p class="capability-note" id="capabilityNote">${interfaceMessage("settings.ai.shared")}</p>
              </div>
            </details>
            <details class="settings-details developer-tools-details">
              <summary class="settings-collapsible-summary">
                <span class="settings-summary-title">
                  <span class="settings-kicker kicker">${interfaceMessage("settings.developer.label")}</span>
                  <strong>${interfaceMessage("settings.developer.tools")}</strong>
                </span>
              </summary>
              <div class="settings-details-body">
                <nav class="advanced-link-list" aria-label="${interfaceMessage("settings.developer.tools")}">
                  ${developerToolLinks}
                </nav>
              </div>
            </details>
          </section>

          <section class="settings-card side-card maintenance-card" aria-label="${interfaceMessage("settings.appsettings")}">
            <div class="settings-card-head side-head">
              <p class="settings-kicker kicker">${interfaceMessage("settings.app")}</p>
              <h3>${interfaceMessage("settings.storage.title")}</h3>
            </div>
            <dl class="meta-list course-meta">
              <div>
                <dt>${interfaceMessage("settings.course.label")}</dt>
                <dd>${interfaceMessage("settings.course.pair", {
                  source: interfaceLanguageName(course.sourceLanguage),
                  target: targetLanguageName
                })}</dd>
              </div>
              <div>
                <dt>${interfaceMessage("settings.workspace")}</dt>
                <dd>${course.workspaceLabel}</dd>
              </div>
            </dl>
            <div class="maintenance-action-list">
              <div class="maintenance-action-row" data-maintenance-action-row hidden>
                <span class="maintenance-action-copy">
                  <strong>${interfaceMessage("settings.update.title")}</strong>
                  <small data-update-app-copy>${interfaceMessage("settings.update.description")}</small>
                </span>
                <button class="maintenance-row-control pwa-install-action" type="button" id="updateApp" aria-describedby="maintenanceStatus" hidden>${interfaceMessage("settings.update.action")}</button>
              </div>
              <div class="maintenance-action-row">
                <span class="maintenance-action-copy">
                  <strong>${interfaceMessage("settings.cache.title")}</strong>
                  <small>${interfaceMessage("settings.cache.description")}</small>
                </span>
                <button class="maintenance-row-control settings-cache-action" type="button" id="clearCache">${interfaceMessage("common.clear")}</button>
              </div>
              <div class="maintenance-action-row">
                <span class="maintenance-action-copy">
                  <strong>${interfaceMessage("settings.progress.title")}</strong>
                  <small>${interfaceMessage("settings.progress.description")}</small>
                </span>
                <button class="maintenance-row-control settings-danger-action course-reset-action" type="button" id="settingsResetCourseProgress">${interfaceMessage("common.restart")}</button>
              </div>
            </div>
            <p class="maintenance-status" id="maintenanceStatus" role="status" aria-live="polite" aria-atomic="true"></p>
            <div class="maintenance-install-row" id="browserInstallActions">
              <span class="maintenance-action-copy">
                <strong>${interfaceMessage("settings.install.title")}</strong>
                <small id="pwaInstallStatus">${interfaceMessage("common.browser")}</small>
              </span>
              <span class="maintenance-install-actions">
                <button class="pwa-install-action" type="button" id="installPwaAction" disabled>${interfaceMessage("common.browser")}</button>
                <a class="pwa-install-action android-install-action" id="installAndroidAction" aria-disabled="true">${interfaceMessage("common.checking")}</a>
              </span>
            </div>
            <p class="pwa-install-help" id="pwaInstallHelp" hidden>${interfaceMessage("settings.install.browserhelp")}</p>
          </section>
              </div>
            </details>
          </section>

          <section class="settings-card side-card about-card" aria-label="${interfaceMessage("settings.about.label")}">
            <div class="settings-card-head side-head">
              <p class="settings-kicker kicker">${interfaceMessage("settings.about.label")}</p>
              <h3>${interfaceMessage("settings.about.details")}</h3>
            </div>
            <dialog class="settings-update-dialog" id="appUpdateConfirmDialog" aria-labelledby="appUpdateConfirmTitle" aria-describedby="appUpdateConfirmVersions appUpdateConfirmNote">
              <form class="settings-update-dialog-card" method="dialog">
                <p class="settings-kicker kicker">${interfaceMessage("settings.update.app")}</p>
                <h3 id="appUpdateConfirmTitle">${interfaceMessage("settings.update.confirmtitle")}</h3>
                <p id="appUpdateConfirmVersions">${interfaceMessage("settings.update.loadingversion")}</p>
                <p class="settings-update-dialog-note" id="appUpdateConfirmNote">${interfaceMessage("settings.update.confirmnote")}</p>
                <div class="settings-update-dialog-actions">
                  <button type="submit" value="cancel">${interfaceMessage("common.notnow")}</button>
                  <button class="is-primary" id="appUpdateConfirmAction" type="submit" value="confirm">${interfaceMessage("settings.update.continuetosetup")}</button>
                </div>
              </form>
            </dialog>
            <p class="about-brand-note">${interfaceMessage("settings.about.brandprefix")} <a href="https://www.waajacu.com/" rel="noopener">Waajacu<sup class="brand-trademark" aria-hidden="true">™</sup></a>.</p>
            <p class="version-note">${interfaceMessage("settings.about.preview")}</p>
            <div class="legal-notice" role="note">
              <span class="legal-notice-icon" aria-hidden="true">!</span>
              <div>
                <strong>${interfaceMessage("settings.ai.legaltitle")}</strong>
                <p>${interfaceMessage("settings.ai.legalnotice")}</p>
              </div>
            </div>
            <details class="settings-details model-details legal-details">
              <summary class="settings-collapsible-summary">
                <span class="settings-summary-title">
                  <span class="settings-kicker kicker">${interfaceMessage("settings.legal.label")}</span>
                  <strong>${interfaceMessage("settings.legal.licenses")}</strong>
                </span>
                <small id="licenseMetaSummary">${interfaceMessage("settings.legal.componentterms")}</small>
              </summary>
              <div class="settings-details-body">
                <div class="license-copy">
                  <p>${interfaceMessage("settings.legal.softwareterms")} <a href="https://github.com/savethebeesandseeds/caatuu" rel="noopener">${interfaceMessage("settings.legal.viewsource")}</a>. ${interfaceMessage("settings.legal.contentterms")}</p>
                  <p class="license-link-row"><a href="https://github.com/savethebeesandseeds/caatuu/blob/main/docs/PRIVACY.md" rel="noopener">${interfaceMessage("settings.legal.privacy")}</a> · <a href="https://github.com/savethebeesandseeds/caatuu/blob/main/.github/SECURITY.md" rel="noopener">${interfaceMessage("settings.legal.security")}</a> · <a href="https://github.com/savethebeesandseeds/caatuu/blob/main/.github/SUPPORT.md" rel="noopener">${interfaceMessage("settings.legal.support")}</a> · <a href="https://github.com/savethebeesandseeds/caatuu/blob/main/docs/PRODUCT_READINESS.md" rel="noopener">${interfaceMessage("settings.legal.productstatus")}</a></p>
                </div>
                <dl class="meta-list model-license-list" id="modelLicenseList">
                  <div>
                    <dt>${interfaceMessage("settings.legal.courseresources")}</dt>
                    <dd>${interfaceMessage("settings.legal.courseresourceterms")}</dd>
                  </div>
                </dl>
              </div>
            </details>
          </section>
          </section>

          <footer class="settings-sheet-footer">
            <a class="footer-brand settings-footer-brand" href="https://www.waajacu.com/" rel="noopener">
              <img class="footer-logo" src="/language-runtime/static/assets/caatuu-shell-512.png" alt="" loading="lazy" decoding="async">
              <span>${interfaceMessage("settings.about.by")} Waajacu<sup class="brand-trademark" aria-hidden="true">™</sup></span>
            </a>
          </footer>
        </div>
        <p class="settings-view-transition-status" id="settingsViewTransitionStatus" role="status" aria-live="polite"></p>
        <nav class="settings-section-switcher" role="tablist" aria-label="${interfaceMessage("settings.backpack.sections")}">
          <button class="is-active" type="button" role="tab" id="itemsViewTab" data-settings-view="items" aria-controls="itemsViewPanel" aria-selected="true">
            <img src="/assets/icons/items_icon.png?v=items-2" alt="" aria-hidden="true" decoding="async">
            <span>${interfaceMessage("nav.items")}</span>
          </button>
          <button type="button" role="tab" id="statsViewTab" data-settings-view="stats" aria-controls="statsViewPanel" aria-selected="false">
            <img src="/assets/icons/stats_icon.png" alt="" aria-hidden="true" decoding="async">
            <span>${interfaceMessage("nav.stats")}</span>
          </button>
          <button type="button" role="tab" id="settingsViewTab" data-settings-view="settings" aria-controls="settingsViewPanel" aria-selected="false">
            <img src="/assets/icons/gear_icon.png" alt="" aria-hidden="true" decoding="async">
            <span>${interfaceMessage("nav.settings")}</span>
          </button>
        </nav>
      </section>
    `;
    reconcileDeveloperToolVisibility(panel, developerToolLinks);
    const supportsSpeech = course.capabilities?.speech === true;
    const supportsAi = course.capabilities?.llm === true
      || course.capabilities?.generation === true
      || course.capabilities?.chat === true
      || course.capabilities?.offlineModels === true;
    if (!supportsSpeech) panel.querySelector(".speech-settings-card")?.remove();
    configureAiSettingsAvailability(panel, supportsAi);
    if (!semanticSkillCompassAvailable) panel.querySelector("#semanticSkillCompass")?.remove();
    else applySemanticSkillCompassCopy(panel);
    if (course.platforms?.android?.enabled === false) {
      panel.querySelector("#installAndroidAction")?.remove();
      panel.querySelector("[data-maintenance-action-row]")?.remove();
      panel.querySelector("#appUpdateConfirmDialog")?.remove();
    }

    bindSettingsReport(panel);
    bindAndroidInstallDiscovery(panel);
    bindSemanticSkillCompass(panel);
    bindSpeechVoiceControl(panel);
    bindSpeechPaceControl(panel);
    renderLearningControls(panel);
    updateThemeControls(readStoredTheme());
    updateFontSizeControls(readStoredFontSize());
    setSettingsView(panel, readRememberedBackpackView(), { persist: false });
    panel.dataset.caatuuSettingsRendered = "true";
    return panel;
  }

  function setSettingsViewTransitionState(panel, requestedView, pending) {
    const view = ["items", "stats", "settings"].includes(requestedView) ? requestedView : "items";
    const label = {
      items: interfaceMessage("nav.items"),
      stats: interfaceMessage("nav.stats"),
      settings: interfaceMessage("nav.settings")
    }[view];
    document.querySelectorAll(".settings-section-switcher [data-settings-view]").forEach((button) => {
      const isRequested = button.dataset.settingsView === view;
      const isPending = pending && isRequested;
      button.classList.toggle("is-pending", isPending);
      if (pending) {
        button.classList.toggle("is-active", isRequested);
        button.setAttribute("aria-selected", String(isRequested));
        button.tabIndex = isRequested ? 0 : -1;
      }
      if (isPending) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
    });
    const status = panel.querySelector("#settingsViewTransitionStatus");
    if (status) status.textContent = pending
      ? interfaceMessage("settings.view.opening", { view: label })
      : "";
  }

  function cancelSettingsViewTransition(panel) {
    if (!panel) return;
    const transition = (Number(panel.dataset.settingsViewTransition) || 0) + 1;
    panel.dataset.settingsViewTransition = String(transition);
    setSettingsViewTransitionState(panel, "items", false);
  }

  function scheduleSettingsViewTransition(panel, requestedView = "items") {
    if (!panel) return;
    const view = ["items", "stats", "settings"].includes(requestedView) ? requestedView : "items";
    const sheet = panel.querySelector(".settings-sheet");
    const transition = (Number(panel.dataset.settingsViewTransition) || 0) + 1;
    panel.dataset.settingsViewTransition = String(transition);
    if (sheet?.dataset.settingsCurrentView === view) {
      setSettingsViewTransitionState(panel, view, false);
      setSettingsView(panel, view);
      return;
    }
    setSettingsViewTransitionState(panel, view, true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (panel.dataset.settingsViewTransition !== String(transition)) return;
        setSettingsView(panel, view);
        window.requestAnimationFrame(() => {
          if (panel.dataset.settingsViewTransition !== String(transition)) return;
          setSettingsViewTransitionState(panel, view, false);
        });
      });
    });
  }

  function setSettingsView(panel, requestedView = "items", { persist = true } = {}) {
    if (!panel) return;
    const view = normalizeBackpackView(requestedView);
    if (persist) rememberBackpackView(view);
    syncBackpackViewIndicators(view);
    const sheet = panel.querySelector(".settings-sheet");
    const previousView = sheet?.dataset.settingsCurrentView;
    const body = panel.querySelector(".settings-sheet-body");
    if (panel.dataset.settingsViewInitialized === "true"
      && sheet?.dataset.settingsCurrentView === view) {
      if (body) body.scrollTop = 0;
      if (view === "stats") scheduleSemanticSkillCompassLoad(panel);
      if (view === "settings") void refreshSpeechVoiceControl(panel);
      return;
    }
    panel.dataset.settingsViewInitialized = "true";
    if (previousView === "settings" && view !== "settings") {
      const testButton = panel.querySelector("#settingsSpeechVoiceTest");
      if (testButton) {
        testButton.removeAttribute("aria-busy");
        testButton.textContent = interfaceMessage("common.test");
      }
      void stopSpeech();
    }
    if (view !== "stats") pauseSemanticSkillCompass(panel);
    if (sheet) sheet.dataset.settingsCurrentView = view;
    document.querySelectorAll(".settings-section-switcher [data-settings-view]").forEach((button) => {
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
        items: interfaceMessage("settings.items.kicker"),
        stats: interfaceMessage("settings.stats.title"),
        settings: interfaceMessage("settings.controls.app")
      }[view];
    }
    if (body) body.scrollTop = 0;
    if (view === "stats") scheduleSemanticSkillCompassLoad(panel);
    if (view === "settings") void refreshSpeechVoiceControl(panel);
  }

  function validAndroidChannelManifest(channel, manifest) {
    if (!Number.isSafeInteger(channel?.minimumVersionCode) || channel.minimumVersionCode < 1) return false;
    if (!Number.isSafeInteger(manifest?.version_code) || manifest.version_code < channel.minimumVersionCode) return false;
    if (manifest?.package_name !== "com.waajacu.caatuu") return false;
    if (channel.kind === "preview") {
      return manifest.build_type === "debug" && manifest.debuggable === true;
    }
    return manifest.build_type === "release" && manifest.debuggable === false;
  }

  function configuredAndroidChannels() {
    const androidPlatform = course.platforms?.android;
    if (androidPlatform?.enabled !== true || !Array.isArray(androidPlatform.channels)) return [];
    return androidPlatform.channels.filter((channel) => {
      if (!channel || !["release", "preview"].includes(channel.kind)) return false;
      if (typeof channel.manifest !== "string" || typeof channel.artifact !== "string") return false;
      if (!Number.isSafeInteger(channel.minimumVersionCode) || channel.minimumVersionCode < 1) return false;
      try {
        const manifestUrl = new URL(channel.manifest, window.location.origin);
        const artifactUrl = new URL(channel.artifact, window.location.origin);
        return manifestUrl.origin === window.location.origin
          && artifactUrl.origin === window.location.origin
          && Boolean(manifestUrl.pathname)
          && Boolean(artifactUrl.pathname);
      } catch (error) {
        return false;
      }
    });
  }

  function disableAndroidInstallDiscovery(action, status) {
    action.hidden = true;
    action.removeAttribute("href");
    action.removeAttribute("download");
    action.setAttribute("aria-disabled", "true");
    action.setAttribute("tabindex", "-1");
    action.dataset.state = "unavailable";
    if (status) status.textContent = interfaceMessage("common.browser");
  }

  async function bindAndroidInstallDiscovery(panel) {
    const action = panel.querySelector("#installAndroidAction");
    const status = panel.querySelector("#pwaInstallStatus");
    if (!action || window.CaatuuRuntime?.env === "android") return;

    const channels = configuredAndroidChannels();
    if (!channels.length) {
      disableAndroidInstallDiscovery(action, status);
      return;
    }
    action.hidden = false;
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
    action.textContent = interfaceMessage("common.checking");

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
        action.textContent = channel.kind === "preview"
          ? interfaceMessage("common.preview")
          : interfaceMessage("common.android");
        if (status) status.textContent = channel.kind === "preview"
          ? interfaceMessage("settings.install.previewavailable")
          : interfaceMessage("settings.install.releaseavailable");
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
    action.textContent = interfaceMessage("settings.install.checkagain");
    action.onclick = (event) => {
      event.preventDefault();
      bindAndroidInstallDiscovery(panel);
    };
    action.onkeydown = (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      bindAndroidInstallDiscovery(panel);
    };
    if (status) status.textContent = interfaceMessage("settings.install.temporarilyunavailable");
  }

  function openSharedSettings({ view = readRememberedBackpackView() } = {}) {
    const panel = document.querySelector("#settingsPanel");
    if (!panel) return;
    closeLanguageSelectorHost(activeLanguageSelectorHost);
    closeHomeMenu({ restoreFocus: false });
    closeGameMenu({ restoreFocus: false });
    sharedSettingsTrigger = document.activeElement;
    setSettingsView(panel, view);
    panel.hidden = false;
    setBottomDockMenu();
    document.body.classList.add("settings-open");
    setSettingsNavActive(true);
    document.dispatchEvent(new CustomEvent("caatuu:settings-open"));
    panel.querySelector(".settings-sheet-body")?.focus?.();
  }

  function closeSharedSettings({ restoreFocus = true } = {}) {
    const panel = document.querySelector("#settingsPanel");
    if (!panel) return;
    closeLanguageSelectorHost(activeLanguageSelectorHost);
    cancelSettingsViewTransition(panel);
    pauseSemanticSkillCompass(panel);
    void stopSpeech();
    panel.hidden = true;
    setBottomDockMenu();
    document.body.classList.remove("settings-open");
    setSettingsNavActive(false);
    if (restoreFocus && typeof sharedSettingsTrigger?.focus === "function") sharedSettingsTrigger.focus();
  }

  function bindSharedSettingsPanel() {
    document.addEventListener("click", (event) => {
      const settingsView = event.target.closest?.("[data-settings-view]");
      if (settingsView) {
        const panel = document.querySelector("#settingsPanel");
        if (panel) {
          event.preventDefault();
          if (panel.hidden) openSharedSettings({ view: settingsView.dataset.settingsView });
          else {
            scheduleSettingsViewTransition(panel, settingsView.dataset.settingsView);
            setBottomDockMenu();
          }
          return;
        }
      }
      const open = event.target.closest?.("#openSettings");
      if (open && document.querySelector("#settingsPanel")) {
        event.preventDefault();
        const dock = mountBottomDockMenus();
        setBottomDockMenu(dock?.dataset.openMenu === "settings" ? "" : "settings");
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
          const viewPanel = document.querySelector("#settingsPanel");
          scheduleSettingsViewTransition(viewPanel, nextView.dataset.settingsView);
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
      toggleButton.textContent = nextOpen
        ? interfaceMessage("common.close")
        : interfaceMessage("settings.report.label");
      if (nextOpen) reportComment.focus();
    });

    reportButton.addEventListener("click", async () => {
      if (reportButton.disabled) return;
      const runtime = window.CaatuuRuntime;
      if (!runtime?.maintenance?.reportBug) {
        reportStatus.textContent = interfaceMessage("settings.report.unavailable");
        return;
      }

      reportButton.disabled = true;
      reportButton.textContent = interfaceMessage("settings.report.sending");
      reportStatus.textContent = interfaceMessage("settings.report.preparing");
      try {
        const result = await runtime.maintenance.reportBug(settingsReportPayload(reportComment.value));
        if (result?.ok === false) {
          throw new Error("Bug report service rejected the request.");
        }
        const reportId = result?.report_id || result?.reportId || "saved";
        reportStatus.textContent = interfaceMessage("settings.report.sent", { id: reportId });
        reportComment.value = "";
        if (reportPanel && toggleButton) {
          reportPanel.hidden = true;
          toggleButton.setAttribute("aria-expanded", "false");
          toggleButton.textContent = interfaceMessage("settings.report.label");
        }
      } catch (error) {
        console.error("Bug report failed.", error);
        reportStatus.textContent = interfaceMessage("settings.report.failed");
      } finally {
        reportButton.disabled = false;
        reportButton.textContent = interfaceMessage("settings.report.send");
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
    button.textContent = options.confirmLabel || interfaceMessage("common.pressagain");
    button.classList.add("is-confirming");
    if (options.message) button.setAttribute("aria-label", options.message);
    button._caatuuConfirmTimer = window.setTimeout(() => {
      resetConfirmButton(button);
    }, options.timeoutMs || 6500);
    return false;
  }

  function handleAndroidBack() {
    const homeMenuPanel = document.querySelector("#homeMenuPanel");
    if (homeMenuPanel && !homeMenuPanel.hidden) {
      closeHomeMenu({ restoreFocus: false });
      return true;
    }

    const gameMenuPanel = document.querySelector("#gamesMenuPanel");
    if (gameMenuPanel && !gameMenuPanel.hidden) {
      closeGameMenu({ restoreFocus: false });
      return true;
    }

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
      if (message) message.textContent = interfaceMessage("chrome.freshness.offline");
      if (action) {
        action.hidden = false;
        action.textContent = interfaceMessage("common.retry");
      }
      return;
    }
    if (state === "update-ready") {
      if (message) message.textContent = interfaceMessage("chrome.freshness.ready");
      if (action) {
        action.hidden = false;
        action.textContent = interfaceMessage("common.refresh");
      }
      return;
    }
    if (message) message.textContent = interfaceMessage("chrome.freshness.loading");
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
    document.documentElement.dataset.caatuuRuntime = window.CaatuuRuntime?.env || "browser";
    const navigationRequest = readNavigationRequest();
    if (navigationRequest) document.documentElement.dataset.navigationRequest = navigationRequest;
    applyTheme(readStoredTheme(), { persist: false });
    applyFontSize(readStoredFontSize(), { persist: false });
    document.querySelectorAll(".app-header").forEach(renderAppHeader);
    document.querySelectorAll("#settingsPanel, [data-caatuu-settings-panel]").forEach(renderSettingsPanel);
    document.querySelectorAll("[data-caatuu-bottom-nav]").forEach(renderBottomNav);
    document.querySelectorAll("[data-caatuu-language-indicator]").forEach(renderLanguageIndicator);
    document.querySelectorAll("[data-caatuu-language-switch]").forEach(renderLanguageSwitch);
    renderLearningControls(document);
    updateSpeechMuteControls(document);
    syncCourseGameTriggers();
    bindAppFreshness();
    scheduleStreakReminderCheck({ immediate: true });
  }

  window.CaatuuChrome = {
    gamePresentation,
    renderAppHeader,
    renderBottomNav,
    renderLanguageIndicator,
    renderLanguageSwitch,
    renderSettingsPanel,
    getSpeechVoicePreference,
    getSpeechPacePreference,
    getSpeechMuted,
    listSpeechVoiceOptions,
    getSpeechVoiceControlState,
    describeSpeechVoiceState,
    resolveSpeechPace,
    formatCompactRewardCount,
    setSpeechPacePreference,
    setSpeechMuted,
    setSpeechVoicePreference,
    updateSpeechMuteControls,
    previewSpeech,
    installSpeechData,
    speakText,
    stopSpeech,
    constrainToolbarPopover,
    releaseToolbarPopover,
    // Retain the legacy Czech names until course-local games migrate to the
    // language-neutral speech API. Both names share one implementation.
    previewCzechSpeech: previewSpeech,
    installCzechSpeechData: installSpeechData,
    speakCzechText: speakText,
    stopCzechSpeech: stopSpeech,
    setHeaderTitle,
    setPagePresentation,
    setBottomNavSection,
    setSettingsNavActive,
    confirmButtonPress,
    resetConfirmButton,
    openSharedSettings,
    closeSharedSettings,
    handleAndroidBack,
    preloadBackpackStats
  };

  let speechVoiceRefreshTimer = 0;
  function scheduleSpeechVoiceRefresh() {
    if (!isNativeShell()) return;
    window.clearTimeout(speechVoiceRefreshTimer);
    speechVoiceRefreshTimer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("caatuu:speech-voices-refresh"));
      document.querySelectorAll("#settingsPanel, [data-caatuu-settings-panel]").forEach((panel) => {
        const sheet = panel.querySelector(".settings-sheet");
        if (!panel.hidden && sheet?.dataset.settingsCurrentView === "settings") {
          void refreshSpeechVoiceControl(panel);
        }
      });
    }, 250);
  }

  window.addEventListener("focus", () => {
    scheduleSpeechVoiceRefresh();
    scheduleStreakReminderCheck({ immediate: true });
  });
  window.addEventListener("pageshow", () => {
    scheduleSpeechVoiceRefresh();
    scheduleStreakReminderCheck({ immediate: true });
  });
  window.addEventListener("resize", refreshToolbarPopovers);
  window.visualViewport?.addEventListener?.("resize", refreshToolbarPopovers);
  window.visualViewport?.addEventListener?.("scroll", refreshToolbarPopovers);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleSpeechVoiceRefresh();
      scheduleStreakReminderCheck({ immediate: true });
    }
  });

  window.addEventListener("pagehide", () => {
    window.clearTimeout(streakReminderTimer);
    void stopSpeech();
  });

  if (document.readyState === "complete") {
    window.setTimeout(clearVisibleUrlState, 0);
  } else {
    window.addEventListener("load", clearVisibleUrlState, { once: true });
  }

  const chromeTargetsReady = () =>
    Boolean(document.querySelector(".app-header, #settingsPanel, [data-caatuu-settings-panel], [data-caatuu-bottom-nav], [data-caatuu-language-switch]"));

  if (document.readyState === "loading" && !chromeTargetsReady()) {
    document.addEventListener("DOMContentLoaded", initChrome);
  } else {
    initChrome();
  }

  bindThemeToggle();
  bindWorkspaceDisplayMenuDismissal();
  bindSpeechPreferences();
  bindLearningControls();
  bindSharedGameNavigation();
  bindSharedSettingsPanel();
})();
