import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validatePack, selectMoonChallenges, createMoonSession, answerMoonChallenge,
  advanceMoonChallenge, moonIllumination, moonShadePath } from '../static/review/memory-moon-core.mjs';

const pack = JSON.parse(await readFile(new URL('../static/review/memory-moon-content.json', import.meta.url), 'utf8'));
const select = options => selectMoonChallenges(pack, { random: () => 0.5, ...options });

test('demo content retains exact source translations, identities and review provenance', async () => {
  assert.equal(validatePack(pack), pack);
  const sourceBytes = await readFile(new URL('../../languages/czech/static/data/games/word-world/content.json', import.meta.url));
  const source = JSON.parse(sourceBytes);
  const byId = new Map(source.records.map(row => [row.id, row]));
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), pack.provenance.sourceContentSha256);
  assert.equal(pack.provenance.status, 'local-demo-selection');
  for (const challenge of pack.challenges) {
    const row = byId.get(challenge.sourceReference.itemId);
    assert.ok(row, 'challenge source identity resolves');
    assert.equal(challenge.targetText, row.cs);
    assert.equal(challenge.englishText, row.en);
    assert.equal(challenge.sourceReference.courseId, pack.courseId);
    assert.equal(challenge.sourceReference.contentRevision, pack.provenance.sourceContentSha256);
    assert.deepEqual(challenge.sourceReview, { status: row.review.status, humanApproved: row.review.humanApproved });
    assert.equal(challenge.correctChoiceId, challenge.sourceReference.itemId);
    for (const choice of challenge.choices) {
      assert.equal(choice.id, choice.sourceItemId, 'choice identity is its authored source identity');
      assert.equal(choice.text, byId.get(choice.sourceItemId)?.en);
    }
  }
});

test('nearby distractors retain an explicit contrast and exclude source-equivalent translations', async () => {
  const source = JSON.parse(await readFile(new URL('../../languages/czech/static/data/games/word-world/content.json', import.meta.url), 'utf8'));
  const byId = new Map(source.records.map(row => [row.id, row]));
  const normalize = text => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const focuses = new Set(['subject', 'action', 'object', 'state', 'polarity', 'location', 'number', 'time']);
  for (const challenge of pack.challenges) {
    const target = byId.get(challenge.sourceReference.itemId);
    // Duplicate target texts and declared English alternates are also answer authority.
    const equivalentRows = source.records.filter(row => normalize(row.cs) === normalize(target.cs));
    const accepted = new Set(equivalentRows.flatMap(row => [row.en, ...(row.enAlternates || [])]).map(normalize));
    for (const choice of challenge.choices.filter(row => row.id !== challenge.correctChoiceId)) {
      assert.ok(!accepted.has(normalize(choice.text)), `${choice.id} must not be an accepted target translation`);
      assert.notEqual(normalize(byId.get(choice.sourceItemId).cs), normalize(target.cs));
      const contrast = choice.distractorContrast;
      assert.ok(contrast && focuses.has(contrast.focus), `${choice.id} declares the distinction being tested`);
      assert.ok(contrast.rationale?.trim(), 'a content reviewer can inspect why the nearby meaning is different');
      const expected = normalize(contrast.targetPhrase);
      const alternative = normalize(contrast.alternativePhrase);
      assert.ok(expected && alternative);
      assert.notEqual(expected, alternative, 'the declared meanings must differ');
      assert.ok(normalize(challenge.englishText).includes(expected), 'the contrast stays anchored to the correct translation');
      assert.ok(normalize(choice.text).includes(alternative), 'the contrast stays anchored to the distractor translation');
    }
  }
});

test('pack rejects ambiguous, unanswerable and unattributed questions', () => {
  for (const mutate of [
    copy => { copy.challenges[0].choices[1].text = copy.challenges[0].englishText; },
    copy => { copy.challenges[0].correctChoiceId = 'absent'; },
    copy => { delete copy.challenges[0].sourceReference; },
    copy => { copy.challenges[1].id = copy.challenges[0].id; }
  ]) {
    const copy = structuredClone(pack);
    mutate(copy);
    assert.throws(() => validatePack(copy), /Invalid Memory Moon challenge/);
  }
});

test('no history still gives unique varied content without changing authored choices', () => {
  const before = JSON.stringify(pack);
  const selected = select();
  assert.equal(selected.length, 6);
  assert.equal(new Set(selected.map(row => row.id)).size, selected.length);
  assert.equal(new Set(selected.map(row => row.topic)).size, new Set(pack.challenges.map(row => row.topic)).size);
  assert.ok(selected.every(row => row.selectionReason === 'balanced-practice'));
  assert.equal(JSON.stringify(pack), before);
  assert.deepEqual(select({ limit: 0 }), []);
});

test('exact source needs outrank semantic neighbors and unrelated evidence cannot impersonate an identity', () => {
  const [exact, related] = pack.challenges;
  const selected = select({ limit: 3,
    weaknesses: [{ identity: exact.sourceReference, weight: 0.01 }], similarityById: { [related.id]: 1 } });
  assert.equal(selected[0].id, exact.id);
  assert.equal(selected[0].selectionReason, 'recent-mistake');
  assert.equal(selected[1].id, related.id);
  assert.equal(selected[1].selectionReason, 'related-practice');
  assert.ok(selected.some(row => row.selectionReason === 'balanced-practice'));
  const unrelated = select({ weaknesses: [{ identity: { ...exact.sourceReference, courseId: 'different' } }] });
  assert.ok(unrelated.every(row => row.selectionReason === 'balanced-practice'));
  assert.ok(select({ similarityById: { [related.id]: 1 } }).every(row => row.selectionReason === 'balanced-practice'));
});

