import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectReleaseChannelV1Errors,
  collectReleaseManifestV1Errors,
  collectReleaseRecordErrors,
  verifyReleaseRecordReferences,
} from "../../../../tools/repository/validate-release-manifest.mjs";

const repoRoot = new URL("../../../../", import.meta.url);
const releaseExampleUrl = new URL("docs/examples/release-manifest.v1.example.json", repoRoot);
const channelExampleUrl = new URL("docs/examples/release-channel.v1.example.json", repoRoot);

const [releaseText, channelText, releaseSchemaText, channelSchemaText] = await Promise.all([
  readFile(releaseExampleUrl, "utf8"),
  readFile(channelExampleUrl, "utf8"),
  readFile(new URL("docs/schemas/release-manifest.v1.schema.json", repoRoot), "utf8"),
  readFile(new URL("docs/schemas/release-channel.v1.schema.json", repoRoot), "utf8"),
]);

const releaseExample = JSON.parse(releaseText);
const channelExample = JSON.parse(channelText);
const releaseSchema = JSON.parse(releaseSchemaText);
const channelSchema = JSON.parse(channelSchemaText);
const evidenceCheckByKind = new Map([
  ["source-review", "source_review"],
  ["automated-tests", "automated_tests"],
  ["checksums", "artifact_integrity"],
  ["notices", "notices"],
  ["rights-review", "provenance"],
  ["build-provenance", "provenance"],
  ["privacy-review", "privacy"],
  ["package-audit", "package_audit"],
  ["signature", "signature_verification"],
  ["public-download-verification", "public_download"],
  ["device-smoke", "physical_device_smoke"],
]);

