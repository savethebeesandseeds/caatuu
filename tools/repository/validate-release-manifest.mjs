#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const semanticVersionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const logicalIdPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const schemaNamePattern = /^caatuu-[a-z0-9-]+$/u;
const mediaTypePattern = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u;
const utcTimestampPattern =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/u;

const releaseKeys = [
  "schema_name",
  "schema_version",
  "release_id",
  "released_at",
  "source",
  "build",
  "components",
  "evidence",
  "checks",
  "migration_effects",
  "known_limitations",
];
const sourceKeys = ["repository", "revision", "tag", "tree_clean"];
const sourceRevisionKeys = ["algorithm", "digest"];
const buildKeys = ["command", "environment", "environment_sha256", "built_at", "tools"];
const toolKeys = ["name", "version"];
const componentKeys = ["id", "kind", "manifest"];
const referenceKeys = [
  "schema_name",
  "schema_version",
  "href",
  "media_type",
  "bytes",
  "sha256",
];
const evidenceKeys = ["id", "kind", "href", "media_type", "bytes", "sha256"];
const checkKeys = [
  "source_review",
  "automated_tests",
  "artifact_integrity",
  "notices",
  "provenance",
  "privacy",
  "package_audit",
  "signature_verification",
  "public_download",
  "physical_device_smoke",
];
const channelKeys = ["schema_name", "schema_version", "channel", "updated_at", "release"];
const channelReleaseKeys = ["id", "href", "bytes", "sha256"];

const componentKinds = new Set([
  "web",
  "runtime",
  "android",
  "model-catalog",
  "dictionary-catalog",
  "embedding-catalog",
  "static-assets",
  "other",
]);
const evidenceKinds = new Set([
  "release-notes",
  "notices",
  "sbom",
  "source-review",
  "automated-tests",
  "tests",
  "rights-review",
  "privacy-review",
  "build-provenance",
  "package-audit",
  "signature",
  "public-download-verification",
  "device-smoke",
  "checksums",
  "other",
]);
const checkStatuses = new Set(["passed", "failed", "not-applicable"]);
const channels = new Set([
  "development",
  "invited-test",
  "public-preview",
  "private-beta",
  "public-beta",
  "stable",
]);
const revisionAlgorithms = new Map([
  ["git-sha1", /^[0-9a-f]{40}$/u],
  ["git-sha256", /^[0-9a-f]{64}$/u],
]);
const componentContracts = new Map([
  ["web", ["caatuu-web-bundle", 1]],
  ["runtime", ["caatuu-runtime-image", 1]],
  ["android", ["caatuu-android-update", 1]],
  ["model-catalog", ["caatuu-model-catalog", 1]],
  ["dictionary-catalog", ["caatuu-dictionary-catalog", 1]],
  ["embedding-catalog", ["caatuu-embedding-catalog", 1]],
  ["static-assets", ["caatuu-static-assets", 1]],
]);
const checkEvidenceKinds = new Map([
  ["source_review", ["source-review"]],
  ["automated_tests", ["automated-tests"]],
  ["artifact_integrity", ["checksums"]],
  ["notices", ["notices"]],
  ["provenance", ["rights-review", "build-provenance"]],
  ["privacy", ["privacy-review"]],
  ["package_audit", ["package-audit"]],
  ["signature_verification", ["signature"]],
  ["public_download", ["public-download-verification"]],
  ["physical_device_smoke", ["device-smoke"]],
]);
const evidenceKindChecks = new Map(
  [...checkEvidenceKinds].flatMap(([check, evidenceKinds]) =>
    evidenceKinds.map((evidenceKind) => [evidenceKind, check])
  )
);
const textCheckEvidenceKinds = new Set(["notices", "checksums"]);

