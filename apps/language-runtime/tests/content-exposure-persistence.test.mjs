import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { createBrowserHarness } from './helpers/fake-browser.mjs';
import { selectContentItems } from '../static/source/games/content-progression.mjs';
const source = await readFile(new URL('../static/source/learning-profile.js', import.meta.url), 'utf8');
const key = 'caatuu-test.learning.content.v2';
function browser(storage = null, namespace = 'caatuu-test', clock = null) {
  const result = createBrowserHarness({ course: { id: 'test', storage: { namespace } } });
  if (storage) result.window.localStorage = storage;
  result.window.navigator.locks = { request: async (_name, action) => action() };
  if (clock) result.context.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  };
  vm.runInContext(source, result.context);
  return { ...result, learning: result.window.CaatuuLearning };
}
const event = (encounterId = 'visit-1', changes = {}) => ({ bankId: 'words', itemId: 'item-a', encounterId, correct: true, ...changes });
const day = 24 * 60 * 60 * 1000;
const clockAt = value => ({ now: Date.parse(value) });
const itemHistory = value => value.learning.contentHistory('sound-quasar', 'words')['item-a'];
const independent = (value, id) => value.learning.recordExposure('sound-quasar', event(id, { evidence: 'independent' }));

test('only explicit completed encounters count, and repeated delivery survives reload and checkpoint', async () => {
  const first = browser();
  first.learning.record('sound-quasar', { attempts: 100, successes: 90 });
  assert.equal(Object.keys(first.learning.contentHistory('sound-quasar', 'words')).length, 0);
  first.learning.recordExposure('sound-quasar', event());
  first.learning.recordExposure('sound-quasar', event());
  await first.learning.retryPendingSaves();
  const second = browser(first.localStorage);
  second.learning.recordExposure('sound-quasar', event());
  assert.equal(second.learning.contentHistory('sound-quasar', 'words')['item-a'].exposures, 1);
  second.learning.recordExposure('sound-quasar', event('visit-2', { correct: false }));
  const item = second.learning.contentHistory('sound-quasar', 'words')['item-a'];
  assert.equal(item.exposures, 2); assert.equal(item.successes, 1); assert.equal(item.mistakes, 1);
  assert.equal(item.lastCorrect, false);
});

test('course, game and mode histories are isolated, including unusual content IDs', async () => {
  const a = browser();
  a.learning.recordExposure('sound-quasar', event('a', { itemId: '__proto__' }));
  assert.equal(a.learning.contentHistory('sound-quasar', 'words').__proto__.exposures, 1);
  assert.equal(Object.keys(a.learning.contentHistory('sound-quasar', 'sentences')).length, 0);
  assert.equal(Object.keys(a.learning.contentHistory('word-world', 'words')).length, 0);
  const other = browser(a.localStorage, 'caatuu-other');
  assert.equal(Object.keys(other.learning.contentHistory('sound-quasar', 'words')).length, 0);
  await a.learning.retryPendingSaves();
});

test('failed writes stay available in memory, retry once, and retain truthful save status', async () => {
  const a = browser(); const write = a.localStorage.setItem.bind(a.localStorage);
  a.localStorage.setItem = () => { throw new Error('full'); };
  a.learning.recordExposure('sound-quasar', event());
  assert.equal(a.learning.contentHistory('sound-quasar', 'words')['item-a'].exposures, 1);
  assert.equal(a.learning.saveStatus().status, 'error');
  a.localStorage.setItem = write;
  await a.learning.retryPendingSaves();
  assert.equal(a.learning.saveStatus().status, 'saved');
  assert.equal(browser(a.localStorage).learning.contentHistory('sound-quasar', 'words')['item-a'].exposures, 1);
});

test('concurrent views merge journal entries and a reset fences off older pending exposures', async () => {
  const a = browser(); const b = browser(a.localStorage);
  a.learning.recordExposure('sound-quasar', event('a'));
  b.learning.recordExposure('sound-quasar', event('b'));
  await a.learning.retryPendingSaves(); await b.learning.retryPendingSaves();
  assert.equal(a.learning.contentHistory('sound-quasar', 'words')['item-a'].exposures, 2);
  const old = { schemaVersion: 2, order: 1, evidence: 'exposure', id: 'old', generation: 'legacy', gameId: 'sound-quasar',
    ...event('old'), at: new Date().toISOString() };
  a.learning.resetProgress();
  a.localStorage.setItem(`${key}.pending.old`, JSON.stringify(old));
  assert.equal(Object.keys(b.learning.contentHistory('sound-quasar', 'words')).length, 0);
  b.learning.recordExposure('sound-quasar', event('new'));
  await b.learning.retryPendingSaves();
  assert.equal(a.learning.contentHistory('sound-quasar', 'words')['item-a'].exposures, 1);
});

test('future and damaged content history is preserved, never replaced with an empty checkpoint', async () => {
  for (const saved of ['{broken', JSON.stringify({ schemaVersion: 999 })]) {
    const a = browser(); a.localStorage.setItem(key, saved);
    a.learning.recordExposure('sound-quasar', event());
    await a.learning.retryPendingSaves();
    assert.equal(a.localStorage.getItem(key), saved);
    assert.equal(a.learning.saveStatus().status, 'error');
  }
});

