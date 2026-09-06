const TARGET_TEXT_TONE_MARKS = Object.freeze({
  1: /[āēīōūǖĀĒĪŌŪǕ]/u,
  2: /[áéíóúǘÁÉÍÓÚǗńŃḿḾ]/u,
  3: /[ǎěǐǒǔǚǍĚǏǑǓǙňŇ]/u,
  4: /[àèìòùǜÀÈÌÒÙǛǹǸ]/u
});

export function targetTextToneNumber(notation) {
  const value = String(notation || "").normalize("NFC").trim();
  const numbered = value.match(/[1-5](?!.*[1-5])/u);
  if (numbered) return Number(numbered[0]);
  for (const [tone, pattern] of Object.entries(TARGET_TEXT_TONE_MARKS)) {
    if (pattern.test(value)) return Number(tone);
  }
  return 5;
}

function alignedParts(text, reading) {
  if (reading?.system !== "pinyin" || !Array.isArray(reading.tokens) || !reading.tokens.length) return null;
  const parts = [];
  let cursor = 0;
  for (const token of reading.tokens) {
    if (typeof token?.surface !== "string" || !token.surface
        || !Array.isArray(token.units) || !token.units.length) return null;
    if (token.units.some((unit) => typeof unit?.surface !== "string"
        || Array.from(unit.surface).length !== 1
        || typeof unit.notation !== "string"
        || !/^[\p{Script=Latin}\p{M}]+[1-5]?$/u.test(unit.notation))) return null;
    if (token.units.map((unit) => unit.surface).join("") !== token.surface) return null;
    const start = text.indexOf(token.surface, cursor);
    if (start < cursor) return null;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(...token.units);
    cursor = start + token.surface.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

// The caller owns clearing the destination. Only supplied, aligned reading
// units receive a color; punctuation and text without a reading stay plain.
export function appendTargetToneText(document, element, text, reading) {
  const surface = String(text ?? "");
  const parts = alignedParts(surface, reading);
  if (!parts) {
    element.append(surface);
    return false;
  }
  for (const part of parts) {
    if (typeof part === "string") {
      element.append(part);
      continue;
    }
    const glyph = document.createElement("span");
    glyph.className = "caatuu-target-tone";
    glyph.dataset.tone = String(targetTextToneNumber(part.notation));
    glyph.textContent = part.surface;
    element.append(glyph);
  }
  return true;
}