export function collectReleaseManifestV1Errors(value, expectations = {}) {
  const errors = [];
  if (!validateExactObject(value, "$", releaseKeys, errors)) return errors;

  expectEqual(value.schema_name, "caatuu-release", "$.schema_name", errors);
  expectEqual(value.schema_version, 1, "$.schema_version", errors);
  validateSemanticVersion(value.release_id, "$.release_id", errors);
  validateUtcTimestamp(value.released_at, "$.released_at", errors);

  if (validateExactObject(value.source, "$.source", sourceKeys, errors)) {
    validateHttpsUrl(value.source.repository, "$.source.repository", errors);
    validateSourceRevision(value.source.revision, errors);
    validateNonEmptyString(value.source.tag, "$.source.tag", errors);
    if (typeof value.source.tag === "string" && value.source.tag.length > 160) {
      errors.push("$.source.tag: must be at most 160 characters");
    }
    if (typeof value.source.tag === "string" && /\s/u.test(value.source.tag)) {
      errors.push("$.source.tag: must not contain whitespace");
    }
    expectEqual(value.source.tree_clean, true, "$.source.tree_clean", errors);
  }

  if (validateExactObject(value.build, "$.build", buildKeys, errors)) {
    validateNonEmptyString(value.build.command, "$.build.command", errors);
    validateNonEmptyString(value.build.environment, "$.build.environment", errors);
    validateSha256(value.build.environment_sha256, "$.build.environment_sha256", errors);
    validateUtcTimestamp(value.build.built_at, "$.build.built_at", errors);
    validateTools(value.build.tools, errors);
  }

  if (typeof value.release_id === "string" && value.source?.tag !== `v${value.release_id}`) {
    errors.push(`$.source.tag: must equal ${JSON.stringify(`v${value.release_id}`)}`);
  }
  if (
    typeof value.released_at === "string" &&
    typeof value.build?.built_at === "string" &&
    Date.parse(value.build.built_at) > Date.parse(value.released_at)
  ) {
    errors.push("$.build.built_at: cannot be later than $.released_at");
  }

  const referencedHrefs = new Set();
  validateComponents(value.components, referencedHrefs, errors);
  const presentEvidenceKinds = validateEvidence(value.evidence, referencedHrefs, errors);
  validateChecks(value.checks, presentEvidenceKinds, errors);
  validateStringList(value.migration_effects, "$.migration_effects", errors);
  validateStringList(value.known_limitations, "$.known_limitations", errors);

  if (
    isPlainObject(value.checks) &&
    Object.values(value.checks).includes("failed") &&
    Array.isArray(value.known_limitations) &&
    value.known_limitations.length === 0
  ) {
    errors.push("$.known_limitations: must describe recorded failed checks");
  }

  if (
    expectations.expectedCommit !== undefined &&
    value.source?.revision?.digest !== expectations.expectedCommit
  ) {
    errors.push(
      `$.source.revision.digest: expected ${JSON.stringify(expectations.expectedCommit)}, received ${JSON.stringify(value.source?.revision?.digest)}`
    );
  }
  if (
    expectations.expectedReleaseId !== undefined &&
    value.release_id !== expectations.expectedReleaseId
  ) {
    errors.push(
      `$.release_id: expected ${JSON.stringify(expectations.expectedReleaseId)}, received ${JSON.stringify(value.release_id)}`
    );
  }
  if (expectations.expectedChannel !== undefined) {
    errors.push("$: --expected-channel applies only to a caatuu-release-channel document");
  }

  return errors;
}

export function collectReleaseChannelV1Errors(value, expectations = {}) {
  const errors = [];
  if (!validateExactObject(value, "$", channelKeys, errors)) return errors;

  expectEqual(value.schema_name, "caatuu-release-channel", "$.schema_name", errors);
  expectEqual(value.schema_version, 1, "$.schema_version", errors);
  validateEnum(value.channel, channels, "$.channel", errors);
  validateUtcTimestamp(value.updated_at, "$.updated_at", errors);

  if (validateExactObject(value.release, "$.release", channelReleaseKeys, errors)) {
    validateSemanticVersion(value.release.id, "$.release.id", errors);
    validateRelativeHref(value.release.href, "$.release.href", errors);
    validatePositiveInteger(value.release.bytes, "$.release.bytes", errors);
    validateSha256(value.release.sha256, "$.release.sha256", errors);
    if (
      typeof value.release.id === "string" &&
      typeof value.release.href === "string" &&
      !value.release.href.split("/").includes(value.release.id)
    ) {
      errors.push("$.release.href: must contain the immutable release ID as an exact path segment");
    }
  }

  if (expectations.expectedChannel !== undefined && value.channel !== expectations.expectedChannel) {
    errors.push(
      `$.channel: expected ${JSON.stringify(expectations.expectedChannel)}, received ${JSON.stringify(value.channel)}`
    );
  }
  if (
    expectations.expectedReleaseId !== undefined &&
    value.release?.id !== expectations.expectedReleaseId
  ) {
    errors.push(
      `$.release.id: expected ${JSON.stringify(expectations.expectedReleaseId)}, received ${JSON.stringify(value.release?.id)}`
    );
  }
  if (expectations.expectedCommit !== undefined) {
    errors.push("$: --expected-commit applies only to a caatuu-release document");
  }

  return errors;
}

export function collectReleaseRecordErrors(value, expectations = {}) {
  if (!isPlainObject(value)) return ["$: expected an object"];
  if (value.schema_name === "caatuu-release") {
    return collectReleaseManifestV1Errors(value, expectations);
  }
  if (value.schema_name === "caatuu-release-channel") {
    return collectReleaseChannelV1Errors(value, expectations);
  }
  return [`$.schema_name: unsupported release record ${JSON.stringify(value.schema_name)}`];
}

