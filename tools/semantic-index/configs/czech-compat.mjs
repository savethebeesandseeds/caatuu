import { defineSemanticIndexConfig } from "../src/contract.mjs";

export const czechSemanticIndexConfig = defineSemanticIndexConfig({
  indexId: "czech-curriculum-v1",
  courseId: "czech",
  target: {
    locale: "cs",
    textField: "czech_text",
    pronunciationField: null,
  },
  record: {
    idField: "id",
    semanticMetadataFields: [
      "difficulty",
      "cefr",
      "age_band",
      "topic",
      "target_words",
      "grammar_tags",
      "child_safe",
      "modern_english",
      "concrete",
      "context_independent",
      "naturalness_score",
      "simplicity_score"
    ],
    linguisticMetadataFields: [],
    reviewMetadataFields: [],
  },
  storage: {
    repositoryRoot: "apps/languages/czech/static/data/embeddings",
    routeRoot: "/cz/data/embeddings",
    manifestUrlRoot: "data/embeddings",
    databaseFile: "caatuu-cz-curriculum.sqlite",
  },
  compatibility: {
    publishedSchema: {
      name: "caatuu-cz-vector-db",
      version: 1,
    },
  },
});
