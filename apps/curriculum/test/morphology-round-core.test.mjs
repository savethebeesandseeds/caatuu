import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  MORPHOLOGY_CATALOG_SCHEMA,
  MORPHOLOGY_MATCH_BOARD_SCHEMA,
  MORPHOLOGY_ROUND_SCHEMA,
  composeMorphologyMatchBoard,
  composeMorphologyRound,
  evaluateMorphologyMatchPair,
  evaluateMorphologySelection,
  normalizeMorphologyCatalog,
  normalizeMorphologyItem,
  resolvePinnedMorphologyCatalog
} from "../runtime/morphology-round-core.mjs";

const APPROVED = Object.freeze({ status: "human-approved" });
const PROTOTYPE = Object.freeze({ status: "prototype-not-human-approved" });
const FAMILY_REF = Object.freeze({ id: "family.cs.cist.present-singular", revision: 1 });
const CATALOG_REF = Object.freeze({ id: "caatuu.cs-CZ.morphology-developer-pilot", version: "1.0.0" });

function clone(value) {
  return structuredClone(value);
}

function catalogBytes(value) {
  return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
}

function catalogDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function withGlobalValue(name, value, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true
  });
  try {
    return await callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}

function item({ id, surface, featureKey, person, ambiguity = { mode: "none" } }) {
  return {
    id,
    revision: 1,
    familyRef: clone(FAMILY_REF),
    surface,
    acceptedVariants: [],
    featureKey,
    features: {
      aspect: "imperfective",
      mood: "indicative",
      number: "singular",
      person,
      tense: "present"
    },
    ambiguity,
    review: clone(APPROVED)
  };
}

function cue({ id, targetId, key, supportEn, ambiguityResolutionKey = null }) {
  return {
    id,
    revision: 1,
    familyRef: clone(FAMILY_REF),
    targetItemRef: { id: targetId, revision: 1 },
    key,
    presentation: {
      roleTokenEn: key,
      contextEn: supportEn,
      naturalTranslationEn: supportEn,
      teachingLabelEn: `${key} · present`,
      hintEn: `Choose the form for ${key}.`,
      solutionExplanationEn: `This form matches ${key}.`
    },
    ambiguityResolutionKey,
    review: clone(APPROVED)
  };
}

function fixture() {
  return {
    schemaVersion: MORPHOLOGY_CATALOG_SCHEMA,
    catalogId: CATALOG_REF.id,
    version: CATALOG_REF.version,
    targetLocale: "cs-CZ",
    review: clone(APPROVED),
    families: [{
      ...clone(FAMILY_REF),
      lemmaRef: { id: "cs.lemma.cist.read", revision: 1 },
      review: clone(APPROVED)
    }],
    items: [
      item({
        id: "form.cs.cist.1sg.present",
        surface: "c\u030ctu",
        featureKey: "present.indicative.imperfective.1.singular",
        person: 1
      }),
      item({
        id: "form.cs.cist.2sg.present",
        surface: "čteš",
        featureKey: "present.indicative.imperfective.2.singular",
        person: 2
      }),
      item({
        id: "form.cs.cist.3sg.present",
        surface: "čte",
        featureKey: "present.indicative.imperfective.3.singular",
        person: 3,
        ambiguity: {
          mode: "cue-resolved",
          resolutionKey: "named-third-person"
        }
      })
    ],
    cues: [
      cue({
        id: "cue.cs.cist.speaker",
        targetId: "form.cs.cist.1sg.present",
        key: "read.current.speaker.singular",
        supportEn: "I am reading now."
      }),
      cue({
        id: "cue.cs.cist.familiar-addressee",
        targetId: "form.cs.cist.2sg.present",
        key: "read.current.familiar-addressee.singular",
        supportEn: "You, one friend, are reading now."
      }),
      cue({
        id: "cue.cs.cist.grandfather",
        targetId: "form.cs.cist.3sg.present",
        key: "read.current.named-third-person.grandfather",
        supportEn: "Grandpa is reading now.",
        ambiguityResolutionKey: "named-third-person"
      })
    ]
  };
}

