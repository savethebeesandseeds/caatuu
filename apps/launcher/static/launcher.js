(() => {
  const registryPath = "/languages.json";
  const languageList = document.querySelector("[data-language-list]");
  const browserEntry = document.querySelector("[data-browser-entry]");
  const download = document.querySelector("[data-android-download]");
  const localeSelect = document.querySelector("[data-page-language]");
  const localeControl = document.querySelector("[data-language-control]");
  const localePreferenceKey = "caatuu.launcher.interfaceLocale.v1";
  const courseDialog = document.querySelector("[data-course-dialog]");
  const courseAndroid = document.querySelector("[data-course-dialog-android]");
  const assetRevision = new URL(document.currentScript?.src || window.location.href).searchParams.get("v") || "1";
  let channelRequest = 0;
  let registryRequest = 0;
  let refreshTimer = 0;
  let interfaceRequest = 0;
  let interfaceContent = null;
  let currentRegistry = null;

  function t(messageId, parameters = {}) {
    return interfaceContent?.t(messageId, parameters) || "";
  }

  function localePreferences() {
    let saved = "";
    try { saved = window.localStorage.getItem(localePreferenceKey) || ""; } catch { /* Storage is optional. */ }
    return [localeSelect?.value, new URL(window.location.href).searchParams.get("lang"), saved,
      ...(window.navigator?.languages || []), window.navigator?.language, "en"].filter(Boolean);
  }

  function versionedLauncherAsset(path) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("caatuu_asset", assetRevision);
    return `${url.pathname}${url.search}`;
  }

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
    if (label) label.textContent = t("launcher.android.checking");
    syncCourseDownload();
  }

  function setDownloadUnavailable(message = t("launcher.android.unpublished")) {
    if (!download) return;
    if (!interfaceContent) { download.hidden = true; return; }
    download.removeAttribute("href");
    download.removeAttribute("download");
    download.removeAttribute("aria-disabled");
    download.setAttribute("role", "button");
    download.setAttribute("tabindex", "0");
    download.setAttribute("aria-label", t("launcher.android.retryaria", { message }));
    download.dataset.state = "retry";
    const channelLabel = download.querySelector("small");
    if (channelLabel) channelLabel.textContent = t("launcher.android.temporary");
    const label = download.querySelector("b");
    if (label) label.textContent = t("launcher.android.retry");
    syncCourseDownload();
  }

  function validChannelManifest(channel, manifest) {
    if (!Number.isSafeInteger(channel?.minimumVersionCode) || channel.minimumVersionCode < 1) return false;
    if (!Number.isSafeInteger(manifest?.version_code) || manifest.version_code < channel.minimumVersionCode) return false;
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
      setDownloadUnavailable(t("launcher.android.unavailable"));
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
        if (channelLabel) channelLabel.textContent = t(preview ? "launcher.android.preview" : "launcher.android.beta");
        if (label) label.textContent = t(preview ? "launcher.android.downloadpreview" : "launcher.android.downloadbeta");
        syncCourseDownload();
        return;
      } catch (error) {
        // Try the next explicitly supported channel.
      }
    }

    if (request === channelRequest) setDownloadUnavailable();
  }

  function browserSetupCourses(registry) {
    if (registry?.browserSetup?.schemaVersion !== 1 || !Array.isArray(registry.browserSetup.courses)) {
      return [];
    }
    return registry.browserSetup.courses.filter((courseRecord) => (
      ["active", "development"].includes(courseRecord?.status)
      && courseRecord?.targetLanguage
    ));
  }

  function syncCourseDownload() {
    if (!courseDialog?.open || !courseAndroid) return;
    const status = courseDialog.querySelector("[data-course-dialog-status]");
    if (download?.dataset.state === "available") {
      courseAndroid.href = download.href;
      courseAndroid.setAttribute("download", "");
      courseAndroid.removeAttribute("aria-disabled");
      courseAndroid.removeAttribute("tabindex");
      status.textContent = "";
      return;
    }
    courseAndroid.removeAttribute("href");
    courseAndroid.removeAttribute("download");
    courseAndroid.setAttribute("aria-disabled", "true");
    courseAndroid.setAttribute("tabindex", "-1");
    status.textContent = t(download?.dataset.state === "checking"
      ? "launcher.android.checking" : "launcher.choose.unavailable");
  }

  function showCourseChoices(courseRecord) {
    courseDialog.querySelector("[data-course-dialog-title]").textContent = interfaceContent.languageName(courseRecord.targetLanguage);
    courseDialog.querySelector("[data-course-dialog-flag]").src = versionedLauncherAsset(courseRecord.targetLanguage.flagSrc);
    courseDialog.querySelector("[data-course-dialog-browser]").href = courseRecord.entryPath;
    if (!courseDialog.open) courseDialog.showModal();
    syncCourseDownload();
  }

  function renderBrowserSetup(registry, selectedCourse) {
    if (browserEntry) {
      const entryPath = String(selectedCourse?.entryPath || registry?.browserSetup?.entryPath || "");
      if (entryPath.startsWith("/") && !entryPath.startsWith("//")) browserEntry.href = entryPath;
      browserEntry.removeAttribute("aria-disabled");
      browserEntry.setAttribute("aria-label", t("launcher.continuearia"));
      const label = browserEntry.querySelector("b");
      if (label) label.textContent = t("launcher.continue");
    }

    const courses = browserSetupCourses(registry);
    if (!languageList || courses.length === 0) return;
    languageList.replaceChildren(...courses.map((courseRecord) => {
      const language = courseRecord.targetLanguage;
      const item = document.createElement("li");
      item.dataset.languageId = courseRecord.id;
      item.dataset.courseStatus = courseRecord.status;
      const preview = courseRecord.status === "development";
      item.setAttribute(
        "aria-label",
        `${t("course.direction", {
          source: interfaceContent.languageName(courseRecord.sourceLanguage),
          target: interfaceContent.languageName(language)
        })}${preview ? `, ${t("common.preview")}` : ""}`
      );
      const choice = document.createElement("a");
      choice.className = "language-choice";
      const entryPath = String(courseRecord.entryPath || "");
      if (entryPath.startsWith("/") && !entryPath.startsWith("//")) choice.href = entryPath;
      choice.setAttribute("aria-label", `${t("launcher.start")}: ${item.getAttribute("aria-label")}`);
      if (courseDialog && typeof courseDialog.showModal === "function") {
        choice.setAttribute("aria-haspopup", "dialog");
        choice.addEventListener("click", (event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
          event.preventDefault();
          void showCourseChoices(courseRecord);
        });
      }
      const flag = document.createElement("img");
      flag.className = "flag-icon";
      flag.src = versionedLauncherAsset(language.flagSrc);
      flag.alt = "";
      flag.decoding = "async";
      const code = document.createElement("span");
      code.className = "language-choice-code";
      code.textContent = language.shortCode;
      const name = document.createElement("strong");
      name.className = "language-choice-name";
      name.textContent = interfaceContent.languageName(language);
      choice.append(flag, name, code);
      if (preview) {
        const status = document.createElement("span");
        status.className = "language-choice-status";
        status.textContent = t("common.preview");
        choice.append(status);
      }
      const start = document.createElement("span");
      start.className = "language-choice-start";
      start.textContent = t("launcher.start");
      choice.append(start);
      item.append(choice);
      return item;
    }));
  }

  async function renderLanguages(registry) {
    const request = ++interfaceRequest;
    const { loadLauncherInterface, launcherLocales } = await import("/language-runtime/static/source/launcher-interface.mjs?v=launcher-interface-7");
    const { course, content } = await loadLauncherInterface(registry, localePreferences());
    if (request !== interfaceRequest) return;
    interfaceContent = content;
    document.documentElement.lang = content.locale;
    document.documentElement.dir = content.direction;
    content.apply(document);
    if (localeSelect) {
      localeSelect.replaceChildren(...launcherLocales.map((source) => {
        const option = document.createElement("option");
        option.value = source.locale;
        option.textContent = source.nativeLabel || content.languageName(source);
        option.lang = source.locale;
        return option;
      }));
      localeSelect.value = content.locale;
      if (localeControl) localeControl.hidden = launcherLocales.length < 2;
    }
    renderBrowserSetup(registry, course);
    const languages = registry.languages.filter((language) => ["active", "development"].includes(language.status)
      && language.platforms?.android?.enabled);
    const selected = languages.find((language) => language.id === registry.defaultLanguage) || languages[0];
    ++channelRequest;
    if (download) download.hidden = false;
    await selectAvailableChannel(selected);
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
      currentRegistry = registry;
      await renderLanguages(registry);
    } catch (error) {
      // The static course links remain a usable no-JavaScript/network fallback.
      setDownloadUnavailable(t("launcher.android.loadfailed"));
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

  localeSelect?.addEventListener("change", () => {
    try { window.localStorage.setItem(localePreferenceKey, localeSelect.value); } catch { /* Storage is optional. */ }
    if (currentRegistry) void renderLanguages(currentRegistry).catch(() => {
      setDownloadUnavailable(t("launcher.android.loadfailed"));
    });
  });

  courseDialog?.querySelector("[data-course-dialog-close]")?.addEventListener("click", () => courseDialog.close());
  courseDialog?.addEventListener("click", (event) => {
    if (event.target === courseDialog) courseDialog.close();
  });
  courseAndroid?.addEventListener("click", (event) => {
    if (courseAndroid.getAttribute("aria-disabled") === "true") event.preventDefault();
  });

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
