import { arabicReadingUnits } from "./arabic-romanization.mjs?v=arabic-romanization-1";
import { georgianReadingUnits } from "./georgian-romanization.mjs?v=georgian-romanization-1";
import { russianReadingUnits } from "./russian-romanization.mjs?v=russian-romanization-1";
import { hebrewReadingUnits } from "./hebrew-romanization.mjs?v=hebrew-romanization-1";

const LANGUAGES = {
  ar: { units: arabicReadingUnits, script: /\p{Script=Arabic}/u, direction: "rtl", name: "arabic" },
  ka: { units: georgianReadingUnits, script: /\p{Script=Georgian}/u, direction: "ltr", name: "georgian" },
  ru: { units: russianReadingUnits, script: /\p{Script=Cyrillic}/u, direction: "ltr", name: "russian" },
  he: { units: hebrewReadingUnits, script: /\p{Script=Hebrew}/u, direction: "rtl", name: "hebrew" }
};

// A presentation preference, separate from answer keys, speech and reviewed
// pronunciation metadata. Each game owns its setting; a new learner sees it on.
export function createTargetReadingGuide({ course, gameId, document, storage, onChange } = {}) {
  const languageId = course?.targetLanguage?.id;
  const language = LANGUAGES[languageId];
  const available = Boolean(language);
  const key = `caatuu.${course?.id || languageId}.${gameId}.romanization`;
  const sources = new Map();
  const settings = new Map();
  let enabled = true;
  try {
    storage ??= globalThis.localStorage;
    enabled = storage?.getItem(key) !== "false";
  } catch { /* Session preferences work when storage is unavailable. */ }

  function paint(host, source) {
    const { text, reading, glyphs } = source;
    const units = reading ? [{ surface: text, notation: reading }] : language.units(text);
    const guided = available && enabled && units.some((unit) => unit.notation);
    host.classList.toggle("has-reading-guide", Boolean(guided));
    host.classList.toggle(`has-${language.name}-reading-guide`, Boolean(guided));
    if (!guided) {
      if (glyphs?.length) host.replaceChildren(...glyphs.map((node) => node.cloneNode(true)));
      else host.textContent = text;
      source.snapshot = host.textContent;
      return;
    }
    const run = document.createElement("span");
    run.className = `caatuu-reading-guide caatuu-${language.name}-reading`;
    run.dir = language.direction;
    run.lang = languageId;
    for (const unit of units) {
      if (!unit.notation) {
        run.append(unit.surface);
        continue;
      }
      const ruby = document.createElement("ruby");
      ruby.className = `caatuu-reading-unit caatuu-${language.name}-reading-unit`;
      const glyph = document.createElement("span");
      glyph.className = "caatuu-target-text-glyph";
      if (glyphs?.length && units.length === 1) glyph.append(...glyphs.map((node) => node.cloneNode(true)));
      else glyph.textContent = unit.surface;
      const notation = document.createElement("rt");
      notation.className = "caatuu-target-text-notation";
      notation.dir = "ltr";
      notation.lang = `${languageId}-Latn`;
      notation.setAttribute("aria-hidden", "true");
      notation.textContent = unit.notation;
      ruby.append(glyph, notation);
      run.append(ruby);
    }
    host.replaceChildren(run);
    source.snapshot = host.textContent;
  }

  function refresh() {
    for (const [host, source] of sources) {
      if (host.isConnected === false || host.textContent !== source.snapshot) sources.delete(host);
      else paint(host, source);
    }
    for (const button of settings.values()) {
      button.setAttribute("aria-checked", String(enabled));
      button.classList.toggle("is-active", enabled);
    }
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    try { storage?.setItem(key, String(enabled)); } catch { /* Session fallback. */ }
    refresh();
    onChange?.(enabled);
  }

  return {
    get available() { return available; },
    supports(text) { return available && language.script.test(String(text || "")); },
    get enabled() { return enabled; },
    render(host, text, { reading, glyphs } = {}) {
      if (!available || !host) return false;
      if (!language.script.test(String(text || ""))) {
        sources.delete(host);
        host.classList.remove("has-reading-guide", `has-${language.name}-reading-guide`);
        return false;
      }
      const source = { text: String(text), reading, glyphs: glyphs?.map((node) => node.cloneNode(true)) };
      sources.set(host, source);
      paint(host, source);
      return true;
    },
    refresh,
    setEnabled,
    mountSetting(container, { label = "Show romanization" } = {}) {
      if (!available || !container) return null;
      if (settings.has(container)) return settings.get(container);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "caatuu-romanization-setting";
      button.dataset.readingGuideSetting = gameId;
      if (languageId === "ar") button.dataset.arabicRomanizationSetting = gameId;
      button.setAttribute("role", "switch");
      button.setAttribute("aria-checked", String(enabled));
      const copy = document.createElement("span");
      copy.textContent = label;
      const indicator = document.createElement("i");
      indicator.setAttribute("aria-hidden", "true");
      button.append(copy, indicator);
      button.addEventListener("click", () => setEnabled(!enabled));
      container.append(button);
      settings.set(container, button);
      return button;
    }
  };
}
