import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyTokenMeanings } from "../scripts/word-world-token-meanings.mjs";
import { StandardWordWorldProvider } from "../../../apps/languages/czech/static/source/games/word-world/word-net-standard.mjs";
import { prepareWordWorldContext } from "../../../apps/language-runtime/static/source/word-world-provider.mjs";
import { importBrowserLanguageAdapter } from "../../../apps/language-runtime/tests/browser-module-loader.mjs";

const root = new URL("../../../", import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));
const course = await json("apps/languages/czech/course.json");
const manifest = await json(course.resources.wordWorldManifest.path);
const pack = await json(`${course.resources.staticRoot.path}/data/games/word-world/content.json`);
const hints = await json("tools/czech-ml/data/word-world/standard-v0.1/token-meanings.json");
const adapter = await importBrowserLanguageAdapter(new URL(`${course.resources.staticRoot.path}/source/language/adapter.mjs`, root));
const raw = structuredClone(pack.records);
for (const record of raw) for (const target of record.targets) delete target.gloss;

test("Czech hint projection changes only the declared token meanings", () => {
  assert.deepEqual(applyTokenMeanings(raw, hints), pack.records);
  const cloned = structuredClone(raw);
  applyTokenMeanings(raw, hints);
  assert.deepEqual(raw, cloned, "Historical source data is not mutated");
});

test("Czech hints reject stale sentences, positions, unknown records and duplicate annotations", () => {
  for (const mutate of [
    copy => { copy.records[0].expectedCs += "!"; },
    copy => { copy.records[0].expectedEn += "!"; },
    copy => { copy.records[0].id = "ww-missing"; },
    copy => { copy.records[0].tokens[0].tokenIndex = 1; },
    copy => { copy.records[0].tokens[0].meaning = " "; },
    copy => { copy.records.push(structuredClone(copy.records[0])); },
    copy => { copy.records[0].tokens.push(structuredClone(copy.records[0].tokens[0])); }
  ]) {
    const copy = structuredClone(hints); mutate(copy);
    assert.throws(() => applyTokenMeanings(raw, copy));
  }
});

test("the real Czech provider uses each sentence hint instead of an unrelated dictionary homograph", async () => {
  const calls = [];
  const standardProvider = new StandardWordWorldProvider({ manifest, pack });
  const context = await prepareWordWorldContext(course, manifest, {
    adapter, standardProvider, embeddingRanker: null,
    meaningSelector: () => ({ meaning: "yak", pos: "noun" }),
    runtime: { dictionary: { search: async surface => { calls.push(surface); return {}; } } }
  });
  for (const entry of hints.records) {
    const record = context.sessionRecord(entry.id);
    assert.equal(record.target.text, entry.expectedCs);
    for (const hint of entry.tokens) {
      const result = await context.lookupMeaning({ record, token: record.target.tokens[hint.tokenIndex], tokenIndex: hint.tokenIndex });
      assert.equal(result.meaning, hint.meaning);
      assert.doesNotMatch(result.meaning, /\byak\b/u);
    }
  }
  assert.deepEqual(calls, [], "A reviewed sentence hint does not invoke general dictionary ranking");
  const record = context.sessionRecord(hints.records[0].id);
  assert.equal((await context.fullDictionaryLookup({token:record.target.tokens[0]})).meaning, "yak", "Full dictionary remains available");
  assert.equal(calls.length, 1);
  assert.equal((await context.lookupMeaning({record,token:record.target.tokens[2],tokenIndex:2})).meaning,"yak", "Unannotated words keep their existing dictionary lookup");
  assert.equal(calls.length, 2);
});

test("sentence-bound hints stay with their exact position when a surface repeats", async () => {
  const repeated = structuredClone(pack.records[0]);
  repeated.cs = "Jak, jak?";
  repeated.targets = [
    {surface:"Jak",normalized:"jak",tokenIndex:0,playable:true,gloss:"first question"},
    {surface:"jak",normalized:"jak",tokenIndex:1,playable:true,gloss:"second question"}
  ];
  const standardProvider = new StandardWordWorldProvider({ manifest, pack:{...pack,records:[repeated]} });
  const context = await prepareWordWorldContext(course, manifest, {
    adapter, standardProvider, embeddingRanker:null, meaningSelector:()=>null, runtime:null
  });
  const record = context.sessionRecord(repeated.id);
  for (const [index,expected] of [[0,"first question"],[1,"second question"]]) {
    assert.equal((await context.lookupMeaning({record,token:record.target.tokens[index],tokenIndex:index})).meaning,expected);
  }
});
