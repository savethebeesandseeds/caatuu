import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  declaredCourseGameResource,
  fetchDeclaredCourseGameJson,
  readEmbeddedCourseProfile,
  resolveDeclaredCourseGameResourceUrl
} from "../static/source/games/course-game-content.mjs";
import {
  buildConjugationFormRound,
  buildConjugationMeaningRound,
  buildConjugationVerbQueue,
  validateConjugationCometCatalog
} from "../static/source/games/conjugation-comet/conjugation-comet-core.mjs";

const czechCatalogUrl = new URL(
  "../../languages/czech/static/data/games/conjugation-comet/verbs.json",
  import.meta.url
);
const sharedHostUrl = new URL(
  "../static/source/games/conjugation-comet/conjugation-comet-host.mjs",
  import.meta.url
);
const sharedDocumentUrl = new URL(
  "../static/games/conjugation-comet.html",
  import.meta.url
);

function exampleCourse(resource = "data/games/conjugation-comet/verbs.json?v=pilot-1") {
  return {
    id: "es",
    routePrefix: "/es",
    sourceLanguage: { id: "en", locale: "en" },
    targetLanguage: { id: "es", locale: "es-ES" },
    gameContent: {
      "conjugation-comet": {
        conjugationCometCatalog: resource
      }
    }
  };
}

function nonEnglishLearnerBaseCatalog() {
  const verbs = [
    ["hablar", "hablar", "sprechen", "speak", "hablo", "ich spreche", "I speak"],
    ["comer", "comer", "essen", "eat", "como", "ich esse", "I eat"],
    ["vivir", "vivir", "leben", "live", "vivo", "ich lebe", "I live"],
    ["ir", "ir", "gehen", "go", "voy", "ich gehe", "I go"]
  ].map(([id, target, base, audit, form, formBase, formAudit]) => ({
    id: `es-present-${id}`,
    revision: 1,
    targetText: target,
    learnerBaseText: base,
    englishAuditText: audit,
    difficulty: 1,
    family: "Erstelltes Präsensparadigma",
    lessonId: "present-pilot",
    teachingNoteBaseText: "Vergleiche Person und Numerus.",
    tags: [],
    forms: [
      {
        id: "first-singular",
        revision: 1,
        subjectTargetText: "yo",
        targetText: form,
        learnerBaseCueText: formBase,
        englishAuditText: formAudit
      },
      {
        id: "first-plural",
        revision: 1,
        subjectTargetText: "nosotros",
        targetText: `${form}-plural-test`,
        learnerBaseCueText: `${formBase} (Pluraltest)`,
        englishAuditText: `${formAudit} (plural test)`
      }
    ]
  }));
  return {
    schemaVersion: "caatuu-conjugation-comet-catalog-v1",
    id: "es-german-base-test",
    contentRevision: 1,
    courseId: "de-es",
    targetLanguageId: "es",
    targetLocale: "es-ES",
    learnerBaseLanguageId: "de",
    auditLanguageId: "en",
    variety: {
      id: "es-ES",
      label: "European Spanish",
      policyNoteEnglish: "Synthetic contract fixture."
    },
    review: {
      status: "native-review-required",
      noteEnglish: "Synthetic contract fixture."
    },
    license: {
      origin: "first-party-authored",
      status: "release-review-required",
      spdx: null,
      noteEnglish: "Synthetic contract fixture."
    },
    authority: {
      kind: "authored-finite-catalog",
      dictionaryLookup: false,
      runtimeGeneration: false,
      englishAuditRequired: true
    },
    copy: {
      title: "Konjugationskomet",
      meaningKicker: "Bedeutung",
      meaningInstruction: "Wähle die Bedeutung in der Basissprache.",
      formsKicker: "Formen zuordnen",
      formsInstruction: "Ordne jede spanische Form ihrem Hinweis zu.",
      meaningTargetHeading: "Spanisches Verb",
      meaningChoicesHeading: "Bedeutungen",
      targetFormsHeading: "Spanische Formen",
      baseCuesHeading: "Deutsche Hinweise",
      meaningBoardLabel: "Spielbrett für Bedeutungen",
      formsBoardLabel: "Spielbrett für Verbformen",
      infinitiveLabel: "Infinitiv",
      hintLabel: "Muster zeigen",
      nextLabel: "Nächstes Verb",
      hearVerbTemplate: "{verb} anhören",
      hearFormTemplate: "{form} anhören",
      playingTemplate: "Wiedergabe: {text}",
      matchedStateLabel: "zugeordnet",
      audioUnavailableTemplate: "Audio für {language} ist auf diesem Gerät nicht verfügbar.",
      meaningStartFeedback: "Wähle zuerst die Bedeutung.",
      wrongMeaningFeedback: "Das ist ein anderes Verb. Versuche es noch einmal.",
      correctMeaningTemplate: "Richtig: {meaning}.",
      formsStartFeedback: "Du kannst in beiden Spalten beginnen.",
      pairSelectedFeedback: "Wähle jetzt die passende Karte in der anderen Spalte.",
      pairMatchedFeedback: "Zugeordnet. Weiter so.",
      wrongPairFeedback: "Diese Karten haben eine andere Person oder Zahl.",
      roundCompleteTemplate: "Alle Formen von {verb} sind zugeordnet.",
      meaningProgressTemplate: "Verb {number} · Bedeutung",
      formsProgressTemplate: "{matched} von {total} zugeordnet",
      progressLabel: "Rundenfortschritt"
    },
    verbs
  };
}

