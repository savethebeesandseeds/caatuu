import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAttemptToEvidence,
  boundedSemanticHistoryPolicy,
  compactSemanticEvidence,
  migrateSemanticLedger,
  normalizeSemanticAttempt,
  projectSemanticEvidence,
  rebuildSemanticEvidence,
  semanticAttemptFingerprint,
  semanticAttemptsEqual,
  semanticKernel,
  summarizeTemporalEvidence
} from "../../../../apps/languages/czech/static/semantic-learning-core.mjs";

function attempt(id, score, options = {}) {
  return normalizeSemanticAttempt({
    id,
    activityId: "test-game",
    itemId: options.itemId || "item-1",
    occurredAt: options.occurredAt || "2026-07-22T10:00:00.000Z",
    signals: [{
      conceptId: options.conceptId || "cz.test.meaning",
      statementRevision: options.statementRevision || "1",
      kind: "meaning",
      locale: "en",
      text: options.text || "Understands an everyday travel expression.",
      score,
      coverageWeight: options.coverageWeight ?? 1,
      masteryWeight: options.masteryWeight ?? 1
    }]
  });
}

function evidenceFrom(attempts) {
  return rebuildSemanticEvidence(attempts);
}

function axisPack(vector, options = {}) {
  return {
    id: options.packId || "test-radar",
    version: options.version || "1",
    modelId: "test-model",
    axes: [{
      id: options.axisId || "travel",
      label: options.label || "Travel",
      probe: { locale: "en", text: "Understands everyday travel language.", revision: "1" },
      vector
    }]
  };
}

test("exposure-only signals raise coverage without inventing assessed mastery", () => {
  const exposure = attempt("exposure-1", null, { coverageWeight: 0.5, masteryWeight: 9 });
  assert.equal(exposure.signals[0].score, null);
  assert.equal(exposure.signals[0].masteryWeight, 0);

  const [node] = evidenceFrom([exposure]);
  assert.equal(node.exposureWeight, 0.5);
  assert.equal(node.assessedWeight, 0);
  const [axis] = projectSemanticEvidence([{ ...node, vector: [1, 0] }], axisPack([1, 0])).axes;
  assert.equal(axis.mastery, null);
  assert.equal(axis.assessmentConfidence, 0);
  assert.ok(axis.coverage > 0);
});

test("relevant successes and failures update lifetime mastery while preserving coverage", () => {
  const successNode = evidenceFrom([attempt("success-1", 1)])[0];
  const success = projectSemanticEvidence([{ ...successNode, vector: [1, 0] }], axisPack([1, 0])).axes[0];
  assert.ok(success.mastery > 0.5);
  assert.ok(success.coverage > 0);

  const mixedNode = evidenceFrom([attempt("success-1", 1), attempt("failure-1", 0)])[0];
  const mixed = projectSemanticEvidence([{ ...mixedNode, vector: [1, 0] }], axisPack([1, 0])).axes[0];
  assert.ok(mixed.mastery < success.mastery);
  assert.ok(mixed.coverage > success.coverage);
  assert.equal(mixed.assessedWeight, 2);
});

test("unrelated evidence below the similarity floor contributes nothing", () => {
  const [node] = evidenceFrom([attempt("success-1", 1)]);
  const [axis] = projectSemanticEvidence([{ ...node, vector: [1, 0] }], axisPack([0, 1])).axes;
  assert.equal(axis.mastery, null);
  assert.equal(axis.coverage, 0);
  assert.equal(axis.neighborCount, 0);
  assert.equal(semanticKernel(0), 0);
});

test("vector magnitude cannot encode learner strength", () => {
  const [node] = evidenceFrom([attempt("success-1", 1)]);
  const unit = projectSemanticEvidence([{ ...node, vector: [1, 0] }], axisPack([1, 0])).axes[0];
  const scaled = projectSemanticEvidence([{ ...node, vector: [200, 0] }], axisPack([50, 0])).axes[0];
  assert.equal(scaled.mastery, unit.mastery);
  assert.equal(scaled.coverage, unit.coverage);
  assert.equal(scaled.assessedWeight, unit.assessedWeight);
});

