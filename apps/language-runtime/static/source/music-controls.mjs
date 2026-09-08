import { MUSIC_TRACKS } from "./background-music.mjs";

const COPY = Object.freeze({
  "music.volume": "Music volume",
  "speech.volume": "Voice volume",
  "music.settings": "Music",
  "music.song": "Song",
  "music.summary": "Plays while Caatuu is in focus.",
  "music.credits": "Music credits",
  "music.off": "Off",
  "music.pending": "Music will be available after setup.",
  "music.muted": "All audio is muted.",
  "music.blocked": "Tap to play music.",
  "music.play": "Play music",
  "music.unavailable": "Music could not play. Try again."
});
const mounted = new WeakMap();
let sequence = 0;

/** One accessible control design for shell menus, embedded games and Settings. */
export function mountMusicControls({ container, player, i18n, songSelection = false } = {}) {
  return mountVolumeControls({ container, player, i18n, songSelection });
}

export function mountVoiceControls({ container, api, host, i18n } = {}) {
  if (!api?.getSpeechVolume || !api?.setSpeechVolume || !host?.addEventListener) return null;
  const player = {
    getState: () => ({ volume: api.getSpeechVolume(), ready: true }),
    setVolume: (volume) => api.setSpeechVolume(volume),
    subscribe(listener) {
      host.addEventListener("caatuu:speech-volume-change", listener);
      return () => host.removeEventListener("caatuu:speech-volume-change", listener);
    }
  };
  return mountVolumeControls({ container, player, i18n, voice: true });
}

