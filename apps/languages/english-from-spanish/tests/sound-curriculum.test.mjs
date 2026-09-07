import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
const raw=JSON.parse(await readFile(new URL('../static/data/games/sound-quasar/content.json',import.meta.url),'utf8'));
const all=[...raw.items,...raw.sentences];
test('reviewed listening notes and contrast definitions remain intact as authoring evidence',()=>{
  for(const objective of raw.curriculum.objectives) {
    const owned=all.filter(i=>i.objectiveId===objective.id && i.graded!==false);
    assert.ok(owned.filter(i=>i.phase==='practice').length>=3);
    assert.ok(owned.some(i=>i.phase==='transfer'));
  }
  for(const group of raw.contrastGroups) {
    assert.ok(group.itemIds.every(id=>all.some(i=>i.id===id && i.contrastGroupId===group.id)));
    for(const id of group.itemIds) {
      const item=all.find(i=>i.id===id);
      assert.ok((item.requiredContrastIds||[]).every(other=>other!==id && group.itemIds.includes(other)));
    }
  }
  assert.equal(raw.audio.reviewStatus,'unreviewed');
});
