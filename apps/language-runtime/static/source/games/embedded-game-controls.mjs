// Shared embedded-game presentation controls. The shell remains the only owner
// of persisted appearance, speech preferences, voices, and speech execution.
import { mountMusicControls, mountVoiceControls } from "../music-controls.mjs";
const SVG_NS = "http://www.w3.org/2000/svg";
const SPEECH_PATHS = Object.freeze([
  "M4.5 9.25v5.5h3.25l4.75 3.75v-13L7.75 9.25H4.5Z",
  "M15.5 9.25c1.5 1.5 1.5 4 0 5.5",
  "M18.25 6.75c3 3 3 7.5 0 10.5"
]);
const PACE_KEYS = Object.freeze(["slower", "slow", "normal"]);
let audioMenuSequence = 0;

function svgElement(document, name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

export function createSpeechIcon(document, { stop = false, muted = false } = {}) {
  const svg = svgElement(document, "svg", {
    class: "caatuu-game-sound-icon", viewBox: "0 0 24 24",
    "aria-hidden": "true", focusable: "false", "data-speech-icon": stop ? "stop" : muted ? "muted" : "play"
  });
  if (stop) svg.append(svgElement(document, "rect", { x: 7, y: 7, width: 10, height: 10, rx: 1 }));
  else SPEECH_PATHS.forEach((d) => svg.append(svgElement(document, "path", { d })));
  if (muted && !stop) svg.append(svgElement(document, "path", { d: "M3 3 21 21", class: "caatuu-game-sound-slash" }));
  return svg;
}

// Loading and between-round screens share the same robot, centering, and blink.
// The host owns visibility and activity; artwork loading never delays readiness.
export function mountRobotLoadingScreen({ container, label, active = true } = {}) {
  const document = container?.ownerDocument;
  const view = document?.defaultView;
  if (!document || !view || typeof view.setTimeout !== "function"
      || typeof view.clearTimeout !== "function" || typeof label !== "string" || !label.trim()) {
    throw new Error("Robot loading screens require a local container and an accessible loading label.");
  }
  container.classList.add("caatuu-game-robot-loading");
  container.setAttribute("role", "status");
  container.setAttribute("aria-label", label);
  const image = container.querySelector(".caatuu-game-robot-loading-art") || container.querySelector("img") || document.createElement("img");
  image.classList.add("caatuu-game-robot-loading-art");
  image.setAttribute("src", "/assets/robots/robot%20(1).png");
  image.setAttribute("alt", "");
  image.setAttribute("aria-hidden", "true");
  if (!container.contains(image)) container.append(image);

  let destroyed = false;
  let elapsed = 0;
  let runningSince = null;
  const pending = new Set();
  const now = () => view.performance?.now?.() ?? Date.now();
  const visibleTime = () => elapsed + (runningSince === null ? 0 : Math.max(0, now() - runningSince));
  function finish(wait) {
    view.clearTimeout(wait.timer);
    if (pending.delete(wait)) wait.resolve();
  }
  function sync() {
    if (runningSince !== null) elapsed = visibleTime();
    runningSince = active && !container.hidden && !destroyed ? now() : null;
    container.dataset.active = String(Boolean(active));
    for (const wait of pending) {
      view.clearTimeout(wait.timer);
      wait.timer = null;
      const remaining = Math.max(0, wait.duration - elapsed);
      if (destroyed || container.hidden || remaining === 0) finish(wait);
      else if (runningSince !== null) wait.timer = view.setTimeout(() => finish(wait), remaining);
    }
  }
  sync();
  return Object.freeze({
    show() {
      if (destroyed) return;
      if (container.hidden) {
        elapsed = 0;
        runningSince = null;
        container.hidden = false;
      }
      sync();
    },
    hide() {
      if (destroyed) return;
      container.hidden = true;
      sync();
    },
    setActive(value) {
      if (destroyed) return;
      active = Boolean(value);
      sync();
    },
    minimumVisible(milliseconds) {
      if (destroyed || container.hidden) return Promise.resolve();
      const duration = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
      return new Promise((resolve) => {
        pending.add({ duration, resolve, timer: null });
        sync();
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      container.hidden = true;
      sync();
    }
  });
}

export function mountEmbeddedGameControls({ container, shell, course, onLayoutChange, settings,
  illustrations, challenge, onOpenChange, autoplay = false } = {}) {
  const document = container?.ownerDocument;
  const api = shell?.CaatuuChrome;
  const i18n = shell?.CaatuuI18n;
  if (!document || !api || typeof i18n?.t !== "function" || typeof i18n?.languageName !== "function"
      || typeof api.applyTheme !== "function" || typeof api.applyFontSize !== "function") {
    throw new Error("Embedded game controls require the shared shell and interface catalog.");
  }
  if (shell.location?.origin !== document.defaultView?.location?.origin) {
    throw new Error("Embedded game controls require a same-origin shell.");
  }
  const menuContents = new Set();
  for (const [name, menu] of Object.entries({ settings, challenge })) {
    if (!menu) continue;
    if (menu.content?.nodeType !== 1 || menu.content.ownerDocument !== document
        || typeof menu.labelKey !== "string" || !menu.labelKey.trim()) {
      throw new Error(`Embedded game ${name} require local DOM content and an interface label key.`);
    }
    if (menuContents.has(menu.content)) {
      throw new Error("Embedded game menus must use different local DOM content.");
    }
    menuContents.add(menu.content);
  }
  if (illustrations && (typeof illustrations.labelKey !== "string" || !illustrations.labelKey.trim()
      || typeof illustrations.pressed !== "boolean" || typeof illustrations.onChange !== "function"
      || illustrations.content !== undefined)) {
    throw new Error("Embedded game illustrations require an interface label key, a boolean pressed state, and an onChange callback, not menu content.");
  }
  const t = (key, replacements) => i18n.t(key, replacements);
  const disposers = [];
  const panels = [];
  const themeButtons = [];
  const sizeButtons = [];
  const layoutButtons = [];
  let layout = "columns";
  let destroyed = false;
  let autoplayToggle;
  let speed;
  let audioPanel;
  let audioToggle;
  let speechMuted;
  let menuOpen = false;

  function node(tag, className = "", text = "") {
    const value = document.createElement(tag);
    value.className = className;
    if (text) value.textContent = text;
    return value;
  }
  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    disposers.push(() => target?.removeEventListener?.(type, handler, options));
  }
  const root = node("div", "caatuu-game-controls");
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", t("common.game.controls"));
  container.append(root);

  function isOpen() {
    return panels.some(({ panel }) => !panel.hidden);
  }
  function notifyOpenChange() {
    const open = isOpen();
    if (open === menuOpen) return;
    menuOpen = open;
    if (typeof onOpenChange === "function") onOpenChange(open);
  }
  function hidePanels({ restoreFocus = false } = {}) {
    panels.forEach(({ panel, toggle }) => {
      if (panel.hidden) return;
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      if (restoreFocus) toggle.focus();
    });
  }
  function close(options) {
    hidePanels(options);
    notifyOpenChange();
  }
  function constrainPopover(panel) {
    if (panel.hidden || destroyed) return;
    // Measure the normal toolbar anchor before clamping to this frame's viewport.
    // The parent shell's dimensions are different from an embedded game's.
    panel.classList.remove("is-viewport-constrained");
    for (const property of ["left", "top", "width", "maxHeight"]) panel.style[property] = "";
    const viewport = document.defaultView;
    const visual = viewport.visualViewport;
    const margin = 16;
    const viewportWidth = visual?.width || viewport.innerWidth;
    const viewportHeight = visual?.height || viewport.innerHeight;
    const leftEdge = (visual?.offsetLeft || 0) + margin;
    const topEdge = (visual?.offsetTop || 0) + margin;
    const rightEdge = leftEdge + viewportWidth - margin * 2;
    const bottomEdge = topEdge + viewportHeight - margin * 2;
    const natural = panel.getBoundingClientRect();
    const width = Math.min(natural.width, Math.max(1, rightEdge - leftEdge));
    const maxHeight = Math.max(1, Math.min(480, viewportHeight * 0.65, bottomEdge - topEdge));
    const height = Math.min(natural.height, maxHeight);
    const left = Math.min(Math.max(natural.left, leftEdge), rightEdge - width);
    const top = Math.min(Math.max(natural.top, topEdge), bottomEdge - height);
    panel.classList.add("is-viewport-constrained");
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.width = `${Math.round(width)}px`;
    panel.style.maxHeight = `${Math.floor(Math.min(maxHeight, bottomEdge - top))}px`;
  }
  function constrainOpenPopovers() {
    panels.forEach(({ panel }) => constrainPopover(panel));
  }
  function createMenu(key, icon) {
    const toggle = node("button", "caatuu-game-control-toggle");
    toggle.type = "button";
    const label = t(key);
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    toggle.setAttribute("aria-haspopup", "dialog");
    toggle.setAttribute("aria-expanded", "false");
    toggle.append(icon);
    const panel = node("section", "caatuu-game-controls-popover");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", label);
    panel.hidden = true;
    root.append(toggle, panel);
    panels.push({ toggle, panel });
    listen(toggle, "click", () => {
      const open = panel.hidden;
      hidePanels();
      if (!open) {
        notifyOpenChange();
        return;
      }
      sync();
      panel.hidden = false;
      constrainPopover(panel);
      toggle.setAttribute("aria-expanded", "true");
      notifyOpenChange();
      panel.querySelector("button:not(:disabled), input:not(:disabled), select:not(:disabled)")?.focus();
    });
    return panel;
  }
  function imageIcon(source) {
    const image = node("img");
    image.src = source;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    return image;
  }
  function contentMenu(configuration, icon) {
    const panel = createMenu(configuration.labelKey, icon);
    panel.append(configuration.content);
    configuration.content.hidden = false;
  }
  function group(panel, key) {
    const field = node("fieldset", "caatuu-game-controls-setting");
    field.append(node("legend", "", t(key)));
    panel.append(field);
    return field;
  }
  function option(groupNode, key, value, handler, records, icon) {
    const button = node("button", "caatuu-game-control-option");
    button.type = "button";
    button.dataset.value = value;
    button.setAttribute("aria-pressed", "false");
    if (icon) button.append(icon);
    button.append(node("span", "", t(key)));
    groupNode.append(button);
    records.push(button);
    listen(button, "click", () => { handler(value); sync(); });
  }

  const display = createMenu("common.display.settings", imageIcon("/assets/icons/dark_mode_ui.png"));
  const themes = group(display, "common.theme");
  ["light", "dark"].forEach((value) => option(themes, `common.${value}`, value,
    (selected) => api.applyTheme(selected), themeButtons, imageIcon(`/assets/icons/${value}_mode_ui.png`)));
  const sizes = group(display, "common.textsize");
  sizes.classList.add("caatuu-game-size-options");
  [["largest", "standard"], ["large", "small"], ["standard", "smaller"]].forEach(([value, label]) => {
    const sample = node("span", `caatuu-game-size-sample is-${label}`, "Aa");
    sample.setAttribute("aria-hidden", "true");
    option(sizes, `common.${label}`, value, (selected) => api.applyFontSize(selected), sizeButtons, sample);
  });

  if (typeof onLayoutChange === "function") {
    const icon = svgElement(document, "svg", {
      class: "caatuu-game-sound-icon", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false"
    });
    icon.append(svgElement(document, "rect", { x: 3, y: 4, width: 7, height: 16, rx: 1 }),
      svgElement(document, "rect", { x: 14, y: 4, width: 7, height: 16, rx: 1 }));
    const layouts = group(createMenu("common.layout.settings", icon), "common.layout.settings");
    ["columns", "stacked"].forEach((value) => option(layouts, `common.layout.${value}`, value, (selected) => {
      layout = selected;
      onLayoutChange(selected);
    }, layoutButtons));
  }

  audioPanel = createMenu("common.audio.settings", createSpeechIcon(document));
  audioPanel.classList.add("caatuu-audio-menu");
  audioToggle = panels[panels.length - 1].toggle;
  const audioContents = node("div", "caatuu-audio-controls");
  audioPanel.append(node("span", "caatuu-audio-title", t("common.audio")), audioContents);
  const musicGroup = node("div", "caatuu-audio-group");
  const musicHost = node("div");
  musicGroup.append(musicHost);
  audioContents.append(musicGroup);
  const musicControl = mountMusicControls({ container: musicHost, player: shell.CaatuuMusic, i18n });
  if (musicControl) disposers.push(() => musicControl.destroy());
  if (course?.capabilities?.speech === true) {
    const voiceGroup = node("div", "caatuu-audio-group");
    const voiceHost = node("div");
    voiceGroup.append(voiceHost);
    audioContents.append(voiceGroup);
    const voiceControl = mountVoiceControls({ container: voiceHost, api, host: shell, i18n });
    if (voiceControl) disposers.push(() => voiceControl.destroy());
    const speeds = node("div", "caatuu-audio-speed");
    const speedLabel = node("label", "", t("common.speechspeed"));
    const speedControl = node("div", "caatuu-audio-speed-control");
    speed = node("input");
    speed.id = `caatuu-game-voice-speed-${++audioMenuSequence}`;
    speedLabel.setAttribute("for", speed.id);
    speed.type = "range";
    speed.min = "0";
    speed.max = "2";
    speed.step = "1";
    speed.setAttribute("aria-label", t("common.speechspeed"));
    const ticks = node("div", "caatuu-audio-speed-ticks");
    ticks.setAttribute("aria-hidden", "true");
    PACE_KEYS.forEach((key, index) => {
      const tick = node("span");
      tick.append(node("span", "", t(`common.${key}`)), node("small", "", ["0.5×", "0.6×", "1×"][index]));
      ticks.append(tick);
    });
    speedControl.append(speed, ticks);
    speeds.append(speedLabel, speedControl);
    voiceGroup.append(speeds);
    listen(speed, "input", () => {
      const value = PACE_KEYS[Number(speed.value)];
      if (!value) return;
      void api.stopSpeech();
      api.setSpeechPacePreference(value);
      sync();
    });
    if (autoplay && typeof api.getSpeechAutoplay === "function" && typeof api.setSpeechAutoplay === "function") {
      const extras = node("div", "caatuu-audio-extras");
      autoplayToggle = node("button", "caatuu-audio-extra", t("common.audio.autoplay"));
      autoplayToggle.type = "button";
      autoplayToggle.setAttribute("role", "switch");
      extras.append(autoplayToggle);
      audioContents.append(extras);
      listen(autoplayToggle, "click", () => {
        if (!api.getSpeechMuted()) api.setSpeechAutoplay(!api.getSpeechAutoplay());
        sync();
      });
    }
  }
  if (illustrations) {
    const icon = node("span", "caatuu-game-illustration-icon", "🪶");
    icon.setAttribute("aria-hidden", "true");
    const toggle = node("button", "caatuu-game-control-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-label", t(illustrations.labelKey));
    toggle.title = t(illustrations.labelKey);
    let pressed = illustrations.pressed;
    toggle.setAttribute("aria-pressed", String(pressed));
    toggle.append(icon);
    root.append(toggle);
    listen(toggle, "click", () => {
      close();
      const next = !pressed;
      illustrations.onChange(next);
      pressed = next;
      toggle.setAttribute("aria-pressed", String(pressed));
    });
  }

  if (challenge) {
    const icon = node("span", "caatuu-game-challenge-icon", "Aa");
    icon.setAttribute("aria-hidden", "true");
    contentMenu(challenge, icon);
  }

  if (settings) {
    const icon = svgElement(document, "svg", {
      class: "caatuu-game-sound-icon", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false"
    });
    if (settings.icon === "boxes") {
      for (const y of [4, 10, 16]) for (const x of [3, 13]) {
        icon.append(svgElement(document, "rect", { x, y, width: 8, height: 4, rx: 1, fill: "currentColor", stroke: "none" }));
      }
    } else icon.append(svgElement(document, "path", {
      d: "M9.5 3h5l.6 2.7 2.1 1.2 2.6-.8 2.5 4.3-2 1.9v2.4l2 1.9-2.5 4.3-2.6-.8-2.1 1.2-.6 2.7h-5l-.6-2.7-2.1-1.2-2.6.8-2.5-4.3 2-1.9v-2.4l-2-1.9 2.5-4.3 2.6.8 2.1-1.2L9.5 3Z",
      transform: "translate(1 0) scale(.9)"
    }), svgElement(document, "circle", { cx: 12, cy: 12, r: 3 }));
    contentMenu(settings, icon);
  }

  function sync() {
    if (destroyed) return;
    const theme = shell.document.documentElement.dataset.theme || "dark";
    const fontSize = shell.document.documentElement.dataset.fontSize || "largest";
    if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
    if (document.documentElement.dataset.fontSize !== fontSize) document.documentElement.dataset.fontSize = fontSize;
    [[themeButtons, theme], [sizeButtons, fontSize], [layoutButtons, layout]].forEach(([buttons, value]) => {
      buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.value === value)));
    });
    if (course?.capabilities?.speech === true) {
      const muted = Boolean(api.getSpeechMuted());
      document.documentElement.dataset.speechMuted = String(muted);
      if (speechMuted !== muted) {
        speechMuted = muted;
        audioToggle.replaceChildren(createSpeechIcon(document, { muted }));
      }
    }
    if (speed) {
      speed.disabled = false;
      const pace = api.resolveSpeechPace();
      speed.value = String(Math.max(0, PACE_KEYS.indexOf(pace.key)));
      speed.setAttribute("aria-valuetext", t("speech.pace.valuetext", { pace: pace.label, rate: pace.rate }));
    }
    if (autoplayToggle) {
      autoplayToggle.setAttribute("aria-checked", String(api.getSpeechAutoplay()));
      autoplayToggle.disabled = speechMuted;
    }
  }

  listen(document, "click", (event) => { if (!root.contains(event.target)) close(); });
  listen(document.defaultView, "resize", constrainOpenPopovers);
  listen(document.defaultView, "scroll", constrainOpenPopovers);
  listen(document.defaultView.visualViewport, "resize", constrainOpenPopovers);
  listen(document.defaultView.visualViewport, "scroll", constrainOpenPopovers);
  if (shell.document !== document) listen(shell.document, "click", () => close());
  listen(document, "keydown", (event) => {
    if (event.key !== "Escape" || !panels.some(({ panel }) => !panel.hidden)) return;
    event.preventDefault();
    close({ restoreFocus: true });
  });
  ["caatuu:speech-mute-change", "caatuu:speech-pace-change", "caatuu:speech-autoplay-change", "caatuu:learning-change"].forEach((name) => listen(shell, name, sync));
  const Observer = shell.MutationObserver;
  if (Observer) {
    const observer = new Observer(sync);
    observer.observe(shell.document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-font-size"] });
    disposers.push(() => observer.disconnect());
  }
  sync();
  return Object.freeze({
    sync,
    close,
    isOpen,
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      disposers.forEach((dispose) => dispose());
      root.remove();
    }
  });
}
