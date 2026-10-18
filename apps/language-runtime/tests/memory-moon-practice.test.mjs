import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createBrowserHarness } from './helpers/fake-browser.mjs';
import { createMemoryMoonPractice } from '../static/source/games/memory-moon/memory-moon-practice.mjs';
import { MEMORY_MOON_ROUND_COUNT, validateMemoryMoonCatalog, memoryMoonWeaknesses, selectMemoryMoonChallenges,
  moonIllumination, moonShadePath } from '../static/source/games/memory-moon/memory-moon-core.mjs';
import { moonIllumination as demoIllumination, moonShadePath as demoShade } from '../static/review/memory-moon-core.mjs';

const course={id:'test',sourceLanguage:{id:'en',locale:'en'},targetLanguage:{id:'nb',locale:'nb-NO'},storage:{namespace:'caatuu-moon-test'}};
const pack=()=>({schemaVersion:'caatuu-memory-moon-content-v1',courseId:'test',gameId:'memory-moon',
  learnerBaseLanguage:'en',targetLanguage:'nb-NO',englishAuditLanguage:'en',embeddingPolicy:{inputLanguage:'en',inputField:'embeddingText'},
  challenges:[1,2,3].flatMap(difficulty=>Array.from({length:12},(_,index)=>{
    const topic=index<6?'food':'travel', englishText=`The ${topic==='food'?'bread':'train'} example ${difficulty} number ${index}.`;
    return {id:`mm-test-${difficulty}-${index}`,revision:1,difficulty,usefulness:80,complexity:difficulty*20,topic,
      familyId:`mm-test-family-${difficulty}-${index}`,targetText:`Mål ${difficulty} ${index}`,learnerBaseText:englishText,englishText,embeddingText:englishText,
      focus:{kind:'object',englishConcepts:[topic]},correctChoiceId:'correct',choices:[
        {id:'correct',text:englishText,englishAuditText:englishText},
        ...['one','two'].map(id=>({id,text:`A different ${topic} ${id} example.`,englishAuditText:`A different ${topic} ${id} example.`,contrast:{kind:'object',explanation:'Changes the object.'}}))]};
  }))});
const clock=Date.parse('2026-10-18T12:00:00Z');
const wrong=(itemId,englishText,gameId='verb-nebula',changes={})=>({identity:{courseId:'test',gameId,bankId:'default',itemId},text:englishText,
  history:{exposures:1,successes:0,mistakes:1,lastEvidence:'independent',lastCorrect:false,lastAttemptAt:new Date(clock-1000).toISOString(),
    firstSeenAt:new Date(clock-1000).toISOString(),lastSeenAt:new Date(clock-1000).toISOString(),...changes}});
const vectorsFor=texts=>texts.map(text=>text.includes('bread')||text.includes('food')?[1,0]:[0,1]);
function random(seed=3){return()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};}
function profile(){
  const harness=createBrowserHarness({course});
  harness.context.Date=class extends Date {
    constructor(...args){super(...(args.length?args:[clock]));}
    static now(){return clock;}
  };
  vm.runInContext(profileSource,harness.context);
  return {...harness,learning:harness.window.CaatuuLearning};
}
const profileSource=await readFile(new URL('../static/source/learning-profile.js',import.meta.url),'utf8');
const noEvidence=async()=>({items:[],issues:[]});

test('runtime catalogs reject foreign courses, non-English embedding text and equivalent alternatives',()=>{
  const p=pack();assert.equal(validateMemoryMoonCatalog(p,{course}),p);
  assert.throws(()=>validateMemoryMoonCatalog(p,{course:{...course,id:'other'}}),/another course/);
  for(const mutate of [p=>p.challenges[0].englishText='汉字',p=>p.challenges[0].embeddingText='Other meaning.',
    p=>p.challenges[0].choices[1].englishAuditText=p.challenges[0].englishText]){
    const broken=pack();mutate(broken);assert.throws(()=>validateMemoryMoonCatalog(broken));
  }
});

test('only retained independent errors or support produce same-course weakness hints',()=>{
  const items=[wrong('error','Food and bread.'),wrong('help','Train journeys.','word-world',{
    lastEvidence:'assisted',lastCorrect:true,mistakes:0,assistedSuccesses:1,lastAssistedAt:new Date(clock).toISOString()}),
    wrong('exposure','A house.','verb-nebula',{lastEvidence:'exposure',lastCorrect:null,mistakes:0}),
    {...wrong('foreign','Foreign food.'),identity:{courseId:'other',gameId:'verb-nebula',bankId:'default',itemId:'foreign'}},
    wrong('script','你好')];
  const hints=memoryMoonWeaknesses(items,{courseId:'test',now:clock});
  assert.deepEqual(new Set(hints.map(item=>item.identity.itemId)),new Set(['error','help']));
  assert.equal(hints.find(item=>item.identity.itemId==='error').reason,'independent-mistake');
});

