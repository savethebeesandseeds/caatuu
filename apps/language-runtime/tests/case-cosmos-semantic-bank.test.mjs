import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCaseCosmosContent } from '../static/source/games/case-cosmos/case-cosmos-core.mjs';
import { CZECH_CASE_SYSTEM } from '../../languages/czech/static/source/games/case-cosmos/case-cosmos-cs-policy.mjs';
const read=async file=>JSON.parse(await readFile(new URL(file,import.meta.url),'utf8'));
const pack=await read('../../languages/czech/static/data/games/case-cosmos/content.json');
const bank=await read('../../languages/shared/semantic-banks/case-cosmos.json');
const content=createCaseCosmosContent({courseId:'cz',caseSystem:CZECH_CASE_SYSTEM});

test('every authored Czech case context preserves its bank meaning and grades',()=>{
  const checked=content.validatePack(pack), byBank=new Map(bank.map(row=>[row.id,row]));
  assert.equal(checked.contexts.length,bank.length);
  assert.equal(new Set(checked.contexts.map(row=>row.semanticBankId)).size,bank.length);
  for(const row of checked.contexts){
    const authority=byBank.get(row.semanticBankId);
    assert.ok(authority);
    assert.equal(row.english,authority.englishText);
    assert.equal(row.difficulty,authority.difficulty);
    assert.equal(row.usefulness,authority.usefulness);
    assert.notEqual(row.reviewStatus,'untranslated');
  }
});

test('every Czech case sentence produces one correct answer without accepted variants as distractors',()=>{
  for(const difficulty of [0,1,2,3]){
    const rounds=content.buildRounds(pack,difficulty);
    assert.ok(rounds.length>=4);
    for(const round of rounds)for(const question of content.buildQuestions(round,()=>0.3)){
      assert.equal(question.candidates.filter(item=>item.matches).length,1);
      assert.equal(question.semanticBankId,round.semanticBankId);
      assert.ok(question.candidates.filter(item=>!item.matches).every(item=>!round.acceptedForms.includes(item.form)));
    }
  }
});

test('case contexts reject references from another game and undeclared accepted forms',()=>{
  const wrongBank=structuredClone(pack);
  wrongBank.contexts[0].semanticBankId='sb.word-net.000001';
  assert.throws(()=>content.validatePack(wrongBank),/case-cosmos bank row/u);
  const wrongForm=structuredClone(pack);
  wrongForm.contexts[0].acceptedForms=['nesmysl'];
  assert.throws(()=>content.validatePack(wrongForm),/undeclared or repeated accepted form/u);
});
