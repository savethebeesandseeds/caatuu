(() => {
  const nativeHost = "caatuu.local";
  const cachePrefix = "caatuu-czech-pwa-";
  const setupManifestPath = "setup-assets.json";
  const fallbackSetupCacheName = "caatuu-czech-setup-v1";
  const modelCatalogPath = "data/models/phone-bench/models.json";
  const embeddingCatalogPath = "data/embeddings/models.json";
  const webllmCdn = "https://esm.run/@mlc-ai/web-llm";
  const browserFallbackModel = "Qwen3-0.6B-q4f16_1-MLC";
  const nativePending = new Map();
  let activeBrowserSetupAbortController = null;
  let browserEngine = null;
  let browserEngineModelKey = "";

  function hasNativeBridge() {
    return Boolean(window.CaatuuAndroid && typeof window.CaatuuAndroid.postMessage === "function");
  }

  function isNativeShell() {
    return window.location.hostname === nativeHost || hasNativeBridge();
  }

  function isBrowserShell() {
    return !isNativeShell();
  }

  const env = isNativeShell() ? "android" : "browser";
  const capabilities = {
    nativeInstaller: env === "android",
    systemDownloads: env === "android",
    webGpu: env === "browser" && "gpu" in navigator,
    serviceWorker: env === "browser" && "serviceWorker" in navigator,
    browserVectorDb: env === "browser" && "caches" in window,
    androidVectorDb: env === "android",
    canUpdateApk: env === "android"
  };

  window.CaatuuNative = {
    receive(rawMessage) {
      const message = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
      const pending = nativePending.get(message.id);
      if (!pending) return;

      if (message.kind === "done") {
        nativePending.delete(message.id);
        pending.resolve(message.result || {});
        return;
      }

      if (message.kind === "error") {
        nativePending.delete(message.id);
        pending.reject(new Error(message.message || "Native Android runtime failed."));
        return;
      }

      if (pending.onEvent) pending.onEvent(message);
    }
  };

  function nativeCall(type, payload = {}, handlers = {}) {
    if (!hasNativeBridge()) {
      return Promise.reject(new Error("Native Android runtime is not available."));
    }

    const id = `native-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const request = { id, type, ...payload };
    const timeoutMs = Number(handlers.timeoutMs || 0);

    return new Promise((resolvePromise, rejectPromise) => {
      let timeoutId = null;
      const clearNativeTimeout = () => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
      };
      const resetNativeTimeout = () => {
        clearNativeTimeout();
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
        timeoutId = window.setTimeout(() => {
          nativePending.delete(id);
          rejectPromise(new Error(handlers.timeoutMessage || "Native Android runtime did not respond in time."));
        }, timeoutMs);
      };

      nativePending.set(id, {
        resolve(result) {
          clearNativeTimeout();
          resolvePromise(result);
        },
        reject(error) {
          clearNativeTimeout();
          rejectPromise(error);
        },
        onEvent(message) {
          if (handlers.resetTimeoutOnEvent !== false) resetNativeTimeout();
          if (handlers.onEvent) handlers.onEvent(message);
        }
      });

      try {
        resetNativeTimeout();
        window.CaatuuAndroid.postMessage(JSON.stringify(request));
      } catch (error) {
        clearNativeTimeout();
        nativePending.delete(id);
        rejectPromise(error);
      }
    });
  }

  async function clearNativeBrowserState() {
    if (!isNativeShell()) return;

    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
    } catch (error) {
      // Native cleanup is best-effort; Android also blocks service workers.
    }

    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((key) => key.startsWith(cachePrefix) || key.includes("caatuu"))
            .map((key) => caches.delete(key))
        );
      }
    } catch (error) {
      // CacheStorage may be unavailable in some WebView builds.
    }
  }

  async function fetchJson(path, options = {}) {
    const response = await fetch(path, options);
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    return response.json();
  }

  async function browserUpdateStatus() {
    try {
      const manifest = await fetchJson("/android/caatuu.json", { cache: "no-store" });
      const currentVersionCode = Number(manifest.version_code || 0);
      const currentVersionName = manifest.version_name || "";
      return {
        updateAvailable: false,
        currentVersionCode,
        currentVersionName,
        latestVersionCode: currentVersionCode,
        latestVersionName: currentVersionName,
        source: "served-manifest"
      };
    } catch (error) {
      return {
        updateAvailable: false,
        currentVersionCode: 0,
        currentVersionName: "",
        latestVersionCode: 0,
        latestVersionName: "",
        source: "fallback"
      };
    }
  }

  function browserArtifacts(manifest) {
    return Array.isArray(manifest?.artifacts)
      ? manifest.artifacts.filter((artifact) => artifact && artifact.browser_required && artifact.url)
      : [];
  }

  async function sha256Hex(buffer) {
    if (!crypto?.subtle) return "";
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function browserArtifactStatus(cache, artifact) {
    const cached = await cache.match(artifact.url);
    const expectedBytes = Number(artifact.bytes || 0);
    if (!cached) {
      return {
        key: artifact.key,
        label: artifact.label,
        kind: artifact.artifact_kind,
        url: artifact.url,
        expectedBytes,
        sha256: artifact.sha256 || "",
        bytes: 0,
        ready: false,
        verified: false
      };
    }

    const buffer = await cached.clone().arrayBuffer();
    const bytes = buffer.byteLength;
    const hash = artifact.sha256 ? await sha256Hex(buffer) : "";
    const verified = bytes === (expectedBytes || bytes) && (!artifact.sha256 || hash === artifact.sha256);
    return {
      key: artifact.key,
      label: artifact.label,
      kind: artifact.artifact_kind,
      url: artifact.url,
      expectedBytes: expectedBytes || bytes,
      sha256: artifact.sha256 || "",
      bytes,
      ready: verified,
      verified
    };
  }

  async function browserSetupStatus(manifest = null) {
    const setupManifest = manifest || await fetchJson(setupManifestPath, { cache: "reload" });
    const artifacts = browserArtifacts(setupManifest);
    const cache = await caches.open(setupManifest.cache_name || fallbackSetupCacheName);
    const statuses = [];
    for (const artifact of artifacts) {
      statuses.push(await browserArtifactStatus(cache, artifact));
    }
    const readyArtifacts = statuses.filter((item) => item.ready).length;
    return {
      ready: readyArtifacts === statuses.length,
      readyArtifacts,
      artifactCount: statuses.length,
      bytes: statuses.reduce((sum, item) => sum + Number(item.bytes || 0), 0),
      expectedBytes: statuses.reduce((sum, item) => sum + Number(item.expectedBytes || 0), 0),
      staticAssets: { assets: statuses }
    };
  }

  async function readResponseBytes(response, expectedBytes, onProgress) {
    if (!response.body?.getReader) {
      const buffer = await response.arrayBuffer();
      onProgress(buffer.byteLength, expectedBytes || buffer.byteLength);
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
      onProgress(bytes, expectedBytes || bytes);
    }
    const merged = new Uint8Array(bytes);
    let offset = 0;
    chunks.forEach((chunk) => {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return merged.buffer;
  }

  async function cacheBrowserArtifact(cache, artifact, index, artifactCount, onEvent) {
    activeBrowserSetupAbortController = new AbortController();
    const response = await fetch(artifact.url, {
      cache: "reload",
      signal: activeBrowserSetupAbortController.signal
    });
    if (!response.ok) throw new Error(`Could not download ${artifact.label || artifact.url}: ${response.status}`);
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const expectedBytes = Number(artifact.bytes || response.headers.get("content-length") || 0);
    const buffer = await readResponseBytes(response, expectedBytes, (bytes, totalBytes) => {
      onEvent?.({
        kind: "progress",
        phase: "browser_download",
        label: artifact.label || "Artifact",
        artifactKey: artifact.key || artifact.url,
        artifactKind: artifact.artifact_kind || "browser-artifact",
        artifactIndex: index,
        artifactCount,
        bytes,
        totalBytes
      });
    });
    const bytes = buffer.byteLength;
    if (artifact.bytes && bytes !== Number(artifact.bytes)) {
      throw new Error(`${artifact.label || artifact.url} size mismatch: expected ${artifact.bytes}, got ${bytes}`);
    }
    if (artifact.sha256) {
      const hash = await sha256Hex(buffer);
      if (hash && hash !== artifact.sha256) throw new Error(`${artifact.label || artifact.url} SHA-256 mismatch.`);
    }
    await cache.put(
      artifact.url,
      new Response(buffer, {
        headers: {
          "content-type": contentType,
          "content-length": String(bytes),
          "x-caatuu-setup-sha256": artifact.sha256 || ""
        }
      })
    );
    onEvent?.({
      kind: "status",
      phase: "browser_cached",
      label: artifact.label || "Artifact",
      artifactKey: artifact.key || artifact.url,
      message: `${artifact.label || "Artifact"} is cached.`
    });
  }

  async function startBrowserSetup(handlers = {}) {
    if (!("caches" in window)) throw new Error("This browser cannot keep the setup cache.");
    const manifest = await fetchJson(setupManifestPath, { cache: "reload" });
    const artifacts = browserArtifacts(manifest);
    const cache = await caches.open(manifest.cache_name || fallbackSetupCacheName);
    for (let index = 0; index < artifacts.length; index += 1) {
      const artifact = artifacts[index];
      const status = await browserArtifactStatus(cache, artifact);
      if (status.ready) {
        handlers.onEvent?.({
          kind: "status",
          phase: "browser_cached",
          label: artifact.label || "Artifact",
          artifactKey: artifact.key || artifact.url,
          artifactIndex: index + 1,
          artifactCount: artifacts.length,
          message: `${artifact.label || "Artifact"} is already cached.`
        });
        continue;
      }
      await cacheBrowserArtifact(cache, artifact, index + 1, artifacts.length, handlers.onEvent);
    }
    activeBrowserSetupAbortController = null;
    return browserSetupStatus(manifest);
  }

  async function abortBrowserSetup() {
    activeBrowserSetupAbortController?.abort();
    activeBrowserSetupAbortController = null;
    return browserSetupStatus();
  }

  async function registerServiceWorker() {
    if (!capabilities.serviceWorker) return false;
    try {
      await navigator.serviceWorker.register("sw.js");
      return true;
    } catch (error) {
      return false;
    }
  }

  function shouldClearCacheName(name) {
    return /caatuu-czech|webllm|mlc|tvm|wasm|model/i.test(name);
  }

  function deleteIndexedDatabase(name) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (deleted, reason = "") => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve({ name, deleted, reason });
      };
      const timer = window.setTimeout(() => settle(false, "timeout"), 2000);
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => settle(true);
      request.onerror = () => settle(false, request.error?.message || "error");
      request.onblocked = () => settle(false, "blocked");
    });
  }

  async function clearBrowserCache() {
    await unloadBrowserModel();
    const result = {
      storageScope: "browser origin cache",
      cacheNamesDeleted: [],
      databasesDeleted: [],
      bytesBefore: null,
      bytesAfter: null
    };

    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      result.bytesBefore = estimate.usage || 0;
    }

    if ("caches" in window) {
      const cacheNames = await caches.keys();
      const deleteNames = cacheNames.filter((name) => shouldClearCacheName(name));
      await Promise.all(deleteNames.map(async (name) => {
        if (await caches.delete(name)) result.cacheNamesDeleted.push(name);
      }));
    }

    if (window.indexedDB && typeof indexedDB.databases === "function") {
      const databases = await indexedDB.databases();
      const deleteDatabases = databases
        .map((database) => database.name)
        .filter(Boolean)
        .filter((name) => shouldClearCacheName(name));
      const databaseResults = await Promise.all(deleteDatabases.map(deleteIndexedDatabase));
      result.databasesDeleted = databaseResults.filter((item) => item.deleted).map((item) => item.name);
      result.databasesSkipped = databaseResults.filter((item) => !item.deleted);
    }

    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      result.bytesAfter = estimate.usage || 0;
      result.bytesDeleted = Math.max(0, result.bytesBefore - result.bytesAfter);
    }

    return result;
  }

  async function updateBrowserServiceWorker() {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update().catch(() => {})));
    }
    window.location.reload();
    return { updateAvailable: false, reloaded: true };
  }

  async function loadModelCatalog() {
    return fetchJson(modelCatalogPath);
  }

  async function loadEmbeddingCatalog() {
    return fetchJson(embeddingCatalogPath);
  }

  function browserModelStatus(extra = {}) {
    return {
      runtime: "browser-webgpu",
      modelKey: browserFallbackModel,
      defaultModelKey: browserFallbackModel,
      label: "Browser fallback",
      shortLabel: "Browser",
      loaded: Boolean(browserEngine),
      downloaded: capabilities.webGpu,
      verified: capabilities.webGpu,
      ...extra
    };
  }

  async function loadBrowserModel(_modelKey, handlers = {}) {
    if (!capabilities.webGpu) {
      throw new Error("WebGPU is not available in this browser.");
    }
    if (browserEngine && browserEngineModelKey === browserFallbackModel) {
      return browserModelStatus({ loaded: true });
    }

    await unloadBrowserModel();
    const webllm = await import(webllmCdn);
    browserEngine = await webllm.CreateMLCEngine(browserFallbackModel, {
      initProgressCallback(progress) {
        const percent = Number.isFinite(progress?.progress) ? progress.progress * 100 : null;
        const text = progress?.text || "Loading";
        handlers.onEvent?.({
          kind: "progress",
          phase: "browser_model_load",
          runtime: "browser-webgpu",
          modelKey: browserFallbackModel,
          progress: percent,
          text,
          message: text
        });
      }
    });
    browserEngineModelKey = browserFallbackModel;
    return browserModelStatus({ loaded: true });
  }

  async function unloadBrowserModel() {
    const engine = browserEngine;
    browserEngine = null;
    browserEngineModelKey = "";
    if (!engine) return { runtime: "browser-webgpu", unloaded: false };

    try {
      if (typeof engine.unload === "function") {
        await engine.unload();
      } else if (typeof engine.dispose === "function") {
        await engine.dispose();
      }
    } catch (error) {
      return { runtime: "browser-webgpu", unloaded: false, error: error?.message || String(error) };
    }
    return { runtime: "browser-webgpu", unloaded: true };
  }

  function isAsyncIterable(value) {
    return value && typeof value[Symbol.asyncIterator] === "function";
  }

  function stringifyCompletionContent(content) {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((part) => stringifyCompletionContent(part?.text || part?.content || part)).join("");
    }
    return String(content);
  }

  function completionChunkDelta(chunk) {
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    return stringifyCompletionContent(delta.content || delta.reasoning_content || "");
  }

  function completionContent(response) {
    const choice = response?.choices?.[0];
    return stringifyCompletionContent(choice?.message?.content || choice?.text || response?.message?.content || "");
  }

  async function readBrowserEngineMessage() {
    if (!browserEngine || typeof browserEngine.getMessage !== "function") return "";
    try {
      return stringifyCompletionContent(await browserEngine.getMessage());
    } catch (error) {
      return "";
    }
  }

  function browserCompletionRequest(request) {
    const options = request.options || {};
    const maxTokens = Number(request.max_tokens ?? request.maxTokens ?? options.max_tokens ?? options.maxTokens ?? 256);
    const temperature = Number(request.temperature ?? options.temperature ?? 0.7);
    return {
      model: browserFallbackModel,
      messages: Array.isArray(request.messages)
        ? request.messages
        : [{ role: "user", content: String(request.prompt || "") }],
      temperature: Number.isFinite(temperature) ? temperature : 0.7,
      max_tokens: Number.isFinite(maxTokens) ? maxTokens : 256,
      extra_body: request.extra_body || { enable_thinking: Boolean(options.thinking) }
    };
  }

  async function generateBrowser(request = {}, handlers = {}) {
    if (!browserEngine) await loadBrowserModel(browserFallbackModel, handlers);
    if (!browserEngine) throw new Error("Browser WebLLM runtime is not loaded.");

    const completionRequest = browserCompletionRequest(request);
    const streamingRequest = { ...completionRequest, stream: true };
    let output = "";

    try {
      const response = await browserEngine.chat.completions.create(streamingRequest);
      if (isAsyncIterable(response)) {
        for await (const chunk of response) {
          const token = completionChunkDelta(chunk);
          if (!token) continue;
          output += token;
          handlers.onEvent?.({ kind: "token", token });
        }
        const engineMessage = await readBrowserEngineMessage();
        if (engineMessage) output = engineMessage;
      } else {
        output = completionContent(response);
      }
    } catch (streamError) {
      handlers.onEvent?.({
        kind: "status",
        phase: "browser_stream_fallback",
        message: "Streaming unavailable. Finishing response."
      });
      const response = await browserEngine.chat.completions.create(completionRequest);
      output = completionContent(response);
    }

    return {
      runtime: "browser-webgpu",
      modelKey: browserFallbackModel,
      output: output || "(empty output)",
      settings: {
        temperature: completionRequest.temperature,
        max_tokens: completionRequest.max_tokens,
        extra_body: completionRequest.extra_body
      }
    };
  }

  window.CaatuuRuntime = {
    env,
    capabilities,
    isNativeShell,
    isBrowserShell,
    clearNativeBrowserState,
    nativeCall,
    fetchJson,
    registerServiceWorker,
    setup: {
      status() {
        return env === "android" ? nativeCall("setup_status") : browserSetupStatus();
      },
      start(handlers = {}) {
        return env === "android" ? nativeCall("setup_download", {}, handlers) : startBrowserSetup(handlers);
      },
      abort() {
        return env === "android" ? nativeCall("setup_abort") : abortBrowserSetup();
      }
    },
    models: {
      catalog: loadModelCatalog,
      embeddingCatalog: loadEmbeddingCatalog,
      status(modelKey) {
        if (env === "android") return nativeCall("status", { modelKey });
        return Promise.resolve(browserModelStatus());
      },
      load(modelKey, handlers = {}) {
        if (env === "android") return nativeCall("load", { modelKey }, handlers);
        return loadBrowserModel(modelKey, handlers);
      },
      startDownload(modelKey, handlers = {}) {
        if (env === "android") return nativeCall("start_download", { modelKey }, handlers);
        return Promise.resolve({ runtime: "browser-webgpu", modelKey: browserFallbackModel, downloaded: capabilities.webGpu });
      },
      unload() {
        return env === "android" ? Promise.resolve({ runtime: "android", unloaded: false }) : unloadBrowserModel();
      },
      generate(request = {}, handlers = {}) {
        return env === "android" ? nativeCall("prompt", request, handlers) : generateBrowser(request, handlers);
      }
    },
    vector: {
      status() {
        return env === "android" ? nativeCall("vector_status") : Promise.resolve({ runtime: "browser-vector-db" });
      },
      search(text, options = {}) {
        if (env === "android") {
          return nativeCall("vector_search", {
            text,
            limit: options.limit
          });
        }
        return Promise.reject(new Error("Browser vector search is not wired into the UI yet."));
      }
    },
    maintenance: {
      updateStatus() {
        return env === "android"
          ? nativeCall("update_app_status")
          : browserUpdateStatus();
      },
      updateApp(handlers = {}) {
        return env === "android" ? nativeCall("update_app", {}, handlers) : updateBrowserServiceWorker();
      },
      clearCache(handlers = {}) {
        return env === "android" ? nativeCall("clear_cache", {}, handlers) : clearBrowserCache();
      },
      async cacheStatus() {
        if (!("caches" in window)) return { available: false, cacheNames: [] };
        return { available: true, cacheNames: await caches.keys() };
      },
      deleteLocalPack(handlers = {}) {
        return env === "android"
          ? nativeCall("delete_model", {}, handlers)
          : clearBrowserCache();
      }
    }
  };

  clearNativeBrowserState();
})();
