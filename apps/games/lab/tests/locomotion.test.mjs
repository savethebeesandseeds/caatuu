import assert from 'node:assert/strict';
import test from 'node:test';
import {walkingMetrics,advanceWalkingCycles} from '../assets/locomotion.mjs';
import {advanceRoute,project,unproject} from '../scenary/navigation.mjs';
const profile={canvas_pixels:512,frames_per_cycle:8,steps_per_cycle:2,fps:8,stride_pixels:273.396853};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('actor size scales stride and velocity together while preserving cadence',()=>{
  const regular=walkingMetrics(profile);
  for(const scale of [.25,.5,1,1.5,2]) {
    const metrics=walkingMetrics(profile,scale);
    close(metrics.speed,regular.speed*scale);close(metrics.stepDistance,regular.stepDistance*scale);
    close(metrics.cycleDistance/metrics.speed,profile.frames_per_cycle/profile.fps);
    close(metrics.stepDistance*profile.steps_per_cycle,metrics.cycleDistance);
  }
  close(regular.speed,1.1213542798828127);
  close(walkingMetrics({...profile,fps:12}).speed,regular.speed*1.5);
});

test('world/sprite conversion holds across camera zoom and all ground-plane headings',()=>{
  const metrics=walkingMetrics(profile,.5);
  for(const screen of [{x:1,y:0},{x:1,y:1},{x:0,y:1},{x:-1,y:1},{x:-1,y:0},{x:-1,y:-1},{x:0,y:-1},{x:1,y:-1}]) {
    const vector=unproject(screen),length=Math.hypot(vector.x,vector.z);
    const projected=project({x:vector.x/length*metrics.cycleDistance,z:vector.z/length*metrics.cycleDistance});
    const unit=project({x:vector.x/length,z:vector.z/length});
    for(const cameraZoom of [30,90,240]) {
      const rootPixels=Math.hypot(projected.x,projected.y)*cameraZoom;
      const stridePixels=profile.stride_pixels*metrics.canvasWorldSize/profile.canvas_pixels*cameraZoom*Math.hypot(unit.x,unit.y);
      close(rootPixels,stridePixels);
    }
  }
});

test('phase consumes actual routed distance including corners and a partial final step',()=>{
  const metrics=walkingMetrics(profile);
  const total=metrics.cycleDistance*1.375;
  const actor={position:{x:0,z:0},waypoints:[{x:total/3,z:0},{x:total/3,z:total*2/3}],action:'walk',distanceRemaining:total};
  let cycles=0;
  for(let frame=0;frame<100 && actor.action!=='idle';frame++) {
    const before=actor.distanceRemaining;
    advanceRoute(actor,.05,metrics.speed);
    cycles=advanceWalkingCycles(cycles,before-actor.distanceRemaining,metrics);
  }
  assert.equal(actor.action,'idle');close(cycles,1.375);
  close(actor.position.x,total/3);close(actor.position.z,total*2/3);
  close(advanceWalkingCycles(cycles,0,metrics),cycles);
});

test('changing scale during a trip preserves phase and adjusts only subsequent travel',()=>{
  const regular=walkingMetrics(profile),small=walkingMetrics(profile,.5);
  let cycles=advanceWalkingCycles(0,regular.frameDistance*3,regular);
  close(cycles,3/8);
  cycles=advanceWalkingCycles(cycles,small.frameDistance*5,small);
  close(cycles,1);
  assert.throws(()=>walkingMetrics(profile,0));assert.throws(()=>walkingMetrics({...profile,stride_pixels:NaN}));
  assert.throws(()=>advanceWalkingCycles(0,-1,regular));
});
