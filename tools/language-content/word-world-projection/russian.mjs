import { RUSSIAN_CONTENT_POLICY_ID } from '../policies/russian.mjs';
import { defineAuthoredWordWorldProjectionPolicy } from './authored.mjs';

export const russianWordWorldProjectionPolicy = defineAuthoredWordWorldProjectionPolicy({
  id: 'russian-word-world-v1', contentPolicyId: RUSSIAN_CONTENT_POLICY_ID,
  speechEnabled: true,
  defaultPaths: {
    conceptsSource: 'apps/languages/shared/english-concepts/word-world-ru-v1.json',
    realizationsSource: 'apps/languages/russian/content/word-world/starter-v1.realizations.json',
    conceptsRuntime: 'apps/language-runtime/static/data/english-concepts/word-world-ru-v1.json',
    realizationsRuntime: 'apps/languages/russian/static/data/games/word-world/content.json',
    manifest: 'apps/languages/russian/static/data/games/word-world/manifest.json'
  },
  pronunciationNote: 'Modern Russian in Cyrillic. Device speech uses the shared browser/Android provider; independent native and pronunciation review remain pending.'
});