function request(overrides = {}) {
  return {
    catalogRef: clone(CATALOG_REF),
    familyRef: clone(FAMILY_REF),
    taskFingerprint: "sha256:test-morphology-task-001",
    ...overrides
  };
}

function assertCode(expectedCode) {
  return (error) => {
    assert.equal(error?.name, "MorphologyRoundError");
    assert.equal(error?.code, expectedCode);
    return true;
  };
}

function addSecondFamily(catalog, { sharedSurface = "čtu", explicitAmbiguity = false } = {}) {
  const familyRef = { id: "family.cs.pit.present-singular", revision: 1 };
  catalog.families.push({
    ...familyRef,
    lemmaRef: { id: "cs.lemma.pit.drink", revision: 1 },
    review: clone(APPROVED)
  });
  catalog.items.push(
    {
      ...item({
        id: "form.cs.pit.1sg.present",
        surface: "piju",
        featureKey: "present.indicative.imperfective.1.singular",
        person: 1
      }),
      familyRef
    },
    {
      ...item({
        id: "form.cs.pit.shared.present",
        surface: sharedSurface,
        featureKey: "present.indicative.imperfective.shared.singular",
        person: 3,
        ambiguity: explicitAmbiguity
          ? { mode: "cue-resolved", resolutionKey: "drink-context" }
          : { mode: "none" }
      }),
      familyRef
    }
  );
  catalog.cues.push(
    {
      ...cue({
        id: "cue.cs.pit.speaker",
        targetId: "form.cs.pit.1sg.present",
        key: "drink.current.speaker.singular",
        supportEn: "I am drinking now."
      }),
      familyRef,
      targetItemRef: { id: "form.cs.pit.1sg.present", revision: 1 }
    },
    {
      ...cue({
        id: "cue.cs.pit.named-other",
        targetId: "form.cs.pit.shared.present",
        key: "drink.current.named-third-person",
        supportEn: "Anna is drinking now.",
        ambiguityResolutionKey: explicitAmbiguity ? "drink-context" : null
      }),
      familyRef,
      targetItemRef: { id: "form.cs.pit.shared.present", revision: 1 }
    }
  );
}

test("normalizes individual items to exact NFC surfaces without case folding", () => {
  const normalized = normalizeMorphologyItem(fixture().items[0]);
  assert.equal(normalized.surface, "čtu");
  assert.equal(normalized.surface.normalize("NFD"), "c\u030ctu");
  assert.equal(normalized.surface === "Čtu", false);
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(normalized.features));
  assert.throws(() => {
    normalized.surface = "Čtu";
  }, TypeError);
});

test("normalizes and freezes a locale-neutral three-form catalog", () => {
  const normalized = normalizeMorphologyCatalog(fixture());
  assert.equal(normalized.targetLocale, "cs-CZ");
  assert.deepEqual(normalized.items.map((row) => row.surface), ["čtu", "čteš", "čte"]);
  assert.deepEqual(normalized.items.map((row) => row.features.person), [1, 2, 3]);
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(normalized.items));
  assert.ok(Object.isFrozen(normalized.cues[0].presentation));
});

test("resolves exact pinned catalog bytes through Web Crypto and fatal UTF-8", async () => {
  const bytes = catalogBytes(fixture());
  const digest = catalogDigest(bytes);
  const expected = normalizeMorphologyCatalog(fixture());

  assert.deepEqual(await resolvePinnedMorphologyCatalog(bytes, digest), expected);

  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const fromArrayBuffer = await resolvePinnedMorphologyCatalog(buffer, digest);
  assert.deepEqual(fromArrayBuffer, expected);
  assert.ok(Object.isFrozen(fromArrayBuffer));
});

test("rejects invalid pinned byte and lowercase digest contracts", async () => {
  const bytes = catalogBytes(fixture());
  const digest = catalogDigest(bytes);

  await assert.rejects(
    resolvePinnedMorphologyCatalog("not bytes", digest),
    assertCode("MORPH_CATALOG_BYTES_INVALID")
  );
  await assert.rejects(
    resolvePinnedMorphologyCatalog(new Uint16Array([1, 2]), digest),
    assertCode("MORPH_CATALOG_BYTES_INVALID")
  );
  await assert.rejects(
    resolvePinnedMorphologyCatalog(bytes, digest.toUpperCase()),
    assertCode("MORPH_CATALOG_DIGEST_INVALID")
  );
  await assert.rejects(
    resolvePinnedMorphologyCatalog(bytes, digest.slice(0, -1)),
    assertCode("MORPH_CATALOG_DIGEST_INVALID")
  );
});

