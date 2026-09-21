import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  sharedPracticeAxes,
  projectPracticeCompass
} from "../../../apps/language-runtime/static/source/practice-compass.mjs";

const catalogUrl = new URL("../../../apps/languages/catalog.json", import.meta.url);
const observedAt = "2026-01-01T12:00:00.000Z";
const dimensions = 384;
const unit = (index) => Array.from({ length: dimensions }, (_, coordinate) => Number(coordinate === index));
const unavailable = (reason) => ({ available: false, value: null, reason });

function axisSummary(axis) {
  const { id, practice, independent, practiceWeight, independentWeight, mappedItems, independentItems } = axis;
  return { id, practice, independent, practiceWeight, independentWeight, mappedItems, independentItems };
}

function item(courseId, itemId, evidence, correct, {
  exposures = 1, vector = unit(0), bankId = "words", gameId = "sound-quasar"
} = {}) {
  return {
    identity: { courseId, gameId, bankId, itemId },
    vector,
    history: {
      exposures, lastSeenAt: observedAt, lastEvidence: evidence, lastCorrect: correct,
      ...(correct !== null ? { lastAttemptAt: observedAt } : {}),
      ...(evidence === "independent" && correct === true
        ? { independentSuccesses: exposures, lastIndependentAt: observedAt } : {}),
      ...(evidence === "assisted"
        ? { assistedSuccesses: correct ? exposures : 0, lastAssistedAt: observedAt } : {})
    }
  };
}

function comparison(projection) {
  return {
    axes: projection.axes.map(axisSummary), status: projection.status, counts: projection.counts,
    unmapped: projection.unmapped.map(({ identity, reason }) => ({
      gameId: identity.gameId, bankId: identity.bankId, itemId: identity.itemId, reason
    }))
  };
}

