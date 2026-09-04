import { initializeWorkspaceAfterDictionaryProvider } from "./dictionary-provider-loader.mjs";

const course = globalThis.CaatuuCourse;

if (!course || typeof course !== "object") {
  throw new Error("The course profile must load before the Caatuu application.");
}

function captureInitialNavigationRequest() {
  if (document.documentElement.dataset.navigationRequest) return;
  const url = new URL(globalThis.location.href);
  const gameId = String(url.searchParams.get("game") || "").trim();
  const viewId = String(url.searchParams.get("view") || "").trim();
  if (gameId) document.documentElement.dataset.navigationRequest = `game:${gameId}`;
  else if (viewId) document.documentElement.dataset.navigationRequest = viewId;
}

captureInitialNavigationRequest();

const routeBase = `${String(course.routePrefix || "").replace(/\/$/u, "")}/`;
const courseUrl = (path) => new URL(String(path || "").replace(/^\.\//u, ""), `${location.origin}${routeBase}`).href;

function loadStyle(path) {
  return new Promise((resolve, reject) => {
    const href = courseUrl(path);
    const existing = [...document.styleSheets].some((sheet) => sheet.href === href);
    if (existing) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", () => reject(new Error(`Could not load ${path}.`)), { once: true });
    const sharedHomeStyle = document.querySelector('link[href*="/caatuu-home.css"]');
    document.head.insertBefore(link, sharedHomeStyle);
  });
}

function loadScriptUrl(src, label = src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error(`Could not load ${label}.`)), { once: true });
    document.body.append(script);
  });
}

function loadScript(path) {
  return loadScriptUrl(courseUrl(path), path);
}

function loadSharedScript(path) {
  return loadScriptUrl(new URL(path, globalThis.location.origin).href, path);
}

const nativeSpeechPending = new Map();
let nativeSpeechRequestSequence = 0;

function declaredBrowserProvider(name) {
  const module = String(course.browserProviders?.[name] || "").trim();
  if (!module) return "";
  if (!/^source\/[A-Za-z0-9._/-]+\.js\?v=[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(module)) {
    throw new Error(`Course browser provider ${name} is not a confined revisioned JavaScript module.`);
  }
  return module;
}

function hasNativeBridge() {
  return Boolean(globalThis.CaatuuAndroid && typeof globalThis.CaatuuAndroid.postMessage === "function");
}

function receiveSharedNativeSpeech(rawMessage) {
  let message;
  try {
    message = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
  } catch {
    return false;
  }
  const pending = nativeSpeechPending.get(String(message?.id || ""));
  if (!pending) return false;
  if (message.kind === "done") {
    nativeSpeechPending.delete(pending.id);
    globalThis.clearTimeout(pending.timeout);
    pending.resolve(message.result || {});
    return true;
  }
  if (message.kind === "error") {
    nativeSpeechPending.delete(pending.id);
    globalThis.clearTimeout(pending.timeout);
    pending.reject(new Error(message.message || "Native speech failed."));
    return true;
  }
  try {
    pending.onEvent?.(message);
  } catch {
    // UI event handlers cannot interrupt the native request lifecycle.
  }
  return true;
}

function nativeSpeechCall(type, payload = {}, handlers = {}) {
  if (!hasNativeBridge()) return Promise.reject(new Error("Native speech is not available."));
  const id = `shared-speech-${Date.now()}-${nativeSpeechRequestSequence += 1}`;
  const timeoutMs = Number(handlers.timeoutMs || 60_000);
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      nativeSpeechPending.delete(id);
      reject(new Error(handlers.timeoutMessage || "Native speech did not finish in time."));
    }, timeoutMs);
    nativeSpeechPending.set(id, {
      id,
      onEvent: typeof handlers.onEvent === "function" ? handlers.onEvent : null,
      reject,
      resolve,
      timeout
    });
    try {
      globalThis.CaatuuAndroid.postMessage(JSON.stringify({ id, type, ...payload }));
    } catch (error) {
      nativeSpeechPending.delete(id);
      globalThis.clearTimeout(timeout);
      reject(error);
    }
  });
}

