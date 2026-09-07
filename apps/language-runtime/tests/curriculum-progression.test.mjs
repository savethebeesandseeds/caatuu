import assert from 'node:assert/strict';
import test from 'node:test';
import * as metadata from '../static/source/games/curriculum-progression.mjs';
test('retained helper validates authoring metadata without any gameplay scheduler or history API',()=>{
  assert.deepEqual(Object.keys(metadata).sort(),['normalizeCurriculum','normalizeCurriculumItem','validateCurriculumCoverage']);
  const curriculum=metadata.normalizeCurriculum({schemaVersion:1,objectives:[{id:'case.roles',label:'Roles',difficulty:1}]});
  const item={difficulty:1,objectiveId:'case.roles',phase:'practice',context:'Find the receiver.',explanation:'This form names the receiver.'};
  assert.equal(metadata.normalizeCurriculumItem(item,curriculum).objectiveId,'case.roles');
  assert.throws(()=>metadata.normalizeCurriculumItem({...item,difficulty:2},curriculum));
  assert.throws(()=>metadata.normalizeCurriculumItem({...item,explanation:'<script>'},curriculum));
});