async function writeReferencedFile(baseDirectory, reference, bytes) {
  const filePath = join(baseDirectory, ...reference.href.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  reference.bytes = bytes.byteLength;
  reference.sha256 = createHash("sha256").update(bytes).digest("hex");
  return filePath;
}

function createComponentPayload(component, options) {
  const identity = {
    schema_name: component.manifest.schema_name,
    schema_version: component.manifest.schema_version,
  };
  if (component.kind === "android") {
    return {
      ...identity,
      package_name: "com.waajacu.caatuu",
      version_code: 200,
      version_name: "0.2.0-beta.1",
      build_type: options.androidBuildType ?? "release",
      debuggable: options.androidDebuggable ?? false,
      apk_url: "https://downloads.example.invalid/android/200/caatuu.apk",
      sha256: options.androidArtifactSha256 ?? "b".repeat(64),
      bytes: 1234,
      abis: ["arm64-v8a"],
    };
  }
  if (component.kind === "model-catalog" || component.kind === "embedding-catalog") {
    return { ...identity, models: [] };
  }
  if (component.kind === "dictionary-catalog") {
    return { ...identity, dictionaries: [] };
  }
  if (component.kind === "static-assets" || component.kind === "web") {
    return { ...identity, artifacts: [] };
  }
  return identity;
}

async function persistChannelRecord(fixture) {
  await writeFile(fixture.channelPath, `${JSON.stringify(fixture.channel, null, 2)}\n`, "utf8");
}

async function persistReleaseTree(fixture) {
  const releaseBytes = Buffer.from(`${JSON.stringify(fixture.release, null, 2)}\n`, "utf8");
  await writeFile(fixture.releasePath, releaseBytes);
  fixture.channel.release.id = fixture.release.release_id;
  fixture.channel.release.bytes = releaseBytes.byteLength;
  fixture.channel.release.sha256 = createHash("sha256").update(releaseBytes).digest("hex");
  await persistChannelRecord(fixture);
}

async function createVerifiedReleaseTree(mutateRelease = () => {}, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "caatuu-release-contract-"));
  const release = structuredClone(releaseExample);
  mutateRelease(release);
  const releaseDirectory = join(root, release.release_id);
  await mkdir(releaseDirectory, { recursive: true });

  for (const component of release.components) {
    const bytes = Buffer.from(`${JSON.stringify(createComponentPayload(component, options))}\n`, "utf8");
    await writeReferencedFile(releaseDirectory, component.manifest, bytes);
  }
  for (const evidence of release.evidence) {
    const evidencePayload = { evidence_id: evidence.id };
    const check = evidenceCheckByKind.get(evidence.kind);
    if (check !== undefined) evidencePayload.status = release.checks[check];
    if (evidence.kind === "signature") {
      evidencePayload.subject = "example Android package";
      evidencePayload.certificate_sha256 = "a".repeat(64);
      evidencePayload.artifact_sha256 = options.androidArtifactSha256 ?? "b".repeat(64);
      evidencePayload.schemes = ["APK Signature Scheme v2"];
    }
    if (evidence.kind === "source-review") {
      evidencePayload.source_revision = release.source.revision;
      evidencePayload.tag = release.source.tag;
    }
    if (evidence.kind === "build-provenance") {
      evidencePayload.release_id = release.release_id;
      evidencePayload.source_revision = release.source.revision;
      evidencePayload.environment = release.build.environment;
      evidencePayload.environment_sha256 = release.build.environment_sha256;
      evidencePayload.external_inputs = [
        { id: "build-environment", sha256: release.build.environment_sha256 },
      ];
    }
    const bytes =
      evidence.media_type === "application/json"
        ? Buffer.from(`${JSON.stringify(evidencePayload)}\n`, "utf8")
        : Buffer.from(`Example evidence: ${evidence.id}\n`, "utf8");
    await writeReferencedFile(releaseDirectory, evidence, bytes);
  }

  const releaseBytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`, "utf8");
  const releasePath = join(releaseDirectory, "release.json");
  await writeFile(releasePath, releaseBytes);

  const channel = structuredClone(channelExample);
  channel.channel = options.channel ?? channel.channel;
  channel.release.id = release.release_id;
  channel.release.href = `${release.release_id}/release.json`;
  channel.release.bytes = releaseBytes.byteLength;
  channel.release.sha256 = createHash("sha256").update(releaseBytes).digest("hex");
  const channelPath = join(root, `${channel.channel}.json`);
  await writeFile(channelPath, `${JSON.stringify(channel, null, 2)}\n`, "utf8");

  return { root, release, releasePath, channel, channelPath, releaseDirectory };
}

test("the immutable release and mutable channel examples satisfy their v1 contracts", () => {
  assert.deepEqual(collectReleaseManifestV1Errors(releaseExample), []);
  assert.deepEqual(collectReleaseChannelV1Errors(channelExample), []);
  assert.deepEqual(collectReleaseRecordErrors(releaseExample), []);
  assert.deepEqual(collectReleaseRecordErrors(channelExample), []);
});

test("the channel example pins the exact immutable release example bytes", () => {
  const digest = createHash("sha256").update(releaseText).digest("hex");
  assert.equal(channelExample.release.bytes, Buffer.byteLength(releaseText, "utf8"));
  assert.equal(channelExample.release.sha256, digest);
  assert.equal(channelExample.release.id, releaseExample.release_id);
});

test("the CLI verifies references by default and reserves structure-only for authoring", () => {
  const validatorPath = fileURLToPath(
    new URL("tools/repository/validate-release-manifest.mjs", repoRoot)
  );
  const examplePath = fileURLToPath(releaseExampleUrl);
  const authoring = spawnSync(process.execPath, [validatorPath, "--structure-only", examplePath], {
    encoding: "utf8",
  });
  assert.equal(authoring.status, 0, authoring.stderr);
  assert.match(authoring.stdout, /STRUCTURE ONLY - NOT VALID FOR PUBLICATION/u);

  const publication = spawnSync(process.execPath, [validatorPath, examplePath], { encoding: "utf8" });
  assert.equal(publication.status, 1);
  assert.match(publication.stderr, /referenced path is unavailable/u);
});

test("the published schemas stay closed and identify the same contracts as the validator", () => {
  assert.equal(releaseSchema.additionalProperties, false);
  assert.equal(releaseSchema.properties.schema_name.const, "caatuu-release");
  assert.equal(releaseSchema.properties.schema_version.const, 1);
  assert.deepEqual(new Set(releaseSchema.required), new Set(Object.keys(releaseExample)));

  assert.equal(channelSchema.additionalProperties, false);
  assert.equal(channelSchema.properties.schema_name.const, "caatuu-release-channel");
  assert.equal(channelSchema.properties.schema_version.const, 1);
  assert.deepEqual(new Set(channelSchema.required), new Set(Object.keys(channelExample)));
});

test("release validation fails closed for unknown fields and mutable source state", () => {
  const unknown = structuredClone(releaseExample);
  unknown.provider = "implementation detail";
  assert.match(collectReleaseManifestV1Errors(unknown).join("\n"), /\$\.provider: unknown property/u);

  const dirty = structuredClone(releaseExample);
  dirty.source.tree_clean = false;
  dirty.source.revision.digest = "ABC";
  const errors = collectReleaseManifestV1Errors(dirty).join("\n");
  assert.match(errors, /\$\.source\.tree_clean: expected true/u);
  assert.match(errors, /\$\.source\.revision\.digest: expected a lowercase git-sha1 digest/u);
});

test("release validation rejects unsafe source URLs and normalized invalid dates", () => {
  const invalid = structuredClone(releaseExample);
  invalid.source.repository = "https://user:secret@example.invalid/repository?token=value";
  invalid.released_at = "2026-02-30T12:00:00Z";
  const errors = collectReleaseManifestV1Errors(invalid).join("\n");
  assert.match(errors, /HTTPS URL without credentials, query, or fragment/u);
  assert.match(errors, /real RFC 3339 UTC calendar timestamp/u);
});

test("release identity binds the tag and build timestamp to the immutable release", () => {
  const invalid = structuredClone(releaseExample);
  invalid.source.tag = "v0.2.0-beta.2";
  invalid.build.built_at = "2026-08-01T12:00:01Z";
  const errors = collectReleaseManifestV1Errors(invalid).join("\n");
  assert.match(errors, /source\.tag: must equal "v0\.2\.0-beta\.1"/u);
  assert.match(errors, /build\.built_at: cannot be later than/u);
});

test("release references reject traversal, invalid integrity metadata, and duplicates", () => {
  const invalid = structuredClone(releaseExample);
  invalid.components[0].manifest.href = "../outside.json";
  invalid.components[1].manifest.sha256 = "ABC";
  invalid.evidence[0].href = invalid.components[2].manifest.href;
  invalid.evidence[1].bytes = 0;
  const errors = collectReleaseManifestV1Errors(invalid).join("\n");
  assert.match(errors, /expected a traversal-free release-relative path/u);
  assert.match(errors, /expected a lowercase 64-character SHA-256/u);
  assert.match(errors, /duplicate release-relative href/u);
  assert.match(errors, /expected a positive safe integer/u);
});

test("component kinds are bound to supported component contracts", () => {
  const invalid = structuredClone(releaseExample);
  invalid.components[0].manifest.schema_name = "caatuu-dictionary-catalog";
  const errors = collectReleaseManifestV1Errors(invalid).join("\n");
  assert.match(errors, /web requires caatuu-web-bundle/u);
});

test("structured component and check evidence cannot downgrade their media type", () => {
  const invalid = structuredClone(releaseExample);
  invalid.components.find((item) => item.kind === "android").manifest.media_type = "text/plain";
  invalid.evidence.find((item) => item.kind === "signature").media_type = "text/plain";
  const errors = collectReleaseManifestV1Errors(invalid).join("\n");
  assert.match(errors, /component manifests must use a JSON media type/u);
  assert.match(errors, /signature check evidence must use a JSON media type/u);
});

test("failed checks require an explicit limitation and core integrity checks cannot fail", () => {
  const invalid = structuredClone(releaseExample);
  invalid.checks.artifact_integrity = "failed";
  invalid.known_limitations = [];
  const errors = collectReleaseManifestV1Errors(invalid).join("\n");
  assert.match(errors, /artifact_integrity: must be 'passed'/u);
  assert.match(errors, /known_limitations: must describe recorded failed checks/u);
});

test("channel validation keeps naming policy separate while rejecting unsafe records", () => {
  const policyNeutral = structuredClone(channelExample);
  policyNeutral.channel = "stable";
  assert.deepEqual(collectReleaseChannelV1Errors(policyNeutral), []);

  const invalidSemver = structuredClone(channelExample);
  invalidSemver.release.id = "0.2.0-beta.01";
  assert.match(
    collectReleaseChannelV1Errors(invalidSemver).join("\n"),
    /expected a semantic version/u
  );

  const unsafePath = structuredClone(channelExample);
  unsafePath.release.href = "../release.json";
  assert.match(
    collectReleaseChannelV1Errors(unsafePath).join("\n"),
    /expected a traversal-free release-relative path/u
  );

  const mutablePath = structuredClone(channelExample);
  mutablePath.release.href = "release.json";
  assert.match(
    collectReleaseChannelV1Errors(mutablePath).join("\n"),
    /must contain the immutable release ID as an exact path segment/u
  );
});

test("release expectations bind CI validation to the requested commit, channel, and release", () => {
  assert.deepEqual(
    collectReleaseManifestV1Errors(releaseExample, {
      expectedCommit: releaseExample.source.revision.digest,
      expectedReleaseId: releaseExample.release_id,
    }),
    []
  );
  assert.match(
    collectReleaseManifestV1Errors(releaseExample, { expectedCommit: "f".repeat(40) }).join("\n"),
    /\$\.source\.revision\.digest: expected/u
  );

  assert.deepEqual(
    collectReleaseChannelV1Errors(channelExample, {
      expectedChannel: channelExample.channel,
      expectedReleaseId: channelExample.release.id,
    }),
    []
  );
  assert.match(
    collectReleaseChannelV1Errors(channelExample, { expectedChannel: "stable" }).join("\n"),
    /\$\.channel: expected "stable"/u
  );
});

test("publication verification closes the channel, release, component, and evidence hash chain", async (t) => {
  const fixture = await createVerifiedReleaseTree();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.deepEqual(
    await verifyReleaseRecordReferences(fixture.channel, fixture.channelPath),
    []
  );

  const componentPath = join(
    fixture.releaseDirectory,
    ...fixture.release.components[0].manifest.href.split("/")
  );
  await writeFile(componentPath, "tampered\n", "utf8");
  assert.match(
    (await verifyReleaseRecordReferences(fixture.channel, fixture.channelPath)).join("\n"),
    /recorded digest does not match the referenced file/u
  );
});

test("publication verification rejects missing and non-object component manifests", async (t) => {
  const missing = await createVerifiedReleaseTree();
  t.after(() => rm(missing.root, { force: true, recursive: true }));
  const missingPath = join(
    missing.releaseDirectory,
    ...missing.release.components[0].manifest.href.split("/")
  );
  await rm(missingPath);
  assert.match(
    (await verifyReleaseRecordReferences(missing.release, missing.releasePath)).join("\n"),
    /referenced path is unavailable/u
  );

  const invalid = await createVerifiedReleaseTree();
  t.after(() => rm(invalid.root, { force: true, recursive: true }));
  const invalidReference = invalid.release.components[0].manifest;
  await writeReferencedFile(invalid.releaseDirectory, invalidReference, Buffer.from("[]\n", "utf8"));
  await persistReleaseTree(invalid);
  assert.match(
    (await verifyReleaseRecordReferences(invalid.release, invalid.releasePath)).join("\n"),
    /referenced JSON must be an object/u
  );

  await writeReferencedFile(invalid.releaseDirectory, invalidReference, Buffer.from("{}\n", "utf8"));
  await persistReleaseTree(invalid);
  assert.match(
    (await verifyReleaseRecordReferences(invalid.release, invalid.releasePath)).join("\n"),
    /web component JSON must self-identify/u
  );

  const android = await createVerifiedReleaseTree();
  t.after(() => rm(android.root, { force: true, recursive: true }));
  const androidComponent = android.release.components.find((item) => item.kind === "android");
  await writeReferencedFile(
    android.releaseDirectory,
    androidComponent.manifest,
    Buffer.from(
      `${JSON.stringify({
        schema_name: androidComponent.manifest.schema_name,
        schema_version: androidComponent.manifest.schema_version,
      })}\n`,
      "utf8"
    )
  );
  await persistReleaseTree(android);
  assert.match(
    (await verifyReleaseRecordReferences(android.release, android.releasePath)).join("\n"),
    /contract requires non-empty string package_name/u
  );
});

test("publication verification recognizes the current legacy component envelopes", async (t) => {
  const fixture = await createVerifiedReleaseTree();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  const legacyPayloads = new Map([
    [
      "android",
      {
        package_name: "com.waajacu.caatuu",
        version_code: 200,
        version_name: "0.2.0-beta.1",
        build_type: "release",
        debuggable: false,
        apk_url: "https://downloads.example.invalid/android/200/caatuu.apk",
        sha256: "b".repeat(64),
        bytes: 1234,
        abis: ["arm64-v8a"],
      },
    ],
    ["model-catalog", { version: 1, models: [] }],
    ["dictionary-catalog", { version: 1, dictionaries: [] }],
  ]);
  for (const component of fixture.release.components) {
    const payload = legacyPayloads.get(component.kind);
    if (payload === undefined) continue;
    await writeReferencedFile(
      fixture.releaseDirectory,
      component.manifest,
      Buffer.from(`${JSON.stringify(payload)}\n`, "utf8")
    );
  }
  await persistReleaseTree(fixture);

  assert.deepEqual(
    await verifyReleaseRecordReferences(fixture.release, fixture.releasePath),
    []
  );
});

test("publication verification binds evidence status to its release check", async (t) => {
  const fixture = await createVerifiedReleaseTree();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  const evidence = fixture.release.evidence.find((item) => item.kind === "privacy-review");
  await writeReferencedFile(
    fixture.releaseDirectory,
    evidence,
    Buffer.from(`${JSON.stringify({ evidence_id: evidence.id, status: "failed" })}\n`, "utf8")
  );
  await persistReleaseTree(fixture);
  assert.match(
    (await verifyReleaseRecordReferences(fixture.release, fixture.releasePath)).join("\n"),
    /evidence status must match \$\.checks\.privacy/u
  );
});

test("publication verification rejects symlinks and governed channels with failed checks", async (t) => {
  const failed = await createVerifiedReleaseTree((release) => {
    release.checks.notices = "failed";
    release.known_limitations.push("Third-party notices are incomplete.");
  });
  t.after(() => rm(failed.root, { force: true, recursive: true }));
  assert.match(
    (await verifyReleaseRecordReferences(failed.channel, failed.channelPath)).join("\n"),
    /private-beta publication requires 'passed'/u
  );

  const linked = await createVerifiedReleaseTree();
  t.after(() => rm(linked.root, { force: true, recursive: true }));
  const componentPath = join(
    linked.releaseDirectory,
    ...linked.release.components[0].manifest.href.split("/")
  );
  const outsidePath = join(linked.root, "outside.json");
  await writeFile(outsidePath, "{}\n", "utf8");
  await rm(componentPath);
  await symlink(outsidePath, componentPath);
  assert.match(
    (await verifyReleaseRecordReferences(linked.channel, linked.channelPath)).join("\n"),
    /symbolic links are not allowed/u
  );
});

test("publication policy covers preview gates, pointer identity, and timestamp ordering", async (t) => {
  const preview = await createVerifiedReleaseTree((release) => {
    release.checks.privacy = "not-applicable";
    release.known_limitations.push("The beta privacy-review gate is not applicable to preview.");
  }, {
    channel: "public-preview",
    androidBuildType: "debug",
    androidDebuggable: true,
  });
  t.after(() => rm(preview.root, { force: true, recursive: true }));
  assert.deepEqual(
    await verifyReleaseRecordReferences(preview.channel, preview.channelPath),
    []
  );

  const failedPrivacyPreview = await createVerifiedReleaseTree((release) => {
    release.checks.privacy = "failed";
    release.known_limitations.push("Privacy behavior did not pass review.");
  }, {
    channel: "public-preview",
    androidBuildType: "debug",
    androidDebuggable: true,
  });
  t.after(() => rm(failedPrivacyPreview.root, { force: true, recursive: true }));
  assert.match(
    (await verifyReleaseRecordReferences(failedPrivacyPreview.channel, failedPrivacyPreview.channelPath)).join("\n"),
    /checks\.privacy: a public channel cannot publish a failed check/u
  );

  const blockedPreview = await createVerifiedReleaseTree((release) => {
    release.checks.public_download = "failed";
    release.known_limitations.push("Public download verification failed.");
  }, {
    channel: "public-preview",
    androidBuildType: "debug",
    androidDebuggable: true,
  });
  t.after(() => rm(blockedPreview.root, { force: true, recursive: true }));
  assert.match(
    (await verifyReleaseRecordReferences(blockedPreview.channel, blockedPreview.channelPath)).join("\n"),
    /public-preview publication requires 'passed'/u
  );

  const unsignedPreview = await createVerifiedReleaseTree((release) => {
    release.checks.signature_verification = "not-applicable";
  }, {
    channel: "public-preview",
    androidBuildType: "debug",
    androidDebuggable: true,
  });
  t.after(() => rm(unsignedPreview.root, { force: true, recursive: true }));
  assert.match(
    (await verifyReleaseRecordReferences(unsignedPreview.channel, unsignedPreview.channelPath)).join("\n"),
    /checks\.signature_verification: public-preview publication requires 'passed'/u
  );

  const debugBeta = await createVerifiedReleaseTree(() => {}, {
    androidBuildType: "debug",
    androidDebuggable: true,
  });
  t.after(() => rm(debugBeta.root, { force: true, recursive: true }));
  assert.match(
    (await verifyReleaseRecordReferences(debugBeta.channel, debugBeta.channelPath)).join("\n"),
    /private-beta requires build_type "release" and debuggable false/u
  );

  const releasePreview = await createVerifiedReleaseTree(() => {}, {
    channel: "public-preview",
  });
  t.after(() => rm(releasePreview.root, { force: true, recursive: true }));
  assert.match(
    (await verifyReleaseRecordReferences(releasePreview.channel, releasePreview.channelPath)).join("\n"),
    /public-preview requires build_type "debug" and debuggable true/u
  );

  const mismatch = await createVerifiedReleaseTree();
  t.after(() => rm(mismatch.root, { force: true, recursive: true }));
  const mismatchedDirectory = join(mismatch.root, "0.2.0-beta.2");
  await rename(mismatch.releaseDirectory, mismatchedDirectory);
  mismatch.releaseDirectory = mismatchedDirectory;
  mismatch.releasePath = join(mismatchedDirectory, "release.json");
  mismatch.channel.release.id = "0.2.0-beta.2";
  mismatch.channel.release.href = "0.2.0-beta.2/release.json";
  await persistChannelRecord(mismatch);
  assert.match(
    (await verifyReleaseRecordReferences(mismatch.channel, mismatch.channelPath)).join("\n"),
    /pointer records "0\.2\.0-beta\.2" but the release records "0\.2\.0-beta\.1"/u
  );

  const early = await createVerifiedReleaseTree();
  t.after(() => rm(early.root, { force: true, recursive: true }));
  early.channel.updated_at = "2026-08-01T11:59:59Z";
  await persistChannelRecord(early);
  assert.match(
    (await verifyReleaseRecordReferences(early.channel, early.channelPath)).join("\n"),
    /channel publication cannot predate the referenced release/u
  );
});

test("publication policy requires release notes for beta and binds objects to disk", async (t) => {
  const noNotes = await createVerifiedReleaseTree((release) => {
    release.evidence = release.evidence.filter((item) => item.kind !== "release-notes");
  });
  t.after(() => rm(noNotes.root, { force: true, recursive: true }));
  assert.match(
    (await verifyReleaseRecordReferences(noNotes.channel, noNotes.channelPath)).join("\n"),
    /beta and stable publication requires release-notes evidence/u
  );

  const mismatch = await createVerifiedReleaseTree();
  t.after(() => rm(mismatch.root, { force: true, recursive: true }));
  mismatch.release.known_limitations.push("Unpersisted mutation.");
  assert.match(
    (await verifyReleaseRecordReferences(mismatch.release, mismatch.releasePath)).join("\n"),
    /supplied release record does not match the documentPath contents/u
  );
});
