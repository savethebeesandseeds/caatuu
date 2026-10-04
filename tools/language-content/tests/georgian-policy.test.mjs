import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {georgianContentPolicy} from '../policies/georgian.mjs';
import {georgianWordWorldProjectionPolicy} from '../word-world-projection/georgian.mjs';
import {validateConjugationCometCatalog,buildConjugationHelixRound,judgeConjugationHelixPair} from '../../../apps/language-runtime/static/source/games/conjugation-comet/conjugation-comet-core.mjs';
import {normalizeGrammarGravityPack,buildGrammarGravityRounds,validateGrammarGravityCategories} from '../../../apps/language-runtime/static/source/games/grammar-gravity/grammar-gravity-core.mjs';
import {normalizeNounLandingPack} from '../../../apps/language-runtime/static/source/games/grammar-gravity/noun-landing-core.mjs';
const root=new URL('../../../',import.meta.url),json=async name=>JSON.parse(await readFile(new URL(name,root),'utf8'));
const adapterSource=(await readFile(new URL('apps/languages/georgian/static/source/language/adapter.mjs',root),'utf8')).replace("'/language-runtime/contract.mjs'",JSON.stringify(new URL('apps/language-runtime/contract.mjs',root).href));
const {default:adapter}=await import(`data:text/javascript;base64,${Buffer.from(adapterSource).toString('base64')}`);
const fixture=()=>({courseId:'ka',targetLanguage:{languageTag:'ka',speechLocale:'ka-GE',script:'Geor'},tokenization:{method:'authored-word-tokens',characterFallbackAllowed:false},realizations:[{text:'მე სკოლაში მივდივარ.',pronunciation:null,tokens:[{surface:'მე',pronunciation:null},{surface:'სკოლაში',pronunciation:null},{surface:'მივდივარ',pronunciation:null}]}]});