test("changing disposable radar axes does not mutate persistent evidence", () => {
  const nodes = evidenceFrom([attempt("success-1", 1)]).map((node) => ({ ...node, vector: [1, 0] }));
  const before = structuredClone(nodes);
  const relevant = projectSemanticEvidence(nodes, axisPack([1, 0], { packId: "radar-a" }));
  const unrelated = projectSemanticEvidence(nodes, axisPack([0, 1], { packId: "radar-b" }));
  assert.ok(relevant.axes[0].coverage > 0);
  assert.equal(unrelated.axes[0].coverage, 0);
  assert.deepEqual(nodes, before);
});

test("axis packs stay bounded and use unique stable ids", () => {
  const [node] = evidenceFrom([attempt("success-1", 1)]);
  const projected = [{ ...node, vector: [1, 0] }];
  const makeAxis = (id) => ({
    id,
    label: id,
    probe: { locale: "en", text: `Understands ${id}.`, revision: "1" },
    vector: [1, 0]
  });
  assert.throws(
    () => projectSemanticEvidence(projected, {
      id: "too-many-axes",
      axes: Array.from({ length: 13 }, (_, index) => makeAxis(`axis-${index}`))
    }),
    /cannot contain more than 12 axes/
  );
  assert.throws(
    () => projectSemanticEvidence(projected, {
      id: "duplicate-axes",
      axes: [makeAxis("travel"), makeAxis("travel")]
    }),
    /duplicate axis id travel/
  );
});

test("evidence rebuild is deterministic and duplicate attempt ids apply once", () => {
  const first = attempt("stable-attempt", 1);
  const once = evidenceFrom([first]);
  const twice = evidenceFrom([first, structuredClone(first)]);
  assert.deepEqual(twice, once);
  assert.equal(twice[0].attemptCount, 1);
});

test("an attempt id cannot be reused for a different immutable event", () => {
  const first = attempt("stable-attempt", 1);
  const conflicting = attempt("stable-attempt", 0);
  assert.throws(
    () => evidenceFrom([first, conflicting]),
    /different immutable events/
  );
});

test("immutable attempt equality ignores JSON object insertion order", () => {
  const common = {
    id: "stable-attempt",
    activityId: "test-game",
    itemId: "item-1",
    occurredAt: "2026-07-22T10:00:00.000Z",
    signals: [{
      conceptId: "cz.test.meaning",
      statementRevision: "1",
      kind: "meaning",
      locale: "en",
      text: "Understands an everyday travel expression.",
      score: 1,
      coverageWeight: 1,
      masteryWeight: 1
    }]
  };
  const first = normalizeSemanticAttempt({ ...common, item: { a: 1, b: 2 }, context: { x: true, y: false } });
  const reordered = normalizeSemanticAttempt({ ...common, item: { b: 2, a: 1 }, context: { y: false, x: true } });
  assert.equal(semanticAttemptsEqual(first, reordered), true);
  assert.equal(semanticAttemptFingerprint(first), semanticAttemptFingerprint(reordered));
  assert.equal(evidenceFrom([first, reordered])[0].attemptCount, 1);
});

test("compacted semantic facts preserve exact lifetime evidence and projections", () => {
  const attempts = Array.from({ length: 18 }, (_, index) => attempt(
    `attempt-${String(index).padStart(2, "0")}`,
    index % 3 === 2 ? null : index % 2,
    {
      conceptId: index % 2 ? "cz.test.travel" : "cz.test.verbs",
      text: index % 2
        ? "Understands an everyday travel expression."
        : "Recognizes a common Czech verb.",
      itemId: `item-${index}`,
      coverageWeight: index % 3 === 2 ? 0.25 : 0.5,
      masteryWeight: 0.5,
      occurredAt: new Date(Date.UTC(2026, 6, 22, index)).toISOString()
    }
  ));
  const full = rebuildSemanticEvidence(attempts);
  const firstCheckpoint = compactSemanticEvidence([], attempts.slice(0, 7));
  const secondCheckpoint = compactSemanticEvidence(firstCheckpoint, attempts.slice(7, 13));
  const restored = rebuildSemanticEvidence(attempts.slice(13), { baseline: secondCheckpoint });
  assert.deepEqual(restored, full);

  const withVectors = (nodes) => nodes.map((node) => ({ ...node, vector: [1, 0] }));
  assert.deepEqual(
    projectSemanticEvidence(withVectors(restored), axisPack([1, 0])),
    projectSemanticEvidence(withVectors(full), axisPack([1, 0]))
  );
});

