import assert from "node:assert/strict";
import test from "node:test";

import {
  INTERFACE_CONTENT_SCHEMA,
  createInterfaceContent,
  installInterfaceContent,
  loadInterfaceContent,
  validateInterfaceCatalog,
  validateInterfaceCatalogParity
} from "../static/source/interface-content.mjs";

function catalog(overrides = {}) {
  return {
    $schema: INTERFACE_CONTENT_SCHEMA,
    schemaVersion: 1,
    locale: "en",
    direction: "ltr",
    revision: "interface-en-1",
    messages: {
      "action.continue": "Continue",
      "course.welcome": "Welcome to {course}",
      "progress.activity": {
        one: "{count} activity",
        other: "{count} activities"
      }
    },
    ...overrides
  };
}

test("validates a versioned interface catalog and rejects malformed messages", () => {
  assert.deepEqual(validateInterfaceCatalog(catalog()), { valid: true, errors: [] });

  const broken = catalog({
    locale: "not a locale",
    messages: {
      bad_key: "Missing stable namespace",
      "progress.activity": { one: "{count} activity" },
      "course.welcome": { one: "Welcome to {course}", other: "Welcome" }
    }
  });
  const result = validateInterfaceCatalog(broken);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /valid BCP 47 locale/u);
  assert.match(result.errors.join("\n"), /stable dot-separated/u);
  assert.match(result.errors.join("\n"), /require other/u);
  assert.match(result.errors.join("\n"), /same placeholders/u);
});

test("formats named placeholders and locale-aware plural messages without HTML rendering", () => {
  const content = createInterfaceContent(catalog());
  assert.equal(content.t("action.continue"), "Continue");
  assert.equal(content.t("course.welcome", { course: "Caatuu Spanish" }), "Welcome to Caatuu Spanish");
  assert.equal(content.t("progress.activity", { count: 1 }), "1 activity");
  assert.equal(content.t("progress.activity", { count: 2 }), "2 activities");
  assert.throws(() => content.t("course.welcome"), /requires placeholder course/u);
  assert.throws(() => content.t("unknown.message"), /Unknown interface message/u);
  assert.throws(() => content.t("progress.activity"), /finite count/u);
  assert.ok(Object.isFrozen(content));
});

test("resolves language names in the installed interface locale with declared-copy fallbacks", () => {
  const spanish = createInterfaceContent(catalog({
    locale: "es-ES",
    revision: "interface-es-1",
    messages: {
      ...catalog().messages,
      "languages.en": "Inglés revisado",
      "languages.zh": "Chino revisado",
      "languages.zh.hans": "Chino simplificado revisado"
    }
  }));
  const displayNames = new Intl.DisplayNames(["es-ES"], { type: "language", fallback: "none" });

  assert.equal(
    spanish.languageName({ locale: "en", label: "English", nativeLabel: "English" }),
    "Inglés revisado",
    "audited catalog names take priority over environment-dependent display names"
  );
  assert.equal(spanish.languageName({ locale: "zh-Hans" }), "Chino simplificado revisado");
  assert.equal(spanish.languageName({ locale: "zh-Hans-CN" }), "Chino simplificado revisado");
  assert.equal(spanish.languageName({ locale: "zh-Hant" }), "Chino revisado");
  assert.equal(
    spanish.languageName({ locale: "cs-CZ", label: "Czech", nativeLabel: "Čeština" }),
    displayNames.of("cs-CZ")
  );
  assert.equal(
    spanish.languageName({ id: "course-private-id", label: "Declared fallback", nativeLabel: "Autonym" }),
    "Declared fallback"
  );
  assert.equal(spanish.languageName({ nativeLabel: "Autonym only" }), "Autonym only");
});

test("translated catalogs keep the exact English message API while adding locale plural forms", () => {
  const spanish = catalog({
    locale: "es",
    revision: "interface-es-1",
    messages: {
      "action.continue": "Continuar",
      "course.welcome": "Te damos la bienvenida a {course}",
      "progress.activity": {
        one: "{count} actividad",
        many: "{count} actividades",
        other: "{count} actividades"
      }
    }
  });
  assert.deepEqual(validateInterfaceCatalogParity(catalog(), spanish), { valid: true, errors: [] });

  const drifted = structuredClone(spanish);
  drifted.messages["course.welcome"] = "Bienvenido";
  delete drifted.messages["action.continue"];
  drifted.messages["action.extra"] = "Extra";
  const result = validateInterfaceCatalogParity(catalog(), drifted);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /missing authority message action\.continue/u);
  assert.match(result.errors.join("\n"), /unknown message action\.extra/u);
  assert.match(result.errors.join("\n"), /placeholders must be exactly course/u);
});