test('a presentation from before another tab resets cannot resurrect exposure', async () => {
  const a = browser(); const b = browser(a.localStorage);
  const generation = a.learning.contentGeneration();
  a.learning.recordExposure('sound-quasar', event('completed-before', { generation }));
  await a.learning.retryPendingSaves();
  b.learning.resetProgress();
  for (const encounterId of ['completed-before', 'unfinished-before']) {
    assert.equal(a.learning.recordExposure('sound-quasar', event(encounterId, { generation })), false);
  }
  assert.equal(Object.keys(a.learning.contentHistory('sound-quasar', 'words')).length, 0);
  a.learning.recordExposure('sound-quasar', event('presented-after', { generation: a.learning.contentGeneration() }));
  await a.learning.retryPendingSaves();
  assert.equal(b.learning.contentHistory('sound-quasar', 'words')['item-a'].exposures, 1);
});

test('an unreadable presentation generation cannot be credited to a later reset', () => {
  const a = browser(); const read = a.localStorage.getItem.bind(a.localStorage);
  const resetKey = 'caatuu-test.learning.performance.v1.reset';
  a.localStorage.getItem = name => { if (name === resetKey) throw new Error('unavailable'); return read(name); };
  const generation = a.learning.contentGeneration();
  assert.equal(generation, null);
  a.localStorage.getItem = read;
  a.learning.resetProgress();
  assert.equal(a.learning.recordExposure('sound-quasar', event('unknown', { generation })), false);
  assert.equal(Object.keys(a.learning.contentHistory('sound-quasar', 'words')).length, 0);
});

test('a transient reset-generation read failure recovers and checkpoints on retry', async () => {
  const a = browser(); const read = a.localStorage.getItem.bind(a.localStorage);
  const resetKey = 'caatuu-test.learning.performance.v1.reset';
  let unavailable = true;
  a.localStorage.getItem = name => {
    if (name === resetKey && unavailable) throw new Error('temporarily unavailable');
    return read(name);
  };
  a.learning.recordExposure('sound-quasar', event());
  assert.equal(a.learning.saveStatus().status, 'error');
  unavailable = false;
  await a.learning.retryPendingSaves();
  assert.equal(a.learning.saveStatus().status, 'saved');
  assert.ok(read(key), 'recovery must produce a durable checkpoint');
  const reloaded = browser(a.localStorage);
  assert.equal(reloaded.learning.contentHistory('sound-quasar', 'words')['item-a'].exposures, 1);
});

test('a reset between generation read and journal enumeration preserves the new encounter', async () => {
  const a = browser(); const read = a.localStorage.getItem.bind(a.localStorage);
  const write = a.localStorage.setItem.bind(a.localStorage);
  const resetKey = 'caatuu-test.learning.performance.v1.reset';
  let locked = false; let contentRead = false; let injected = false;
  a.window.navigator.locks.request = async (_name, action) => {
    locked = true; contentRead = false;
    try { return action(); } finally { locked = false; }
  };
  a.localStorage.getItem = name => {
    const previous = read(name);
    if (locked && name === key) contentRead = true;
    if (locked && contentRead && name === resetKey && !injected) {
      injected = true;
      // Another tab resets and completes an encounter after the old generation
      // was read, but before this tab enumerates the pending storage keys.
      write(resetKey, 'new-generation');
      write(`${key}.pending.after-reset`, JSON.stringify({ schemaVersion: 2, order: 1, evidence: 'exposure',
        id: 'after-reset', generation: 'new-generation', gameId: 'sound-quasar',
        ...event('after-reset'), at: new Date().toISOString() }));
    }
    return previous;
  };
  a.learning.recordExposure('sound-quasar', event('before-reset'));
  await a.learning.retryPendingSaves();
  assert.equal(injected, true, 'exercise the cross-tab reset interleaving');
  const history = browser(a.localStorage).learning.contentHistory('sound-quasar', 'words');
  assert.equal(history['item-a']?.exposures, 1, 'the completed post-reset encounter must survive');
});

test('a failed backup write leaves replayable receipts and never duplicates a completed encounter', async () => {
  const a = browser(); const write = a.localStorage.setItem.bind(a.localStorage);
  let unavailable = true;
  a.localStorage.setItem = (name, value) => {
    if (name === `${key}.backup` && unavailable) throw new Error('backup interrupted');
    write(name, value);
  };
  a.learning.recordExposure('sound-quasar', event());
  await a.learning.retryPendingSaves();
  assert.equal(a.learning.saveStatus().status, 'error');
  assert.ok(a.localStorage.getItem(key), 'the primary was committed before the interrupted backup');
  unavailable = false;
  // Restart from the durable store, losing any old tab's in-memory state.
  const reloaded = browser(a.localStorage);
  reloaded.learning.recordExposure('sound-quasar', event());
  await reloaded.learning.retryPendingSaves();
  assert.equal(reloaded.learning.contentHistory('sound-quasar', 'words')['item-a'].exposures, 1);
  assert.ok(a.localStorage.getItem(`${key}.backup`));
});

test('interruption during journal deletion replays retained entries exactly once after reload', async () => {
  const a = browser(); const remove = a.localStorage.removeItem.bind(a.localStorage);
  let deletionCount = 0; let interrupted = true;
  a.localStorage.removeItem = name => {
    if (name.startsWith(`${key}.pending.`) && ++deletionCount > 1 && interrupted) {
      throw new Error('deletion interrupted');
    }
    remove(name);
  };
  a.learning.recordExposure('sound-quasar', event('first'));
  a.learning.recordExposure('sound-quasar', event('second', { correct: false }));
  await a.learning.retryPendingSaves();
  assert.equal(a.learning.saveStatus().status, 'error');
  interrupted = false;
  const reloaded = browser(a.localStorage);
  reloaded.learning.recordExposure('sound-quasar', event('second', { correct: false }));
  await reloaded.learning.retryPendingSaves();
  const result = reloaded.learning.contentHistory('sound-quasar', 'words')['item-a'];
  assert.equal(result.exposures, 2);
  assert.equal(result.successes, 1);
  assert.equal(result.mistakes, 1);
});

