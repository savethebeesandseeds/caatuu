const CACHE_NAME = "caatuu-czech-pwa-v22";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./app.css?v=visual-refresh-2",
  "./app.js?v=visual-refresh-2",
  "./device-ai.html",
  "./device-ai.css?v=phone-2",
  "./device-ai.js?v=phone-3",
  "./manifest.webmanifest",
  "./icons/caatuu-czech.svg",
  "./data/dictionary.json",
  "./data/scripts.json",
  "./data/verbs.json",
  "./data/models/models.json",
  "./data/models/export-spec.json",
  "./data/models/benchmarks/base-qwen3-1.7b.json",
  "./data/models/benchmarks/czech-language-benchmark-qwen3-1.7b-lora-003-hard.json",
  "./data/models/benchmarks/czech-language-benchmark-qwen3-1.7b-lora-003-hard.md",
  "./data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/export-manifest.json",
  "./data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/webllm/Caatuu-Czech-Qwen3-1.7B-q4f16_1-MLC-003/resolve/caatuu-v1/finalize-report.json",
  "./data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/webllm/Caatuu-Czech-Qwen3-1.7B-q4f16_1-MLC-003/resolve/caatuu-v1/mlc-chat-config.json",
  "./data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/webllm/Caatuu-Czech-Qwen3-1.7B-q4f16_1-MLC-003/resolve/caatuu-v1/tensor-cache.json",
  "./data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/webllm/Caatuu-Czech-Qwen3-1.7B-q4f16_1-MLC-003/resolve/caatuu-v1/added_tokens.json",
  "./data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/webllm/Caatuu-Czech-Qwen3-1.7B-q4f16_1-MLC-003/resolve/caatuu-v1/chat_template.jinja",
  "./data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/webllm/Caatuu-Czech-Qwen3-1.7B-q4f16_1-MLC-003/resolve/caatuu-v1/merges.txt",
  "./data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/webllm/Caatuu-Czech-Qwen3-1.7B-q4f16_1-MLC-003/resolve/caatuu-v1/special_tokens_map.json",
  "./data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/webllm/Caatuu-Czech-Qwen3-1.7B-q4f16_1-MLC-003/resolve/caatuu-v1/tokenizer.json",
  "./data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/webllm/Caatuu-Czech-Qwen3-1.7B-q4f16_1-MLC-003/resolve/caatuu-v1/tokenizer_config.json",
  "./data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/webllm/Caatuu-Czech-Qwen3-1.7B-q4f16_1-MLC-003/resolve/caatuu-v1/vocab.json",
  "./data/models/czech-finetuned/runs/qwen3-1.7b-lora-003-hard/training-run.json",
  "./data/models/czech-finetuned/runs/qwen3-1.7b-lora-003-hard/adapter/adapter_config.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin === location.origin) {
    if (request.mode === "navigate" || ["document", "script", "style"].includes(request.destination)) {
      event.respondWith(networkThenCache(request));
      return;
    }
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isModelRuntimeRequest(url)) {
    event.respondWith(networkThenCache(request));
  }
});

function isModelRuntimeRequest(url) {
  return [
    "huggingface.co",
    "cdn.jsdelivr.net",
    "esm.run",
    "raw.githubusercontent.com",
    "github.com"
  ].some((host) => url.hostname.endsWith(host));
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await cacheResponse(request, response);
  return response;
}

async function networkThenCache(request) {
  try {
    const response = await fetch(request);
    await cacheResponse(request, response);
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheResponse(request, response) {
  if (!response || (response.status !== 200 && response.type !== "opaque")) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}
