import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {normalizeGrammarGravityPack,buildGrammarGravityRounds} from '../static/source/games/grammar-gravity/grammar-gravity-core.mjs';
const raw=JSON.parse(await readFile(new URL('../../languages/czech/static/data/games/grammar-gravity/content.json',import.meta.url),'utf8'));
const authored=JSON.parse(await readFile(new URL('../../languages/czech/content/quality-pilot/grammar-gravity.json',import.meta.url),'utf8'));
const pack=normalizeGrammarGravityPack(raw,{courseId:'cz'});
const all=[1,2,3].flatMap(difficulty=>buildGrammarGravityRounds(pack,difficulty,()=>.37));
test('all original families and compatible additions play through the original three stages',()=>{
  const originalActive=authored.challenges.filter(family=>pack.challenges.some(active=>active.id===family.id));
  assert.ok(originalActive.length>0);
  for(const family of originalActive){
    const active=pack.challenges.find(item=>item.id===family.id);
    // Stable identities preserve learners' history through editorial revisions.
    // The current catalog, rather than an old wording snapshot, owns the text.
    assert.equal(active.difficulty,family.difficulty);
    assert.ok(active.revision>=family.revision);
    for(const [axis,form] of Object.entries(family.forms)){
      assert.ok(active.forms[axis]);
      for(const example of form.examples){
        const retained=active.forms[axis].examples.find(item=>item.id===example.id);
        assert.ok(retained,`retained learning identity ${example.id}`);
        assert.ok(retained.revision>=example.revision);
      }
    }
  }
  assert.equal(all.length,pack.challenges.flatMap(family=>Object.values(family.forms).flatMap(form=>form.examples)).length);
  for(const round of all) {
    assert.deepEqual(round.stages,['meaning','category','form']);
    assert.equal(round.flights.length,1);
    assert.ok(new Set(round.flights[0].options).size>=2);
  }
  assert.equal(pack.curriculum,undefined);
});
test('authored category mapping and repeated form spellings produce one valid answer option',()=>{
  for(const round of all) {
    const family=pack.challenges.find(item=>item.id===round.challengeId);
    const flight=round.flights[0];
    const axis=(family.axes||pack.axes).find(axis=>family.forms[axis.id].examples.some(example=>example.id===round.id));
    assert.equal(flight.categoryId,axis.features[(family.gameplay||pack.gameplay).categoryFeature]);
    assert.equal(flight.answer,family.forms[axis.id].displayForm);
    assert.deepEqual(new Set(flight.options),new Set(Object.values(family.forms).map(form=>form.displayForm)));
    assert.equal(flight.options.length,new Set(flight.options).size);
  }
});
test('invariant families stay outside the contrast game and their teaching notes remain owned by the source',()=>{
  const inactive=authored.challenges.filter(f=>!pack.challenges.some(active=>active.id===f.id));
  assert.ok(inactive.length>0);
  for(const family of inactive)assert.equal(new Set(Object.values(family.forms).map(form=>form.displayForm)).size,1);
  for(const example of authored.challenges.flatMap(f=>Object.values(f.forms).flatMap(form=>form.examples)))assert.ok(Object.hasOwn(authored.teaching,example.id));
});