function installSharedSpeechRuntime() {
  if (course.capabilities?.speech !== true || !hasNativeBridge() || globalThis.CaatuuRuntime?.speech) return;
  const locale = String(
    course.targetLanguage?.speechLocale
    || course.targetLanguage?.locale
    || course.targetLanguage?.id
    || "und"
  ).trim().replace(/_/gu, "-");
  const languageLabel = String(course.targetLanguage?.label || "target-language");
  const existingNativeReceiver = typeof globalThis.CaatuuNative?.receive === "function"
    ? globalThis.CaatuuNative.receive.bind(globalThis.CaatuuNative)
    : null;
  globalThis.CaatuuNative = {
    ...(globalThis.CaatuuNative || {}),
    receive(rawMessage) {
      if (receiveSharedNativeSpeech(rawMessage)) return;
      existingNativeReceiver?.(rawMessage);
    }
  };

  const speech = Object.freeze({
    status(_requestedLocale = locale, options = {}) {
      return nativeSpeechCall(
        "speech_status",
        {
          locale,
          voice: String(options.voice || "").trim().slice(0, 256)
        },
        {
          timeoutMs: 10_000,
          timeoutMessage: `${languageLabel} speech did not finish its availability check.`
        }
      );
    },
    speak(text, options = {}, handlers = {}) {
      const normalizedText = String(text || "").normalize("NFC").trim();
      if (!normalizedText) return Promise.reject(new Error(`${languageLabel} speech requires text.`));
      if (normalizedText.length > 1_000) {
        return Promise.reject(new Error(`${languageLabel} speech supports up to 1,000 characters.`));
      }
      const rate = Number(options.rate);
      const pitch = Number(options.pitch);
      return nativeSpeechCall(
        "speech_speak",
        {
          text: normalizedText,
          locale,
          rate: Number.isFinite(rate) ? Math.max(0.5, Math.min(1.5, rate)) : 0.6,
          pitch: Number.isFinite(pitch) ? Math.max(0.5, Math.min(1.5, pitch)) : 1,
          voice: String(options.voice || "").trim().slice(0, 256)
        },
        {
          ...handlers,
          timeoutMs: Number(handlers.timeoutMs || 60_000),
          timeoutMessage: handlers.timeoutMessage || `${languageLabel} speech did not finish in time.`
        }
      );
    },
    stop() {
      return nativeSpeechCall(
        "speech_stop",
        {},
        { timeoutMs: 3_000, timeoutMessage: `${languageLabel} speech did not stop in time.` }
      );
    },
    installData() {
      return nativeSpeechCall(
        "speech_install_data",
        {},
        { timeoutMs: 10_000, timeoutMessage: `Could not open the ${languageLabel} voice installer.` }
      );
    }
  });
  const runtime = globalThis.CaatuuRuntime && typeof globalThis.CaatuuRuntime === "object"
    ? globalThis.CaatuuRuntime
    : {};
  globalThis.CaatuuRuntime = {
    ...runtime,
    env: runtime.env || "android",
    speech
  };
}

function setCourseIdentity() {
  // The shared shell is authored in the learner/source language. Target-language
  // content marks its own locale narrowly inside each shared component.
  document.documentElement.lang = course.sourceLanguage?.locale || course.sourceLanguage?.id || "en";
  document.documentElement.dir = course.sourceLanguage?.direction || "ltr";
  document.body.dataset.courseId = course.id;
  document.body.dataset.targetScript = globalThis.CaatuuShellPolicy?.targetScriptToken?.(course) || "Zyyy";
  document.title = course.workspaceLabel || course.brandLabel || "Caatuu";
  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) manifest.href = courseUrl("manifest.webmanifest");
  if (course.status !== "active") {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.append(robots);
  }
  const nav = document.querySelector("[data-caatuu-bottom-nav]");
  nav?.setAttribute("aria-label", `${course.workspaceLabel || "Caatuu"} sections`);
}

const READY_HOME_ART = "/assets/icons/hello.png";

function setHomeText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function readyArtifactRow(label, kind) {
  const row = document.createElement("div");
  const icon = document.createElement("i");
  const title = document.createElement("strong");
  const meta = document.createElement("span");
  row.className = "setup-artifact";
  row.dataset.ready = "true";
  row.dataset.kind = kind;
  row.dataset.status = "ready";
  row.style.setProperty("--artifact-progress", "100%");
  icon.className = "setup-artifact-icon";
  icon.textContent = "\u2713";
  title.textContent = label;
  meta.textContent = "Ready";
  row.append(icon, title, meta);
  return row;
}

