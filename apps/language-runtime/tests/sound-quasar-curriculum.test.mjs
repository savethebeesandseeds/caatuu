import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {validateSoundQuasarCatalog,createSoundQuasarSession} from '../static/source/games/sound-quasar/sound-quasar-core.mjs';
const raw=JSON.parse(await readFile(new URL('../../languages/english-from-spanish/static/data/games/sound-quasar/content.json',import.meta.url),'utf8'));
const catalog=validateSoundQuasarCatalog(raw);
test('all reviewed listening content is reachable in the original manually selected modes',()=>{
  assert.equal(catalog.items.length,36);assert.equal(catalog.sentences.length,81);
  for(const mode of ['words','sentences']) {
    const bank=mode==='words'?catalog.items:catalog.sentences;
    const session=createSoundQuasarSession(catalog,{mode,roundLength:bank.length,random:()=>.37});
    assert.deepEqual(new Set(session.map(r=>r.answerId)),new Set(bank.map(i=>i.id)));
    assert.ok(session.every(r=>r.mode===mode && r.choices.length===4));
  }
  assert.equal(catalog.curriculum,undefined);
});
test('first-party authoring has honest provenance and cannot impersonate a source-linked record',()=>{
  const authored=[...catalog.items,...catalog.sentences].filter(i=>i.sourceKind==='authored-listening');
  assert.equal(authored.length,85);
  assert.ok(authored.every(i=>i.sourceId===i.id && i.sourceReviewStatus===catalog.authoredProvenance.reviewStatus));
  for(const mutate of [r=>{delete r.authoredProvenance;},r=>{r.authoredProvenance.reviewStatus='native-approved';},r=>{r.items.find(i=>i.sourceKind).sourceId='wrong.source';}]) {
    const changed=structuredClone(raw);mutate(changed);assert.throws(()=>validateSoundQuasarCatalog(changed));
  }
});