test('only explicit unaided successes earn recall evidence; exposure and support remain distinct', () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  a.learning.recordExposure('sound-quasar', event('unknown'));
  let item = itemHistory(a);
  assert.equal(item.exposures, 1); assert.equal(item.independentSuccesses, 0);
  assert.equal(item.assistedSuccesses, 0); assert.equal(item.intervalMs, 0); assert.equal(item.dueAt, null);
  a.learning.recordExposure('sound-quasar', event('assisted', { evidence: 'assisted' }));
  item = itemHistory(a); assert.equal(item.assistedSuccesses, 1); assert.equal(item.independentSuccesses, 0);
  assert.equal(item.intervalMs, 600000); assert.equal(item.lastEvidence, 'assisted');
  independent(a, 'unaided'); item = itemHistory(a);
  assert.equal(item.independentSuccesses, 1); assert.equal(item.spacedSuccesses, 0);
  assert.equal(item.independentDays, 1); assert.equal(item.intervalMs, day);
  assert.equal(item.firstSeenAt, '2030-01-01T10:00:00.000Z');
  assert.equal(item.dueAt, '2030-01-02T10:00:00.000Z');
  assert.throws(() => a.learning.recordExposure('sound-quasar', event('invented', { evidence: 'mastered' })), /evidence/u);
});

test('a correction upgrades a missed encounter only to assisted once, across reload and duplicate delivery', async () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  a.learning.recordExposure('sound-quasar', event('same', { correct: false, evidence: 'independent' }));
  independent(a, 'same'); independent(a, 'same');
  await a.learning.retryPendingSaves();
  const b = browser(a.localStorage, 'caatuu-test', clock); independent(b, 'same');
  const item = itemHistory(b);
  assert.equal(item.exposures, 1); assert.equal(item.mistakes, 1); assert.equal(item.successes, 1);
  assert.equal(item.assistedSuccesses, 1); assert.equal(item.independentSuccesses, 0);
  assert.equal(item.lapses, 1); assert.equal(item.lastCorrect, false); assert.equal(item.lastEvidence, 'assisted');
  assert.equal(item.intervalMs, 600000); assert.equal(item.spacedSuccesses, 0);
});

test('a hint within an encounter prevents its later correct response from becoming independent', () => {
  const a = browser();
  a.learning.recordExposure('sound-quasar', event('hint', { correct: null, evidence: 'assisted' }));
  assert.equal(itemHistory(a).assistedSuccesses, 0);
  independent(a, 'hint');
  const item = itemHistory(a);
  assert.equal(item.exposures, 1); assert.equal(item.assistedSuccesses, 1); assert.equal(item.independentSuccesses, 0);
  assert.ok(item.lastAssistedAt); assert.equal(item.lastEvidence, 'assisted');
});

test('a delayed wrong result downgrades an already checkpointed same-encounter success', async () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  independent(a, 'same'); await a.learning.retryPendingSaves();
  const b = browser(a.localStorage, 'caatuu-test', clock);
  b.learning.recordExposure('sound-quasar', event('same', { correct: false, evidence: 'independent' }));
  await b.learning.retryPendingSaves();
  const item = itemHistory(a);
  assert.equal(item.exposures, 1); assert.equal(item.independentSuccesses, 0); assert.equal(item.independentDays, 0);
  assert.equal(item.assistedSuccesses, 1); assert.equal(item.lastIndependentAt, null);
  assert.equal(item.mistakes, 1); assert.equal(item.lastCorrect, false); assert.equal(item.intervalMs, 600000);
});

test('massed practice, midnight, and reload do not manufacture spaced success', async () => {
  const clock = clockAt('2030-01-01T23:59:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  independent(a, 'first');
  for (let index = 0; index < 8; index++) { clock.now += 60000; independent(a, `massed-${index}`); }
  await a.learning.retryPendingSaves();
  const b = browser(a.localStorage, 'caatuu-test', clock); independent(b, 'reloaded');
  const item = itemHistory(b);
  assert.equal(item.independentSuccesses, 10); assert.equal(item.independentDays, 1); assert.equal(item.spacedSuccesses, 0);
  assert.equal(item.intervalMs, day); assert.equal(Date.parse(item.dueAt), clock.now + day);
});

test('successful reviews require elapsed interval and a fresh visit even in the same open tab', () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  independent(a, 'first'); clock.now += day;
  independent(a, 'first'); assert.equal(itemHistory(a).exposures, 1, 'a delayed old callback is not a return visit');
  independent(a, 'return'); let item = itemHistory(a);
  assert.equal(item.spacedSuccesses, 1); assert.equal(item.independentDays, 2); assert.equal(item.intervalMs, day * 1.8);
  const priorDue = item.dueAt;
  clock.now += day; independent(a, 'early-review');
  item = itemHistory(a); assert.equal(item.spacedSuccesses, 1);
  assert.equal(Date.parse(item.dueAt), clock.now + day * 1.8);
  assert.ok(item.dueAt > priorDue);
  clock.now = Date.parse(item.dueAt); independent(a, 'on-time-review');
  item = itemHistory(a); assert.equal(item.spacedSuccesses, 2); assert.equal(item.independentDays, 3);
  assert.equal(item.intervalMs, Math.round(day * 1.8 * 1.8));
});