function bindReadyHomeDetails(card) {
  const toggle = document.getElementById("setupDetailsToggle");
  const details = document.getElementById("setupDetails");
  if (!toggle || toggle.dataset.readyHomeBound === "true") return;
  toggle.dataset.readyHomeBound = "true";
  toggle.addEventListener("click", () => {
    const open = !card.classList.contains("details-open");
    card.classList.toggle("details-open", open);
    if (details) details.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Hide details" : "Show details";
  });
}

function renderReadyCourseHome() {
  const card = document.getElementById("nativeSetup");
  if (!card) return;
  const sourceLabel = String(course.sourceLanguage?.label || "Source language");
  const targetLabel = String(course.targetLanguage?.label || "Target language");
  const courseLabel = `${sourceLabel} to ${targetLabel}`;
  const art = document.querySelector("#view-home .stage-art");
  if (art) {
    art.src = READY_HOME_ART;
    art.dataset.setupArtFallback = READY_HOME_ART;
    art.classList.remove("is-looping");
  }

  card.hidden = false;
  card.classList.add("is-ready");
  card.classList.remove("is-error", "is-updating", "is-app-update-lock", "details-open");
  const details = document.getElementById("setupDetails");
  if (details) details.hidden = true;
  setHomeText("#setupTitle", "Caatuu is ready");
  setHomeText("#setupPhase", "Ready");
  setHomeText("#setupMessage", `${courseLabel} is ready.`);
  setHomeText("#setupPercent", "100%");
  setHomeText("#setupCount", "Ready");
  setHomeText("#setupBytes", "Course files available");

  const progress = document.getElementById("setupProgress");
  progress?.setAttribute("aria-valuenow", "100");
  progress?.setAttribute("aria-valuetext", `${courseLabel} is ready`);
  const progressBar = document.getElementById("setupProgressBar");
  if (progressBar) progressBar.style.width = "100%";

  const artifacts = document.getElementById("setupArtifacts");
  if (artifacts) {
    const rows = [readyArtifactRow(`${targetLabel} course`, "browser-data")];
    if (course.capabilities?.embeddings === true) {
      rows.push(readyArtifactRow("English-backed embeddings", "embedding-vector-db"));
    }
    artifacts.replaceChildren(...rows);
  }

  const log = document.getElementById("setupLog");
  if (log) {
    const entry = document.createElement("li");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    entry.dataset.kind = "ready";
    title.textContent = "Course ready";
    detail.textContent = courseLabel;
    entry.append(title, detail);
    log.replaceChildren(entry);
  }

  for (const id of ["setupAction", "setupAbort", "setupReportBug"]) {
    const control = document.getElementById(id);
    if (control) control.hidden = true;
  }
  const detailsToggle = document.getElementById("setupDetailsToggle");
  if (detailsToggle) {
    detailsToggle.hidden = false;
    detailsToggle.setAttribute("aria-expanded", "false");
    detailsToggle.textContent = "Show details";
  }
  bindReadyHomeDetails(card);
}

function configureGameRoutes() {
  const routes = course.routes || {};
  const routeBindings = {
    conjugationCometEmbeddedGame: routes.conjugationComet,
    caseCosmosEmbeddedGame: routes.caseCosmos,
    agreementAuroraEmbeddedGame: routes.agreementAurora
  };
  for (const [id, path] of Object.entries(routeBindings)) {
    const frame = document.getElementById(id);
    if (frame) frame.dataset.src = typeof path === "string" ? path : "";
  }
}

