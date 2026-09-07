// This bootstrap deliberately has no course imports or downloadable artwork.
// The selected course's native setup must finish before the learning app loads.
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