function mountVolumeControls({ container, player, i18n, songSelection = false, voice = false } = {}) {
  if (!container?.ownerDocument || !player?.subscribe || !player?.getState) return null;
  mounted.get(container)?.destroy();
  const document = container.ownerDocument;
  const id = `caatuu-${voice ? "voice" : "music"}-volume-${++sequence}`;
  const t = (key) => {
    try {
      const value = i18n?.t?.(key);
      if (typeof value === "string" && value && value !== key) return value;
    } catch { /* The launcher can render before its locale catalog arrives. */ }
    return COPY[key] || key;
  };
  const node = (tag, className = "", text = "") => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  };
  const root = node("div", "caatuu-music-controls");
  root.classList.toggle("caatuu-voice-controls", voice);
  const heading = node("div", "caatuu-music-volume-heading");
  const label = node("label", "", t(voice ? "speech.volume" : "music.volume"));
  label.setAttribute("for", id);
  const value = node("output", "caatuu-music-value");
  value.setAttribute("for", id);
  value.setAttribute("aria-hidden", "true");
  const percentText = node("span", "caatuu-music-percent");
  const silent = node("span", "caatuu-music-silent");
  const speaker = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  speaker.setAttribute("viewBox", "0 0 24 24");
  speaker.setAttribute("aria-hidden", "true");
  speaker.setAttribute("focusable", "false");
  for (const d of [
    "M4.5 9.25v5.5h3.25l4.75 3.75v-13L7.75 9.25H4.5Z",
    "M15.5 9.25c1.5 1.5 1.5 4 0 5.5",
    "M18.25 6.75c3 3 3 7.5 0 10.5",
    "M3 3 21 21"
  ]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    speaker.append(path);
  }
  silent.append(speaker);
  value.append(percentText, silent);
  heading.append(label, value);
  const meter = node("div", "caatuu-music-meter");
  const bars = node("span", "caatuu-music-bars");
  bars.setAttribute("aria-hidden", "true");
  const segments = Array.from({ length: 10 }, () => node("span", "caatuu-music-bar"));
  bars.append(...segments);
  const slider = node("input", "caatuu-music-slider");
  slider.id = id;
  for (const [name, content] of Object.entries({ type: "range", min: "0", max: "100", step: "1", "aria-label": label.textContent })) {
    slider.setAttribute(name, content);
  }
  meter.append(bars, slider);
  root.append(heading, meter);
  let select;
  if (songSelection) {
    const songLabel = node("label", "caatuu-music-song", t("music.song"));
    select = node("select");
    select.setAttribute("aria-label", t("music.song"));
    for (const track of MUSIC_TRACKS) {
      const option = node("option", "", track.title);
      option.value = track.id;
      select.append(option);
    }
    songLabel.append(select);
    root.append(songLabel);
  }
  const status = node("p", "caatuu-music-status");
  status.setAttribute("role", "status");
  const warning = node("span", "caatuu-music-warning", "⚠\uFE0E");
  warning.setAttribute("aria-hidden", "true");
  const statusText = node("span", "caatuu-music-status-text");
  status.append(warning, statusText);
  const play = node("button", "caatuu-music-play", t("music.play"));
  play.setAttribute("type", "button");
  if (!voice) root.append(status, play);
  container.append(root);
  const onInput = () => player.setVolume(Number(slider.value) / 100);
  const onTrack = () => player.setTrack(select.value);
  const onPlay = () => player.setVolume(player.getState().volume || 0.1);
  slider.addEventListener("input", onInput);
  select?.addEventListener("change", onTrack);
  play.addEventListener("click", onPlay);
  const sync = () => {
    const state = player.getState();
    const percent = Math.round(state.volume * 100);
    slider.value = String(percent);
    slider.setAttribute("aria-valuetext", percent === 0 ? t("music.off") : `${percent}%`);
    percentText.textContent = `${percent}%`;
    percentText.hidden = percent === 0;
    silent.hidden = percent !== 0;
    value.title = percent === 0 ? t("music.off") : `${percent}%`;
    segments.forEach((segment, index) => segment.classList.toggle("is-filled", percent > index * 10));
    if (select) select.value = state.trackId;
    const message = !state.ready ? t("music.pending") : state.masterMuted ? t("music.muted") : percent === 0 ? ""
      : state.error ? t("music.unavailable") : state.blocked ? t("music.blocked") : "";
    const muted = state.ready && state.masterMuted === true;
    statusText.textContent = message;
    warning.hidden = !muted;
    status.classList.toggle("is-warning", muted);
    status.hidden = !message;
    play.hidden = !state.ready || state.masterMuted === true || percent === 0 || !(state.error || state.blocked);
  };
  const unsubscribe = player.subscribe(sync);
  sync();
  const control = Object.freeze({
    sync,
    destroy() {
      unsubscribe?.();
      slider.removeEventListener("input", onInput);
      select?.removeEventListener("change", onTrack);
      play.removeEventListener("click", onPlay);
      root.remove();
      if (mounted.get(container) === control) mounted.delete(container);
    }
  });
  mounted.set(container, control);
  return control;
}

/** Attribution belongs with the other licenses, outside playback controls. */
export function mountMusicCredits({ container, i18n } = {}) {
  if (!container?.ownerDocument) return;
  const document = container.ownerDocument;
  const heading = document.createElement("h4");
  heading.textContent = i18n?.t?.("music.credits") || COPY["music.credits"];
  const list = document.createElement("dl");
  list.className = "meta-list model-license-list";
  for (const track of MUSIC_TRACKS) {
    const row = document.createElement("div");
    const title = document.createElement("dt");
    const source = document.createElement("a");
    source.textContent = track.title;
    source.href = track.sourceUrl;
    title.append(source);
    const description = document.createElement("dd");
    const author = document.createElement("span");
    author.textContent = `${track.author} · `;
    const license = document.createElement("a");
    license.textContent = track.id === "town-theme-rpg" ? "CC0 1.0" : "CC BY 3.0";
    license.href = track.licenseUrl;
    for (const link of [source, license]) { link.target = "_blank"; link.rel = "noopener noreferrer"; }
    description.append(author, license);
    row.append(title, description);
    list.append(row);
  }
  container.replaceChildren(heading, list);
}
