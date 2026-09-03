(() => {
  const registryPath = "/languages.json";
  const languageList = document.querySelector("[data-language-list]");
  const browserEntry = document.querySelector("[data-browser-entry]");
  const androidEntry = document.querySelector("[data-android-download]");
  const assetRevision = new URL(document.currentScript?.src || window.location.href).searchParams.get("v") || "1";

  function versionedLauncherAsset(path) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("caatuu_asset", assetRevision);
    return `${url.pathname}${url.search}`;
  }

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

  function renderBrowserSetup(registry) {
    if (browserEntry) {
      const entryPath = String(registry?.browserSetup?.entryPath || "");
      if (entryPath.startsWith("/") && !entryPath.startsWith("//")) browserEntry.href = entryPath;
      browserEntry.removeAttribute("aria-disabled");
      browserEntry.setAttribute("aria-label", "Continue online in the browser");
      const label = browserEntry.querySelector("b");
      if (label) label.textContent = "Continue online";
    }

    const courses = registry?.browserSetup?.schemaVersion === 1
      && Array.isArray(registry.browserSetup.courses)
      ? registry.browserSetup.courses.filter((courseRecord) => (
        ["active", "development"].includes(courseRecord?.status)
        && courseRecord?.targetLanguage
      ))
      : [];
    if (!languageList || courses.length === 0) return;
    languageList.replaceChildren(...courses.map((courseRecord) => {
      const language = courseRecord.targetLanguage;
      const item = document.createElement("li");
      item.dataset.languageId = courseRecord.id;
      item.dataset.courseStatus = courseRecord.status;
      const preview = courseRecord.status === "development";
      item.setAttribute(
        "aria-label",
        `${language.label} (${language.nativeLabel})${preview ? ", Preview" : ""}`
      );
      const choice = document.createElement("span");
      choice.className = "language-choice language-choice-static";
      const flag = document.createElement("img");
      flag.className = "flag-icon";
      flag.src = versionedLauncherAsset(language.flagSrc);
      flag.alt = "";
      flag.decoding = "async";
      const code = document.createElement("span");
      code.className = "language-choice-code";
      code.textContent = language.shortCode;
      choice.append(flag, code);
      if (preview) {
        const status = document.createElement("span");
        status.className = "language-choice-status";
        status.textContent = "Preview";
        choice.append(status);
      }
      item.append(choice);
      return item;
    }));
  }

  async function loadRegistry() {
    try {
      const response = await fetch(registryPath, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Language registry returned ${response.status}.`);
      const registry = await response.json();
      if (registry?.schemaVersion !== 1) throw new Error("Unsupported language registry.");
      renderBrowserSetup(registry);
    } catch (error) {
      // The checked-in browser setup remains the no-JavaScript and offline fallback.
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
