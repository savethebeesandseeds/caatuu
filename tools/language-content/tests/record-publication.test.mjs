import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { planRecordPublication, recordPublicationShapeIssues, validateRecordPublication } from "../lib/record-publication.mjs";
import { resolveRecordProjectionProvider } from "../record-projection/registry.mjs";
import { repositoryRoot, readRepositoryJson } from "../lib/word-world-course-content.mjs";

const course = await readRepositoryJson(repositoryRoot, "apps/languages/czech/course.json");
const document = await readRepositoryJson(repositoryRoot, course.publication.authoring);
const manifest = await readRepositoryJson(repositoryRoot, course.publication.manifest);
const provider = resolveRecordProjectionProvider(course.publication.provider);
const write = async (root, file, value) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
};

async function fixture(t, id = "another-course") {
  // Data-only fixtures; no application checkout or service is copied.
  const root = await mkdtemp(path.join(tmpdir(), "caatuu-record-publication-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const selected = structuredClone(course);
  selected.id = id;
  selected.directoryName = id;
  selected.resources.staticRoot.path = `apps/languages/${id}/static`;
  selected.resources.wordWorldManifest.path = `apps/languages/${id}/static/data/games/word-world/manifest.json`;
  selected.publication = {
    contract: "word-world-records-v1", provider: course.publication.provider,
    authoring: `apps/languages/${id}/content/word-world/content.json`,
    runtime: `apps/languages/${id}/static/data/games/word-world/content.json`,
    manifest: selected.resources.wordWorldManifest.path
  };
  const source = { ...structuredClone(document), courseId: id };
  await write(root, selected.publication.authoring, source);
  await write(root, selected.publication.manifest, manifest);
  await write(root, provider.rubricPath, await readRepositoryJson(repositoryRoot, provider.rubricPath));
  const plan = await planRecordPublication({ root, course: selected });
  for (const [file, bytes] of plan.outputs) await write(root, file, bytes);
  return { root, selected, source, plan };
}

test("current standard records have an exact checked authoring-to-runtime projection", async () => {
  assert.deepEqual(recordPublicationShapeIssues(course), []);
  assert.deepEqual(await validateRecordPublication({ root: repositoryRoot, course }), { recordCount: document.records.length });
});

test("record publication cannot lose verified corpus identity through missing or malformed metadata", () => {
  for (const value of [undefined, null, "", " ", 1, {}, "x".repeat(81), " leading", "bad\u0000version"]) {
    const source = { ...document, metadata: { ...document.metadata, corpusVersion: value } };
    assert.throws(() => provider.validate(source, course), /corpusVersion/);
    assert.throws(() => provider.project({ document: source, manifest }), /corpusVersion/,
      "direct projection must reject malformed identity before creating either output");
  }
});

test("identical supported publication is valid under another course identity and preserves record IDs", async t => {
  const { root, selected, plan } = await fixture(t);
  assert.deepEqual(recordPublicationShapeIssues(selected), []);
  assert.deepEqual(await validateRecordPublication({ root, course: selected }), { recordCount: document.records.length });
  const original = await readFile(path.join(repositoryRoot, course.publication.runtime), "utf8");
  assert.equal(plan.bytes, original, "Changing course identity must not rewrite learner records or runtime bytes.");
});

test("record publication rejects stale runtime after a valid authoring change", async t => {
  const { root, selected, source } = await fixture(t);
  source.records[0].englishText = "My brother walks.";
  source.records[0].embeddingText = source.records[0].englishText;
  await write(root, selected.publication.authoring, source);
  await assert.rejects(validateRecordPublication({ root, course: selected }), /runtime differs from its declared authoring authority/);
});

test("record publication rejects a tampered manifest count or content digest", async t => {
  const { root, selected, plan } = await fixture(t);
  await write(root, selected.publication.manifest, { ...plan.manifest, recordCount: 1, contentSha256: "0".repeat(64) });
  await assert.rejects(validateRecordPublication({ root, course: selected }), /manifest differs from its declared authoring authority/);
});

test("record publication rejects cross-course paths and unimplemented providers", () => {
  const invalid = structuredClone(course);
  invalid.publication.runtime = "apps/languages/spanish/static/data/games/word-world/content.json";
  invalid.publication.provider = "unimplemented-v1";
  const issues = recordPublicationShapeIssues(invalid);
  assert.ok(issues.some(issue => /provider is unsupported/.test(issue.message)));
  assert.ok(issues.some(issue => /inside the course static root/.test(issue.message)));
});

test("record publication rejects symlinked authoring instead of following another authority", async t => {
  const { root, selected, source } = await fixture(t);
  const original = path.join(root, selected.publication.authoring);
  const redirected = `${original}.redirect`;
  await writeFile(redirected, JSON.stringify(source));
  await rm(original);
  await symlink(redirected, original);
  await assert.rejects(validateRecordPublication({ root, course: selected }), /noncanonical source/);
});

test("record provider support follows language declarations rather than accepting arbitrary targets", async t => {
  const { root, selected, source } = await fixture(t);
  selected.targetLanguage.locale = "es-ES";
  source.targetLanguage = "es-ES";
  await write(root, selected.publication.authoring, source);
  await assert.rejects(validateRecordPublication({ root, course: selected }), /supports Czech target text/);
});
