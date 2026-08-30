import { defineSemanticIndexConfig } from "../src/contract.mjs";
import { MANDARIN_SIMPLIFIED_CONTENT_POLICY_ID } from "../../language-content/policies/mandarin-simplified.mjs";

// The content adapter maps authored `embeddingText` to the generic builder's
// `english_text` boundary. Target text, generic pronunciation metadata, tokens,
// and review metadata are stored only in the separate target-realization overlay.
const semanticIndexConfig = defineSemanticIndexConfig({
  indexId: "zh-word-world-v1",
  courseId: "zh",
  target: {
    locale: "zh-Hans",
    textField: "target_text",
    pronunciationField: "pronunciation"
  },
  record: {
    idField: "id",
    semanticMetadataFields: [
      "english_display_text",
      "scene_query",
      "topic",
      "difficulty"
    ],
    linguisticMetadataFields: ["tokens"],
    reviewMetadataFields: [
      "content_review",
      "content_license",
      "source_license"
    ]
  },
  storage: {
    repositoryRoot: "apps/languages/mandarin-simplified/static/data/embeddings",
    routeRoot: "/zh/data/embeddings",
    manifestUrlRoot: "data/embeddings",
    databaseFile: "caatuu-zh-curriculum.sqlite"
  }
});

export const mandarinSimplifiedSemanticIndexConfig = Object.freeze({
  ...semanticIndexConfig,
  contentPolicy: MANDARIN_SIMPLIFIED_CONTENT_POLICY_ID
});