test("shared game resources resolve only inside the declared course game directory", () => {
  const course = exampleCourse();
  assert.equal(
    declaredCourseGameResource(course, "conjugation-comet", "conjugationCometCatalog"),
    "data/games/conjugation-comet/verbs.json?v=pilot-1"
  );
  assert.equal(
    resolveDeclaredCourseGameResourceUrl(course, {
      gameId: "conjugation-comet",
      resourceName: "conjugationCometCatalog",
      runtimeHref: "http://127.0.0.1:8765/language-runtime/static/games/conjugation-comet.html"
    }),
    "http://127.0.0.1:8765/es/data/games/conjugation-comet/verbs.json?v=pilot-1"
  );

  for (const unsafe of [
    "../mandarin/verbs.json",
    "data/games/agreement-aurora/challenges.json",
    "/es/data/games/conjugation-comet/verbs.json",
    "https://example.test/verbs.json",
    "data\\games\\conjugation-comet\\verbs.json",
    "data/games/conjugation-comet/%2f..%2fverbs.json",
    "data/games/conjugation-comet/%5c..%5cverbs.json",
    "data/games/conjugation-comet/verbs.txt"
  ]) {
    assert.throws(() => resolveDeclaredCourseGameResourceUrl(exampleCourse(unsafe), {
      gameId: "conjugation-comet",
      resourceName: "conjugationCometCatalog",
      runtimeHref: "http://127.0.0.1:8765/language-runtime/static/games/conjugation-comet.html"
    }), /relative course-static path|must remain inside/u, unsafe);
  }
});

test("the shared game helper reads course authority only from a same-origin shell", () => {
  const course = exampleCourse();
  const sameOriginParent = {
    location: { origin: "http://127.0.0.1:8765" },
    CaatuuCourse: course
  };
  assert.equal(readEmbeddedCourseProfile({
    location: { href: "http://127.0.0.1:8765/language-runtime/static/games/conjugation-comet.html" },
    parent: sameOriginParent
  }), course);

  assert.throws(() => readEmbeddedCourseProfile({
    location: { href: "http://127.0.0.1:8765/language-runtime/static/games/conjugation-comet.html" },
    parent: {
      location: { origin: "https://other.example" },
      CaatuuCourse: course
    }
  }), /same-origin/u);
});

test("the shared game helper fetches only the resolved projected resource", async () => {
  const requests = [];
  const payload = { schemaVersion: "test" };
  const result = await fetchDeclaredCourseGameJson(exampleCourse(), {
    gameId: "conjugation-comet",
    resourceName: "conjugationCometCatalog",
    runtimeHref: "http://127.0.0.1:8765/language-runtime/static/games/conjugation-comet.html",
    async fetchImpl(url, options) {
      requests.push({ url, options });
      return { ok: true, json: async () => payload };
    }
  });
  assert.deepEqual(result.document, payload);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, result.url);
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.headers.Accept, "application/json");
});

