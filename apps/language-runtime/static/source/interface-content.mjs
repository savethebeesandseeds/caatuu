export const INTERFACE_CONTENT_SCHEMA = "https://caatuu.org/schemas/interface-content.v1.schema.json";
export const INTERFACE_CONTENT_SCHEMA_VERSION = 1;

const CATALOG_KEYS = Object.freeze([
  "$schema",
  "schemaVersion",
  "locale",
  "direction",
  "revision",
  "messages"
]);
const DIRECTIONS = new Set(["ltr", "rtl"]);
const PLURAL_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);
const MESSAGE_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u;
const REVISION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PLACEHOLDER_PATTERN = /\{([a-z][a-zA-Z0-9]*)\}/gu;
const LOCALIZABLE_ATTRIBUTES = Object.freeze({
  "data-i18n-aria-description": "aria-description",
  "data-i18n-aria-label": "aria-label",
  "data-i18n-aria-valuetext": "aria-valuetext",
  "data-i18n-placeholder": "placeholder",
  "data-i18n-title": "title"
});

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, location, errors) {
  if (!isRecord(value)) {
    errors.push(`${location} must be an object.`);
    return false;
  }
  const actual = Object.keys(value);
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) errors.push(`${location} is missing ${key}.`);
  }
  for (const key of actual) {
    if (!expected.includes(key)) errors.push(`${location} contains unsupported key ${key}.`);
  }
  return true;
}

function canonicalLocale(value, location, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${location} must be a non-empty BCP 47 locale.`);
    return "";
  }
  try {
    return Intl.getCanonicalLocales(value.trim())[0];
  } catch {
    errors.push(`${location} must be a valid BCP 47 locale.`);
    return "";
  }
}

function placeholderNames(template) {
  return [...new Set(
    [...String(template).matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1])
  )].sort();
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateTemplate(value, location, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${location} must be a non-empty string.`);
    return [];
  }
  return placeholderNames(value);
}

