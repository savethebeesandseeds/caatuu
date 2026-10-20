import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertProductCourseProfileCapabilities,
  compactProductCourseProfile,
  transformCourseProfile,
  transformManifest,
  transformWordWorldManifest,
  transformWebViewEmbeddingCatalog,
} from "../build-product-assets.mjs";
import {
  evaluateCourseProfile,
  serializeCourseProfileSource,
} from "../../../../tools/language-packs/lib/course-contract.mjs";

const plainProfile = source => structuredClone(evaluateCourseProfile(source));
const assertDeepFrozen = value => {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertDeepFrozen(child);
};

test("compact generated profiles preserve their wrapper, nested values, and recursive freezing", () => {
  const metadata = { id: "fixture", nested: { text: 'Keep  spaces\nand Unicode: Čeština 中文 \\"',
    values: [true, false, null, 0, 1.25, { enabled: false }] } };
  const input = serializeCourseProfileSource(metadata);
  const output = compactProductCourseProfile(input);
  assert.deepEqual(plainProfile(output), metadata);
  assertDeepFrozen(evaluateCourseProfile(output));
  const anchor = "window.CaatuuCourse = deepFreeze(";
  assert.equal(output.slice(0, output.indexOf(anchor) + anchor.length),
    input.slice(0, input.indexOf(anchor) + anchor.length));
  assert.ok(output.endsWith(input.slice(input.lastIndexOf(");\n})();"))));
  assert.ok(Buffer.byteLength(output) < Buffer.byteLength(input));
  assert.equal(compactProductCourseProfile(output), output);
  assert.throws(() => compactProductCourseProfile(input.replace("deepFreeze({", "deepFreeze({unrepresentable: undefined,")),
    /must preserve every value/u);
});

test("all Android course profiles retain every property and nested freeze after data compaction", async t => {
  const workspace = new URL("../../../../", import.meta.url);
  const read = path => readFile(new URL(path, workspace), "utf8");
  const catalog = JSON.parse(await read("apps/languages/catalog.json"));
  let savedBytes = 0;
  for (const entry of catalog.courses) {
    const course = JSON.parse(await read(entry.manifest));
    if (!course.platforms.android.enabled) continue;
    const source = await read(course.resources.courseProfile.path);
    const compact = compactProductCourseProfile(source);
    assert.deepEqual(plainProfile(compact), plainProfile(source), course.id);
    assertDeepFrozen(evaluateCourseProfile(compact));
    assert.ok(Buffer.byteLength(compact) < Buffer.byteLength(source), course.id);
    savedBytes += Buffer.byteLength(source) - Buffer.byteLength(compact);
    assertProductCourseProfileCapabilities(transformCourseProfile(source, course), course.capabilities);
  }
  t.diagnostic(`Course profile data compaction saves ${savedBytes} authoring-view bytes without removing properties.`);
});

test("course capability validation rejects enabled or missing capabilities regardless of formatting", () => {
  const capabilities = { llm: false, generation: false, chat: false, offlineModels: false, semanticSearch: true };
  const source = values => serializeCourseProfileSource({ capabilities: values });
  for (const render of [source, values => compactProductCourseProfile(source(values))]) {
    assertProductCourseProfileCapabilities(render(capabilities), { embeddings: true });
    for (const name of ["llm", "generation", "chat", "offlineModels"]) {
      assert.throws(() => assertProductCourseProfileCapabilities(render({ ...capabilities, [name]: true })),
        new RegExp(`must disable ${name}`, "u"));
      const missing = { ...capabilities };
      delete missing[name];
      assert.throws(() => assertProductCourseProfileCapabilities(render(missing)),
        new RegExp(`must disable ${name}`, "u"));
    }
    assert.throws(() => assertProductCourseProfileCapabilities(render({ ...capabilities, semanticSearch: false }),
      { embeddings: true }), /must retain semantic search/u);
  }
  assertProductCourseProfileCapabilities(`globalThis.CaatuuCourse = ${JSON.stringify({ capabilities })};`);
});

test("compact product app metadata preserves authored values while excluding disabled shortcuts", () => {
  const metadata = { name: "Caatuu", description: "Language practice", custom: { text: "Keep  spaces\nand Unicode: Čeština" },
    shortcuts: [{ name: "Practice", url: "./index.html" }, { name: "Chat", url: "./chat.html" }] };
  const input = JSON.stringify(metadata, null, 2);
  const output = transformManifest(input);
  assert.deepEqual(JSON.parse(output), { ...metadata, shortcuts: [metadata.shortcuts[0]] });
  assert.ok(Buffer.byteLength(output) < Buffer.byteLength(input));
  assert.equal(JSON.parse(input).shortcuts.length, 2, "authoring metadata is preserved");
});

test("compact Word World metadata preserves its standard content contract and authored whitespace", () => {
  const metadata = { mode: "standard", generationStrategy: { disabled: true },
    sessionProvider: { kind: "standard-corpus", note: "First line\n  indented second line" },
    chunks: [{ path: "data/words.json", sha256: "a".repeat(64), bytes: 1234 }] };
  const input = JSON.stringify(metadata, null, 2);
  const output = transformWordWorldManifest(input);
  const { generationStrategy, ...expected } = metadata;
  assert.deepEqual(JSON.parse(output), expected);
  assert.ok(Buffer.byteLength(output) < Buffer.byteLength(input));
});

test("compact native embedding metadata retains all provider and license values", async () => {
  const input = await readFile(new URL("../../../languages/mandarin-simplified/static/data/embeddings/catalog.json", import.meta.url), "utf8");
  const before = JSON.parse(input);
  const output = transformWebViewEmbeddingCatalog(input);
  assert.deepEqual(JSON.parse(output), { ...before, runtime: { ...before.runtime, modelDelivery: "android-setup-download" } });
  assert.ok(Buffer.byteLength(output) < Buffer.byteLength(input));
});