test("the neutral core preserves the existing Czech catalog through its legacy adapter", async () => {
  const raw = JSON.parse(await readFile(czechCatalogUrl, "utf8"));
  const catalog = validateConjugationCometCatalog(raw, {
    expectedCourseId: "cz",
    expectedTargetLanguageId: "cs",
    expectedLearnerBaseLanguageId: "en",
    expectedTargetLocale: "cs-CZ"
  });
  assert.equal(catalog.courseId, "cz");
  assert.equal(catalog.targetLanguageId, "cs");
  assert.equal(catalog.learnerBaseLanguageId, "en");
  assert.equal(catalog.auditLanguageId, "en");
  assert.deepEqual(catalog.license, {
    origin: "legacy-course-content",
    status: "legacy-review-required",
    spdx: null,
    noteEnglish: "The existing Czech catalog remains subject to its course-level review and licensing authority during migration."
  });
  assert.equal(catalog.verbs[0].targetText, raw.verbs[0].verb);
  assert.equal(catalog.verbs[0].learnerBaseText, raw.verbs[0].meaning);
  assert.equal(catalog.verbs[0].englishAuditText, raw.verbs[0].meaning);
  assert.equal(catalog.verbs[0].forms[0].targetText, raw.verbs[0].forms[0].form);
  assert.equal(catalog.verbs[0].forms[0].learnerBaseCueText, raw.verbs[0].forms[0].cue);
  assert.equal(catalog.verbs[0].forms[0].englishAuditText, raw.verbs[0].forms[0].cue);
});

test("schema-less legacy catalogs are confined to the exact Czech migration identity", async () => {
  const raw = JSON.parse(await readFile(czechCatalogUrl, "utf8"));
  for (const identity of [
    {
      expectedCourseId: "sk",
      expectedTargetLanguageId: "cs",
      expectedLearnerBaseLanguageId: "en",
      expectedTargetLocale: "cs-CZ"
    },
    {
      expectedCourseId: "cz",
      expectedTargetLanguageId: "es",
      expectedLearnerBaseLanguageId: "en",
      expectedTargetLocale: "es-ES"
    },
    {
      expectedCourseId: "cz",
      expectedTargetLanguageId: "cs",
      expectedLearnerBaseLanguageId: "de",
      expectedTargetLocale: "cs-CZ"
    },
    {
      expectedCourseId: "cz",
      expectedTargetLanguageId: "cs",
      expectedLearnerBaseLanguageId: "en",
      expectedTargetLocale: "cs"
    }
  ]) {
    assert.throws(
      () => validateConjugationCometCatalog(raw, identity),
      (error) => error?.code === "CONJUGATION_COMET_LEGACY_SCOPE_INVALID"
        && /Czech cs-CZ migration boundary/u.test(error.message),
      JSON.stringify(identity)
    );
  }
});

test("meaning and form rounds are authored, shuffled, and position-safe", async () => {
  const raw = JSON.parse(await readFile(czechCatalogUrl, "utf8"));
  const catalog = validateConjugationCometCatalog(raw, {
    expectedCourseId: "cz",
    expectedTargetLanguageId: "cs",
    expectedLearnerBaseLanguageId: "en",
    expectedTargetLocale: "cs-CZ"
  });
  const current = catalog.verbs[0];
  const meaning = buildConjugationMeaningRound(catalog, current.id, {
    random: () => 0.42
  });
  assert.equal(meaning.options.length, 4);
  assert.equal(new Set(meaning.options.map((option) => option.learnerBaseText)).size, 4);
  assert.equal(meaning.answerId, current.id);

  const forms = buildConjugationFormRound(catalog, current.id, {
    random: () => 0.42
  });
  assert.equal(forms.targetForms.length, current.forms.length);
  assert.equal(forms.baseCues.length, current.forms.length);
  assert.ok(forms.baseCues.every((form, index) => form.id !== forms.targetForms[index].id));
  assert.ok(Object.isFrozen(forms));
});