test("evidence diagnostics and individual attempts have hard size limits", () => {
  assert.ok(
    boundedSemanticHistoryPolicy.embeddingTarget
      >= boundedSemanticHistoryPolicy.maximumStatementKeys + 12,
    "the steady embedding cache must hold every bounded capability and one full axis pack"
  );
  const attempts = Array.from({ length: boundedSemanticHistoryPolicy.maximumEvidenceReferences + 8 }, (_, index) => (
    attempt(`reference-${index}`, 1, {
      itemId: `item-${String(index).padStart(3, "0")}`,
      occurredAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString()
    })
  ));
  const [node] = rebuildSemanticEvidence(attempts);
  assert.equal(node.itemIds.length, boundedSemanticHistoryPolicy.maximumEvidenceReferences);
  assert.equal(node.itemIdsTruncated, true);

  const base = {
    id: "bounded-attempt",
    activityId: "test-game",
    itemId: "item-1",
    occurredAt: "2026-07-22T10:00:00.000Z"
  };
  const signal = {
    conceptId: "cz.test.meaning",
    kind: "meaning",
    locale: "en",
    text: "Understands an everyday travel expression.",
    score: 1
  };
  assert.throws(
    () => normalizeSemanticAttempt({
      ...base,
      signals: Array.from({ length: boundedSemanticHistoryPolicy.maximumSignalsPerAttempt + 1 }, (_, index) => ({
        ...signal,
        conceptId: `${signal.conceptId}-${index}`
      }))
    }),
    /more than .* signals/
  );
  assert.throws(
    () => normalizeSemanticAttempt({
      ...base,
      context: { oversized: "x".repeat(boundedSemanticHistoryPolicy.maximumAttemptCharacters) },
      signals: [signal]
    }),
    /too large to retain safely/
  );
});

test("new attempts require an explicit stable capability id while legacy rows remain migratable", () => {
  const base = {
    id: "legacy-attempt",
    activityId: "legacy-game",
    itemId: "legacy-item",
    occurredAt: "2026-07-22T10:00:00.000Z",
    signals: [{
      kind: "meaning",
      locale: "en",
      text: "Understands a legacy sentence.",
      score: 1
    }]
  };
  assert.throws(() => normalizeSemanticAttempt(base), /stable conceptId/);
  const migrated = normalizeSemanticAttempt(base, {
    enforceStorageLimits: false,
    allowDerivedConceptId: true
  });
  assert.match(migrated.signals[0].conceptId, /^legacy-statement-/);
});

test("new safety caps do not make oversized legacy attempts unreadable during migration", () => {
  const legacy = {
    id: "legacy-oversized-attempt",
    activityId: "legacy-game",
    itemId: "legacy-item",
    occurredAt: "2026-07-22T10:00:00.000Z",
    context: { oldPayload: "x".repeat(boundedSemanticHistoryPolicy.maximumAttemptCharacters) },
    signals: Array.from(
      { length: boundedSemanticHistoryPolicy.maximumSignalsPerAttempt + 1 },
      (_, index) => ({
        conceptId: `legacy.concept.${index}`,
        kind: "meaning",
        locale: "en",
        text: `Understands legacy capability ${index}.`,
        score: 1
      })
    )
  };
  assert.throws(() => normalizeSemanticAttempt(legacy), /more than .* signals/);
  const normalized = normalizeSemanticAttempt(legacy, { enforceStorageLimits: false });
  assert.equal(normalized.signals.length, boundedSemanticHistoryPolicy.maximumSignalsPerAttempt + 1);
  assert.equal(rebuildSemanticEvidence([legacy], {
    normalizeOptions: { enforceStorageLimits: false }
  }).length, normalized.signals.length);
});