test('a lapse preserves prior evidence while bringing review forward; short corrections cannot grow spacing', () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  independent(a, 'first'); clock.now += day; independent(a, 'spaced');
  clock.now += 60000;
  a.learning.recordExposure('sound-quasar', event('miss', { correct: false, evidence: 'independent' }));
  independent(a, 'miss'); let item = itemHistory(a);
  assert.equal(item.independentSuccesses, 2); assert.equal(item.spacedSuccesses, 1); assert.equal(item.independentDays, 2);
  assert.equal(item.intervalMs, 600000); assert.equal(item.lapses, 1);
  clock.now += 600000; independent(a, 'quick-retry'); item = itemHistory(a);
  assert.equal(item.spacedSuccesses, 1); assert.equal(item.intervalMs, 600000);
  assert.equal(item.assistedSuccesses, 1);
  a.learning.recordExposure('sound-quasar', event('neutral', { correct: null }));
  assert.equal(itemHistory(a).lastAttemptAt, item.lastAttemptAt);
  assert.equal(itemHistory(a).lastEvidence, item.lastEvidence);
});

test('the conservative interval has a finite cap and clock rollback earns no spacing', () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  independent(a, 'first');
  for (let index = 0; index < 14; index++) { clock.now = Date.parse(itemHistory(a).dueAt); independent(a, `review-${index}`); }
  const before = itemHistory(a);
  assert.equal(before.intervalMs, 30 * day); assert.equal(before.spacedSuccesses, 14);
  clock.now -= 40 * day; independent(a, 'clock-rollback');
  assert.equal(itemHistory(a).spacedSuccesses, before.spacedSuccesses);
  assert.equal(itemHistory(a).dueAt, before.dueAt);
});

test('v1 checkpoints and pending events remain exposure-only and survive old-client compaction without double counting', async () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  const legacyKey = 'caatuu-test.learning.content.v1';
  const bank = JSON.stringify(['sound-quasar', 'words']);
  const old = { schemaVersion: 1, generation: 'legacy', applied: [], banks: { [bank]: { 'item-a': {
    exposures: 7, successes: 6, mistakes: 1, lastSeenAt: '2029-12-31T10:00:00.000Z', lastCorrect: true, encounters: ['old-visit']
  } } } };
  const raw = JSON.stringify(old); a.localStorage.setItem(legacyKey, raw);
  a.localStorage.setItem(`${legacyKey}.pending.old-extra`, JSON.stringify({ schemaVersion: 1, id: 'old-extra', generation: 'legacy',
    gameId: 'sound-quasar', ...event('old-extra'), at: '2029-12-31T11:00:00.000Z' }));
  let item = itemHistory(a); assert.equal(item.exposures, 8); assert.equal(item.independentSuccesses, 0); assert.equal(item.intervalMs, 0);
  assert.equal(item.practiceDays, 0); assert.equal(item.lastPracticeDayAt, null);
  independent(a, 'old-visit'); assert.equal(itemHistory(a).exposures, 8, 'old receipts cannot become recall evidence');
  independent(a, 'new-visit'); await a.learning.retryPendingSaves();
  assert.equal(a.localStorage.getItem(legacyKey), raw, 'the new client never checkpoints into v1');
  old.banks[bank]['item-a'].exposures += 1; old.banks[bank]['item-a'].successes += 1;
  old.banks[bank]['item-a'].encounters.push('old-extra'); old.applied = ['old-extra'];
  a.localStorage.setItem(legacyKey, JSON.stringify(old)); a.localStorage.removeItem(`${legacyKey}.pending.old-extra`);
  item = itemHistory(browser(a.localStorage, 'caatuu-test', clock));
  assert.equal(item.exposures, 9); assert.equal(item.independentSuccesses, 1); assert.equal(item.independentDays, 1);
  assert.equal(item.practiceDays, 1);
  assert.equal(item.firstSeenAt, old.banks[bank]['item-a'].lastSeenAt);
  a.learning.resetProgress(); a.localStorage.setItem(legacyKey, raw);
  assert.equal(itemHistory(a), undefined, 'a stale v1 compactor cannot resurrect history after reset');
});

test('late duplicate encounters remain deduplicated after more than 64 later visits', async () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  independent(a, 'first');
  for (let index = 0; index < 70; index++) { clock.now += 1000; independent(a, `later-${index}`); }
  await a.learning.retryPendingSaves();
  const reloaded = browser(a.localStorage, 'caatuu-test', clock);
  independent(reloaded, 'first');
  assert.equal(itemHistory(reloaded).exposures, 71); assert.equal(itemHistory(reloaded).independentSuccesses, 71);
  assert.equal(itemHistory(reloaded).spacedSuccesses, 0);
});

test('neutral later exposure does not erase the most recent wrong-response signal', () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  a.learning.recordExposure('sound-quasar', event('miss', { correct: false, evidence: 'independent' }));
  const missed = itemHistory(a); clock.now += 60000;
  a.learning.recordExposure('sound-quasar', event('later-exposure', { correct: null }));
  const item = itemHistory(a);
  assert.equal(item.exposures, 2); assert.equal(item.lastCorrect, false); assert.equal(item.lastEvidence, missed.lastEvidence);
  assert.equal(item.lastAttemptAt, missed.lastAttemptAt); assert.notEqual(item.lastSeenAt, missed.lastSeenAt);
  assert.equal(item.dueAt, missed.dueAt);
});

