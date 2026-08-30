const POLICY_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

export function defineTargetContentPolicy({ id, validate }) {
  if (typeof id !== "string" || !POLICY_ID_PATTERN.test(id)) {
    throw new TypeError("Target content policy id must be a stable versioned lowercase ID.");
  }
  if (typeof validate !== "function") {
    throw new TypeError(`Target content policy ${id} must provide validate(catalog).`);
  }
  return deepFreeze({ id, validate });
}

export function validatePolicyIssues(value, policyId) {
  if (!Array.isArray(value)) {
    throw new TypeError(`Target content policy ${policyId} must return an array of issues.`);
  }
  return value.map((issue, index) => {
    if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
      throw new TypeError(`Target content policy ${policyId} issue ${index} must be an object.`);
    }
    if (typeof issue.code !== "string" || !issue.code.trim()) {
      throw new TypeError(`Target content policy ${policyId} issue ${index} requires a code.`);
    }
    if (typeof issue.message !== "string" || !issue.message.trim()) {
      throw new TypeError(`Target content policy ${policyId} issue ${index} requires a message.`);
    }
    return { code: issue.code, message: issue.message };
  });
}