test('weighted selection covers multiple weak regions, explores, respects exact badge and avoids recent identities',()=>{
  const p=pack(), weaknesses=[{englishText:'Food and bread.',weight:2},{englishText:'Train journeys.',weight:1}];
  const texts=[...weaknesses.map(item=>item.englishText),...p.challenges.map(item=>item.englishText)];
  const vectorsByText=new Map(texts.map((text,index)=>[text,vectorsFor(texts)[index]]));
  const result=selectMemoryMoonChallenges(p,{difficulty:2,weaknesses,vectorsByText,random:random(),now:clock});
  assert.equal(result.items.length,MEMORY_MOON_ROUND_COUNT);assert.equal(new Set(result.items.map(item=>item.id)).size,MEMORY_MOON_ROUND_COUNT);
  assert.ok(result.items.every(item=>item.difficulty===2));assert.equal(result.trace.coveredRegions,2);
  assert.ok(result.items.some(item=>item.selectionReason==='exploration'));
  const again=selectMemoryMoonChallenges(p,{difficulty:2,weaknesses,vectorsByText,random:random(9),now:clock,
    recentIds:result.items.map(item=>item.id),recentFamilies:result.items.map(item=>item.familyId)});
  assert.ok(again.items.every(item=>!result.items.some(previous=>previous.id===item.id)));
  assert.equal(selectMemoryMoonChallenges(p,{difficulty:1,random:random()}).trace.mode,'no-history');
  const sparse={...p,challenges:p.challenges.filter(item=>item.difficulty===1)};
  assert.equal(selectMemoryMoonChallenges(sparse,{difficulty:3}).items.length,0,'empty badge never borrows questions');
});

test('stochastic draws vary rather than repeatedly sorting the same top items',()=>{
  const p=pack(), selections=new Set();
  for(let seed=1;seed<=20;seed++)selections.add(selectMemoryMoonChallenges(p,{difficulty:1,random:random(seed)}).items.map(item=>item.id).join(','));
  assert.ok(selections.size>10);
});

test('semantic neighbours and explicit families cool down while alternative meanings remain available',()=>{
  const p=pack(),first=p.challenges[0];
  const vectorsByText=new Map(p.challenges.map(item=>[item.englishText,vectorsFor([item.englishText])[0]]));
  const semantic=selectMemoryMoonChallenges(p,{difficulty:1,recentIds:[first.id],vectorsByText,random:random()});
  assert.ok(semantic.items.every(item=>item.topic==='travel'),'recent food meaning rests its near neighbours when six alternatives exist');
  p.challenges.filter(item=>item.difficulty===1&&item.topic==='food').forEach(item=>{item.familyId='mm-test-food-family';});
  const family=selectMemoryMoonChallenges(p,{difficulty:1,recentFamilies:['mm-test-food-family'],random:random()});
  assert.ok(family.items.every(item=>item.familyId!=='mm-test-food-family'));
});

test('fresh source evidence is reread each round and only English reaches optional vectors',async()=>{
  const p=pack(),a=profile(),calls=[];let resolves=0;
  const practice=createMemoryMoonPractice({course,learning:a.learning,pack:p,random:random(),now:()=>clock,
    resolveEvidence:async()=>({items:[wrong(`source-${++resolves}`,resolves===1?'Food and bread.':'Train journeys.')]}),
    embedTexts:async texts=>{calls.push(...texts);assert.ok(texts.every(text=>!/Mål|汉字/u.test(text)));return vectorsFor(texts);}});
  await practice.startRound({difficulty:1});await practice.startRound({difficulty:2});
  assert.equal(resolves,2);assert.ok(calls.includes('Train journeys.'));
  assert.equal(practice.snapshot().selection.semanticStatus,'ready');practice.dispose();
});

test('a new service retains semantic cooldown through the persisted Moon assessment bank',async()=>{
  const p=pack(),a=profile(),first=p.challenges[0];
  a.learning.recordExposure('memory-moon',{bankId:'translations',itemId:first.id,encounterId:'prior-moon',
    generation:a.learning.contentGeneration(),correct:true,evidence:'independent'});
  const practice=createMemoryMoonPractice({course,learning:a.learning,pack:p,random:random(),now:()=>clock,
    resolveEvidence:noEvidence,embedTexts:async texts=>vectorsFor(texts)});
  const state=await practice.startRound({difficulty:1});
  assert.ok(state.items.every(item=>item.topic==='travel'),'fresh service avoids the recently assessed meaning and close semantic neighbours');
  assert.equal(state.selection.mode,'balanced-practice');practice.dispose();
});