test('unknown current reset generation cannot grant independent credit even without an explicit generation', () => {
  const a = browser(); const read = a.localStorage.getItem.bind(a.localStorage);
  a.localStorage.getItem = name => {
    if (name === 'caatuu-test.learning.performance.v1.reset') throw new Error('unavailable');
    return read(name);
  };
  assert.equal(independent(a, 'unknown'), false);
  a.localStorage.getItem = read;
  assert.equal(itemHistory(a), undefined);
});

test('v2 saves do not repair or overwrite damaged or future v1 content stores', async () => {
  const legacyKey = 'caatuu-test.learning.content.v1';
  for (const raw of ['{damaged', JSON.stringify({ schemaVersion: 999 })]) {
    const a = browser(); a.localStorage.setItem(legacyKey, raw);
    a.localStorage.setItem(`${legacyKey}.backup`, JSON.stringify({ schemaVersion: 1, generation: 'legacy', banks: {}, applied: [] }));
    independent(a, 'new'); await a.learning.retryPendingSaves();
    assert.equal(a.localStorage.getItem(legacyKey), raw);
    assert.equal(itemHistory(a).independentSuccesses, 1);
    assert.ok(a.localStorage.getItem(key), 'new evidence can checkpoint separately');
    assert.equal(a.learning.saveStatus().status, 'error', 'legacy damage remains honestly reported');
  }
});

test('two tabs correcting the same failed encounter cannot duplicate assisted credit', async () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  const b = browser(a.localStorage, 'caatuu-test', clock);
  a.learning.recordExposure('sound-quasar', event('same', { correct: false, evidence: 'independent' }));
  independent(b, 'same'); independent(a, 'same');
  await a.learning.retryPendingSaves(); await b.learning.retryPendingSaves();
  const item = itemHistory(browser(a.localStorage, 'caatuu-test', clock));
  assert.equal(item.exposures, 1); assert.equal(item.mistakes, 1); assert.equal(item.assistedSuccesses, 1);
  assert.equal(item.independentSuccesses, 0); assert.equal(item.spacedSuccesses, 0);
});

test('new overdue mistakes schedule a short future review while same-encounter retries cannot postpone it', async () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  independent(a, 'first'); clock.now += 2 * day;
  a.learning.recordExposure('sound-quasar', event('miss', { correct: false, evidence: 'independent' }));
  const deadline = itemHistory(a).dueAt;
  assert.equal(Date.parse(deadline), clock.now + 600000);
  await a.learning.retryPendingSaves(); clock.now += 300000;
  const b = browser(a.localStorage, 'caatuu-test', clock);
  b.learning.recordExposure('sound-quasar', event('miss', { correct: false, evidence: 'independent' }));
  independent(b, 'miss');
  assert.equal(itemHistory(b).dueAt, deadline);
  b.learning.recordExposure('sound-quasar', event('fresh-assisted', { evidence: 'assisted' }));
  assert.equal(Date.parse(itemHistory(b).dueAt), clock.now + 600000);
});

test('actual persisted overdue mistakes and assisted practice rotate fairly through the shared selector', () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  const rows = Array.from({ length: 30 }, (_, index) => ({ id: `queue-${String(index).padStart(2, '0')}`,
    difficulty: 1, usefulness: 80, complexity: 10 }));
  for (const row of rows) {
    a.learning.recordExposure('sound-quasar', event(`seed-${row.id}`, { itemId: row.id, evidence: 'independent' }));
    clock.now += 60000;
  }
  clock.now += 2 * day;
  const selectedCounts = new Map();
  for (let step = 0; step < 120; step++) {
    const history = a.learning.contentHistory('sound-quasar', 'words');
    const [row] = selectContentItems(rows, { history, now: clock.now, limit: 1, random: () => 0 });
    selectedCounts.set(row.id, (selectedCounts.get(row.id) || 0) + 1);
    a.learning.recordExposure('sound-quasar', event(`attempt-${step}`, { itemId: row.id,
      correct: step % 2 === 0 ? false : true, evidence: step % 2 === 0 ? 'independent' : 'assisted' }));
    clock.now += 1000;
  }
  assert.equal(selectedCounts.size, rows.length);
  assert.ok([...selectedCounts.values()].every(value => value >= 2 && value <= 8),
    `a repeatedly missed oldest deadline must not dominate: ${JSON.stringify([...selectedCounts])}`);
});

