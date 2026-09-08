import { installMusicPlayer } from "./background-music.mjs";
import { mountMusicControls, mountMusicCredits, mountVoiceControls } from "./music-controls.mjs";

export function installMusic(host = window) {
  if (host.CaatuuMusicUi) return host.CaatuuMusicUi;
  const player = installMusicPlayer(host);
  const controls = new Map();
  function mountAll(root = host.document) {
    const i18n = host.CaatuuI18n || host.CaatuuLauncherInterface;
    for (const [container, control] of controls) {
      if (!host.document.documentElement.contains(container)) { control?.destroy(); controls.delete(container); }
    }
    root.querySelectorAll("[data-music-controls]").forEach((container) => {
      controls.get(container)?.destroy();
      controls.set(container, mountMusicControls({ container, player, i18n,
        songSelection: container.hasAttribute("data-music-song-selection") }));
    });
    root.querySelectorAll("[data-music-credits]").forEach((container) => mountMusicCredits({ container, i18n }));
    root.querySelectorAll("[data-voice-controls]").forEach((container) => {
      controls.get(container)?.destroy();
      controls.set(container, mountVoiceControls({ container, api: host.CaatuuChrome, host, i18n }));
    });
  }
  host.addEventListener("caatuu:interfacechange", () => mountAll());
  const api = Object.freeze({ mountMusicControls, mountAll });
  host.CaatuuMusicUi = api;
  mountAll();
  return api;
}

// The app bootstrap installs after its interface catalog; the public launcher
// uses this same entry directly and updates its locale through interfacechange.
if (typeof window !== "undefined" && !window.document.documentElement.hasAttribute("data-caatuu-app-root")) {
  installMusic(window);
}
