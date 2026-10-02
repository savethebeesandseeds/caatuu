import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { arabicStandardContentPolicy } from "../policies/arabic-standard.mjs";
import { arabicStandardWordWorldProjectionPolicy } from "../word-world-projection/arabic-standard.mjs";

const adapterSource = (await readFile(new URL("../../../apps/languages/arabic-standard/static/source/language/adapter.mjs", import.meta.url), "utf8"))
  .replace('"/language-runtime/contract.mjs"', JSON.stringify(new URL("../../../apps/language-runtime/contract.mjs", import.meta.url).href));
const { default: adapter } = await import(`data:text/javascript;base64,${Buffer.from(adapterSource).toString("base64")}`);
const fixture = () => ({ courseId: "ar", contentPolicy: "arabic-standard-v1",
  targetLanguage: { languageTag: "ar", speechLocale: "ar", script: "Arab" },
  tokenization: { method: "authored-word-tokens", characterFallbackAllowed: false, pronunciationAuthority: "authored-contextual-token" },
  realizations: [{ text: "أَنا أَتَعَلَّمُ العَرَبِيَّةَ.", pronunciation: null,
    tokens: [{ surface: "أَنا", pronunciation: null }, { surface: "أَتَعَلَّمُ", pronunciation: null }, { surface: "العَرَبِيَّةَ", pronunciation: null }] }] });

test("Arabic search permits omitted vowels while assessment preserves grammatical contrasts", () => {
  assert.equal(adapter.normalization.searchKey("كَتَبَ"), adapter.normalization.searchKey("كتب"));
  assert.notEqual(adapter.normalization.answerKey("كَتَبَ"), adapter.normalization.answerKey("كُتِبَ"));
  assert.notEqual(adapter.normalization.answerKey("كَتَبْتَ"), adapter.normalization.answerKey("كَتَبْتِ"));
  assert.notEqual(adapter.normalization.searchKey("ذَكَرَ"), adapter.normalization.searchKey("ذَكَّرَ"));
  for (const [left, right] of [["أ", "ا"], ["إ", "ا"], ["ى", "ي"], ["ة", "ه"]]) {
    assert.notEqual(adapter.normalization.searchKey(left), adapter.normalization.searchKey(right));
  }
  assert.equal(adapter.normalization.text("كـتاب"), "كتاب");
});

test("Arabic presentation and segmentation preserve attached particles and combining vowels", () => {
  assert.deepEqual(adapter.learner.display("وَبِالْكِتابِ"), { text: "وَبِالْكِتابِ", languageTag: "ar", direction: "rtl" });
  assert.deepEqual(adapter.segmentation.segment("وَبِالْكِتابِ، الآنَ!"), [
    { type: "word", text: "وَبِالْكِتابِ" }, { type: "punctuation", text: "،" },
    { type: "word", text: "الآنَ" }, { type: "punctuation", text: "!" }
  ]);
  assert.equal(adapter.learner.pronunciation("كتاب"), null);
  assert.equal(adapter.speech.output.config().languageTag, "ar");
});

test("Arabic policy admits logical orthography and rejects foreign scripts or hidden direction controls", () => {
  assert.deepEqual(arabicStandardContentPolicy.validate(fixture()), []);
  for (const invalid of ["Hello", "كتاب book", "\u202eكتاب", "كـتاب", "\ufefb"]) {
    const catalog = fixture(); catalog.realizations[0].text = invalid;
    assert.ok(arabicStandardContentPolicy.validate(catalog).length, invalid);
  }
  const catalog = fixture(); catalog.realizations[0].pronunciation = { notation: "kitab" };
  assert.ok(arabicStandardContentPolicy.validate(catalog).some(issue => issue.code === "arabic.pronunciation"));
});

test("Arabic projection policy keeps English authority and confines target outputs", () => {
  const policy = arabicStandardWordWorldProjectionPolicy;
  const concepts = { concepts: [{ id: "ar.test" }], embeddingPolicy: { inputLanguage: "en", inputField: "embeddingText", targetTextAllowed: false } };
  const realizations = { courseId: "ar", targetLanguage: { languageTag: "ar" }, review: { status: "native-review-required", notes: "Draft." }, license: { status: "release-review-required" } };
  const manifest = policy.buildManifest({ concepts, realizations, paths: policy.defaultPaths });
  assert.equal(manifest.targetLanguage, "ar"); assert.equal(manifest.mediationLanguage, "en");
  assert.equal(manifest.review.pronunciationApproved, false); assert.equal(manifest.capabilities.generation, false);
  assert.match(manifest.sourceConceptCatalog, /^\/language-runtime\/static\/data\/english-concepts\//u);
  assert.throws(() => policy.buildManifest({ concepts, realizations,
    paths: { ...policy.defaultPaths, realizationsRuntime: "apps/languages/spanish/static/other.json" } }), /beneath/u);
});
