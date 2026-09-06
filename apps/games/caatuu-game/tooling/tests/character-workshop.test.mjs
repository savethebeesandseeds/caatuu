import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { animationTick } from '../../character-workshop/animation-clock.mjs';
import { validateWorkshop, publishWorkshop, sourceRoot } from '../publish-character-workshop.mjs';

test('advertised FPS survives uneven display callback timing', () => {
  for (const fps of [6,7,8,10,12]) {
    let previous=0, count=0;
    for(let i=1;i<=600;i++) {
      const tick=animationTick(i*(1000/60)+(i%3===0?0.3:0),previous,fps);
      previous=tick.previous;
      if(tick.advance) count++;
    }
    assert.equal(count, fps*10, `${fps} fps over ten seconds`);
  }
});
test('inactive gap advances one pose without catch-up bursts', () => {
  const tick=animationTick(1055,0,10);
  assert.deepEqual(tick,{advance:true,previous:1000});
  assert.equal(animationTick(1060,tick.previous,10).advance,false);
});
test('curated frame set, hashes, transparent canvases and view files are complete', async () => {
  const {manifest,files}=await validateWorkshop();
  assert.equal(manifest.frames.filter(f=>f.action==='run').length,6);
  assert.equal(files.size,36);
  assert.ok(files.get('index.html').toString().includes('type="module"'));
});
test('publisher rejects a corrupted image before touching served output', async () => {
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'caatuu-workshop-test-'));
  try {
    const source=path.join(tmp,'source'), destination=path.join(tmp,'output');
    await fs.cp(sourceRoot,source,{recursive:true});
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination,'manifest.json'),'keep existing preview');
    await fs.appendFile(path.join(source,'images/e-run-01-sheet-v1.png'),'corruption');
    await assert.rejects(publishWorkshop({source,destination}),/hash mismatch/);
    assert.equal(await fs.readFile(path.join(destination,'manifest.json'),'utf8'),'keep existing preview');
    const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
    manifest.frames[0].file='../outside.png';
    await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest));
    await assert.rejects(validateWorkshop(source),/Unsafe/);
  } finally {
    assert.equal(path.dirname(tmp),os.tmpdir());
    await fs.rm(tmp,{recursive:true,force:true});
  }
});
