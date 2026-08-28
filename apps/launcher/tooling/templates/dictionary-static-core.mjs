export const STATIC_DICTIONARY_PROFILE = Object.freeze({
  schemaVersion: 1,
  profile: "web-static-core",
  direction: "cs-en"
});

export function normalizeStaticDictionarySearch(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("cs-CZ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function exactDictionaryKey(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("cs-CZ");
}

function clampLimit(value) {
  const limit = Number(value || 12);
  if (!Number.isFinite(limit)) return 12;
  return Math.max(1, Math.min(60, Math.trunc(limit)));
}

function cleanList(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || "").trim();
    const key = text.toLocaleLowerCase("cs-CZ");
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function indexedRow(row, index) {
  const fields = {
    cs: normalizeStaticDictionarySearch(row?.cs),
    en: normalizeStaticDictionarySearch(row?.en),
    cat: normalizeStaticDictionarySearch(row?.cat),
    kind: normalizeStaticDictionarySearch(row?.kind),
    cue: normalizeStaticDictionarySearch(row?.cue),
    use: normalizeStaticDictionarySearch(row?.use)
  };
  return {
    row,
    index,
    fields,
    searchText: Object.values(fields).join(" ")
  };
}

function groupedRows(rows) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const indexed = indexedRow(row, index);
    const key = `${indexed.fields.cs}\u0000${indexed.fields.kind}`;
    const group = groups.get(key) || { index, rows: [] };
    group.rows.push(indexed);
    groups.set(key, group);
  });
  return [...groups.values()];
}

export function countStaticDictionaryEntries(rows) {
  if (!Array.isArray(rows)) throw new TypeError("Static dictionary rows must be an array.");
  return groupedRows(rows).length;
}

function matchScore(indexed, query) {
  const { fields, searchText } = indexed;
  if (fields.cs === query) return 0;
  if (fields.en === query) return 1;
  if (fields.cs.startsWith(query)) return 2;
  if (fields.en.startsWith(query)) return 3;
  if (fields.cue === query || fields.kind === query || fields.cat === query) return 4;
  if (searchText.includes(query)) return 5;
  return Number.POSITIVE_INFINITY;
}

function resultFromGroup(group, query) {
  const first = group.rows[0];
  const senses = new Map();
  for (const { row } of group.rows) {
    const gloss = String(row?.en || "").trim();
    const key = normalizeStaticDictionarySearch(gloss);
    const current = senses.get(key) || {
      gloss,
      rawGloss: "",
      tags: [],
      topics: [],
      synonyms: [],
      antonyms: [],
      examples: []
    };
    current.tags = cleanList([...current.tags, row?.cat, row?.kind, row?.cue]);
    const example = String(row?.use || "").trim();
    if (example && !current.examples.some((item) => item.text === example)) {
      current.examples.push({ text: example, english: "", tags: [] });
    }
    senses.set(key, current);
  }
  return {
    id: `core-${group.index + 1}`,
    lemma: String(first.row?.cs || "").trim(),
    pos: String(first.row?.kind || "word").trim() || "word",
    matchedBy: group.rows.some(({ fields }) => fields.cs === query) ? "lemma" : "core",
    matchedTerm: String(first.row?.cs || "").trim(),
    forms: [],
    senses: [...senses.values()]
  };
}

