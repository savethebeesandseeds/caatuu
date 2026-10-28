// Local review only: omitted from app-assets.json and every release export.
// Exercise the real Home markup, styles and native setup controller without
// downloading resources, changing browser learner data, or reinstalling an APK.
import { initializeHomeCourseSetup } from "../source/course-setup.mjs?v=course-setup-5";
import { loadInterfaceContent } from "../source/interface-content.mjs?v=interface-runtime-2";

const root = document.getElementById("reviewRoot");
const parameters = new URLSearchParams(location.search);
const percent = Math.min(99, Math.max(0, Number(parameters.get("progress") ?? 42) || 0));
const theme = parameters.get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;

if (parameters.get("screen") !== "1") {
  document.body.classList.add("setup-review");
  root.replaceChildren();
  const toolbar = document.createElement("div");
  toolbar.className = "review-toolbar";
  const note = document.createElement("p");
  note.textContent = "First-install preview · real screen, simulated download · no app data changed";
  const progressLabel = document.createElement("label");
  progressLabel.textContent = "Progress";
  const progress = document.createElement("input");
  progress.type = "range";
  progress.min = "0";
  progress.max = "99";
  progress.value = String(percent);
  const output = document.createElement("output");
  output.textContent = `${percent}%`;
  progressLabel.append(progress, output);
  const themeLabel = document.createElement("label");
  themeLabel.textContent = "Theme";
  const appearance = document.createElement("select");
  for (const value of ["light", "dark"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "light" ? "Light" : "Dark";
    appearance.append(option);
  }
  appearance.value = theme;
  themeLabel.append(appearance);
  const widthLabel = document.createElement("label");
  widthLabel.textContent = "Screen";
  const width = document.createElement("select");
  for (const value of [390, 320]) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value} px`;
    width.append(option);
  }
  widthLabel.append(width);
  const frame = document.createElement("iframe");
  frame.className = "review-phone";
  frame.title = "Caatuu first-install resource download screen";
  const update = () => {
    frame.src = `native-setup.html?screen=1&progress=${progress.value}&theme=${appearance.value}`;
    output.textContent = `${progress.value}%`;
    document.documentElement.dataset.theme = appearance.value;
    frame.style.width = `${width.value}px`;
  };
  progress.addEventListener("change", update);
  appearance.addEventListener("change", update);
  width.addEventListener("change", update);
  toolbar.append(note, progressLabel, themeLabel, widthLabel);
  root.append(toolbar, frame);
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow
      || event.data?.type !== "caatuu-setup-review-theme"
      || !["light", "dark"].includes(event.data.theme)) return;
    appearance.value = event.data.theme;
    document.documentElement.dataset.theme = event.data.theme;
  });
  update();
} else {
  document.documentElement.dataset.fontSize = "largest";
  document.body.className = "games-page setup-blocked setup-review-screen";
  const response = await fetch("/cz/index.html", { cache: "no-store" });
  if (!response.ok) throw new Error("Cannot load canonical Home markup.");
  const markup = new DOMParser().parseFromString(await response.text(), "text/html");
  const home = markup.getElementById("homeBaseView");
  if (!home) throw new Error("Canonical Home is missing.");
  const view = document.createElement("section");
  view.id = "view-home";
  view.className = "home-view";
  view.append(document.importNode(home, true));
  root.replaceChildren(view);
  const content = await loadInterfaceContent(window.CaatuuCourse);
  content.apply(root);
  // Production Chrome owns these existing controls. Review only changes its
  // isolated document, leaving the real learner's appearance preferences alone.
  const displayMenu = root.querySelector("#setupDisplayMenu");
  const applyReviewTheme = (value) => {
    document.documentElement.dataset.theme = value;
    root.querySelectorAll("[data-theme-option]").forEach((button) => {
      const active = button.dataset.themeOption === value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    window.parent.postMessage({ type: "caatuu-setup-review-theme", theme: value }, location.origin);
  };
  const applyReviewFontSize = (value) => {
    document.documentElement.dataset.fontSize = value;
    displayMenu.querySelectorAll("[data-font-size-option]").forEach((button) => {
      const active = button.dataset.fontSizeOption === value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  };
  displayMenu.addEventListener("click", (event) => {
    const themeOption = event.target.closest("[data-theme-option]");
    const fontOption = event.target.closest("[data-font-size-option]");
    if (themeOption) applyReviewTheme(themeOption.dataset.themeOption);
    if (fontOption) applyReviewFontSize(fontOption.dataset.fontSizeOption);
  });
  document.addEventListener("click", (event) => {
    if (!displayMenu.contains(event.target)) displayMenu.open = false;
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !displayMenu.open) return;
    displayMenu.open = false;
    displayMenu.querySelector("summary").focus();
  });
  applyReviewTheme(theme);
  applyReviewFontSize(document.documentElement.dataset.fontSize);
  const saved = new Map([["caatuu.setup.selected-course.v1", "cz"]]);
  const memoryStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
    removeItem: (key) => saved.delete(key),
  };
  if (parameters.has("app-update")) {
    // Isolated update-availability review: production markup and controller,
    // memory-only preferences, and no native download or installer access.
    document.title = "Caatuu · Home update review";
    document.body.classList.remove("setup-blocked");
    saved.set("caatuu.appearance.theme.v1", theme);
    Object.defineProperty(window, "localStorage", { value: memoryStorage });
    Object.defineProperty(window, "sessionStorage", { value: memoryStorage });
    window.CaatuuI18n = content;
    window.CaatuuRuntime = { env: "android", maintenance: {
      updateStatus: async () => ({ selfUpdateEnabled: true, currentVersionCode: 1,
        latestVersionCode: 2, updateAvailable: parameters.get("app-update") !== "current" }),
      updateApp: async () => { throw new Error("Local preview only; no update is started."); },
    } };
    window.CaatuuAndroid = { isCourseBundled: () => true };
    const card = root.querySelector("#nativeSetup");
    card.hidden = true;
    card.classList.add("is-ready");
    await import("../source/caatuu-chrome.js?v=chrome-201");
    await import("../source/maintenance-ui.js?v=maintenance-27");
    await window.CaatuuMaintenanceUi.getUpdateController().refresh({ announce: false });
  } else {
    const totalBytes = 100_000_000;
    const scope = {
      document, CaatuuCourse: window.CaatuuCourse, CaatuuI18n: content,
      location: { pathname: "/cz/index.html", origin: location.origin, href: `${location.origin}/cz/index.html` },
      localStorage: memoryStorage, sessionStorage: memoryStorage,
      setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
      addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
      matchMedia: window.matchMedia.bind(window),
      CaatuuAndroid: {
        isCourseBundled: (id) => id === window.CaatuuCourse.id,
        postMessage(raw) {
          const request = JSON.parse(raw);
          const receive = (message) => queueMicrotask(() => scope.CaatuuNative.receive({ id: request.id, ...message }));
          if (request.type === "setup_status" || request.type === "setup_abort") {
            receive({ kind: "done", result: { ready: false, bytes: percent / 100 * totalBytes, expectedBytes: totalBytes } });
          } else if (request.type === "setup_download") {
            receive({ kind: "progress", phase: "asset_download", artifactIndex: 12, artifactCount: 28,
              bytes: percent / 100 * totalBytes, totalBytes,
              label: "Course illustrations", message: "Downloading course illustrations for offline use." });
          }
        },
      },
    };
    // Incomplete by design: keep this one simulated download visible for review.
    void initializeHomeCourseSetup(scope).catch((error) => {
      if (error.name !== "AbortError") throw error;
    });
  }
}
