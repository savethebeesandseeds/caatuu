import { GEORGIAN_CONTENT_POLICY_ID } from '../policies/georgian.mjs';
import { defineAuthoredWordWorldProjectionPolicy } from './authored.mjs';

export const georgianWordWorldProjectionPolicy = defineAuthoredWordWorldProjectionPolicy({
  id: 'georgian-word-world-v1', contentPolicyId: GEORGIAN_CONTENT_POLICY_ID,
  speechEnabled: true,
  defaultPaths: {
    conceptsSource: 'apps/languages/shared/english-concepts/word-world-ka-v1.json',
    realizationsSource: 'apps/languages/georgian/content/word-world/starter-v1.realizations.json',
    conceptsRuntime: 'apps/language-runtime/static/data/english-concepts/word-world-ka-v1.json',
    realizationsRuntime: 'apps/languages/georgian/static/data/games/word-world/content.json',
    manifest: 'apps/languages/georgian/static/data/games/word-world/manifest.json'
  },
  pronunciationNote: 'Modern Standard Georgian in Mkhedruli. Device speech uses the shared browser/Android provider; independent native and pronunciation review remain pending.'
});