test('wrong choices preserve moonlight and permit assisted recovery without claiming independent recall', () => {
  const initial = createMoonSession(select(), { target: 2 });
  const item = initial.items[0];
  const wrong = item.choices.find(choice => choice.id !== item.correctChoiceId).id;
  const mistake = answerMoonChallenge(initial, wrong);
  assert.equal(mistake.progress, 0);
  assert.equal(mistake.phase, 'question');
  assert.equal(mistake.assisted, true);
  assert.equal(mistake.mistakes, 1);
  assert.equal(answerMoonChallenge(mistake, wrong), mistake, 'disabled wrong option is idempotent');
  assert.equal(advanceMoonChallenge(mistake), mistake, 'unanswered questions cannot be skipped');
  const recovered = answerMoonChallenge(mistake, item.correctChoiceId);
  assert.equal(recovered.progress, 0.5);
  assert.equal(recovered.independentCorrectCount, 0);
  assert.equal(recovered.lastAnswer.assisted, true);
  assert.equal(answerMoonChallenge(recovered, item.correctChoiceId), recovered, 'double click cannot grow the moon twice');
  const next = advanceMoonChallenge(recovered);
  assert.equal(next.assisted, false);
  assert.deepEqual(next.wrongChoiceIds, []);
  const completed = answerMoonChallenge(next, next.items[next.index].correctChoiceId);
  assert.equal(completed.phase, 'complete');
  assert.equal(completed.progress, 1);
  assert.equal(completed.correctCount, 2);
  assert.equal(completed.independentCorrectCount, 1);
  assert.equal(completed.mistakes, 1);
  assert.equal(advanceMoonChallenge(completed), completed);
  assert.equal(initial.mistakes, 0, 'session reduction leaves prior state intact');
});

test('finite sessions can cycle a small pack and reject impossible input', () => {
  const items = select({ limit: 1 });
  let session = createMoonSession(items, { target: 3 });
  for (let i = 0; i < 3; i += 1) {
    session = answerMoonChallenge(session, items[0].correctChoiceId);
    if (i < 2) session = advanceMoonChallenge(session);
  }
  assert.equal(session.phase, 'complete');
  assert.equal(session.progress, 1);
  assert.throws(() => createMoonSession([]), /needs challenges/);
  assert.throws(() => createMoonSession(items, { target: 0 }), /positive whole target/);
  assert.throws(() => answerMoonChallenge(createMoonSession(items), 'unknown'), /Unknown Moon/);
});

// Read the drawn half-ellipse rather than prescribing SVG number formatting.
function shadowGeometry(progress) {
  const tokens = moonShadePath(progress).split(/\s+/);
  assert.deepEqual(tokens.slice(0, 11), ['M', '100', '0', 'A', '100', '100', '0', '0', '0', '100', '200']);
  const boundary = tokens.slice(11);
  if (boundary[0] === 'L') {
    assert.deepEqual(boundary, ['L', '100', '0', 'Z']);
    return { equatorX: 100, darkFraction: 0.5 };
  }
  assert.equal(boundary[0], 'A');
  const [radiusX, radiusY, rotation, largeArc, sweep, endX, endY] = boundary.slice(1, 8).map(Number);
  assert.deepEqual([radiusY, rotation, largeArc, endX, endY], [100, 0, 0, 100, 0]);
  assert.ok(sweep === 0 || sweep === 1);
  assert.equal(boundary[8], 'Z');
  // Returning bottom-to-top, sweep 0 bows right and sweep 1 bows left.
  const signedRadius = radiusX * (sweep === 0 ? 1 : -1);
  return { equatorX: 100 + signedRadius, darkFraction: (100 + signedRadius) / 200 };
}

test('shadow follows a projected spherical terminator through waxing phases', () => {
  assert.deepEqual(shadowGeometry(0), { equatorX: 200, darkFraction: 1 });
  assert.deepEqual(shadowGeometry(0.5), { equatorX: 100, darkFraction: 0.5 });
  const crescent = shadowGeometry(0.25);
  const gibbous = shadowGeometry(0.75);
  assert.ok(Math.abs(crescent.equatorX - (100 + 100 / Math.sqrt(2))) < 0.000001);
  assert.ok(Math.abs(gibbous.equatorX - (100 - 100 / Math.sqrt(2))) < 0.000001);
  assert.equal(crescent.equatorX + gibbous.equatorX, 200, 'complementary phases mirror the boundary');
  let previousLight = -1;
  for (let step = 0; step < 24; step += 1) {
    const progress = step / 24;
    const visibleLight = 1 - shadowGeometry(progress).darkFraction;
    assert.ok(visibleLight > previousLight, 'the lit area grows continuously from the right limb');
    assert.ok(Math.abs(visibleLight - moonIllumination(progress)) < 0.00000001,
      'accessible illumination agrees with the area left uncovered by the SVG');
    previousLight = visibleLight;
  }
  assert.equal(moonIllumination(0), 0);
  assert.equal(moonIllumination(1), 1);
  assert.ok(Math.abs(moonIllumination(0.5) - 0.5) < Number.EPSILON);
  assert.ok(Math.abs(moonIllumination(0.25) - (1 - 1 / Math.sqrt(2)) / 2) < Number.EPSILON);
});

test('shadow and illumination bound invalid progress and finish at full Moon', () => {
  assert.equal(moonShadePath(1), '');
  assert.equal(moonShadePath(2), '');
  for (const progress of [-1, NaN, Infinity, undefined]) {
    assert.equal(moonShadePath(progress), moonShadePath(0));
    assert.equal(moonIllumination(progress), 0);
  }
  assert.equal(moonIllumination(2), 1);
});
