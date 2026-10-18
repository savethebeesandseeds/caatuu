import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGLISH_MINILM_RUNTIME,
  EnglishMiniLmRanker,
  createEnglishMiniLmRanker,
  validateEnglishEmbeddingPayload
} from "../static/source/english-minilm-ranker.mjs";

const DIMENSION = 384;

function unitVector(index, secondIndex = null, secondWeight = 0) {
  const vector = new Float32Array(DIMENSION);
  vector[index] = 1;
  if (secondIndex !== null) vector[secondIndex] = secondWeight;
  return vector;
}

function tensor(vectors) {
  const data = new Float32Array(vectors.length * DIMENSION);
  vectors.forEach((vector, index) => data.set(vector, index * DIMENSION));
  return { dims: [vectors.length, DIMENSION], data };
}

function payload(query = "Find a book", candidates = [
  { conceptId: "ww.object.book", embeddingText: "Identifying a nearby object as a book." },
  { conceptId: "ww.animal.cat", embeddingText: "Identifying an animal as a cat." }
]) {
  return {
    inputLanguage: "en",
    query: { embeddingText: query },
    candidates
  };
}

test("the ranker scores normalized MiniLM vectors and caches candidate embeddings", async () => {
  const batches = [];
  const vectorsByText = new Map([
    ["Find a book", unitVector(0)],
    ["Find a cat", unitVector(1)],
    ["Identifying a nearby object as a book.", unitVector(0)],
    ["Identifying an animal as a cat.", unitVector(1)]
  ]);
  const ranker = createEnglishMiniLmRanker({
    extractor: async (texts, options) => {
      batches.push({ texts: texts.slice(), options });
      return tensor(texts.map((text) => vectorsByText.get(text)));
    }
  });

  const bookScores = await ranker(payload());
  const catScores = await ranker(payload("Find a cat"));
  assert.deepEqual(bookScores.map(({ conceptId }) => conceptId), ["ww.object.book", "ww.animal.cat"]);
  assert.ok(bookScores[0].score > bookScores[1].score);
  assert.ok(catScores[1].score > catScores[0].score);
  assert.deepEqual(batches.map(({ texts }) => texts), [
    [
      "Find a book",
      "Identifying a nearby object as a book.",
      "Identifying an animal as a cat."
    ],
    ["Find a cat"]
  ]);
  assert.deepEqual(batches[0].options, { pooling: "mean", normalize: true });
  assert.ok(ranker.runtime instanceof EnglishMiniLmRanker);
});

test("changed candidate text cannot reuse a stale cached vector", async () => {
  const batches = [];
  const ranker = new EnglishMiniLmRanker({
    extractor: async (texts) => {
      batches.push(texts.slice());
      return tensor(texts.map((text) => text.includes("library") ? unitVector(1) : unitVector(0)));
    }
  });
  await ranker.rank(payload("Find a book", [
    { conceptId: "ww.object.book", embeddingText: "A nearby book." }
  ]));
  await ranker.rank(payload("Find a book", [
    { conceptId: "ww.object.book", embeddingText: "A library shelf." }
  ]));
  assert.deepEqual(batches, [
    ["Find a book", "A nearby book."],
    ["Find a book", "A library shelf."]
  ]);
});

test("authored English loanwords reach the encoder with their accents intact", async () => {
  const batches = [];
  const ranker = createEnglishMiniLmRanker({
    extractor: async (texts) => {
      batches.push(texts.slice());
      return tensor(texts.map(() => unitVector(0)));
    }
  });
  const query = "Meet at the small café.";
  const candidates = [
    { conceptId: "ww.place.cafe", embeddingText: "A naïve student visits a small café." },
    { conceptId: "ww.object.pinata", embeddingText: "A party with a piñata." }
  ];
  await ranker(payload(query, candidates));
  assert.deepEqual(batches, [[query, ...candidates.map(candidate => candidate.embeddingText)]]);
});

test("English loanwords retain NFKC normalization without losing diacritics", () => {
  const safe = validateEnglishEmbeddingPayload(payload("  small cafe\u0301  ", [
    { conceptId: "ww.place.cafe", embeddingText: "A nai\u0308ve student at the cafe\u0301." }
  ]));
  assert.equal(safe.query.embeddingText, "small café");
  assert.equal(safe.candidates[0].embeddingText, "A naïve student at the café.");
});

