export function capitalizeWord(word) {
  const value = String(word || "").trim();
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase("cs-CZ") + value.slice(1);
}

export function normalizeWord(word) {
  return String(word || "")
    .normalize("NFC")
    .replace(/^[^\p{L}\p{M}\d]+|[^\p{L}\p{M}\d]+$/gu, "")
    .trim();
}

export function interpretHorizontalSwipe(start, end, {
  minDistance = 64,
  maxVerticalRatio = 0.65,
  maxDurationMs = 900
} = {}) {
  const startX = Number(start?.x);
  const startY = Number(start?.y);
  const endX = Number(end?.x);
  const endY = Number(end?.y);
  const startedAt = Number(start?.time ?? 0);
  const endedAt = Number(end?.time ?? startedAt);
  if (![startX, startY, endX, endY, startedAt, endedAt].every(Number.isFinite)) return null;

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const distance = Math.abs(deltaX);
  if (distance < Math.max(1, Number(minDistance) || 0)) return null;
  if (Math.abs(deltaY) > distance * Math.max(0, Number(maxVerticalRatio) || 0)) return null;
  if (endedAt < startedAt || endedAt - startedAt > Math.max(1, Number(maxDurationMs) || 0)) return null;
  return deltaX < 0 ? "random" : "previous";
}

function dictionaryKey(value) {
  return normalizeWord(value).toLocaleLowerCase("cs-CZ");
}

function usableDictionarySenses(entry) {
  return (Array.isArray(entry?.senses) ? entry.senses : []).filter((sense) => {
    const gloss = String(sense?.gloss || "").trim();
    const tags = Array.isArray(sense?.tags) ? sense.tags : [];
    return gloss && !tags.some((tag) => String(tag).toLocaleLowerCase("en-US") === "form-of");
  });
}

function uniqueDictionaryValues(values, project = (value) => value) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const projected = String(project(value) || "").replace(/\s+/g, " ").trim();
    const key = projected.toLocaleLowerCase("en-US");
    if (!projected || seen.has(key)) continue;
    seen.add(key);
    result.push(projected);
  }
  return result;
}

export function selectDictionaryMeaning(payload, word, { maxGlosses = 2 } = {}) {
  const queryKey = dictionaryKey(word);
  if (!queryKey) return null;

  const candidates = (Array.isArray(payload?.results) ? payload.results : [])
    .map((entry, index) => {
      const lemmaKey = dictionaryKey(entry?.lemma);
      const matchedKey = dictionaryKey(entry?.matchedTerm);
      const senses = usableDictionarySenses(entry);
      const pos = String(entry?.pos || "").toLocaleLowerCase("en-US");
      let score = 0;
      if (lemmaKey === queryKey) score += 80;
      if (matchedKey === queryKey) score += 80;
      if (entry?.matchedBy === "form" && matchedKey === queryKey) score += 25;
      if (senses.length) score += 20;
      if (pos === "name" || pos === "proper noun" || pos === "proper-name") score -= 70;
      return { entry, index, score, senses };
    })
    .filter((candidate) => candidate.senses.length)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selected = candidates[0];
  if (!selected) return null;
  const seen = new Set();
  const glosses = [];
  for (const sense of selected.senses) {
    const gloss = String(sense.gloss || "").replace(/\s+/g, " ").trim();
    const key = gloss.toLocaleLowerCase("en-US");
    if (!gloss || seen.has(key)) continue;
    seen.add(key);
    glosses.push(gloss);
    if (glosses.length >= Math.max(1, maxGlosses)) break;
  }
  if (!glosses.length) return null;

  const matchedForm = (Array.isArray(selected.entry.forms) ? selected.entry.forms : [])
    .find((form) => dictionaryKey(form?.form) === queryKey);
  const senseTags = uniqueDictionaryValues(selected.senses.flatMap((sense) => sense?.tags || []))
    .filter((tag) => tag.toLocaleLowerCase("en-US") !== "form-of");
  const topics = uniqueDictionaryValues(selected.senses.flatMap((sense) => sense?.topics || []));
  const synonyms = uniqueDictionaryValues(
    selected.senses.flatMap((sense) => sense?.synonyms || []),
    (synonym) => typeof synonym === "string" ? synonym : synonym?.word || synonym?.text || synonym?.lemma
  );

  return {
    lemma: String(selected.entry.lemma || word),
    pos: String(selected.entry.pos || "word"),
    matchedBy: String(selected.entry.matchedBy || ""),
    matchedTerm: String(selected.entry.matchedTerm || ""),
    formTags: uniqueDictionaryValues(matchedForm?.tags || []),
    senseTags,
    topics,
    synonyms,
    glosses,
    meaning: glosses.join(" · ")
  };
}