function validateMessage(value, location, errors) {
  if (typeof value === "string") {
    validateTemplate(value, location, errors);
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${location} must be a string or plural-category object.`);
    return;
  }
  const categories = Object.keys(value);
  if (!categories.includes("other")) errors.push(`${location} plural messages require other.`);
  if (categories.length === 0) errors.push(`${location} plural messages cannot be empty.`);
  let expectedPlaceholders = null;
  for (const category of categories) {
    if (!PLURAL_CATEGORIES.has(category)) {
      errors.push(`${location} contains unsupported plural category ${category}.`);
      continue;
    }
    const placeholders = validateTemplate(value[category], `${location}.${category}`, errors);
    if (expectedPlaceholders === null) expectedPlaceholders = placeholders;
    else if (!sameStringArray(placeholders, expectedPlaceholders)) {
      errors.push(`${location}.${category} must use the same placeholders as the other plural forms.`);
    }
  }
}

export function validateInterfaceCatalog(value, expected = {}) {
  const errors = [];
  if (!exactKeys(value, CATALOG_KEYS, "Interface catalog", errors)) {
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }
  if (value.$schema !== INTERFACE_CONTENT_SCHEMA) {
    errors.push(`Interface catalog $schema must be ${INTERFACE_CONTENT_SCHEMA}.`);
  }
  if (value.schemaVersion !== INTERFACE_CONTENT_SCHEMA_VERSION) {
    errors.push(`Interface catalog schemaVersion must be ${INTERFACE_CONTENT_SCHEMA_VERSION}.`);
  }
  const locale = canonicalLocale(value.locale, "Interface catalog locale", errors);
  const expectedLocale = expected.locale === undefined
    ? ""
    : canonicalLocale(expected.locale, "Expected interface locale", errors);
  if (locale && expectedLocale && locale !== expectedLocale) {
    errors.push(`Interface catalog locale ${locale} does not match ${expectedLocale}.`);
  }
  if (!DIRECTIONS.has(value.direction)) {
    errors.push("Interface catalog direction must be ltr or rtl.");
  }
  if (expected.direction !== undefined && value.direction !== expected.direction) {
    errors.push(`Interface catalog direction ${value.direction} does not match ${expected.direction}.`);
  }
  if (typeof value.revision !== "string" || !REVISION_PATTERN.test(value.revision)) {
    errors.push("Interface catalog revision must be a lowercase cache revision.");
  }
  if (expected.revision !== undefined && value.revision !== expected.revision) {
    errors.push(`Interface catalog revision ${value.revision} does not match ${expected.revision}.`);
  }
  if (!isRecord(value.messages) || Object.keys(value.messages).length === 0) {
    errors.push("Interface catalog messages must be a non-empty object.");
  } else {
    for (const [id, message] of Object.entries(value.messages)) {
      if (!MESSAGE_ID_PATTERN.test(id)) {
        errors.push(`Interface message ID ${id} must be a stable dot-separated lowercase identifier.`);
      }
      validateMessage(message, `Interface message ${id}`, errors);
    }
  }
  if (Array.isArray(expected.messageIds)) {
    const expectedIds = [...new Set(expected.messageIds)].sort();
    const actualIds = isRecord(value.messages) ? Object.keys(value.messages).sort() : [];
    for (const id of expectedIds) {
      if (!Object.hasOwn(value.messages || {}, id)) errors.push(`Interface catalog is missing required message ${id}.`);
    }
    for (const id of actualIds) {
      if (!expectedIds.includes(id)) errors.push(`Interface catalog contains unexpected message ${id}.`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function messageSignature(value) {
  return Object.freeze({
    kind: typeof value === "string" ? "text" : "plural",
    placeholders: Object.freeze(placeholderNames(
      typeof value === "string" ? value : value?.other ?? ""
    ))
  });
}

/**
 * Requires a translated catalog to expose the exact same callable message API
 * as the English authority. Plural languages may add locale-specific plural
 * categories, but message kind and named parameters cannot drift.
 */
export function validateInterfaceCatalogParity(authority, candidate) {
  const errors = [];
  const authorityResult = validateInterfaceCatalog(authority);
  const candidateResult = validateInterfaceCatalog(candidate);
  if (!authorityResult.valid) {
    errors.push(...authorityResult.errors.map((error) => `Interface authority: ${error}`));
  }
  if (!candidateResult.valid) {
    errors.push(...candidateResult.errors.map((error) => `Interface translation: ${error}`));
  }
  if (!authorityResult.valid || !candidateResult.valid) {
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }

  const authorityIds = Object.keys(authority.messages).sort();
  const candidateIds = Object.keys(candidate.messages).sort();
  for (const id of authorityIds) {
    if (!Object.hasOwn(candidate.messages, id)) {
      errors.push(`Interface translation is missing authority message ${id}.`);
    }
  }
  for (const id of candidateIds) {
    if (!Object.hasOwn(authority.messages, id)) {
      errors.push(`Interface translation contains unknown message ${id}.`);
    }
  }
  for (const id of authorityIds.filter((messageId) => Object.hasOwn(candidate.messages, messageId))) {
    const expected = messageSignature(authority.messages[id]);
    const actual = messageSignature(candidate.messages[id]);
    if (actual.kind !== expected.kind) {
      errors.push(`Interface message ${id} must remain ${expected.kind}, not ${actual.kind}.`);
    }
    if (!sameStringArray(actual.placeholders, expected.placeholders)) {
      errors.push(
        `Interface message ${id} placeholders must be exactly ${expected.placeholders.join(", ") || "none"}.`
      );
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function freezeMessage(value) {
  return typeof value === "string" ? value : Object.freeze({ ...value });
}

function formatTemplate(template, parameters, messageId) {
  const required = placeholderNames(template);
  for (const name of required) {
    if (!Object.hasOwn(parameters, name) || parameters[name] === undefined || parameters[name] === null) {
      throw new TypeError(`Interface message ${messageId} requires placeholder ${name}.`);
    }
  }
  return template.replace(PLACEHOLDER_PATTERN, (_match, name) => String(parameters[name]));
}

export function createInterfaceContent(catalog, expected = {}) {
  const result = validateInterfaceCatalog(catalog, expected);
  if (!result.valid) throw new TypeError(result.errors.join("\n"));
  const locale = Intl.getCanonicalLocales(catalog.locale)[0];
  const messages = Object.freeze(Object.fromEntries(
    Object.entries(catalog.messages).map(([id, value]) => [id, freezeMessage(value)])
  ));
  const pluralRules = new Intl.PluralRules(locale);
  let languageDisplayNames = null;
  if (typeof Intl.DisplayNames === "function") {
    try {
      languageDisplayNames = new Intl.DisplayNames([locale], {
        type: "language",
        fallback: "none"
      });
    } catch {
      languageDisplayNames = null;
    }
  }
  const api = {
    schemaVersion: INTERFACE_CONTENT_SCHEMA_VERSION,
    locale,
    direction: catalog.direction,
    revision: catalog.revision,
    has(messageId) {
      return Object.hasOwn(messages, String(messageId || ""));
    },
    languageName(language) {
      const descriptor = isRecord(language) ? language : {};
      const declaredTag = String(
        typeof language === "string"
          ? language
          : descriptor.locale || descriptor.id || ""
      ).trim();
      if (declaredTag) {
        try {
          const canonicalTag = Intl.getCanonicalLocales(declaredTag)[0];
          const languageParts = canonicalTag
            .toLocaleLowerCase("en-US")
            .split("-");
          const catalogIds = languageParts.map((_, index) => (
            `languages.${languageParts.slice(0, languageParts.length - index).join(".")}`
          ));
          for (const messageId of catalogIds) {
            if (Object.hasOwn(messages, messageId) && typeof messages[messageId] === "string") {
              return formatTemplate(messages[messageId], {}, messageId);
            }
          }
          const localizedName = languageDisplayNames?.of(canonicalTag);
          if (typeof localizedName === "string" && localizedName.trim()) return localizedName.trim();
        } catch {
          // Invalid or private course identifiers fall through to declared copy.
        }
      }
      return String(
        descriptor.label
        || descriptor.nativeLabel
        || descriptor.id
        || descriptor.locale
        || (typeof language === "string" ? language : "")
      ).trim();
    },
    t(messageId, parameters = {}) {
      const id = String(messageId || "");
      if (!Object.hasOwn(messages, id)) throw new RangeError(`Unknown interface message: ${id}.`);
      if (!isRecord(parameters)) throw new TypeError(`Interface message ${id} parameters must be an object.`);
      const message = messages[id];
      if (typeof message === "string") return formatTemplate(message, parameters, id);
      const count = Number(parameters.count);
      if (!Number.isFinite(count)) throw new TypeError(`Plural interface message ${id} requires a finite count.`);
      const category = pluralRules.select(count);
      return formatTemplate(message[category] ?? message.other, { ...parameters, count }, id);
    },
    apply(root = globalThis.document) {
      if (!root || typeof root.querySelectorAll !== "function") {
        throw new TypeError("Interface content requires a DOM root.");
      }
      const selector = ["[data-i18n]", ...Object.keys(LOCALIZABLE_ATTRIBUTES).map((name) => `[${name}]`)].join(",");
      const candidates = [
        ...(typeof root.matches === "function" && root.matches(selector) ? [root] : []),
        ...root.querySelectorAll(selector)
      ];
      for (const element of [...new Set(candidates)]) {
        const textId = element.getAttribute?.("data-i18n");
        if (textId) element.textContent = api.t(textId);
        for (const [marker, attribute] of Object.entries(LOCALIZABLE_ATTRIBUTES)) {
          const messageId = element.getAttribute?.(marker);
          if (messageId) element.setAttribute(attribute, api.t(messageId));
        }
      }
      return candidates.length;
    }
  };
  return Object.freeze(api);
}

function confinedInterfaceCatalogUrl(value, origin) {
  const url = new URL(String(value || ""), origin);
  if (url.origin !== origin || !/^\/language-runtime\/static\/data\/interface\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/u.test(url.pathname)) {
    throw new TypeError("Interface catalog URL must be a same-origin shared interface JSON file.");
  }
  return url;
}

export async function loadInterfaceContent(course, {
  fetchImpl = globalThis.fetch,
  origin = globalThis.location?.origin
} = {}) {
  if (!isRecord(course?.interfaceContent)) {
    throw new TypeError("Course profile must declare interfaceContent.");
  }
  if (course.interfaceContent.schemaVersion !== INTERFACE_CONTENT_SCHEMA_VERSION) {
    throw new TypeError(
      `Course interfaceContent schemaVersion must be ${INTERFACE_CONTENT_SCHEMA_VERSION}.`
    );
  }
  if (typeof fetchImpl !== "function") throw new TypeError("Interface content requires fetch.");
  const expectedLocale = canonicalLocale(course.sourceLanguage?.locale, "Course source locale", []);
  const interfaceLocale = canonicalLocale(course.interfaceContent.locale, "Course interface locale", []);
  if (!expectedLocale || interfaceLocale !== expectedLocale) {
    throw new Error("Course interface locale must equal its learner-base locale.");
  }
  if (course.interfaceContent.direction !== course.sourceLanguage?.direction) {
    throw new Error("Course interface direction must equal its learner-base direction.");
  }
  const baseOrigin = new URL(String(origin || "https://caatuu.invalid")).origin;
  const catalogUrl = confinedInterfaceCatalogUrl(course.interfaceContent.catalog, baseOrigin);
  if (course.interfaceContent.revision) {
    catalogUrl.searchParams.set("v", course.interfaceContent.revision);
  }
  const response = await fetchImpl(catalogUrl.href, {
    cache: "no-cache",
    credentials: "same-origin"
  });
  if (!response?.ok) {
    throw new Error(`Interface catalog request failed with status ${response?.status ?? "unknown"}.`);
  }
  const catalog = await response.json();
  return createInterfaceContent(catalog, {
    locale: interfaceLocale,
    direction: course.interfaceContent.direction,
    revision: course.interfaceContent.revision
  });
}

export function installInterfaceContent(content, globalScope = globalThis) {
  if (
    !content
    || content.schemaVersion !== INTERFACE_CONTENT_SCHEMA_VERSION
    || typeof content.t !== "function"
    || typeof content.apply !== "function"
    || typeof content.languageName !== "function"
  ) {
    throw new TypeError("Cannot install invalid interface content.");
  }
  Object.defineProperty(globalScope, "CaatuuI18n", {
    configurable: true,
    enumerable: true,
    value: content,
    writable: false
  });
  return content;
}
