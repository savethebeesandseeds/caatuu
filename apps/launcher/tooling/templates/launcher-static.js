(() => {
  const registryPath = "/languages.json";
  const languageList = document.querySelector("[data-language-list]");
  const browserEntry = document.querySelector("[data-browser-entry]");
  const androidEntry = document.querySelector("[data-android-download]");

  function setAndroidSeparate() {
    if (!androidEntry) return;
    androidEntry.removeAttribute("href");
    androidEntry.removeAttribute("download");
    androidEntry.setAttribute("aria-disabled", "true");
    androidEntry.setAttribute("tabindex", "-1");
    androidEntry.dataset.state = "separate";
    const channel = androidEntry.querySelector("small");
    const label = androidEntry.querySelector("b");
    if (channel) channel.textContent = "Android app";
    if (label) label.textContent = "Published separately";
  }

  function activateLanguage(language) {
    if (!language) return;
    if (browserEntry) {
      const browser = language.platforms?.browser;
      browserEntry.href = browser?.enabled ? browser.entryPath : language.entryPath;
      browserEntry.toggleAttribute("aria-disabled", browser?.enabled === false);
      const label = browserEntry.querySelector("b");
      if (label) label.textContent = `Continue with ${language.label}`;
    }
    languageList?.querySelectorAll("[data-language-choice]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.languageChoice === language.id));
    });
  }

  function renderLanguages(registry) {
    const languages = Array.isArray(registry?.languages)
      ? registry.languages.filter((language) => language.status === "active")
      : [];
    if (!languageList || languages.length === 0) return;
    languageList.replaceChildren(...languages.map((language) => {
      const item = document.createElement("li");
      item.dataset.languageId = language.id;
      const button = document.createElement("button");
      button.className = "language-choice";
      button.type = "button";
      button.dataset.languageChoice = language.id;
      button.setAttribute("aria-label", `${language.label} (${language.nativeLabel})`);
      const flag = document.createElement("img");
      flag.className = language.flagClass;
      flag.src = language.flagSrc;
      flag.alt = "";
      const code = document.createElement("span");
      code.className = "language-choice-code";
      code.textContent = language.shortCode;
      button.append(flag, code);
      button.addEventListener("click", () => activateLanguage(language));
      item.append(button);
      return item;
    }));

    activateLanguage(
      languages.find((language) => language.id === registry.defaultLanguage) || languages[0]
    );
  }

  async function loadRegistry() {
    try {
      const response = await fetch(registryPath, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Language registry returned ${response.status}.`);
      const registry = await response.json();
      if (registry?.schemaVersion !== 1) throw new Error("Unsupported language registry.");
      renderLanguages(registry);
    } catch (error) {
      // The checked-in Czech links remain the no-JavaScript and offline fallback.
    }
  }

  async function registerStaticWorker() {
    if (!("serviceWorker" in navigator)) return;
    const rootScope = new URL("/", window.location.origin).href;
    const legacyCzechScope = new URL("/cz/", window.location.origin).href;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations
      .filter((registration) => registration.scope === legacyCzechScope && registration.scope !== rootScope)
      .map((registration) => registration.unregister()));
    await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none"
    });
  }

  setAndroidSeparate();
  void loadRegistry();
  void registerStaticWorker().catch(() => {});
})();
