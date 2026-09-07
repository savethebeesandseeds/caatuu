import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {validateVerbNebulaCatalog, filterVerbPairsForDifficulty, dealVerbRound, restoreVerbQueue}
  from '../../../language-runtime/static/source/games/verb-nebula/verb-nebula-core.mjs';
const rows=JSON.parse(await readFile(new URL('../static/data/games/verb-nebula/content.json',import.meta.url),'utf8'));
const authored=JSON.parse(await readFile(new URL('../content/quality-pilot/verb-nebula.json',import.meta.url),'utf8'));
const pairs=validateVerbNebulaCatalog(rows,{learnerBaseLanguage:'es-ES'});
test('expanded verbs retain every reviewed identity and translation with no sentence metadata in play',()=>{
  assert.equal(pairs.length,46);
  for (const pair of pairs) {
    const saved=authored.find(item=>item.id===pair.id);
    assert.deepEqual([pair.target,pair.source,pair.englishAuditText],[saved.target,saved.source,saved.englishAuditText]);
    assert.equal(pair.learning,undefined);
  }
  assert.ok(rows.every(row=>!Object.hasOwn(row,'learning')));
  assert.ok(authored.every(row=>row.learning.context && row.learning.transfer && row.learning.noteBaseText));
});
test('original queue resumes and deals each level as verbs with matching translation identities',()=>{
  for(const level of [1,2,3]) {
    const eligible=filterVerbPairsForDifficulty(pairs,level);
    const ids=eligible.map(pair=>pair.id);
    const saved=[ids.at(-1),ids[0]];
    const queue=restoreVerbQueue(eligible,saved,()=>.37);
    assert.deepEqual(queue.slice(0,2),saved);
    const dealt=dealVerbRound(eligible,queue,4,()=>.37);
    assert.equal(dealt.round.length,4);
    assert.deepEqual(dealt.round.map(pair=>pair.id),queue.slice(0,4));
    assert.ok(dealt.round.every(pair=>rows.some(row=>row.id===pair.id && row.target===pair.target && row.source===pair.source)));
  }
});
