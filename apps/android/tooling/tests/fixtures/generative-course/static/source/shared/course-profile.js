globalThis.CaatuuCourse = Object.freeze({
  schemaVersion: 1,
  id: "fixture-gen",
  routePrefix: "/fixture-gen",
  entryPath: "/fixture-gen/index.html",
  routes: {
    home: "index.html",
    chat: "chat.html",
    audioLab: "audio-lab.html",
    embeddingImages: "embedding-images.html",
    wordWorld: "index.html?game=word-net",
    settings: "index.html"
  },
  storage: {
    namespace: "caatuu-fixture-gen",
    chatSettings: "caatuu-fixture-gen.chat.settings.v1",
    wordWorldRecentSentences: "caatuu-fixture-gen.word-world.recent-sentences.v1"
  },
  capabilities: Object.freeze({
    llm: true,
    generation: true,
    chat: true,
    embeddings: false,
    semanticSearch: false,
    dictionary: false,
    memory: true,
    verbs: false,
    wordWorld: true,
    conjugationComet: false,
    offlineModels: true,
    speech: false,
    pronunciationGuides: false
  }),
  platforms: {
    browser: {
      enabled: true,
      entryPath: "/fixture-gen/index.html"
    },
    android: {
      enabled: true,
      channels: [
        {
          kind: "preview",
          manifest: "/android/fixture-gen-preview.json"
        }
      ]
    }
  }
});
