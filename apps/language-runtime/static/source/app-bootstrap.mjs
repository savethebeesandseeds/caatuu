import { initializeWorkspaceAfterDictionaryProvider } from "./dictionary-provider-loader.mjs";
import { initializeHomeCourseSetup } from "./course-setup.mjs";
import {
  installInterfaceContent,
  loadInterfaceContent
} from "./interface-content.mjs?v=interface-runtime-2";

const course = globalThis.CaatuuCourse;

if (!course || typeof course !== "object") {
  throw new Error("The course profile must load before the Caatuu application.");
}

let settleShellReady;
globalThis.CaatuuShellReady = new Promise((resolve) => {
  settleShellReady = resolve;
});
document.documentElement.dataset.caatuuShellReady = "loading";
document.documentElement.dataset.caatuuAppReady = "loading";
document.body.classList.add("app-starting", "setup-blocked");
document.querySelectorAll("[data-caatuu-bottom-nav]").forEach((nav) => {
  nav.setAttribute("inert", "");
  nav.setAttribute("aria-busy", "true");
});
// Register before Chrome: its dock handlers stop other capture listeners.
document.addEventListener("click", (event) => {
  if (document.documentElement.dataset.caatuuShellReady === "true") return;
  if (!event.target.closest?.("[data-caatuu-bottom-nav]")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

function t(messageId, parameters = {}) {
  const value = globalThis.CaatuuI18n?.t?.(messageId, parameters);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Interface content did not resolve ${messageId}.`);
  }
  return value;
}

function languageName(language) {
  const value = globalThis.CaatuuI18n?.languageName?.(language);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Interface content did not resolve a language name.");
  }
  return value.trim();
}

function captureInitialNavigationRequest() {
  if (document.documentElement.dataset.navigationRequest) return;
  const url = new URL(globalThis.location.href);
  const gameId = String(url.searchParams.get("game") || "").trim();
  if (gameId === "grammar-gravity" && url.searchParams.has("practice")) {
    document.documentElement.dataset.grammarGravityPractice = url.searchParams.get("practice");
  }
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
    pending.reject(new Error(message.message || t("speech.nativefailed")));
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
  if (!hasNativeBridge()) return Promise.reject(new Error(t("speech.unavailable")));
  const id = `shared-speech-${Date.now()}-${nativeSpeechRequestSequence += 1}`;
  const timeoutMs = Number(handlers.timeoutMs || 60_000);
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      nativeSpeechPending.delete(id);
      reject(new Error(handlers.timeoutMessage || t("speech.timeout")));
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
  const languageLabel = languageName(course.targetLanguage);
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
    forLocale(inspectorLocale) {
      // Developer previews select their own language without changing the learning course.
      const selectedLocale = Intl.getCanonicalLocales(String(inspectorLocale || ""))[0];
      if (!selectedLocale) throw new Error("A speech preview requires a language.");
      return Object.freeze({
        status(_requestedLocale = selectedLocale, options = {}) {
          return nativeSpeechCall("speech_status", {
            locale: selectedLocale,
            voice: String(options.voice || "").trim().slice(0, 256)
          }, { timeoutMs: 10_000 });
        },
        speak(text, options = {}, handlers = {}) {
          const normalizedText = String(text || "").normalize("NFC").trim();
          if (!normalizedText) {
            return Promise.reject(new Error(t("speech.textrequired", { language: selectedLocale })));
          }
          if (normalizedText.length > 1_000) {
            return Promise.reject(new Error(t("speech.texttoolong", { language: selectedLocale, count: 1000 })));
          }
          return nativeSpeechCall("speech_speak", {
            text: normalizedText,
            locale: selectedLocale,
            voice: String(options.voice || "").trim().slice(0, 256),
            rate: Number.isFinite(Number(options.rate)) ? Math.max(0.5, Math.min(1.5, Number(options.rate))) : 0.6,
            pitch: Number.isFinite(Number(options.pitch)) ? Math.max(0.5, Math.min(1.5, Number(options.pitch))) : 1
          }, handlers);
        },
        stop() { return nativeSpeechCall("speech_stop", {}, { timeoutMs: 3_000 }); },
        installData() { return nativeSpeechCall("speech_install_data", {}, { timeoutMs: 10_000 }); }
      });
    },
    status(_requestedLocale = locale, options = {}) {
      return nativeSpeechCall(
        "speech_status",
        {
          locale,
          voice: String(options.voice || "").trim().slice(0, 256)
        },
        {
          timeoutMs: 10_000,
          timeoutMessage: t("speech.checktimeout", { language: languageLabel })
        }
      );
    },
    speak(text, options = {}, handlers = {}) {
      const normalizedText = String(text || "").normalize("NFC").trim();
      if (!normalizedText) {
        return Promise.reject(new Error(t("speech.textrequired", { language: languageLabel })));
      }
      if (normalizedText.length > 1_000) {
        return Promise.reject(new Error(t("speech.texttoolong", { language: languageLabel, count: 1000 })));
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
          timeoutMessage: handlers.timeoutMessage || t("speech.languagetimeout", { language: languageLabel })
        }
      );
    },
    stop() {
      return nativeSpeechCall(
        "speech_stop",
        {},
        { timeoutMs: 3_000, timeoutMessage: t("speech.stoptimeout", { language: languageLabel }) }
      );
    },
    installData() {
      return nativeSpeechCall(
        "speech_install_data",
        {},
        { timeoutMs: 10_000, timeoutMessage: t("speech.installererror", { language: languageLabel }) }
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
  const targetLabel = languageName(course.targetLanguage);
  document.title = t("app.title", { target: targetLabel });
  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) manifest.href = courseUrl("manifest.webmanifest");
  if (course.status !== "active") {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.append(robots);
  }
  const nav = document.querySelector("[data-caatuu-bottom-nav]");
  nav?.setAttribute("aria-label", t("navigation.sections", { target: targetLabel }));
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
  meta.textContent = t("common.ready");
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
    toggle.textContent = t(open ? "common.hidedetails" : "common.showdetails");
  });
}

function renderReadyCourseHome() {
  const card = document.getElementById("nativeSetup");
  if (!card) return;
  const sourceLabel = languageName(course.sourceLanguage);
  const targetLabel = languageName(course.targetLanguage);
  const courseLabel = t("course.direction", { source: sourceLabel, target: targetLabel });
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
  setHomeText("#setupTitle", t("setup.readytitle"));
  setHomeText("#setupPhase", t("common.ready"));
  setHomeText("#setupMessage", t("setup.readymessage", { course: courseLabel }));
  setHomeText("#setupPercent", "100%");
  setHomeText("#setupCount", t("common.ready"));
  setHomeText("#setupBytes", t("setup.filesavailable"));

  const progress = document.getElementById("setupProgress");
  progress?.setAttribute("aria-valuenow", "100");
  progress?.setAttribute("aria-valuetext", t("setup.readystatus", { course: courseLabel }));
  const progressBar = document.getElementById("setupProgressBar");
  if (progressBar) progressBar.style.width = "100%";

  const artifacts = document.getElementById("setupArtifacts");
  if (artifacts) {
    const rows = [readyArtifactRow(t("setup.targetcourse", { target: targetLabel }), "browser-data")];
    if (course.capabilities?.embeddings === true) {
      rows.push(readyArtifactRow(t("setup.englishembeddings"), "embedding-vector-db"));
    }
    artifacts.replaceChildren(...rows);
  }

  const log = document.getElementById("setupLog");
  if (log) {
    const entry = document.createElement("li");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    entry.dataset.kind = "ready";
    title.textContent = t("setup.courseready");
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
    detailsToggle.textContent = t("common.showdetails");
  }
  bindReadyHomeDetails(card);
}

function renderStartingCourseHome() {
  const card = document.getElementById("nativeSetup");
  if (!card) return;
  card.hidden = false;
  card.classList.remove("is-ready", "is-error");
  card.setAttribute("aria-busy", "true");
  setHomeText("#setupTitle", t("setup.preparing"));
  setHomeText("#setupPhase", t("setup.checking"));
  setHomeText("#setupMessage", t("setup.preparing"));
  for (const id of ["setupAction", "setupAbort", "setupDetailsToggle", "setupProgress"]) {
    const control = document.getElementById(id);
    if (control) control.hidden = true;
  }
  card.querySelector(".setup-progress-meta")?.setAttribute("hidden", "");
}

function configureGameRoutes() {
  const routes = course.routes || {};
  const routeBindings = {
    conjugationCometEmbeddedGame: routes.conjugationComet,
    caseCosmosEmbeddedGame: routes.caseCosmos,
    grammarGravityEmbeddedGame: routes.grammarGravity
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

  document.body.classList.add("setup-blocked");
  // Setup providers own progress and navigation even when Android disables LLMs.
  if (!declaredBrowserProvider("setupProvider")) renderStartingCourseHome();

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
      loadStyle("source/games/naturalization-nucleus/naturalization-nucleus.css?v=naturalization-nucleus-18"),
      loadScript("source/games/naturalization-nucleus/naturalization-nucleus.js?v=naturalization-nucleus-18-files-2")
    ]);
  }
  const courseRuntime = declaredBrowserProvider("courseRuntime");
  if (courseRuntime) await loadScript(courseRuntime);
  installSharedSpeechRuntime();
  await loadSharedScript("/language-runtime/static/source/maintenance-ui.js?v=maintenance-24");
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
      await loadSharedScript("/language-runtime/static/source/caatuu-workspace.js?v=workspace-31");
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
  const interfaceContent = await loadInterfaceContent(course);
  installInterfaceContent(interfaceContent);
  interfaceContent.apply(document);
  setCourseIdentity();
  await loadSharedScript("/language-runtime/static/source/caatuu-chrome.js?v=chrome-162");
  // Keep the canonical Home and its language controls available while native
  // setup verifies the selected course. Curriculum and game artwork wait for it.
  await initializeHomeCourseSetup(globalThis);
  configureGameRoutes();
  applyCapabilityBoundaries();
  await import("./word-world-host.mjs?v=word-world-host-23");
  await loadCourseFeatureProviders();
  if (!declaredBrowserProvider("setupProvider")) {
    renderReadyCourseHome();
    document.getElementById("nativeSetup")?.removeAttribute("aria-busy");
    document.body.classList.remove("setup-blocked");
  }
  document.documentElement.dataset.caatuuShellReady = "true";
  document.body.classList.remove("app-starting");
  document.querySelectorAll("[data-caatuu-bottom-nav]").forEach((nav) => {
    nav.removeAttribute("inert");
    nav.removeAttribute("aria-busy");
  });
  settleShellReady(Object.freeze({ ready: true }));
  document.documentElement.dataset.caatuuAppReady = "true";
  document.dispatchEvent(new CustomEvent("caatuu:app-ready", { detail: Object.freeze({ courseId: course.id }) }));
  void registerCourseServiceWorker();
}

start().catch((error) => {
  if (error?.name === "AbortError") return;
  document.documentElement.dataset.caatuuAppReady = "error";
  document.documentElement.dataset.caatuuShellReady = "error";
  settleShellReady(Object.freeze({ ready: false, error }));
  document.body.classList.add("setup-blocked", "app-starting");
  const card = document.getElementById("nativeSetup");
  if (card) {
    card.hidden = false;
    card.classList.remove("is-ready");
    card.classList.add("is-error");
    card.removeAttribute("aria-busy");
  }
  const home = document.querySelector("#view-home .home-main");
  const notice = document.createElement("p");
  notice.className = "empty-state";
  notice.setAttribute("role", "alert");
  notice.textContent = globalThis.CaatuuI18n?.has?.("app.loaderror")
    ? globalThis.CaatuuI18n.t("app.loaderror")
    : "Caatuu could not finish loading. Reload the page to try again.";
  setHomeText("#setupTitle", notice.textContent);
  setHomeText("#setupMessage", notice.textContent);
  home?.append(notice);
  console.error(error);
});