export function tokenizeCzechSentence(sentence) {
  const text = String(sentence || "").normalize("NFC");
  const tokens = [];
  const pattern = /[\p{L}\p{M}]+(?:[-'][\p{L}\p{M}]+)?|\d+|[^\s]/gu;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const part = match[0];
    const isWord = /^[\p{L}\p{M}\d]/u.test(part);
    tokens.push({ type: isWord ? "word" : "punctuation", text: part });
  }
  return tokens;
}

export function stripModelEcho(text) {
  let value = String(text || "").replace(/\r/g, "\n").trim();
  value = value.replace(/<\|[^>]+?\|>/g, " ").replace(/\s+/g, " ").trim();

  const sentenceMarker = value.match(/(?:věta|veta|sentence)\s*:\s*(.+)$/iu);
  if (sentenceMarker) value = sentenceMarker[1].trim();

  value = value
    .replace(/^(?:[-*•]|\d+[.)])\s*/u, "")
    .replace(/^["'„“”]+|["'„“”]+$/gu, "")
    .trim();

  const firstSentence = value.match(/^[^.!?]+[.!?]/u);
  if (firstSentence) value = firstSentence[0].trim();
  return value;
}

const irregularTargetForms = Object.freeze({
  pes: ["psa", "psovi", "psem", "psi", "psy", "psů", "psům", "pse"],
  dům: ["domu", "domě", "domem", "domy", "domů", "domům"],
  den: ["dne", "dni", "dny", "dnů", "dnům", "dnem"],
  dítě: ["dítěte", "dítěti", "dítětem", "děti", "dětí", "dětem", "dětmi"],
  člověk: ["člověka", "člověku", "člověkem", "člověče", "lidé", "lidí", "lidem", "lidmi"],
  stůl: ["stolu", "stole", "stolem", "stoly", "stolů", "stolům"],
  přítel: ["přítele", "příteli", "přítelem", "přátelé", "přátel", "přátelům", "přáteli"],
  kočka: ["kočce"],
  ruka: ["ruce", "rukou"],
  kniha: ["knize"],
  práce: ["práci", "prací"]
});

const vowelEndingSuffixes = Object.freeze({
  a: /^(?:a|y|u|ou|e|ě|o|ám|ami|ách)$/u,
  o: /^(?:o|a|u|ě|em|y|ům|ech)$/u,
  e: /^(?:e|i|í|eho|emu|em|eti|ete|etem|mi)$/u,
  ě: /^(?:ě|i|í|eho|emu|em|eti|ete|etem|mi)$/u
});

const consonantEndingSuffix = /^(?:a|u|ovi|em|e|i|y|ů|ům|ech|ové|é|mi)$/u;

function matchesInflectedForm(candidate, target) {
  const token = normalizeWord(candidate).toLocaleLowerCase("cs-CZ");
  const lemma = normalizeWord(target).toLocaleLowerCase("cs-CZ");
  if (!token || !lemma) return false;
  if (token === lemma) return true;
  if (irregularTargetForms[lemma]?.includes(token)) return true;

  const finalLetter = lemma.slice(-1);
  const vowelSuffixPattern = vowelEndingSuffixes[finalLetter];
  if (vowelSuffixPattern) {
    const stem = lemma.slice(0, -1);
    return stem.length >= 2 && token.startsWith(stem) && vowelSuffixPattern.test(token.slice(stem.length));
  }

  return token.startsWith(lemma) && consonantEndingSuffix.test(token.slice(lemma.length));
}

export function wordMatchesTarget(candidate, target) {
  return matchesInflectedForm(candidate, target) || matchesInflectedForm(target, candidate);
}

export function sentenceIncludesWord(sentence, word) {
  return tokenizeCzechSentence(sentence)
    .filter((token) => token.type === "word")
    .some((token) => wordMatchesTarget(token.text, word));
}

export function cleanGeneratedSentence(output, word, fallbackSentence) {
  const cleaned = stripModelEcho(output);
  if (cleaned && sentenceIncludesWord(cleaned, word)) return cleaned;
  return fallbackSentence(word);
}

export function cleanTranslation(output) {
  let value = String(output || "").replace(/\r/g, "\n").trim();
  value = value.replace(/<\|[^>]+?\|>/g, " ").replace(/\s+/g, " ").trim();
  const marker = value.match(/(?:english|translation)\s*:\s*(.+)$/iu);
  if (marker) value = marker[1].trim();
  value = value.replace(/^["'“”]+|["'“”]+$/gu, "").trim();
  const firstSentence = value.match(/^[^.!?]+[.!?]/u);
  return (firstSentence ? firstSentence[0] : value).trim();
}

export function sentenceFingerprint(sentence) {
  return tokenizeCzechSentence(sentence)
    .filter((token) => token.type === "word")
    .map((token) => normalizeWord(token.text).toLocaleLowerCase("cs-CZ"))
    .filter(Boolean)
    .join(" ");
}

export function sentenceSimilarity(leftSentence, rightSentence) {
  const left = new Set(sentenceFingerprint(leftSentence).split(" ").filter(Boolean));
  const right = new Set(sentenceFingerprint(rightSentence).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return (2 * shared) / (left.size + right.size);
}

export function isRecentSentence(sentence, recentSentences, similarityThreshold = 0.82) {
  const fingerprint = sentenceFingerprint(sentence);
  if (!fingerprint) return false;
  const candidateWordCount = fingerprint.split(" ").length;
  return (Array.isArray(recentSentences) ? recentSentences : []).some((recent) => {
    const recentFingerprint = sentenceFingerprint(recent);
    if (!recentFingerprint) return false;
    if (fingerprint === recentFingerprint) return true;
    if (candidateWordCount < 4 || recentFingerprint.split(" ").length < 4) return false;
    return sentenceSimilarity(sentence, recent) >= similarityThreshold;
  });
}

export function isPlausibleSentence(sentence) {
  const text = String(sentence || "").trim();
  const words = tokenizeCzechSentence(text).filter((token) => token.type === "word");
  if (text.length < 5 || text.length > 180 || words.length < 2 || words.length > 24) return false;
  if (/(?:https?:\/\/|www\.|<\|)/iu.test(text)) return false;
  const normalizedWords = words.map((token) => normalizeWord(token.text).toLocaleLowerCase("cs-CZ"));
  for (let index = 2; index < normalizedWords.length; index += 1) {
    if (normalizedWords[index] === normalizedWords[index - 1] && normalizedWords[index] === normalizedWords[index - 2]) {
      return false;
    }
  }
  return true;
}

export function sentenceTargets(sentence, { exclude = [], limit = 8 } = {}) {
  const excluded = new Set((Array.isArray(exclude) ? exclude : [exclude])
    .map((word) => normalizeWord(word).toLocaleLowerCase("cs-CZ"))
    .filter(Boolean));
  const seen = new Set();
  const result = [];
  for (const token of tokenizeCzechSentence(sentence)) {
    if (token.type !== "word") continue;
    const word = normalizeWord(token.text);
    const key = word.toLocaleLowerCase("cs-CZ");
    if (word.length < 2 || excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(word);
    if (result.length >= Math.max(0, limit)) break;
  }
  return result;
}

export function dotProduct(left, right) {
  const count = Math.min(left?.length || 0, right?.length || 0);
  let score = 0;
  for (let index = 0; index < count; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

export function normalizeAssetPath(assetPath) {
  const value = String(assetPath || "").trim();
  if (value.startsWith("/assets/")) return value;
  if (value.startsWith("assets/")) return `/${value}`;
  return "";
}

export function isMiscellaneousAssetPath(assetPath) {
  return normalizeAssetPath(assetPath).startsWith("/assets/miscellaneous/");
}

export function parseSceneKeymap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw).map(([assetPath, metadata]) => {
    const normalizedPath = normalizeAssetPath(assetPath);
    const description = String(metadata?.description || "").trim();
    if (!normalizedPath || !description) return null;
    return {
      assetPath: normalizedPath,
      description,
      category: String(metadata?.category || "").trim()
    };
  }).filter(Boolean);
}
