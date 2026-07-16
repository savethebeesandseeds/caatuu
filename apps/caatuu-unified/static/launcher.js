(() => {
  const registryPath = "/languages.json";
  const languageList = document.querySelector("[data-language-list]");
  const browserEntry = document.querySelector("[data-browser-entry]");
  const download = document.querySelector("[data-android-download]");
  let channelRequest = 0;

  function setDownloadUnavailable(message = "Android build unavailable") {
    if (!download) return;
    download.removeAttribute("href");
    download.removeAttribute("download");
    download.setAttribute("aria-disabled", "true");
    const label = download.querySelector("b");
    if (label) label.textContent = message;
  }

  async function selectAvailableChannel(language) {
    if (!download) return;
    const request = ++channelRequest;
    const android = language?.platforms?.android;
    if (!android?.enabled || !Array.isArray(android.channels)) {
      setDownloadUnavailable("Android not available");
      return;
    }

    download.setAttribute("aria-disabled", "true");
    const label = download.querySelector("b");
    if (label) label.textContent = "Checking Android build";

    for (const channel of android.channels) {
      try {
        const response = await fetch(channel.manifest, { cache: "no-store" });
        if (!response.ok) continue;
        const manifest = await response.json();
        if (request !== channelRequest) return;
        if (manifest?.package_name !== "com.waajacu.caatuu") continue;
        if (manifest?.build_type !== "release" || manifest?.debuggable !== false) continue;
        download.href = channel.artifact;
        download.setAttribute("download", "");
        download.removeAttribute("aria-disabled");
        if (label) label.textContent = `Download ${language.label} beta`;
        return;
      } catch (error) {
        // Try the next explicitly supported channel.
      }
    }

    if (request === channelRequest) setDownloadUnavailable();
  }

  function activateLanguage(language, languages) {
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
    selectAvailableChannel(language);
  }

  function renderLanguages(registry) {
    const languages = registry.languages.filter((language) => language.status === "active");
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
      button.addEventListener("click", () => activateLanguage(language, languages));
      item.append(button);
      return item;
    }));

    const selected = languages.find((language) => language.id === registry.defaultLanguage) || languages[0];
    activateLanguage(selected, languages);
  }

  async function loadRegistry() {
    try {
      const response = await fetch(registryPath, { cache: "no-store" });
      if (!response.ok) throw new Error(`Language registry returned ${response.status}.`);
      const registry = await response.json();
      if (registry?.schemaVersion !== 1 || !Array.isArray(registry.languages)) {
        throw new Error("Language registry has an unsupported shape.");
      }
      renderLanguages(registry);
    } catch (error) {
      // The static Czech links remain a usable no-JavaScript/network fallback.
      selectAvailableChannel({
        label: "Czech",
        platforms: {
          android: {
            enabled: true,
            channels: [
              { manifest: "/android/caatuu.json", artifact: "/android/caatuu.apk" }
            ]
          }
        }
      });
    }
  }

  loadRegistry();
})();