/** Controlled vectors test the shared evidence projection; no model is loaded. */
export async function runSemanticDiagnostic({ profilesPath, root } = {}) {
  const catalog = JSON.parse(await readFile(catalogUrl, "utf8"));
  const courseIds = catalog.courses?.map((course) => course.id);
  if (!Array.isArray(courseIds) || !courseIds.length
      || courseIds.some((id) => typeof id !== "string" || !id)
      || new Set(courseIds).size !== courseIds.length) {
    throw new Error("Semantic diagnostic requires unique registered course IDs.");
  }
  if (sharedPracticeAxes.length < 3) throw new Error("Shared practice axes are unavailable.");
  const axisVectors = Object.fromEntries(sharedPracticeAxes.map((axis, index) => [
    axis.id, index === 1 ? unit(0).map((value, coordinate) => value * 0.8 + Number(coordinate === 1) * 0.6)
      : unit(index)
  ]));
  const project = (courseId, items, options = {}) => projectPracticeCompass({
    courseId, items, axisVectors, ...options
  });
  const courseId = courseIds[0];
  const exposure = item(courseId, "exposure", "exposure", null);
  const assisted = item(courseId, "assisted", "assisted", true);
  const success = item(courseId, "independent-success", "independent", true);
  const error = item(courseId, "independent-error", "independent", false);
  const missing = item(courseId, "missing-vector", "independent", false, { vector: null });
  const exposureProjection = project(courseId, [exposure]);
  const assistedProjection = project(courseId, [assisted]);
  const successProjection = project(courseId, [success]);
  const errorProjection = project(courseId, [error]);
  const duplicateProjection = project(courseId, [success, success, success]);
  const repeatedProjection = project(courseId, [
    item(courseId, "independent-success", "independent", true, { exposures: 100_000 })
  ]);
  const missingProjection = project(courseId, [missing]);
  const noAxesProjection = project(courseId, [success], { axisVectors: {} });
  const unassessedProjection = project(courseId, [{ ...success, history: {} }]);
  const partialProjection = project(courseId, [success], { partial: true });
  const separateIdentities = project(courseId, [
    success,
    item(courseId, "independent-success", "independent", true, { bankId: "sentences" }),
    item(courseId, "independent-success", "independent", true, { gameId: "other-game" })
  ]);
  const fixtureItems = [exposure, assisted, success, error, missing, success];
  const courseComparisons = courseIds.map((id) => ({
    courseId: id,
    ...comparison(project(id, fixtureItems.map((entry) => ({
      ...entry, identity: { ...entry.identity, courseId: id }
    }))))
  }));
  const direct = (projection) => projection.axes[0];
  const related = successProjection.axes[1];
  const unrelated = successProjection.axes[2];
  let foreignCourseRejected = false;
  try {
    project(courseId, [{ ...success, identity: { ...success.identity, courseId: "foreign-course" } }]);
  } catch (error) {
    foreignCourseRejected = error instanceof TypeError;
  }
  const checks = [
    {
      id: "one-common-seven-axis-definition",
      passed: sharedPracticeAxes.length === 7 && courseComparisons.every((result) =>
        isDeepStrictEqual(result.axes.map((axis) => axis.id), sharedPracticeAxes.map((axis) => axis.id))),
      observed: { courseIds, axisIds: sharedPracticeAxes.map((axis) => axis.id) }
    },
    {
      id: "completed-exposure-maps-practice-only",
      passed: direct(exposureProjection).practice > 0 && direct(exposureProjection).independent === 0
        && exposureProjection.counts.independentItems === 0,
      observed: axisSummary(direct(exposureProjection))
    },
    {
      id: "assisted-response-adds-no-independent-evidence",
      passed: direct(assistedProjection).practice > 0 && direct(assistedProjection).independent === 0
        && direct(assistedProjection).independentWeight === 0,
      observed: axisSummary(direct(assistedProjection))
    },
    {
      id: "independent-success-maps-both-evidence-rings",
      passed: direct(successProjection).independent > 0
        && direct(successProjection).practiceWeight === direct(successProjection).independentWeight,
      observed: axisSummary(direct(successProjection))
    },
    {
      id: "independent-error-records-assessment-presence",
      passed: direct(errorProjection).independent > 0
        && isDeepStrictEqual(errorProjection.axes, successProjection.axes),
      observed: { ...axisSummary(direct(errorProjection)), interpretation:
        "An independent error is assessment evidence; this coverage map does not measure correctness." }
    },
    {
      id: "duplicate-task-identity-is-idempotent",
      passed: isDeepStrictEqual(duplicateProjection, successProjection),
      observed: { suppliedRows: 3, countedItems: duplicateProjection.counts.encounteredItems }
    },
    {
      id: "repeated-encounters-cannot-inflate-one-identity",
      passed: isDeepStrictEqual(repeatedProjection, successProjection),
      observed: { repeatedExposures: 100_000, countedItems: repeatedProjection.counts.encounteredItems }
    },
    {
      id: "controlled-related-topic-contribution-is-attenuated",
      passed: related.independentWeight > 0 && related.independentWeight < direct(successProjection).independentWeight
        && unrelated.independentWeight === 0,
      observed: { direct: axisSummary(direct(successProjection)), related: axisSummary(related),
        unrelated: axisSummary(unrelated) }
    },
    {
      id: "missing-item-vector-stays-explicitly-unmapped",
      passed: missingProjection.status === "unavailable" && missingProjection.counts.unmappedItems === 1
        && missingProjection.counts.mappedItems === 0 && missingProjection.unmapped[0]?.reason === "vector-unavailable"
        && missingProjection.axes.every((axis) => axis.practice === null && axis.independent === null),
      observed: comparison(missingProjection)
    },
    {
      id: "missing-axis-vectors-remain-unavailable",
      passed: noAxesProjection.status === "unavailable"
        && noAxesProjection.unmapped[0]?.reason === "axis-vectors-unavailable"
        && noAxesProjection.axes.every((axis) => axis.practice === null && axis.independent === null),
      observed: comparison(noAxesProjection)
    },
    {
      id: "unassessed-items-receive-no-projected-evidence",
      passed: unassessedProjection.counts.mappedItems === 0
        && unassessedProjection.unmapped[0]?.reason === "no-recorded-evidence",
      observed: comparison(unassessedProjection)
    },
    {
      id: "partial-input-remains-labelled-partial",
      passed: partialProjection.status === "partial" && isDeepStrictEqual(partialProjection.axes, successProjection.axes),
      observed: { status: partialProjection.status }
    },
    {
      id: "game-and-bank-identities-remain-separate",
      passed: separateIdentities.counts.encounteredItems === 3
        && direct(separateIdentities).practiceWeight === 3 * direct(successProjection).practiceWeight,
      observed: { counts: separateIdentities.counts, axis: axisSummary(direct(separateIdentities)) }
    },
    {
      id: "cross-course-evidence-is-rejected",
      passed: foreignCourseRejected,
      observed: { foreignCourseRejected }
    },
    {
      id: "identical-evidence-maps-identically-for-every-course",
      passed: courseComparisons.every(({ courseId: ignored, ...result }) => {
        const { courseId: firstIgnored, ...first } = courseComparisons[0];
        return isDeepStrictEqual(result, first);
      }),
      observed: { comparedCourses: courseIds.length }
    }
  ];
  const finalProjection = project(courseId, fixtureItems);
  const realProfiles = profilesPath ? await (await import('../shared/mapping-audit.mjs')).replayCapturedProfiles({ root, profilesPath }) : null;
  if (realProfiles) checks.push({ id: 'real-profile-replay-completes-and-reconciles', passed: realProfiles.profiles.every(profile => profile.completed),
    observed: realProfiles.profiles.map(profile => ({ courseId: profile.courseId, accounting: profile.accounting })) });
  return {
    schemaVersion: 1,
    diagnostic: "shared-practice-compass-projection",
    realProfiles,
    status: checks.every((check) => check.passed) ? "passed" : "failed",
    fixture: {
      id: "shared-practice-controlled-vectors-v1", observedAt, suppliedItemsPerCourse: fixtureItems.length,
      distinctItemsPerCourse: finalProjection.counts.encounteredItems, embeddingCoordinateCount: dimensions,
      randomSeed: null, reproducibility: "Fixed evidence and assigned vectors; no randomness, model inference or network access."
    },
    source: {
      courseIds, axisCount: sharedPracticeAxes.length, axes: sharedPracticeAxes,
      implementation: "projectPracticeCompass", evaluatedEmbeddingModelId: null,
      evidence: "Common course/game/bank/item content-history summaries; no course-specific Stats configuration."
    },
    checks,
    metrics: {
      passedChecks: checks.filter((check) => check.passed).length, totalChecks: checks.length,
      finalTopicSummaries: finalProjection.axes.map(axisSummary), finalCounts: finalProjection.counts,
      courseComparisons,
      probabilityCalibration: unavailable("Practice and independent evidence coverage are not knowledge or recall probabilities."),
      itemKnowledgeError: unavailable("The shared topic map does not estimate individual item knowledge."),
      independentResponseAccuracy: unavailable("Independent assessment presence includes errors and does not measure accuracy."),
      forgettingEstimationError: unavailable("Distinct encountered-task coverage does not estimate forgetting or retention."),
      embeddingQuality: unavailable("This diagnostic uses controlled vectors, not model-generated embeddings.")
    },
    limitations: [
      "This diagnostic calls the shared projection with synthetic public history entries; it does not exercise browser catalog loading, cancellation or IndexedDB persistence.",
      "Every registered course uses the same seven axes and projection rules; course, game, bank and item identities still isolate evidence.",
      "The two bounded rings describe practice and independent assessment presence, not knowledge, correctness or calibrated recall.",
      "Persisted history summaries cannot recover an older independent failure after newer supported evidence has replaced the last-response fields.",
      "Repeated encounters cap each identity's display contribution; the cap is a visualization rule, not an empirical learning law.",
      "Assigned vector geometry checks projection behavior, not actual embedding quality, topic relevance, grammar or pronunciation.",
      "Missing vectors remain explicitly unmapped; similarity never manufactures evidence for an unattempted item.",
      "Previously archived Czech semantic-score reports describe the retired diagnostic and are not directly comparable to these shared evidence-map results."
    ]
  };
}
