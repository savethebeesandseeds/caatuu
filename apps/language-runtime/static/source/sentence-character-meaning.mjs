const HAN_CHARACTER = /^\p{Script=Han}$/u;
const HAN_SPAN = /^\p{Script=Han}+$/u;

function dictionaryGloss(dictionary, surface) {
  if (!dictionary) return "";
  const value = typeof dictionary.get === "function" ? dictionary.get(surface) : dictionary[surface];
  return String(value || "").normalize("NFC").trim();
}

function alignTokens(text, tokens) {
  const aligned = [];
  let cursor = 0;
  (Array.isArray(tokens) ? tokens : []).forEach((token, tokenIndex) => {
    const surface = String(token?.surface ?? token?.text ?? "").normalize("NFC");
    if (!surface) return;
    const start = text.indexOf(surface, cursor);
    if (start < 0) return;
    aligned.push({
      surface,
      gloss: String(token?.gloss || "").normalize("NFC").trim(),
      start,
      end: start + surface.length,
      tokenIndex
    });
    cursor = start + surface.length;
  });
  return aligned;
}

function hanRun(text, offset) {
  if (!HAN_CHARACTER.test(text[offset] || "")) return null;
  let start = offset;
  let end = offset + 1;
  while (start > 0 && HAN_CHARACTER.test(text[start - 1])) start -= 1;
  while (end < text.length && HAN_CHARACTER.test(text[end])) end += 1;
  return { start, end };
}

function meaningResult(token, gloss = token.gloss) {
  return {
    surface: token.surface,
    gloss,
    tokenIndex: token.tokenIndex,
    start: token.start,
    end: token.end
  };
}

/**
 * Resolve a selected character to an authored meaning inside one sentence.
 * The word written around the character wins. A character with no meaning
 * then grows forward, then backward, inside the same run of Han characters.
 */
export function resolveSentenceCharacterMeaning({
  text,
  tokens,
  offset,
  dictionary = null,
  maxLength = 5
} = {}) {
  const sentence = String(text ?? "").normalize("NFC");
  if (!Number.isInteger(offset) || offset < 0 || offset >= sentence.length) return null;
  const aligned = alignTokens(sentence, tokens);
  const covering = aligned.find((token) => offset >= token.start && offset < token.end) || null;
  if (covering?.gloss) return meaningResult(covering);
  const coveredGloss = covering ? dictionaryGloss(dictionary, covering.surface) : "";
  if (covering && coveredGloss) return meaningResult(covering, coveredGloss);
  if (!HAN_CHARACTER.test(sentence[offset] || "")) return null;

  const run = hanRun(sentence, offset);
  if (!run) return null;
  const limit = Math.max(1, Math.min(Math.floor(Number(maxLength) || 1), run.end - run.start));
  for (let length = 1; length <= limit; length += 1) {
    const starts = [];
    const add = (start) => {
      if (!Number.isInteger(start) || start < run.start || start + length > run.end) return;
      if (start > offset || start + length <= offset || starts.includes(start)) return;
      starts.push(start);
    };
    add(offset);
    add(offset + 1 - length);
    for (let start = offset - 1; start >= run.start; start -= 1) add(start);
    const found = [];
    for (const start of starts) {
      const surface = sentence.slice(start, start + length);
      if (!HAN_SPAN.test(surface)) continue;
      const exact = aligned.find((token) => (
        token.gloss && token.start === start && token.end === start + length
      ));
      const gloss = exact?.gloss || dictionaryGloss(dictionary, surface);
      if (!gloss) continue;
      found.push({
        surface,
        gloss,
        tokenIndex: exact ? exact.tokenIndex : null,
        start,
        end: start + length,
        local: Boolean(exact)
      });
    }
    if (!found.length) continue;
    return found.find((hit) => hit.local) || found[0];
  }
  return null;
}
