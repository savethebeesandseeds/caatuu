import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareWordWorldContext } from '../../../apps/language-runtime/static/source/word-world-provider.mjs';
import { importBrowserLanguageAdapter } from '../../../apps/language-runtime/tests/browser-module-loader.mjs';

const root = new URL('../../../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
async function contextFor(directory) {
  const course = await json(`apps/languages/${directory}/course.json`);
  const manifest = await json(course.resources.wordWorldManifest.path);
  const staticRoot = course.resources.staticRoot.path;
  const adapter = await importBrowserLanguageAdapter(new URL(`${staticRoot}/source/language/adapter.mjs`, root));
  return prepareWordWorldContext({ ...course, learnerBasePreview: true }, manifest, {
    adapter, origin: 'https://caatuu.test', runtime: null, embeddingRanker: async () => [],
    loadJson: url => {
      const pathname = new URL(url, 'https://caatuu.test').pathname;
      if (pathname.startsWith('/language-runtime/')) return json(`apps${pathname}`);
      assert.ok(pathname.startsWith(`${course.routePrefix}/`));
      return json(`${staticRoot}/${pathname.slice(course.routePrefix.length + 1)}`);
    }
  });
}
const spanish = await contextFor('spanish');
const english = await contextFor('english-from-spanish');
const mandarin = await contextFor('mandarin-simplified');
const recordFor = (context, conceptId) => {
  const record = context.session.records.find(row => row.conceptId === conceptId || row.id === conceptId);
  assert.ok(record, conceptId);
  return record;
};
async function meaningAt(context, record, tokenIndex) {
  const result = await context.lookupMeaning({ record, token: record.target.tokens[tokenIndex], tokenIndex });
  assert.ok(result?.meaning, `${record.id}/${tokenIndex}`);
  return result.meaning;
}

test('every Spanish polite-request token exposes the fixed-expression meaning in the actual provider', async () => {
  let requests = 0;
  for (const record of spanish.session.records) {
    const tokens = record.target.tokens;
    for (let index = 0; index < tokens.length - 1; index++) {
      if (tokens[index].surface.toLowerCase() !== 'por' || tokens[index + 1].surface.toLowerCase() !== 'favor') continue;
      requests++;
      for (const at of [index, index + 1]) {
        const meaning = await meaningAt(spanish, record, at);
        assert.match(meaning, /please/u);
        assert.doesNotMatch(meaning, /^for\b|\bby\b|favor;/u);
      }
    }
  }
  assert.ok(requests > 0, 'The retained bank contains polite requests.');
});

test('the response to thanks is not presented as literal of/from/nothing', async () => {
  const record = recordFor(spanish, 'ww.politeness.welcome');
  for (let index = 0; index < record.target.tokens.length; index++) {
    const meaning = await meaningAt(spanish, record, index);
    assert.match(meaning, /you are welcome/u);
    assert.doesNotMatch(meaning, /nothing|^of\b|^from\b/u);
  }
});

test('Spanish compound-preposition hints keep their spatial or temporal meaning in context', async () => {
  const meanings = { antes: 'before', después: 'after', debajo: 'under', detrás: 'behind', cerca: 'near', junto: 'next to' };
  const seen = new Set();
  for (const record of spanish.session.records) {
    const tokens = record.target.tokens;
    for (let index = 1; index < tokens.length; index++) {
      const preceding = tokens[index - 1].surface.toLowerCase();
      const surface = tokens[index].surface.toLowerCase();
      if (!meanings[preceding] || !(preceding === 'junto' ? ['a', 'al'] : ['de', 'del']).includes(surface)) continue;
      const hint = await meaningAt(spanish, record, index);
      assert.ok(hint.includes(meanings[preceding]), `${record.id}: ${hint}`);
      assert.match(hint, /part of the expression/u);
      assert.doesNotMatch(hint, /from|^of\b|^to\b/u);
      if (['al', 'del'].includes(surface)) assert.ok(hint.endsWith(' the'));
      seen.add(preceding);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(meanings).sort());
});

test('Spanish personal-object markers are distinct from time and destination prepositions', async () => {
  for (const [id, index, role] of [
    ['ww.tech.call-grandmother', 1, /person being called/u],
    ['ww.family.visit-aunt', 1, /person being visited/u],
    ['ww.work.notify-change', 5, /team being notified/u],
    ['ww.reason.finish-help', 4, /person being helped/u]
  ]) {
    const hint = await meaningAt(spanish, recordFor(spanish, id), index);
    assert.match(hint, role);
    assert.doesNotMatch(hint, /^to\b/u);
  }
  const work = recordFor(spanish, 'ww.work.start-nine');
  assert.equal(await meaningAt(spanish, work, 1), 'to');
  assert.equal(await meaningAt(spanish, work, 3), 'at');
  assert.equal(await meaningAt(spanish, recordFor(spanish, 'ww.plan.want-school'), 2), 'to the');
});

test('Mandarin location and time hints do not teach the progressive sense of the same character', async () => {
  for (const [id, surface, expected] of [
    ['ww.question.where-are-you', '在', /located/u],
    ['ww.school.board-writing', '在', /on.*location/u],
    ['ww.work.office', '在', /in.*location/u],
    ['ww.family.grandfather-paper', '在', /ongoing action/u],
    ['ww.reason.road-work', '在', /ongoing action/u],
    ['ww.appointment.friday-three', '在', /scheduled time/u],
    ['ww.travel.reserve-window', '在', /online/u],
    ['ww.language.learn-pinyin', '在', /ongoing action/u]
  ]) {
    const record = recordFor(mandarin, id);
    const index = record.target.tokens.findIndex(token => token.surface === surface);
    const hint = await meaningAt(mandarin, record, index);
    assert.match(hint, expected);
    assert.notEqual(hint, 'be at; in progress');
  }
});

test('Mandarin descriptive and omitted-noun hints preserve genuine possessives elsewhere', async () => {
  for (const [id, expected] of [
    ['ww.choice.red-one', /red one/u],
    ['ww.work.clearer-chart', /description.*chart/u],
    ['ww.environment.reusable-bag', /reuse.*bag/u],
    ['ww.delivery.wrong-address', /wrong.*address/u],
    ['ww.language.ask-meaning', /not recognized.*word/u]
  ]) {
    const record = recordFor(mandarin, id);
    const hint = await meaningAt(mandarin, record, record.target.tokens.findIndex(token => token.surface === '的'));
    assert.match(hint, expected);
    assert.doesNotMatch(hint, /possessive/u);
  }
  const friend = recordFor(mandarin, 'ww.people.my-friend');
  assert.equal(await meaningAt(mandarin, friend, 3), 'possessive particle');
});

test('Mandarin expected actions and recipient markers remain distinct from ability and giving', async () => {
  for (const id of ['ww.plan.arrive-early', 'ww.plan.rest-after-task', 'ww.budget.compare-prices', 'ww.reason.finish-help', 'ww.language.summarize']) {
    const record = recordFor(mandarin, id);
    const hint = await meaningAt(mandarin, record, record.target.tokens.findIndex(token => token.surface === '会'));
    assert.match(hint, /will/u);
    assert.doesNotMatch(hint, /know how|^can/u);
  }
  for (const id of ['ww.language.speak-chinese', 'ww.hobby.piano']) {
    const record = recordFor(mandarin, id);
    assert.equal(await meaningAt(mandarin, record, 1), 'can; know how to');
  }
  for (const [id, expected] of [
    ['ww.shopping.receipt', /^give$/u], ['ww.food.more-rice', /^give$/u],
    ['ww.work.send-file', /to.*recipient/u], ['ww.work.send-agenda', /to.*recipient/u],
    ['ww.tech.call-grandmother', /person being called/u]
  ]) {
    const record = recordFor(mandarin, id);
    assert.match(await meaningAt(mandarin, record, record.target.tokens.findIndex(token => token.surface === '给')), expected);
  }
});

test('English possession and perfect auxiliaries have distinct Spanish hints after the runtime join', async () => {
  for (const [id, index, expected, excluded] of [
    ['ww.number.two-books', 1, /tengo|tener/u, /haber|auxiliar/u],
    ['ww.people.neighbor-dog', 2, /tiene/u, /auxiliar/u],
    ['ww.action.teacher-arrived', 2, /haber|auxiliar/u, /tiene|tener/u],
    ['ww.nature.park-flowers', 5, /han.*auxiliar/u, /tener/u],
    ['ww.housing.repair-appointment', 1, /he.*auxiliar/u, /tener/u],
    ['ww.experience.chinese-year', 1, /auxiliar/u, /tener/u]
  ]) {
    const meaning = await meaningAt(english, recordFor(english, id), index);
    assert.match(meaning, expected, id);
    assert.doesNotMatch(meaning, excluded, id);
  }
});

test('English it hints distinguish the time placeholder from a translated object', async () => {
  const time = await meaningAt(english, recordFor(english, 'ww.time.what-time'), 3);
  assert.match(time, /impersonal.*hora/u);
  assert.doesNotMatch(time, /ello/u);
  const repeat = await meaningAt(english, recordFor(english, 'ww.communication.say-again'), 3);
  assert.match(repeat, /^lo\b/u);
  const find = await meaningAt(english, recordFor(english, 'ww.problem.help-find'), 6);
  assert.match(find, /^la\b/u);
});

test('retained instrument and reception hints survive the contextual correction', async () => {
  assert.match(await meaningAt(english, recordFor(english, 'ww.hobby.piano'), 2), /tocar.*instrumento/u);
  assert.match(await meaningAt(english, recordFor(english, 'ww.service.package-desk'), 5), /recepción/u);
  assert.match(await meaningAt(english, recordFor(english, 'ww.service.package-desk'), 6), /recepción/u);
});
