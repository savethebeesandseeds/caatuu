import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
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
  assert.equal(manifest.frames.length,55);
  assert.equal(manifest.frames.filter(f=>f.action==='run').length,30);
  for (const direction of ['S','N','E','NE','SE']) {
    assert.equal(manifest.frames.filter(f=>f.direction===direction && f.action==='run').length,6);
  }
  assert.equal(files.size,84);
  const strips=manifest.exports.direction_strips;
  assert.equal(strips.length,24);
  for (const direction of ['S','N','E','NE','SE','W','NW','SW']) {
    for (const [action,width,count] of [['walk',2048,4],['run',3072,6],['all',5632,11]]) {
      const strip=strips.find(s=>s.direction===direction && s.action===action);
      assert.equal(strip.width,width);
      assert.equal(strip.height,512);
      assert.equal(strip.frame_ids.length,count);
      assert.equal(strip.mirror,['W','NW','SW'].includes(direction));
      assert.ok(files.has(strip.file));
    }
  }
  const mirrored=strips.find(s=>s.direction==='SW' && s.action==='all');
  assert.deepEqual(mirrored.frame_ids,['SE-idle','SE-walk-01','SE-walk-02','SE-walk-03','SE-walk-04','SE-run-01','SE-run-02','SE-run-03','SE-run-04','SE-run-05','SE-run-06']);
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

test('publisher rejects a missing running direction before touching served output', async () => {
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'caatuu-workshop-test-'));
  try {
    const source=path.join(tmp,'source'), destination=path.join(tmp,'output');
    await fs.cp(sourceRoot,source,{recursive:true});
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination,'manifest.json'),'keep existing preview');
    const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
    manifest.frames=manifest.frames.filter(f=>!(f.direction==='NE' && f.action==='run'));
    await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest));
    await assert.rejects(publishWorkshop({source,destination}),/complete 55-frame set/);
    assert.deepEqual(await fs.readdir(destination),['manifest.json']);
    assert.equal(await fs.readFile(path.join(destination,'manifest.json'),'utf8'),'keep existing preview');
  } finally {
    assert.equal(path.dirname(tmp),os.tmpdir());
    await fs.rm(tmp,{recursive:true,force:true});
  }
});

test('frame IDs must agree with direction, action, phase and filename', async () => {
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'caatuu-workshop-test-'));
  try {
    const source=path.join(tmp,'source');
    await fs.cp(sourceRoot,source,{recursive:true});
    const original=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
    for (const [field,value] of [['direction','E'],['action','walk'],['phase',2]]) {
      const manifest=structuredClone(original);
      manifest.frames.find(f=>f.id==='NE-run-03')[field]=value;
      await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest));
      await assert.rejects(validateWorkshop(source),/Frame metadata mismatch: NE-run-03/);
    }
    const wrongFile=structuredClone(original);
    wrongFile.frames.find(f=>f.id==='NE-run-03').file='images/e-run-03-sheet-v1.png';
    await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(wrongFile));
    await assert.rejects(validateWorkshop(source),/Unsafe or duplicate image path: NE-run-03/);
    const duplicate=structuredClone(original);
    duplicate.frames.find(f=>f.id==='NE-run-03').id='E-run-03';
    await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(duplicate));
    await assert.rejects(validateWorkshop(source),/complete 55-frame set/);
  } finally {
    assert.equal(path.dirname(tmp),os.tmpdir());
    await fs.rm(tmp,{recursive:true,force:true});
  }
});

