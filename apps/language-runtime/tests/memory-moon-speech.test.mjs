import assert from 'node:assert/strict';
import test from 'node:test';
import { createMoonSpeech } from '../static/review/memory-moon-speech.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function fixture({ delayedStop = false } = {}) {
  const calls = [];
  const stops = [];
  const changes = [];
  const api = {
    speakText(text, options) {
      const pending = deferred();
      calls.push({ text, options, ...pending });
      return pending.promise;
    },
    stopSpeech() {
      const pending = deferred();
      stops.push(pending);
      if (!delayedStop) pending.resolve();
      return pending.promise;
    }
  };
  const speech = createMoonSpeech({ api, onState: next => changes.push(next) });
  return { speech, api, calls, stops, changes };
}

test('manual playback uses shared preferences, reports start and completion, and permits a muted shell', async () => {
  const game = fixture();
  const pending = game.speech.play('  Vlak přijíždí.  ');
  assert.deepEqual(game.speech.state(), {
    status: 'loading', text: 'Vlak přijíždí.', error: null, lastOutcome: null
  });
  await Promise.resolve();
  assert.equal(game.stops.length, 1);
  assert.equal(game.calls[0].text, 'Vlak přijíždí.');
  assert.equal(game.calls[0].options.allowWhileMuted, true);
  assert.deepEqual(Object.keys(game.calls[0].options).sort(), ['allowWhileMuted', 'onStart']);
  game.calls[0].options.onStart();
  assert.equal(game.speech.state().status, 'playing');
  game.calls[0].resolve({ outcome: 'completed' });
  await pending;
  assert.deepEqual(game.speech.state(), { status: 'idle', text: '', error: null, lastOutcome: 'completed' });
  assert.deepEqual(game.changes.map(next => next.status), ['loading', 'playing', 'idle']);
});

test('a second tap while cancellation is pending stops without starting the obsolete sentence', async () => {
  const game = fixture({ delayedStop: true });
  const first = game.speech.play('Vlak přijíždí.');
  const toggle = game.speech.play('Vlak přijíždí.');
  assert.equal(game.speech.state().status, 'idle');
  for (const stop of game.stops) stop.resolve();
  await Promise.all([first, toggle]);
  assert.equal(game.calls.length, 0);
  assert.equal(game.speech.state().lastOutcome, 'stopped');
});

test('a second tap stops active playback and ignores its late start and completion callbacks', async () => {
  const game = fixture();
  const first = game.speech.play('Vlak přijíždí.');
  await Promise.resolve();
  game.calls[0].options.onStart();
  await game.speech.play('Vlak přijíždí.');
  const count = game.changes.length;
  game.calls[0].options.onStart();
  game.calls[0].resolve({ outcome: 'completed' });
  await first;
  assert.equal(game.changes.length, count);
  assert.equal(game.speech.state().lastOutcome, 'stopped');
});

test('a different sentence supersedes playback without stale start or completion changing the new state', async () => {
  const game = fixture();
  const first = game.speech.play('Vlak přijíždí.');
  await Promise.resolve();
  const second = game.speech.play('Vlak odjíždí.');
  await Promise.resolve();
  game.calls[1].options.onStart();
  const count = game.changes.length;
  game.calls[0].options.onStart();
  game.calls[0].resolve({ outcome: 'completed' });
  await first;
  assert.equal(game.changes.length, count);
  assert.equal(game.speech.state().text, 'Vlak odjíždí.');
  assert.equal(game.speech.state().status, 'playing');
  game.calls[1].resolve({ outcome: 'completed' });
  await second;
});

test('a superseded rejection cannot display an error for the current sentence', async () => {
  const game = fixture();
  const first = game.speech.play('Vlak přijíždí.');
  await Promise.resolve();
  const second = game.speech.play('Vlak odjíždí.');
  await Promise.resolve();
  game.calls[1].options.onStart();
  game.calls[0].reject(new Error('Old voice failed'));
  await first;
  assert.equal(game.speech.state().status, 'playing');
  assert.equal(game.speech.state().error, null);
  game.calls[1].resolve({ outcome: 'completed' });
  await second;
});

test('destroy cancels speech and prevents all late state callbacks or later playback', async () => {
  const game = fixture();
  const pending = game.speech.play('Vlak přijíždí.');
  await Promise.resolve();
  const count = game.changes.length;
  await game.speech.destroy();
  game.calls[0].options.onStart();
  game.calls[0].reject(new Error('Late speech failure'));
  await pending;
  await game.speech.play('Vlak odjíždí.');
  await game.speech.stop();
  await game.speech.destroy();
  assert.equal(game.calls.length, 1);
  assert.equal(game.stops.length, 2);
  assert.equal(game.changes.length, count);
  assert.deepEqual(game.speech.state(), { status: 'idle', text: '', error: null, lastOutcome: 'stopped' });
});

test('a muted result returns to idle without pretending playback completed', async () => {
  const game = fixture();
  const pending = game.speech.play('Vlak přijíždí.');
  await Promise.resolve();
  game.calls[0].resolve({ outcome: 'muted' });
  await pending;
  assert.deepEqual(game.speech.state(), { status: 'idle', text: '', error: null, lastOutcome: 'muted' });
});

test('a late backend start after completion cannot restart the finished playback indicator', async () => {
  const game = fixture();
  const pending = game.speech.play('Vlak přijíždí.');
  await Promise.resolve();
  game.calls[0].resolve({ outcome: 'completed' });
  await pending;
  const count = game.changes.length;
  game.calls[0].options.onStart();
  assert.equal(game.changes.length, count);
  assert.equal(game.speech.state().status, 'idle');
});

test('resolved backend errors and rejected speech both report a retryable error', async () => {
  const game = fixture();
  const first = game.speech.play('Vlak přijíždí.');
  await Promise.resolve();
  game.calls[0].resolve({ outcome: 'error', error: 'No voice is available' });
  await first;
  assert.equal(game.speech.state().status, 'error');
  assert.equal(game.speech.state().error, 'No voice is available');
  const retry = game.speech.play('Vlak přijíždí.');
  await Promise.resolve();
  assert.equal(game.speech.state().error, null);
  game.calls[1].reject(new Error('Device speech failed'));
  await retry;
  assert.equal(game.speech.state().status, 'error');
  assert.equal(game.speech.state().error, 'Device speech failed');
  assert.equal(game.speech.state().lastOutcome, 'error');
});

test('state snapshots cannot mutate the playback state', async () => {
  const game = fixture();
  const pending = game.speech.play('Vlak přijíždí.');
  game.speech.state().status = 'playing';
  game.changes[0].text = 'Changed outside adapter';
  assert.equal(game.speech.state().status, 'loading');
  assert.equal(game.speech.state().text, 'Vlak přijíždí.');
  await Promise.resolve();
  game.calls[0].resolve({ outcome: 'completed' });
  await pending;
});
