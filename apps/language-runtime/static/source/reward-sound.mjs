const DEFAULT_VOLUME = 0.5;
const clampVolume = value => Math.min(1, Math.max(0, value));
const audibleGain = volume => volume === 0 ? 0 : 10 ** ((volume - 1) * 2);

/** One quiet reward cue, controlled by shared audio preferences, never by voice mute. */
export function createRewardSound({
  scope = globalThis.window ?? globalThis,
  getPreferences
} = {}) {
  const document = scope.document;
  let context = null;
  let output = null;
  let destroyed = false;
  let pageActive = true;
  let nativeFocused = true;
  let music = null;
  let unsubscribeMusic = null;
  const voices = new Set();
  const listeners = [];
  try { nativeFocused = scope.CaatuuAndroid?.isAppFocused?.() !== false; } catch { nativeFocused = false; }

  const listen = (target, type, listener) => {
    target?.addEventListener?.(type, listener);
    listeners.push(() => target?.removeEventListener?.(type, listener));
  };
  const focused = () => pageActive && nativeFocused && document?.visibilityState !== "hidden"
    && (typeof document?.hasFocus !== "function" || document.hasFocus());
  function preferences() {
    let state;
    try { state = getPreferences ? getPreferences() : scope.CaatuuMusic?.getState?.(); } catch { state = null; }
    const volume = Number.isFinite(state?.volume) ? clampVolume(state.volume) : DEFAULT_VOLUME;
    return { volume, muted: state?.muted === true || state?.masterMuted === true };
  }
  function release(voice) {
    if (!voices.delete(voice)) return;
    voice.oscillator.onended = null;
    try { voice.oscillator.disconnect(); } catch { /* Already disconnected. */ }
    try { voice.envelope?.disconnect(); } catch { /* Already disconnected. */ }
  }
  function stop() {
    for (const voice of [...voices]) {
      // Disconnect first so cancellation cannot leave scheduled notes audible.
      release(voice);
      try { voice.oscillator.stop(); } catch { /* Ended sources cannot stop again. */ }
    }
  }
  function sync() {
    if (destroyed) return;
    const state = preferences();
    if (!focused() || state.muted || state.volume === 0) stop();
    if (!output || !context) return;
    try {
      output.gain.cancelScheduledValues(context.currentTime);
      output.gain.setValueAtTime(audibleGain(state.muted ? 0 : state.volume), context.currentTime);
    } catch { stop(); }
  }
  function attachMusic() {
    const player = scope.CaatuuMusic;
    if (getPreferences || player === music) return;
    unsubscribeMusic?.();
    music = player;
    unsubscribeMusic = typeof player?.subscribe === "function" ? player.subscribe(sync) : null;
  }

  /** Call synchronously from a captured trusted pointer/key gesture, including game frames. */
  function unlock(event) {
    if (destroyed || event?.isTrusted !== true || !["pointerdown", "pointerup", "keydown"].includes(event.type) || !focused()) return false;
    attachMusic();
    try {
      if (!context) {
        const AudioContext = scope.AudioContext ?? scope.webkitAudioContext;
        if (!AudioContext) return false;
        context = new AudioContext();
        output = context.createGain();
        output.connect(context.destination);
        sync();
      }
      // Never queue a reward behind autoplay permission. A later presentation
      // may play after resume succeeds; the current presentation stays silent.
      if (context.state !== "running") Promise.resolve(context.resume()).catch(() => {});
      return true;
    } catch {
      stop();
      try { output?.disconnect(); } catch { /* Partially initialized context. */ }
      try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* Context unavailable. */ }
      output = null;
      context = null;
      return false;
    }
  }

  function note(frequency, offset, duration, peak, type = "sine") {
    const oscillator = context.createOscillator();
    const voice = { oscillator, envelope: null };
    voices.add(voice);
    const envelope = context.createGain();
    voice.envelope = envelope;
    oscillator.onended = () => release(voice);
    oscillator.type = type;
    const start = context.currentTime + offset;
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(peak, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(output);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.015);
  }

  /** Returns immediately; callers own receipt deduplication and visible presentation. */
  function play(receipt = {}) {
    if (destroyed) return false;
    attachMusic();
    stop();
    sync();
    const state = preferences();
    if (!context || !output || context.state !== "running" || !focused() || state.muted || state.volume === 0
      || ![receipt?.xp, receipt?.coins, receipt?.gems].some(value => Number(value) > 0)) return false;
    try {
      // Rounded sine notes give XP a gentle ascending cadence.
      [523.25, 659.25, 783.99].forEach((frequency, index) => note(frequency, index * 0.13, 0.29, 0.2));
      if (Number(receipt.coins) > 0) {
        note(1567.98, 0.44, 0.075, 0.085, "triangle");
        note(2093, 0.48, 0.09, 0.05);
      }
      if (Number(receipt.gems) > 0) {
        note(1046.5, 0.67, 0.31, 0.12);
        note(1567.98, 0.78, 0.29, 0.09);
        note(2093, 0.9, 0.24, 0.06);
      }
      return true;
    } catch { stop(); return false; }
  }

  attachMusic();
  listen(document, "visibilitychange", sync);
  listen(scope, "blur", () => { Promise.resolve().then(sync); });
  listen(scope, "pagehide", () => { pageActive = false; stop(); });
  listen(scope, "pageshow", () => { pageActive = true; sync(); });
  listen(scope, "caatuu:app-focus-change", event => { nativeFocused = event.detail?.focused === true; sync(); });
  listen(scope, "caatuu:reward-audio-change", sync);
  listen(scope, "storage", sync);
  return Object.freeze({ unlock, play, stop,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      unsubscribeMusic?.();
      listeners.splice(0).forEach(remove => remove());
      try { output?.disconnect(); } catch { /* Already disconnected. */ }
      try { if (context?.state !== "closed") Promise.resolve(context?.close()).catch(() => {}); } catch { /* Context unavailable. */ }
      output = null;
      context = null;
    }
  });
}