test('publisher accepts a versioned east frame and advertises eight run directions', async () => {
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'caatuu-workshop-test-'));
  try {
    const source=path.join(tmp,'source'), destination=path.join(tmp,'output');
    await fs.cp(sourceRoot,source,{recursive:true});
    const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
    const frame=manifest.frames.find(f=>f.id==='E-run-06');
    const correctedFile='images/e-run-06-sheet-v2.png';
    if (frame.file!==correctedFile) {
      await fs.copyFile(path.join(source,frame.file),path.join(source,correctedFile));
      frame.file=correctedFile;
    }
    await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest));
    const checked=await validateWorkshop(source);
    assert.equal(checked.files.size,84);
    assert.ok(checked.files.has(correctedFile));
    const published=await publishWorkshop({source,destination});
    assert.equal(published.frames,55);
    assert.equal(published.strips,24);
    assert.equal(published.walking_directions,8);
    assert.equal(published.running_directions,8);
    assert.equal((await fs.readdir(path.join(destination,'images'))).filter(file=>file.endsWith('.png')).length,55);
    assert.equal((await fs.readdir(path.join(destination,'images/strips'))).length,24);
    const strip=manifest.exports.direction_strips.find(s=>s.direction==='NW' && s.action==='all');
    assert.deepEqual(await fs.readFile(path.join(destination,strip.file)),await fs.readFile(path.join(source,strip.file)));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(destination,'manifest.json'),'utf8')),manifest);
  } finally {
    assert.equal(path.dirname(tmp),os.tmpdir());
    await fs.rm(tmp,{recursive:true,force:true});
  }
});

test('publisher rejects incomplete or inconsistent strips before touching output', async () => {
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'caatuu-workshop-test-'));
  try {
    const source=path.join(tmp,'source'), destination=path.join(tmp,'output');
    await fs.cp(sourceRoot,source,{recursive:true});
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination,'manifest.json'),'keep existing preview');
    const original=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
    const mutations=[
      [m=>delete m.exports,/Expected 24 direction strips/],
      [m=>m.exports.direction_strips.pop(),/Expected 24 direction strips/],
      [m=>m.exports.direction_strips[1]=structuredClone(m.exports.direction_strips[0]),/Expected 24 direction strips/],
      [m=>m.exports.direction_strips.find(s=>s.direction==='SW' && s.action==='all').mirror=false,/Strip metadata mismatch: SW-all/],
      [m=>m.exports.direction_strips.find(s=>s.direction==='SW' && s.action==='all').frame_ids[0]='SW-idle',/Strip metadata mismatch: SW-all/],
      [m=>m.exports.direction_strips.find(s=>s.direction==='N' && s.action==='run').frame_ids.reverse(),/Strip metadata mismatch: N-run/],
      [m=>m.exports.direction_strips[0].width=512,/Strip metadata mismatch/],
      [m=>m.exports.direction_strips[0].file='../outside.png',/Strip metadata mismatch/],
    ];
    for (const [mutate,error] of mutations) {
      const manifest=structuredClone(original);
      mutate(manifest);
      await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest));
      await assert.rejects(publishWorkshop({source,destination}),error);
      assert.deepEqual(await fs.readdir(destination),['manifest.json']);
      assert.equal(await fs.readFile(path.join(destination,'manifest.json'),'utf8'),'keep existing preview');
    }
  } finally {
    assert.equal(path.dirname(tmp),os.tmpdir());
    await fs.rm(tmp,{recursive:true,force:true});
  }
});

test('strip bytes must match their hash and transparent horizontal canvas contract', async () => {
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'caatuu-workshop-test-'));
  try {
    const source=path.join(tmp,'source'), destination=path.join(tmp,'output');
    await fs.cp(sourceRoot,source,{recursive:true});
    const original=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
    const selected=original.exports.direction_strips.find(s=>s.direction==='W' && s.action==='run');
    const file=path.join(source,selected.file), bytes=await fs.readFile(file);
    await fs.appendFile(file,'corruption');
    await assert.rejects(publishWorkshop({source,destination}),/Strip hash mismatch: W-run/);
    await assert.rejects(fs.stat(destination),{code:'ENOENT'});
    for (const alter of [buffer=>buffer.writeUInt32BE(2048,16),buffer=>buffer.writeUInt32BE(1024,20),buffer=>{buffer[25]=2;}]) {
      const wrong=Buffer.from(bytes), manifest=structuredClone(original);
      alter(wrong);
      manifest.exports.direction_strips.find(s=>s.direction==='W' && s.action==='run').sha256=crypto.createHash('sha256').update(wrong).digest('hex');
      await fs.writeFile(file,wrong);
      await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest));
      await assert.rejects(publishWorkshop({source,destination}),/Invalid transparent strip canvas: W-run/);
      await assert.rejects(fs.stat(destination),{code:'ENOENT'});
    }
  } finally {
    assert.equal(path.dirname(tmp),os.tmpdir());
    await fs.rm(tmp,{recursive:true,force:true});
  }
});