function applyCapabilityBoundaries() {
  const dictionary = course.capabilities?.dictionary === true;
  document.querySelectorAll('[data-course-capability="dictionary"]').forEach((node) => {
    node.hidden = !dictionary;
    node.toggleAttribute("inert", !dictionary);
    node.setAttribute("aria-hidden", String(!dictionary));
  });
  if (!dictionary) {
    for (const id of ["printBackdrop", "printMenu", "printBook"]) {
      const node = document.getElementById(id);
      if (node) {
        node.hidden = true;
        node.toggleAttribute("inert", true);
      }
    }
  }

  if (course.capabilities?.offlineModels === true) {
    document.body.classList.add("setup-blocked");
  } else {
    document.body.classList.remove("setup-blocked");
    renderReadyCourseHome();
  }

  const available = new Set(globalThis.CaatuuShellPolicy?.availableGames?.(course) || []);
  document.querySelectorAll("[data-course-asset]").forEach((image) => {
    const gameId = String(image.closest("[data-course-game]")?.dataset.courseGame || "");
    if (gameId && available.has(gameId)) image.setAttribute("src", image.dataset.courseAsset);
    else image.removeAttribute("src");
  });
  document.querySelectorAll("[data-train-tab]").forEach((control) => {
    const gameId = String(control.dataset.trainTab || "");
    if (!gameId || gameId === "galaxy") return;
    const unavailable = !available.has(gameId);
    control.hidden = unavailable;
    control.toggleAttribute("inert", unavailable);
    control.setAttribute("aria-hidden", String(unavailable));
  });
  document.querySelectorAll("[data-train-panel]").forEach((panel) => {
    const gameId = panel.dataset.trainPanel;
    const unavailable = gameId !== "galaxy" && !available.has(gameId);
    if (unavailable) {
      panel.hidden = true;
      panel.toggleAttribute("inert", true);
      panel.setAttribute("aria-hidden", "true");
    } else {
      panel.removeAttribute("inert");
      panel.removeAttribute("aria-hidden");
    }
  });

}

async function loadCourseFeatureProviders() {
  const gameAvailable = (gameId) => (
    globalThis.CaatuuShellPolicy?.gameAvailable?.(course, gameId) === true
  );
  const naturalizationNucleus = gameAvailable("naturalization-nucleus");
  if (naturalizationNucleus) {
    await Promise.all([
      loadStyle("source/games/naturalization-nucleus/naturalization-nucleus.css?v=naturalization-nucleus-12"),
      loadScript("source/games/naturalization-nucleus/naturalization-nucleus.js?v=naturalization-nucleus-12")
    ]);
  }
  const courseRuntime = declaredBrowserProvider("courseRuntime");
  if (courseRuntime) await loadScript(courseRuntime);
  installSharedSpeechRuntime();
  await loadSharedScript("/language-runtime/static/source/maintenance-ui.js?v=maintenance-17");
  for (const providerName of ["semanticLearningProvider", "setupProgressProvider", "setupProvider"]) {
    const providerModule = declaredBrowserProvider(providerName);
    if (providerModule) await loadScript(providerModule);
  }
  return initializeWorkspaceAfterDictionaryProvider({
    course,
    globalScope: globalThis,
    loadScript,
    origin: location.origin,
    routeBase,
    async initializeWorkspace() {
      await loadSharedScript("/language-runtime/static/source/caatuu-workspace.js?v=workspace-13");
      const workspace = await globalThis.CaatuuWorkspaceReady;
      if (workspace?.ready !== true) {
        throw workspace?.error instanceof Error
          ? workspace.error
          : new Error("The shared workspace did not confirm successful initialization.");
      }
      return workspace;
    }
  });
}

async function registerCourseServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register(courseUrl("sw.js"), {
      scope: routeBase,
      updateViaCache: "none"
    });
  } catch {
    // Android and privacy-hardened browsers intentionally allow the app to run without a worker.
  }
}

async function start() {
  setCourseIdentity();
  configureGameRoutes();
  applyCapabilityBoundaries();
  await import("./word-world-host.mjs?v=word-world-host-15");
  await loadCourseFeatureProviders();
  document.documentElement.dataset.caatuuShellReady = "true";
  await registerCourseServiceWorker();
  document.documentElement.dataset.caatuuAppReady = "true";
  document.dispatchEvent(new CustomEvent("caatuu:app-ready", { detail: Object.freeze({ courseId: course.id }) }));
}

start().catch((error) => {
  document.documentElement.dataset.caatuuAppReady = "error";
  const home = document.querySelector("#view-home .home-main");
  const notice = document.createElement("p");
  notice.className = "empty-state";
  notice.setAttribute("role", "alert");
  notice.textContent = "Caatuu could not finish loading. Reload the page to try again.";
  home?.append(notice);
  console.error(error);
});
