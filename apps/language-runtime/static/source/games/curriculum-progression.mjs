const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

function requireValue(condition, message) {
  if (!condition) throw new TypeError(`Course curriculum: ${message}`);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function plainText(value, label, maximum = 500) {
  requireValue(typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum,
    `${label} must be nonempty plain text.`);
  const result = value.normalize("NFC").trim();
  requireValue(!/[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(result),
    `${label} contains markup or control characters.`);
  return result;
}

function identifier(value, label) {
  const result = plainText(value, label, 160);
  requireValue(ID.test(result), `${label} must be a stable lowercase ID.`);
  return result;
}

function level(value, label) {
  requireValue([1, 2, 3].includes(value), `${label} must be 1, 2, or 3.`);
  return value;
}

export function normalizeCurriculum(value, label = "curriculum") {
  if (value === undefined) return undefined;
  requireValue(object(value) && value.schemaVersion === 1, `${label} must use schemaVersion 1.`);
  requireValue(Array.isArray(value.objectives) && value.objectives.length > 0 && value.objectives.length <= 100,
    `${label}.objectives must contain 1–100 objectives.`);
  const ids = new Set();
  const objectives = value.objectives.map((objective, index) => {
    requireValue(object(objective), `${label}.objectives[${index}] must be an object.`);
    const id = identifier(objective.id, `${label}.objectives[${index}].id`);
    requireValue(!ids.has(id), `${label} repeats objective ${id}.`);
    ids.add(id);
    return Object.freeze({ id, label: plainText(objective.label, `${id}.label`, 180),
      difficulty: level(objective.difficulty, `${id}.difficulty`) });
  });
  return Object.freeze({ schemaVersion: 1, objectives: Object.freeze(objectives) });
}

/** Metadata is optional for unchanged banks and complete for declared curricula. */
export function normalizeCurriculumItem(item, curriculum, label = "item") {
  if (!curriculum) {
    requireValue(!["objectiveId", "phase", "context", "explanation", "graded"].some(key => item[key] !== undefined),
      `${label} needs a declared curriculum before adding instructional metadata.`);
    return item.difficulty === undefined ? {} : { difficulty: level(item.difficulty, `${label}.difficulty`) };
  }
  const objectiveId = identifier(item.objectiveId, `${label}.objectiveId`);
  const objective = curriculum.objectives.find(({ id }) => id === objectiveId);
  requireValue(objective, `${label} names an undeclared objective ${objectiveId}.`);
  const difficulty = level(item.difficulty, `${label}.difficulty`);
  requireValue(difficulty === objective.difficulty, `${label} difficulty must match its objective.`);
  requireValue(["practice", "transfer"].includes(item.phase), `${label}.phase must be practice or transfer.`);
  requireValue(item.graded === undefined || typeof item.graded === "boolean", `${label}.graded must be boolean.`);
  requireValue(item.graded !== false || item.phase === "practice", `${label} ungraded items must remain practice.`);
  return { difficulty, objectiveId, phase: item.phase,
    ...(item.graded === undefined ? {} : { graded: item.graded }),
    context: plainText(item.context, `${label}.context`),
    explanation: plainText(item.explanation, `${label}.explanation`) };
}

export function validateCurriculumCoverage(items, curriculum, { label = "catalog", minimumPractice = 2 } = {}) {
  if (!curriculum) return;
  for (const objective of curriculum.objectives) {
    const owned = items.filter(item => item.objectiveId === objective.id && item.graded !== false);
    requireValue(owned.filter(item => item.phase === "practice").length >= minimumPractice,
      `${label} objective ${objective.id} needs at least ${minimumPractice} distinct practice items.`);
    requireValue(owned.some(item => item.phase === "transfer"),
      `${label} objective ${objective.id} needs an unfamiliar transfer item.`);
  }
}
