import { mountAudioLab } from "./audio-lab.mjs";
import { mountVerbDifficulty, mountDictionaryInspector } from "./catalog-inspectors.mjs";
import { mountEmbeddingImages, mountDebugChat } from "./model-tools.mjs";

export const DEVELOPER_TOOLS = Object.freeze([
  { id: "audio-lab", label: "developer.tools.audio", mount: mountAudioLab, language: true },
  { id: "embedding-images", label: "developer.tools.images", mount: mountEmbeddingImages, language: false },
  { id: "verb-difficulty", label: "developer.tools.verbs", mount: mountVerbDifficulty, language: true },
  { id: "dictionary", label: "developer.tools.dictionary", mount: mountDictionaryInspector, language: true },
  { id: "debug-chat", label: "developer.tools.chat", mount: mountDebugChat, language: true }
]);

export const DEVELOPER_TOOLS_MESSAGES = Object.freeze({
  "developer.tools.audio": "Audio Lab",
  "developer.tools.chat": "Debug Chat",
  "developer.tools.description": "Inspect Caatuu without changing your learning course. Each tool checks the data and services it needs.",
  "developer.tools.dictionary": "Dictionary inspector",
  "developer.tools.images": "Embedding Images",
  "developer.tools.language": "Language",
  "developer.tools.loading": "Opening developer tool…",
  "developer.tools.tool": "Tool",
  "developer.tools.unavailable": "This tool could not open. {reason}",
  "developer.tools.verbs": "Verb difficulty"
});

export function developerCourses(course) {
  const records = course?.courseSelector?.courses || [course];
  const seen = new Set();
  return records.filter((record) => {
    if (!record?.id || seen.has(record.id) || !/^\/[a-z0-9-]+$/u.test(record.routePrefix || "")) return false;
    seen.add(record.id);
    return true;
  }).map((record) => ({
    ...record,
    ...(record.id === course.id ? course : {}),
    ...record.developerContext
  }));
}

export async function mountDeveloperTools({ root, screenRoot, host = globalThis, course = host.CaatuuCourse, onNavigate = () => {} }) {
  const doc = root.ownerDocument;
  const t = (key, args) => host.CaatuuI18n.t(key, args);
  const records = developerCourses(course);
  let cleanup = null;
  let pendingController = null;
  let request = 0;
  let activeTool = null;
  let opener = null;
  let disposed = false;
  const list = doc.createElement("nav");
  list.className = "developer-tool-list";
  list.setAttribute("aria-label", t("settings.developer.tools"));
  const listeners = [];
  for (const tool of DEVELOPER_TOOLS) {
    const button = doc.createElement("button");
    button.type = "button";
    button.dataset.developerTool = tool.id;
    const name = doc.createElement("span");
    name.textContent = t(tool.label);
    const arrow = doc.createElement("span");
    arrow.className = "developer-tool-list-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";
    button.append(name, arrow);
    const select = () => {
      if (disposed) return;
      opener = button;
      activeTool = tool;
      title.textContent = t(tool.label);
      languageField.hidden = !tool.language;
      root.hidden = true;
      screenRoot.hidden = false;
      onNavigate(tool);
      body.scrollTop = 0;
      title.focus();
      void open();
    };
    button.addEventListener("click", select);
    listeners.push(() => button.removeEventListener("click", select));
    list.append(button);
  }
  root.replaceChildren(list);
  root.hidden = false;

  const header = doc.createElement("header");
  header.className = "developer-tool-screen-head";
  const back = doc.createElement("button");
  back.type = "button";
  back.dataset.developerBack = "";
  back.textContent = `← ${t("common.back")}`;
  back.setAttribute("aria-label", t("nav.backto", { destination: t("settings.developer.tools") }));
  const heading = doc.createElement("div");
  const kicker = doc.createElement("p");
  kicker.className = "settings-kicker";
  kicker.textContent = t("settings.developer.tools");
  const title = doc.createElement("h2");
  title.id = "developerToolTitle";
  title.tabIndex = -1;
  heading.append(kicker, title);
  header.append(back, heading);
  const body = doc.createElement("div");
  body.className = "developer-tool-screen-body";
  const languageField = doc.createElement("label");
  languageField.className = "developer-tool-field developer-tool-language";
  const languageLabel = doc.createElement("span");
  languageLabel.textContent = t("developer.tools.language");
  const language = doc.createElement("select");
  language.setAttribute("aria-label", t("developer.tools.language"));
  language.dataset.developerSelect = "language";
  for (const record of records) {
    const option = doc.createElement("option");
    option.value = record.id;
    option.textContent = host.CaatuuI18n.languageName(record.targetLanguage);
    language.append(option);
  }
  language.value = records.some((record) => record.id === course.id) ? course.id : records[0]?.id || "";
  languageField.append(languageLabel, language);
  const content = doc.createElement("section");
  content.className = "developer-tool-content";
  body.append(languageField, content);
  screenRoot.replaceChildren(header, body);
  screenRoot.hidden = true;

  function release() {
    request += 1;
    pendingController?.abort();
    pendingController = null;
    cleanup?.();
    cleanup = null;
  }
  function close(restoreFocus = true) {
    const wasOpen = Boolean(activeTool);
    release();
    activeTool = null;
    content.replaceChildren();
    content.removeAttribute("aria-busy");
    screenRoot.hidden = true;
    root.hidden = false;
    if (wasOpen) onNavigate(null);
    if (restoreFocus) opener?.focus();
  }
  function goBack() { close(); }
  function onKeydown(event) {
    if (event.key !== "Escape" || !activeTool) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }
  async function open() {
    if (!activeTool || disposed) return;
    release();
    const current = request;
    const tool = activeTool;
    const selected = records.find((record) => record.id === language.value) || course;
    content.setAttribute("aria-label", t(tool.label));
    content.setAttribute("aria-busy", "true");
    // Each mount owns an element, so late async work cannot replace a newer screen.
    const Controller = host.AbortController || globalThis.AbortController;
    const controller = typeof Controller === "function" ? new Controller() : null;
    pendingController = controller;
    const mountRoot = doc.createElement("div");
    mountRoot.textContent = t("developer.tools.loading");
    content.replaceChildren(mountRoot);
    try {
      const dispose = await tool.mount({ root: mountRoot, course: selected, host, t, signal: controller?.signal });
      if (request !== current) dispose?.();
      else cleanup = typeof dispose === "function" ? dispose : null;
    } catch (error) {
      if (request === current) {
        mountRoot.className = "developer-tool-status is-error";
        mountRoot.setAttribute("role", "alert");
        mountRoot.textContent = t("developer.tools.unavailable", { reason: String(error?.message || error) });
      }
    } finally {
      if (request === current) content.removeAttribute("aria-busy");
    }
  }
  back.addEventListener("click", goBack);
  screenRoot.addEventListener("keydown", onKeydown);
  language.addEventListener("change", open);
  return () => {
    disposed = true;
    close(false);
    listeners.forEach((remove) => remove());
    back.removeEventListener("click", goBack);
    screenRoot.removeEventListener("keydown", onKeydown);
    language.removeEventListener("change", open);
  };
}
