import assert from 'node:assert/strict';
import test from 'node:test';
import { mappingFixture, mappingBoundaryProbes } from '../../../tools/learning-evaluation/shared/mapping-runtime-probes.mjs';
import { accountProjection, assertSameCompleted } from '../../../tools/learning-evaluation/shared/mapping-audit.mjs';
import { createPracticeCompass, projectPracticeCompass, sharedPracticeAxes } from '../static/source/practice-compass.mjs';
import { embedSharedEnglishTexts, peekSharedEnglishVector } from '../static/source/english-image-search.mjs';

const unit = () => Float32Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0);
const finish = async facade => {
  for (let pass = 0; pass < 100; pass++) {
    const result = await facade.project({ diagnostics: true });
    accountProjection(result);
    if (!result.pendingTexts) return result;
  }
  assert.fail('Bounded processing did not complete');
};

test('a history beyond the former vector ceiling completes; incomplete axes never imply semantic nonmatch', async () => {
  const result = await mappingBoundaryProbes();
  assert.equal(result.missingAxis.incorrectlyCalledSemanticNonmatch, false);
  assert.equal(result.missingAxis.status, 'vector-unavailable');
  assert.ok(result.missingAxis.axes.every(axis => axis.practice === null));
  assert.equal(result.capacity.completed, true);
  assert.equal(result.capacity.checkpoints.at(-1).counts.mappedItems, result.capacity.identities);
  assert.ok(result.capacity.maxBatch <= 24);
  assert.ok(result.capacity.maxPass <= 512);
});

test('cold, warm, batch boundaries, order and reopening preserve completed mass', async () => {
  const original = mappingFixture(140);
  const cold = await original.facade.project({ diagnostics: true });
  assert.equal(original.calls.reduce((a,b) => a+b,0), 96);
  assert.equal(accountProjection(cold).statuses.pending, 51);
  const complete = await finish(original.facade);
  const count = original.calls.length;
  assertSameCompleted(complete, await finish(original.facade));
  assert.equal(original.calls.length, count);
  const other = mappingFixture(140, { maxNewTexts: 7 });
  other.profile.banks[0].history = Object.fromEntries(Object.entries(other.profile.banks[0].history).reverse());
  // Change only scheduling timestamps in this synthetic fixture, not evidence.
  Object.values(other.profile.banks[0].history).forEach((history, i) => { history.lastSeenAt = new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(); });
  assertSameCompleted(complete, await finish(other.facade));
  const reopened = createPracticeCompass({ ...original.settings, owner: {} });
  assertSameCompleted(complete, await finish(reopened));
  assert.ok([...original.calls, ...other.calls].every(size => size <= 24));
});

test('vector eviction and offline warm reads do not reduce completed practice', async () => {
  const fixture = mappingFixture(300);
  const complete = await finish(fixture.facade);
  for (let offset = 0; offset < 320; offset += 32) await embedSharedEnglishTexts(Array.from({length:32}, (_,i) => `Unrelated eviction text ${offset+i}`), {owner:fixture.owner,encoder:async texts=>texts.map(unit)});
  const count = fixture.calls.length;
  assertSameCompleted(complete, await finish(fixture.facade));
  assert.equal(fixture.calls.length, count);
  const coldOffline = mappingFixture(3, { encoder: async () => { throw new Error('offline model unavailable'); } });
  const failed = await coldOffline.facade.project({ diagnostics: true });
  assert.equal(accountProjection(failed).statuses['vector-unavailable'], 3);
  assert.equal(failed.mappingCounts.unmatched, 0);
  assert.ok(failed.axes.every(axis => axis.practice === null));
});

test('interruption releases the caller, preserves serialization and resumes correctly', async () => {
  const controller = new AbortController();
  let release, entered, active = 0, peak = 0, first = true;
  const started = new Promise(resolve => { entered = resolve; });
  const fixture = mappingFixture(30, { encoder: async texts => {
    active++; peak = Math.max(peak, active);
    if (first) { first = false; entered(); await new Promise(resolve => { release = resolve; }); }
    active--; return texts.map(unit);
  } });
  const promise = fixture.facade.project({ signal: controller.signal, diagnostics: true });
  await started; controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  release();
  const result = await finish(fixture.facade);
  assert.equal(result.mappingCounts.matched, 30);
  assert.equal(peak, 1);
});

