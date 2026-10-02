import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import { WALKING_MOTION_BASE, parseWalkingMotion, walkingMotionPose, walkingMotionURL } from '../assets/walking-motion.mjs';

function manifest() {
  const sources = ['S', 'N', 'E', 'NE', 'SW'];
  return {
    format_version: 1, preview_only: true, canvas: [512, 512], baseline_y: 480, fps: 8, standing_complete: true,
    locomotion: {walk: {canvas_pixels:512,frames_per_cycle:8,steps_per_cycle:2,fps:8,stride_pixels:273.396853}},
    frames: sources.flatMap(direction => Array.from({length: 8}, (_, index) => ({
      id: `${direction}-walk-${String(index + 1).padStart(2, '0')}`, direction, slot: index + 1,
      file: `images/${direction.toLowerCase()}-walk-${String(index + 1).padStart(2, '0')}.png`, sha256: 'a'.repeat(64),
    }))).concat(sources.map(direction => ({
      id: `${direction}-idle`, direction, action: 'idle', slot: 0,
      file: `images/${direction.toLowerCase()}-idle-v1.png`, sha256: 'b'.repeat(64),
    }))),
    directions: sources.map(id => ({id, source: id, mirror: false})).concat([
      {id: 'W', source: 'E', mirror: true}, {id: 'NW', source: 'NE', mirror: true}, {id: 'SE', source: 'SW', mirror: true},
    ]),
  };
}

test('video source directions keep the southwest source and mirror southeast', () => {
  const draft = parseWalkingMotion(manifest());
  for (const [direction, source, mirror] of [['SW', 'SW', false], ['SE', 'SW', true], ['W', 'E', true], ['NW', 'NE', true]]) {
    const pose = walkingMotionPose(draft, direction, 'walk', 0);
    assert.equal(pose.mapping.source, source);assert.equal(pose.mapping.mirror, mirror);
    assert.equal(pose.frame.id, `${source}-walk-01`);
  }
  assert.equal(draft.frames.size, 45);assert.equal(draft.directions.size, 8);
});

test('all eight walking poses play before wrap and every direction stops on its separate standing image', () => {
  const draft = parseWalkingMotion(manifest());
  for (let slot = 1; slot <= 8; slot++) assert.equal(walkingMotionPose(draft, 'S', 'walk', (slot - 1) / 8).slot, slot);
  assert.equal(walkingMotionPose(draft, 'S', 'walk', 1).slot, 1);
  for (const direction of draft.directions.keys()) {
    const source = draft.directions.get(direction).source;
    for (const elapsed of [0, 0.75, 5, 200]) {
      const idle = walkingMotionPose(draft, direction, 'idle', elapsed);
      assert.equal(idle.slot, 0);assert.equal(idle.frame.id, `${source}-idle`);
      assert.notEqual(idle.frame.id, walkingMotionPose(draft, direction, 'walk', elapsed).frame.id);
    }
  }
  assert.throws(() => walkingMotionPose(draft, 'S', 'walk', NaN));
});

test('incomplete cycles, unsafe image paths, duplicate identities and missing facings are rejected', () => {
  for (const change of [
    value => value.frames.splice(3, 1),
    value => {value.frames[0].file = '../manifest.json';},
    value => {value.frames[1].id = value.frames[0].id;},
    value => value.directions.pop(),
    value => {value.directions[0].mirror = 'false';},
    value => {value.preview_only = false;},
    value => {value.canvas = [256, 512];},
    value => {value.frames = value.frames.filter(frame => frame.id !== 'SW-idle');},
    value => {value.frames.find(frame => frame.action === 'idle').slot = 1;},
  ]) {
    const value = manifest();change(value);assert.throws(() => parseWalkingMotion(value));
  }
  const frame = manifest().frames[0];
  assert.match(walkingMotionURL(frame), /images\/s-walk-01\.png\?v=a{64}$/);
  assert.throws(() => walkingMotionURL({...frame, file: 'https://example.com/s-walk-01.png'}));
});

test('selected source requires standing images and matching stride metadata', () => {
  const value = manifest();delete value.standing_complete;
  value.frames = value.frames.filter(frame => frame.action !== 'idle');
  assert.throws(() => parseWalkingMotion(value));
  for (const change of [value=>{value.locomotion.walk.frames_per_cycle=4;},value=>{value.locomotion.walk.stride_pixels=NaN;},
    value=>{value.directions.find(mapping=>mapping.id==='SE').source='E';}]) {
    const source=manifest();change(source);assert.throws(()=>parseWalkingMotion(source));
  }
});

test('walking images resolve directly to the maintained source folder', () => {
  const frame = manifest().frames[0];
  assert.equal(WALKING_MOTION_BASE,'/games/lab/assets/macaw/walk/');
  assert.match(walkingMotionURL(frame), /\/macaw\/walk\/images\/s-walk-01\.png/);
});

test('selected source has all 45 hashed RGBA frames, 8 strips and calibration tied to those pixels', async () => {
  const root=new URL('../assets/macaw/walk/',import.meta.url);
  const source=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  assert.equal(parseWalkingMotion(source).frames.size,45);
  for (const asset of [...source.frames,...source.exports.direction_strips]) {
    const png=await readFile(new URL(asset.file,root));
    assert.equal(createHash('sha256').update(png).digest('hex'),asset.sha256);
    assert.equal(png.readUInt32BE(16),asset.width ?? 512);
    assert.equal(png.readUInt32BE(20),512);assert.equal(png[25],6);
  }
  assert.equal(source.exports.direction_strips.length,8);
  const calibration=JSON.parse(await readFile(new URL('stride-calibration.json',root),'utf8'));
  assert.equal(calibration.stride_pixels,source.locomotion.walk.stride_pixels);
  for(const sample of calibration.samples) assert.equal(sample.sha256,source.frames.find(frame=>frame.id===sample.frame).sha256);
});