export async function verifyReleaseRecordReferences(value, documentPath) {
  const errors = [];
  const absoluteDocumentPath = resolve(documentPath);
  try {
    const documentStat = await lstat(absoluteDocumentPath);
    if (documentStat.isSymbolicLink()) {
      return ["$: the release record itself must not be a symbolic link"];
    }
    if (!documentStat.isFile()) return ["$: the release record path must be a regular file"];
  } catch (error) {
    return [`$: cannot inspect the release record: ${error.message}`];
  }

  let documentValue;
  try {
    documentValue = JSON.parse(await readFile(absoluteDocumentPath, "utf8"));
  } catch (error) {
    return [`$: cannot parse the release record at documentPath: ${error.message}`];
  }
  if (!isDeepStrictEqual(value, documentValue)) {
    return ["$: supplied release record does not match the documentPath contents"];
  }
  const structuralErrors = collectReleaseRecordErrors(value);
  if (structuralErrors.length > 0) return structuralErrors;

  const baseDirectory = dirname(absoluteDocumentPath);
  let realBaseDirectory;
  try {
    realBaseDirectory = await realpath(baseDirectory);
  } catch (error) {
    return [`$: cannot resolve the release record directory: ${error.message}`];
  }

  if (value.schema_name === "caatuu-release") {
    const componentFacts = [];
    for (const [index, component] of value.components.entries()) {
      const path = `$.components[${index}].manifest`;
      const verified = await readVerifiedReference(
        component.manifest,
        baseDirectory,
        realBaseDirectory,
        path,
        errors
      );
      if (verified !== null && isJsonMediaType(component.manifest.media_type)) {
        const parsedComponent = validateReferencedComponentJson(
          verified.bytes,
          component,
          path,
          errors
        );
        if (parsedComponent !== null) {
          componentFacts.push({ kind: component.kind, value: parsedComponent });
        }
      }
    }
    for (const [index, evidence] of value.evidence.entries()) {
      const path = `$.evidence[${index}]`;
      const verified = await readVerifiedReference(
        evidence,
        baseDirectory,
        realBaseDirectory,
        path,
        errors
      );
      if (verified !== null && isJsonMediaType(evidence.media_type)) {
        validateReferencedEvidenceJson(
          verified.bytes,
          evidence,
          value,
          componentFacts,
          path,
          errors
        );
      }
    }
    return attachVerificationFacts(errors, componentFacts);
  }

  if (value.schema_name === "caatuu-release-channel") {
    const verified = await readVerifiedReference(
      value.release,
      baseDirectory,
      realBaseDirectory,
      "$.release",
      errors
    );
    if (verified === null) return errors;

    let release;
    try {
      release = JSON.parse(verified.bytes.toString("utf8"));
    } catch (error) {
      errors.push(`$.release.href: referenced release is not valid JSON: ${error.message}`);
      return errors;
    }

    const releaseErrors = collectReleaseRecordErrors(release);
    for (const error of releaseErrors) {
      errors.push(`$.release.href -> ${error}`);
    }
    if (releaseErrors.length > 0 || release.schema_name !== "caatuu-release") return errors;
    if (release.release_id !== value.release.id) {
      errors.push(
        `$.release.id: pointer records ${JSON.stringify(value.release.id)} but the release records ${JSON.stringify(release.release_id)}`
      );
    }
    const nestedErrors = await verifyReleaseRecordReferences(release, verified.path);
    const componentFacts = nestedErrors.componentFacts ?? [];
    for (const error of nestedErrors) {
      errors.push(`$.release.href -> ${error}`);
    }
    validateChannelPublicationPolicy(value, release, componentFacts, errors);
    return errors;
  }

  return ["$.schema_name: reference verification supports only v1 release records"];
}

