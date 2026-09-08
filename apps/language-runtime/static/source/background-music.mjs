// Music has its own media element and preferences. Speech never changes either.
export const MUSIC_TRACKS = Object.freeze([
  { id: "woodland-fantasy", title: "Woodland Fantasy", url: "/assets/music/audio/Woodland_Fantasy.mp3", author: "Matthew Pablo", artistUrl: "https://www.matthewpablo.com/", sourceUrl: "https://opengameart.org/content/woodland-fantasy", licenseUrl: "https://creativecommons.org/licenses/by/3.0/", sha256: "87f9a9d04fdd0b924db98b90e86c2906330f4931cb8734f7b431706e2869aacd" },
  { id: "salt-marsh-birds", title: "Salt Marsh Birds", url: "/assets/music/audio/Salt_Marsh_Birds.mp3", author: "Matthew Pablo", artistUrl: "https://www.matthewpablo.com/", sourceUrl: "https://opengameart.org/content/salt-marsh-birds-cuteplayful", licenseUrl: "https://creativecommons.org/licenses/by/3.0/", sha256: "0e37ee593f7c63b850cf6c20b65d241a601390194ac95c31a31fbddbd31292d0" },
  { id: "town-theme-rpg", title: "Town Theme RPG", url: "/assets/music/audio/Town_Theme_RPG.mp3", author: "cynicmusic", artistUrl: "https://cynicmusic.com/", sourceUrl: "https://opengameart.org/content/town-theme-rpg", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", sha256: "2657861d5107d4a3c01ef81cb6a4d61ddd5e7a054b6da57e658373d79d0c3466" },
].map(Object.freeze));

const PREFERENCE_KEY = "caatuu.music.v1";
const POSITION_KEY = "caatuu.music.position.v1";
const CACHE_NAME = "caatuu-music-v1";
const DEFAULT_VOLUME = 0.5;
const trackFor = (id) => MUSIC_TRACKS.find((track) => track.id === id);
const clampVolume = (value) => Math.min(1, Math.max(0, value));
// The saved percentage is the slider position: equal steps span -40 to 0 dB.
// Convert to linear media gain only at playback, with zero reserved for silence.
const musicGain = (volume) => volume === 0 ? 0 : 10 ** ((volume - 1) * 2);

function readJson(scope, key, storage = "localStorage") {
  try { return JSON.parse(scope[storage]?.getItem(key) || "null"); } catch { return null; }
}

/** Install once in the top document; child games reuse and activate that player. */
export function installMusicPlayer(scope = globalThis) {
  let owner;
  try {
    owner = scope.top || scope;
    // Only trusted same-origin game frames participate in the shared player.
    void owner.document;
  } catch { return null; }
  if (owner !== scope) {
    const shared = installMusicPlayer(owner);
    shared?.attachFrame(scope);
    scope.CaatuuMusic = shared;
    return shared;
  }
  if (owner.CaatuuMusic) return owner.CaatuuMusic;

  const document = owner.document;
  const audio = document.createElement("audio");
  audio.loop = true;
  audio.preload = "none";
  const saved = readJson(owner, PREFERENCE_KEY);
  let trackId = trackFor(saved?.trackId)?.id || MUSIC_TRACKS[0].id;
  let volume = Number.isFinite(saved?.volume) ? clampVolume(saved.volume) : DEFAULT_VOLUME;
  let ready = false;
  let masterMuted = false;
  let blocked = false;
  let error = null;
  let destroyed = false;
  let pageActive = true;
  let nativeFocused = true;
  let generation = 0;
  let pendingPlay = null;
  let cacheCheck = null;
  let nativeCheck = null;
  let cacheGeneration = 0;
  let sourceId = null;
  let resumePosition = readJson(owner, POSITION_KEY, "sessionStorage");
  let lastSavedPosition = -5;
  const sources = new Map();
  const subscribers = new Set();
  const frames = new WeakSet();
  const cleanups = [];
  const isNative = typeof owner.CaatuuAndroid?.postMessage === "function";
  try { nativeFocused = owner.CaatuuAndroid?.isAppFocused?.() !== false; } catch { nativeFocused = false; }

  const focused = () => pageActive && nativeFocused && document.visibilityState !== "hidden"
    && (typeof document.hasFocus !== "function" || document.hasFocus());
  const shouldPlay = () => !destroyed && ready && focused() && !masterMuted && volume > 0;
  const getState = () => Object.freeze({ trackId, volume, ready, focused: focused(), masterMuted,
    playing: !audio.paused && shouldPlay(), blocked, error });
  const emit = () => {
    const state = getState();
    for (const listener of subscribers) { try { listener(state); } catch { /* One menu cannot stop playback. */ } }
  };
  const listen = (target, name, listener, options) => {
    target?.addEventListener?.(name, listener, options);
    cleanups.push(() => target?.removeEventListener?.(name, listener, options));
  };
  const persist = () => {
    try { owner.localStorage?.setItem(PREFERENCE_KEY, JSON.stringify({ trackId, volume })); } catch { /* Session preferences still work. */ }
  };
  const savePosition = () => {
    if (!sourceId || !Number.isFinite(audio.currentTime)) return;
    resumePosition = { trackId: sourceId, seconds: audio.currentTime };
    try { owner.sessionStorage?.setItem(POSITION_KEY, JSON.stringify(resumePosition)); } catch { /* In-page resume is unaffected. */ }
    lastSavedPosition = audio.currentTime;
  };
  const pause = () => {
    generation++;
    pendingPlay = null;
    savePosition();
    audio.pause();
  };
  const sync = () => {
    if (destroyed) return;
    audio.volume = musicGain(volume);
    if (!shouldPlay()) {
      pause();
      emit();
      return;
    }
    if (sourceId !== trackId) {
      sourceId = trackId;
      audio.src = sources.get(trackId) || trackFor(trackId).url;
      audio.load();
    }
    if (!audio.paused || pendingPlay) { emit(); return; }
    const attempt = ++generation;
    // Assign the marker before play(), which may synchronously dispatch events.
    pendingPlay = attempt;
    let result;
    try { result = audio.play(); } catch (failure) { result = Promise.reject(failure); }
    Promise.resolve(result).then(() => {
      if (attempt !== generation || destroyed) {
        if (!shouldPlay()) audio.pause();
        return;
      }
      pendingPlay = null;
      blocked = false;
      error = null;
      if (!shouldPlay()) pause();
      emit();
    }, (failure) => {
      if (attempt !== generation || destroyed) return;
      pendingPlay = null;
      blocked = failure?.name === "NotAllowedError";
      error = blocked || failure?.name === "AbortError" ? null : "playback-failed";
      emit();
    });
    emit();
  };

  function setReady(value) {
    const next = value === true;
    if (next === ready) return ready;
    ready = next;
    if (!ready) blocked = false;
    sync();
    return ready;
  }

  async function checkReadiness() {
    if (destroyed) return;
    if (isNative) {
      if (typeof owner.CaatuuAndroid.isMusicReady === "function") {
        // Songs belong to shared setup storage, even on a course still installing.
        try { setReady(owner.CaatuuAndroid.isMusicReady() === true); } catch { setReady(false); }
        return;
      }
      // The shell can be mounted while native setup is still installing files.
      if (document.documentElement?.dataset?.caatuuLegacyPageReady === "true") {
        if (ready || nativeCheck || typeof owner.CaatuuRuntime?.setup?.status !== "function") return nativeCheck;
        nativeCheck = Promise.resolve().then(() => owner.CaatuuRuntime.setup.status()).then((status) => {
          if (!destroyed && document.documentElement?.dataset?.caatuuLegacyPageReady === "true") setReady(status?.ready === true);
        }).catch(() => { /* Legacy pages wait for verified native setup too. */ }).finally(() => { nativeCheck = null; });
        return nativeCheck;
      }
      setReady(document.documentElement?.dataset?.caatuuAppReady === "true"
        && !document.body?.classList?.contains("setup-blocked"));
      return;
    }
    if (ready || cacheCheck || !owner.caches?.open || !owner.URL?.createObjectURL) return cacheCheck;
    const checkGeneration = cacheGeneration;
    cacheCheck = (async () => {
      try {
        const cache = await owner.caches.open(CACHE_NAME);
        const responses = await Promise.all(MUSIC_TRACKS.map((track) => cache.match(track.url)));
        if (destroyed || checkGeneration !== cacheGeneration || responses.some((response, index) => !response?.ok
          || response.headers?.get("x-caatuu-setup-sha256") !== MUSIC_TRACKS[index].sha256)) return;
        const blobs = await Promise.all(responses.map((response) => response.blob()));
        if (destroyed || checkGeneration !== cacheGeneration) return;
        for (let index = 0; index < MUSIC_TRACKS.length; index++) {
          sources.set(MUSIC_TRACKS[index].id, owner.URL.createObjectURL(blobs[index]));
        }
        setReady(true);
      } catch { /* Setup owns downloads and errors. Music never fetches missing files. */ }
      finally { cacheCheck = null; }
    })();
    return cacheCheck;
  }

  function activate() {
    // Calling play synchronously inside a gesture also unlocks parent audio from games.
    sync();
    void checkReadiness();
  }
  function attachFrame(frame) {
    if (!frame) return;
    try {
      const frameDocument = frame.document;
      // A WindowProxy survives iframe navigation, but its document and listeners do not.
      if (!frameDocument || frames.has(frameDocument)) return;
      frames.add(frameDocument);
      listen(frameDocument, "pointerdown", activate, true);
      listen(frameDocument, "keydown", activate, true);
      listen(frameDocument, "focusin", sync);
    } catch { /* Cross-origin frames cannot control the app's music. */ }
  }
  function attachFrames() {
    for (const frame of document.querySelectorAll?.("iframe") || []) {
      try { attachFrame(frame.contentWindow); } catch { /* Untrusted frame. */ }
    }
  }

  const player = Object.freeze({ getState, setReady, attachFrame,
    setVolume(value) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return volume;
      volume = clampVolume(parsed);
      persist(); sync(); return volume;
    },
    setTrack(value) {
      if (!trackFor(value) || value === trackId) return trackId;
      pause();
      trackId = value;
      resumePosition = null;
      blocked = false;
      error = null;
      persist(); sync(); return trackId;
    },
    setMasterMuted(value) { masterMuted = Boolean(value); sync(); return masterMuted; },
    subscribe(listener) {
      subscribers.add(listener);
      listener(getState());
      return () => subscribers.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      pause();
      destroyed = true;
      cleanups.forEach((cleanup) => cleanup());
      audio.removeAttribute("src");
      audio.load();
      sources.forEach((url) => owner.URL.revokeObjectURL(url));
      subscribers.clear();
      if (owner.CaatuuMusic === player) delete owner.CaatuuMusic;
    },
  });
  owner.CaatuuMusic = player;
  attachFrame(owner);
  attachFrames();
  listen(document, "load", attachFrames, true);
  listen(document, "visibilitychange", sync);
  listen(owner, "blur", () => {
    // Moving into an iframe fires window.blur while the top document remains focused.
    // Defer one microtask so document.hasFocus() reflects the destination.
    Promise.resolve().then(sync);
  });
  listen(owner, "focus", activate);
  listen(owner, "pagehide", () => { pageActive = false; sync(); });
  listen(owner, "pageshow", () => { pageActive = true; activate(); });
  listen(owner, "caatuu:app-focus-change", (event) => {
    nativeFocused = event.detail?.focused === true;
    sync();
  });
  listen(owner, "caatuu:music-assets-ready", () => { void checkReadiness(); });
  listen(owner, "caatuu:music-assets-cleared", () => {
    cacheGeneration++;
    setReady(false);
    sources.forEach((url) => owner.URL.revokeObjectURL(url));
    sources.clear();
    sourceId = null;
    audio.removeAttribute("src");
    audio.load();
  });
  listen(document, "caatuu:app-ready", () => { void checkReadiness(); });
  listen(document, "caatuu:legacy-page-ready", () => { void checkReadiness(); });
  listen(owner, "storage", (event) => {
    if (event.key !== PREFERENCE_KEY && event.key !== null) return;
    const preference = readJson(owner, PREFERENCE_KEY);
    const nextTrack = trackFor(preference?.trackId)?.id || MUSIC_TRACKS[0].id;
    if (nextTrack !== trackId) { pause(); trackId = nextTrack; resumePosition = null; }
    volume = Number.isFinite(preference?.volume) ? clampVolume(preference.volume) : DEFAULT_VOLUME;
    sync();
  });
  listen(audio, "loadedmetadata", () => {
    if (resumePosition?.trackId === trackId && Number.isFinite(resumePosition.seconds)
      && resumePosition.seconds >= 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
      try { audio.currentTime = resumePosition.seconds % audio.duration; } catch { /* Retry naturally from the beginning. */ }
    }
    resumePosition = null;
  });
  listen(audio, "timeupdate", () => {
    if (Math.abs(audio.currentTime - lastSavedPosition) >= 5) savePosition();
  });
  listen(audio, "playing", () => { if (!shouldPlay()) pause(); emit(); });
  listen(audio, "pause", emit);
  listen(audio, "error", () => { error = "playback-failed"; emit(); });
  if (owner.MutationObserver) {
    const observer = new owner.MutationObserver((records = []) => {
      if (!records.length || records.some((record) => record.type === "childList")) attachFrames();
      if (isNative && (!records.length || records.some((record) =>
        record.target === document.documentElement || record.target === document.body))) void checkReadiness();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["class", "data-caatuu-app-ready", "data-caatuu-legacy-page-ready"] });
    cleanups.push(() => observer.disconnect());
  }
  audio.volume = musicGain(volume);
  void checkReadiness();
  return player;
}