test('Georgian folds Mtavruli but preserves consonant contrasts and attached morphology',()=>{
 assert.equal(adapter.normalization.answerKey('ᲥᲐᲠᲗᲣᲚᲘ'),'ქართული');
 for(const [a,b] of [['კ','ქ'],['ტ','თ'],['პ','ფ'],['წ','ც'],['ჭ','ჩ'],['ყ','კ']])assert.notEqual(adapter.normalization.answerKey(a),adapter.normalization.answerKey(b));
 assert.deepEqual(adapter.segmentation.segment('სკოლაში, მეგობრისთვის.'),[{type:'word',text:'სკოლაში'},{type:'punctuation',text:','},{type:'word',text:'მეგობრისთვის'},{type:'punctuation',text:'.'}]);
});
test('Georgian policy rejects script contamination, hidden controls and unapproved pronunciation',()=>{
 assert.deepEqual(georgianContentPolicy.validate(fixture()),[]);
 for(const text of ['სკოლა school','სკოლა школa','სკოლა\u202e','ᲡᲙᲝᲚᲐ']){const data=fixture();data.realizations[0].text=text;assert.ok(georgianContentPolicy.validate(data).some(v=>v.code==='georgian.script'));}
 const data=fixture();data.realizations[0].pronunciation={notation:'skola'};assert.ok(georgianContentPolicy.validate(data).some(v=>v.code==='georgian.pronunciation'));
});
test('Georgian preserves English retrieval and supports standard device speech without approving pronunciation',()=>{
 const policy=georgianWordWorldProjectionPolicy,concepts={concepts:[{id:'ka.test'}],embeddingPolicy:{inputLanguage:'en',inputField:'embeddingText',targetTextAllowed:false}},realizations={courseId:'ka',targetLanguage:{languageTag:'ka'},review:{status:'native-review-required',notes:'Pending.'},license:{status:'release-review-required'}};
 const manifest=policy.buildManifest({concepts,realizations,paths:policy.defaultPaths});assert.equal(manifest.capabilities.speech,true);assert.equal(manifest.embeddingPolicy.inputLanguage,'en');assert.equal(manifest.embeddingPolicy.targetTextAllowed,false);assert.equal(manifest.review.pronunciationApproved,false);
 assert.throws(()=>policy.buildManifest({concepts,realizations,paths:{...policy.defaultPaths,realizationsRuntime:'apps/languages/latin-scientific/static/other.json'}}),/beneath/);
});
test('Georgian screeve boards distinguish ergative, intransitive and experiencer subjects',async()=>{
 const raw=await json('apps/languages/georgian/static/data/games/conjugation-comet/content.json'),catalog=validateConjugationCometCatalog(raw);
 for(const verb of catalog.verbs){const round=buildConjugationHelixRound(catalog,verb.id,{rng:()=>.37});assert.equal(round.subjects.length,6);for(const subject of round.subjects)assert.ok(round.options.some(option=>judgeConjugationHelixPair(round,subject.id,option.id)),verb.id+subject.id);}
 const find=(masdar,tense)=>raw.verbs.find(v=>v.targetText===masdar&&v.tags.includes(tense)).forms.find(v=>v.id==='third-sg');
 assert.equal(find('წერა','present').subjectTargetText,'ის');assert.equal(find('წერა','aorist').subjectTargetText,'მან');assert.equal(find('წერა','present').targetPhraseFrame.afterText,' წერილს');assert.equal(find('წერა','aorist').targetPhraseFrame.afterText,' წერილი');
 assert.equal(find('მოსვლა','aorist').subjectTargetText,'ის');assert.equal(find('ქონა','present').subjectTargetText,'მას');assert.equal(find('ყოლა','present').targetText,'ჰყავს');
 const know=find('ცოდნა','present');assert.equal(know.subjectTargetText,'მან');assert.equal(know.targetText,'იცის');assert.equal(know.targetPhraseFrame.afterText,' ქართული');
});
test('Georgian number journeys have playable rounds and matching noun lanes without gender',async()=>{
 const prefix='apps/languages/georgian/static/data/games/grammar-gravity/';
 const pack=normalizeGrammarGravityPack(await json(prefix+'content.json'),{courseId:'ka',targetLanguage:'ka',learnerBaseLanguage:'en'}),nouns=normalizeNounLandingPack(await json(prefix+'nouns.json'),{courseId:'ka',targetLanguage:'ka',learnerBaseLanguage:'en'});
 validateGrammarGravityCategories(pack,nouns.lanes);
 for(const level of [1,2,3])assert.ok(buildGrammarGravityRounds(pack,level,()=>.37).length);
 assert.equal(pack.gameplay.categoryFeature,'number');for(const challenge of pack.challenges)for(const axis of challenge.axes)assert.equal(Object.hasOwn(axis.features,'gender'),false);
});
test('Georgian source has contextual case hints and numeral singular forms',async()=>{
 const source=await json('apps/languages/georgian/content/word-world/content.json');
 for(const record of source.records){assert.equal(record.embeddingText,record.englishText);assert.ok(record.tokens.every(t=>t.gloss.trim()));}
 const ticket=source.records.find(r=>r.englishText==='We need two tickets.');assert.match(ticket.targetText,/ორი ბილეთი/);assert.doesNotMatch(ticket.targetText,/ბილეთები/);
 const past=source.records.find(r=>r.englishText==='The teacher wrote a letter.');assert.equal(past.targetText,'მასწავლებელმა წერილი დაწერა.');
 for(const record of source.records.filter(r=>r.tokens.some(t=>t.surface==='ვიცი'))){
  assert.match(record.tokens[0].gloss,/nominative/,'Know takes a nominative object even in the present');
  assert.doesNotMatch(record.tokens[0].gloss,/dative/);
 }
 assert.equal(source.records.find(r=>r.englishText==='I know the answer.').targetText,'პასუხი ვიცი.');
});

test('Georgian case foundations cover its own seven cases in meaningful contexts',async()=>{
 const source=await json('apps/languages/georgian/content/word-world/content.json');
 const foundation=source.records.filter(r=>r.topic==='case-foundations');
 for(const name of ['nominative','ergative','dative','genitive','instrumental','adverbial','vocative']){
  assert.ok(foundation.some(record=>record.tokens.some(token=>token.gloss.includes(name))),name);
 }
 assert.equal(foundation.find(r=>r.englishText==='I work as a teacher.').targetText,'მასწავლებლად ვმუშაობ.');
 assert.equal(foundation.find(r=>r.englishText==='Friend, help me!').targetText,'მეგობარო, დამეხმარე!');
});
