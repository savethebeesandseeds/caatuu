export const AUDIO_LAB_MESSAGES = Object.freeze({
  "developer.audio.intro": "Test device voices for {language}. Preview settings apply only to this tool.",
  "developer.audio.voice": "Voice",
  "developer.audio.automatic": "Automatic",
  "developer.audio.voiceoption": "{name} · {locale} · {service}",
  "developer.audio.local": "On device",
  "developer.audio.network": "Network voice",
  "developer.audio.text": "Text to speak",
  "developer.audio.placeholder": "Enter text in {language}.",
  "developer.audio.rate": "Speed",
  "developer.audio.pitch": "Pitch",
  "developer.audio.play": "Play",
  "developer.audio.stop": "Stop",
  "developer.audio.refresh": "Refresh voices",
  "developer.audio.install": "Install voice data",
  "developer.audio.checking": "Checking voices for {language}…",
  "developer.audio.ready": "Ready to test {language} audio.",
  "developer.audio.unavailable": "No voice is available for {language} on this device. Install a matching voice and refresh.",
  "developer.audio.unsupported": "Speech playback is unavailable on this device.",
  "developer.audio.muted": "Audio is muted in the app. Turn audio on to test a voice.",
  "developer.audio.required": "Enter text to speak.",
  "developer.audio.toolong": "Use at most 1,000 characters for a preview.",
  "developer.audio.starting": "Starting audio…",
  "developer.audio.playing": "Playing audio…",
  "developer.audio.finished": "Audio finished.",
  "developer.audio.stopped": "Audio stopped.",
  "developer.audio.failed": "Audio preview failed: {detail}",
  "developer.audio.installopened": "Voice settings opened. Return here and refresh after installing a voice."
});

function normalizedLocale(value) {
  return String(value || "").trim().replace(/_/gu, "-").toLowerCase();
}

function voiceRank(value, locale) {
  const voiceLocale = normalizedLocale(value);
  const requested = normalizedLocale(locale);
  if (!voiceLocale || !requested) return -1;
  if (voiceLocale === requested) return 0;
  return voiceLocale.split("-")[0] === requested.split("-")[0] ? 1 : -1;
}

function orderedVoices(voices, locale, native) {
  return (Array.isArray(voices) ? voices : []).map((voice) => ({
    id: String(native ? voice.id || voice.name || "" : voice.voiceURI || voice.name || ""),
    name: String(voice.name || voice.id || voice.voiceURI || ""),
    locale: String(native ? voice.locale || "" : voice.lang || ""),
    localService: native ? voice.localService === true : voice.localService !== false,
    original: voice
  })).filter((voice) => voice.id && voiceRank(voice.locale, locale) >= 0)
    .sort((left, right) => voiceRank(left.locale, locale) - voiceRank(right.locale, locale)
      || Number(right.localService) - Number(left.localService)
      || left.name.localeCompare(right.name, "en")
      || left.id.localeCompare(right.id, "en"));
}

function boundedNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0.5, Math.min(1.5, number)) : fallback;
}

