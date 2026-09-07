import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {normalizeGrammarGravityPack,buildGrammarGravityRounds} from '../static/source/games/grammar-gravity/grammar-gravity-core.mjs';
const raw=JSON.parse(await readFile(new URL('../../languages/czech/static/data/games/grammar-gravity/content.json',import.meta.url),'utf8'));
const authored=JSON.parse(await readFile(new URL('../../languages/czech/content/quality-pilot/grammar-gravity.json',import.meta.url),'utf8'));
const pack=normalizeGrammarGravityPack(raw,{courseId:'cz'});
const all=buildGrammarGravityRounds(pack,3,()=>.37);
test('all original families and compatible additions play through the original three stages',()=>{
  assert.deepEqual(pack.challenges.slice(0,18),authored.challenges.slice(0,18));
  assert.equal(all.length,188);
  for(const round of all) {
    assert.deepEqual(round.stages,['meaning','category','form']);
    assert.equal(round.flights.length,1);
    assert.ok(new Set(round.flights[0].options).size>=2);
  }
  assert.equal(pack.curriculum,undefined);
});
test('plural forms carry correct categories and syncretic forms occur only once as a choice',()=>{
  const flights=new Map(all.map(round=>[round.flights[0].targetText,round.flights[0]]));
  for(const [text,category,answer] of [['noví studenti','masculine-animate','noví'],['nové domy','masculine-inanimate','nové'],['nové knihy','feminine','nové'],['nová auta','neuter','nová']]) {
    const flight=flights.get(text);
    assert.equal(flight.categoryId,category); assert.equal(flight.answer,answer);
    assert.equal(flight.categoryOptions.length,4); assert.equal(new Set(flight.options).size,3);
  }
});
test('the twelve invariant examples and all teaching notes are preserved outside the active game',()=>{
  const inactive=authored.challenges.filter(f=>!pack.challenges.some(active=>active.id===f.id));
  assert.deepEqual(inactive.map(f=>f.id).sort(),['cz.agreement.jarni','cz.agreement.moderni']);
  assert.equal(inactive.flatMap(f=>Object.values(f.forms).flatMap(form=>form.examples)).length,12);
  assert.equal(Object.keys(authored.teaching).length,200);
});
