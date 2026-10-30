import { HEBREW_CONTENT_POLICY_ID } from '../policies/hebrew.mjs';
import { defineAuthoredWordWorldProjectionPolicy } from './authored.mjs';

export const hebrewWordWorldProjectionPolicy = defineAuthoredWordWorldProjectionPolicy({
  id: 'hebrew-word-world-v1', contentPolicyId: HEBREW_CONTENT_POLICY_ID,
  speechEnabled: true,
  defaultPaths: {
    conceptsSource: 'apps/languages/shared/english-concepts/word-world-he-v1.json',
    realizationsSource: 'apps/languages/hebrew/content/word-world/starter-v1.realizations.json',
    conceptsRuntime: 'apps/language-runtime/static/data/english-concepts/word-world-he-v1.json',
    realizationsRuntime: 'apps/languages/hebrew/static/data/games/word-world/content.json',
    manifest: 'apps/languages/hebrew/static/data/games/word-world/manifest.json'
  },
  pronunciationNote: 'Modern Hebrew in pointed Hebrew script. Device speech uses the shared browser/Android provider; independent native and pronunciation review remain pending.'
});
