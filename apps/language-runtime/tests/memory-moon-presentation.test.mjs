import assert from 'node:assert/strict';
import test from 'node:test';
import { createMoonPhase } from '../static/source/games/memory-moon/memory-moon-phase.mjs';
import { createMoonSpeech } from '../static/source/games/memory-moon/memory-moon-speech.mjs';
import { createMoonOrbit, chooseMoonShip, moonOrbitPose } from '../static/source/games/memory-moon/memory-moon-orbit.mjs';

class Surface extends EventTarget {
  attributes = new Map();
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  removeAttribute(name) { this.attributes.delete(name); }
}
function frames() {
  let time = 0, sequence = 0;
  const pending = new Map();
  return { pending, now: () => time,
    requestFrame(callback) { const id = ++sequence; pending.set(id, callback); return id; },
    cancelFrame(id) { pending.delete(id); },
    tick(milliseconds) {
      time += milliseconds;
      const callbacks = [...pending.values()]; pending.clear();
      callbacks.forEach(callback => callback(time));
    }
  };
}

test('phase rewards use a smooth 1200ms transition and repeated render targets do not restart it', () => {
  const clock = frames(), draws = [], motion = new Surface(); motion.matches = false;
  const phase = createMoonPhase({ ...clock, draw: value => draws.push(value), reducedMotion: motion });
  phase.set(.5); clock.tick(600);
  assert.equal(draws.at(-1), .25);
  phase.set(.5); clock.tick(600);
  assert.equal(draws.at(-1), .5);
  assert.equal(clock.pending.size, 0);
  phase.set(1); clock.tick(300); phase.pause();
  const paused = draws.at(-1);
  clock.tick(9000); assert.equal(draws.at(-1), paused);
  phase.resume(); clock.tick(900); assert.equal(draws.at(-1), 1);
  phase.destroy();
});

test('reduced motion snaps to the requested phase and invalidates queued frames on reset/destroy', () => {
  const clock = frames(), draws = [], motion = new Surface(); motion.matches = false;
  const phase = createMoonPhase({ ...clock, draw: value => draws.push(value), reducedMotion: motion });
  phase.set(.5);
  const staleFrame = [...clock.pending.values()][0];
  phase.set(0, { immediate: true }); staleFrame(800);
  assert.equal(draws.at(-1), 0);
  phase.set(1); motion.matches = true; motion.dispatchEvent(new Event('change'));
  assert.equal(draws.at(-1), 1);
  assert.equal(clock.pending.size, 0);
  phase.destroy(); phase.set(0);
  assert.equal(draws.at(-1), 1);
});

test('stopped speech cannot report a late start or replace the current audio state', async () => {
  const calls = [], starts = [], changes = [];
  const speech = createMoonSpeech({ api: { stopSpeech: async () => {},
    speakText(text, options) { return new Promise(resolve => calls.push({ text, options, resolve })); }
  }, onStart: text => starts.push(text), onState: state => changes.push(state.status) });
  const first = speech.play('مرحبا'); await Promise.resolve();
  await speech.stop(); calls[0].options.onStart(); calls[0].resolve({ outcome: 'completed' }); await first;
  assert.deepEqual(starts, []);
  assert.equal(speech.state().status, 'idle');
  const second = speech.play('გამარჯობა'); await Promise.resolve();
  calls[1].options.onStart(); calls[1].options.onStart();
  assert.deepEqual(starts, ['გამარჯობა']);
  await speech.destroy(); calls[1].resolve({ outcome: 'completed' }); await second;
  assert.equal(changes.filter(value => value === 'playing').length, 1);
});

const catalog = {
  '/assets/ships/ship%20(1).png': { category: 'ship', orientation: { heading_degrees: 155 } },
  '/assets/ships/ship%20(2).png': { category: 'ship', orientation: { heading_degrees: 180 } }
};

test('production orbit uses catalog headings and explicitly hides the rear arc', () => {
  assert.equal(chooseMoonShip({ '/assets/ships/broken.png': { category: 'ship' } }), null);
  assert.equal(chooseMoonShip(catalog, { random: () => .9 }).headingDegrees, 180);
  assert.equal(moonOrbitPose(0, 155).visible, true);
  assert.equal(moonOrbitPose(.5, 155).visible, false);
  for (const direction of [-1, 1]) for (const tiltDegrees of [0, 80, 190]) {
    const pose = moonOrbitPose(.1, 155, { direction, tiltDegrees });
    const heading = pose.mirror ? 25 : 155;
    assert.ok(Math.abs(((heading + pose.rotation - pose.heading) % 360 + 540) % 360 - 180) < 1e-8);
  }
});

test('production ship is opaque, pauses with the host and reroutes only while hidden', () => {
  const clock = frames(), document = new Surface(), view = new Surface(), image = new Surface(), element = new Surface();
  document.defaultView = view; document.hidden = false;
  const motion = new Surface(); motion.matches = false;
  let randomIndex = 0; const values = [0, 0, 0, 0, .5, .7];
  const orbit = createMoonOrbit({ ...clock, document, image, element, reducedMotion: motion,
    random: () => values[randomIndex++ % values.length] });
  orbit.select(catalog); image.dispatchEvent(new Event('load')); clock.tick(0);
  assert.equal(element.getAttribute('opacity'), '1');
  assert.equal(element.getAttribute('visibility'), 'visible');
  orbit.pause(); const stopped = element.getAttribute('transform'); clock.tick(6000);
  assert.equal(element.getAttribute('transform'), stopped);
  assert.equal(clock.pending.size, 0);
  orbit.resume(); clock.tick(0); clock.tick(6000);
  assert.equal(element.getAttribute('visibility'), 'hidden');
  clock.tick(6000); assert.equal(element.getAttribute('visibility'), 'visible');
  orbit.destroy(); assert.equal(clock.pending.size, 0);
  assert.equal(element.getAttribute('visibility'), 'hidden');
});

test('a reduced-motion orbit keeps a static visible craft and a failed asset stays hidden', () => {
  const clock = frames(), document = new Surface(), view = new Surface(), image = new Surface(), element = new Surface();
  document.defaultView = view; document.hidden = false;
  const motion = new Surface(); motion.matches = true;
  const orbit = createMoonOrbit({ ...clock, document, image, element, reducedMotion: motion, random: () => .5 });
  orbit.select(catalog); image.dispatchEvent(new Event('load'));
  assert.equal(element.getAttribute('visibility'), 'visible');
  assert.equal(clock.pending.size, 0);
  image.dispatchEvent(new Event('error'));
  assert.equal(element.getAttribute('visibility'), 'hidden');
  orbit.destroy();
});