async function readVerifiedReference(reference, baseDirectory, realBaseDirectory, path, errors) {
  const hrefErrors = [];
  validateRelativeHref(reference.href, `${path}.href`, hrefErrors);
  if (hrefErrors.length > 0) {
    errors.push(...hrefErrors);
    return null;
  }

  let current = baseDirectory;
  const segments = reference.href.split("/");
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      errors.push(`${path}.href: referenced path is unavailable: ${error.message}`);
      return null;
    }
    if (stat.isSymbolicLink()) {
      errors.push(`${path}.href: symbolic links are not allowed in a release directory`);
      return null;
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      errors.push(`${path}.href: an intermediate reference segment is not a directory`);
      return null;
    }
    if (index === segments.length - 1 && !stat.isFile()) {
      errors.push(`${path}.href: referenced path is not a regular file`);
      return null;
    }
  }

  let realTarget;
  try {
    realTarget = await realpath(current);
  } catch (error) {
    errors.push(`${path}.href: cannot resolve referenced path: ${error.message}`);
    return null;
  }
  const relativeTarget = relative(realBaseDirectory, realTarget);
  if (
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    errors.push(`${path}.href: referenced path escapes the release record directory`);
    return null;
  }

  let bytes;
  try {
    bytes = await readFile(realTarget);
  } catch (error) {
    errors.push(`${path}.href: cannot read referenced file: ${error.message}`);
    return null;
  }
  if (bytes.byteLength !== reference.bytes) {
    errors.push(
      `${path}.bytes: recorded ${reference.bytes}, actual referenced file has ${bytes.byteLength}`
    );
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== reference.sha256) {
    errors.push(`${path}.sha256: recorded digest does not match the referenced file`);
  }
  return { bytes, path: realTarget };
}

function parseReferencedJsonObject(bytes, path, errors) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    errors.push(`${path}.href: referenced JSON is invalid: ${error.message}`);
    return null;
  }
  if (!isPlainObject(parsed)) {
    errors.push(`${path}.href: referenced JSON must be an object`);
    return null;
  }
  return parsed;
}

function validateReferencedComponentJson(bytes, component, path, errors) {
  const parsed = parseReferencedJsonObject(bytes, path, errors);
  if (parsed === null) return null;

  const expectedManifest = component.manifest;

  const declaresName = Object.hasOwn(parsed, "schema_name");
  const declaresVersion = Object.hasOwn(parsed, "schema_version");
  if (declaresName !== declaresVersion) {
    errors.push(`${path}.href: a self-identifying component must declare both schema fields`);
  }
  if (declaresName && parsed.schema_name !== expectedManifest.schema_name) {
    errors.push(`${path}.href: component schema_name does not match the release reference`);
  }
  if (declaresVersion && parsed.schema_version !== expectedManifest.schema_version) {
    errors.push(`${path}.href: component schema_version does not match the release reference`);
  }

  validateComponentContractPayload(
    parsed,
    component.kind,
    expectedManifest,
    declaresName && declaresVersion,
    path,
    errors
  );
  return parsed;
}

function validateComponentContractPayload(
  parsed,
  kind,
  expectedManifest,
  selfIdentifies,
  path,
  errors
) {
  if (kind === "android" && expectedManifest.schema_name === "caatuu-android-update") {
    requireStringProperty(parsed, "package_name", path, errors);
    requirePositiveIntegerProperty(parsed, "version_code", path, errors);
    requireStringProperty(parsed, "version_name", path, errors);
    requireStringProperty(parsed, "build_type", path, errors);
    if (typeof parsed.debuggable !== "boolean") {
      errors.push(`${path}.href: Android update contract requires boolean debuggable`);
    }
    validateHttpsUrl(parsed.apk_url, `${path}.href -> $.apk_url`, errors);
    validateSha256(parsed.sha256, `${path}.href -> $.sha256`, errors);
    validatePositiveInteger(parsed.bytes, `${path}.href -> $.bytes`, errors);
    if (
      !(
        (typeof parsed.abis === "string" && parsed.abis.trim().length > 0) ||
        (Array.isArray(parsed.abis) &&
          parsed.abis.length > 0 &&
          parsed.abis.every((abi) => typeof abi === "string" && abi.trim().length > 0))
      )
    ) {
      errors.push(`${path}.href: Android update contract requires one or more ABI names`);
    }
    return;
  }

  const catalogArrayByKind = new Map([
    ["model-catalog", "models"],
    ["dictionary-catalog", "dictionaries"],
    ["embedding-catalog", "models"],
    ["static-assets", "artifacts"],
  ]);
  const collection = catalogArrayByKind.get(kind);
  if (collection !== undefined) {
    if (!selfIdentifies && parsed.version !== expectedManifest.schema_version) {
      errors.push(
        `${path}.href: legacy ${kind} contract requires version ${expectedManifest.schema_version}`
      );
    }
    if (!Array.isArray(parsed[collection])) {
      errors.push(`${path}.href: legacy ${kind} contract requires an array named ${collection}`);
    }
    return;
  }

  if (!selfIdentifies) {
    errors.push(
      `${path}.href: ${kind} component JSON must self-identify with schema_name and schema_version`
    );
  }
}

