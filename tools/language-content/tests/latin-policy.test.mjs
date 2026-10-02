import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { latinScientificContentPolicy } from "../policies/latin-scientific.mjs";
import { latinScientificWordWorldProjectionPolicy } from "../word-world-projection/latin-scientific.mjs";
import { validateConjugationCometCatalog, buildConjugationHelixRound, judgeConjugationHelixPair } from "../../../apps/language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs";
import { normalizeGrammarGravityPack, buildGrammarGravityRounds } from "../../../apps/language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs";
import { normalizeNounLandingPack } from "../../../apps/language-runtime/static/source/games/grammar-gravity/noun-landing-core.mjs";

const root = new URL("../../../", import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, root), "utf8"));
const adapterSource = (await readFile(new URL("apps/languages/latin-scientific/static/source/language/adapter.mjs", root), "utf8"))
  .replace('"/language-runtime/contract.mjs"', JSON.stringify(new URL("apps/language-runtime/contract.mjs", root).href));
const { default: adapter } = await import(`data:text/javascript;base64,${Buffer.from(adapterSource).toString("base64")}`);
const fixture = () => ({ courseId: "la", contentPolicy: "latin-scientific-v1",
  targetLanguage: { languageTag: "la", speechLocale: "la", script: "Latn" },
  tokenization: { method: "authored-word-tokens", characterFallbackAllowed: false },
  realizations: [{ text: "Corpus movētur.", pronunciation: null,
    tokens: [{ surface: "Corpus", pronunciation: null }, { surface: "movētur", pronunciation: null }] }] });

test("Latin search tolerates historical ligatures and missing macrons; assessment retains quantity", () => {
  assert.equal(adapter.normalization.searchKey("MĀTERIAE"), "materiae");
  assert.equal(adapter.normalization.searchKey("materiæ"), "materiae");
  assert.equal(adapter.normalization.searchKey("cœlum"), "coelum");
  for (const [a,b] of [["puella", "puellā"], ["os", "ōs"], ["legit", "lēgit"], ["mālum", "malum"]]) {
    assert.notEqual(adapter.normalization.answerKey(a), adapter.normalization.answerKey(b));
  }
  assert.equal(adapter.normalization.answerKey("PUELLA\u0304"), "puellā");
  assert.deepEqual(adapter.segmentation.segment("Mōtusne? Corpusque."), [
    {type:"word",text:"Mōtusne"},{type:"punctuation",text:"?"},
    {type:"word",text:"Corpusque"},{type:"punctuation",text:"."}
  ]);
});

test("Latin policy rejects hidden controls, foreign scripts and unapproved pronunciation", () => {
  assert.deepEqual(latinScientificContentPolicy.validate(fixture()), []);
  for (const invalid of ["σῶμα", "جسم", "身体", "Corpus\u202e", "Corpus σῶμα"]) {
    const catalog=fixture();catalog.realizations[0].text=invalid;
    assert.ok(latinScientificContentPolicy.validate(catalog).some(issue=>issue.code==="latin.script"),invalid);
  }
  const catalog=fixture();catalog.realizations[0].pronunciation={notation:"corpus"};
  assert.ok(latinScientificContentPolicy.validate(catalog).some(issue=>issue.code==="latin.pronunciation"));
});

test("Latin projection keeps English retrieval and disables unsupported speech", () => {
  const policy=latinScientificWordWorldProjectionPolicy;
  const concepts={concepts:[{id:"la.test"}],embeddingPolicy:{inputLanguage:"en",inputField:"embeddingText",targetTextAllowed:false}};
  const realizations={courseId:"la",targetLanguage:{languageTag:"la"},review:{status:"native-review-required",notes:"Latinist review pending."},license:{status:"release-review-required"}};
  const manifest=policy.buildManifest({concepts,realizations,paths:policy.defaultPaths});
  assert.equal(manifest.capabilities.speech,false);
  assert.equal(manifest.embeddingPolicy.targetTextAllowed,false);
  assert.equal(manifest.embeddingPolicy.inputLanguage,"en");
  assert.equal(manifest.review.pronunciationApproved,false);
  assert.throws(()=>policy.buildManifest({concepts,realizations,paths:{...policy.defaultPaths,realizationsRuntime:"apps/languages/spanish/static/other.json"}}),/beneath/);
});

test("Latin authored paradigms remain solvable across six persons, four tenses and syncretic gender forms", async () => {
  const prefix="apps/languages/latin-scientific/static/data/games/";
  const raw=await json(prefix+"conjugation-comet/content.json");
  const catalog=validateConjugationCometCatalog(raw);
  const lexemes=new Set(catalog.verbs.map(v=>v.targetText));
  assert.equal(lexemes.size,24);
  for(const verb of catalog.verbs){
    const round=buildConjugationHelixRound(catalog,verb.id,{rng:()=>.37});
    assert.equal(round.subjects.length,6);
    for(const subject of round.subjects)assert.ok(round.options.some(option=>judgeConjugationHelixPair(round,subject.id,option.id)),verb.id+subject.id);
  }
  const grammar=normalizeGrammarGravityPack(await json(prefix+"grammar-gravity/content.json"),{courseId:"la",targetLanguage:"la",learnerBaseLanguage:"en"});
  for(const level of [1,2,3])assert.ok(buildGrammarGravityRounds(grammar,level,()=>.37).length);
  normalizeNounLandingPack(await json(prefix+"grammar-gravity/nouns.json"),{courseId:"la",targetLanguage:"la",learnerBaseLanguage:"en"});
  // Masculine/feminine aequālis are genuine syncretism; neuter differs.
  const equal=raw.courseId&&grammar.challenges.find(v=>v.id==="la.grammar.equal.singular");
  assert.equal(equal.forms["masculine-singular"].displayForm,equal.forms["feminine-singular"].displayForm);
  assert.notEqual(equal.forms["masculine-singular"].displayForm,equal.forms["neuter-singular"].displayForm);
});

test("Latin scientific comparison uses quam independently of relative-pronoun gender", async () => {
  const source=await json("apps/languages/latin-scientific/content/word-world/content.json");
  for(const record of source.records.filter(v=>v.englishText.includes("clearer than")||v.englishText.includes("more useful than"))) {
    assert.match(record.targetText,/\bquam\b/);
  }
});