test("verb queues shuffle inside authored difficulty tiers without changing their inputs", () => {
  const verbs = Object.freeze([
    Object.freeze({ id: "medium-a", difficulty: 2 }),
    Object.freeze({ id: "easy-a", difficulty: 1 }),
    Object.freeze({ id: "hard-a", difficulty: 3 }),
    Object.freeze({ id: "easy-b", difficulty: 1 }),
    Object.freeze({ id: "medium-b", difficulty: 2 })
  ]);
  const before = structuredClone(verbs);
  const shuffled = buildConjugationVerbQueue(verbs, {
    random: () => 0
  });
  assert.deepEqual(shuffled.map((verb) => verb.id), [
    "easy-b",
    "easy-a",
    "medium-b",
    "medium-a",
    "hard-a"
  ]);

  const queue = buildConjugationVerbQueue(verbs, {
    previousVerbId: "easy-a",
    random: () => 0.999
  });

  assert.deepEqual(queue.map((verb) => verb.difficulty), [1, 1, 2, 2, 3]);
  assert.deepEqual(queue.map((verb) => verb.id), [
    "easy-b",
    "easy-a",
    "medium-a",
    "medium-b",
    "hard-a"
  ]);
  assert.notEqual(queue[0].id, "easy-a", "avoid a refill repeat inside the lowest tier");
  assert.deepEqual(verbs, before, "queue construction must not reorder or rewrite catalog verbs");

  const unavoidable = buildConjugationVerbQueue([
    { id: "only-easy", difficulty: 1 },
    { id: "later", difficulty: 2 }
  ], {
    previousVerbId: "only-easy",
    random: () => 0.999
  });
  assert.deepEqual(
    unavoidable.map((verb) => verb.id),
    ["only-easy", "later"],
    "a higher tier must not jump ahead merely to avoid a repeat"
  );
});

test("a non-English learner base is rendered independently from English audit authority", () => {
  const catalog = validateConjugationCometCatalog(nonEnglishLearnerBaseCatalog(), {
    expectedCourseId: "de-es",
    expectedTargetLanguageId: "es",
    expectedLearnerBaseLanguageId: "de",
    expectedTargetLocale: "es-ES"
  });
  const current = catalog.verbs[0];
  assert.equal(current.learnerBaseText, "sprechen");
  assert.equal(current.englishAuditText, "speak");
  assert.equal(current.forms[0].learnerBaseCueText, "ich spreche");
  assert.equal(current.forms[0].englishAuditText, "I speak");
  assert.equal(current.family, "Erstelltes Präsensparadigma");
  assert.equal(catalog.copy.title, "Konjugationskomet");
  assert.equal(catalog.copy.meaningStartFeedback, "Wähle zuerst die Bedeutung.");
  assert.equal(catalog.copy.baseCuesHeading, "Deutsche Hinweise");

  const meaning = buildConjugationMeaningRound(catalog, current.id, { random: () => 0.42 });
  assert.ok(meaning.options.some((option) => option.learnerBaseText === "sprechen"));
  assert.ok(meaning.options.every((option) => !Object.hasOwn(option, "englishAuditText")));
  const forms = buildConjugationFormRound(catalog, current.id, { random: () => 0.42 });
  assert.ok(forms.baseCues.some((form) => form.learnerBaseCueText === "ich spreche"));
  assert.ok(forms.targetForms.every((form) => !Object.hasOwn(form, "englishAuditText")));
  assert.ok(forms.baseCues.every((form) => !Object.hasOwn(form, "englishAuditText")));
  assert.doesNotMatch(JSON.stringify({ meaning, forms }), /\bspeak\b|I speak/u);
});

test("the shared Conjugation Comet host has no Spanish or Czech rendering fork", async () => {
  const [host, document] = await Promise.all([
    readFile(sharedHostUrl, "utf8"),
    readFile(sharedDocumentUrl, "utf8")
  ]);
  assert.doesNotMatch(host, /\/es\/|\/cz\/|es-ES|cs-CZ|Spanish|Czech/u);
  assert.match(host, /readEmbeddedCourseProfile/u);
  assert.match(host, /fetchDeclaredCourseGameJson/u);
  assert.match(host, /learnerBaseCueText/u);
  assert.doesNotMatch(host, /form\.englishAuditText/u);
  assert.match(host, /type:\s*"round-success"/u);
  assert.match(host, /catalog\.copy\.meaningInstruction/u);
  assert.match(host, /catalog\.copy\.baseCuesHeading/u);
  assert.match(host, /catalog\.copy\.wrongPairFeedback/u);
  assert.match(host, /buildConjugationVerbQueue\(state\.catalog\.verbs/u);
  assert.match(host, /previousVerbId:\s*state\.current\?\.id/u);
  assert.doesNotMatch(host, /shuffleConjugationItems\(state\.catalog\.verbs/u);
  assert.match(document, /conjugation-comet-host\.mjs/u);
  assert.doesNotMatch(
    document,
    />\s*(?:Meaning choices|Base-language cues|Next verb|Show pattern)\s*</u
  );
});