function validateReferencedEvidenceJson(bytes, evidence, release, componentFacts, path, errors) {
  const parsed = parseReferencedJsonObject(bytes, path, errors);
  if (parsed === null) return;

  if (parsed.evidence_id !== evidence.id) {
    errors.push(`${path}.href: evidence_id must match the release evidence ID`);
  }
  const check = evidenceKindChecks.get(evidence.kind);
  if (check !== undefined && parsed.status !== release.checks?.[check]) {
    errors.push(
      `${path}.href: evidence status must match $.checks.${check} (${JSON.stringify(release.checks?.[check])})`
    );
  }
  if (evidence.kind === "signature") {
    requireStringProperty(parsed, "subject", path, errors);
    validateSha256(parsed.certificate_sha256, `${path}.href -> $.certificate_sha256`, errors);
    validateSha256(parsed.artifact_sha256, `${path}.href -> $.artifact_sha256`, errors);
    const androidDigests = componentFacts
      .filter((fact) => fact.kind === "android")
      .map((fact) => fact.value.sha256);
    if (!androidDigests.includes(parsed.artifact_sha256)) {
      errors.push(`${path}.href: signature artifact_sha256 must match an Android package digest`);
    }
    if (
      !Array.isArray(parsed.schemes) ||
      parsed.schemes.length === 0 ||
      !parsed.schemes.every((scheme) => typeof scheme === "string" && scheme.trim().length > 0)
    ) {
      errors.push(`${path}.href: signature evidence requires one or more signature schemes`);
    }
  }
  if (evidence.kind === "source-review") {
    if (!isDeepStrictEqual(parsed.source_revision, release.source?.revision)) {
      errors.push(`${path}.href: source-review revision must match $.source.revision`);
    }
    if (parsed.tag !== release.source?.tag) {
      errors.push(`${path}.href: source-review tag must match $.source.tag`);
    }
  }
  if (evidence.kind === "build-provenance") {
    if (parsed.release_id !== release.release_id) {
      errors.push(`${path}.href: build-provenance release_id must match $.release_id`);
    }
    if (!isDeepStrictEqual(parsed.source_revision, release.source?.revision)) {
      errors.push(`${path}.href: build-provenance revision must match $.source.revision`);
    }
    if (parsed.environment !== release.build?.environment) {
      errors.push(`${path}.href: build-provenance environment must match $.build.environment`);
    }
    if (parsed.environment_sha256 !== release.build?.environment_sha256) {
      errors.push(
        `${path}.href: build-provenance environment_sha256 must match $.build.environment_sha256`
      );
    }
    if (!Array.isArray(parsed.external_inputs) || parsed.external_inputs.length === 0) {
      errors.push(`${path}.href: build-provenance requires one or more external_inputs`);
    } else {
      for (const [index, input] of parsed.external_inputs.entries()) {
        const inputPath = `${path}.href -> $.external_inputs[${index}]`;
        if (!validateExactObject(input, inputPath, ["id", "sha256"], errors)) continue;
        validateLogicalId(input.id, `${inputPath}.id`, errors);
        validateSha256(input.sha256, `${inputPath}.sha256`, errors);
      }
      if (
        !parsed.external_inputs.some(
          (input) =>
            input?.id === "build-environment" &&
            input?.sha256 === release.build?.environment_sha256
        )
      ) {
        errors.push(
          `${path}.href: external_inputs must bind build-environment to $.build.environment_sha256`
        );
      }
    }
  }
}

function requireStringProperty(value, property, path, errors) {
  if (typeof value[property] !== "string" || value[property].trim().length === 0) {
    errors.push(`${path}.href: contract requires non-empty string ${property}`);
  }
}

function requirePositiveIntegerProperty(value, property, path, errors) {
  if (!Number.isSafeInteger(value[property]) || value[property] < 1) {
    errors.push(`${path}.href: contract requires positive integer ${property}`);
  }
}