test("non-contract fields and target-language text are rejected before model execution", async () => {
  let modelCalls = 0;
  const ranker = createEnglishMiniLmRanker({
    extractor: async () => {
      modelCalls += 1;
      return tensor([unitVector(0)]);
    }
  });
  const invalidPayloads = [
    { ...payload(), targetText: "书" },
    { ...payload(), inputLanguage: "zh-Hans" },
    { ...payload(), query: { embeddingText: "book", targetText: "书" } },
    payload("找书"),
    payload("Find a book", [{
      conceptId: "ww.object.book",
      embeddingText: "Find a book.",
      pinyin: "shū"
    }]),
    payload("Find a book", [{ conceptId: "ww.object.book", embeddingText: "Česká kniha" }])
  ];
  for (const invalid of invalidPayloads) await assert.rejects(() => ranker(invalid), /English|only|inputLanguage/u);
  assert.equal(modelCalls, 0);
});

test("loanword support still rejects other scripts and extended Latin letters before encoding", async () => {
  let modelCalls = 0;
  const ranker = createEnglishMiniLmRanker({
    extractor: async () => {
      modelCalls += 1;
      return tensor([unitVector(0)]);
    }
  });
  for (const text of ["Find 书", "Find كتاب", "Find книга", "Find Česká kniha", "Find a cǎfe"]) {
    await assert.rejects(() => ranker(payload(text)), /English-only/u);
    await assert.rejects(() => ranker(payload("Find a café", [
      { conceptId: "ww.place.cafe", embeddingText: text }
    ])), /English-only/u);
  }
  for (const text of ["é", "àéï", "123"]) {
    assert.throws(() => validateEnglishEmbeddingPayload(payload(text)), /authored English/u);
  }
  assert.equal(modelCalls, 0);
});

test("payload validation returns only the English ranker contract", () => {
  const safe = validateEnglishEmbeddingPayload(payload());
  assert.deepEqual(JSON.parse(JSON.stringify(safe)), payload());
  assert.ok(Object.isFrozen(safe));
  assert.ok(Object.isFrozen(safe.query));
  assert.ok(Object.isFrozen(safe.candidates));
});

test("the default loader pins local qint8 MiniLM and disables remote models", async () => {
  const env = { backends: { onnx: { wasm: {} } } };
  const imported = [];
  const pipelineCalls = [];
  const ranker = new EnglishMiniLmRanker({
    importModule: async (url) => {
      imported.push(url);
      return {
        env,
        pipeline: async (...args) => {
          pipelineCalls.push(args);
          return async (texts) => tensor(texts.map(() => unitVector(0)));
        }
      };
    }
  });
  await ranker.rank(payload("Find a book", [
    { conceptId: "ww.object.book", embeddingText: "A nearby book." }
  ]));

  assert.equal(imported.length, 1);
  assert.match(imported[0], /\/language-runtime\/vendor\/transformers\/transformers\.min\.js$/u);
  assert.equal(env.allowRemoteModels, false);
  assert.equal(env.allowLocalModels, true);
  assert.equal(env.localModelPath, "/language-runtime/models/");
  assert.equal(env.backends.onnx.wasm.numThreads, 1);
  assert.equal(env.backends.onnx.wasm.proxy, false);
  assert.match(env.backends.onnx.wasm.wasmPaths.mjs, /ort-wasm-simd-threaded\.mjs$/u);
  assert.match(env.backends.onnx.wasm.wasmPaths.wasm, /ort-wasm-simd-threaded\.wasm$/u);
  assert.deepEqual(pipelineCalls, [[
    "feature-extraction",
    ENGLISH_MINILM_RUNTIME.modelId,
    {
      dtype: "fp32",
      model_file_name: ENGLISH_MINILM_RUNTIME.modelFileName,
      local_files_only: true
    }
  ]]);
});

test("unexpected model output is rejected instead of producing invalid scores", async () => {
  const ranker = createEnglishMiniLmRanker({
    extractor: async (texts) => ({ dims: [texts.length, 32], data: new Float32Array(texts.length * 32) })
  });
  await assert.rejects(() => ranker(payload()), /Unexpected MiniLM embedding shape/u);
});
