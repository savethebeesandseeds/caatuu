// Pure helpers for the single authored meaning/category/form journey.
const TOKEN_CHARACTER = /[\p{L}\p{M}\p{N}\p{Pc}'’ʼ-]/u;
export const GRAMMAR_JOURNEY_CONTRACT = "caatuu-grammar-gravity-journey-v1";
const STAGE_ORDER = ["meaning", "category", "form"];

function text(value, location) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${location} must be a non-empty string.`);
  return value;
}

export function validateGrammarStages(stages) {
  if (!Array.isArray(stages) || !stages.length || stages.at(-1) !== "form"
      || stages.some((stage, index) => !STAGE_ORDER.includes(stage)
        || (index > 0 && STAGE_ORDER.indexOf(stage) <= STAGE_ORDER.indexOf(stages[index - 1])))) {
    throw new Error("Grammar journey stages must be an ordered, unique subset of meaning, category, form ending in form.");
  }
  return stages;
}

export function shuffledGrammarValues(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const value = Number(random());
    const bounded = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999999) : 0;
    const other = Math.floor(bounded * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function containsGrammarAnchor(container, anchor, contextBefore = "", contextAfter = "") {
  if (typeof container !== "string" || typeof anchor !== "string" || !anchor.trim()) return false;
  let from = 0;
  while (from <= container.length - anchor.length) {
    const start = container.indexOf(anchor, from);
    if (start < 0) return false;
    const end = start + anchor.length;
    const previous = Array.from(container.slice(0, start)).at(-1) || Array.from(contextBefore).at(-1) || "";
    const next = Array.from(container.slice(end))[0] || Array.from(contextAfter)[0] || "";
    if (!TOKEN_CHARACTER.test(previous) && !TOKEN_CHARACTER.test(next)) return true;
    from = start + anchor.length;
  }
  return false;
}

export function buildMeaningChoices(answer, pool, count = 3, random = Math.random) {
  text(answer, "Meaning answer");
  if (![3, 6].includes(count)) throw new Error("Meaning option count must be 3 or 6.");
  if (!Array.isArray(pool) || pool.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("Meaning pool must contain authored learner-base meanings.");
  }
  const key = (value) => value.normalize("NFC").trim().toLowerCase();
  const meanings = [...new Map(pool.map((value) => [key(value), value])).values()];
  if (!pool.includes(answer) || meanings.length < 2) {
    throw new Error("Meaning pool must include the answer and at least one distinct authored distractor.");
  }
  const others = shuffledGrammarValues(meanings.filter((value) => key(value) !== key(answer)), random).slice(0, count - 1);
  return shuffledGrammarValues([answer, ...others], random);
}

export function validateGrammarFlight(flight) {
  if (!flight || typeof flight !== "object" || Array.isArray(flight)) throw new Error("Grammar flight must be an object.");
  for (const field of ["id", "anchorText", "anchorMeaning", "anchorEnglishAuditText", "targetText", "learnerBaseText", "answer", "categoryId"]) {
    text(flight[field], `Grammar flight.${field}`);
  }
  validateGrammarStages(flight.stages);
  if (typeof flight.beforeText !== "string" || typeof flight.afterText !== "string"
      || flight.beforeText + flight.answer + flight.afterText !== flight.targetText) {
    throw new Error("Grammar flight phrase slot must reproduce its exact authored targetText.");
  }
  if (!containsGrammarAnchor(flight.beforeText, flight.anchorText, "", flight.answer + flight.afterText)
      && !containsGrammarAnchor(flight.afterText, flight.anchorText, flight.beforeText + flight.answer, "")) {
    throw new Error("Grammar flight anchor must occur as complete tokens outside the form slot.");
  }
  if (!Array.isArray(flight.options) || flight.options.length < 2 || new Set(flight.options).size !== flight.options.length
      || flight.options.some((option) => typeof option !== "string" || !option.trim()) || !flight.options.includes(flight.answer)) {
    throw new Error("Grammar flight must have at least two distinct form options including its authored answer.");
  }
  if (!Array.isArray(flight.categoryOptions) || flight.categoryOptions.length < 2
      || flight.categoryOptions.some((option) => !option || typeof option.id !== "string" || !option.id.trim()
        || typeof option.label !== "string" || !option.label.trim())
      || new Set(flight.categoryOptions.map(({ id }) => id)).size !== flight.categoryOptions.length
      || !flight.categoryOptions.some(({ id }) => id === flight.categoryId)) {
    throw new Error("Grammar flight must declare unique labeled category options including its category.");
  }
  if (flight.stages.includes("meaning")) {
    buildMeaningChoices(flight.anchorMeaning, flight.meaningPool);
    if (!Array.isArray(flight.meaningOptions) || flight.meaningOptions.length < 2
        || new Set(flight.meaningOptions).size !== flight.meaningOptions.length
        || !flight.meaningOptions.includes(flight.anchorMeaning)
        || flight.meaningOptions.some((option) => !flight.meaningPool.includes(option))) {
      throw new Error("Grammar flight meaning options must come from the authored pool and include its answer and a distractor.");
    }
  }
  return flight;
}

export function grammarFeedbackDuration(correct) {
  return correct ? 900 : 2400;
}

export function highlightedFormParts(form, options) {
  const value = String(form ?? "");
  const forms = [...new Set([...(options || []), value])];
  if (!forms.length || forms.some((entry) => typeof entry !== "string" || !entry)) return { stem: "", ending: value };
  // Graphemes keep accents and surrogate pairs intact at the highlighted boundary.
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const segments = forms.map((entry) => Array.from(segmenter.segment(entry), ({ segment }) => segment));
  let length = 0;
  while (segments[0][length] !== undefined && segments.every((entry) => entry[length] === segments[0][length])) length += 1;
  const stem = segments[0].slice(0, length).join("");
  return { stem, ending: value.slice(stem.length) };
}