function validateChannelPublicationPolicy(channel, release, componentFacts, errors) {
  const governed = new Set(["public-preview", "private-beta", "public-beta", "stable"]);
  if (!governed.has(channel.channel) || !isPlainObject(release.checks)) return;

  const isPreview = channel.channel === "public-preview";
  const generalChecks = [
    "source_review",
    "automated_tests",
    "artifact_integrity",
    "notices",
    "provenance",
    "privacy",
    "public_download",
  ];
  const hasAndroid =
    Array.isArray(release.components) && release.components.some((item) => item?.kind === "android");
  const requiredChecks = isPreview
    ? hasAndroid
      ? ["source_review", "artifact_integrity", "public_download", "signature_verification"]
      : ["source_review", "artifact_integrity", "public_download"]
    : hasAndroid
      ? [...generalChecks, "package_audit", "signature_verification", "physical_device_smoke"]
      : generalChecks;
  for (const check of requiredChecks) {
    if (release.checks[check] !== "passed") {
      errors.push(
        `$.release.href -> $.checks.${check}: ${channel.channel} publication requires 'passed'`
      );
    }
  }
  for (const check of checkKeys) {
    if (release.checks[check] === "failed") {
      errors.push(
        `$.release.href -> $.checks.${check}: a public channel cannot publish a failed check`
      );
    }
  }
  if (!isPreview) {
    if (!release.evidence.some((item) => item?.kind === "release-notes")) {
      errors.push("$.release.href -> $.evidence: beta and stable publication requires release-notes evidence");
    }
  }

  if (hasAndroid) {
    const androidFacts = componentFacts.filter((fact) => fact.kind === "android");
    const androidCount = release.components.filter((item) => item?.kind === "android").length;
    if (androidFacts.length !== androidCount) {
      errors.push("$.release.href -> $.components: Android channel compatibility could not be verified");
    }
    for (const [index, fact] of androidFacts.entries()) {
      const expectedBuildType = isPreview ? "debug" : "release";
      const expectedDebuggable = isPreview;
      if (fact.value.build_type !== expectedBuildType || fact.value.debuggable !== expectedDebuggable) {
        errors.push(
          `$.release.href -> Android component ${index}: ${channel.channel} requires build_type ${JSON.stringify(expectedBuildType)} and debuggable ${expectedDebuggable}`
        );
      }
    }
  }

  const prerelease = hasPrerelease(release.release_id);
  if (channel.channel === "stable" && prerelease) {
    errors.push("$.release.id: stable publication requires a non-prerelease semantic version");
  }
  if (channel.channel !== "stable" && !prerelease) {
    errors.push(`$.release.id: ${channel.channel} publication requires a prerelease semantic version`);
  }
  if (Date.parse(channel.updated_at) < Date.parse(release.released_at)) {
    errors.push("$.updated_at: channel publication cannot predate the referenced release");
  }
}

function isJsonMediaType(mediaType) {
  return mediaType === "application/json" || /[+]json$/u.test(mediaType);
}

function attachVerificationFacts(errors, componentFacts) {
  Object.defineProperty(errors, "componentFacts", {
    configurable: false,
    enumerable: false,
    value: componentFacts,
    writable: false,
  });
  return errors;
}

function validateTools(value, errors) {
  if (!Array.isArray(value)) {
    errors.push("$.build.tools: expected an array");
    return;
  }
  if (value.length === 0) errors.push("$.build.tools: must contain at least one tool");
  const names = new Set();
  for (const [index, tool] of value.entries()) {
    const path = `$.build.tools[${index}]`;
    if (!validateExactObject(tool, path, toolKeys, errors)) continue;
    validateLogicalId(tool.name, `${path}.name`, errors);
    validateNonEmptyString(tool.version, `${path}.version`, errors);
    recordUnique(tool.name, names, `${path}.name`, "tool name", errors);
  }
}

function validateSourceRevision(value, errors) {
  if (!validateExactObject(value, "$.source.revision", sourceRevisionKeys, errors)) return;
  validateEnum(value.algorithm, new Set(revisionAlgorithms.keys()), "$.source.revision.algorithm", errors);
  const digestPattern = revisionAlgorithms.get(value.algorithm);
  if (digestPattern !== undefined) {
    validatePattern(
      value.digest,
      digestPattern,
      "$.source.revision.digest",
      `a lowercase ${value.algorithm} digest`,
      errors
    );
  }
}

function validateComponents(value, referencedHrefs, errors) {
  if (!Array.isArray(value)) {
    errors.push("$.components: expected an array");
    return;
  }
  if (value.length === 0) errors.push("$.components: must contain at least one component");
  const ids = new Set();
  for (const [index, component] of value.entries()) {
    const path = `$.components[${index}]`;
    if (!validateExactObject(component, path, componentKeys, errors)) continue;
    validateLogicalId(component.id, `${path}.id`, errors);
    validateEnum(component.kind, componentKinds, `${path}.kind`, errors);
    recordUnique(component.id, ids, `${path}.id`, "component ID", errors);
    validateManifestReference(component.manifest, `${path}.manifest`, referencedHrefs, errors);
    if (isPlainObject(component.manifest) && !isJsonMediaType(component.manifest.media_type)) {
      errors.push(`${path}.manifest.media_type: component manifests must use a JSON media type`);
    }
    const contract = componentContracts.get(component.kind);
    if (contract !== undefined && isPlainObject(component.manifest)) {
      const [expectedName, expectedVersion] = contract;
      if (component.manifest.schema_name !== expectedName) {
        errors.push(`${path}.manifest.schema_name: ${component.kind} requires ${expectedName}`);
      }
      if (component.manifest.schema_version !== expectedVersion) {
        errors.push(`${path}.manifest.schema_version: ${component.kind} requires version ${expectedVersion}`);
      }
    }
  }
}

