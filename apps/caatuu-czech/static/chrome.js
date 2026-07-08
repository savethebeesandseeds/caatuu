(() => {
  const navItems = [
    {
      key: "dictionary",
      label: "Dictionary",
      icon: "Aa",
      href: "index.html#dictionary",
      view: "dictionary"
    },
    {
      key: "verbs",
      label: "Train",
      icon: "\uD83E\uDDE9\uFE0E",
      href: "index.html#verbs",
      view: "verbs"
    },
    {
      key: "chat",
      label: "Chat",
      icon: "\uD83D\uDDE8\uFE0E",
      href: "chat.html"
    },
    {
      key: "settings",
      label: "Settings",
      icon: "\u2699\uFE0E",
      href: "index.html#settings"
    }
  ];

  function isNativeShell() {
    return window.CaatuuRuntime?.env === "android";
  }

  function appendNavContent(element, item) {
    const icon = document.createElement("span");
    icon.className = "app-nav-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.icon;

    const label = document.createElement("span");
    label.textContent = item.label;

    element.append(icon, label);
  }

  function navClasses(item, activeSection, isViewButton) {
    const isActive = activeSection === item.key || (activeSection === "train" && item.key === "verbs");
    return [
      isViewButton ? "nav-tab" : "",
      "app-nav-item",
      isActive ? "is-active" : ""
    ].filter(Boolean).join(" ");
  }

  function createNavItem(item, options) {
    const useViewButton = options.viewButtons && item.view;
    const useSettingsButton = item.key === "settings" && options.settingsTarget;
    const element = document.createElement(useViewButton || useSettingsButton ? "button" : "a");

    element.className = navClasses(item, options.activeSection, useViewButton);
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

  function renderLanguageSwitch(element) {
    const flag = document.createElement("span");
    flag.className = "cz-flag";
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

    mark.append(icon);
    labelWrap.append(label);
    brand.append(mark, labelWrap);
    header.append(brand, language);
    renderLanguageSwitch(language);
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
                <span aria-hidden="true">&#9790;</span>
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
                    <option value="cstinyllama-1.2b-planet-wordnet-002-copy">Planet Word Net CZ (legacy)</option>
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
            <div class="settings-actions maintenance-actions">
              <button class="pwa-install-action" type="button" id="updateApp" hidden>Update App</button>
              <button class="settings-danger-action" type="button" id="clearCache">Clear cache</button>
              <button class="settings-danger-action course-reset-action" type="button" id="settingsResetVerbMemory">Start course again</button>
            </div>
            <p class="pwa-install-status maintenance-status" id="maintenanceStatus">Android app tools appear here when running inside the APK.</p>
            <div class="settings-actions maintenance-actions" id="browserInstallActions">
              <button class="pwa-install-action" type="button" id="installPwaAction" disabled>Install browser app</button>
              <span class="pwa-install-status" id="pwaInstallStatus">Browser</span>
            </div>
            <p class="pwa-install-help" id="pwaInstallHelp" hidden>Use the browser menu and choose Install app or Add to Home screen.</p>
          </section>

          <section class="settings-card side-card about-card" aria-label="About">
            <div class="settings-card-head side-head">
              <p class="settings-kicker kicker">About</p>
              <h3>Details</h3>
            </div>
            <p class="about-brand-note"><a href="https://www.waajacu.com" rel="noopener">Waajacu</a> TM. Caatuu is a Waajacu language-learning app.</p>
            <p class="version-note" id="settingsVersion" data-fallback-version="Version 0.1.55 (56)">Version 0.1.55 (56)</p>
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
            <a class="footer-brand settings-footer-brand" href="https://www.waajacu.com" rel="noopener">
              <img class="footer-logo" src="icons/caatuu-czech-512.png" alt="">
              <span>by Waajacu</span>
            </a>
          </footer>
        </div>
      </section>
    `;
  }

  function initChrome() {
    document.querySelectorAll(".app-header").forEach(renderAppHeader);
    document.querySelectorAll("#settingsPanel, [data-caatuu-settings-panel]").forEach(renderSettingsPanel);
    document.querySelectorAll("[data-caatuu-bottom-nav]").forEach(renderBottomNav);
    document.querySelectorAll("[data-caatuu-language-switch]").forEach(renderLanguageSwitch);
  }

  window.CaatuuChrome = {
    renderAppHeader,
    renderBottomNav,
    renderLanguageSwitch,
    renderSettingsPanel
  };

  const chromeTargetsReady = () =>
    Boolean(document.querySelector(".app-header, #settingsPanel, [data-caatuu-settings-panel], [data-caatuu-bottom-nav], [data-caatuu-language-switch]"));

  if (document.readyState === "loading" && !chromeTargetsReady()) {
    document.addEventListener("DOMContentLoaded", initChrome);
  } else {
    initChrome();
  }
})();
