(() => {
  const themeStorageKey = "caatuu-czech.theme";
  const darkModeIconSrc = "logos/dark_mode.png";
  const themeOptions = {
    light: { themeColor: "#f5efe5", label: "Use dark theme" },
    dark: { themeColor: "#0d171e", label: "Dark theme enabled" }
  };
  const navItems = [
    {
      key: "home",
      label: "Home",
      iconSrc: "/assets/icons/home_icon.png",
      href: "home.html"
    },
    {
      key: "games",
      label: "Games",
      iconSrc: "/assets/icons/games_icon.png",
      href: "index.html#verbs",
      view: "verbs"
    },
    {
      key: "settings",
      label: "Settings",
      iconSrc: "/assets/icons/settings_icon.png",
      href: "index.html#settings"
    }
  ];
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
  }

  function toggleTheme(button) {
    applyTheme(button.dataset.themeToggle || "dark");
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
      element.href = item.key === "settings" ? options.settingsHref : item.href;
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
    nav.replaceChildren(...navItems.map((item) => createNavItem(item, options)));
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
    flag.className = "cz-flag";
    flag.src = "logos/czech_flag.png";
    flag.alt = "";
    flag.setAttribute("aria-hidden", "true");

    const code = document.createElement("span");
    code.className = "language-code";
    code.textContent = element.dataset.label || "CZ";

    element.replaceChildren(flag, code);

    if (element.tagName === "A") {
      if (isNativeShell()) {
        element.href = "home.html";
        element.setAttribute("aria-label", "Czech");
      } else {
        element.href = element.dataset.href || element.getAttribute("href") || "/";
        element.setAttribute("aria-label", "Back to language selection");
      }
    }
  }

  function renderAppHeader(header) {
    header.replaceChildren();

    const brand = document.createElement("a");
    brand.className = "brand-link";
    brand.href = "home.html";
    brand.setAttribute("aria-label", "Open Caatuu Czech home");

    const mark = document.createElement("span");
    mark.className = "brand-mark";
    mark.setAttribute("aria-hidden", "true");

    const icon = document.createElement("img");
    icon.className = "brand-icon";
    icon.src = "icons/caatuu-czech-512.png";
    icon.alt = "";

    const labelWrap = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = "Caatuu";

    const language = document.createElement("a");
    language.className = "language-pill language-switch";
    language.href = "/";
    language.dataset.caatuuLanguageSwitch = "";
    language.dataset.label = "CZ";

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
    theme.append(themeIcon);
    actions.append(theme, language);
    header.append(brand, actions);
    renderLanguageSwitch(language);
    updateThemeControls(readStoredTheme());
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
          <button class="settings-close close-settings" id="closeSettings" type="button" aria-label="Close settings">&times;</button>
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
                    <option value="cstinyllama-1.2b-translation-cs-en-001">Czech to English</option>
                    <option value="qwen3-lora-003-hard">Caatuu CZ LoRA (legacy)</option>
                    <option value="cstinyllama-1.2b-base">CSTinyLlama CZ Base (legacy)</option>
                    <option value="cstinyllama-1.2b-planet-wordnet-002-copy">Planet Word World CZ (legacy)</option>
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
                  <a class="advanced-link" href="index.html?advanced=cz-dictionary#dictionary">cz-dictionary</a>
                  <a class="advanced-link" href="embedding-images.html">embedding-images</a>
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
                <dd>English to Czech</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>Caatuu Czech</dd>
              </div>
            </dl>
            <div class="maintenance-action-list">
              <div class="maintenance-action-row" data-maintenance-action-row hidden>
                <span class="maintenance-action-copy">
                  <strong>Update app</strong>
                  <small>Install a newer Android package when one is available.</small>
                </span>
                <button class="maintenance-row-control pwa-install-action" type="button" id="updateApp" hidden>Update</button>
              </div>
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
                  <small>Clear saved mastery and start the course again.</small>
                </span>
                <button class="maintenance-row-control settings-danger-action course-reset-action" type="button" id="settingsResetVerbMemory">Restart</button>
              </div>
            </div>
            <p class="pwa-install-status maintenance-status" id="maintenanceStatus"></p>
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
            <div class="maintenance-action-row maintenance-report-row">
              <span class="maintenance-action-copy">
                <strong>Report bug</strong>
                <small>Send a short diagnostic note with device and version details.</small>
              </span>
              <button class="maintenance-row-control settings-report-toggle" type="button" id="settingsReportToggle" aria-expanded="false" aria-controls="settingsReportPanel">Report</button>
            </div>
            <div class="settings-report-panel" id="settingsReportPanel" hidden>
              <label class="settings-report-field" for="settingsBugComment">
                <span>Small comment</span>
                <textarea id="settingsBugComment" rows="3" maxlength="600" placeholder="What happened?"></textarea>
              </label>
              <div class="settings-report-actions">
                <button class="settings-report-action" type="button" id="settingsReportBug">Send report</button>
                <span class="settings-report-status" id="settingsReportStatus" aria-live="polite"></span>
              </div>
            </div>
          </section>

          <section class="settings-card side-card about-card" aria-label="About">
            <div class="settings-card-head side-head">
              <p class="settings-kicker kicker">About</p>
              <h3>Details</h3>
            </div>
            <p class="about-brand-note"><a href="https://www.waajacu.com/" rel="noopener">Waajacu</a> TM. Caatuu is a Waajacu language-learning app.</p>
            <p class="version-note" id="settingsVersion" data-fallback-version="Version check pending">Version check pending</p>
            <div class="legal-notice" role="note">
              <span class="legal-notice-icon" aria-hidden="true">!</span>
              <div>
                <strong>Learning use only</strong>
                <p>Small local model responses may be wrong. Use Caatuu for language practice; do not use it for professional, legal, medical, financial, or safety decisions.</p>
              </div>
            </div>
            <details class="settings-details model-details legal-details">
              <summary class="settings-collapsible-summary">
                <span class="settings-summary-title">
                  <span class="settings-kicker kicker">Legal</span>
                  <strong>Licenses</strong>
                </span>
                <small id="licenseMetaSummary">MIT app, local artifacts</small>
              </summary>
              <div class="settings-details-body">
                <div class="license-copy">
                  <p>Caatuu app code is provided under the MIT license. Local model weights are separate third-party artifacts and keep their own licenses.</p>
                  <p>Each artifact row names its own source and license.</p>
                  <p>The MIT license for this app does not relicense model weights, upstream model names, datasets, or provider trademarks.</p>
                </div>
                <dl class="meta-list model-license-list" id="modelLicenseList">
                  <div>
                    <dt>Word Sentence CZ</dt>
                    <dd>BUT-FIT/CSTinyLlama-1.2B, Apache-2.0</dd>
                  </div>
                  <div>
                    <dt>Czech to English</dt>
                    <dd>BUT-FIT/CSTinyLlama-1.2B, Apache-2.0</dd>
                  </div>
                  <div>
                    <dt>Caatuu Curriculum and Asset Embeddings</dt>
                    <dd>Caatuu curated curriculum corpus, MIT. Embeds english_text only.</dd>
                  </div>
                </dl>
              </div>
            </details>
          </section>

          <footer class="settings-sheet-footer">
            <a class="footer-brand settings-footer-brand" href="https://www.waajacu.com/" rel="noopener">
              <img class="footer-logo" src="icons/caatuu-czech-512.png" alt="">
              <span>by Waajacu<sup class="footer-tm">TM</sup></span>
            </a>
          </footer>
        </div>
      </section>
    `;
    bindSettingsReport(panel);
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
  }

  window.CaatuuChrome = {
    renderAppHeader,
    renderBottomNav,
    renderLanguageSwitch,
    renderSettingsPanel,
    setSettingsNavActive,
    confirmButtonPress,
    resetConfirmButton
  };

  const chromeTargetsReady = () =>
    Boolean(document.querySelector(".app-header, #settingsPanel, [data-caatuu-settings-panel], [data-caatuu-bottom-nav], [data-caatuu-language-switch]"));

  if (document.readyState === "loading" && !chromeTargetsReady()) {
    document.addEventListener("DOMContentLoaded", initChrome);
  } else {
    initChrome();
  }

  bindThemeToggle();
})();