// Diagnostics share the app's speech transport and mute state, but own neither
// the active course nor its saved voice and pace preferences.
export function createAudioLabSpeechService({ host = globalThis, locale }) {
  const selectedLocale = String(locale || "").trim().replace(/_/gu, "-");
  const native = host.CaatuuRuntime?.env === "android";
  const baseSpeech = host.CaatuuRuntime?.speech;
  const speech = native ? baseSpeech?.forLocale?.(selectedLocale) || baseSpeech : null;
  const synthesis = host.speechSynthesis;
  const Utterance = host.SpeechSynthesisUtterance;
  let request = 0;
  let active = null;
  let pending = false;
  let disposed = false;
  const muted = () => host.CaatuuChrome?.getSpeechMuted?.() === true;
  const stoppedResult = () => ({ outcome: "stopped", stopped: true });

  async function status() {
    if (native) {
      if (!speech?.status || !speech?.speak) return { available: false, supported: false, voices: [] };
      const result = await speech.status(selectedLocale, { voice: "" });
      const wrongLocale = result?.locale && voiceRank(result.locale, selectedLocale) < 0;
      return {
        ...result,
        supported: true,
        available: result?.available === true && !wrongLocale,
        canInstallVoice: typeof speech.installData === "function",
        voices: orderedVoices(result?.voices, selectedLocale, true)
      };
    }
    const supported = Boolean(synthesis?.speak && synthesis?.cancel && Utterance);
    const voices = supported ? orderedVoices(synthesis.getVoices?.() || [], selectedLocale, false) : [];
    return { supported, available: supported && voices.length > 0, voices, canInstallVoice: false };
  }

  async function stop() {
    request += 1;
    const ownRequest = pending;
    pending = false;
    if (active) return active.stop();
    if (native && ownRequest) return speech?.stop?.();
    return stoppedResult();
  }

  async function speak(text, options = {}) {
    const value = String(text || "").normalize("NFC").trim();
    if (!value || value.length > 1000) throw new Error("Speech previews require 1–1,000 characters.");
    if (disposed) return stoppedResult();
    await stop();
    const token = ++request;
    pending = true;
    try {
      if (muted()) return { outcome: "muted", muted: true };
      if (host.CaatuuChrome?.stopSpeech) await host.CaatuuChrome.stopSpeech();
      else if (native) await speech?.stop?.();
      else synthesis?.cancel?.();
      if (disposed || token !== request) return stoppedResult();
      if (muted()) return { outcome: "muted", muted: true };
      const rate = boundedNumber(options.rate, 0.9);
      const pitch = boundedNumber(options.pitch, 1);
      const voice = String(options.voice || "").trim().slice(0, 256);
      if (native) {
        if (!speech?.speak) throw new Error("Native speech is unavailable.");
        return await speech.speak(value, { locale: selectedLocale, voice, rate, pitch }, {
          onEvent(event) {
            if (!disposed && token === request && event?.kind === "speech" && event.phase === "started") {
              options.onStart?.();
            }
          }
        });
      }
      const current = await status();
      if (disposed || token !== request) return stoppedResult();
      if (!current.available) throw new Error("No matching device voice is available.");
      const selectedVoice = current.voices.find((candidate) => candidate.id === voice) || current.voices[0];
      const utterance = new Utterance(value);
      utterance.lang = selectedLocale;
      utterance.voice = selectedVoice.original;
      utterance.rate = rate;
      utterance.pitch = pitch;
      return await new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        const finish = (error, result = { outcome: "completed" }) => {
          if (settled) return;
          settled = true;
          host.clearTimeout(timer);
          utterance.onstart = null;
          utterance.onend = null;
          utterance.onerror = null;
          if (active === session) active = null;
          if (error) reject(error);
          else resolve(result);
        };
        const session = {
          stop() {
            finish(null, stoppedResult());
            synthesis.cancel();
            return stoppedResult();
          }
        };
        active = session;
        utterance.onstart = () => { if (!disposed && token === request) options.onStart?.(); };
        utterance.onend = () => finish(null);
        utterance.onerror = (event) => {
          if (["canceled", "interrupted"].includes(event?.error)) finish(null, stoppedResult());
          else finish(new Error(String(event?.error || "Speech playback failed.")));
        };
        timer = host.setTimeout(() => {
          finish(new Error("Speech playback timed out."));
          synthesis.cancel();
        }, 60_000);
        try { synthesis.speak(utterance); } catch (error) { finish(error); }
      });
    } finally {
      if (token === request) pending = false;
    }
  }

  return Object.freeze({
    status,
    speak,
    stop,
    installData: native && speech?.installData ? () => speech.installData() : null,
    dispose() { disposed = true; return stop(); }
  });
}

