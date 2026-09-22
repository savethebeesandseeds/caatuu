import { targetTextToneNumber } from "./target-text-tones.mjs?v=target-text-tones-1";

// Hosts own the reading authority and preferences. This renderer only accepts
// a complete, aligned run; it never infers a pronunciation from the surface.
export function renderTargetText(document, host, text, {
  units, showGuide = true, colorTones = true, guideLanguage = ""
} = {}) {
  if (!host) return false;
  const surface = String(text ?? "").normalize("NFC");
  const validUnits = Array.isArray(units) && units.length > 0
    && units.every((unit) => typeof unit?.surface === "string" && unit.surface.length > 0
      && typeof unit.notation === "string" && unit.notation.trim().length > 0)
    && units.map((unit) => unit.surface).join("") === surface;
  host.classList.toggle("has-target-text-guide", validUnits && Boolean(showGuide));
  host.classList.toggle("has-target-text-colors", validUnits && Boolean(colorTones));
  if (!validUnits) {
    host.textContent = surface;
    return false;
  }

  const run = document.createElement("span");
  run.className = "caatuu-target-text";
  for (const unit of units) {
    const wrapper = document.createElement(showGuide ? "ruby" : "span");
    wrapper.className = "caatuu-target-text-unit";
    if (colorTones) {
      const tone = Number.isInteger(unit.tone) && unit.tone >= 1 && unit.tone <= 5
        ? unit.tone : targetTextToneNumber(unit.notation);
      wrapper.dataset.tone = String(tone);
    }
    const glyph = document.createElement("span");
    glyph.className = "caatuu-target-text-glyph";
    glyph.textContent = unit.surface;
    wrapper.append(glyph);
    if (showGuide) {
      const notation = document.createElement("rt");
      notation.className = "caatuu-target-text-notation";
      notation.lang = guideLanguage;
      notation.setAttribute("aria-hidden", "true");
      notation.textContent = unit.notation;
      wrapper.append(notation);
    }
    run.append(wrapper);
  }
  host.replaceChildren(run);
  return true;
}
