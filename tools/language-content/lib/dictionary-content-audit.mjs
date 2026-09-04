import {
  assertValidLanguageAdapter,
  presentDictionaryEntry
} from "../../../apps/language-runtime/contract.mjs";

const ENGLISH_AUDIT_LANGUAGE = "en";

export function auditDictionaryContentDocuments({
  adapter,
  catalog,
  coreEntries,
  scripts,
  sourceLanguageId,
  targetLanguageId,
  targetLanguageLocale,
  targetLanguageScript = null
}) {
  const issues = [];
  try {
    assertValidLanguageAdapter(adapter);
  } catch (error) {
    return [{ code: "dictionary.adapter", message: error.message ?? String(error) }];
  }

  const normalizedTarget = normalizeLanguageId(targetLanguageId);
  const canonicalTargetLocale = canonicalLanguageTag(targetLanguageLocale);
  const adapterPrimary = normalizeLanguageId(adapter.languageTags?.primary);
  const adapterLocale = canonicalLanguageTag(adapter.languageTags?.locale);
  if (!normalizedTarget || adapterPrimary !== normalizedTarget || adapterLocale !== canonicalTargetLocale) {
    issues.push({
      code: "dictionary.language",
      message: `Dictionary adapter language ${adapter.languageTags?.locale || adapter.languageTags?.primary || "<missing>"} does not match target locale ${targetLanguageLocale || "<missing>"}.`
    });
  }
  if (targetLanguageScript && scriptForLanguageTag(adapterLocale) !== targetLanguageScript) {
    issues.push({
      code: "dictionary.language",
      message: `Dictionary adapter script must match target script ${targetLanguageScript}.`
    });
  }

  validateProviderCatalog(catalog, {
    targetLanguageId: normalizedTarget,
    targetLanguageLocale: canonicalTargetLocale
  }, issues);
  validateRecordArray(coreEntries, "dictionary core entries", adapter, {
    sourceLanguageId,
    targetLanguageId
  }, issues);

  if (!Array.isArray(scripts) || scripts.length === 0) {
    issues.push({
      code: "dictionary.records",
      message: "Dictionary scripts must contain at least one script."
    });
  } else {
    scripts.forEach((script, scriptIndex) => validateRecordArray(
      script?.lines,
      `dictionary scripts[${scriptIndex}].lines`,
      adapter,
      { sourceLanguageId, targetLanguageId, scriptIndex },
      issues
    ));
  }
  return issues;
}

function validateProviderCatalog(catalog, { targetLanguageId, targetLanguageLocale }, issues) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)
      || !Array.isArray(catalog.dictionaries) || catalog.dictionaries.length === 0) {
    issues.push({
      code: "dictionary.catalog",
      message: "Dictionary catalog must contain at least one provider."
    });
    return;
  }
  const active = catalog.dictionaries.find(({ key }) => key === catalog.default_dictionary);
  if (!active || active.status !== "active") {
    issues.push({
      code: "dictionary.catalog",
      message: "Dictionary default_dictionary must resolve to an active provider."
    });
    return;
  }
  if (normalizeLanguageId(active.lookupLanguage) !== targetLanguageId) {
    issues.push({
      code: "dictionary.language",
      message: `Dictionary lookupLanguage must match target language ${targetLanguageId}.`
    });
  }
  if (canonicalLanguageTag(active.lookupLanguageTag) !== targetLanguageLocale) {
    issues.push({
      code: "dictionary.language",
      message: `Dictionary lookupLanguageTag must match target locale ${targetLanguageLocale}.`
    });
  }
  if (normalizeLanguageId(active.meaningLanguage) !== ENGLISH_AUDIT_LANGUAGE) {
    issues.push({
      code: "dictionary.language",
      message: "Dictionary meaningLanguage must remain en for retrieval and audit."
    });
  }
  if (canonicalLanguageTag(active.meaningLanguageTag) !== ENGLISH_AUDIT_LANGUAGE) {
    issues.push({
      code: "dictionary.language",
      message: "Dictionary meaningLanguageTag must remain en for retrieval and audit."
    });
  }
}

function canonicalLanguageTag(value) {
  try {
    return Intl.getCanonicalLocales(String(value || "").trim().replaceAll("_", "-"))[0] || "";
  } catch {
    return "";
  }
}

function scriptForLanguageTag(value) {
  try {
    return new Intl.Locale(value).maximize().script || "";
  } catch {
    return "";
  }
}

function validateRecordArray(records, label, adapter, context, issues) {
  if (!Array.isArray(records) || records.length === 0) {
    issues.push({
      code: "dictionary.records",
      message: `${label} must contain at least one record.`
    });
    return;
  }
  records.forEach((record, recordIndex) => {
    try {
      presentDictionaryEntry(adapter, record, { ...context, recordIndex });
    } catch (error) {
      issues.push({
        code: "dictionary.presentation",
        message: `${label}[${recordIndex}] does not produce mandatory target and English audit text: ${error.message ?? String(error)}`
      });
    }
  });
}

function normalizeLanguageId(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-US")
    .split("-", 1)[0];
}
