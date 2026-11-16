import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { resolveRecordProjectionProvider } from "../record-projection/registry.mjs";
import { readRepositoryJson, validateWordWorldContent } from "./word-world-course-content.mjs";

export const RECORD_PUBLICATION_CONTRACT = "word-world-records-v1";
const keys = ["contract", "authoring", "provider", "runtime", "manifest"];
const safePath = value => typeof value === "string" && value && !value.includes("\\")
  && !path.posix.isAbsolute(value) && path.posix.normalize(value) === value
  && !value.split("/").some(part => !part || part === "." || part === "..");

export function recordPublicationShapeIssues(course) {
  const issues = [], declaration = course.publication;
  const add = message => issues.push({ code: "publication.record-contract", message: `${course.id} ${message}` });
  if (!declaration || JSON.stringify(Object.keys(declaration).sort()) !== JSON.stringify([...keys].sort())) {
    add("record publication must declare exactly contract, authoring, provider, runtime and manifest.");
    return issues;
  }
  if (declaration.contract !== RECORD_PUBLICATION_CONTRACT) add("record publication contract is unsupported.");
  if (!resolveRecordProjectionProvider(declaration.provider)) add("record projection provider is unsupported.");
  if (!safePath(declaration.authoring) || declaration.authoring !== `apps/languages/${course.directoryName}/content/word-world/content.json`) add("authoring must be the owning course's Word World content JSON.");
  const staticRoot = course.resources?.staticRoot?.path;
  for (const field of ["runtime", "manifest"]) {
    if (!safePath(declaration[field]) || !safePath(staticRoot) || !declaration[field].startsWith(`${staticRoot}/`)
      || !declaration[field].endsWith(".json")) add(`${field} must be a JSON file inside the course static root.`);
  }
  if (declaration.manifest !== course.resources?.wordWorldManifest?.path) add("manifest must match the declared Word World resource.");
  if (new Set([declaration.authoring, declaration.runtime, declaration.manifest]).size !== 3) add("authoring and runtime outputs must be distinct.");
  if (!course.games?.includes("word-net")) add("record publication requires Word World.");
  return issues;
}

export async function planRecordPublication({ root, course, document }) {
  const issues = recordPublicationShapeIssues(course);
  assert.equal(issues.length, 0, issues.map(issue => issue.message).join("\n"));
  const declaration = course.publication;
  const provider = resolveRecordProjectionProvider(declaration.provider);
  const authoring = document ?? await readRepositoryJson(root, declaration.authoring);
  validateWordWorldContent(authoring, course);
  const [rubric, manifest] = await Promise.all([
    readRepositoryJson(root, provider.rubricPath), readRepositoryJson(root, declaration.manifest)
  ]);
  const runtimeFile = path.posix.relative(path.posix.dirname(declaration.manifest), declaration.runtime);
  assert.ok(safePath(runtimeFile), "Record runtime must stay beneath its manifest directory.");
  const projection = provider.project({ document: authoring, rubric, manifest,
    sourcePath: declaration.authoring, runtimeFile });
  return { ...projection, previousRuntimeFile: manifest.runtimeFile, outputs: new Map([
    [declaration.runtime, projection.bytes],
    [declaration.manifest, JSON.stringify(projection.manifest, null, 2) + "\n"]
  ]) };
}

export async function validateRecordPublication({ root, course }) {
  const plan = await planRecordPublication({ root, course });
  // Reading through the canonical-path helper rejects symlinks before checking
  // bytes. Both the record data and cache-addressed manifest must agree.
  await readRepositoryJson(root, course.publication.runtime);
  const actual = await readFile(path.resolve(root, course.publication.runtime), "utf8");
  assert.equal(actual, plan.bytes, "Record runtime differs from its declared authoring authority.");
  const manifest = await readRepositoryJson(root, course.publication.manifest);
  assert.ok(isDeepStrictEqual(manifest, plan.manifest), "Record manifest differs from its declared authoring authority.");
  return { recordCount: manifest.recordCount };
}
