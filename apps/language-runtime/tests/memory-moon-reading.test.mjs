import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateMoonTargetReading } from '../static/source/games/memory-moon/memory-moon-reading.mjs';
import { validateMemoryMoonCatalog } from '../static/source/games/memory-moon/memory-moon-core.mjs';
import { validateMemoryMoonContent } from '../../../tools/language-content/lib/memory-moon-content.mjs';

const pack = JSON.parse(await readFile(new URL('../../languages/mandarin-simplified/static/data/games/memory-moon/content.json', import.meta.url), 'utf8'));
test('every Mandarin challenge owns complete Hanzi-aligned preview readings', () => {
  for (const item of pack.challenges) {
    assert.equal(validateMoonTargetReading(item.targetReading, item.targetText, {required:true}), item.targetReading);
    assert.equal(item.targetReading.tokens.flatMap(token=>token.units).map(unit=>unit.surface).join(''),
      [...item.targetText.matchAll(/\p{Script=Han}/gu)].map(([char])=>char).join(''));
  }
  assert.equal(pack.review.humanApproved, false);
  assert.equal(validateMemoryMoonCatalog(pack), pack);
  assert.equal(validateMemoryMoonContent(pack), pack);
});
test('runtime and authoring reject missing, reordered, partial, fabricated-status and malformed readings', () => {
  const changes = [
    item=>{delete item.targetReading;},
    item=>{item.targetReading.tokens[0].units.pop();},
    item=>{item.targetReading.tokens[0].units.reverse();},
    item=>{item.targetReading.tokens[0].units[0].notation='<script>';},
    item=>{item.targetReading.status='native-reviewed';},
    item=>{item.targetReading.tokens[0].surface='错';}
  ];
  for (const mutate of changes) {
    const copy = structuredClone(pack); mutate(copy.challenges[0]);
    assert.throws(()=>validateMemoryMoonCatalog(copy),/targetReading/);
    assert.throws(()=>validateMemoryMoonContent(copy),/targetReading/);
  }
  assert.equal(validateMoonTargetReading(undefined,'Hello'),null);
});
