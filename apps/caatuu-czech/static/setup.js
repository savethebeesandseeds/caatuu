(() => {
  const $ = (selector) => document.querySelector(selector);
  const runtime = window.CaatuuRuntime;
  const maxLogEntries = 36;
  let setupRunning = false;
  let setupAborted = false;
  let nativeSetupActive = false;
  let updateRunning = false;
  let reportRunning = false;
  let navigationLocked = false;
  let setupMode = "native";
  let detailsOpen = false;
  let detailsTouched = false;
  let setupUpdateStatus = null;
  let setupStatusPollTimer = null;
  let updateStatusPollTimer = null;
  let setupMessageTimer = null;
  let setupVisualTimer = null;
  let setupMessageIndex = 0;
  let setupVisualIndex = 0;
  let activeArtifactKey = "";
  let latestSetupLabel = "";
  let lastSetupAttention = null;
  let lastStoragePreflight = null;
  const artifactState = new Map();
  const setupLog = [];
  const progressLogBuckets = new Map();
  const setupVisualFrameDelayMs = 2400;
  const setupManifestPath = "setup-assets.json";
  const setupFrameManifestPath = "/assets/macaw/loading_animation/split_manifest.json";
  const setupReadyArt = "/assets/icons/hello.png";
  let setupVisualFrames = [];

  const setupMessages = [
    "Checking local storage before Caatuu starts.",
    "Preparing the Czech practice files.",
    "Saving verified files so setup can resume later.",
    "Keeping the app usable without repeating finished downloads.",
    "Checking every file before Caatuu trusts it.",
    "Preparing the offline workspace.",
    "Finishing the local setup."
  ];

  function hasNativeRuntime() {
    return runtime?.env === "android";
  }

  function setText(selector, value) {
    const node = $(selector);
    if (node && node.textContent !== value) node.textContent = value;
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let scaled = value;
    let unit = 0;
    while (scaled >= 1024 && unit < units.length - 1) {
      scaled /= 1024;
      unit += 1;
    }
    return `${scaled >= 10 || unit === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unit]}`;
  }

  function clampPercent(progress) {
    return Math.max(0, Math.min(100, Number(progress || 0)));
  }

  function artifactPercent(item) {
    if (item?.ready) return 100;
    const expected = Number(item?.expectedBytes || 0);
    const bytes = Number(item?.bytes || 0);
    return expected > 0 ? clampPercent(bytes / expected * 100) : 0;
  }

  function hasAppUpdate(status = setupUpdateStatus) {
    if (!status?.updateAvailable) return false;
    const latest = Number(status.latestVersionCode || 0);
    const current = Number(status.currentVersionCode || 0);
    return latest > current;
  }

  function updateStatusProblem(status = setupUpdateStatus) {
    return Boolean(status?.updateError || status?.serverReachable === false);
  }

  function updateStatusLabel(status = setupUpdateStatus) {
    const latest = status?.latestVersionName || status?.latestVersionCode;
    const current = status?.currentVersionName || status?.currentVersionCode;
    if (latest && current && String(latest) !== String(current)) {
      return `server ${latest}, app ${current}`;
    }
    return current ? `app ${current}` : "app version";
  }

  function clipText(value, maxLength = 400) {
    const text = String(value ?? "");
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function compactStorage(storage) {
    if (!storage || typeof storage !== "object") return {};
    return {
      ok: Boolean(storage.ok),
      available: Boolean(storage.available),
      scope: clipText(storage.scope || "", 120),
      bytes: Number(storage.bytes || 0),
      expectedBytes: Number(storage.expectedBytes || 0),
      remainingBytes: Number(storage.remainingBytes || 0),
      reserveBytes: Number(storage.reserveBytes || 0),
      requiredBytes: Number(storage.requiredBytes || 0),
      availableBytes: Number(storage.availableBytes || 0),
      usageBytes: Number(storage.usageBytes || 0),
      quotaBytes: Number(storage.quotaBytes || 0),
      message: clipText(storage.message || "", 300)
    };
  }

  function setupMessage(progress, label = "") {
    const message = setupMessages[setupMessageIndex % setupMessages.length] || setupMessages[0];
    return message;
  }

  function stageFallback(art) {
    return art?.dataset.setupArtFallback || "icons/caatuu-czech-512.png";
  }

  function setStageImage(art, src, { looping = false } = {}) {
    const probe = new Image();
    probe.onload = () => {
      if (art.getAttribute("src") !== src) art.src = src;
      art.classList.toggle("is-looping", looping);
    };
    probe.onerror = () => {
      if (!looping) {
        art.src = stageFallback(art);
      }
    };
    probe.src = src;
  }

  function advanceStageFrame() {
    const art = $(".stage-art");
    if (!art || !setupVisualFrames.length) return;
    const src = setupVisualFrames[setupVisualIndex % setupVisualFrames.length];
    setupVisualIndex = (setupVisualIndex + 1) % setupVisualFrames.length;
    setStageImage(art, src, { looping: true });
  }

  function fallbackStageFrames() {
    return Array.from({ length: 72 }, (_, index) => {
      const frame = String(index + 1).padStart(3, "0");
      return `/assets/macaw/loading_animation/loading-animation_${frame}.png`;
    });
  }

  function setupFrameNumber(value) {
    const match = String(value || "").match(/loading-animation(?:[_-](\d+)|(?:%20|\s)*\((\d+)\))\.png$/i);
    if (!match) return Number.MAX_SAFE_INTEGER;
    return Number(match[1] || match[2]);
  }

  function frameUrlFromManifestPath(value) {
    const text = String(value || "").replaceAll("\\", "/");
    const file = text.split("/").filter(Boolean).pop();
    if (!file || !/^loading-animation[_-]\d+\.png$/i.test(file)) return "";
    return `/assets/macaw/loading_animation/${file}`;
  }

  async function loadSetupVisualManifestFrames() {
    const response = await fetch(setupFrameManifestPath, { cache: "reload" });
    if (!response.ok) throw new Error(`Loading animation manifest returned ${response.status}`);
    const manifest = await response.json();
    const frames = (Array.isArray(manifest?.sprites) ? manifest.sprites : [])
      .map((item) => frameUrlFromManifestPath(item?.file || item?.url || item?.path))
      .filter(Boolean)
      .sort((a, b) => setupFrameNumber(a) - setupFrameNumber(b) || a.localeCompare(b));
    return [...new Set(frames)];
  }

  function setupAssetManifestFrames(manifest) {
    return (Array.isArray(manifest?.artifacts) ? manifest.artifacts : [])
      .filter((item) => String(item?.url || "").includes("/assets/macaw/loading_animation/"))
      .map((item) => String(item.url || ""))
      .filter(Boolean)
      .sort((a, b) => setupFrameNumber(a) - setupFrameNumber(b) || a.localeCompare(b));
  }

  function normalizeSetupVisualFrames(frames) {
    const uniqueFrames = [...new Set(frames.filter(Boolean))];
    return uniqueFrames.length ? uniqueFrames : fallbackStageFrames();
  }

  function isLoadingFrameAvailable(src) {
    return /^\/assets\/macaw\/loading_animation\/loading-animation[_-]\d+\.png$/i.test(src) ||
      /\/assets\/macaw\/loading_animation\/loading-animation(?:%20|\s)*\(\d+\)\.png$/i.test(src);
  }

  async function loadSetupVisualFrames() {
    if (setupVisualFrames.length) return setupVisualFrames;
    try {
      setupVisualFrames = normalizeSetupVisualFrames(await loadSetupVisualManifestFrames());
      return setupVisualFrames;
    } catch (error) {
      // Fall back to the setup artifact manifest below.
    }

    try {
      const response = await fetch(setupManifestPath, { cache: "reload" });
      if (!response.ok) throw new Error(`Setup manifest returned ${response.status}`);
      const manifest = await response.json();
      setupVisualFrames = normalizeSetupVisualFrames(setupAssetManifestFrames(manifest));
    } catch (error) {
      setupVisualFrames = fallbackStageFrames();
    }
    return setupVisualFrames;
  }

  function startStageAnimation() {
    if (setupVisualTimer !== null) return;
    if (!setupVisualFrames.length) setupVisualFrames = fallbackStageFrames();
    setupVisualFrames = setupVisualFrames.filter(isLoadingFrameAvailable);
    if (!setupVisualFrames.length) setupVisualFrames = fallbackStageFrames();
    advanceStageFrame();
    setupVisualTimer = window.setInterval(advanceStageFrame, setupVisualFrameDelayMs);
  }

  function stopStageAnimation() {
    if (setupVisualTimer !== null) {
      window.clearInterval(setupVisualTimer);
      setupVisualTimer = null;
    }
  }

  function showReadyStageArt() {
    const art = $(".stage-art");
    if (!art) return;
    stopStageAnimation();
    art.classList.remove("is-looping");
    setStageImage(art, setupReadyArt);
  }

  function refreshWaitingMessage() {
    if (!setupRunning && !nativeSetupActive) return;
    const totals = totalsFromArtifacts();
    setText("#setupMessage", setupMessage(totals.progress, latestSetupLabel));
  }

  function startSetupMessageCycle() {
    if (setupMessageTimer !== null) return;
    setupMessageTimer = window.setInterval(() => {
      if (!setupRunning && !nativeSetupActive) {
        stopSetupMessageCycle();
        return;
      }
      setupMessageIndex = (setupMessageIndex + 1) % setupMessages.length;
      refreshWaitingMessage();
    }, 20000);
  }

  function stopSetupMessageCycle() {
    if (setupMessageTimer !== null) {
      window.clearInterval(setupMessageTimer);
      setupMessageTimer = null;
    }
  }

  function phaseText(kind, label = "") {
    if (updateRunning) return "App update";
    if (kind === "ready") return "Ready";
    if (kind === "error") return "Needs attention";
    if (kind === "progress") return label ? `Downloading ${label}` : "Downloading";
    if (kind === "verify") return label ? `Checking ${label}` : "Verifying";
    if (setupMode === "browser") return "Browser cache";
    return "Local app storage";
  }

  function setProgress(progress, bytesText = "") {
    const percent = clampPercent(progress);
    const progressNode = $("#setupProgress");
    const progressBar = $("#setupProgressBar");
    if (progressNode) progressNode.setAttribute("aria-valuenow", String(Math.round(percent)));
    if (progressBar) progressBar.style.width = `${percent}%`;
    if ($("#setupPercent")) {
      setText("#setupPercent", `${percent.toFixed(0)}%`);
    } else {
      setText("#setupProgressText", `${percent.toFixed(0)}%`);
    }
    if (bytesText) setText("#setupBytes", bytesText);
  }

  function setControls() {
    const action = $("#setupAction");
    const abort = $("#setupAbort");
    const update = $("#setupUpdate");
    const report = $("#setupReportBug");
    const detailsToggle = $("#setupDetailsToggle");
    const ready = totalReady();
    const setupActive = setupRunning || nativeSetupActive;
    const nativeUpdate = hasNativeRuntime();
    const updateAvailable = nativeUpdate && hasAppUpdate();
    const updateCheckNeeded = nativeUpdate && !ready && (
      setupActive ||
      setupAborted ||
      Boolean(lastSetupAttention) ||
      updateStatusProblem()
    );
    const card = $("#nativeSetup");
    if (card) card.classList.toggle("is-updating", updateRunning);
    syncDetailsState(ready);

    if (action) {
      action.hidden = ready || setupActive;
      action.disabled = setupActive;
      action.textContent = setupAborted ? "Retry setup" : "Prepare Caatuu";
    }
    if (abort) {
      abort.disabled = !setupActive || updateRunning;
      abort.hidden = ready;
    }
    if (update) {
      update.hidden = !updateRunning && !updateAvailable && !updateCheckNeeded;
      update.disabled = updateRunning || !nativeUpdate;
      update.textContent = updateRunning ? "Updating" : "Update app";
      update.title = updateAvailable && setupActive
        ? "Stop setup and open the app update"
        : updateAvailable
          ? "Open the app update"
          : updateCheckNeeded
            ? "Check the server for a newer app update"
            : "";
    }
    if (report) {
      report.hidden = true;
      report.disabled = true;
    }
    if (detailsToggle) {
      const details = $("#setupDetails");
      const visible = details ? !details.hidden : false;
      detailsToggle.hidden = !artifactState.size && !setupLog.length;
      detailsToggle.disabled = false;
      detailsToggle.setAttribute("aria-expanded", String(visible));
      detailsToggle.textContent = visible ? "Hide details" : "Details";
    }
  }

  function syncDetailsState(ready = totalReady()) {
    const card = $("#nativeSetup");
    const details = $("#setupDetails");
    const defaultOpen = !ready;
    const visible = detailsTouched ? detailsOpen : defaultOpen;
    if (card) card.classList.toggle("details-open", visible);
    if (details) details.hidden = !visible;
  }

  function toggleDetails() {
    const details = $("#setupDetails");
    detailsTouched = true;
    detailsOpen = details ? details.hidden : true;
    setControls();
  }

  function handleDetailsToggle(event) {
    const target = event.currentTarget?.id === "setupDetailsToggle"
      ? event.currentTarget
      : event.target?.closest?.("#setupDetailsToggle");
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    toggleDetails();
  }

  function clearSetupStatusPoll() {
    if (setupStatusPollTimer !== null) {
      window.clearTimeout(setupStatusPollTimer);
      setupStatusPollTimer = null;
    }
  }

  function clearUpdateStatusPoll() {
    if (updateStatusPollTimer !== null) {
      window.clearTimeout(updateStatusPollTimer);
      updateStatusPollTimer = null;
    }
  }

  function scheduleUpdateStatusPoll(delayMs = 120000) {
    clearUpdateStatusPoll();
    if (!hasNativeRuntime()) return;
    updateStatusPollTimer = window.setTimeout(async () => {
      updateStatusPollTimer = null;
      if (!updateRunning) await refreshUpdateAvailability();
      scheduleUpdateStatusPoll();
    }, delayMs);
  }

  function scheduleSetupStatusPoll(delayMs = 2500) {
    clearSetupStatusPoll();
    if (!hasNativeRuntime()) return;
    setupStatusPollTimer = window.setTimeout(async () => {
      setupStatusPollTimer = null;
      if (setupRunning || updateRunning) return;
      try {
        const status = await runtime.setup.status();
        renderStatus(
          status,
          status?.setupActive && !status?.ready
            ? "Setup is still running. Caatuu will recheck the local files."
            : ""
        );
        if (status?.setupActive && !status?.ready) scheduleSetupStatusPoll();
      } catch (error) {
        pushLog("error", "Setup check failed", error?.message || String(error));
        setControls();
      }
    }, delayMs);
  }

  function totalReady() {
    if (!artifactState.size) return false;
    return [...artifactState.values()].every((item) => item.ready);
  }

  function artifactKey(item) {
    return item.key || item.modelKey || item.artifactKey || item.assetPath || item.url || item.label || "artifact";
  }

  function displayGroupFor(item) {
    const key = artifactKey(item);
    const kind = String(item.kind || "").toLowerCase();
    const label = String(item.label || key);
    const searchable = `${key} ${kind} ${label}`.toLowerCase();

    if (kind === "gguf-model") {
      return {
        key: `model:${key}`,
        label: label || "Model",
        kind: "gguf-model",
        order: 10
      };
    }

    if (kind === "embedding-vector-db" || searchable.includes("embedding")) {
      return {
        key: "embeddings",
        label: "Embeddings",
        kind: "embedding-vector-db",
        order: 20
      };
    }

    return {
      key: "assets",
      label: "Assets",
      kind: "asset-group",
      order: 30
    };
  }

  function displayArtifactRows() {
    const groups = new Map();
    [...artifactState.values()].forEach((item) => {
      const groupSpec = displayGroupFor(item);
      const group = groups.get(groupSpec.key) || {
        ...groupSpec,
        bytes: 0,
        expectedBytes: 0,
        readyItems: 0,
        itemCount: 0,
        active: false,
        error: ""
      };
      const expectedBytes = Number(item.expectedBytes || item.bytes || 0);
      const bytes = Math.min(Number(item.bytes || 0), expectedBytes || Number(item.bytes || 0));
      group.bytes += bytes;
      group.expectedBytes += expectedBytes;
      group.readyItems += item.ready ? 1 : 0;
      group.itemCount += 1;
      group.active = group.active || Boolean(item.active);
      group.error = group.error || item.error || "";
      group.ready = group.readyItems === group.itemCount;
      groups.set(groupSpec.key, group);
    });
    return [...groups.values()].sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
  }

  function artifactRows(status) {
    const models = Array.isArray(status?.models) ? status.models : [];
    const rows = models.map((item) => ({
      key: item.modelKey || item.key,
      label: item.shortLabel || item.label || item.modelKey || "Model",
      kind: item.kind || item.artifactKind || item.artifact_kind || "gguf-model",
      ready: Boolean(item.ready || item.verified),
      bytes: item.bytes || item.finalBytes || item.managedDownloadBytes || 0,
      expectedBytes: item.expectedBytes || 0
    }));
    if (status?.vectorDatabase) {
      rows.push({
        key: status.vectorDatabase.modelKey || status.vectorDatabase.key || "embeddings",
        label: status.vectorDatabase.shortLabel || status.vectorDatabase.label || "Embeddings",
        kind: status.vectorDatabase.kind || status.vectorDatabase.artifactKind || status.vectorDatabase.artifact_kind || "embedding-vector-db",
        ready: Boolean(status.vectorDatabase.ready || status.vectorDatabase.verified),
        bytes: status.vectorDatabase.bytes || 0,
        expectedBytes: status.vectorDatabase.expectedBytes || 0
      });
    }
    const staticAssets = Array.isArray(status?.staticAssets?.assets) ? status.staticAssets.assets : [];
    staticAssets.forEach((item) => {
      rows.push({
        key: item.key || item.assetPath,
        label: item.label || item.assetPath || "Asset",
        kind: item.kind || item.artifactKind || item.artifact_kind || "visual-asset",
        ready: Boolean(item.ready || item.verified),
        bytes: item.bytes || 0,
        expectedBytes: item.expectedBytes || item.bytes || 0
      });
    });
    return rows;
  }

  function syncArtifactState(status) {
    artifactRows(status).forEach((item) => {
      const key = artifactKey(item);
      const existing = artifactState.get(key) || {};
      artifactState.set(key, {
        ...existing,
        ...item,
        key,
        bytes: Number(item.bytes || 0),
        expectedBytes: Number(item.expectedBytes || existing.expectedBytes || 0),
        ready: Boolean(item.ready),
        active: Boolean(existing.active && !item.ready),
        error: item.ready ? "" : existing.error || ""
      });
    });
  }

  function updateArtifactFromEvent(message) {
    const key = message.artifactKey || message.key || message.label || "current";
    const existing = artifactState.get(key) || {};
    const totalBytes = Number(message.totalBytes || existing.expectedBytes || 0);
    const bytes = Number(message.bytes || existing.bytes || 0);
    const ready = bytes > 0 && totalBytes > 0 && bytes >= totalBytes;
    activeArtifactKey = key;
    artifactState.set(key, {
      ...existing,
      key,
      label: message.label || existing.label || key,
      kind: message.artifactKind || existing.kind || message.phase || "artifact",
      bytes: Math.max(bytes, Number(existing.bytes || 0)),
      expectedBytes: totalBytes,
      ready,
      active: !ready,
      error: ""
    });
  }

  function totalsFromArtifacts() {
    const rows = [...artifactState.values()];
    const expectedBytes = rows.reduce((sum, item) => sum + Number(item.expectedBytes || 0), 0);
    const bytes = rows.reduce((sum, item) => sum + Math.min(Number(item.bytes || 0), Number(item.expectedBytes || item.bytes || 0)), 0);
    const readyArtifacts = rows.filter((item) => item.ready).length;
    const artifactCount = rows.length;
    const progress = expectedBytes > 0
      ? bytes / expectedBytes * 100
      : artifactCount > 0
        ? readyArtifacts / artifactCount * 100
        : 0;
    return { bytes, expectedBytes, readyArtifacts, artifactCount, progress };
  }

  function renderArtifacts() {
    const container = $("#setupArtifacts");
    if (!container) return;
    const rows = displayArtifactRows();
    if (!rows.length) {
      const empty = document.createElement("div");
      const icon = document.createElement("i");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      empty.className = "setup-artifact";
      empty.dataset.ready = "false";
      empty.dataset.kind = "manifest";
      empty.style.setProperty("--artifact-progress", "0%");
      icon.className = "setup-artifact-icon";
      icon.textContent = "!";
      title.textContent = "Setup manifest";
      meta.textContent = "0%";
      empty.append(icon, title, meta);
      container.replaceChildren(empty);
      return;
    }
    container.replaceChildren(...rows.map((item) => {
      const row = document.createElement("div");
      const icon = document.createElement("i");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      const percent = artifactPercent(item);
      row.className = "setup-artifact";
      row.dataset.ready = item.ready ? "true" : "false";
      row.dataset.kind = item.kind || "artifact";
      row.dataset.status = item.error ? "error" : item.ready ? "ready" : item.active ? "active" : "pending";
      row.style.setProperty("--artifact-progress", `${percent}%`);
      icon.className = "setup-artifact-icon";
      icon.textContent = item.ready ? "\u2713" : "!";
      title.textContent = item.itemCount > 1 ? `${item.label} (${item.readyItems}/${item.itemCount})` : item.label || item.key || "Artifact";
      meta.textContent = item.ready ? `${percent.toFixed(0)}% ready` : `${percent.toFixed(0)}%`;
      meta.title = `${formatBytes(item.bytes)} / ${formatBytes(item.expectedBytes || item.bytes)}`;
      if (item.error) row.title = item.error;
      row.append(icon, title, meta);
      return row;
    }));
  }

  function pushLog(kind, title, detail = "") {
    const text = String(title || "").trim();
    if (!text) return;
    const last = setupLog[setupLog.length - 1];
    if (last && last.kind === kind && last.title === text && last.detail === detail) return;
    setupLog.push({
      kind,
      title: text,
      detail,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    });
    while (setupLog.length > maxLogEntries) setupLog.shift();
    renderLog();
  }

  function renderLog() {
    const container = $("#setupLog");
    if (!container) return;
    container.replaceChildren(...setupLog.map((item) => {
      const entry = document.createElement("li");
      const title = document.createElement("strong");
      const detail = document.createElement("span");
      entry.dataset.kind = item.kind;
      title.textContent = item.title;
      detail.textContent = item.detail ? `${item.time} - ${item.detail}` : item.time;
      entry.append(title, detail);
      return entry;
    }));
    container.scrollTop = container.scrollHeight;
  }

  function maybeLogProgress(message) {
    const source = artifactState.get(message.artifactKey) || message;
    const group = displayGroupFor(source);
    const displayRow = displayArtifactRows().find((item) => item.key === group.key);
    const label = displayRow?.label || group.label || message.label || "Artifact";
    const totalBytes = Number(displayRow?.expectedBytes || message.totalBytes || 0);
    const bytes = Number(displayRow?.bytes || message.bytes || 0);
    if (!totalBytes) return;
    const percent = clampPercent(bytes / totalBytes * 100);
    const bucket = Math.floor(percent / 20) * 20;
    const key = `${group.key}:progress`;
    if (progressLogBuckets.get(key) === bucket && percent < 100) return;
    progressLogBuckets.set(key, bucket);
    pushLog("progress", `Downloading ${label}`, `${formatBytes(bytes)} / ${formatBytes(totalBytes)}`);
  }

  function updateSummary(message = "", kind = "status", label = "") {
    const totals = totalsFromArtifacts();
    const card = $("#nativeSetup");
    const bytesText = totals.expectedBytes > 0
      ? `${formatBytes(totals.bytes)} / ${formatBytes(totals.expectedBytes)}`
      : `${totals.readyArtifacts} of ${totals.artifactCount || 0} ready`;
    latestSetupLabel = label;
    if (card) card.classList.toggle("is-error", kind === "error");
    setText("#setupCount", `${Math.min(totals.readyArtifacts, totals.artifactCount)}/${totals.artifactCount || "?"}`);
    setText("#setupPhase", phaseText(kind, label));
    setText("#setupMessage", message || setupMessage(totals.progress, label));
    setProgress(totals.progress, bytesText);
    renderArtifacts();
    setControls();
  }

  function renderStatus(status, message = "") {
    syncArtifactState(status);
    const ready = Boolean(status?.ready) || totalReady();
    const readyText = hasNativeRuntime()
      ? "Ready."
      : "Ready.";
    const card = $("#nativeSetup");
    nativeSetupActive = Boolean(status?.setupActive && !ready);
    if (card) {
      card.classList.toggle("is-ready", ready);
      card.classList.toggle("is-error", false);
    }
    if (ready) lastSetupAttention = null;
    setText("#setupTitle", ready ? "Caatuu is ready" : "Preparing Caatuu");
    updateSummary(message || (ready ? readyText : "Preparing local intelligence."), ready ? "ready" : "status");
    if (ready) {
      stopSetupMessageCycle();
      showReadyStageArt();
    } else if (nativeSetupActive || setupRunning) {
      startSetupMessageCycle();
      applyStageArt();
    }
    if (!ready && !hasNativeRuntime()) applyStageArt();
    setNavigationLocked(!ready);
    if (ready) pushLog("ready", "Setup complete", readyText);
  }

  function applyStageArt() {
    startStageAnimation();
  }

  function setNavigationLocked(locked) {
    navigationLocked = locked;
    document.body.classList.toggle("setup-blocked", locked);
    document.querySelectorAll("[data-caatuu-bottom-nav]").forEach((nav) => {
      nav.dataset.setupLocked = locked ? "true" : "false";
      nav.setAttribute("aria-disabled", String(locked));
    });
    document.querySelectorAll("[data-caatuu-bottom-nav] a, [data-caatuu-bottom-nav] button").forEach((node) => {
      if (locked) {
        node.setAttribute("aria-disabled", "true");
        node.tabIndex = -1;
      } else {
        node.removeAttribute("aria-disabled");
        node.removeAttribute("tabindex");
      }
    });
  }

  function bindNavigationLock() {
    document.addEventListener("click", (event) => {
      if (!navigationLocked) return;
      const target = event.target.closest("[data-caatuu-bottom-nav] a, [data-caatuu-bottom-nav] button");
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      pushLog("status", "Navigation blocked", "Finish setup before opening app sections.");
      setText("#setupMessage", "Caatuu is still preparing the local files.");
    }, true);
  }

  function renderSetupEvent(message) {
    if (message.kind === "progress") {
      updateArtifactFromEvent(message);
      const totals = totalsFromArtifacts();
      const group = displayGroupFor(artifactState.get(message.artifactKey) || message);
      const displayRow = displayArtifactRows().find((item) => item.key === group.key);
      const label = displayRow?.label || group.label || message.label || "Artifact";
      const bytesText = `${formatBytes(totals.bytes)} / ${formatBytes(totals.expectedBytes || message.totalBytes)}`;
      latestSetupLabel = label;
      setText("#setupPhase", phaseText("progress", label));
      setText("#setupMessage", setupMessage(totals.progress, label));
      setProgress(totals.progress, bytesText);
      renderArtifacts();
      maybeLogProgress(message);
      return;
    }

    if (message.kind === "status") {
      const phase = String(message.phase || "").toLowerCase();
      const itemReady = phase.includes("ready") || phase.includes("cached");
      if (itemReady && message.artifactKey) {
        updateArtifactFromEvent({
          ...message,
          bytes: artifactState.get(message.artifactKey)?.expectedBytes || 1,
          totalBytes: artifactState.get(message.artifactKey)?.expectedBytes || 1
        });
      }
      const group = displayGroupFor(artifactState.get(message.artifactKey) || message);
      const displayRow = displayArtifactRows().find((item) => item.key === group.key);
      const label = displayRow?.label || group.label || message.label || "";
      const kind = totalReady() ? "ready" : "status";
      updateSummary("", kind, label);
      if (itemReady) {
        maybeLogProgress({
          ...message,
          label,
          bytes: displayRow?.bytes,
          totalBytes: displayRow?.expectedBytes
        });
      } else {
        pushLog("status", message.message || (label ? `Preparing ${label}` : "Setup event"), message.phase || "");
      }
    }
  }

  function stopSetupUi(message = "Setup stopped. You can retry or update the app.") {
    setupRunning = false;
    setupAborted = true;
    nativeSetupActive = false;
    stopSetupMessageCycle();
    setNavigationLocked(true);
    setText("#setupTitle", "Setup stopped");
    lastSetupAttention = {
      kind: "setup_attention",
      title: "Setup stopped",
      message,
      activeArtifactKey,
      date: new Date().toISOString()
    };
    const failedKey = activeArtifactKey || [...artifactState.entries()].find(([, item]) => !item.ready)?.[0] || "";
    if (failedKey && artifactState.has(failedKey)) {
      const failed = artifactState.get(failedKey);
      artifactState.set(failedKey, {
        ...failed,
        active: false,
        error: message
      });
    }
    updateSummary(message, "error");
    pushLog("error", "Setup stopped", message);
    setControls();
  }

  async function runStoragePreflight() {
    if (!runtime?.setup?.preflight) return true;
    setText("#setupPhase", "Checking storage");
    setText("#setupMessage", "Checking device storage before setup starts.");
    pushLog("status", "Storage check started", "Checking free space before downloads.");

    const preflight = await runtime.setup.preflight();
    lastStoragePreflight = preflight;
    if (preflight?.ok === false) {
      const message = preflight.message ||
        `Caatuu needs ${formatBytes(preflight.requiredBytes)} free before setup.`;
      pushLog("error", "Storage check failed", `${formatBytes(preflight.availableBytes)} free`);
      stopSetupUi(message);
      return false;
    }

    const available = Number(preflight?.availableBytes || 0);
    const required = Number(preflight?.requiredBytes || 0);
    const detail = available > 0
      ? `${formatBytes(available)} free; ${formatBytes(required)} requested.`
      : "Storage estimate unavailable; setup will verify each file.";
    pushLog("ready", "Storage checked", detail);
    return true;
  }

  function setupBugReportPayload() {
    const totals = totalsFromArtifacts();
    const versionCode = setupUpdateStatus?.currentVersionCode || setupUpdateStatus?.versionCode || 0;
    const versionName = setupUpdateStatus?.currentVersionName || setupUpdateStatus?.versionName || "";
    const artifacts = [...artifactState.values()].slice(0, 16).map((item) => ({
      key: clipText(artifactKey(item), 120),
      label: clipText(item.label || "", 120),
      kind: clipText(item.kind || "", 80),
      ready: Boolean(item.ready),
      active: Boolean(item.active),
      bytes: Number(item.bytes || 0),
      expectedBytes: Number(item.expectedBytes || 0),
      error: clipText(item.error || "", 220)
    }));
    const events = setupLog.slice(-10).map((item) => ({
      kind: clipText(item.kind || "", 40),
      title: clipText(item.title || "", 160),
      detail: clipText(item.detail || "", 260),
      time: clipText(item.time || "", 32)
    }));
    return {
      kind: "setup_attention",
      title: lastSetupAttention?.title || $("#setupTitle")?.textContent || "Setup attention",
      message: lastSetupAttention?.message || $("#setupMessage")?.textContent || "",
      app: {
        versionCode,
        versionName,
        updateSource: setupUpdateStatus?.source || (setupUpdateStatus?.serverReachable === false ? "update-unavailable" : "update-status")
      },
      device: {
        userAgent: clipText(navigator.userAgent, 360),
        platform: clipText(navigator.platform || "", 80),
        language: clipText(navigator.language || "", 32),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        screen: window.screen ? `${window.screen.width}x${window.screen.height}` : "",
        deviceMemory: navigator.deviceMemory || null,
        hardwareConcurrency: navigator.hardwareConcurrency || null
      },
      setup: {
        mode: setupMode,
        phase: clipText($("#setupPhase")?.textContent || "", 120),
        activeArtifactKey: clipText(activeArtifactKey, 120),
        progress: Number(totals.progress.toFixed(2)),
        readyArtifacts: totals.readyArtifacts,
        artifactCount: totals.artifactCount,
        bytes: totals.bytes,
        expectedBytes: totals.expectedBytes
      },
      storage: compactStorage(lastStoragePreflight),
      artifacts,
      events
    };
  }

  async function reportSetupAttention() {
    if (reportRunning || !lastSetupAttention) return;
    reportRunning = true;
    setControls();
    try {
      const result = await runtime.maintenance.reportBug(setupBugReportPayload());
      const reportId = result?.report_id || result?.reportId || "saved";
      pushLog("ready", "Bug report saved", reportId);
      setText("#setupMessage", "Report sent. Thank you.");
      lastSetupAttention = null;
    } catch (error) {
      pushLog("error", "Bug report failed", error?.message || String(error));
      setText("#setupMessage", error?.message || "Could not send the bug report.");
    } finally {
      reportRunning = false;
      setControls();
    }
  }

  async function startSetup() {
    if (setupRunning || updateRunning) return;
    clearSetupStatusPoll();
    setupRunning = true;
    setupAborted = false;
    lastSetupAttention = null;
    lastStoragePreflight = null;
    activeArtifactKey = "";
    setupMessageIndex = 0;
    progressLogBuckets.clear();
    $("#nativeSetup")?.classList.toggle("is-error", false);
    startSetupMessageCycle();
    setControls();
    pushLog("status", "Setup started", setupMode === "browser" ? "Caching browser files." : "Preparing local app storage.");

    try {
      const storageOk = await runStoragePreflight();
      if (!storageOk) return;
      const result = await runtime.setup.start({ onEvent: renderSetupEvent });
      setupRunning = false;
      setupAborted = false;
      if (result?.setupActive && !result?.ready) {
        renderStatus(result, "Setup is already running. Caatuu will recheck the local files.");
        scheduleSetupStatusPoll();
        return;
      }
      renderStatus(result, "Ready.");
    } catch (error) {
      if (updateRunning) return;
      const message = setupAborted || error?.name === "AbortError"
        ? "Setup aborted. Completed files stay verified; interrupted downloads can be started again."
        : error?.message || String(error);
      stopSetupUi(message);
    }
  }

  async function abortSetup() {
    if (!setupRunning && !nativeSetupActive) return;
    clearSetupStatusPoll();
    setupAborted = true;
    pushLog("status", "Abort requested", "Stopping setup so you can update or retry.");
    setText("#setupPhase", "Abort requested");
    setText("#setupMessage", "Stopping setup. Caatuu will keep files that were already verified.");
    setControls();

    try {
      const result = await runtime.setup.abort();
      nativeSetupActive = false;
      syncArtifactState(result);
      stopSetupUi("Android setup stopped. Active model downloads were cancelled.");
    } catch (error) {
      stopSetupUi(error?.message || "Setup abort did not finish cleanly.");
    }
  }

  async function updateApp() {
    if (updateRunning) return;
    if (!hasNativeRuntime()) {
      setupUpdateStatus = { updateAvailable: false };
      setControls();
      return;
    }

    const status = await refreshUpdateAvailability();
    if (!hasAppUpdate(status)) {
      if (updateStatusProblem(status)) {
        const message = status?.updateError || "The update server could not be reached.";
        pushLog("error", "Update check failed", message);
        setText("#setupPhase", "Update unavailable");
        setText("#setupMessage", `Could not check for an app update. ${message}`);
      } else {
        const label = updateStatusLabel(status);
        pushLog("ready", "App is current", `No newer APK is exposed by the server (${label}).`);
        setText("#setupPhase", "App is current");
        setText("#setupMessage", `No newer app update is exposed by the server (${label}).`);
      }
      setControls();
      return;
    }

    clearUpdateStatusPoll();
    updateRunning = true;
    setControls();

    if (setupRunning || nativeSetupActive) {
      pushLog("status", "Update requested", "Stopping setup before updating.");
      setText("#setupPhase", "App update");
      setText("#setupMessage", "Stopping setup so Android can install the app update.");
      await abortSetup();
    }

    pushLog("status", "Update requested", "Checking APK update.");
    setText("#setupTitle", "Updating Caatuu");
    setText("#setupPhase", "App update");
    setText("#setupMessage", "Checking the latest APK before opening Android installer.");

    try {
      const result = await runtime.maintenance.updateApp({
        onEvent(message) {
          if (message.kind === "progress") {
            const bytes = Number(message.bytes || 0);
            const totalBytes = Number(message.totalBytes || 0);
            const progress = totalBytes > 0 ? bytes / totalBytes * 100 : 0;
            setText("#setupPhase", "App update");
            setText("#setupMessage", `Downloading update ${formatBytes(bytes)} / ${formatBytes(totalBytes)}.`);
            setProgress(progress, `${formatBytes(bytes)} / ${formatBytes(totalBytes)}`);
            maybeLogProgress({
              ...message,
              label: "App update",
              artifactKey: "app-update"
            });
            return;
          }
          if (message.kind === "status") {
            setText("#setupMessage", message.message || "Preparing update.");
            pushLog("status", message.message || "Preparing update.", "APK");
          }
        }
      });
      const action = result.action === "settings" ? "Android install permission opened." : "Android installer opened.";
      pushLog("ready", "Update ready", action);
      setText("#setupMessage", `${action} Confirm the update there.`);
    } catch (error) {
      pushLog("error", "Update failed", error?.message || String(error));
      setText("#setupMessage", error?.message || "Could not start the update.");
    } finally {
      updateRunning = false;
      setControls();
      scheduleUpdateStatusPoll();
    }
  }

  async function initSetup() {
    const card = $("#nativeSetup");
    if (!card) return;
    await loadSetupVisualFrames();
    startStageAnimation();
    card.hidden = false;
    bindNavigationLock();
    setNavigationLocked(true);
    $("#setupAction")?.addEventListener("click", startSetup);
    $("#setupAbort")?.addEventListener("click", abortSetup);
    $("#setupReportBug")?.addEventListener("click", reportSetupAttention);
    document.addEventListener("click", handleDetailsToggle, true);
    $("#setupUpdate")?.addEventListener("click", updateApp);
    pushLog("status", "Setup check started", "Looking for local files.");

    try {
      if (!hasNativeRuntime()) {
        setupMode = "browser";
        const status = await runtime.setup.status();
        renderStatus(status);
        if (!status.ready) await startSetup();
        await refreshUpdateAvailability();
        return;
      }

      setupMode = "native";
      const status = await runtime.setup.status();
      renderStatus(status);
      await refreshUpdateAvailability();
      scheduleUpdateStatusPoll();
      if (!status.ready) {
        if (status.setupActive) {
          scheduleSetupStatusPoll();
        } else {
          await startSetup();
        }
      }
    } catch (error) {
      setText("#setupTitle", "Setup check failed");
      stopSetupUi(error?.message || String(error));
    }
  }

  async function refreshUpdateAvailability() {
    if (!hasNativeRuntime()) {
      setupUpdateStatus = { updateAvailable: false };
      setControls();
      return setupUpdateStatus;
    }

    try {
      setupUpdateStatus = await runtime.maintenance.updateStatus();
    } catch (error) {
      setupUpdateStatus = {
        updateAvailable: false,
        updateError: error?.message || String(error)
      };
    }
    setControls();
    return setupUpdateStatus;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSetup);
  } else {
    initSetup();
  }
})();