test('supported practice days require fresh encounters and full elapsed days without granting recall credit', async () => {
  const clock = clockAt('2030-01-01T23:59:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  const expose = (value, id) => value.learning.recordExposure('sound-quasar', event(id, { correct: null }));
  expose(a, 'first'); assert.equal(itemHistory(a).practiceDays, 1);
  clock.now += 60000; expose(a, 'after-midnight'); assert.equal(itemHistory(a).practiceDays, 1);
  clock.now += day; expose(a, 'next-day');
  await a.learning.retryPendingSaves();
  const b = browser(a.localStorage, 'caatuu-test', clock);
  assert.equal(itemHistory(b).practiceDays, 2);
  clock.now += 5 * day; expose(b, 'first');
  assert.equal(itemHistory(b).practiceDays, 2, 'a delayed old receipt is never a new practice day');
  b.learning.recordExposure('sound-quasar', event('supported-return', { evidence: 'assisted' }));
  const item = itemHistory(b);
  assert.equal(item.practiceDays, 3); assert.equal(item.lastPracticeDayAt, new Date(clock.now).toISOString());
  assert.equal(item.independentSuccesses, 0); assert.equal(item.independentDays, 0); assert.equal(item.spacedSuccesses, 0);
  assert.equal(item.intervalMs, 600000);
});

test('a quick retry after long absence and a fresh miss or hint never earns spaced credit', async () => {
  for (const support of [{ correct: false, evidence: 'independent' }, { correct: true, evidence: 'assisted' }]) {
    const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
    independent(a, 'first'); clock.now += 30 * day;
    a.learning.recordExposure('sound-quasar', event('return-with-support', support));
    await a.learning.retryPendingSaves();
    const b = browser(a.localStorage, 'caatuu-test', clock);
    clock.now += 600000; independent(b, 'quick-retry');
    let item = itemHistory(b);
    assert.equal(item.spacedSuccesses, 0); assert.equal(item.independentDays, 1);
    assert.equal(item.intervalMs, 600000); assert.equal(Date.parse(item.dueAt), clock.now + 600000);
    clock.now += day; independent(b, 'next-day-independent'); item = itemHistory(b);
    assert.equal(item.spacedSuccesses, 1); assert.equal(item.independentDays, 2);
  }
});

test('recent neutral rehearsal restarts the required delay from an old spacing anchor', () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  independent(a, 'first'); clock.now += day; independent(a, 'spaced');
  clock.now += 30 * day;
  a.learning.recordExposure('sound-quasar', event('read-again', { correct: null }));
  clock.now += 600000; independent(a, 'primed-response');
  const primed = itemHistory(a);
  assert.equal(primed.spacedSuccesses, 1); assert.equal(primed.intervalMs, day * 1.8);
  assert.equal(Date.parse(primed.dueAt), clock.now + primed.intervalMs);
  clock.now += day; independent(a, 'still-early');
  assert.equal(itemHistory(a).spacedSuccesses, 1);
  clock.now = Date.parse(itemHistory(a).dueAt); independent(a, 'fully-delayed');
  assert.equal(itemHistory(a).spacedSuccesses, 2);
});

test('a recent common presentation constrains directional spacing without transferring recall', async () => {
  const clock = clockAt('2030-01-01T10:00:00.000Z'); const a = browser(null, 'caatuu-test', clock);
  independent(a, 'first'); clock.now += 30 * day;
  const previousExposureAt = new Date(clock.now).toISOString(); clock.now += 600000;
  a.learning.recordExposure('sound-quasar', event('recent-other-direction', { evidence: 'independent', previousExposureAt }));
  await a.learning.retryPendingSaves();
  const b = browser(a.localStorage, 'caatuu-test', clock); let item = itemHistory(b);
  assert.equal(item.independentSuccesses, 2); assert.equal(item.spacedSuccesses, 0);
  assert.equal(item.intervalMs, day); assert.equal(Date.parse(item.dueAt), clock.now + day);
  assert.equal(Object.keys(b.learning.contentHistory('sound-quasar', 'other-direction')).length, 0);
  assert.throws(() => b.learning.recordExposure('sound-quasar', event('bad-date', { previousExposureAt: 'not-a-date' })), /evidence/u);
  clock.now += day;
  b.learning.recordExposure('sound-quasar', event('delayed', { evidence: 'independent', previousExposureAt: null }));
  item = itemHistory(b); assert.equal(item.spacedSuccesses, 1); assert.equal(item.independentDays, 2);
});

const plain = value => JSON.parse(JSON.stringify(value));
const contentBank = JSON.stringify(['sound-quasar', 'words']);
function v2Fixture(itemCount = 1, encounterCount = 30) {
  const firstAt = Date.parse('2030-01-01T10:00:00.123Z');
  const banks = { [contentBank]: {} };
  for (let index = 0; index < itemCount; index += 1) {
    const encounters = {};
    for (let visit = 0; visit < encounterCount; visit += 1) {
      const at = new Date(firstAt + visit * day).toISOString();
      encounters[randomUUID()] = { flags: 25, at, reviewAt: at };
    }
    const lastAt = firstAt + (encounterCount - 1) * day;
    banks[contentBank][`fixture-${index}`] = {
      exposures: encounterCount, successes: encounterCount, mistakes: 0,
      firstSeenAt: new Date(firstAt).toISOString(), lastSeenAt: new Date(lastAt).toISOString(), lastCorrect: true,
      independentSuccesses: 0, assistedSuccesses: encounterCount, lastIndependentAt: null,
      spacedSuccesses: 0, independentDays: 0, intervalMs: 600000, dueAt: new Date(lastAt + 600000).toISOString(),
      lapses: 0, lastEvidence: 'assisted', lastAttemptAt: new Date(lastAt).toISOString(),
      lastAssistedAt: new Date(lastAt).toISOString(), spacingAnchorAt: null,
      practiceDays: encounterCount, lastPracticeDayAt: new Date(lastAt).toISOString(), encounters
    };
  }
  return { schemaVersion: 2, generation: 'legacy', revision: itemCount * encounterCount, banks, applied: [] };
}

