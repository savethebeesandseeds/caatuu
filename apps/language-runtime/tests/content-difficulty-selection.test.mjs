import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {validateSoundQuasarCatalog,createSoundQuasarSession} from '../static/source/games/sound-quasar/sound-quasar-core.mjs';
import {normalizeNounLandingPack,createNounLandingSession} from '../static/source/games/grammar-gravity/noun-landing-core.mjs';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const soundRaw=await read('../../languages/english-from-spanish/static/data/games/sound-quasar/content.json');
const nounRaw=await read('../../languages/english-from-spanish/static/data/games/grammar-gravity/nouns.json');

test('listening difficulty restricts answers and distractors in both manually selected modes',()=>{
  const catalog=validateSoundQuasarCatalog(soundRaw);
  for(const mode of ['words','sentences'])for(const difficulty of [1,2,3]){
    const rows=mode==='words'?catalog.items:catalog.sentences;
    const eligible=new Set(rows.filter(r=>r.difficulty<=difficulty).map(r=>r.id));
    const rounds=createSoundQuasarSession(catalog,{mode,difficulty,roundLength:500});
    assert.deepEqual(new Set(rounds.map(r=>r.answerId)),eligible);
    assert.ok(rounds.every(r=>r.choices.every(choice=>eligible.has(choice.id))));
  }
});
test('a smaller eligible listening pool reduces choices without borrowing harder material',()=>{
  const raw=structuredClone(soundRaw);
  raw.items.forEach((row,i)=>{row.difficulty=i<3?1:2;});
  const rounds=createSoundQuasarSession(validateSoundQuasarCatalog(raw),{difficulty:1,choiceCount:8,roundLength:500});
  assert.equal(rounds.length,3);assert.ok(rounds.every(r=>r.choices.length===3));
});
test('standalone noun difficulty preserves wording and keeps every authored level reachable',()=>{
  const pack=normalizeNounLandingPack(nounRaw,{courseId:nounRaw.courseId,learnerBaseLanguage:nounRaw.learnerBaseLanguage,targetLanguage:nounRaw.targetLanguage});
  for(const difficulty of [1,2,3]){
    const session=createNounLandingSession(pack,{difficulty});
    const rows=[session.item,...session.queue];
    assert.deepEqual(new Set(rows.map(r=>r.id)),new Set(nounRaw.items.filter(r=>r.difficulty<=difficulty).map(r=>r.id)));
    assert.ok(rows.every(r=>r.targetText===nounRaw.items.find(s=>s.id===r.id).targetText));
  }
});
test('invalid authored levels fail explicitly; ungraded legacy items stay available',()=>{
  for(const difficulty of [0,4,1.5,'2',null]){
    const sound=structuredClone(soundRaw);sound.items[0].difficulty=difficulty;
    assert.throws(()=>validateSoundQuasarCatalog(sound),/difficulty/);
    const noun=structuredClone(nounRaw);noun.items[0].difficulty=difficulty;
    assert.throws(()=>normalizeNounLandingPack(noun,{courseId:noun.courseId,learnerBaseLanguage:noun.learnerBaseLanguage,targetLanguage:noun.targetLanguage}),/difficulty/);
  }
  const legacy=structuredClone(soundRaw);legacy.items.forEach(r=>delete r.difficulty);
  for(const difficulty of [1,2,3])assert.equal(createSoundQuasarSession(validateSoundQuasarCatalog(legacy),{difficulty,roundLength:500}).length,legacy.items.length);
});
