(() => {
  const registryPath = "/languages.json";
  const languageList = document.querySelector("[data-language-list]");
  const browserEntry = document.querySelector("[data-browser-entry]");
  const download = document.querySelector("[data-android-download]");
  let channelRequest = 0;
  let registryRequest = 0;
  let refreshTimer = 0;

  function freshRequestUrl(path, purpose = "availability") {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("caatuu_check", `${purpose}-${Date.now()}`);
    return `${url.pathname}${url.search}`;
  }

  function versionedArtifactUrl(path, manifest) {
    const url = new URL(path, window.location.origin);
    const version = manifest?.version_code || manifest?.version_name || String(manifest?.sha256 || "").slice(0, 16);
    if (version) url.searchParams.set("caatuu_release", String(version));
    return `${url.pathname}${url.search}`;
  }

  function setDownloadChecking() {
    if (!download) return;
    download.removeAttribute("href");
    download.removeAttribute("download");
    download.removeAttribute("role");
    download.removeAttribute("tabindex");
    download.removeAttribute("aria-label");
    download.setAttribute("aria-disabled", "true");
    download.dataset.state = "checking";
    const label = download.querySelector("b");
    if (label) label.textContent = "Checking Android build";
  }

  function setDownloadUnavailable(message = "Android preview not published") {
    if (!download) return;
    download.removeAttribute("href");
    download.removeAttribute("download");
    download.removeAttribute("aria-disabled");
    download.setAttribute("role", "button");
    download.setAttribute("tabindex", "0");
    download.setAttribute("aria-label", `${message}. Check again.`);
    download.dataset.state = "retry";
    const channelLabel = download.querySelector("small");
    if (channelLabel) channelLabel.textContent = "Android temporarily unavailable";
    const label = download.querySelector("b");
    if (label) label.textContent = "Check Android download again";
  }

  function validChannelManifest(channel, manifest) {
    if (manifest?.package_name !== "com.waajacu.caatuu") return false;
    if (channel.kind === "preview") {
      return manifest.build_type === "debug" && manifest.debuggable === true;
    }
    return manifest.build_type === "release" && manifest.debuggable === false;
  }

  async function selectAvailableChannel(language) {
    if (!download) return;
    const request = ++channelRequest;
    const android = language?.platforms?.android;
    if (!android?.enabled || !Array.isArray(android.channels)) {
      setDownloadUnavailable("Android not available");
      return;
    }

    setDownloadChecking();
    const label = download.querySelector("b");

    for (const channel of android.channels) {
      try {
        const response = await fetch(freshRequestUrl(channel.manifest, channel.kind), { cache: "no-store" });
        if (!response.ok) continue;
        const manifest = await response.json();
        if (request !== channelRequest) return;
        if (!validChannelManifest(channel, manifest)) continue;
        download.href = versionedArtifactUrl(channel.artifact, manifest);
        download.setAttribute("download", "");
        download.removeAttribute("aria-disabled");
        download.removeAttribute("role");
        download.removeAttribute("tabindex");
        download.removeAttribute("aria-label");
        download.dataset.state = "available";
        const channelLabel = download.querySelector("small");
        const preview = channel.kind === "preview";
        if (channelLabel) channelLabel.textContent = preview ? "Android preview" : "Android beta";
        if (label) label.textContent = `Download ${language.label} ${preview ? "preview" : "beta"}`;
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
    const request = ++registryRequest;
    try {
      const response = await fetch(freshRequestUrl(registryPath, "languages"), { cache: "no-store" });
      if (!response.ok) throw new Error(`Language registry returned ${response.status}.`);
      const registry = await response.json();
      if (request !== registryRequest) return;
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
              { kind: "release", manifest: "/android/caatuu.json", artifact: "/android/caatuu.apk" },
              { kind: "preview", manifest: "/android/caatuu-preview.json", artifact: "/android/caatuu-preview.apk" }
            ]
          }
        }
      });
    }
  }

  function scheduleAvailabilityRefresh(delay = 0) {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      if (document.visibilityState === "hidden") return;
      loadRegistry();
    }, Math.max(0, delay));
  }

  async function removeLegacyRootServiceWorker() {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.getRegistrations) return;
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => {
        const scopePath = new URL(registration.scope).pathname;
        return scopePath === "/" ? registration.unregister() : false;
      }));
    } catch (error) {
      // Availability checks below still bypass the normal HTTP cache.
    }
  }

  download?.addEventListener("click", (event) => {
    if (download.dataset.state === "available") return;
    event.preventDefault();
    if (download.dataset.state === "retry") scheduleAvailabilityRefresh();
  });
  download?.addEventListener("keydown", (event) => {
    if (download.dataset.state !== "retry" || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    scheduleAvailabilityRefresh();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) scheduleAvailabilityRefresh();
  });
  window.addEventListener("online", () => scheduleAvailabilityRefresh());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleAvailabilityRefresh(150);
  });

  removeLegacyRootServiceWorker().finally(loadRegistry);
})();