test('compact checkpoints round-trip UUIDs, opaque IDs, outcomes, timestamps and delayed corrections exactly', async () => {
  const clock = clockAt('2030-01-01T10:00:00.123Z'); const a = browser(null, 'caatuu-test', clock);
  const ids = ['00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'ABCDEFAB-0000-0000-0000-000000000000', '__proto__', 'a:雪:🦉', ...Array.from({ length: 20 }, randomUUID)];
  const attempts = ids.map((encounterId, index) => event(encounterId, {
    correct: index % 3 === 0 ? false : index % 3 === 1 ? null : true,
    evidence: index % 2 ? 'assisted' : 'independent'
  }));
  for (const attempt of attempts) { a.learning.recordExposure('sound-quasar', attempt); clock.now += day + 17; }
  const expected = plain(itemHistory(a)); await a.learning.retryPendingSaves();
  const raw = a.localStorage.getItem(key), checkpoint = JSON.parse(raw);
  assert.equal(checkpoint.schemaVersion, 3);
  assert.equal(raw, a.localStorage.getItem(`${key}.backup`));
  assert.equal(Object.keys(checkpoint.banks[contentBank]['item-a'][1]).length, ids.length);
  const b = browser(a.localStorage, 'caatuu-test', clock);
  assert.deepEqual(plain(itemHistory(b)), expected);
  for (const attempt of attempts) b.learning.recordExposure('sound-quasar', attempt);
  assert.deepEqual(plain(itemHistory(b)), expected, 'every old ID retains exact duplicate protection');
  b.learning.recordExposure('sound-quasar', event(ids[0], { evidence: 'independent' }));
  assert.equal(itemHistory(b).exposures, expected.exposures);
  assert.equal(itemHistory(b).assistedSuccesses, expected.assistedSuccesses + 1);
  assert.equal(itemHistory(b).independentSuccesses, expected.independentSuccesses);
});

test('readable v2 history migrates without losing old receipts or unusual timestamp spelling', async () => {
  const clock = clockAt('2031-01-01T10:00:00.123Z'); const a = browser(null, 'caatuu-test', clock);
  const old = v2Fixture(1, 3); const item = old.banks[contentBank]['fixture-0'];
  const oldId = Object.keys(item.encounters)[0];
  item.encounters[oldId].at = '2030-01-01T10:00:00.123+00:00';
  item.firstSeenAt = '2030-01-01T10:00:00.123+00:00';
  const raw = JSON.stringify(old); a.localStorage.setItem(key, raw); a.localStorage.setItem(`${key}.backup`, raw);
  const before = plain(a.learning.contentHistory('sound-quasar', 'words')['fixture-0']);
  a.learning.recordExposure('sound-quasar', event('new-neutral', { itemId: 'fixture-0', correct: null }));
  const after = plain(a.learning.contentHistory('sound-quasar', 'words')['fixture-0']);
  await a.learning.retryPendingSaves();
  assert.equal(JSON.parse(a.localStorage.getItem(key)).schemaVersion, 3);
  const b = browser(a.localStorage, 'caatuu-test', clock);
  assert.deepEqual(plain(b.learning.contentHistory('sound-quasar', 'words')['fixture-0']), after);
  b.learning.recordExposure('sound-quasar', event(oldId, { itemId: 'fixture-0', evidence: 'assisted' }));
  assert.equal(b.learning.contentHistory('sound-quasar', 'words')['fixture-0'].exposures, before.exposures + 1);
  assert.equal(b.learning.contentHistory('sound-quasar', 'words')['fixture-0'].firstSeenAt, before.firstSeenAt);
});

test('malformed compact receipts and tuples are preserved and cannot replace readable recovery data', async () => {
  const a = browser(); independent(a, 'ffffffff-ffff-ffff-ffff-ffffffffffff'); await a.learning.retryPendingSaves();
  const valid = a.localStorage.getItem(key);
  const mutations = [
    tuple => { tuple[0][tuple[0].length - 1] = '1'; },
    tuple => { const id = Object.keys(tuple[1])[0]; tuple[1][id] += String.fromCharCode(256); },
    tuple => { const id = Object.keys(tuple[1])[0]; tuple[1][id] = String.fromCharCode(512) + tuple[1][id].slice(1); },
    tuple => { const id = Object.keys(tuple[1])[0]; tuple[1][id] = tuple[1][id][0] + String.fromCharCode(256) + tuple[1][id].slice(2); },
    tuple => { const id = Object.keys(tuple[1])[0]; tuple[1][id.slice(0, -1) + String.fromCharCode(512)] = tuple[1][id]; delete tuple[1][id]; }
  ];
  for (const mutate of mutations) {
    const bad = JSON.parse(valid); mutate(bad.banks[contentBank]['item-a']); const raw = JSON.stringify(bad);
    const b = browser(); b.localStorage.setItem(key, raw);
    b.learning.recordExposure('sound-quasar', event('new'));
    await b.learning.retryPendingSaves();
    assert.equal(b.localStorage.getItem(key), raw); assert.equal(b.learning.saveStatus().status, 'error');
    b.localStorage.setItem(`${key}.backup`, valid);
    const recovered = browser(b.localStorage); assert.equal(itemHistory(recovered).exposures, 2);
    await recovered.learning.retryPendingSaves();
    assert.equal(b.localStorage.getItem(`${key}.damaged`), raw);
    assert.equal(recovered.learning.saveStatus().status, 'saved');
  }
});

test('a thousand 30-encounter histories plus recovery copy fit a bounded string quota and remain readable', async () => {
  const a = browser(); const old = v2Fixture(1000, 30);
  a.localStorage.setItem(key, JSON.stringify(old));
  a.learning.recordExposure('sound-quasar', event('migration', { itemId: 'fixture-0', correct: null }));
  await a.learning.retryPendingSaves();
  const primary = a.localStorage.getItem(key), backup = a.localStorage.getItem(`${key}.backup`);
  assert.ok(primary.length + backup.length < 2.5 * 1024 * 1024, 'receipts must leave room for other same-origin progress');
  const write = a.localStorage.setItem.bind(a.localStorage);
  a.localStorage.setItem = (name, value) => {
    const used = Array.from({ length: a.localStorage.length }, (_, index) => a.localStorage.key(index))
      .filter(key => key !== name).reduce((sum, key) => sum + key.length + a.localStorage.getItem(key).length, 0);
    if (used + name.length + String(value).length > 5 * 1024 * 1024) throw new Error('QuotaExceededError');
    write(name, value);
  };
  a.learning.recordExposure('sound-quasar', event(randomUUID(), { itemId: 'fixture-0', evidence: 'assisted' }));
  await a.learning.retryPendingSaves();
  const b = browser(a.localStorage); const history = b.learning.contentHistory('sound-quasar', 'words');
  assert.equal(Object.keys(history).length, 1000); assert.equal(history['fixture-0'].exposures, 32);
  assert.equal(history['fixture-999'].exposures, 30); assert.equal(b.learning.saveStatus().status, 'saved');
  const oldest = Object.keys(old.banks[contentBank]['fixture-999'].encounters)[0];
  b.learning.recordExposure('sound-quasar', event(oldest, { itemId: 'fixture-999', evidence: 'assisted' }));
  assert.equal(b.learning.contentHistory('sound-quasar', 'words')['fixture-999'].exposures, 30);
});

test('compact quota failures remain visible and retry preserves every pending encounter', async () => {
  const a = browser(); independent(a, randomUUID()); await a.learning.retryPendingSaves();
  const write = a.localStorage.setItem.bind(a.localStorage);
  const used = () => Array.from({ length: a.localStorage.length }, (_, index) => a.localStorage.key(index))
    .reduce((sum, key) => sum + key.length + a.localStorage.getItem(key).length, 0);
  const quota = used() + 550; let failed = false;
  a.localStorage.setItem = (name, value) => {
    const prior = a.localStorage.getItem(name); const replaced = prior === null ? 0 : name.length + prior.length;
    if (used() - replaced + name.length + String(value).length > quota) { failed = true; throw new Error('QuotaExceededError'); }
    write(name, value);
  };
  for (let index = 0; index < 24; index += 1) {
    a.learning.recordExposure('sound-quasar', event(randomUUID(), { evidence: 'assisted' }));
    await a.learning.retryPendingSaves();
  }
  assert.equal(failed, true); assert.equal(a.learning.saveStatus().status, 'error'); assert.equal(itemHistory(a).exposures, 25);
  a.localStorage.setItem = write; await a.learning.retryPendingSaves();
  assert.equal(a.learning.saveStatus().status, 'saved'); assert.equal(itemHistory(browser(a.localStorage)).exposures, 25);
});

test('compact migration preserves unknown item and receipt fields losslessly', async () => {
  const clock = clockAt('2031-01-01T10:00:00.123Z'); const a = browser(null, 'caatuu-test', clock);
  const old = v2Fixture(1, 3); const item = old.banks[contentBank]['fixture-0'];
  const receiptId = Object.keys(item.encounters)[0];
  item.futureDetail = { model: 'unrecognized', values: [null, 0, false, '雪'] };
  item.encounters[receiptId].futureReceiptDetail = { meaning: ['preserve', 17] };
  a.localStorage.setItem(key, JSON.stringify(old));
  a.learning.recordExposure('sound-quasar', event('migrate', { itemId: 'fixture-0', correct: null }));
  await a.learning.retryPendingSaves();
  const packed = JSON.parse(a.localStorage.getItem(key)).banks[contentBank]['fixture-0'];
  assert.deepEqual(packed[2].futureDetail, item.futureDetail);
  const opaqueReceipt = Object.values(packed[1]).find(value => value && typeof value === 'object');
  assert.deepEqual(opaqueReceipt, item.encounters[receiptId]);
  const b = browser(a.localStorage, 'caatuu-test', clock);
  assert.deepEqual(plain(b.learning.contentHistory('sound-quasar', 'words')['fixture-0'].futureDetail), item.futureDetail);
  b.learning.recordExposure('sound-quasar', event(receiptId, { itemId: 'fixture-0', evidence: 'assisted' }));
  assert.equal(b.learning.contentHistory('sound-quasar', 'words')['fixture-0'].exposures, 4);
});

test('the exact-byte checkpoint cache observes other tabs, damaged replacements and resets', async () => {
  const a = browser(); independent(a, 'first'); await a.learning.retryPendingSaves();
  assert.equal(itemHistory(a).exposures, 1);
  const b = browser(a.localStorage); independent(b, 'other-tab'); await b.learning.retryPendingSaves();
  assert.equal(itemHistory(a).exposures, 2);
  const external = a.learning.readGameState(key); external.banks[contentBank]['item-a'][0][0] = 999;
  assert.equal(itemHistory(a).exposures, 2, 'a mutable generic read never aliases the cached checkpoint');
  a.localStorage.setItem(key, '{damaged-after-cache');
  assert.equal(itemHistory(a).exposures, 2); assert.equal(a.learning.saveStatus().status, 'error');
  await a.learning.retryPendingSaves();
  assert.equal(a.localStorage.getItem(`${key}.damaged`), '{damaged-after-cache');
  b.learning.resetProgress();
  assert.equal(itemHistory(a), undefined);
  independent(b, 'after-reset'); await b.learning.retryPendingSaves();
  assert.equal(itemHistory(a).exposures, 1);
});
