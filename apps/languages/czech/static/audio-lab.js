const $ = (selector) => document.querySelector(selector);

const voiceSelect = $("#audioLabVoice");
const textField = $("#audioLabText");
const rateControl = $("#audioLabRate");
const rateValue = $("#audioLabRateValue");
const pitchControl = $("#audioLabPitch");
const pitchValue = $("#audioLabPitchValue");
const playButton = $("#audioLabPlay");
const stopButton = $("#audioLabStop");
const status = $("#audioLabStatus");
let speechRequest = 0;
let voiceRefreshRequest = 0;
let speechAvailable = false;
let speechBusy = false;

function speechApi() {
  return window.CaatuuChrome;
}

function syncTuningLabels() {
  rateValue.textContent = `${Number(rateControl.value).toFixed(2).replace(/0$/u, "")}×`;
  pitchValue.textContent = `${Number(pitchControl.value).toFixed(2).replace(/0$/u, "")}×`;
}

function syncControls() {
  voiceSelect.disabled = !speechAvailable || speechBusy;
  playButton.disabled = !speechAvailable || speechBusy;
  playButton.setAttribute("aria-busy", String(speechBusy));
  stopButton.disabled = !speechAvailable || !speechBusy;
  document.querySelectorAll("[data-audio-sample]").forEach((button) => {
    button.disabled = !speechAvailable || speechBusy;
  });
}

function setBusy(busy) {
  speechBusy = busy;
  syncControls();
}

async function refreshVoices() {
  const request = voiceRefreshRequest + 1;
  voiceRefreshRequest = request;
  const api = speechApi();
  if (!api?.listSpeechVoiceOptions) {
    speechAvailable = false;
    syncControls();
    status.textContent = "The shared Caatuu speech service is unavailable.";
    return;
  }
  if (!speechBusy) status.textContent = "Checking Czech voices...";
  const { backend, available, voices } = await api.listSpeechVoiceOptions();
  if (request !== voiceRefreshRequest) return;
  const automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = "Automatic (recommended)";
  voiceSelect.replaceChildren(automatic);
  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.value;
    option.textContent = `${voice.name} (${voice.locale} · ${voice.service})`;
    voiceSelect.append(option);
  });
  const preferred = api.getSpeechVoicePreference?.() || "";
  const preferredValue = preferred ? `${backend}:${preferred}` : "";
  voiceSelect.value = voices.some((voice) => voice.value === preferredValue) ? preferredValue : "";
  speechAvailable = available;
  syncControls();
  if (!speechBusy) {
    status.textContent = available
      ? `${voiceSelect.selectedOptions[0]?.textContent || "Automatic"} is ready.`
      : "Czech pronunciation is not available on this device.";
  }
}

async function playText(text) {
  const normalizedText = String(text || "").normalize("NFC").trim();
  if (!normalizedText) {
    status.textContent = "Enter Czech text to hear.";
    textField.focus();
    return;
  }
  const api = speechApi();
  const request = speechRequest + 1;
  speechRequest = request;
  setBusy(true);
  status.textContent = "Starting the selected Czech voice...";
  try {
    await api.speakCzechText(normalizedText, {
      rate: Number(rateControl.value),
      pitch: Number(pitchControl.value),
      onStart() {
        if (speechRequest === request) status.textContent = "Playing Czech audio...";
      }
    });
    if (speechRequest === request) status.textContent = "Audio test finished.";
  } catch (error) {
    if (speechRequest === request) {
      const reason = String(error?.message || error || "Unknown speech error").slice(0, 160);
      status.textContent = `Unable to play this Czech audio sample: ${reason}`;
    }
  } finally {
    if (speechRequest === request) setBusy(false);
  }
}

voiceSelect.addEventListener("change", async () => {
  await speechApi()?.stopCzechSpeech?.();
  speechApi()?.setSpeechVoicePreference?.(voiceSelect.value);
  status.textContent = `${voiceSelect.selectedOptions[0]?.textContent || "Automatic"} selected.`;
});

document.querySelectorAll("[data-audio-sample]").forEach((button) => {
  button.addEventListener("click", () => {
    const text = button.dataset.audioSample || "";
    textField.value = text;
    void playText(text);
  });
});

playButton.addEventListener("click", () => void playText(textField.value));
stopButton.addEventListener("click", async () => {
  speechRequest += 1;
  try {
    await speechApi()?.stopCzechSpeech?.();
    status.textContent = "Audio stopped.";
  } catch (error) {
    status.textContent = "Unable to stop the audio cleanly.";
  } finally {
    setBusy(false);
  }
});
rateControl.addEventListener("input", syncTuningLabels);
pitchControl.addEventListener("input", syncTuningLabels);
window.speechSynthesis?.addEventListener?.("voiceschanged", () => void refreshVoices());
window.addEventListener("caatuu:speech-voice-change", () => void refreshVoices());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  speechRequest += 1;
  setBusy(false);
  void speechApi()?.stopCzechSpeech?.();
});
window.addEventListener("pagehide", () => {
  speechRequest += 1;
  setBusy(false);
  void speechApi()?.stopCzechSpeech?.();
});

syncTuningLabels();
void refreshVoices();