function validateManifestReference(value, path, referencedHrefs, errors) {
  if (!validateExactObject(value, path, referenceKeys, errors)) return;
  validatePattern(value.schema_name, schemaNamePattern, `${path}.schema_name`, "a Caatuu schema name", errors);
  validatePositiveInteger(value.schema_version, `${path}.schema_version`, errors);
  validateRelativeHref(value.href, `${path}.href`, errors);
  validatePattern(value.media_type, mediaTypePattern, `${path}.media_type`, "a media type", errors);
  validatePositiveInteger(value.bytes, `${path}.bytes`, errors);
  validateSha256(value.sha256, `${path}.sha256`, errors);
  recordUnique(value.href, referencedHrefs, `${path}.href`, "release-relative href", errors);
}

function validateEvidence(value, referencedHrefs, errors) {
  const kinds = new Set();
  if (!Array.isArray(value)) {
    errors.push("$.evidence: expected an array");
    return kinds;
  }
  if (value.length === 0) errors.push("$.evidence: must contain at least one record");
  const ids = new Set();
  for (const [index, item] of value.entries()) {
    const path = `$.evidence[${index}]`;
    if (!validateExactObject(item, path, evidenceKeys, errors)) continue;
    validateLogicalId(item.id, `${path}.id`, errors);
    validateEnum(item.kind, evidenceKinds, `${path}.kind`, errors);
    if (evidenceKinds.has(item.kind)) kinds.add(item.kind);
    validateRelativeHref(item.href, `${path}.href`, errors);
    validatePattern(item.media_type, mediaTypePattern, `${path}.media_type`, "a media type", errors);
    if (evidenceKindChecks.has(item.kind)) {
      const acceptsPlainText = textCheckEvidenceKinds.has(item.kind);
      if (
        !isJsonMediaType(item.media_type) &&
        !(acceptsPlainText && item.media_type === "text/plain")
      ) {
        errors.push(
          `${path}.media_type: ${item.kind} check evidence must use a JSON media type${acceptsPlainText ? " or text/plain" : ""}`
        );
      }
    }
    validatePositiveInteger(item.bytes, `${path}.bytes`, errors);
    validateSha256(item.sha256, `${path}.sha256`, errors);
    recordUnique(item.id, ids, `${path}.id`, "evidence ID", errors);
    recordUnique(item.href, referencedHrefs, `${path}.href`, "release-relative href", errors);
  }
  return kinds;
}

function validateChecks(value, presentEvidenceKinds, errors) {
  if (!validateExactObject(value, "$.checks", checkKeys, errors)) return;
  for (const key of checkKeys) {
    validateEnum(value[key], checkStatuses, `$.checks.${key}`, errors);
    const requiredEvidenceKinds = checkEvidenceKinds.get(key) ?? [];
    if (checkStatuses.has(value[key]) && value[key] !== "not-applicable") {
      for (const requiredEvidenceKind of requiredEvidenceKinds) {
        if (!presentEvidenceKinds.has(requiredEvidenceKind)) {
          errors.push(
            `$.checks.${key}: ${value[key]} requires ${requiredEvidenceKind} evidence`
          );
        }
      }
    }
  }
  if (value.source_review !== "passed") {
    errors.push("$.checks.source_review: must be 'passed' for an immutable release record");
  }
  if (value.artifact_integrity !== "passed") {
    errors.push("$.checks.artifact_integrity: must be 'passed' for an immutable release record");
  }
}

function validateStringList(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected an array`);
    return;
  }
  const values = new Set();
  for (const [index, item] of value.entries()) {
    validateNonEmptyString(item, `${path}[${index}]`, errors);
    recordUnique(item, values, `${path}[${index}]`, "value", errors);
  }
}

function validateExactObject(value, path, requiredKeys, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path}: expected an object`);
    return false;
  }
  const allowed = new Set(requiredKeys);
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: missing required property`);
  }
  for (const key of Object.keys(value).sort()) {
    if (!allowed.has(key)) errors.push(`${path}.${key}: unknown property`);
  }
  return true;
}

function validateSemanticVersion(value, path, errors) {
  validatePattern(value, semanticVersionPattern, path, "a semantic version", errors);
}

function validateSha256(value, path, errors) {
  validatePattern(value, sha256Pattern, path, "a lowercase 64-character SHA-256", errors);
}

function validateLogicalId(value, path, errors) {
  validatePattern(value, logicalIdPattern, path, "a lowercase logical ID", errors);
}

function validatePattern(value, pattern, path, description, errors) {
  if (typeof value !== "string" || !pattern.test(value)) {
    errors.push(`${path}: expected ${description}`);
  }
}

function validateNonEmptyString(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path}: expected a non-empty string`);
  }
}