test('failed prefixes do not starve later identities and invalid vectors never become nonmatches', async () => {
  const calls = [];
  const fixture = mappingFixture(60, { maxNewTexts: 24, encoder: async texts => {
    calls.push(...texts);
    if (texts.some(text => text.includes('number 0.'))) throw new Error('fixture failure');
    return texts.map(unit);
  } });
  let latest;
  for (let i=0; i<8; i++) accountProjection(latest = await fixture.facade.project({ diagnostics:true }));
  assert.ok(calls.includes('A real fixture text number 59.'));
  assert.ok(latest.mappingCounts.matched > 0, 'a bad item batch must not poison the shared anchors');
  const invalid = mappingFixture(1, { encoder: async texts => texts.map(() => [NaN]) });
  const result = await invalid.facade.project({ diagnostics: true });
  assert.equal(accountProjection(result).statuses['vector-unavailable'], 1);
  assert.equal(result.mappingCounts.unmatched, 0);
});

test('completed zero weights, pending, rejected English and unresolved IDs reconcile separately', async () => {
  const vector = [0,1];
  const result = projectPracticeCompass({courseId:'fixture',diagnostics:true,
    axisVectors:Object.fromEntries(sharedPracticeAxes.map(axis=>[axis.id,[1,0]])),
    items:['unmatched','pending','rejected','unresolved'].map((id,i)=>({identity:{courseId:'fixture',gameId:'game',bankId:'bank',itemId:id},history:{exposures:1},
      vector:i===0?vector:null, mappingState:'queued',unmappedReason:i===2?'english-text-unavailable':i===3?'item-not-in-catalog':null}))});
  assert.deepEqual(accountProjection(result).statuses, {'identity-unresolved':1,'english-unavailable':1,'evidence-unavailable':0,pending:1,'vector-unavailable':0,unmatched:1,matched:0});
  const complete = projectPracticeCompass({courseId:'fixture',diagnostics:true,axisVectors:Object.fromEntries(sharedPracticeAxes.map(axis=>[axis.id,[1,0]])),
    items:[{identity:{courseId:'fixture',gameId:'game',bankId:'bank',itemId:'unmatched'},history:{exposures:1},vector}]});
  assert.equal(complete.status,'ready');
  assert.ok(complete.axes.every(axis=>axis.practice===0));
});

test('batch-sensitive encoders cannot make practice vectors depend on companions or legacy cache contents', async () => {
  const owner = {}, texts = ['a house', 'eat', 'tomorrow'];
  const encoder = async inputs => inputs.map(() => Float32Array.from({length:384}, (_,i) => Number(i === (inputs.length === 1 ? 0 : 1))));
  await embedSharedEnglishTexts(texts, { owner, encoder });
  assert.equal(peekSharedEnglishVector(texts[0], { owner })[1], 1);
  assert.equal(peekSharedEnglishVector(texts[0], { owner, individualInputs:true }), null);
  const together = await embedSharedEnglishTexts(texts, { owner, encoder, individualInputs:true });
  const separate = [];
  for (const text of texts) separate.push((await embedSharedEnglishTexts([text], {owner:{},encoder,individualInputs:true}))[0]);
  assert.deepEqual(together, separate);
  assert.ok(together.every(vector=>vector[0]===1));
  assert.equal(peekSharedEnglishVector(texts[0], { owner })[1], 1, 'legacy consumers keep their recipe');
});

test('a timed-out individual request retains its completed text without starting more model work', async () => {
  const owner = {}; let release, calls = 0;
  const request = embedSharedEnglishTexts(['first input', 'second input'], { owner, individualInputs:true, timeoutMs:5,
    encoder: async texts => { calls++; await new Promise(resolve => { release=resolve; }); return texts.map(unit); } });
  await assert.rejects(request, /timed out/);
  release();
  await new Promise(setImmediate);
  assert.equal(calls,1);
  assert.ok(peekSharedEnglishVector('first input',{owner,individualInputs:true}));
  assert.equal(peekSharedEnglishVector('second input',{owner,individualInputs:true}),null);
  assert.equal(owner[Symbol.for('caatuu.sharedImageRanking.v1')],owner[Symbol.for('caatuu.sharedImageRanking.v2')]);
  const resumed = await embedSharedEnglishTexts(['first input','second input'],{owner,individualInputs:true,encoder:async texts=>texts.map(unit)});
  assert.equal(resumed.length,2);
});
