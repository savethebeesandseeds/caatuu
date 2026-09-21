import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createBrowserHarness } from '../../../apps/language-runtime/tests/helpers/fake-browser.mjs';

const sourcePromise = readFile(new URL('../../../apps/language-runtime/static/source/learning-profile.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

/** Controlled browser around the real production journal/reducer, never a replica. */
export async function createLearningHarness({ courseId = 'stats-fixture', learnerId = 'learner-0', now }) {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('Harness now must be an epoch timestamp.');
  const source = await sourcePromise;
  const clock = { now };
  let sequence = 0;
  let browser;
  const open = (storageValues = {}) => {
    const result = createBrowserHarness({
      course: { id: courseId, storage: { namespace: `caatuu-stats-${learnerId}` } },
      localStorageValues: storageValues,
    });
    class ControlledDate extends Date {
      constructor(...args) { super(...(args.length ? args : [clock.now])); }
      static now() { return clock.now; }
    }
    result.context.Date = ControlledDate;
    result.window.Date = ControlledDate;
    result.window.crypto = { randomUUID: () => `${learnerId}-receipt-${++sequence}` };
    result.window.navigator.locks = { request: async (_name, action) => action() };
    vm.runInContext(source, result.context, { filename: 'learning-profile.js' });
    return result;
  };
  browser = open();
  const advanceTo = at => {
    if (!Number.isFinite(at) || at < clock.now) throw new TypeError('Harness clock must move monotonically.');
    clock.now = at;
  };
  const flush = async () => {
    await browser.window.CaatuuLearning.retryPendingSaves();
    if (browser.window.CaatuuLearning.saveStatus().status !== 'saved') throw new Error('Real persistence did not save.');
  };
  return Object.freeze({
    advanceTo,
    async record(identity, { encounterId, correct = null, evidence = 'exposure', previousExposureAt }, at) {
      if (identity.courseId !== courseId) throw new TypeError('An encounter cannot cross the harness course boundary.');
      advanceTo(at);
      const event = { bankId: identity.bankId, itemId: identity.itemId, encounterId, correct, evidence,
        generation: browser.window.CaatuuLearning.contentGeneration() };
      if (previousExposureAt !== undefined) event.previousExposureAt = previousExposureAt;
      if (browser.window.CaatuuLearning.recordExposure(identity.gameId, event) === false) {
        throw new Error('The real profile rejected the scripted encounter.');
      }
      await flush();
    },
    history: (gameId, bankId) => copy(browser.window.CaatuuLearning.contentHistory(gameId, bankId)),
    saveStatus: () => copy(browser.window.CaatuuLearning.saveStatus()),
    async reload() {
      await flush();
      browser = open(browser.localStorage.snapshot());
      await flush();
    },
  });
}