function validatePositiveInteger(value, path, errors) {
  if (!Number.isSafeInteger(value) || value < 1) {
    errors.push(`${path}: expected a positive safe integer`);
  }
}

function validateEnum(value, allowed, path, errors) {
  if (!allowed.has(value)) {
    errors.push(`${path}: expected one of ${[...allowed].join(", ")}`);
  }
}

function validateUtcTimestamp(value, path, errors) {
  const match = typeof value === "string" ? utcTimestampPattern.exec(value) : null;
  if (match === null) {
    errors.push(`${path}: expected an RFC 3339 UTC timestamp ending in Z`);
    return;
  }
  const parsed = new Date(value);
  const expectedIso = `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== expectedIso) {
    errors.push(`${path}: expected a real RFC 3339 UTC calendar timestamp`);
  }
}

function validateHttpsUrl(value, path, errors) {
  if (typeof value !== "string") {
    errors.push(`${path}: expected an HTTPS URL`);
    return;
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      errors.push(`${path}: expected an HTTPS URL without credentials, query, or fragment`);
    }
  } catch {
    errors.push(`${path}: expected an HTTPS URL`);
  }
}

function validateRelativeHref(value, path, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path}: expected a non-empty release-relative path`);
    return;
  }
  if (
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes("//") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("%") ||
    value.includes(":") ||
    !/^[A-Za-z0-9][A-Za-z0-9._+@/-]*$/u.test(value) ||
    value.split("/").some((segment) => segment === "." || segment === ".." || segment === "")
  ) {
    errors.push(`${path}: expected a traversal-free release-relative path`);
  }
}

function expectEqual(value, expected, path, errors) {
  if (value !== expected) {
    errors.push(`${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(value)}`);
  }
}

function recordUnique(value, seen, path, description, errors) {
  if (typeof value !== "string") return;
  if (seen.has(value)) errors.push(`${path}: duplicate ${description} ${JSON.stringify(value)}`);
  seen.add(value);
}

function hasPrerelease(version) {
  return typeof version === "string" && version.split("+", 1)[0].includes("-");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseArguments(argv) {
  const expectations = {};
  let verifyReferences = true;
  let filePath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--verify-references") {
      verifyReferences = true;
      continue;
    }
    if (argument === "--structure-only") {
      verifyReferences = false;
      continue;
    }
    if (["--expected-channel", "--expected-commit", "--expected-release-id"].includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} requires a value`);
      index += 1;
      const key = argument
        .slice("--expected-".length)
        .replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
      expectations[`expected${key[0].toUpperCase()}${key.slice(1)}`] = value;
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`unknown option: ${argument}`);
    if (filePath !== undefined) throw new Error("exactly one manifest file is required");
    filePath = argument;
  }
  if (filePath === undefined) throw new Error("a manifest file is required");
  return { help: false, filePath, expectations, verifyReferences };
}

function printUsage() {
  console.log(
    "Usage: node tools/repository/validate-release-manifest.mjs " +
      "[--expected-channel VALUE] [--expected-commit SHA] " +
      "[--expected-release-id VALUE] [--structure-only] FILE"
  );
  console.log("Referenced files are verified by default; --structure-only is authoring-only.");
}

async function main() {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`Release manifest validator usage error: ${error.message}`);
    printUsage();
    process.exitCode = 2;
    return;
  }

  if (parsed.help) {
    printUsage();
    return;
  }

  let value;
  try {
    const source = await readFile(resolve(parsed.filePath), "utf8");
    value = JSON.parse(source);
  } catch (error) {
    console.error(`Release manifest input error: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const errors = collectReleaseRecordErrors(value, parsed.expectations);
  if (errors.length === 0 && parsed.verifyReferences) {
    errors.push(...(await verifyReleaseRecordReferences(value, resolve(parsed.filePath))));
  }
  if (errors.length > 0) {
    console.error("Release manifest validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  if (parsed.verifyReferences) {
    console.log(
      `Release manifest valid: ${parsed.filePath} (${value.schema_name} v${value.schema_version})`
    );
  } else {
    console.log(
      `STRUCTURE ONLY - NOT VALID FOR PUBLICATION: ${parsed.filePath} (${value.schema_name} v${value.schema_version}); references were not verified`
    );
  }
}

const modulePath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (modulePath === invokedPath) await main();