test("rejects digest mismatches before decoding pinned catalog bytes", async () => {
  const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
  await assert.rejects(
    resolvePinnedMorphologyCatalog(invalidUtf8, `sha256:${"0".repeat(64)}`),
    assertCode("MORPH_CATALOG_DIGEST_MISMATCH")
  );
});

test("reports unavailable Web Crypto and fatal TextDecoder support", async () => {
  const bytes = catalogBytes(fixture());
  const digest = catalogDigest(bytes);

  await withGlobalValue("crypto", undefined, async () => {
    await assert.rejects(
      resolvePinnedMorphologyCatalog(bytes, digest),
      assertCode("MORPH_WEB_CRYPTO_UNAVAILABLE")
    );
  });
  await withGlobalValue("crypto", { subtle: { digest: async () => { throw new Error("disabled"); } } }, async () => {
    await assert.rejects(
      resolvePinnedMorphologyCatalog(bytes, digest),
      assertCode("MORPH_WEB_CRYPTO_UNAVAILABLE")
    );
  });
  await withGlobalValue("TextDecoder", undefined, async () => {
    await assert.rejects(
      resolvePinnedMorphologyCatalog(bytes, digest),
      assertCode("MORPH_TEXT_DECODER_UNAVAILABLE")
    );
  });
});

test("rejects digest-valid malformed UTF-8 and JSON with distinct errors", async () => {
  const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
  await assert.rejects(
    resolvePinnedMorphologyCatalog(invalidUtf8, catalogDigest(invalidUtf8)),
    assertCode("MORPH_CATALOG_UTF8_INVALID")
  );

  const invalidJson = catalogBytes('{"schemaVersion":');
  await assert.rejects(
    resolvePinnedMorphologyCatalog(invalidJson, catalogDigest(invalidJson)),
    assertCode("MORPH_CATALOG_JSON_INVALID")
  );
});

test("composes one-cue same-lemma rounds deterministically from the task fingerprint", () => {
  const catalog = fixture();
  const first = composeMorphologyRound(catalog, request());
  const repeat = composeMorphologyRound(catalog, request());
  assert.deepEqual(repeat, first);
  assert.equal(first.schemaVersion, MORPHOLOGY_ROUND_SCHEMA);
  assert.equal(first.options.length, 3);
  assert.equal(first.options.filter((option) => (
    option.itemRef.id === first.targetItemRef.id
    && option.itemRef.revision === first.targetItemRef.revision
  )).length, 1);
  assert.equal(Object.hasOwn(first.cue, "targetItemRef"), false);
  assert.equal(new Set(first.options.map((option) => option.surface)).size, first.options.length);

  const reordered = fixture();
  reordered.items.reverse();
  reordered.cues.reverse();
  assert.deepEqual(composeMorphologyRound(reordered, request()), first);

  const next = composeMorphologyRound(catalog, request({
    taskFingerprint: "sha256:test-morphology-task-002"
  }));
  assert.notEqual(next.roundId, first.roundId);
});

test("can pin one reviewed cue while keeping target and distractor order deterministic", () => {
  const cueRef = { id: "cue.cs.cist.familiar-addressee", revision: 1 };
  const round = composeMorphologyRound(fixture(), request({ cueRef, optionCount: 2 }));
  assert.deepEqual(round.cue.cueRef, cueRef);
  assert.deepEqual(round.targetItemRef, { id: "form.cs.cist.2sg.present", revision: 1 });
  assert.equal(round.options.length, 2);
  assert.equal(round.options.every((option) => option.itemRef.id.includes("form.cs.cist.")), true);
});