test("applies stable message IDs to text and localizable attributes", () => {
  const content = createInterfaceContent(catalog());
  const text = {
    textContent: "",
    getAttribute(name) {
      return name === "data-i18n" ? "action.continue" : null;
    },
    setAttribute() {}
  };
  const buttonAttributes = new Map([
    ["data-i18n-aria-label", "course.welcome"],
    ["data-i18n-title", "action.continue"]
  ]);
  const button = {
    getAttribute(name) {
      return buttonAttributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      buttonAttributes.set(name, value);
    }
  };
  const root = {
    querySelectorAll() {
      return [text, button];
    }
  };

  assert.throws(
    () => content.apply(root),
    /requires placeholder course/u,
    "static DOM markers cannot silently omit required placeholders"
  );
  buttonAttributes.set("data-i18n-aria-label", "action.continue");
  assert.equal(content.apply(root), 2);
  assert.equal(text.textContent, "Continue");
  assert.equal(buttonAttributes.get("aria-label"), "Continue");
  assert.equal(buttonAttributes.get("title"), "Continue");
});

test("loads only the declared same-origin base-language catalog and installs it immutably", async () => {
  const requests = [];
  const course = {
    sourceLanguage: { locale: "en", direction: "ltr" },
    interfaceContent: {
      schemaVersion: 1,
      locale: "en",
      direction: "ltr",
      revision: "interface-en-1",
      catalog: "/language-runtime/static/data/interface/en.v1.json"
    }
  };
  const content = await loadInterfaceContent(course, {
    origin: "https://caatuu.test",
    async fetchImpl(url, options) {
      requests.push({ url, options });
      return { ok: true, async json() { return catalog(); } };
    }
  });
  assert.equal(content.locale, "en");
  assert.deepEqual(requests, [{
    url: "https://caatuu.test/language-runtime/static/data/interface/en.v1.json?v=interface-en-1",
    options: { cache: "no-cache", credentials: "same-origin" }
  }]);
  const scope = {};
  installInterfaceContent(content, scope);
  assert.equal(scope.CaatuuI18n, content);
  assert.throws(() => { scope.CaatuuI18n = null; }, /read only|Cannot assign/u);
  assert.throws(
    () => installInterfaceContent({ schemaVersion: 1, t() {}, apply() {} }, {}),
    /Cannot install invalid interface content/u
  );
});

test("fails closed on interface/source drift, cross-origin catalogs, and request failures", async () => {
  const base = {
    sourceLanguage: { locale: "es-ES", direction: "ltr" },
    interfaceContent: {
      schemaVersion: 1,
      locale: "en",
      direction: "ltr",
      revision: "interface-en-1",
      catalog: "/language-runtime/static/data/interface/en.v1.json"
    }
  };
  await assert.rejects(
    loadInterfaceContent(base, { fetchImpl: async () => ({ ok: true, json: async () => catalog() }) }),
    /must equal its learner-base locale/u
  );
  await assert.rejects(
    loadInterfaceContent({
      ...base,
      sourceLanguage: { locale: "en", direction: "ltr" },
      interfaceContent: { ...base.interfaceContent, catalog: "https://evil.test/interface.json" }
    }, {
      origin: "https://caatuu.test",
      fetchImpl: async () => ({ ok: true, json: async () => catalog() })
    }),
    /same-origin shared interface JSON/u
  );
  await assert.rejects(
    loadInterfaceContent({
      ...base,
      sourceLanguage: { locale: "en", direction: "ltr" }
    }, {
      origin: "https://caatuu.test",
      fetchImpl: async () => ({ ok: false, status: 503 })
    }),
    /status 503/u
  );

  let requested = false;
  await assert.rejects(
    loadInterfaceContent({
      sourceLanguage: { locale: "en", direction: "ltr" },
      interfaceContent: {
        ...base.interfaceContent,
        schemaVersion: 2,
        locale: "en"
      }
    }, {
      fetchImpl: async () => {
        requested = true;
        return { ok: true, json: async () => catalog() };
      }
    }),
    /interfaceContent schemaVersion must be 1/u
  );
  assert.equal(requested, false, "unsupported course descriptors must fail before catalog retrieval");
});
