// Setup uses packaged shell metadata only. Curriculum imports wait until the
// selected course's native installation is verified, inside the canonical Home.
export const setupMessages = Object.freeze({
  en: Object.freeze({
    choose: "Choose your course", description: "Download only the course you choose. Shared files are reused, and installed courses work offline.",
    source: "I speak", loading: "Loading courses…", prepare: "Prepare your course", checking: "Checking your offline files…",
    download: "Download course", retry: "Retry", cancel: "Cancel", back: "Choose another course", progress: "Course download",
    required: "Download remaining", downloading: "Downloading your course…", verifying: "Verifying your course…",
    ready: "Your course is ready.", cancelled: "Download stopped. Completed files are kept for the next attempt.",
    unavailable: "Course setup is unavailable. Try again.", native: "Open this setup screen in the Caatuu Android app.",
    unknown: "This course is not available in this app version.", empty: "No courses are available for this language.",
  }),
  es: Object.freeze({
    choose: "Elige tu curso", description: "Descarga solo el curso que elijas. Los archivos compartidos se reutilizan y los cursos instalados funcionan sin conexión.",
    source: "Hablo", loading: "Cargando cursos…", prepare: "Prepara tu curso", checking: "Comprobando los archivos sin conexión…",
    download: "Descargar curso", retry: "Reintentar", cancel: "Cancelar", back: "Elegir otro curso", progress: "Descarga del curso",
    required: "Descarga pendiente", downloading: "Descargando tu curso…", verifying: "Verificando tu curso…",
    ready: "Tu curso está listo.", cancelled: "Descarga detenida. Los archivos completados se conservan para el siguiente intento.",
    unavailable: "La preparación del curso no está disponible. Inténtalo de nuevo.", native: "Abre esta pantalla en la aplicación Caatuu para Android.",
    unknown: "Este curso no está disponible en esta versión de la aplicación.", empty: "No hay cursos disponibles para este idioma.",
  }),
});

export function setupLocale(locale) {
  return String(locale || "").toLowerCase().split(/[-_]/u)[0] === "es" ? "es" : "en";
}

export function availableSetupCourses(registry) {
  if (registry?.schemaVersion !== 1 || !Array.isArray(registry.courses)) throw new Error("Invalid course registry.");
  const seen = new Set();
  return registry.courses.map((course) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(course?.id || "") || seen.has(course.id)
      || !/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(course.routePrefix || "")
      || course.entryPath !== `${course.routePrefix}/index.html`
      || !course.sourceLanguage?.locale || !course.targetLanguage?.locale) throw new Error("Invalid course entry.");
    seen.add(course.id);
    return course;
  });
}

export function setupCourseForPath(courses, pathname) {
  return courses.find((course) => pathname === course.routePrefix || pathname.startsWith(`${course.routePrefix}/`)) || null;
}

