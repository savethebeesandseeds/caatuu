import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {validateMemoryMoonContent, memoryMoonContentSummary} from '../lib/memory-moon-content.mjs';
import {validateMemoryMoonCatalog, selectMemoryMoonChallenges} from '../../../apps/language-runtime/static/source/games/memory-moon/memory-moon-core.mjs';

const envelope = JSON.parse(await readFile(new URL('../../../apps/languages/spanish/static/data/games/memory-moon/content.json', import.meta.url), 'utf8'));
function fixture() {
  const pack = {...structuredClone(envelope), challenges:[]};
  for (let difficulty=0; difficulty<4; difficulty++) for(let index=0; index<6; index++) {
    const number=difficulty*6+index+1, id=`mm-es-fixture-${number}`;
    const englishText=`The cat is on shelf ${number}.`;
    const alternatives=[englishText,`The cat is under shelf ${number}.`,`The cat is behind shelf ${number}.`];
    pack.challenges.push({id, revision:1, semanticBankId:`sb.memory-moon.${String(number).padStart(6,'0')}`,
      difficulty, usefulness:80, complexity:30, topic:'location', familyId:`mm-es-shelf-${number}`,
      englishText, embeddingText:englishText, learnerBaseText:englishText, targetText:`El gato está en la balda ${number}.`,
      focus:{kind:'location', englishConcepts:['cat','shelf']}, correctChoiceId:`${id}-0`,
      choices:alternatives.map((text,index)=>({id:`${id}-${index}`, text, englishAuditText:text,
        ...(index ? {contrast:{kind:'location',explanation:'The position of the cat changes.'}} : {})}))});
  }
  pack.challenges.unshift({id:'mm-es-999999',semanticBankId:'sb.memory-moon.999999',reviewStatus:'untranslated',revision:1,
    difficulty:1,usefulness:80,complexity:30,englishText:'The dog is here.',embeddingText:'The dog is here.',targetText:'',learnerBaseText:'The dog is here.'});
  return pack;
}

test('mixed Moon catalogs select only complete questions and report pending inventory separately',()=>{
  const pack=fixture();
  validateMemoryMoonContent(pack);
  for(const sample of [0,.5,.999]) {
    const chosen=selectMemoryMoonChallenges(pack,{difficulty:1,limit:6,random:()=>sample}).items;
    assert.equal(chosen.length,6);
    assert.ok(chosen.every(item=>item.reviewStatus!=='untranslated' && item.choices.length===3));
  }
  const summary=memoryMoonContentSummary(pack);
  assert.equal(summary.challenges,24);
  assert.equal(summary.untranslated,1);
  assert.equal(summary.choices,72);
});

test('untranslated Moon catalogs have an empty playable inventory and reject duplicate placeholder IDs',()=>{
  const pack=fixture();
  pack.challenges=pack.challenges.slice(0,1);
  assert.equal(memoryMoonContentSummary(pack).challenges,0);
  assert.deepEqual(selectMemoryMoonChallenges(pack,{difficulty:1}).items,[]);
  pack.challenges.push(structuredClone(pack.challenges[0]));
  assert.throws(()=>validateMemoryMoonCatalog(pack),/Invalid Memory Moon/u);
  assert.throws(()=>validateMemoryMoonContent(pack),/unique course-scoped/u);
});

test('Spanish No is a valid shared reply without admitting copied English sentence prompts',()=>{
  const pack=fixture();
  pack.learnerBaseLanguage='es-ES';pack.targetLanguage='en-US';
  for(const item of pack.challenges.filter(row=>row.reviewStatus!=='untranslated')) {
    item.learnerBaseText=item.targetText;item.targetText=item.englishText;
    for(const choice of item.choices) choice.text=choice.id===item.correctChoiceId?item.learnerBaseText:`Alternativa ${choice.id}`;
  }
  const item=pack.challenges[1];
  item.englishText=item.embeddingText=item.targetText=item.learnerBaseText='No.';
  item.choices[0].text=item.choices[0].englishAuditText='No.';
  validateMemoryMoonContent(pack);
  const other=pack.challenges[2];
  other.learnerBaseText=other.englishText;other.choices[0].text=other.englishText;
  assert.throws(()=>validateMemoryMoonContent(pack),/non-English learner-base realization/u);
});