export async function mountAudioLab({ root, course, host = globalThis, t = host.CaatuuI18n?.t }) {
  if (!root || !course || typeof t !== "function") throw new Error("Audio Lab requires a root, course, and interface messages.");
  const document = root.ownerDocument || host.document;
  const target = course.targetLanguage || {};
  const locale = target.speechLocale || target.locale || target.id || "und";
  const language = host.CaatuuI18n?.languageName?.(target) || target.nativeLabel || target.label || locale;
  const service = createAudioLabSpeechService({ host, locale });
  let disposed = false;
  let refreshing = 0;
  let playback = 0;
  let busy = false;
  let checking = false;
  let available = false;
  const listeners = [];
  const listen = (node, event, callback) => {
    node?.addEventListener?.(event, callback);
    listeners.push(() => node?.removeEventListener?.(event, callback));
  };
  const element = (tag, className, message, parameters) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (message) node.textContent = t(message, parameters);
    return node;
  };
  const panel = element("section", "developer-audio-lab");
  panel.append(element("p", "developer-tool-intro", "developer.audio.intro", { language }));
  const field = (message, control) => {
    const label = element("label", "developer-tool-field");
    label.append(element("span", "", message), control);
    panel.append(label);
    return control;
  };
  const voice = field("developer.audio.voice", element("select"));
  voice.dataset.audioLabVoice = "";
  const text = field("developer.audio.text", element("textarea"));
  text.dataset.audioLabText = "";
  text.lang = target.locale || locale;
  text.dir = target.direction || "auto";
  text.rows = 4;
  text.maxLength = 1000;
  text.placeholder = t("developer.audio.placeholder", { language });
  const slider = (name, value) => {
    const input = element("input");
    input.type = "range";
    input.min = "0.5";
    input.max = "1.5";
    input.step = "0.05";
    input.value = String(value);
    input.setAttribute(`data-audio-lab-${name}`, "");
    field(`developer.audio.${name}`, input);
    const output = element("output");
    const update = () => { output.textContent = `${Number(input.value).toFixed(2)}×`; };
    input.parentElement.append(output);
    listen(input, "input", update);
    update();
    return input;
  };
  const rate = slider("rate", host.CaatuuChrome?.resolveSpeechPace?.().rate || 0.9);
  const pitch = slider("pitch", 1);
  const actions = element("div", "developer-tool-actions");
  const button = (name) => {
    const node = element("button", "", `developer.audio.${name}`);
    node.type = "button";
    node.setAttribute(`data-audio-lab-${name}`, "");
    actions.append(node);
    return node;
  };
  const play = button("play");
  const stop = button("stop");
  const refresh = button("refresh");
  const install = button("install");
  install.hidden = true;
  const status = element("p", "developer-tool-status");
  status.dataset.audioLabStatus = "";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  panel.append(actions, status);
  root.replaceChildren(panel);
  const setStatus = (key, parameters = {}) => {
    if (!disposed) status.textContent = t(`developer.audio.${key}`, parameters);
  };
  const muted = () => host.CaatuuChrome?.getSpeechMuted?.() === true;
  const sync = () => {
    play.disabled = checking || busy || !available || muted();
    play.setAttribute("aria-busy", String(busy));
    stop.disabled = !busy;
    voice.disabled = checking || busy || !available;
    text.disabled = busy;
    refresh.disabled = checking || busy;
    install.disabled = checking || busy;
  };
  async function refreshVoices() {
    if (disposed) return;
    const token = ++refreshing;
    checking = true;
    if (!busy) setStatus("checking", { language });
    sync();
    try {
      const state = await service.status();
      if (disposed || token !== refreshing) return;
      const selected = voice.value;
      const automatic = element("option", "", "developer.audio.automatic");
      automatic.value = "";
      voice.replaceChildren(automatic);
      for (const item of state.voices) {
        const option = element("option", "", "developer.audio.voiceoption", {
          name: item.name, locale: item.locale,
          service: t(item.localService ? "developer.audio.local" : "developer.audio.network")
        });
        option.value = item.id;
        voice.append(option);
      }
      voice.value = state.voices.some((item) => item.id === selected) ? selected : "";
      available = state.available === true;
      install.hidden = !(state.canInstallVoice && service.installData);
      if (!busy) setStatus(muted() ? "muted" : available ? "ready" : state.supported ? "unavailable" : "unsupported", { language });
    } catch (error) {
      if (!disposed && token === refreshing) {
        available = false;
        setStatus("failed", { detail: error?.message || String(error) });
      }
    } finally {
      if (!disposed && token === refreshing) { checking = false; sync(); }
    }
  }
  listen(play, "click", async () => {
    if (play.disabled || disposed) return;
    const value = String(text.value || "").normalize("NFC").trim();
    if (!value || value.length > 1000) { setStatus(value ? "toolong" : "required"); return; }
    const token = ++playback;
    busy = true;
    sync();
    setStatus("starting");
    try {
      const result = await service.speak(value, {
        voice: voice.value, rate: rate.value, pitch: pitch.value,
        onStart() { if (token === playback) setStatus("playing"); }
      });
      if (disposed || token !== playback) return;
      setStatus(result?.muted ? "muted" : result?.stopped || result?.outcome === "stopped" ? "stopped" : "finished");
    } catch (error) {
      if (!disposed && token === playback) setStatus("failed", { detail: error?.message || String(error) });
    } finally {
      if (!disposed && token === playback) { busy = false; sync(); }
    }
  });
  async function stopPreview() {
    playback += 1;
    busy = false;
    sync();
    try { await service.stop(); setStatus(muted() ? "muted" : "stopped"); }
    catch (error) { setStatus("failed", { detail: error?.message || String(error) }); }
  }
  listen(stop, "click", stopPreview);
  listen(refresh, "click", refreshVoices);
  listen(install, "click", async () => {
    if (install.disabled || !service.installData) return;
    install.disabled = true;
    try { await service.installData(); setStatus("installopened"); }
    catch (error) { setStatus("failed", { detail: error?.message || String(error) }); }
    finally { if (!disposed) sync(); }
  });
  listen(host.speechSynthesis, "voiceschanged", refreshVoices);
  listen(host, "caatuu:speech-voices-refresh", refreshVoices);
  listen(host, "focus", refreshVoices);
  listen(host, "caatuu:speech-mute-change", () => {
    if (busy && muted()) void stopPreview();
    else { sync(); if (muted()) setStatus("muted"); else void refreshVoices(); }
  });
  void refreshVoices();
  return () => {
    disposed = true;
    playback += 1;
    refreshing += 1;
    listeners.forEach((remove) => remove());
    panel.remove();
    return Promise.resolve(service.dispose()).catch(() => {});
  };
}
