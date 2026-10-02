import { LATIN_SCIENTIFIC_CONTENT_POLICY_ID } from "../policies/latin-scientific.mjs";
import { defineAuthoredWordWorldProjectionPolicy } from "./authored.mjs";

export const latinScientificWordWorldProjectionPolicy = defineAuthoredWordWorldProjectionPolicy({
  id: "latin-scientific-word-world-v1", contentPolicyId: LATIN_SCIENTIFIC_CONTENT_POLICY_ID,
  speechEnabled: false,
  defaultPaths: {
    conceptsSource: "apps/languages/shared/english-concepts/word-world-la-v1.json",
    realizationsSource: "apps/languages/latin-scientific/content/word-world/starter-v1.realizations.json",
    conceptsRuntime: "apps/language-runtime/static/data/english-concepts/word-world-la-v1.json",
    realizationsRuntime: "apps/languages/latin-scientific/static/data/games/word-world/content.json",
    manifest: "apps/languages/latin-scientific/static/data/games/word-world/manifest.json"
  },
  pronunciationNote: "Scientific Neo-Latin with pedagogical macrons. Qualified Latinist review remains pending; no approved audio or pronunciation guide is claimed."
});
