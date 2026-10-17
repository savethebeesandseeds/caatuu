import assert from 'node:assert/strict';
import test from 'node:test';
import { createMoonAdvance } from '../static/review/memory-moon-advance.mjs';

function fixture(options = {}) {
  let now = 0;
  let nextId = 0;
  let advances = 0;
  const timers = new Map();
  const advance = createMoonAdvance({
    onAdvance() { advances += 1; options.onAdvance?.(advance); },
    setTimer(callback, delayMs) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delayMs, cleared: false, fired: false });
      return id;
    },
    clearTimer(id) { timers.get(id).cleared = true; },
    ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs })
  });
  function elapse(milliseconds) {
    const until = now + milliseconds;
    while (true) {
      const next = [...timers.values()].filter(timer => !timer.cleared && !timer.fired && timer.at <= until)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.fired = true;
      next.callback();
    }
    now = until;
  }
  return { advance, timers, elapse, advances: () => advances };
}

test('feedback advances once after the full two-second delay', () => {
  const game = fixture();
  assert.deepEqual(game.advance.state(), { pending: false, paused: false, destroyed: false });
  game.advance.schedule();
  game.elapse(1999);
  assert.equal(game.advances(), 0);
  assert.equal(game.advance.state().pending, true);
  game.elapse(1);
  assert.equal(game.advances(), 1);
  assert.equal(game.advance.state().pending, false);
  game.timers.get(0).callback();
  game.elapse(10000);
  assert.equal(game.advances(), 1, 'a duplicate callback cannot advance twice');
});

test('rescheduling replaces the old delay and ignores its stale callback', () => {
  const game = fixture();
  game.advance.schedule();
  game.elapse(1500);
  game.advance.schedule();
  assert.equal(game.timers.get(0).cleared, true, 'timer handle zero must be cancellable');
  game.timers.get(0).callback();
  game.elapse(1999);
  assert.equal(game.advances(), 0);
  game.elapse(1);
  assert.equal(game.advances(), 1);
});

test('cancelling a session rejects stale callbacks before and after a new session starts', () => {
  const game = fixture();
  game.advance.schedule();
  game.advance.cancel();
  game.timers.get(0).callback();
  game.elapse(5000);
  assert.equal(game.advances(), 0);
  assert.equal(game.advance.state().pending, false);
  game.advance.schedule();
  game.timers.get(0).callback();
  game.elapse(2000);
  assert.equal(game.advances(), 1);
});

test('pausing retains pending feedback and resuming starts a fresh full delay', () => {
  const game = fixture();
  game.advance.schedule();
  game.elapse(1700);
  game.advance.pause();
  game.advance.pause();
  assert.deepEqual(game.advance.state(), { pending: true, paused: true, destroyed: false });
  game.timers.get(0).callback();
  game.elapse(10000);
  assert.equal(game.advances(), 0);
  game.advance.resume();
  game.elapse(1000);
  game.advance.resume();
  game.timers.get(0).callback();
  game.elapse(999);
  assert.equal(game.advances(), 0);
  game.elapse(1);
  assert.equal(game.advances(), 1, 'repeated visible events must not restart the resumed delay');
});

test('answers scheduled while hidden wait for visibility, and cancelled answers stay cancelled', () => {
  const game = fixture();
  game.advance.pause();
  game.advance.schedule();
  game.advance.schedule();
  assert.equal(game.timers.size, 0);
  game.elapse(10000);
  game.advance.resume();
  game.elapse(2000);
  assert.equal(game.advances(), 1);
  game.advance.schedule();
  game.advance.pause();
  game.advance.cancel();
  game.advance.resume();
  game.elapse(10000);
  assert.equal(game.advances(), 1);
  assert.equal(game.advance.state().pending, false);
});

test('idle pause and resume do not invent a pending advance', () => {
  const game = fixture();
  game.advance.resume();
  game.advance.pause();
  game.advance.resume();
  game.elapse(10000);
  assert.equal(game.timers.size, 0);
  assert.equal(game.advances(), 0);
});

test('destroy cancels timers and permanently prevents late or future advances', () => {
  const game = fixture();
  game.advance.schedule();
  game.advance.destroy();
  game.timers.get(0).callback();
  game.advance.schedule();
  game.advance.pause();
  game.advance.resume();
  game.advance.cancel();
  game.advance.destroy();
  game.elapse(10000);
  assert.equal(game.advances(), 0);
  assert.equal(game.timers.size, 1, 'nothing creates timers after teardown');
  assert.deepEqual(game.advance.state(), { pending: false, paused: false, destroyed: true });
});

test('callbacks can schedule another answered question without losing its timer', () => {
  const game = fixture({ delayMs: 50, onAdvance(advance) {
    if (game.advances() === 1) advance.schedule();
  } });
  game.advance.schedule();
  game.elapse(50);
  assert.equal(game.advances(), 1);
  assert.equal(game.advance.state().pending, true);
  game.elapse(50);
  assert.equal(game.advances(), 2);
  assert.equal(game.advance.state().pending, false);
});

test('state snapshots cannot change the timer lifecycle', () => {
  const game = fixture();
  game.advance.state().destroyed = true;
  game.advance.schedule();
  game.advance.state().pending = false;
  game.elapse(2000);
  assert.equal(game.advances(), 1);
});

test('invalid timer configuration fails before scheduling', () => {
  assert.throws(() => createMoonAdvance(), /advance callback/);
  for (const delayMs of [-1, NaN, Infinity, '2000']) {
    assert.throws(() => createMoonAdvance({ onAdvance() {}, delayMs }), /Advance delay/);
  }
  assert.throws(() => createMoonAdvance({ onAdvance() {}, setTimer: null }), /timer functions/);
  assert.throws(() => createMoonAdvance({ onAdvance() {}, clearTimer: null }), /timer functions/);
});