export function searchStaticDictionary(rows, query, options = {}) {
  if (!Array.isArray(rows)) throw new TypeError("Static dictionary rows must be an array.");
  const normalizedQuery = normalizeStaticDictionarySearch(query);
  const limit = clampLimit(options.limit);
  if (!normalizedQuery) {
    return {
      query: String(query || ""),
      normalizedQuery,
      direction: STATIC_DICTIONARY_PROFILE.direction,
      returned: 0,
      limit,
      results: []
    };
  }

  const matches = groupedRows(rows)
    .map((group) => ({
      group,
      score: Math.min(...group.rows.map((indexed) => matchScore(indexed, normalizedQuery)))
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => left.score - right.score || left.group.index - right.group.index)
    .slice(0, limit)
    .map(({ group }) => resultFromGroup(group, normalizedQuery));

  return {
    query: String(query || ""),
    normalizedQuery,
    direction: STATIC_DICTIONARY_PROFILE.direction,
    returned: matches.length,
    limit,
    results: matches
  };
}

function resultMatchesExactSurface(entry, query) {
  const key = exactDictionaryKey(query);
  if (!key) return false;
  return [
    entry?.lemma,
    entry?.matchedTerm,
    ...(Array.isArray(entry?.forms) ? entry.forms.map((form) => form?.form) : [])
  ].some((value) => exactDictionaryKey(value) === key);
}

export function searchStaticDictionaryWithSupplement(rows, supplement, query, options = {}) {
  const core = searchStaticDictionary(rows, query, options);
  if (!core.normalizedQuery) return core;
  const supplemental = Array.isArray(supplement?.entries?.[core.normalizedQuery])
    ? supplement.entries[core.normalizedQuery].filter((entry) => resultMatchesExactSurface(entry, query))
    : [];
  if (supplemental.length === 0) return core;
  const coreHasExact = core.results.some((entry) => resultMatchesExactSurface(entry, query));
  const candidates = coreHasExact
    ? [...core.results, ...supplemental]
    : [...supplemental, ...core.results];
  const seen = new Set();
  const results = [];
  for (const entry of candidates) {
    const key = String(entry?.id || `${exactDictionaryKey(entry?.lemma)}\u0000${exactDictionaryKey(entry?.pos)}`);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(entry);
    if (results.length >= core.limit) break;
  }
  return { ...core, returned: results.length, results };
}

function abortError() {
  const error = new Error("Static dictionary search was aborted.");
  error.name = "AbortError";
  return error;
}

export function createStaticDictionaryApi(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  const dataUrl = options.dataUrl
    || new URL("../../../data/games/verb-nebula/core-vocabulary.json", import.meta.url).href;
  const supplementUrl = options.supplementUrl
    || new URL("../../../data/games/word-world/static-dictionary.v1.json", import.meta.url).href;
  let dataPromise = null;

  function loadData() {
    if (!dataPromise) {
      if (typeof fetchImpl !== "function") throw new Error("Browser fetch is unavailable.");
      const fetchJson = (url, label) => fetchImpl(url, { cache: "force-cache" })
        .then((response) => {
          if (!response.ok) throw new Error(`Static dictionary returned HTTP ${response.status}.`);
          return response.json();
        })
        .then((value) => {
          if (!value) throw new Error(`${label} is empty or invalid.`);
          return value;
        });
      dataPromise = Promise.all([
        options.rows ? Promise.resolve(options.rows) : fetchJson(dataUrl, "Static dictionary data"),
        options.supplement ? Promise.resolve(options.supplement) : fetchJson(supplementUrl, "Static Word World dictionary supplement")
      ])
        .then(([rows, supplement]) => {
          if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error("Static dictionary data is empty or invalid.");
          }
          if (
            supplement?.schema_name !== "caatuu-static-word-world-dictionary"
            || supplement?.schema_version !== 1
            || !supplement.entries
          ) {
            throw new Error("Static Word World dictionary supplement is invalid.");
          }
          return { rows, supplement };
        })
        .catch((error) => {
          dataPromise = null;
          throw error;
        });
    }
    return dataPromise;
  }

  function statusFromData(rows, supplement) {
    return {
      available: true,
      downloadRequired: false,
      fullDictionary: false,
      profile: STATIC_DICTIONARY_PROFILE.profile,
      recordCount: rows.length,
      entryCount: countStaticDictionaryEntries(rows),
      standardSurfaceCount: Number(supplement.surface_count || 0),
      standardResolvedSurfaceCount: Number(supplement.resolved_surface_count || 0),
      bytes: 0,
      expectedBytes: 0
    };
  }

  return Object.freeze({
    async status() {
      const { rows, supplement } = await loadData();
      return statusFromData(rows, supplement);
    },
    async download(handlers = {}) {
      const { rows, supplement } = await loadData();
      handlers.onEvent?.({ kind: "status", phase: "static_ready", message: "Static dictionary is already available." });
      return statusFromData(rows, supplement);
    },
    async search(query, searchOptions = {}) {
      if (searchOptions.signal?.aborted) throw abortError();
      const { rows, supplement } = await loadData();
      if (searchOptions.signal?.aborted) throw abortError();
      return searchStaticDictionaryWithSupplement(rows, supplement, query, searchOptions);
    }
  });
}
