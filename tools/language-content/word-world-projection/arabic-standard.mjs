import { ARABIC_STANDARD_CONTENT_POLICY_ID } from "../policies/arabic-standard.mjs";
import { defineAuthoredWordWorldProjectionPolicy } from "./authored.mjs";

export const arabicStandardWordWorldProjectionPolicy = defineAuthoredWordWorldProjectionPolicy({
  id: "arabic-standard-word-world-v1", contentPolicyId: ARABIC_STANDARD_CONTENT_POLICY_ID,
  defaultPaths: {
    conceptsSource: "apps/languages/shared/english-concepts/word-world-ar-v1.json",
    realizationsSource: "apps/languages/arabic-standard/content/word-world/starter-v1.realizations.json",
    conceptsRuntime: "apps/language-runtime/static/data/english-concepts/word-world-ar-v1.json",
    realizationsRuntime: "apps/languages/arabic-standard/static/data/games/word-world/content.json",
    manifest: "apps/languages/arabic-standard/static/data/games/word-world/manifest.json"
  },
  pronunciationNote: "Modern Standard Arabic has no approved authored pronunciation guide; Arabic orthographic vowel marks remain part of the target text."
});
