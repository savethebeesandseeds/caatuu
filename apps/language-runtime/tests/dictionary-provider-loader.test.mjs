import assert from "node:assert/strict";
import test from "node:test";

import {
  declaredDictionaryProvider,
  initializeWorkspaceAfterDictionaryProvider,
  loadAndValidateDeclaredDictionaryProvider,
  mountValidatedDictionaryProvider,
  loadDeclaredDictionaryProvider
} from "../static/source/dictionary-provider-loader.mjs";

const providerId = "fixture-dictionary-provider-v1";
const course = Object.freeze({
  id: "fixture",
  dictionaryContent: Object.freeze({
    providerId,
    providerModule: "source/dictionary/provider.js?v=provider-1"
  })
});
const location = Object.freeze({ origin: "https://example.test", routeBase: "/fixture/" });

function provider(overrides = {}) {
  return {
    schemaVersion: 1,
    id: providerId,
    async mountDictionaryProvider(context) {
      assert.equal(context.course, course);
      assert.equal(Object.isFrozen(context.dictionaryContent), true);
      return { mounted: true, providerId };
    },
    ...overrides
  };
}

async function attempt(registration, { initial = null } = {}) {
  const globalScope = { CaatuuDictionaryProvider: initial };
  return loadDeclaredDictionaryProvider({
    course,
    globalScope,
    ...location,
    async loadScript(module) {
      assert.equal(module, course.dictionaryContent.providerModule);
      globalScope.CaatuuDictionaryProvider = registration;
    }
  });
}

test("the exact declared provider registration and mount acknowledgement succeed", async () => {
  assert.deepEqual(declaredDictionaryProvider(course, location), {
    providerId,
    providerModule: "source/dictionary/provider.js?v=provider-1"
  });
  assert.deepEqual(await attempt(provider()), { mounted: true, providerId });
});

test("provider registration and mount mismatches all fail closed", async () => {
  const failures = [
    provider({ id: "different-dictionary-provider-v1" }),
    { schemaVersion: 1, id: providerId },
    provider({ async mountDictionaryProvider() { return { mounted: true, providerId: "different-v1" }; } }),
    provider({ async mountDictionaryProvider() { return { mounted: false, providerId }; } }),
    provider({ async mountDictionaryProvider() { return {}; } }),
    provider({ async mountDictionaryProvider() { throw new Error("mount failed"); } })
  ];
  for (const registration of failures) {
    await assert.rejects(attempt(registration));
  }
  await assert.rejects(
    attempt(provider(), { initial: provider() }),
    /registration must be empty/u
  );
});

test("provider registration and mount both complete before shared workspace initialization", async () => {
  for (const registration of [
    provider({ id: "different-dictionary-provider-v1" }),
    provider({ async mountDictionaryProvider() { return { mounted: false, providerId }; } })
  ]) {
    const dictionaryCourse = Object.freeze({
      ...course,
      capabilities: Object.freeze({ dictionary: true })
    });
    const globalScope = {};
    let workspaceInitializations = 0;
    await assert.rejects(initializeWorkspaceAfterDictionaryProvider({
      course: dictionaryCourse,
      globalScope,
      ...location,
      async loadScript() {
        globalScope.CaatuuDictionaryProvider = registration;
      },
      async initializeWorkspace() {
        workspaceInitializations += 1;
        return { ready: true };
      }
    }));
    assert.equal(workspaceInitializations, 0);
  }
});

test("validated registrations are single-use and cannot be replaced before mount", async () => {
  const globalScope = {};
  const validated = await loadAndValidateDeclaredDictionaryProvider({
    course,
    globalScope,
    ...location,
    async loadScript() {
      globalScope.CaatuuDictionaryProvider = provider();
    }
  });
  globalScope.CaatuuDictionaryProvider = provider();
  await assert.rejects(
    mountValidatedDictionaryProvider(validated),
    /replaced before mount/u
  );
  await assert.rejects(
    mountValidatedDictionaryProvider(validated),
    /fresh validated registration/u
  );
});

test("provider declarations reject unversioned IDs and escaping or cross-route modules", () => {
  for (const dictionaryContent of [
    { ...course.dictionaryContent, providerId: "unversioned" },
    { ...course.dictionaryContent, providerModule: "../provider.js?v=provider-1" },
    { ...course.dictionaryContent, providerModule: "https://other.test/provider.js?v=provider-1" }
  ]) {
    assert.throws(
      () => declaredDictionaryProvider({ ...course, dictionaryContent }, location)
    );
  }
});
