import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {validateMoonTargetReading} from '../static/source/games/memory-moon/memory-moon-reading.mjs';
import {appendTargetToneText} from '../static/source/target-text-tones.mjs';
import {createBrowserHarness} from './helpers/fake-browser.mjs';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
test('authored Mandarin Word Net composes citation tones, contextual readings and neutral syllables',async()=>{
 const source=await json('apps/languages/mandarin-simplified/content/word-world/content.json');let checked=0;
 for(const row of source.records.filter(row=>row.reviewStatus!=='untranslated')){
  const units=row.tokens.flatMap(token=>token.readingUnits);
  for(const unit of units){if(unit.surface==='一')assert.equal(unit.pronunciation.notation,'yī',row.id);if(unit.surface==='不')assert.ok(['bù','bu'].includes(unit.pronunciation.notation),row.id);}
  for(const token of row.tokens)assert.equal(token.pronunciation.notation,token.readingUnits.map(unit=>unit.pronunciation.notation).join(' '),row.id);
  assert.equal(row.pronunciation.notation,units.map(unit=>unit.pronunciation.notation).join(' '),row.id);checked++;
 }
 assert.ok(checked>0);
});
test('every authored Mandarin Verb Lab entry renders its own complete unapproved reading',async()=>{
 const rows=await json('apps/languages/mandarin-simplified/static/data/games/verb-nebula/content.json'),course=await json('apps/languages/mandarin-simplified/course.json'),{document}=createBrowserHarness({course});
 for(const row of rows.filter(row=>row.reviewStatus!=='untranslated')){
  validateMoonTargetReading(row.reading,row.target,{required:true});assert.equal(row.reviewStatus,'native-review-required');
  const host=document.createElement('span');assert.equal(appendTargetToneText(document,host,row.target,row.reading),true,row.id);assert.equal(host.textContent,row.target,row.id);
 }
 const expected=new Map([['count','shǔ'],['teach','jiāo'],['sleep','shuì jiào'],['travel','lǚ xíng'],['remember','jì de'],['keep the key','bǎo guǎn yào shi']]);
 for(const [meaning,pinyin] of expected){const row=rows.find(row=>row.source===meaning);assert.equal(row.reading.tokens.flatMap(token=>token.units.map(unit=>unit.notation)).join(' '),pinyin,meaning);}
});