test("temporal performance summaries stay fixed-size and survive chunked compaction", () => {
  const attempts = Array.from({ length: 900 }, (_, index) => attempt(`timed-${index}`, index % 4 ? 1 : 0, {
    occurredAt: new Date(Date.UTC(2023, 0, 1 + index)).toISOString()
  }));
  const [full] = rebuildSemanticEvidence(attempts);
  const checkpoint = compactSemanticEvidence([], attempts.slice(0, 600));
  const [restored] = rebuildSemanticEvidence(attempts.slice(600), { baseline: checkpoint });
  assert.deepEqual(restored, full);
  for (const scale of ["daily", "weekly", "monthly"]) {
    assert.ok(full.temporal[scale].length <= boundedSemanticHistoryPolicy.temporalBucketSlots);
  }

  const daily = summarizeTemporalEvidence(full, {
    scale: "daily",
    periods: 7,
    asOfMs: Date.UTC(2025, 5, 18)
  });
  assert.equal(daily.exact, true);
  assert.equal(daily.attemptCount, 7);
  assert.equal(daily.assessedAttemptCount, 7);
  assert.equal(summarizeTemporalEvidence(full, {
    scale: "daily",
    periods: 7,
    asOfMs: Date.UTC(2023, 0, 8)
  }).exact, false);
});

test("ledger v1 migration preserves lifetime truth without inventing old recency", () => {
  const [oldNode] = rebuildSemanticEvidence([
    attempt("old-1", 1, { occurredAt: "2026-01-01T10:00:00.000Z" }),
    attempt("old-2", 0, { occurredAt: "2026-01-02T10:00:00.000Z" })
  ]);
  const { temporal: _discarded, ...ledgerV1 } = oldNode;
  const [migrated] = migrateSemanticLedger([{ ...ledgerV1, ledgerVersion: 1 }], 1);
  assert.equal(migrated.attemptCount, oldNode.attemptCount);
  assert.equal(migrated.scoreSum, oldNode.scoreSum);
  assert.deepEqual(migrated.temporal.daily, []);
  assert.equal(migrated.temporal.exactAfterMs, oldNode.lastOccurredAtMs);

  const incomplete = summarizeTemporalEvidence(migrated, {
    scale: "daily",
    periods: 16,
    asOfMs: Date.parse("2026-01-03T10:00:00.000Z")
  });
  assert.equal(incomplete.exact, false);
  assert.equal(incomplete.attemptCount, 0);
  const completeLaterWindow = summarizeTemporalEvidence(migrated, {
    scale: "daily",
    periods: 2,
    asOfMs: Date.parse("2026-02-01T10:00:00.000Z")
  });
  assert.equal(completeLaterWindow.exact, true);
});

test("a migrated legacy event exactly on a time-window boundary remains inexact", () => {
  const [oldNode] = rebuildSemanticEvidence([
    attempt("boundary", 1, { occurredAt: "2026-01-01T00:00:00.000Z" })
  ]);
  const { temporal: _discarded, ...ledgerV1 } = oldNode;
  const [migrated] = migrateSemanticLedger([{ ...ledgerV1, ledgerVersion: 1 }], 1);
  for (const [scale, periods, asOfMs] of [
    ["daily", 1, Date.parse("2026-01-01T12:00:00.000Z")],
    ["weekly", 1, Date.parse("2026-01-03T12:00:00.000Z")],
    ["monthly", 1, Date.parse("2026-01-15T12:00:00.000Z")]
  ]) {
    const summary = summarizeTemporalEvidence(migrated, { scale, periods, asOfMs });
    assert.equal(summary.exact, false, `${scale} must not claim the omitted boundary event is represented`);
    assert.equal(summary.attemptCount, 0);
  }
});

test("a changed statement requires a new statement revision", () => {
  const first = attempt("first", 1);
  const current = applyAttemptToEvidence(null, first, first.signals[0]);
  const changed = attempt("second", 1, { text: "Understands a changed capability statement." });
  assert.throws(
    () => applyAttemptToEvidence(current, changed, changed.signals[0]),
    /statement revision bump/
  );
  const revised = attempt("third", 1, {
    text: "Understands a changed capability statement.",
    statementRevision: "2"
  });
  assert.notEqual(revised.signals[0].statementKey, first.signals[0].statementKey);
});

test("invalid vector spaces fail loudly without touching learner evidence", () => {
  const [node] = evidenceFrom([attempt("success-1", 1)]);
  assert.throws(
    () => projectSemanticEvidence([{ ...node, vector: [1, 0, 0] }], axisPack([1, 0])),
    /dimension mismatch/
  );
  assert.throws(
    () => projectSemanticEvidence([{ ...node, vector: [1, 0] }], axisPack([0, 0])),
    /zero norm/
  );
});