test("rejects NFC-equivalent target surfaces and accepted-variant distractor collisions", () => {
  const duplicate = fixture();
  duplicate.items[1].surface = "c\u030ctu";
  assert.throws(() => normalizeMorphologyCatalog(duplicate), assertCode("MORPH_SURFACE_COLLISION"));

  const variantCollision = fixture();
  variantCollision.items[0].acceptedVariants = ["čteš"];
  assert.throws(
    () => normalizeMorphologyCatalog(variantCollision),
    assertCode("MORPH_SURFACE_COLLISION")
  );

  const ownDuplicate = fixture().items[0];
  ownDuplicate.acceptedVariants = ["čtu"];
  assert.throws(() => normalizeMorphologyItem(ownDuplicate), assertCode("MORPH_VARIANT_DUPLICATE"));
});

test("rejects cue-key and equivalent-presentation collisions", () => {
  const keyCollision = fixture();
  keyCollision.cues[1].key = keyCollision.cues[0].key;
  assert.throws(() => normalizeMorphologyCatalog(keyCollision), assertCode("MORPH_CUE_COLLISION"));

  const presentationCollision = fixture();
  presentationCollision.cues[1].presentation = clone(presentationCollision.cues[0].presentation);
  assert.throws(
    () => normalizeMorphologyCatalog(presentationCollision),
    assertCode("MORPH_CUE_COLLISION")
  );

  const hiddenOnlyDifference = fixture();
  hiddenOnlyDifference.cues[1].presentation = {
    ...clone(hiddenOnlyDifference.cues[0].presentation),
    hintEn: "A different hidden hint cannot make the prompt fair.",
    solutionExplanationEn: "A different hidden solution cannot make the prompt fair."
  };
  assert.throws(
    () => normalizeMorphologyCatalog(hiddenOnlyDifference),
    assertCode("MORPH_CUE_COLLISION")
  );
});

test("requires explicit cue handling for declared ambiguity", () => {
  const missingDeclaration = fixture().items[0];
  delete missingDeclaration.ambiguity;
  assert.throws(
    () => normalizeMorphologyItem(missingDeclaration),
    assertCode("MORPH_AMBIGUITY_UNDECLARED")
  );

  const unresolved = fixture();
  unresolved.cues[2].ambiguityResolutionKey = null;
  assert.throws(
    () => normalizeMorphologyCatalog(unresolved),
    assertCode("MORPH_AMBIGUITY_UNRESOLVED")
  );
});

test("rejects cross-family homographs unless every owner declares cue resolution", () => {
  const implicit = fixture();
  addSecondFamily(implicit);
  assert.throws(
    () => normalizeMorphologyCatalog(implicit),
    assertCode("MORPH_AMBIGUITY_UNHANDLED")
  );

  const explicit = fixture();
  explicit.items[0].ambiguity = { mode: "cue-resolved", resolutionKey: "read-context" };
  explicit.cues[0].ambiguityResolutionKey = "read-context";
  addSecondFamily(explicit, { explicitAmbiguity: true });
  const normalized = normalizeMorphologyCatalog(explicit);
  assert.equal(normalized.families.length, 2);
});

test("never permits syncretic duplicate answer cards inside one family", () => {
  const catalog = fixture();
  catalog.items[1].surface = "čte";
  catalog.items[1].ambiguity = { mode: "cue-resolved", resolutionKey: "familiar-addressee" };
  catalog.cues[1].ambiguityResolutionKey = "familiar-addressee";
  assert.throws(() => normalizeMorphologyCatalog(catalog), assertCode("MORPH_SURFACE_COLLISION"));
});

test("rejects stale internal family and target-item references", () => {
  const staleFamily = fixture();
  staleFamily.items[0].familyRef.revision = 2;
  assert.throws(
    () => normalizeMorphologyCatalog(staleFamily),
    assertCode("MORPH_FAMILY_REF_STALE")
  );

  const staleTarget = fixture();
  staleTarget.cues[0].targetItemRef.revision = 2;
  assert.throws(
    () => normalizeMorphologyCatalog(staleTarget),
    assertCode("MORPH_ITEM_REF_STALE")
  );
});

