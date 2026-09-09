export const NOUN_LANDING_SCHEMA_VERSION = "caatuu-grammar-gravity-nouns-v2";

const GAME_ID = "grammar-gravity";
const FALL_DURATION_MS = 10_000;
const TOKEN_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
const LANE_IMAGE_PATTERN = /^\/assets\/micelaneous\/[a-z0-9]+(?:[_-][a-z0-9]+)*\.png$/u;
const REVIEW_STATES = new Set(["native-review-required", "approved"]);
const LICENSE_STATES = new Set([
  "release-review-required", "release-cleared", "legacy-review-required"
]);

function exactKeys(value, expected, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${location} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${location} must contain exactly: ${wanted.join(", ")}.`);
  }
}

function text(value, location) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${location} must be a non-empty string.`);
  }
  return value.normalize("NFC").trim();
}

function token(value, location) {
  const result = text(value, location);
  if (!TOKEN_PATTERN.test(result)) throw new Error(`${location} must be a lowercase token.`);
  return result;
}

function id(value, location) {
  const result = text(value, location);
  if (!ID_PATTERN.test(result)) {
    throw new Error(`${location} must be a stable lowercase dotted or dashed ID.`);
  }
  return result;
}

function revision(value, location) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${location} must be a positive integer.`);
  return value;
}

function locale(value, location) {
  const result = text(value, location);
  try {
    return Intl.getCanonicalLocales(result)[0];
  } catch {
    throw new Error(`${location} must be a valid BCP 47 language tag.`);
  }
}

function normalizedText(value, language) {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase(language);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function reviewMetadata(value) {
  exactKeys(value, ["status", "reviewer", "reviewedAt", "notes"], "review");
  if (!REVIEW_STATES.has(value.status)) {
    throw new Error("review.status must be native-review-required or approved.");
  }
  const notes = text(value.notes, "review.notes");
  if (value.status === "approved") {
    return {
      status: value.status,
      reviewer: text(value.reviewer, "review.reviewer"),
      reviewedAt: text(value.reviewedAt, "review.reviewedAt"),
      notes
    };
  }
  if (value.reviewer !== null || value.reviewedAt !== null) {
    throw new Error("Unapproved noun content cannot name a reviewer or review date.");
  }
  return { status: value.status, reviewer: null, reviewedAt: null, notes };
}

function licenseMetadata(value) {
  exactKeys(value, ["origin", "status", "spdxExpression", "notes"], "license");
  if (!LICENSE_STATES.has(value.status)) {
    throw new Error("license.status must be release-review-required, release-cleared, or legacy-review-required.");
  }
  if (value.status === "release-cleared") {
    text(value.spdxExpression, "license.spdxExpression");
  } else if (value.spdxExpression !== null) {
    throw new Error("A review-required noun license must keep spdxExpression null.");
  }
  return {
    origin: token(value.origin, "license.origin"),
    status: value.status,
    spdxExpression: value.spdxExpression === null ? null : text(value.spdxExpression, "license.spdxExpression"),
    notes: text(value.notes, "license.notes")
  };
}

// Course JSON is the sole authority for lanes and noun classifications. Nothing
// here infers gender from spelling, translates content, or assumes three lanes.
export function normalizeNounLandingPack(value, options = {}) {
  exactKeys(value, [
    "schemaVersion", "courseId", "gameId", "contentId", "contentRevision",
    "learnerBaseLanguage", "targetLanguage", "englishAuditLanguage", "review",
    "license", "scope", "lanes", "items"
  ], "Noun landing pack");
  if (value.schemaVersion !== NOUN_LANDING_SCHEMA_VERSION) {
    throw new Error(`Noun landing requires schemaVersion ${NOUN_LANDING_SCHEMA_VERSION}.`);
  }
  if (value.gameId !== GAME_ID) throw new Error(`gameId must be ${GAME_ID}.`);
  const courseId = token(value.courseId, "courseId");
  const expectedCourse = token(options.courseId, "expected courseId");
  if (courseId !== expectedCourse) throw new Error(`Noun landing content belongs to ${courseId}, not ${expectedCourse}.`);
  const learnerBaseLanguage = locale(value.learnerBaseLanguage, "learnerBaseLanguage");
  const targetLanguage = locale(value.targetLanguage, "targetLanguage");
  const expectedBase = locale(options.learnerBaseLanguage, "expected learnerBaseLanguage");
  const expectedTarget = locale(options.targetLanguage, "expected targetLanguage");
  if (learnerBaseLanguage !== expectedBase) {
    throw new Error(`Noun landing learner base is ${learnerBaseLanguage}, not ${expectedBase}.`);
  }
  if (targetLanguage !== expectedTarget) {
    throw new Error(`Noun landing target language is ${targetLanguage}, not ${expectedTarget}.`);
  }
  if (value.englishAuditLanguage !== "en") throw new Error("englishAuditLanguage must remain en.");
  if (!Array.isArray(value.lanes) || value.lanes.length < 2 || value.lanes.length > 6) {
    throw new Error("lanes must contain between two and six authored categories.");
  }
  const laneIds = new Set();
  const laneLabels = new Set();
  const lanes = value.lanes.map((lane, index) => {
    const location = `lanes[${index}]`;
    const hasImage = Object.hasOwn(lane ?? {}, "image");
    exactKeys(lane, hasImage ? ["id", "label", "image"] : ["id", "label"], location);
    const laneId = token(lane.id, `${location}.id`);
    const label = text(lane.label, `${location}.label`);
    const key = normalizedText(label, learnerBaseLanguage);
    if (laneIds.has(laneId)) throw new Error(`lanes repeats ID ${laneId}.`);
    if (laneLabels.has(key)) throw new Error(`lanes repeats label ${label}.`);
    laneIds.add(laneId);
    laneLabels.add(key);
    if (hasImage && (typeof lane.image !== "string" || lane.image !== lane.image.trim()
        || !LANE_IMAGE_PATTERN.test(lane.image))) {
      throw new Error(`${location}.image must be a safe PNG path under /assets/micelaneous/.`);
    }
    return { id: laneId, label, ...(hasImage ? { image: lane.image } : {}) };
  });
  if (!Array.isArray(value.items) || value.items.length < lanes.length) {
    throw new Error("items must include at least one noun for every lane.");
  }
  const itemIds = new Set();
  const targetWords = new Set();
  const usedLanes = new Set();
  const items = value.items.map((item, index) => {
    const location = `items[${index}]`;
    exactKeys(item, ["id", "revision", "targetText", "learnerBaseText", "english", "laneId",
      ...(Object.hasOwn(item, "difficulty") ? ["difficulty"] : []),
      ...(Object.hasOwn(item, "acceptedLaneIds") ? ["acceptedLaneIds"] : [])], location);
    if (Object.hasOwn(item, "difficulty") && (!Number.isInteger(item.difficulty) || item.difficulty < 1 || item.difficulty > 3)) {
      throw new Error(`${location}.difficulty must be 1, 2, or 3.`);
    }
    const itemId = id(item.id, `${location}.id`);
    const targetText = text(item.targetText, `${location}.targetText`);
    const learnerBaseText = text(item.learnerBaseText, `${location}.learnerBaseText`);
    const english = text(item.english, `${location}.english`);
    const laneId = token(item.laneId, `${location}.laneId`);
    const targetKey = normalizedText(targetText, targetLanguage);
    if (itemIds.has(itemId)) throw new Error(`items repeats ID ${itemId}.`);
    if (targetWords.has(targetKey)) throw new Error(`items repeats target word ${targetText}.`);
    if (!laneIds.has(laneId)) throw new Error(`${location}.laneId references an undeclared lane ${laneId}.`);
    let acceptedLaneIds;
    if (Object.hasOwn(item, "acceptedLaneIds")) {
      if (!Array.isArray(item.acceptedLaneIds) || !item.acceptedLaneIds.length) {
        throw new Error(`${location}.acceptedLaneIds must be a non-empty array of declared lane IDs.`);
      }
      acceptedLaneIds = Array.from(item.acceptedLaneIds, (value, acceptedIndex) => (
        token(value, `${location}.acceptedLaneIds[${acceptedIndex}]`)
      ));
      if (new Set(acceptedLaneIds).size !== acceptedLaneIds.length
          || acceptedLaneIds.some((value) => !laneIds.has(value))
          || !acceptedLaneIds.includes(laneId)) {
        throw new Error(`${location}.acceptedLaneIds must contain unique declared lanes including its canonical laneId.`);
      }
    }
    if ((learnerBaseLanguage === "en" || learnerBaseLanguage.startsWith("en-")) && learnerBaseText !== english) {
      throw new Error(`${location} must render the exact English audit text for an English-base course.`);
    }
    itemIds.add(itemId);
    targetWords.add(targetKey);
    usedLanes.add(laneId);
    return {
      id: itemId, revision: revision(item.revision, `${location}.revision`), targetText,
      learnerBaseText, english, laneId, ...(item.difficulty === undefined ? {} : { difficulty: item.difficulty }),
      ...(acceptedLaneIds === undefined ? {} : { acceptedLaneIds })
    };
  });
  for (const laneId of laneIds) {
    if (!usedLanes.has(laneId)) throw new Error(`Lane ${laneId} has no authored nouns.`);
  }
  return deepFreeze({
    schemaVersion: NOUN_LANDING_SCHEMA_VERSION, courseId, gameId: GAME_ID,
    contentId: id(value.contentId, "contentId"),
    contentRevision: revision(value.contentRevision, "contentRevision"),
    learnerBaseLanguage, targetLanguage, englishAuditLanguage: "en",
    review: reviewMetadata(value.review), license: licenseMetadata(value.license),
    scope: text(value.scope, "scope"), lanes, items
  });
}

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const sample = Number(random());
    const bounded = Number.isFinite(sample) ? Math.max(0, Math.min(sample, 0.999999999999)) : 0;
    const swap = Math.floor(bounded * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function createNounLandingSession(pack, { random = Math.random, limit, avoidFirstItemId = null,
  durationMs = FALL_DURATION_MS, difficulty = 3 } = {}) {
  const content = normalizeNounLandingPack(pack, {
    courseId: pack?.courseId,
    learnerBaseLanguage: pack?.learnerBaseLanguage,
    targetLanguage: pack?.targetLanguage
  });
  if (typeof random !== "function") throw new Error("random must be a function.");
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) throw new Error("difficulty must be 1, 2, or 3.");
  if (![0, 5000, 10000, 15000, 20000].includes(durationMs)) throw new Error("durationMs must be 0 (infinite), 5000, 10000, 15000, or 20000.");
  const requestedLimit = limit === undefined ? content.items.length : limit;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new Error("limit must be a positive integer.");
  if (avoidFirstItemId !== null && typeof avoidFirstItemId !== "string") {
    throw new Error("avoidFirstItemId must be an item ID string or null.");
  }
  const eligible = content.items.filter(item => item.difficulty === undefined || item.difficulty <= difficulty);
  if (!eligible.length) throw new Error("Noun landing needs eligible content for this difficulty.");
  const candidates = shuffled(eligible, random);
  if (candidates[0]?.id === avoidFirstItemId) {
    const nextIndex = candidates.findIndex((item) => item.id !== avoidFirstItemId);
    if (nextIndex > 0) [candidates[0], candidates[nextIndex]] = [candidates[nextIndex], candidates[0]];
  }
  const [item, ...queue] = candidates.slice(0, requestedLimit);
  return deepFreeze({
    phase: "ready", item, queue, lanes: content.lanes, selectedLane: null,
    elapsedMs: 0, durationMs, correct: null,
    attempts: 0, attemptsByItem: {}, correctCount: 0, streak: 0, bestStreak: 0,
    completed: 0, total: queue.length + 1, review: false
  });
}

export function startNounLanding(session) {
  return session.phase === "ready" ? deepFreeze({ ...session, phase: "falling" }) : session;
}

export function setNounFallDuration(session, durationMs) {
  if (![0, 5000, 10000, 15000, 20000].includes(durationMs)) throw new Error("durationMs must be 0 (infinite), 5000, 10000, 15000, or 20000.");
  if (session.durationMs === durationMs) return session;
  return deepFreeze({ ...session, durationMs,
    elapsedMs: session.durationMs && durationMs ? session.elapsedMs / session.durationMs * durationMs : 0 });
}

export function selectNounLane(session, laneId) {
  if (session.phase !== "falling" || session.selectedLane === laneId
      || !session.lanes.some((lane) => lane.id === laneId)) return session;
  return deepFreeze({ ...session, selectedLane: laneId });
}

export function advanceNounFall(session, deltaMs) {
  if (session.phase !== "falling" || session.durationMs === 0 || !Number.isFinite(deltaMs) || deltaMs <= 0) return session;
  const elapsedMs = Math.min(session.durationMs, session.elapsedMs + deltaMs);
  const advanced = deepFreeze({ ...session, elapsedMs });
  return elapsedMs >= session.durationMs ? landNoun(advanced) : advanced;
}

export function landNoun(session) {
  if (session.phase !== "falling") return session;
  const count = (session.attemptsByItem[session.item.id] || 0) + 1;
  const correct = (session.item.acceptedLaneIds || [session.item.laneId]).includes(session.selectedLane);
  const streak = correct ? session.streak + 1 : 0;
  return deepFreeze({
    ...session, phase: "feedback", correct, elapsedMs: session.durationMs,
    attempts: session.attempts + 1,
    attemptsByItem: { ...session.attemptsByItem, [session.item.id]: count },
    // At most one retry per missed noun: sessions always terminate, even if the
    // learner misses both attempts. "completed" tracks first-pass coverage.
    // Defer review only when another word separates the attempts. A miss at
    // the end of the bank returns in a later cycle instead of repeating now.
    queue: !correct && count === 1 && session.queue.length ? [...session.queue, session.item] : session.queue,
    completed: session.completed + (count === 1 ? 1 : 0),
    correctCount: session.correctCount + (correct ? 1 : 0),
    streak, bestStreak: Math.max(session.bestStreak, streak)
  });
}

export function nextNoun(session) {
  if (session.phase !== "feedback") return session;
  const [item, ...queue] = session.queue;
  return deepFreeze({
    ...session, phase: item ? "falling" : "complete", item: item || null, queue,
    selectedLane: null, elapsedMs: 0, correct: null,
    review: Boolean(item && session.attemptsByItem[item.id])
  });
}
