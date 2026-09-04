const POLICY_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u;
const REQUIRED_PATH_KEYS = [
  "conceptsSource",
  "realizationsSource",
  "conceptsRuntime",
  "realizationsRuntime",
  "manifest"
];
const MANIFEST_REFERENCE_TYPES = new Set(["manifest-relative", "shared-runtime-url"]);
const MANIFEST_FIELD_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u;

/**
 * Defines the target-specific projection edge around the shared Word World
 * projector. The core owns English concepts, target realization projection,
 * exact concept coverage, output confinement, and manifest authority. A
 * policy may only decide how reviewed pronunciation is exposed, create
 * supplementary target aids, and describe their manifest contract.
 */
export function defineWordWorldProjectionPolicy({
  id,
  contentPolicyId,
  defaultPaths,
  supplementalOutputs = {},
  manifestBindings,
  targetProjectionPolicy,
  projectSupplemental,
  buildManifest,
  validate
}) {
  if (typeof id !== "string" || !POLICY_ID_PATTERN.test(id)) {
    throw new TypeError("Word World projection policy id must be a stable versioned ID.");
  }
  if (typeof contentPolicyId !== "string" || !POLICY_ID_PATTERN.test(contentPolicyId)) {
    throw new TypeError(`${id} must name a stable target contentPolicyId.`);
  }
  if (!isObject(defaultPaths)) {
    throw new TypeError(`${id} must define defaultPaths.`);
  }
  for (const key of REQUIRED_PATH_KEYS) {
    if (!isNonEmptyString(defaultPaths[key])) {
      throw new TypeError(`${id}.defaultPaths.${key} must be a repository-relative path.`);
    }
  }
  if (!isObject(supplementalOutputs)) {
    throw new TypeError(`${id}.supplementalOutputs must be an object.`);
  }
  for (const [projectionKey, pathKey] of Object.entries(supplementalOutputs)) {
    if (!isNonEmptyString(projectionKey) || !isNonEmptyString(pathKey)) {
      throw new TypeError(`${id}.supplementalOutputs must map projection keys to path keys.`);
    }
    if (!isNonEmptyString(defaultPaths[pathKey])) {
      throw new TypeError(`${id}.defaultPaths.${pathKey} is required by ${projectionKey}.`);
    }
  }
  const expectedManifestProjectionKeys = [
    "englishProjection",
    "targetProjection",
    "learnerBaseProjection",
    ...Object.keys(supplementalOutputs)
  ].sort();
  if (!isObject(manifestBindings)
      || JSON.stringify(Object.keys(manifestBindings).sort()) !== JSON.stringify(expectedManifestProjectionKeys)) {
    throw new TypeError(
      `${id}.manifestBindings must describe exactly: ${expectedManifestProjectionKeys.join(", ")}.`
    );
  }
  for (const [projectionKey, binding] of Object.entries(manifestBindings)) {
    const allowedKeys = projectionKey === "learnerBaseProjection"
      ? ["field", "reference", "optional"]
      : ["field", "reference"];
    if (!isObject(binding)
        || JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify(allowedKeys.sort())
        || typeof binding.field !== "string"
        || !MANIFEST_FIELD_PATTERN.test(binding.field)
        || !MANIFEST_REFERENCE_TYPES.has(binding.reference)
        || (projectionKey === "learnerBaseProjection" && binding.optional !== true)) {
      throw new TypeError(`${id}.manifestBindings.${projectionKey} is invalid.`);
    }
  }
  for (const [name, implementation] of Object.entries({
    targetProjectionPolicy,
    projectSupplemental,
    buildManifest,
    validate
  })) {
    if (typeof implementation !== "function") {
      throw new TypeError(`${id} must implement ${name}().`);
    }
  }

  return deepFreeze({
    id,
    contentPolicyId,
    defaultPaths: { ...defaultPaths },
    supplementalOutputs: { ...supplementalOutputs },
    manifestBindings: clone(manifestBindings),
    targetProjectionPolicy,
    projectSupplemental,
    buildManifest,
    validate
  });
}

export function assertProjectionPolicyResult(policy, result) {
  if (!isObject(result)) {
    throw new TypeError(`${policy.id}.projectSupplemental() must return an object.`);
  }
  const expectedKeys = Object.keys(policy.supplementalOutputs).sort();
  const actualKeys = Object.keys(result).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new TypeError(
      `${policy.id}.projectSupplemental() must return exactly: ${expectedKeys.join(", ") || "no projections"}.`
    );
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