test("rejects stale external catalog, family, and cue references", () => {
  assert.throws(
    () => composeMorphologyRound(fixture(), request({
      catalogRef: { id: CATALOG_REF.id, version: "0.9.0" }
    })),
    assertCode("MORPH_CATALOG_REF_STALE")
  );
  assert.throws(
    () => composeMorphologyRound(fixture(), request({
      familyRef: { id: FAMILY_REF.id, revision: 2 }
    })),
    assertCode("MORPH_FAMILY_REF_STALE")
  );
  assert.throws(
    () => composeMorphologyRound(fixture(), request({
      cueRef: { id: "cue.cs.cist.speaker", revision: 2 }
    })),
    assertCode("MORPH_CUE_REF_STALE")
  );
});

test("allows prototype development rounds but blocks every unreviewed release dependency", () => {
  const prototypeItem = fixture();
  prototypeItem.items[1].review = clone(PROTOTYPE);
  assert.doesNotThrow(() => composeMorphologyRound(prototypeItem, request()));
  assert.throws(
    () => composeMorphologyRound(prototypeItem, request({ releaseMode: true })),
    assertCode("MORPH_RELEASE_UNREVIEWED")
  );

  const prototypeCue = fixture();
  prototypeCue.cues[0].review = clone(PROTOTYPE);
  assert.throws(
    () => composeMorphologyRound(prototypeCue, request({
      cueRef: { id: "cue.cs.cist.speaker", revision: 1 },
      releaseMode: true
    })),
    assertCode("MORPH_RELEASE_UNREVIEWED")
  );

  assert.doesNotThrow(() => composeMorphologyRound(fixture(), request({ releaseMode: true })));

  const nestedPrototype = fixture();
  nestedPrototype.cues[0].metadata = {
    exercise: { review: clone(PROTOTYPE) }
  };
  assert.throws(
    () => composeMorphologyRound(nestedPrototype, request({
      cueRef: { id: "cue.cs.cist.speaker", revision: 1 },
      releaseMode: true
    })),
    assertCode("MORPH_RELEASE_UNREVIEWED")
  );

  const developerOnly = fixture();
  developerOnly.metadata = {
    releasePolicy: { status: "developer-only", requiresNewCatalogForRelease: true }
  };
  assert.throws(
    () => composeMorphologyRound(developerOnly, request({ releaseMode: true })),
    assertCode("MORPH_RELEASE_DEVELOPER_ONLY")
  );
});

test("never composes rejected content even in development mode", () => {
  const catalog = fixture();
  catalog.cues[0].review = { status: "rejected" };
  assert.throws(
    () => composeMorphologyRound(catalog, request({
      cueRef: { id: "cue.cs.cist.speaker", revision: 1 }
    })),
    assertCode("MORPH_CONTENT_REJECTED")
  );

  const nested = fixture();
  nested.cues[0].metadata = { exercise: { review: { status: "rejected" } } };
  assert.throws(
    () => composeMorphologyRound(nested, request({
      cueRef: { id: "cue.cs.cist.speaker", revision: 1 }
    })),
    assertCode("MORPH_CONTENT_REJECTED")
  );
});

test("evaluates immutable item selections and rejects stale or foreign choices", () => {
  const round = composeMorphologyRound(fixture(), request({
    cueRef: { id: "cue.cs.cist.familiar-addressee", revision: 1 }
  }));
  const correct = evaluateMorphologySelection(round, { itemRef: round.targetItemRef });
  assert.deepEqual(correct, {
    correct: true,
    score: 1,
    cueRef: { id: "cue.cs.cist.familiar-addressee", revision: 1 },
    selectedItemRef: { id: "form.cs.cist.2sg.present", revision: 1 },
    targetItemRef: { id: "form.cs.cist.2sg.present", revision: 1 }
  });
  assert.ok(Object.isFrozen(correct));

  const wrongRef = round.options.find((option) => option.itemRef.id !== round.targetItemRef.id).itemRef;
  const wrong = evaluateMorphologySelection(round, { itemRef: wrongRef });
  assert.equal(wrong.correct, false);
  assert.equal(wrong.score, 0);

  assert.throws(
    () => evaluateMorphologySelection(round, {
      itemRef: { id: round.targetItemRef.id, revision: round.targetItemRef.revision + 1 }
    }),
    assertCode("MORPH_SELECTION_REF_STALE")
  );
  assert.throws(
    () => evaluateMorphologySelection(round, {
      itemRef: { id: "form.cs.cist.not-in-round", revision: 1 }
    }),
    assertCode("MORPH_SELECTION_NOT_IN_ROUND")
  );
});

