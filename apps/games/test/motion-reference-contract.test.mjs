import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateJsonSchemaSubset } from "../tooling/json-schema-subset.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const referenceRoot = path.join(
  repoRoot,
  "apps",
  "launcher",
  "static",
  "assets",
  "motion",
  "quaternius-standard-v1",
);
const manifestPath = path.join(referenceRoot, "manifest.json");
const schemaPath = path.join(referenceRoot, "manifest.v1.schema.json");
const exporterPath = path.join(
  repoRoot,
  "apps",
  "games",
  "caatuu-game",
  "tooling",
  "export-web.sh",
);
const gameManifestPath = path.join(repoRoot, "apps", "games", "caatuu-game", "game.json");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function exporterConstant(script, name) {
  const match = script.match(new RegExp(`^readonly ${name}="([^"]+)"$`, "mu"));
  assert.ok(match, `Caatuu Game exporter is missing readonly ${name}`);
  return match[1];
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

test("the preview motion manifest is strict and cannot imply release clearance", async () => {
  const [manifest, schema, gameManifest] = await Promise.all([
    readJson(manifestPath),
    readJson(schemaPath),
    readJson(gameManifestPath),
  ]);
  const validation = validateJsonSchemaSubset(schema, manifest);

  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.equal(manifest.release_status, "local-preview-only");
  assert.equal(manifest.authority_status, "catalog-candidate");
  assert.equal(manifest.provenance_status, "incomplete");
  assert.equal(manifest.distribution_status, "not-distributed");
  assert.deepEqual(new Set(manifest.promotion_requirements), new Set([
    "exact upstream source identity",
    "retrieval date",
    "modification record",
    "license and distribution review",
  ]));

  const dependency = gameManifest.dependencies.find((item) => (
    item.authority === "apps/launcher/static/assets/motion/quaternius-standard-v1/manifest.json"
  ));
  assert.ok(dependency, "Caatuu Game must declare its centralized motion dependency");
  assert.equal(gameManifest.release_status, "local-preview-only");
  assert.equal(dependency.status, "preview-only");
});

test("the motion manifest hashes the exact tracked source bytes", async () => {
  const manifest = await readJson(manifestPath);
  assert.deepEqual(
    manifest.files.map((entry) => entry.path).sort(),
    [
      "source/AnimationLibrary_Godot_Standard.glb",
      "source/Quaternius-License.txt",
    ],
  );

  for (const entry of manifest.files) {
    assert.equal(path.isAbsolute(entry.path), false, `${entry.path} must be relative`);
    assert.equal(entry.path.includes("\\"), false, `${entry.path} must use forward slashes`);
    assert.equal(entry.path.split("/").includes(".."), false, `${entry.path} must not traverse`);
    assert.equal(
      await sha256(path.join(referenceRoot, entry.path)),
      entry.sha256,
      `${entry.path} does not match its recorded SHA-256`,
    );
  }
});

test("Caatuu Game exporter constants agree with the motion authority", async () => {
  const [manifest, exporter] = await Promise.all([
    readJson(manifestPath),
    readFile(exporterPath, "utf8"),
  ]);
  const entries = new Map(manifest.files.map((entry) => [path.posix.basename(entry.path), entry]));
  const glbName = exporterConstant(exporter, "glb_name");
  const licenseName = exporterConstant(exporter, "reference_license_name");

  assert.equal(entries.get(glbName)?.sha256, exporterConstant(exporter, "glb_sha256"));
  assert.equal(
    entries.get(licenseName)?.sha256,
    exporterConstant(exporter, "reference_license_sha256"),
  );
});
