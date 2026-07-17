(() => {
  const course = window.CaatuuCourse;
  if (!course) throw new Error("Caatuu course profile must load before the runtime adapter.");

  const nativeHost = "caatuu.local";
  const cachePrefix = course.cache.prefix;
  const setupManifestPath = "setup-assets.json";
  const bugReportPath = "/api/bug-report";
  const fallbackSetupCacheName = course.cache.setupFallback;
  const modelCatalogPath = "data/models/phone-bench/models.json";
  const embeddingCatalogPath = "data/embeddings/models.json";
  const webllmCdn = "https://esm.run/@mlc-ai/web-llm";
  const browserFallbackModel = "Qwen3-0.6B-q4f16_1-MLC";
  const nativePending = new Map();
  let activeBrowserSetupAbortController = null;
  let browserSetupGeneration = 0;
  let browserEngine = null;
  let browserEngineModelKey = "";
  let browserModelLoad = null;
  let browserVectorDatabase = null;
  let feedbackOutbox = null;
  let feedbackOutboxPromise = null;
  let feedbackFlushTimer = null;

  function hasNativeBridge() {
    return Boolean(window.CaatuuAndroid && typeof window.CaatuuAndroid.postMessage === "function");
  }

  function isNativeShell() {
    return window.location.hostname === nativeHost || hasNativeBridge();
  }

  function isBrowserShell() {
    return !isNativeShell();
  }

  function setNativeSystemTheme(theme) {
    const normalizedTheme = theme === "light" ? "light" : "dark";
    try {
      if (typeof window.CaatuuAndroid?.setTheme !== "function") return false;
      window.CaatuuAndroid.setTheme(normalizedTheme);
      return true;
    } catch (error) {
      // Browser previews and older APKs do not expose the system-theme hook.
      return false;
    }
  }

  const env = isNativeShell() ? "android" : "browser";
  const capabilities = {
    nativeInstaller: env === "android",
    systemDownloads: env === "android",
    webGpu: env === "browser" && "gpu" in navigator,
    serviceWorker: env === "browser" && "serviceWorker" in navigator,
    browserVectorDb: "WebAssembly" in window,
    sharedSemanticVectorDb: "WebAssembly" in window,
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

  function cancelTimedOutNativeRequest(requestId) {
    if (!hasNativeBridge() || !requestId) return;
    const id = `native-cancel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      window.CaatuuAndroid.postMessage(JSON.stringify({
        id,
        type: "cancel_request",
        requestId
      }));
    } catch (error) {
      // The original timeout remains authoritative if the bridge is already closing.
    }
  }

  function nativeCall(type, payload = {}, handlers = {}) {
    if (!hasNativeBridge()) {
      return Promise.reject(new Error("Native Android runtime is not available."));
    }

    const signal = handlers.signal;
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Native request aborted.", "AbortError"));
    }

    const id = `native-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const request = { id, type, ...payload };
    const timeoutMs = Number(handlers.timeoutMs || 0);

    return new Promise((resolvePromise, rejectPromise) => {
      let timeoutId = null;
      let settled = false;
      const clearNativeTimeout = () => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
      };
      const cleanup = () => {
        clearNativeTimeout();
        signal?.removeEventListener?.("abort", abortRequest);
      };
      const resolveNative = (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolvePromise(result);
      };
      const rejectNative = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectPromise(error);
      };
      const abortRequest = () => {
        if (settled) return;
        nativePending.delete(id);
        cancelTimedOutNativeRequest(id);
        rejectNative(new DOMException("Native request aborted.", "AbortError"));
      };
      const resetNativeTimeout = () => {
        clearNativeTimeout();
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
        timeoutId = window.setTimeout(() => {
          nativePending.delete(id);
          cancelTimedOutNativeRequest(id);
          rejectNative(new Error(handlers.timeoutMessage || "Native Android runtime did not respond in time."));
        }, timeoutMs);
      };

      nativePending.set(id, {
        resolve(result) {
          resolveNative(result);
        },
        reject(error) {
          rejectNative(error);
        },
        onEvent(message) {
          if (handlers.resetTimeoutOnEvent !== false) resetNativeTimeout();
          if (handlers.onEvent) handlers.onEvent(message);
        }
      });
      signal?.addEventListener?.("abort", abortRequest, { once: true });

      try {
        resetNativeTimeout();
        window.CaatuuAndroid.postMessage(JSON.stringify(request));
      } catch (error) {
        nativePending.delete(id);
        rejectNative(error);
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

  function setupReserveBytes(expectedBytes) {
    return Math.max(128 * 1024 * 1024, Math.ceil(Number(expectedBytes || 0) * 0.12));
  }

  async function browserSetupPreflight() {
    if (!("caches" in window)) {
      return {
        ok: false,
        available: false,
        scope: "browser origin cache",
        message: "This browser cannot keep the local Caatuu setup files."
      };
    }

    const manifest = await fetchJson(setupManifestPath, { cache: "reload" });
    const status = await browserSetupStatus(manifest);
    const expectedBytes = Number(status.expectedBytes || 0);
    const bytes = Number(status.bytes || 0);
    const remainingBytes = Math.max(0, expectedBytes - bytes);
    const reserveBytes = setupReserveBytes(expectedBytes);
    const requiredBytes = remainingBytes + reserveBytes;
    const result = {
      ok: true,
      available: false,
      scope: "browser origin cache",
      bytes,
      expectedBytes,
      remainingBytes,
      reserveBytes,
      requiredBytes,
      message: "Storage looks ready."
    };

    if (!navigator.storage?.estimate) {
      return {
        ...result,
        message: "Browser storage estimate is unavailable; setup will continue and verify each file."
      };
    }

    const estimate = await navigator.storage.estimate();
    const usageBytes = Number(estimate.usage || 0);
    const quotaBytes = Number(estimate.quota || 0);
    const availableBytes = quotaBytes > 0 ? Math.max(0, quotaBytes - usageBytes) : 0;
    const ok = quotaBytes <= 0 || availableBytes >= requiredBytes;
    return {
      ...result,
      ok,
      available: quotaBytes > 0,
      usageBytes,
      quotaBytes,
      availableBytes,
      message: ok
        ? "Storage looks ready."
        : `Caatuu needs ${Math.ceil(requiredBytes / 1024 / 1024)} MB free for setup; this browser reports ${Math.floor(availableBytes / 1024 / 1024)} MB.`
    };
  }

  async function sha256Hex(buffer) {
    if (!globalThis.crypto?.subtle) return "";
    const hash = await globalThis.crypto.subtle.digest("SHA-256", buffer);
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

    const storedBytes = Number(cached.headers.get("content-length") || 0);
    const storedSha = (cached.headers.get("x-caatuu-setup-sha256") || "").toLowerCase();
    const expectedSha = String(artifact.sha256 || "").toLowerCase();
    const canVerifySha256 = !expectedSha || Boolean(globalThis.crypto?.subtle);
    const trustedVerifiedEntry = storedBytes > 0 &&
      storedBytes === (expectedBytes || storedBytes) &&
      canVerifySha256 &&
      (!expectedSha || storedSha === expectedSha);
    if (trustedVerifiedEntry) {
      return {
        key: artifact.key,
        label: artifact.label,
        kind: artifact.artifact_kind,
        url: artifact.url,
        expectedBytes: expectedBytes || storedBytes,
        sha256: artifact.sha256 || "",
        bytes: storedBytes,
        ready: true,
        verified: true
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
      ready: statuses.length > 0 && readyArtifacts === statuses.length,
      readyArtifacts,
      artifactCount: statuses.length,
      bytes: statuses.reduce((sum, item) => sum + Number(item.bytes || 0), 0),
      expectedBytes: statuses.reduce((sum, item) => sum + Number(item.expectedBytes || 0), 0),
      staticAssets: { assets: statuses }
    };
  }

  function assertBrowserSetupActive(generation) {
    if (generation === browserSetupGeneration) return;
    const error = new Error("Browser setup was aborted.");
    error.name = "AbortError";
    throw error;
  }

  async function readResponseBytes(response, expectedBytes, onProgress, generation) {
    assertBrowserSetupActive(generation);
    if (!response.body?.getReader) {
      const buffer = await response.arrayBuffer();
      assertBrowserSetupActive(generation);
      onProgress(buffer.byteLength, expectedBytes || buffer.byteLength);
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      assertBrowserSetupActive(generation);
      const { done, value } = await reader.read();
      assertBrowserSetupActive(generation);
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

  async function cacheBrowserArtifact(cache, artifact, index, artifactCount, onEvent, generation) {
    assertBrowserSetupActive(generation);
    const controller = new AbortController();
    activeBrowserSetupAbortController = controller;
    const response = await fetch(artifact.url, {
      cache: "no-store",
      signal: controller.signal
    });
    assertBrowserSetupActive(generation);
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
    }, generation);
    assertBrowserSetupActive(generation);
    const bytes = buffer.byteLength;
    if (artifact.bytes && bytes !== Number(artifact.bytes)) {
      throw new Error(`${artifact.label || artifact.url} size mismatch: expected ${artifact.bytes}, got ${bytes}`);
    }
    if (artifact.sha256) {
      const hash = await sha256Hex(buffer);
      assertBrowserSetupActive(generation);
      if (!hash) {
        throw new Error(`${artifact.label || artifact.url} requires SHA-256 verification, but this browser cannot provide it.`);
      }
      if (hash !== artifact.sha256) throw new Error(`${artifact.label || artifact.url} SHA-256 mismatch.`);
    }
    assertBrowserSetupActive(generation);
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
    assertBrowserSetupActive(generation);
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
    activeBrowserSetupAbortController?.abort();
    const generation = ++browserSetupGeneration;
    try {
      const preflight = await browserSetupPreflight();
      assertBrowserSetupActive(generation);
      if (!preflight.ok) throw new Error(preflight.message || "Not enough storage for Caatuu setup.");
      const manifest = await fetchJson(setupManifestPath, { cache: "reload" });
      assertBrowserSetupActive(generation);
      const artifacts = browserArtifacts(manifest);
      const cache = await caches.open(manifest.cache_name || fallbackSetupCacheName);
      assertBrowserSetupActive(generation);
      for (let index = 0; index < artifacts.length; index += 1) {
        assertBrowserSetupActive(generation);
        const artifact = artifacts[index];
        const status = await browserArtifactStatus(cache, artifact);
        assertBrowserSetupActive(generation);
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
        await cacheBrowserArtifact(cache, artifact, index + 1, artifacts.length, handlers.onEvent, generation);
        assertBrowserSetupActive(generation);
      }
      return await browserSetupStatus(manifest);
    } finally {
      if (generation === browserSetupGeneration) activeBrowserSetupAbortController = null;
    }
  }

  async function abortBrowserSetup() {
    browserSetupGeneration += 1;
    activeBrowserSetupAbortController?.abort();
    activeBrowserSetupAbortController = null;
    return { aborted: true, setupActive: false };
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

  function clampReportText(value, maxLength = 600) {
    const text = String(value ?? "");
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function compactBugReport(payload = {}) {
    const feedback = payload.feedback && typeof payload.feedback === "object"
      ? {
          clientReportId: clampReportText(payload.feedback.clientReportId || "", 80),
          reportedAt: clampReportText(payload.feedback.reportedAt || "", 64),
          kind: clampReportText(payload.feedback.kind || "", 80),
          reason: clampReportText(payload.feedback.reason || "", 80),
          comment: clampReportText(payload.feedback.comment || "", 400),
          targetWord: clampReportText(payload.feedback.targetWord || "", 120),
          sentence: clampReportText(payload.feedback.sentence || "", 360),
          translation: clampReportText(payload.feedback.translation || "", 360),
          generationSource: clampReportText(payload.feedback.generationSource || "", 80),
          translationMode: clampReportText(payload.feedback.translationMode || "", 40),
          sentenceModelKey: clampReportText(payload.feedback.sentenceModelKey || "", 120),
          translationModelKey: clampReportText(payload.feedback.translationModelKey || "", 120),
          recentSentences: Array.isArray(payload.feedback.recentSentences)
            ? payload.feedback.recentSentences.slice(0, 4).map((value) => clampReportText(value, 360))
            : []
        }
      : {};
    return {
      kind: clampReportText(payload.kind || "setup_attention", 80),
      source: "caatuu-browser",
      reportedAt: new Date().toISOString(),
      runtime: env,
      url: clampReportText(window.location.href, 320),
      title: clampReportText(payload.title || "", 160),
      message: clampReportText(payload.message || "", 900),
      app: payload.app || {},
      device: payload.device || {},
      setup: payload.setup || {},
      storage: payload.storage || {},
      artifacts: Array.isArray(payload.artifacts) ? payload.artifacts.slice(0, 12) : [],
      events: Array.isArray(payload.events) ? payload.events.slice(-10) : [],
      feedback
    };
  }

  async function reportBrowserBug(payload = {}) {
    const body = JSON.stringify(compactBugReport(payload));
    if (body.length > 16 * 1024) {
      throw new Error("Bug report is too large.");
    }
    const response = await fetch(bugReportPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || `Bug report failed with HTTP ${response.status}.`);
    if (result?.ok !== true) throw new Error("The bug report server did not acknowledge storage.");
    return result;
  }

  function feedbackStorage() {
    try {
      return window.localStorage;
    } catch (error) {
      return null;
    }
  }

  function clearDisabledFeedbackQueue() {
    const storage = feedbackStorage();
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === "caatuu.feedbackOutbox.v1" || key?.startsWith("caatuu.feedbackOutbox.v1.item.")) {
        keys.push(key);
      }
    }
    for (const key of keys) storage.removeItem(key);
  }

  async function getFeedbackOutbox() {
    if (feedbackOutbox) return feedbackOutbox;
    if (!feedbackOutboxPromise) {
      feedbackOutboxPromise = import("./feedback-outbox.mjs?v=feedback-outbox-5")
        .then(({ FeedbackOutbox }) => {
          feedbackOutbox = new FeedbackOutbox({
            storage: feedbackStorage(),
            send: (payload) => env === "android"
              ? nativeCall("report_bug", { payload })
              : reportBrowserBug(payload),
            online: () => navigator.onLine !== false,
            visible: () => document.visibilityState !== "hidden",
            saveData: () => navigator.connection?.saveData === true
          });
          return feedbackOutbox;
        })
        .catch((error) => {
          feedbackOutboxPromise = null;
          throw error;
        });
    }
    return feedbackOutboxPromise;
  }

  function clearFeedbackFlushTimer() {
    if (feedbackFlushTimer === null) return;
    window.clearTimeout(feedbackFlushTimer);
    feedbackFlushTimer = null;
  }

  function scheduleFeedbackFlush(delayMs = 0) {
    clearFeedbackFlushTimer();
    feedbackFlushTimer = window.setTimeout(() => {
      feedbackFlushTimer = null;
      void flushQueuedReports();
    }, Math.max(0, Number(delayMs) || 0));
  }

  async function enqueueReport(payload = {}, options = {}) {
    const outbox = await getFeedbackOutbox();
    const result = outbox.enqueue(payload, options);
    scheduleFeedbackFlush(0);
    return { ...result, pending: outbox.list().length };
  }

  async function flushQueuedReports() {
    const outbox = await getFeedbackOutbox();
    const result = await outbox.flush({ maxItems: 1 });
    clearFeedbackFlushTimer();
    if (!result.paused && result.pending > 0) {
      const delay = outbox.nextDelayMs();
      scheduleFeedbackFlush(delay === null ? 30_000 : Math.max(1_000, delay));
    }
    return result;
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

    if (browserModelLoad) {
      const pendingLoad = browserModelLoad;
      try {
        await pendingLoad.promise;
      } catch (error) {
        if (!pendingLoad.cancelled) throw error;
      }
      if (browserEngine && browserEngineModelKey === browserFallbackModel) {
        return browserModelStatus({ loaded: true });
      }
    }

    await unloadBrowserModel();
    const load = { cancelled: false, promise: null };
    browserModelLoad = load;
    load.promise = (async () => {
      const webllm = await import(webllmCdn);
      const engine = await webllm.CreateMLCEngine(browserFallbackModel, {
        initProgressCallback(progress) {
          if (load.cancelled || browserModelLoad !== load) return;
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
      if (load.cancelled || browserModelLoad !== load) {
        await disposeBrowserEngine(engine);
        const error = new Error("Browser model loading was cancelled.");
        error.name = "AbortError";
        throw error;
      }
      browserEngine = engine;
      browserEngineModelKey = browserFallbackModel;
      return browserModelStatus({ loaded: true });
    })();

    try {
      return await load.promise;
    } finally {
      if (browserModelLoad === load) browserModelLoad = null;
    }
  }

  async function disposeBrowserEngine(engine) {
    if (!engine) return false;
    try {
      if (typeof engine.unload === "function") {
        await engine.unload();
      } else if (typeof engine.dispose === "function") {
        await engine.dispose();
      }
    } catch (error) {
      return false;
    }
    return true;
  }

  async function unloadBrowserModel() {
    const loading = browserModelLoad;
    if (loading) loading.cancelled = true;
    const engine = browserEngine;
    browserEngine = null;
    browserEngineModelKey = "";
    const unloaded = await disposeBrowserEngine(engine);
    return {
      runtime: "browser-webgpu",
      unloaded,
      cancellationRequested: Boolean(loading)
    };
  }

  async function resetBrowserConversation() {
    if (!browserEngine) return { runtime: "browser-webgpu", reset: false, loaded: false };
    if (typeof browserEngine.resetChat === "function") {
      await browserEngine.resetChat();
      return { runtime: "browser-webgpu", reset: true, loaded: true };
    }
    const result = await unloadBrowserModel();
    return { ...result, reset: true, reloadRequired: true };
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

  async function searchBrowserVectorDatabase(text, options = {}) {
    if (!String(text || "").trim()) throw new Error("Vector search text is empty.");
    const module = await import("./vector-db.js?v=vector-db-9");
    const Manager = module.BrowserVectorDatabaseManager;
    if (!browserVectorDatabase) browserVectorDatabase = new Manager();
    await browserVectorDatabase.open();
    const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 10;
    const sourceKinds = Array.isArray(options.sourceKinds) ? options.sourceKinds : [];
    const results = await browserVectorDatabase.searchText(text, { limit, sourceKinds });
    return {
      runtime: env === "android" ? "android-webview-semantic-vector-db" : "browser-semantic-vector-db",
      text,
      limit,
      sourceKinds,
      results
    };
  }

  function browserDictionaryStatus() {
    return fetchJson("api/dictionary/status", { cache: "no-store" });
  }

  function browserDictionarySearch(query, options = {}) {
    const limit = Math.max(1, Math.min(60, Number(options.limit || 12)));
    return fetchJson(`api/dictionary/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
      cache: "no-store",
      signal: options.signal
    });
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
    appearance: {
      setSystemTheme(theme) {
        return setNativeSystemTheme(theme);
      }
    },
    setup: {
      status() {
        return env === "android" ? nativeCall("setup_status") : browserSetupStatus();
      },
      preflight() {
        return env === "android" ? nativeCall("storage_preflight") : browserSetupPreflight();
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
      abortDownload(modelKey) {
        if (env === "android") return nativeCall("cancel_download", { modelKey });
        return Promise.resolve({ runtime: "browser-webgpu", aborted: false });
      },
      unload() {
        return env === "android" ? Promise.resolve({ runtime: "android", unloaded: false }) : unloadBrowserModel();
      },
      resetConversation(modelKey) {
        return env === "android"
          ? nativeCall("reset_conversation", { modelKey })
          : resetBrowserConversation();
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
        // Query embedding and scoring intentionally share one WebAssembly/ONNX
        // implementation across the browser and Android WebView. Android still
        // owns verified post-install artifact downloads and serves them locally.
        return searchBrowserVectorDatabase(text, options);
      }
    },
    dictionary: {
      status() {
        return env === "android" ? nativeCall("dictionary_status") : browserDictionaryStatus();
      },
      download(handlers = {}) {
        return env === "android" ? nativeCall("dictionary_download", {}, handlers) : browserDictionaryStatus();
      },
      search(query, options = {}) {
        if (env === "android") {
          return nativeCall(
            "dictionary_search",
            { query, limit: Math.max(1, Math.min(60, Number(options.limit || 12))) },
            { signal: options.signal }
          );
        }
        return browserDictionarySearch(query, options);
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
      },
      reportBug(payload = {}) {
        return Promise.resolve({
          ok: false,
          disabled: true,
          message: "Remote diagnostic reporting is disabled."
        });
      },
      enqueueReport(payload = {}, options = {}) {
        return Promise.resolve({ queued: false, disabled: true, pending: 0 });
      },
      flushReports() {
        return Promise.resolve({ sent: [], pending: 0, paused: true, disabled: true });
      }
    }
  };

  clearNativeBrowserState();
  clearDisabledFeedbackQueue();
})();
