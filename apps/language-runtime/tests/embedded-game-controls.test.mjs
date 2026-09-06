import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { englishInterfaceContent } from "./helpers/english-interface-content.mjs";
import { createInterfaceContent } from "../static/source/interface-content.mjs";
import { createSpeechIcon, mountEmbeddedGameControls } from "../static/source/games/embedded-game-controls.mjs";

const course = { targetLanguage: { id: "cs", locale: "cs", label: "Czech" }, capabilities: { speech: true } };

function fixture({ speech = true, layout = true, settings = false, settingsIcon, illustrations = false,
  illustrationsPressed = true, challenge = false, autoplay = false, onOpenChange, i18n = englishInterfaceContent } = {}) {
  const parent = createBrowserHarness();
  const frame = createBrowserHarness();
  const shell = parent.window;
  const preferences = { muted: false, autoplay: true, pace: "slower", voice: "", stops: 0, layouts: [] };
  shell.CaatuuI18n = i18n;
  shell.document.documentElement.dataset.theme = "light";
  shell.document.documentElement.dataset.fontSize = "largest";
  let observerCallback;
  let disconnected = false;
  shell.MutationObserver = class {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  shell.CaatuuChrome = {
    applyTheme(value) { shell.document.documentElement.dataset.theme = value; observerCallback?.(); },
    applyFontSize(value) { shell.document.documentElement.dataset.fontSize = value; observerCallback?.(); },
    getSpeechMuted: () => preferences.muted,
    getSpeechAutoplay: () => preferences.autoplay,
    setSpeechAutoplay(value) { preferences.autoplay = value; shell.dispatchEvent({ type: "caatuu:speech-autoplay-change" }); },
    setSpeechMuted(value) { preferences.muted = value; },
    resolveSpeechPace: () => ({ key: preferences.pace, label: preferences.pace, rate: 0.5 }),
    setSpeechPacePreference(value) { preferences.pace = value; },
    getSpeechVoicePreference: () => preferences.voice,
    setSpeechVoicePreference(value) { preferences.voice = value; },
    stopSpeech() { preferences.stops += 1; },
    async getSpeechVoiceControlState() {
      return { available: true, backend: "browser", voices: [{ name: 'A <voice> & "one"', value: "browser:cs", locale: "cs" }] };
    },
    describeSpeechVoiceState: () => "Voice ready"
  };
  const container = frame.document.createElement("div");
  frame.document.body.append(container);
  const settingsContent = frame.document.createElement("fieldset");
  const settingsInput = frame.document.createElement("input");
  settingsInput.type = "checkbox";
  settingsInput.setAttribute("aria-label", "Untimed");
  settingsContent.append(settingsInput);
  settingsContent.hidden = true;
  frame.document.body.append(settingsContent);
  const illustrationChanges = [];
  const challengeContent = frame.document.createElement("fieldset");
  const challengeInput = frame.document.createElement("select");
  challengeInput.setAttribute("aria-label", "Fall duration");
  for (const seconds of [10, 15, 20]) {
    const option = frame.document.createElement("option");
    option.value = String(seconds);
    option.textContent = `${seconds}s`;
    challengeInput.append(option);
  }
  challengeContent.append(challengeInput);
  challengeContent.hidden = true;
  frame.document.body.append(challengeContent);
  const controller = mountEmbeddedGameControls({ container, shell, course: { ...course, capabilities: { speech } }, onOpenChange, autoplay,
    ...(settings ? { settings: { content: settingsContent, labelKey: "common.game.controls", icon: settingsIcon } } : {}),
    ...(illustrations ? { illustrations: { labelKey: "common.display", pressed: illustrationsPressed,
      onChange: (value) => illustrationChanges.push(value) } } : {}),
    ...(challenge ? { challenge: { content: challengeContent, labelKey: "wordworld.challenge.type" } } : {}),
    ...(layout ? { onLayoutChange: (value) => preferences.layouts.push(value) } : {}) });
  return { shell, frame, container, controller, preferences, settingsContent, settingsInput,
    illustrationChanges, challengeContent, challengeInput, disconnected: () => disconnected };
}

test("the boxes settings icon opens the same accessible game settings menu", () => {
  const { container, settingsContent, settingsInput, frame, controller } = fixture({ settings: true, settingsIcon: "boxes", layout: false });
  const toggle = container.querySelectorAll(".caatuu-game-control-toggle").at(-1);
  assert.equal(toggle.querySelectorAll("rect").length, 6);
  assert.equal(toggle.querySelectorAll("circle").length, 0);
  assert.equal(toggle.getAttribute("aria-label"), englishInterfaceContent.t("common.game.controls"));
  toggle.click();
  assert.equal(settingsContent.parentElement.hidden, false);
  assert.equal(settingsContent.parentElement.getAttribute("role"), "dialog");
  assert.equal(frame.document.activeElement, settingsInput);
  controller.destroy();
});

test("controls share shell appearance and speech preferences without their own storage", async () => {
  const setup = fixture();
  const { container, frame, shell, preferences } = setup;
  container.querySelector('[data-value="dark"]').click();
  container.querySelector('[data-value="large"]').click();
  assert.equal(shell.document.documentElement.dataset.theme, "dark");
  assert.equal(frame.document.documentElement.dataset.theme, "dark");
  assert.equal(frame.document.documentElement.dataset.fontSize, "large");
  container.querySelector('[data-value="stacked"]').click();
  assert.deepEqual(preferences.layouts, ["stacked"]);
  container.querySelector('[role="switch"]').click();
  assert.equal(preferences.muted, true);
  assert.equal(container.querySelector('[role="switch"]').getAttribute("aria-checked"), "true");
  container.querySelector('[role="switch"]').click();
  const speed = container.querySelector("input");
  speed.value = "2";
  speed.dispatchEvent({ type: "input" });
  assert.equal(preferences.pace, "normal");
  assert.equal(preferences.stops, 1);
  preferences.muted = false;
  shell.dispatchEvent({ type: "caatuu:speech-mute-change" });
  assert.equal(container.querySelector('[role="switch"]').getAttribute("aria-checked"), "false");
  assert.deepEqual(frame.localStorage.snapshot(), {});
});

test("global mute hides dependent audio settings and slashes the settings icon without changing preferences", async () => {
  const { container, shell, frame, preferences } = fixture({ layout: false });
  const toggle = container.querySelector('[aria-label="Audio settings"]');
  const mute = container.querySelector('[role="switch"]');
  const options = container.querySelector(".caatuu-game-audio-options");
  toggle.click();
  await Promise.resolve();
  assert.equal(options.hidden, false);
  mute.click();
  assert.equal(options.hidden, true);
  assert.equal(mute.hidden, false);
  assert.equal(frame.document.documentElement.dataset.speechMuted, "true");
  assert.equal(toggle.querySelector("svg").getAttribute("data-speech-icon"), "muted");
  assert.equal(toggle.querySelector(".caatuu-game-sound-slash").getAttribute("d"), "M3 3 21 21");
  const speed = options.querySelector("input");
  assert.equal(speed.disabled, true);
  speed.value = "2";
  speed.dispatchEvent({ type: "input" });
  const voice = options.querySelector("select");
  voice.value = "browser:cs";
  voice.dispatchEvent({ type: "change" });
  assert.equal(preferences.pace, "slower");
  assert.equal(preferences.voice, "");
  preferences.muted = false;
  shell.dispatchEvent({ type: "caatuu:speech-mute-change" });
  await Promise.resolve();
  assert.equal(options.hidden, false);
  assert.equal(speed.disabled, false);
  assert.equal(voice.disabled, false);
  assert.equal(toggle.querySelector("svg").getAttribute("data-speech-icon"), "play");
  assert.equal(toggle.querySelector(".caatuu-game-sound-slash"), null);
  assert.equal(frame.document.documentElement.dataset.speechMuted, "false");
});

test("optional autoplay uses the shared setting and disappears with the other options when muted", () => {
  const { container, shell, preferences } = fixture({ autoplay: true });
  const options = container.querySelector(".caatuu-game-audio-options");
  const autoplay = options.querySelector('[role="switch"]');
  assert.equal(autoplay.textContent, "Autoplay audio");
  assert.equal(autoplay.getAttribute("aria-checked"), "true");
  autoplay.click();
  assert.equal(preferences.autoplay, false);
  shell.CaatuuChrome.setSpeechAutoplay(true);
  assert.equal(autoplay.getAttribute("aria-checked"), "true");
  container.querySelector('[role="switch"]').click();
  assert.equal(options.hidden, true);
  assert.equal(autoplay.disabled, true);
  autoplay.click();
  assert.equal(preferences.autoplay, true);
});

test("muting invalidates pending voice discovery and never reopens its hidden settings", async () => {
  const { container, shell } = fixture({ layout: false });
  let finish;
  shell.CaatuuChrome.getSpeechVoiceControlState = () => new Promise((resolve) => { finish = resolve; });
  container.querySelector('[aria-label="Audio settings"]').click();
  container.querySelector('[role="switch"]').click();
  finish({ available: true, voices: [{ name: "Late voice", value: "late" }] });
  await Promise.resolve();
  assert.equal(container.querySelector(".caatuu-game-audio-options").hidden, true);
  assert.equal(container.querySelector("select").children.length, 0);
});

test("text-size choices show scaled Aa previews above their existing accessible labels", async () => {
  const { container, shell } = fixture();
  const referenceCss = await readFile(new URL("../static/styles/caatuu-word-world.css", import.meta.url), "utf8");
  const controlsCss = await readFile(new URL("../static/styles/games/embedded-game-controls.css", import.meta.url), "utf8");
  const sizes = container.querySelector(".caatuu-game-size-options");
  for (const [value, label] of [["largest", "standard"], ["large", "small"], ["standard", "smaller"]]) {
    const option = sizes.querySelector(`[data-value="${value}"]`);
    const sample = option.querySelector(`.caatuu-game-size-sample.is-${label}`);
    assert.equal(sample.textContent, "Aa");
    assert.equal(sample.getAttribute("aria-hidden"), "true");
    assert.equal(option.children[1].textContent, englishInterfaceContent.t(`common.${label}`));
    const referenceSize = referenceCss.match(new RegExp(`\\.word-net-display-size-sample\\.is-${label}\\s*\\{[^}]*font-size:\\s*([^;]+);`))[1];
    const sharedSize = controlsCss.match(new RegExp(`\\.caatuu-game-size-sample\\.is-${label}\\s*\\{[^}]*font-size:\\s*([^;]+);`))[1];
    assert.equal(sharedSize, referenceSize, "reuse Word World's existing preview scale");
    option.click();
    assert.equal(shell.document.documentElement.dataset.fontSize, value);
    assert.equal(option.getAttribute("aria-pressed"), "true");
    assert.equal(sizes.querySelectorAll('[aria-pressed="true"]').length, 1);
  }
  assert.match(controlsCss, /\.caatuu-game-size-options \.caatuu-game-control-option\s*\{[^}]*flex-direction:\s*column;/);
});

test("menus are exclusive, keyboard dismissible, and removed with their listeners", () => {
  const { container, frame, shell, controller, disconnected } = fixture();
  const toggles = container.querySelectorAll(".caatuu-game-control-toggle");
  toggles[0].click();
  assert.equal(toggles[0].getAttribute("aria-expanded"), "true");
  toggles[1].click();
  assert.equal(toggles[0].getAttribute("aria-expanded"), "false");
  assert.equal(toggles[1].getAttribute("aria-expanded"), "true");
  frame.document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(toggles[1].getAttribute("aria-expanded"), "false");
  assert.equal(frame.document.activeElement, toggles[1]);
  toggles[0].click();
  shell.document.dispatchEvent({ type: "click" });
  assert.equal(toggles[0].getAttribute("aria-expanded"), "false");
  controller.destroy();
  assert.equal(container.children.length, 0);
  assert.equal(disconnected(), true);
  controller.destroy();
});

test("optional game settings follow audio and reuse exclusive menus without transient close callbacks", () => {
  const transitions = [];
  const { container, frame, controller, settingsContent, settingsInput } = fixture({
    layout: false, settings: true, onOpenChange: (open) => transitions.push(open)
  });
  const toggles = container.querySelectorAll(".caatuu-game-control-toggle");
  assert.deepEqual(toggles.map((toggle) => toggle.getAttribute("aria-label")), [
    englishInterfaceContent.t("common.display.settings"),
    englishInterfaceContent.t("common.audio.settings"),
    englishInterfaceContent.t("common.game.controls")
  ]);
  assert.equal(settingsContent.hidden, false);
  assert.equal(settingsContent.parentElement.getAttribute("role"), "dialog");
  assert.equal(settingsContent.parentElement.hidden, true);
  assert.equal(toggles[2].querySelector("svg").getAttribute("aria-hidden"), "true");
  assert.equal(controller.isOpen(), false);
  assert.deepEqual(transitions, [], "mounting must not signal an initial close");

  toggles[2].click();
  assert.equal(controller.isOpen(), true);
  assert.equal(settingsContent.parentElement.hidden, false);
  assert.equal(frame.document.activeElement, settingsInput);
  assert.deepEqual(transitions, [true]);
  settingsInput.click();
  assert.deepEqual(transitions, [true], "interacting inside settings keeps the menu open");
  toggles[1].click();
  assert.equal(settingsContent.parentElement.hidden, true);
  assert.equal(toggles[1].getAttribute("aria-expanded"), "true");
  assert.deepEqual(transitions, [true], "switching menus must not rearm a game clock");

  const escape = { type: "keydown", key: "Escape" };
  frame.document.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(controller.isOpen(), false);
  assert.equal(frame.document.activeElement, toggles[1]);
  assert.deepEqual(transitions, [true, false]);
  controller.close();
  assert.deepEqual(transitions, [true, false], "already closed menus are silent");
});

test("settings close on their toggle, outside clicks, Escape, and destruction", () => {
  const transitions = [];
  const { container, frame, shell, controller } = fixture({
    layout: false, settings: true, onOpenChange: (open) => transitions.push(open)
  });
  const toggle = container.querySelectorAll(".caatuu-game-control-toggle")[2];
  const dismissals = [
    () => toggle.click(),
    () => frame.document.body.click(),
    () => shell.document.dispatchEvent({ type: "click" }),
    () => frame.document.dispatchEvent({ type: "keydown", key: "Escape" }),
    () => controller.destroy()
  ];
  for (const dismiss of dismissals) {
    toggle.click();
    assert.equal(controller.isOpen(), true);
    dismiss();
    assert.equal(controller.isOpen(), false);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
  }
  assert.deepEqual(transitions, dismissals.flatMap(() => [true, false]));
  assert.equal(container.children.length, 0);
  controller.destroy();
  toggle.click();
  assert.equal(controller.isOpen(), false);
  assert.equal(transitions.length, 10, "destroy removes toggle handlers and is idempotent");
});

test("existing layout-enabled games retain their display, layout, audio control order", () => {
  const { container, controller, settingsContent } = fixture();
  assert.deepEqual(container.querySelectorAll(".caatuu-game-control-toggle").map((toggle) => toggle.getAttribute("aria-label")), [
    englishInterfaceContent.t("common.display.settings"),
    englishInterfaceContent.t("common.layout.settings"),
    englishInterfaceContent.t("common.audio.settings")
  ]);
  assert.equal(settingsContent.hidden, true);
  assert.equal(container.contains(settingsContent), false);
  assert.equal(controller.isOpen(), false);
});

test("feather directly toggles illustrations while Aa remains a menu without gameplay or preference side effects", () => {
  const transitions = [];
  const { container, frame, controller, preferences, illustrationChanges,
    challengeContent, challengeInput } = fixture({
    layout: false, illustrations: true, challenge: true,
    onOpenChange: (open) => transitions.push(open)
  });
  const toggles = container.querySelectorAll(".caatuu-game-control-toggle");
  assert.deepEqual(toggles.map((toggle) => toggle.getAttribute("aria-label")), [
    englishInterfaceContent.t("common.display.settings"),
    englishInterfaceContent.t("common.audio.settings"),
    englishInterfaceContent.t("common.display"),
    englishInterfaceContent.t("wordworld.challenge.type")
  ]);
  const illustrationIcon = toggles[2].querySelector(".caatuu-game-illustration-icon");
  assert.equal(illustrationIcon.textContent, "🪶", "reuse Verb Nebula's picture-clue feather");
  assert.equal(illustrationIcon.getAttribute("aria-hidden"), "true");
  assert.equal(toggles[2].querySelector("svg"), null);
  const challengeIcon = toggles[3].querySelector(".caatuu-game-challenge-icon");
  assert.equal(challengeIcon.textContent, "Aa");
  assert.equal(challengeIcon.getAttribute("aria-hidden"), "true");
  assert.equal(toggles[2].getAttribute("aria-pressed"), "true");
  assert.equal(toggles[2].getAttribute("aria-haspopup"), null);
  assert.equal(toggles[2].getAttribute("aria-expanded"), null);
  assert.equal(container.querySelectorAll('[role="dialog"]').length, 3);
  assert.equal(challengeContent.parentElement.getAttribute("role"), "dialog");
  assert.equal(challengeContent.parentElement.hidden, true);

  toggles[2].click();
  assert.equal(toggles[2].getAttribute("aria-pressed"), "false");
  assert.deepEqual(illustrationChanges, [false]);
  assert.equal(controller.isOpen(), false);
  assert.deepEqual(transitions, [], "a direct toggle never announces a menu opening or touches a clock");
  toggles[2].click();
  assert.equal(toggles[2].getAttribute("aria-pressed"), "true");
  assert.deepEqual(illustrationChanges, [false, true]);
  toggles[3].click();
  assert.equal(challengeContent.parentElement.hidden, false);
  assert.equal(frame.document.activeElement, challengeInput);
  challengeInput.value = "20";
  challengeInput.dispatchEvent({ type: "change", bubbles: true });
  assert.equal(challengeInput.value, "20", "game-owned values are not rewritten by the menu wrapper");
  assert.deepEqual(transitions, [true]);
  assert.equal(preferences.stops, 0, "new menus never stop audio or control a game clock");
  assert.deepEqual(frame.localStorage.snapshot(), {});
  frame.document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(frame.document.activeElement, toggles[3]);
  assert.equal(controller.isOpen(), false);
  assert.deepEqual(transitions, [true, false]);
  toggles[1].click();
  assert.equal(controller.isOpen(), true);
  toggles[2].click();
  assert.equal(controller.isOpen(), false, "direct toggle dismisses any old popover");
  assert.equal(toggles[1].getAttribute("aria-expanded"), "false");
  assert.equal(toggles[2].getAttribute("aria-pressed"), "false");
  assert.deepEqual(illustrationChanges, [false, true, false], "each click changes illustrations once");
  assert.deepEqual(transitions, [true, false, true, false]);
  controller.destroy();
  toggles[3].click();
  toggles[2].click();
  assert.deepEqual(illustrationChanges, [false, true, false], "destroy removes the direct-toggle listener");
  assert.equal(controller.isOpen(), false);
  assert.equal(container.children.length, 0);
});

test("optional content menus validate their local authority before mounting or moving any DOM", () => {
  const { container, shell, frame, settingsContent, challengeContent } = fixture();
  const count = container.children.length;
  const foreign = createBrowserHarness().document.createElement("div");
  for (const name of ["settings", "challenge"]) {
    for (const menu of [{ content: settingsContent }, { content: foreign, labelKey: "common.display" }]) {
      assert.throws(() => mountEmbeddedGameControls({ container, shell, course, [name]: menu }),
        /local DOM content and an interface label key/);
    }
  }
  assert.throws(() => mountEmbeddedGameControls({ container, shell, course,
    settings: { content: settingsContent, labelKey: "common.display" },
    challenge: { content: settingsContent, labelKey: "wordworld.challenge.type" }
  }), /different local DOM content/);
  assert.equal(container.children.length, count);
  assert.equal(settingsContent.parentElement, frame.document.body);
  assert.equal(challengeContent.parentElement, frame.document.body);
});

test("illustrations require an explicit initial state, label, and callback instead of menu content", () => {
  const { container, shell, settingsContent } = fixture();
  const count = container.children.length;
  const valid = { labelKey: "common.display", pressed: false, onChange() {} };
  for (const illustrations of [
    { ...valid, labelKey: "" }, { ...valid, pressed: undefined }, { ...valid, pressed: "false" },
    { ...valid, onChange: undefined }, { ...valid, content: settingsContent }
  ]) {
    assert.throws(() => mountEmbeddedGameControls({ container, shell, course, illustrations }),
      /boolean pressed state.*onChange callback, not menu content/);
  }
  assert.equal(container.children.length, count, "invalid configuration never mounts partial controls");
  const disabled = fixture({ illustrations: true, illustrationsPressed: false, layout: false });
  const toggle = disabled.container.querySelectorAll(".caatuu-game-control-toggle")[2];
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  toggle.click();
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.deepEqual(disabled.illustrationChanges, [true]);
});

test("game settings reject missing labels or foreign content before creating controls", () => {
  const { container, shell, settingsContent } = fixture();
  const count = container.children.length;
  const foreign = createBrowserHarness().document.createElement("div");
  for (const settings of [{ content: settingsContent }, { content: foreign, labelKey: "common.game.controls" }]) {
    assert.throws(() => mountEmbeddedGameControls({ container, shell, course, settings }), /local DOM content and an interface label key/);
  }
  assert.equal(container.children.length, count);
});

test("voice menu uses shell voice state and renders voice names as inert text", async () => {
  const { container, preferences } = fixture();
  container.querySelector('[aria-label="Audio settings"]').click();
  await Promise.resolve();
  const voice = container.querySelector("select");
  assert.equal(voice.children[1].textContent, 'A <voice> & "one" · cs');
  assert.equal(voice.querySelector("voice"), null);
  voice.value = "browser:cs";
  voice.dispatchEvent({ type: "change" });
  await Promise.resolve();
  assert.equal(preferences.voice, "browser:cs");
  assert.equal(preferences.stops, 1);
});

test("speech capability and a layout callback are required for their respective controls", () => {
  const { container } = fixture({ speech: false, layout: false });
  assert.equal(container.querySelectorAll(".caatuu-game-control-toggle").length, 1);
  assert.equal(container.querySelector("select"), null);
  assert.equal(container.querySelector('[data-value="stacked"]'), null);
});

test("base-locale copy is plain text and missing or foreign shells fail closed", async () => {
  const catalog = JSON.parse(await readFile(new URL("../static/data/interface/en.v1.json", import.meta.url), "utf8"));
  catalog.locale = "es";
  catalog.messages["common.game.controls"] = 'Controles <seguros> & "claros"';
  catalog.messages["common.display.settings"] = "Pantalla";
  const { container } = fixture({ i18n: createInterfaceContent(catalog) });
  assert.equal(container.querySelector('[role="group"]').getAttribute("aria-label"), 'Controles <seguros> & "claros"');
  assert.equal(container.querySelector("button").getAttribute("aria-label"), "Pantalla");
  assert.equal(container.querySelector("seguros"), null);
  assert.throws(() => mountEmbeddedGameControls({ container, shell: {} }), /shared shell/);
  const foreign = fixture();
  foreign.shell.location.origin = "https://foreign.invalid";
  assert.throws(() => mountEmbeddedGameControls({ container: foreign.container, shell: foreign.shell, course }), /same-origin/);
});

test("speech SVG exactly follows Word World's speaker and stop artwork", async () => {
  const { document } = createBrowserHarness();
  const sharedHtml = await readFile(new URL("../static/app/index.html", import.meta.url), "utf8");
  const play = createSpeechIcon(document);
  assert.equal(play.querySelectorAll("path").length, 3);
  play.querySelectorAll("path").forEach((path) => assert.ok(sharedHtml.includes(`d="${path.getAttribute("d")}"`)));
  assert.equal(play.getAttribute("aria-hidden"), "true");
  const stop = createSpeechIcon(document, { stop: true });
  assert.equal(stop.getAttribute("data-speech-icon"), "stop");
  assert.equal(stop.querySelector("rect").getAttribute("width"), "10");
});