export function formatSetupBytes(bytes, locale = "en") {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.max(0, Number(bytes) || 0) / 1_000_000)} MB`;
}

export function missingSetupBytes(status) {
  const entries = [...(status?.staticAssets?.assets || []), status?.vectorDatabase, status?.dictionary].filter(Boolean);
  // A full-length file without a verified identity still needs repair.
  return entries.length ? entries.reduce((sum, item) => sum + (item.ready === true ? 0 : Math.max(0, Number(item.expectedBytes) || 0)), 0)
    : Math.max(0, (Number(status?.expectedBytes) || 0) - (status?.ready ? Number(status.bytes) || 0 : 0));
}

export function createNativeSetupClient(scope) {
  if (typeof scope.CaatuuAndroid?.postMessage !== "function") throw new Error("Native setup is unavailable.");
  const pending = new Map();
  const previous = scope.CaatuuNative;
  const sessionId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let sequence = 0;
  const receiver = { receive(raw) {
    let message;
    try { message = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return; }
    const request = pending.get(message?.id);
    if (!request) return;
    if (message.kind === "done" || message.kind === "error") {
      pending.delete(message.id);
      if (request.timer) scope.clearTimeout(request.timer);
      if (message.kind === "error") request.reject(new Error(message.message || "Native setup failed."));
      else request.resolve(message.result || {});
    } else request.onProgress?.(message);
  } };
  scope.CaatuuNative = receiver;
  return {
    request(type, onProgress) {
      if (!["setup_status", "storage_preflight", "setup_download", "setup_abort"].includes(type)) return Promise.reject(new Error("Unsupported setup operation."));
      const id = `course-setup-${sessionId}-${++sequence}`;
      return new Promise((resolve, reject) => {
        const entry = { resolve, reject, onProgress, timer: null };
        pending.set(id, entry);
        if (type !== "setup_download") entry.timer = scope.setTimeout(() => {
          pending.delete(id);
          reject(new Error("Setup request timed out."));
        }, 120_000);
        try { scope.CaatuuAndroid.postMessage(JSON.stringify({ id, type })); }
        catch (error) { pending.delete(id); if (entry.timer) scope.clearTimeout(entry.timer); reject(error); }
      });
    },
    dispose() {
      for (const entry of pending.values()) {
        if (entry.timer) scope.clearTimeout(entry.timer);
        entry.reject(new Error("Setup screen closed."));
      }
      pending.clear();
      if (scope.CaatuuNative === receiver) scope.CaatuuNative = previous;
    },
  };
}

const PENDING_HOME_COURSE = "caatuu.setup.pending-course.v1";
const SELECTED_HOME_COURSE = "caatuu.setup.selected-course.v1";

function retryVerifiedSetupImages(scope) {
  for (const image of scope.document.querySelectorAll("img[src]")) {
    const source = image.getAttribute("src");
    let url;
    try { url = new URL(source, scope.location.href); } catch { continue; }
    if (!source || !["http:", "https:"].includes(url.protocol) || url.origin !== scope.location.origin) continue;
    let retried = false;
    const retry = () => {
      if (!retried && image.getAttribute("src") === source && image.complete && image.naturalWidth === 0) {
        retried = true;
        image.setAttribute("src", source);
      }
    };
    if (image.complete) retry();
    // A response rejected just before verification may still be in flight.
    // Retry that failure once, only if this exact image request is unchanged.
    else image.addEventListener("error", retry, { once: true });
  }
}

/** Prepare native product content in the existing Home, before game imports. */
export function initializeHomeCourseSetup(scope = globalThis) {
  const native = scope.CaatuuAndroid;
  // The full development shell and browser already own their setup providers.
  if (typeof native?.postMessage !== "function" || typeof native.isCourseBundled !== "function") {
    return Promise.resolve(false);
  }
  const { document, CaatuuCourse: course, CaatuuI18n: content } = scope;
  const card = document.getElementById("nativeSetup");
  const action = document.getElementById("setupAction");
  const cancel = document.getElementById("setupAbort");
  const selection = document.getElementById("setupLanguageSelection");
  const form = document.getElementById("setupLanguageForm");
  const sourceOptions = document.getElementById("setupSourceLanguageOptions");
  const targetOptions = document.getElementById("setupTargetLanguageOptions");
  const targetQuestion = document.getElementById("setupTargetLanguageQuestion");
  const submit = document.getElementById("setupLanguageContinue");
  if (!card || !action || !cancel || !selection || !form || !sourceOptions || !targetOptions || !targetQuestion || !submit) {
    throw new Error("The canonical Home is missing its setup controls.");
  }
  const courses = availableSetupCourses(course.courseSelector).filter((item) => native.isCourseBundled(item.id));
  if (!courses.some((item) => item.id === course.id
    && [item.entryPath, item.routePrefix, `${item.routePrefix}/`].includes(scope.location.pathname))) {
    throw new Error("Native Home setup requires the selected bundled course route.");
  }
  const t = (id, parameters = {}) => content.t(id, parameters);
  const text = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
  const hide = (id, hidden) => { const node = document.getElementById(id); if (node) node.hidden = hidden; };
  const client = createNativeSetupClient(scope);
  const locale = course.sourceLanguage.locale;
  let sourceId = "";
  let selectedId = "";
  let closed = false;
  let installing = false;
  let stopping = false;
  let generation = 0;
  let pollTimer;
  let finish;
  let fail;
  const completion = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  let selectedIntent = false;
  try {
    selectedIntent = scope.localStorage.getItem(SELECTED_HOME_COURSE) === course.id;
  } catch { /* Storage is optional. */ }
  try {
    selectedIntent ||= scope.sessionStorage.getItem(PENDING_HOME_COURSE) === course.id;
    scope.sessionStorage.removeItem(PENDING_HOME_COURSE);
  } catch { /* A blocked preference store still allows manual course preparation. */ }
  if (selectedIntent) {
    sourceId = course.sourceLanguage.id;
    selectedId = course.id;
  }

  const stopPolling = () => {
    if (pollTimer) scope.clearTimeout(pollTimer);
    pollTimer = null;
  };
  const setChoosing = (choosing) => {
    selection.hidden = !choosing;
    card.classList.toggle("is-choosing-language", choosing);
    document.body.classList.toggle("choosing-setup-language", choosing);
  };
  const setBusy = (busy) => {
    installing = busy;
    card.setAttribute("aria-busy", String(busy));
    action.hidden = busy;
    action.disabled = busy;
    cancel.hidden = false;
    cancel.disabled = false;
    cancel.textContent = t(busy ? "common.cancel" : "courseselector.heading");
    cancel.onclick = busy ? stopDownload : showChoices;
  };
  const setProgress = (percent, bytes = "") => {
    const value = Math.max(0, Math.min(99, Number(percent) || 0));
    const progress = document.getElementById("setupProgress");
    const bar = document.getElementById("setupProgressBar");
    progress?.setAttribute("aria-valuenow", String(Math.floor(value)));
    progress?.setAttribute("aria-valuetext", `${Math.floor(value)}%`);
    if (bar) bar.style.width = `${value}%`;
    text("setupPercent", `${Math.floor(value)}%`);
    if (bytes) text("setupBytes", bytes);
  };
  const showPreparing = () => {
    setChoosing(false);
    card.classList.remove("is-ready", "is-error");
    text("setupTitle", t("setup.preparing"));
    text("setupPhase", t("setup.preparing"));
    text("setupMessage", t("setup.offlinefiles"));
    hide("setupProgress", false);
    card.querySelector(".setup-progress-meta")?.removeAttribute("hidden");
  };
  const showRecovery = (error, retry = download, { cancelled = false } = {}) => {
    if (closed) return;
    stopPolling();
    showPreparing();
    setBusy(false);
    card.classList.toggle("is-error", !cancelled);
    text("setupPhase", t(cancelled ? "setup.prepare" : "common.unavailable"));
    text("setupMessage", error?.message || String(error || t("common.unavailable")));
    action.textContent = t("common.retry");
    action.onclick = retry;
  };
  const languageChoice = (language, value, name, checked, choose) => {
    const label = document.createElement("label");
    label.className = "language-selector-option setup-language-choice";
    label.classList.toggle("is-selected", checked);
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = value;
    input.checked = checked;
    input.className = "setup-language-radio";
    input.addEventListener("change", choose);
    const flag = document.createElement("img");
    flag.className = `language-selector-option-flag caatuu-language-flag ${language.flagClass || ""}`;
    flag.src = language.flagSrc || "";
    flag.alt = "";
    flag.width = 30;
    flag.height = 20;
    const copy = document.createElement("span");
    copy.className = "language-selector-option-copy";
    const title = document.createElement("strong");
    title.lang = language.locale;
    title.dir = language.direction || "auto";
    title.textContent = language.nativeLabel || language.label;
    copy.append(title);
    const translated = content.languageName(language);
    if (translated !== title.textContent) {
      const subtitle = document.createElement("small");
      subtitle.textContent = translated;
      copy.append(subtitle);
    }
    label.append(input, flag, copy);
    return label;
  };
  function showChoices() {
    if (closed || installing) return;
    stopPolling();
    setChoosing(true);
    card.classList.remove("is-ready", "is-error");
    card.setAttribute("aria-busy", "false");
    text("setupTitle", t("courseselector.heading"));
    action.hidden = true;
    cancel.hidden = true;
    const sources = [...new Map(courses.map((item) => [item.sourceLanguage.id, item.sourceLanguage])).values()];
    sourceOptions.replaceChildren(...sources.map((language) => languageChoice(
      language, language.id, "setup-source-language", language.id === sourceId, () => {
        sourceId = language.id;
        selectedId = "";
        showChoices();
      },
    )));
    targetQuestion.disabled = !sourceId;
    targetOptions.replaceChildren(...courses.filter((item) => item.sourceLanguage.id === sourceId).map((item) => languageChoice(
      item.targetLanguage, item.id, "setup-target-language", item.id === selectedId, () => {
        selectedId = item.id;
        showChoices();
      },
    )));
    submit.disabled = !selectedId;
  }
  const chooseCourse = (event) => {
    event.preventDefault();
    if (closed || installing) return;
    const selected = courses.find((item) => item.id === selectedId && item.sourceLanguage.id === sourceId);
    if (!selected) return;
    try { scope.localStorage.setItem(SELECTED_HOME_COURSE, selected.id); } catch { /* Optional resume preference. */ }
    if (selected.id === course.id) { void download(); return; }
    try { scope.sessionStorage.setItem(PENDING_HOME_COURSE, selected.id); } catch { /* Optional handoff. */ }
    scope.location.assign(selected.entryPath);
  };
  const previousBack = scope.CaatuuHandleAndroidBack;
  const handleBack = () => {
    if (!installing) return previousBack?.() || false;
    void stopDownload();
    return true;
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    stopPolling();
    form.removeEventListener("submit", chooseCourse);
    scope.removeEventListener("pagehide", handlePageHide);
    if (scope.CaatuuHandleAndroidBack === handleBack) scope.CaatuuHandleAndroidBack = previousBack;
    action.onclick = null;
    cancel.onclick = null;
    client.dispose();
  };
  const handlePageHide = () => {
    cleanup();
    const error = new Error("Course setup page closed.");
    error.name = "AbortError";
    fail(error);
  };
  const ready = () => {
    showPreparing();
    text("setupCount", t("setup.preparing"));
    setProgress(99);
    action.hidden = true;
    cancel.hidden = true;
    // File verification unlocks imports, not navigation. The canonical bootstrap
    // still owns CaatuuShellReady and announces ready after the workspace loads.
    retryVerifiedSetupImages(scope);
    cleanup();
    finish(true);
  };
  const followStatus = (result, { afterDownload = false } = {}) => {
    if (closed) return;
    stopPolling();
    if (result.ready === true) { ready(); return; }
    text("setupBytes", formatSetupBytes(missingSetupBytes(result), locale));
    if (result.setupActive === true) {
      showPreparing();
      setBusy(true);
      pollTimer = scope.setTimeout(() => { void refresh({ afterDownload: true }); }, 1500);
    } else if (afterDownload) {
      showRecovery(t("common.unavailable"));
    } else {
      setBusy(false);
      showChoices();
    }
  };
  async function refresh({ afterDownload = false } = {}) {
    const current = generation;
    try {
      const result = await client.request("setup_status");
      if (closed || current !== generation) return;
      if (!result.ready && !result.setupActive && selectedIntent) {
        selectedIntent = false;
        await download();
      } else followStatus(result, { afterDownload });
    } catch (error) {
      if (!closed && current === generation) showRecovery(error, () => refresh({ afterDownload }));
    }
  }
  async function download() {
    if (closed || installing || stopping) return;
    const current = ++generation;
    stopPolling();
    showPreparing();
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.request("setup_download", (event) => {
        if (closed || current !== generation) return;
        const count = Math.max(0, Number(event.artifactCount) || 0);
        const index = Math.max(1, Number(event.artifactIndex) || 1);
        const total = Math.max(0, Number(event.totalBytes) || 0);
        const bytes = Math.max(0, Number(event.bytes) || 0);
        const fraction = total ? Math.min(1, bytes / total) : 0;
        if (count) text("setupCount", `${Math.min(index, count)} / ${count}`);
        setProgress(count ? (index - 1 + fraction) / count * 100 : fraction * 100,
          total ? `${formatSetupBytes(bytes, locale)} / ${formatSetupBytes(total, locale)}` : "");
      });
      if (closed || current !== generation) return;
      if (result.ready === true) ready();
      else await refresh({ afterDownload: true });
    } catch (error) {
      if (!closed && current === generation) showRecovery(error);
    }
  }
  async function stopDownload() {
    if (closed || !installing || stopping) return;
    stopping = true;
    generation++;
    stopPolling();
    cancel.disabled = true;
    try {
      const result = await client.request("setup_abort");
      if (closed) return;
      if (result.ready === true) { ready(); return; }
      showRecovery(setupMessages[setupLocale(locale)].cancelled, download, { cancelled: true });
    } catch (error) { if (!closed) showRecovery(error); }
    finally { stopping = false; }
  }

  card.hidden = false;
  showPreparing();
  document.body.classList.add("setup-blocked");
  action.hidden = true;
  cancel.hidden = true;
  for (const id of ["setupDetailsToggle", "setupDetails", "setupReportBug"]) hide(id, true);
  text("setupPhase", t("setup.checking"));
  text("setupCount", t("setup.checking"));
  setProgress(0);
  form.addEventListener("submit", chooseCourse);
  scope.CaatuuHandleAndroidBack = handleBack;
  scope.addEventListener("pagehide", handlePageHide);
  void refresh();
  return completion;
}

export async function initializeCourseSetup(scope = globalThis) {
  const document = scope.document;
  const root = document.querySelector("[data-course-setup]");
  const find = (selector) => root.querySelector(selector);
  const action = find("[data-action]");
  const status = find("[data-status]");
  let locale = setupLocale(scope.navigator?.language);
  let messages = setupMessages[locale];
  try {
    const response = await scope.fetch("/caatuu-course-bundle.json", { cache: "no-store" });
    if (!response.ok) throw new Error(messages.unavailable);
    const courses = availableSetupCourses(await response.json());
    if (root.dataset.courseSetup === "picker") {
      const source = find("[data-source]");
      const list = find("[data-courses]");
      const sources = [...new Map(courses.map((course) => [course.sourceLanguage.locale, course.sourceLanguage])).values()];
      if (!sources.length) throw new Error(messages.empty);
      let preferred = scope.navigator?.language || "en";
      try { preferred = scope.localStorage.getItem("caatuu.setup.source") || preferred; } catch { /* Storage is optional for the picker. */ }
      for (const language of sources) {
        const option = document.createElement("option");
        option.value = language.locale;
        option.textContent = language.nativeLabel || language.label;
        source.append(option);
      }
      source.value = sources.find((language) => language.locale === preferred)?.locale
        || sources.find((language) => language.locale.split("-")[0].toLowerCase() === String(preferred).split("-")[0].toLowerCase())?.locale || sources[0].locale;
      const render = () => {
        locale = setupLocale(source.value);
        messages = setupMessages[locale];
        document.documentElement.lang = locale;
        find("[data-title]").textContent = messages.choose;
        find("[data-description]").textContent = messages.description;
        find("[data-source-label]").textContent = messages.source;
        list.replaceChildren();
        for (const course of courses.filter((item) => item.sourceLanguage.locale === source.value)) {
          const row = document.createElement("li");
          const link = document.createElement("a");
          link.href = course.entryPath;
          link.textContent = course.targetLanguage.nativeLabel || course.targetLanguage.label;
          row.append(link);
          list.append(row);
        }
        status.textContent = list.children.length ? "" : messages.empty;
        try { scope.localStorage.setItem("caatuu.setup.source", source.value); } catch { /* Optional preference. */ }
      };
      source.addEventListener("change", render);
      render();
      return;
    }

    const course = setupCourseForPath(courses, scope.location.pathname);
    if (!course) throw new Error(messages.unknown);
    locale = setupLocale(course.sourceLanguage.locale);
    messages = setupMessages[locale];
    document.documentElement.lang = locale;
    find("[data-title]").textContent = `${course.sourceLanguage.label} → ${course.targetLanguage.nativeLabel || course.targetLanguage.label}`;
    find("[data-description]").textContent = messages.description;
    const back = find("[data-back]");
    const cancel = find("[data-cancel]");
    const progress = find("[data-progress]");
    const detail = find("[data-detail]");
    back.textContent = messages.back;
    cancel.textContent = messages.cancel;
    progress.setAttribute("aria-label", messages.progress);
    if (typeof scope.CaatuuAndroid?.postMessage !== "function") throw new Error(messages.native);
    const client = createNativeSetupClient(scope);
    let installing = false;
    let cancelled = false;
    let latest;
    let refreshTimer;
    let closed = false;
    const stopRefresh = () => {
      if (refreshTimer) scope.clearTimeout(refreshTimer);
      refreshTimer = null;
    };
    const setBusy = (busy) => {
      installing = busy;
      action.disabled = busy;
      cancel.hidden = !busy;
      back.hidden = busy;
    };
    const showStatus = (result) => {
      latest = result;
      stopRefresh();
      if (closed) return;
      if (result.ready === true) {
        status.textContent = messages.ready;
        scope.location.reload();
        return;
      }
      if (result.setupActive === true) {
        setBusy(true);
        progress.hidden = false;
        progress.removeAttribute("value");
        status.textContent = messages.downloading;
        detail.textContent = `${messages.required}: ${formatSetupBytes(missingSetupBytes(result), locale)}`;
        refreshTimer = scope.setTimeout(() => { void refresh(); }, 1500);
        return;
      }
      setBusy(false);
      progress.hidden = true;
      status.textContent = messages.prepare;
      detail.textContent = `${messages.required}: ${formatSetupBytes(missingSetupBytes(result), locale)}`;
      action.textContent = messages.download;
      action.disabled = false;
      action.onclick = download;
    };
    const refresh = async () => {
      action.disabled = true;
      status.textContent = messages.checking;
      try { showStatus(await client.request("setup_status")); }
      catch (error) {
        if (closed) return;
        setBusy(false);
        status.textContent = error.message || messages.unavailable;
        action.textContent = messages.retry;
        action.disabled = false;
        action.onclick = refresh;
      }
    };
    async function download() {
      if (installing) return;
      cancelled = false;
      setBusy(true);
      progress.hidden = false;
      progress.removeAttribute("value");
      status.textContent = messages.downloading;
      try {
        const result = await client.request("setup_download", (event) => {
          status.textContent = messages.downloading;
          const index = Math.max(0, Number(event.artifactIndex) || 0);
          const count = Math.max(0, Number(event.artifactCount) || 0);
          if (count) detail.textContent = `${Math.min(index + 1, count)} / ${count}`;
          const read = Number(event.bytes);
          const total = Number(event.totalBytes);
          if (total > 0 && Number.isFinite(read)) {
            progress.value = Math.max(0, Math.min(100, read / total * 100));
          } else progress.removeAttribute("value");
        });
        if (!cancelled) {
          status.textContent = messages.verifying;
          showStatus(result.ready === true ? result : await client.request("setup_status"));
        }
      } catch (error) {
        status.textContent = cancelled ? messages.cancelled : error.message || messages.unavailable;
        action.textContent = messages.retry;
      } finally {
        progress.hidden = true;
        setBusy(false);
      }
    }
    async function stopDownload() {
      if (cancel.disabled) return;
      cancel.disabled = true;
      cancelled = true;
      stopRefresh();
      try {
        latest = await client.request("setup_abort");
        status.textContent = messages.cancelled;
        detail.textContent = `${messages.required}: ${formatSetupBytes(missingSetupBytes(latest), locale)}`;
      } catch (error) { status.textContent = error.message || messages.unavailable; }
      finally {
        cancel.disabled = false;
        setBusy(false);
        progress.hidden = true;
        action.textContent = messages.retry;
        action.onclick = download;
      }
    }
    cancel.onclick = stopDownload;
    const previousBack = scope.CaatuuHandleAndroidBack;
    const handleBack = () => {
      if (!installing) return previousBack?.() || false;
      void stopDownload();
      return true;
    };
    scope.CaatuuHandleAndroidBack = handleBack;
    scope.addEventListener("pagehide", () => {
      closed = true;
      stopRefresh();
      client.dispose();
      if (scope.CaatuuHandleAndroidBack === handleBack) scope.CaatuuHandleAndroidBack = previousBack;
    }, { once: true });
    await refresh();
  } catch (error) {
    status.textContent = error.message || messages.unavailable;
    action.hidden = false;
    action.disabled = false;
    action.textContent = messages.retry;
    action.onclick = () => scope.location.reload();
  }
}

if (typeof document !== "undefined" && document.querySelector("[data-course-setup]")) void initializeCourseSetup();