test("composes a deterministic two-column board with one fair English cue per form", () => {
  const catalog = fixture();
  const board = composeMorphologyMatchBoard(catalog, request({
    itemRefs: catalog.items.map(({ id, revision }) => ({ id, revision })),
    cueRefs: catalog.cues.map(({ id, revision }) => ({ id, revision }))
  }));

  assert.equal(board.schemaVersion, MORPHOLOGY_MATCH_BOARD_SCHEMA);
  assert.equal(board.forms.length, 3);
  assert.equal(board.cues.length, 3);
  assert.ok(Object.isFrozen(board));
  assert.ok(Object.isFrozen(board.forms));
  assert.deepEqual(
    board,
    composeMorphologyMatchBoard(catalog, request({
      itemRefs: catalog.items.map(({ id, revision }) => ({ id, revision })),
      cueRefs: catalog.cues.map(({ id, revision }) => ({ id, revision }))
    }))
  );
  assert.ok(board.cues.every((cue, index) => (
    cue.targetItemRef.id !== board.forms[index].itemRef.id
  )), "the two columns must not reveal answers by row position");
  for (const cue of board.cues) {
    assert.ok(cue.presentation.naturalTranslationEn);
    assert.ok(cue.presentation.teachingLabelEn);
    const correct = evaluateMorphologyMatchPair(board, {
      cueRef: cue.cueRef,
      itemRef: cue.targetItemRef
    });
    assert.equal(correct.correct, true);
    const distractor = board.forms.find((form) => form.itemRef.id !== cue.targetItemRef.id);
    assert.equal(evaluateMorphologyMatchPair(board, {
      cueRef: cue.cueRef,
      itemRef: distractor.itemRef
    }).correct, false);
  }
});

test("keeps natural English separate from the teaching label used to disambiguate a board", () => {
  const catalog = fixture();
  catalog.cues[0].presentation.naturalTranslationEn = "You are reading now.";
  catalog.cues[1].presentation.naturalTranslationEn = "You are reading now.";
  catalog.cues[0].presentation.teachingLabelEn = "first person singular · present";
  catalog.cues[1].presentation.teachingLabelEn = "second person singular · present";

  const board = composeMorphologyMatchBoard(catalog, request());
  const repeatedNaturalTranslations = board.cues.filter((cue) => (
    cue.presentation.naturalTranslationEn === "You are reading now."
  ));
  assert.equal(repeatedNaturalTranslations.length, 2);
  assert.equal(
    new Set(repeatedNaturalTranslations.map((cue) => cue.presentation.teachingLabelEn)).size,
    2
  );
});

test("rejects match boards whose selected cues do not map one-to-one onto displayed forms", () => {
  const catalog = fixture();
  catalog.cues.push({
    ...clone(catalog.cues[0]),
    id: "cue.cs.cist.speaker.alternate",
    key: "read.current.speaker.singular.alternate",
    presentation: {
      ...clone(catalog.cues[0].presentation),
      contextEn: "The current reader is the speaker in an alternate reviewed scene."
    }
  });
  const selectedCues = [catalog.cues[0], catalog.cues[1], catalog.cues[3]]
    .map(({ id, revision }) => ({ id, revision }));
  assert.throws(
    () => composeMorphologyMatchBoard(catalog, request({ cueRefs: selectedCues })),
    assertCode("MORPH_MATCH_BOARD_NOT_BIJECTIVE")
  );
});

test("rejects invalid option counts and cues from another family", () => {
  assert.throws(
    () => composeMorphologyRound(fixture(), request({ optionCount: 1 })),
    assertCode("MORPH_OPTION_COUNT_INVALID")
  );

  const catalog = fixture();
  addSecondFamily(catalog, { sharedSurface: "pije", explicitAmbiguity: false });
  assert.throws(
    () => composeMorphologyRound(catalog, request({
      cueRef: { id: "cue.cs.pit.speaker", revision: 1 }
    })),
    assertCode("MORPH_CUE_FAMILY_MISMATCH")
  );
});