test('actual reducer preserves independent audio-prompt success, mistakes and assisted correction without source credit',async()=>{
  const p=pack(),a=profile();let sequence=0;
  const practice=createMemoryMoonPractice({course,learning:a.learning,pack:p,random:random(),resolveEvidence:noEvidence,encounterId:()=>`moon-${++sequence}`});
  let state=await practice.startRound({difficulty:1});const first=state.currentItem;
  assert.equal(Object.keys(a.learning.contentHistory('memory-moon','translations')).length,0,'merely rendering grants no exposure');
  practice.assist('audio');state=practice.answer(first.correctChoiceId);
  let evidence=a.learning.contentHistory('memory-moon','translations')[first.id];
  assert.equal(evidence.independentSuccesses,1);assert.equal(evidence.exposures,1);
  assert.equal(state.independentCorrectCount,1);
  state=practice.advance();const second=state.currentItem;
  const wrongChoice=second.choices.find(choice=>choice.id!==second.correctChoiceId).id;
  practice.answer(wrongChoice);practice.answer(wrongChoice);state=practice.answer(second.correctChoiceId);
  evidence=a.learning.contentHistory('memory-moon','translations')[second.id];
  assert.equal(evidence.mistakes,1);assert.equal(evidence.assistedSuccesses,1);assert.equal(evidence.independentSuccesses,0);
  assert.equal(evidence.exposures,1);assert.equal(state.correctCount,2);assert.equal(state.independentCorrectCount,1);
  assert.equal(Object.keys(a.learning.contentHistory('verb-nebula','default')).length,0);
  assert.equal(state.items.length,3);
  assert.equal(state.phase,'answered','the second correct answer does not complete the challenge');
  for(let index=2;index<MEMORY_MOON_ROUND_COUNT;index++){state=practice.advance();state=practice.answer(state.currentItem.correctChoiceId);}
  assert.equal(state.phase,'complete');assert.equal(state.progress,1);
  const summary=a.learning.performance().games['memory-moon'];
  assert.ok(summary,'Memory Moon owns aggregate participation');
  assert.equal(summary.rounds,1);assert.equal(summary.xp,3);practice.answer(state.currentItem.correctChoiceId);
  assert.equal(a.learning.performance().games['memory-moon'].rounds,1);
  practice.dispose();await a.learning.retryPendingSaves();
});

test('revealed answers are assisted and source-generation reset fences old answers and aggregates',async()=>{
  const p=pack(),a=profile();
  const practice=createMemoryMoonPractice({course,learning:a.learning,pack:p,resolveEvidence:noEvidence,random:random()});
  let state=await practice.startRound({difficulty:1});const id=state.currentItem.id;
  practice.assist('reveal');state=practice.answer(state.currentItem.correctChoiceId);
  assert.equal(a.learning.contentHistory('memory-moon','translations')[id].assistedSuccesses,1);
  state=practice.advance();await a.learning.resetProgress();
  state=practice.answer(state.currentItem.correctChoiceId);
  assert.equal(state.saveStatus,'stale');assert.equal(Object.keys(a.learning.contentHistory('memory-moon','translations')).length,0);
  assert.equal(a.learning.summarize().attempts,0);
  practice.dispose();
});

test('cancelled or superseded selection cannot install a session and unavailable semantics stays playable',async()=>{
  const p=pack(),a=profile();let release;
  const practice=createMemoryMoonPractice({course,learning:a.learning,pack:p,resolveEvidence:()=>new Promise(resolve=>{release=resolve;})});
  const pending=practice.startRound({difficulty:1});practice.cancelPending();release({items:[]});
  await assert.rejects(pending,{name:'AbortError'});assert.equal(practice.snapshot(),null);practice.dispose();
  const fallback=createMemoryMoonPractice({course,learning:a.learning,pack:p,random:random(),
    resolveEvidence:async()=>({items:[wrong('source','A weak meaning.')] }),embedTexts:async()=>{throw new Error('offline');}});
  const state=await fallback.startRound({difficulty:3});
  assert.equal(state.items.length,MEMORY_MOON_ROUND_COUNT);assert.equal(state.selection.semanticStatus,'unavailable');
  assert.equal(state.selection.mode,'varied-fallback');fallback.dispose();
});

test('a reset while evidence is resolving discards the pending round before any credit',async()=>{
  const a=profile();let release;
  const practice=createMemoryMoonPractice({course,learning:a.learning,pack:pack(),
    resolveEvidence:()=>new Promise(resolve=>{release=resolve;})});
  const pending=practice.startRound({difficulty:1});await a.learning.resetProgress();release({items:[]});
  await assert.rejects(pending,{name:'AbortError'});assert.equal(practice.snapshot(),null);
  assert.equal(a.learning.summarize().attempts,0);practice.dispose();
});

test('a reset dispatched synchronously by exposure persistence also fences aggregate counters',async()=>{
  const a=profile(),practice=createMemoryMoonPractice({course,learning:a.learning,pack:pack(),resolveEvidence:noEvidence,random:random()});
  const state=await practice.startRound({difficulty:1});
  a.window.addEventListener('caatuu:content-practice-change',()=>a.learning.resetProgress(),{once:true});
  const after=practice.answer(state.currentItem.correctChoiceId);
  assert.equal(after.saveStatus,'stale');assert.equal(a.learning.summarize().attempts,0);practice.dispose();
});

test('production moon phase geometry preserves every approved demo phase',()=>{
  for(const progress of [0,.1,.25,.5,.75,1]){
    assert.equal(moonShadePath(progress),demoShade(progress));assert.equal(moonIllumination(progress),demoIllumination(progress));
  }
});
