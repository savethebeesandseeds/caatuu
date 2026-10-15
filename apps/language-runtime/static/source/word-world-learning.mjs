const LEARNING_KEYS = ["unitId", "order", "title", "explanation", "focus"];
const STABLE_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function surface(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function sameTokens(left, right) {
  const ordered = (tokens) => JSON.stringify(tokens.slice().sort());
  return left.length === right.length && ordered(left) === ordered(right);
}

/** Alternate orders are authored permutations, never inferred grammar rules. */
export function acceptedTokenOrderIssues(orders, canonicalTokens) {
  if (!Array.isArray(orders) || !orders.length) {
    return ["acceptedTokenOrders must be a non-empty array when present."];
  }
  const canonical = (Array.isArray(canonicalTokens) ? canonicalTokens : []).map(surface);
  const seen = new Set([JSON.stringify(canonical)]);
  const issues = [];
  for (const [index, tokens] of orders.entries()) {
    const label = `acceptedTokenOrders[${index}]`;
    if (!Array.isArray(tokens) || !tokens.length
        || tokens.some((token) => !surface(token) || token !== surface(token))) {
      issues.push(`${label} must contain non-empty NFC token strings without surrounding whitespace.`);
      continue;
    }
    if (!sameTokens(tokens, canonical)) {
      issues.push(`${label} must use exactly the canonical token surfaces and occurrence counts.`);
      continue;
    }
    const key = JSON.stringify(tokens);
    if (seen.has(key)) issues.push(`${label} duplicates an existing or canonical token order.`);
    seen.add(key);
  }
  return issues;
}

/** Course-authored teaching metadata has no effect on unannotated records. */
export function targetLearningFieldIssues(realization) {
  const issues = [];
  if (Object.hasOwn(realization ?? {}, "acceptedTokenOrders")) {
    issues.push(...acceptedTokenOrderIssues(
      realization.acceptedTokenOrders,
      Array.isArray(realization.tokens) ? realization.tokens.map((token) => token?.surface) : []
    ));
  }
  if (!Object.hasOwn(realization ?? {}, "learning")) return issues;
  const learning = realization.learning;
  if (!learning || typeof learning !== "object" || Array.isArray(learning)) {
    return [...issues, "learning must be an object when present."];
  }
  for (const key of Object.keys(learning)) {
    if (!LEARNING_KEYS.includes(key)) issues.push(`learning.${key} is unsupported.`);
  }
  for (const key of LEARNING_KEYS) {
    if (!Object.hasOwn(learning, key)) issues.push(`learning.${key} is required.`);
  }
  if (typeof learning.unitId !== "string" || !STABLE_ID.test(learning.unitId)) {
    issues.push("learning.unitId must be a stable slug or dotted identifier.");
  }
  if (!Number.isSafeInteger(learning.order) || learning.order < 1) {
    issues.push("learning.order must be a positive safe integer.");
  }
  for (const key of ["title", "explanation"]) {
    if (!surface(learning[key])) issues.push(`learning.${key} must be a non-empty string.`);
  }
  if (!Array.isArray(learning.focus) || !learning.focus.length
      || learning.focus.some((focus) => typeof focus !== "string" || !STABLE_ID.test(focus))
      || new Set(learning.focus).size !== learning.focus.length) {
    issues.push("learning.focus must contain unique stable identifiers.");
  }
  return issues;
}
