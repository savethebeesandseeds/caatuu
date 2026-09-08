import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserHarness } from "./helpers/fake-browser.mjs";
import { englishInterfaceContent } from "./helpers/english-interface-content.mjs";
import { MUSIC_TRACKS } from "../static/source/background-music.mjs";
import { mountMusicControls, mountMusicCredits, mountVoiceControls } from "../static/source/music-controls.mjs";

function fixture() {
  const browser = createBrowserHarness();
  const listeners = new Set();
  let state = { trackId: "woodland-fantasy", volume: 0.1, ready: true, playing: true };
  const change = (update) => { state = { ...state, ...update }; listeners.forEach((listener) => listener()); };
  const player = { getState: () => state, setVolume: (volume) => change({ volume }), setTrack: (trackId) => change({ trackId }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
  const mount = (options = {}) => {
    const container = browser.document.createElement("div");
    browser.document.body.append(container);
    const control = mountMusicControls({ container, player, i18n: englishInterfaceContent, ...options });
    return { container, control, slider: container.querySelector('input[type="range"]') };
  };
  return { ...browser, player, mount, change, listeners };
}

test("music meters share volume without reading or writing any speech preference", () => {
  const setup = fixture();
  const first = setup.mount();
  const second = setup.mount({ songSelection: true });
  assert.equal(first.slider.value, "10");
  first.slider.value = "37";
  first.slider.dispatchEvent({ type: "input" });
  assert.equal(setup.player.getState().volume, 0.37);
  assert.equal(second.slider.value, "37");
  assert.equal(second.slider.getAttribute("aria-valuetext"), "37%");
  assert.equal(second.container.querySelector(".caatuu-music-percent").hidden, false);
  assert.equal(second.container.querySelector(".caatuu-music-silent").hidden, true);
  assert.equal(second.container.querySelectorAll(".is-filled").length, 4);
  second.slider.value = "0";
  second.slider.dispatchEvent({ type: "input" });
  assert.equal(first.slider.value, "0");
  assert.equal(first.slider.getAttribute("aria-valuetext"), "Off");
  assert.equal(first.container.querySelector(".caatuu-music-percent").hidden, true);
  assert.equal(first.container.querySelector(".caatuu-music-silent").hidden, false);
  assert.equal(first.container.querySelectorAll(".is-filled").length, 0);
});

test("Settings song picker controls the selected track and preserves the volume", () => {
  const setup = fixture();
  const menu = setup.mount();
  const settings = setup.mount({ songSelection: true });
  assert.equal(menu.container.querySelector("select"), null);
  const picker = settings.container.querySelector("select");
  assert.deepEqual(picker.querySelectorAll("option").map((option) => option.value), MUSIC_TRACKS.map((track) => track.id));
  assert.equal(picker.value, "woodland-fantasy");
  picker.value = "salt-marsh-birds";
  picker.dispatchEvent({ type: "change" });
  assert.equal(setup.player.getState().trackId, "salt-marsh-birds");
  assert.equal(setup.player.getState().volume, 0.1);
  const another = setup.mount({ songSelection: true });
  assert.equal(another.container.querySelector("select").value, "salt-marsh-birds");
  assert.equal(settings.container.querySelectorAll("a").length, 0);
});

test("voice bars synchronize independently, show silence at zero, and release their listeners", () => {
  const setup = fixture();
  const music = setup.mount();
  let volume = 1;
  const api = {
    getSpeechVolume: () => volume,
    setSpeechVolume(value) {
      volume = value;
      setup.window.dispatchEvent({ type: "caatuu:speech-volume-change" });
    }
  };
  const mount = () => {
    const container = setup.document.createElement("div");
    setup.document.body.append(container);
    const control = mountVoiceControls({ container, api, host: setup.window, i18n: englishInterfaceContent });
    return { container, control, slider: container.querySelector("input") };
  };
  const home = mount();
  const settings = mount();
  assert.equal(home.slider.value, "100");
  assert.equal(home.slider.getAttribute("aria-label"), englishInterfaceContent.t("speech.volume"));
  home.slider.value = "35";
  home.slider.dispatchEvent({ type: "input" });
  assert.equal(settings.slider.value, "35");
  settings.slider.value = "0";
  settings.slider.dispatchEvent({ type: "input" });
  assert.equal(home.slider.getAttribute("aria-valuetext"), "Off");
  assert.equal(home.container.querySelector(".caatuu-music-silent").hidden, false);
  assert.equal(music.slider.value, "10");
  assert.equal(home.container.querySelector("select"), null);
  home.control.destroy();
  api.setSpeechVolume(0.8);
  assert.equal(home.slider.value, "0", "a removed control stops receiving updates");
  assert.equal(settings.slider.value, "80");
});

test("the Legal host renders complete music attribution separately from playback controls", () => {
  const setup = fixture();
  const container = setup.document.createElement("div");
  mountMusicCredits({ container, i18n: englishInterfaceContent });
  const links = container.querySelectorAll("a");
  assert.equal(links.length, MUSIC_TRACKS.length * 2);
  assert.ok(links.every((link) => /^https?:\/\//u.test(link.href)));
  for (const track of MUSIC_TRACKS) assert.ok(container.textContent.includes(track.author));
  mountMusicCredits({ container, i18n: englishInterfaceContent });
  assert.equal(container.querySelectorAll("a").length, MUSIC_TRACKS.length * 2);
});

test("download readiness and autoplay rejection show actionable status without disabling the saved controls", () => {
  const setup = fixture();
  setup.change({ ready: false });
  const { container, slider } = setup.mount();
  assert.equal(container.querySelector('.caatuu-music-status-text').textContent, englishInterfaceContent.t("music.pending"));
  assert.equal(container.querySelector("button").hidden, true);
  assert.notEqual(slider.disabled, true);
  setup.change({ ready: true, blocked: true });
  assert.equal(container.querySelector("button").hidden, false);
  setup.change({ blocked: false });
  assert.equal(container.querySelector('[role="status"]').hidden, true);
  assert.equal(container.querySelector("button").hidden, true);
});

test("global mute explains silence while keeping the independent music preference editable", () => {
  const setup = fixture();
  setup.change({ masterMuted: true });
  const { container, slider } = setup.mount();
  assert.equal(container.querySelector('.caatuu-music-status-text').textContent, englishInterfaceContent.t("music.muted"));
  assert.equal(container.querySelector('[role="status"]').classList.contains("is-warning"), true);
  assert.equal(container.querySelector('.caatuu-music-warning').hidden, false);
  slider.value = "20";
  slider.dispatchEvent({ type: "input" });
  assert.equal(setup.player.getState().volume, 0.2);
  assert.equal(setup.player.getState().masterMuted, true);
  setup.change({ masterMuted: false });
  assert.equal(container.querySelector('[role="status"]').classList.contains("is-warning"), false);
  assert.equal(container.querySelector('.caatuu-music-warning').hidden, true);
});

test("remount and teardown release subscriptions and do not duplicate controls", () => {
  const setup = fixture();
  const { container } = setup.mount();
  assert.equal(setup.listeners.size, 1);
  const control = mountMusicControls({ container, player: setup.player, i18n: englishInterfaceContent });
  assert.equal(setup.listeners.size, 1);
  assert.equal(container.querySelectorAll(".caatuu-music-controls").length, 1);
  control.destroy();
  assert.equal(setup.listeners.size, 0);
  assert.equal(container.querySelectorAll(".caatuu-music-controls").length, 0);
});

test("slider and picker use translated labels and render copy as plain text", () => {
  const setup = fixture();
  const copy = { "music.volume": "Volumen <música>", "music.song": "Canción" };
  const { container, slider } = setup.mount({ songSelection: true, i18n: { t: (key) => copy[key] || key } });
  assert.equal(slider.getAttribute("aria-label"), "Volumen <música>");
  assert.equal(container.querySelector("select").getAttribute("aria-label"), "Canción");
  assert.equal(container.querySelector("label").textContent, "Volumen <música>");
  assert.equal(slider.getAttribute("min"), "0");
  assert.equal(slider.getAttribute("max"), "100");
  assert.equal(slider.getAttribute("step"), "1");
});
