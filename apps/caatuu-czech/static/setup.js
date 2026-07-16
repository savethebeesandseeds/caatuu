(() => {
  const $ = (selector) => document.querySelector(selector);
  const runtime = window.CaatuuRuntime;
  const maxLogEntries = 36;
  let setupRunning = false;
  let setupAborted = false;
  let nativeSetupActive = false;
  let setupComplete = false;
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
  const setupVisualFrameDelayMs = 6000;
  const setupManifestPath = "setup-assets.json";
  const setupFrameManifestPath = "/assets/macaw/loading_animation/split_manifest.json";
  const setupReadyArt = "/assets/icons/hello.png";
  let setupVisualFrames = [];
  let appUpdateLocked = new URLSearchParams(window.location.search).get("app-update") === "1" ||
    Boolean(window.CaatuuMaintenanceUi?.pendingAppUpdate?.());
  let appUpdateUiState = appUpdateLocked ? "checking" : "idle";

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

  function setupProgressUi() {
    return window.CaatuuSetupProgress;
  }

  function clampPercent(progress) {
    return setupProgressUi().clampPercent(progress);
  }

  function artifactPercent(item) {
    return setupProgressUi().artifactPercent(item);
  }

  function hasAppUpdate(status = setupUpdateStatus) {
    const latest = Number(status?.latestVersionCode || status?.downloadedVersionCode || 0);
    const current = Number(status.currentVersionCode || 0);
    if (updateDownloadState(status) !== "idle") return latest > current;
    if (!status?.updateAvailable) return false;
    return latest > current;
  }

  function updateDownloadState(status = setupUpdateStatus) {
    return window.CaatuuMaintenanceUi?.updateDownloadState?.(status) || "idle";
  }

  function updateDownloadPercent(status = setupUpdateStatus) {
    return window.CaatuuMaintenanceUi?.updateDownloadPercent?.(status) || 0;
  }

  function updateActionLabel() {
    const labels = {
      available: "Download update",
      checking: "Checking for updates",
      downloading: "Downloading update",
      verifying: "Verifying update",
      ready: "Install update",
      partial: "Resume download",
      retry: "Retry update",
      installer: "Open installer"
    };
    return labels[appUpdateUiState] || "Update app";
  }

  function renderStoredUpdate(status = setupUpdateStatus) {
    const state = updateDownloadState(status);
    if (state === "ready") {
      appUpdateUiState = "ready";
      setText("#setupTitle", "Update ready to install");
      setText("#setupPhase", "Ready to install");
      setText("#setupMessage", `Caatuu ${status?.downloadedVersionName || status?.latestVersionName || ""} is already downloaded and verified.`);
      setText("#setupCount", "Ready");
      setProgress(100, "APK verified", "100%, app update ready to install");
      $("#nativeSetup")?.classList.toggle("is-error", false);
      setControls();
      return true;
    }
    if (state === "active") {
      const percent = updateDownloadPercent(status);
      const bytes = Number(status?.partialBytes || status?.downloadedBytes || 0);
      const totalBytes = Number(status?.latestBytes || status?.totalBytes || 0);
      appUpdateUiState = "downloading";
      setText("#setupTitle", "Downloading Caatuu");
      setText("#setupPhase", "Downloading update");
      setText("#setupMessage", "The update is continuing in the background. You can lock the phone without restarting it.");
      setText("#setupCount", "Downloading");
      setProgress(
        percent,
        totalBytes > 0 ? `${formatBytes(bytes)} / ${formatBytes(totalBytes)}` : formatBytes(bytes),
        `${Math.floor(percent)}%, app update downloading in the background`
      );
      $("#nativeSetup")?.classList.toggle("is-error", false);
      setControls();
      scheduleUpdateStatusPoll(1500);
      return true;
    }
    if (state === "partial") {
      const percent = updateDownloadPercent(status);
      const bytes = Number(status?.partialBytes || 0);
      const totalBytes = Number(status?.latestBytes || 0);
      appUpdateUiState = "partial";
      setText("#setupTitle", "Update download paused");
      setText("#setupPhase", "Download saved");
      setText("#setupMessage", "The downloaded part is saved. Resume when you are ready; it will not start over.");
      setText("#setupCount", "Paused");
      setProgress(
        percent,
        totalBytes > 0 ? `${formatBytes(bytes)} / ${formatBytes(totalBytes)}` : formatBytes(bytes),
        `${Math.floor(percent)}%, app update saved for resume`
      );
      $("#nativeSetup")?.classList.toggle("is-error", false);
      setControls();
      return true;
    }
    return false;
  }

  function pendingAppUpdate() {
    return window.CaatuuMaintenanceUi?.pendingAppUpdate?.() || null;
  }

  function clearAppUpdateHandoff() {
    appUpdateLocked = false;
    window.CaatuuMaintenanceUi?.clearPendingAppUpdate?.();
    document.body.classList.remove("app-update-lock");
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("app-update");
    cleanUrl.searchParams.delete("version");
    window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }

  function installedUpdateReached(status) {
    const intended = Number(pendingAppUpdate()?.latestVersionCode || 0);
    const current = Number(status?.currentVersionCode || 0);
    return intended > 0 && current >= intended;
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
    setText(
      "#setupMessage",
      totals.verifying
        ? `Download finished. Checking ${totals.verifyingArtifacts} ${totals.verifyingArtifacts === 1 ? "file" : "files"} before setup can finish.`
        : setupMessage(totals.progress, latestSetupLabel)
    );
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

  function phaseText(kind) {
    if (updateRunning) return "App update";
    if (kind === "ready") return "Ready";
    if (kind === "error") return "Needs attention";
    if (kind === "abort") return "Stopping setup";
    // Progress and verification events can alternate several times per second
    // while individual artifacts finish. Keep the user-facing phase calm and
    // let the progress meter, artifact rows, and event log carry that detail.
    return "Preparing Caatuu";
  }

  function setProgress(progress, bytesText = "", valueText = "") {
    const percent = clampPercent(progress);
    const displayPercent = percent >= 100 ? 100 : Math.floor(percent);
    const progressNode = $("#setupProgress");
    const progressBar = $("#setupProgressBar");
    if (progressNode) {
      progressNode.setAttribute("aria-valuenow", String(displayPercent));
      if (valueText) progressNode.setAttribute("aria-valuetext", valueText);
    }
    if (progressBar) progressBar.style.width = `${percent}%`;
    if ($("#setupPercent")) {
      setText("#setupPercent", `${displayPercent}%`);
    } else {
      setText("#setupProgressText", `${displayPercent}%`);
    }
    if (bytesText) setText("#setupBytes", bytesText);
  }

  function setControls() {
    const action = $("#setupAction");
    const abort = $("#setupAbort");
    const report = $("#setupReportBug");
    const detailsToggle = $("#setupDetailsToggle");
    const ready = setupComplete;
    const setupActive = setupRunning || nativeSetupActive;
    const card = $("#nativeSetup");
    if (card) {
      card.classList.toggle("is-updating", updateRunning);
      card.classList.toggle("is-app-update-lock", appUpdateLocked);
    }
    document.body.classList.toggle("app-update-lock", appUpdateLocked);
    syncDetailsState();

    if (action) {
      action.hidden = appUpdateLocked ? false : ready || setupActive;
      action.disabled = appUpdateLocked
        ? updateRunning || ["checking", "downloading", "verifying"].includes(appUpdateUiState)
        : setupActive;
      action.textContent = appUpdateLocked
        ? updateActionLabel()
        : setupAborted ? "Retry setup" : "Prepare Caatuu";
    }
    if (abort) {
      abort.disabled = !setupActive || updateRunning;
      abort.hidden = appUpdateLocked || ready;
    }
    if (report) {
      report.hidden = true;
      report.disabled = true;
    }
    if (detailsToggle) {
      const details = $("#setupDetails");
      const visible = !appUpdateLocked && details ? !details.hidden : false;
      detailsToggle.hidden = appUpdateLocked || (!artifactState.size && !setupLog.length);
      detailsToggle.disabled = false;
      detailsToggle.setAttribute("aria-expanded", String(visible));
      detailsToggle.textContent = visible ? "Hide details" : "Show details";
    }
  }

  function syncDetailsState() {
    const card = $("#nativeSetup");
    const details = $("#setupDetails");
    const visible = !appUpdateLocked && detailsTouched && detailsOpen;
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
      if (!updateRunning) {
        const status = await refreshUpdateAvailability();
        if (appUpdateLocked) renderStoredUpdate(status);
      }
      if (updateStatusPollTimer === null) scheduleUpdateStatusPoll();
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
        order: 20
      };
    }

    if (kind === "embedding-vector-db" || searchable.includes("embedding")) {
      return {
        key: "embeddings",
        label: "Embeddings",
        kind: "embedding-vector-db",
        order: 30
      };
    }

    if (kind === "dictionary-database" || searchable.includes("dictionary")) {
      return {
        key: "dictionary",
        label: "Dictionary",
        kind: "dictionary-database",
        order: 40
      };
    }

    return {
      key: "assets",
      label: "Assets",
      kind: "asset-group",
      order: 10
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
    if (status?.dictionary) {
      rows.push({
        key: status.dictionary.key || "dictionary",
        label: status.dictionary.label || "Dictionary",
        kind: status.dictionary.kind || status.dictionary.artifactKind || status.dictionary.artifact_kind || "dictionary-database",
        ready: Boolean(status.dictionary.ready || status.dictionary.verified || status.dictionary.available),
        bytes: status.dictionary.bytes || 0,
        expectedBytes: status.dictionary.expectedBytes || 0
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
    const rows = artifactRows(status);
    if (!rows.length) return;
    artifactState.clear();
    rows.forEach((item) => {
      const key = artifactKey(item);
      artifactState.set(key, {
        ...item,
        key,
        bytes: Number(item.bytes || 0),
        expectedBytes: Number(item.expectedBytes || 0),
        ready: Boolean(item.ready),
        active: Boolean(item.active && !item.ready),
        error: item.ready ? "" : item.error || ""
      });
    });
  }

  function updateArtifactFromEvent(message) {
    const key = message.artifactKey || message.key || message.label || "current";
    const existing = artifactState.get(key) || {};
    const totalBytes = Number(message.totalBytes || existing.expectedBytes || 0);
    const bytes = Number(message.bytes || existing.bytes || 0);
    const ready = Boolean(existing.ready || setupProgressUi().messageMarksReady(message));
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
    return setupProgressUi().totalsFromArtifacts(
      [...artifactState.values()],
      { setupReady: setupComplete }
    );
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
      icon.textContent = item.ready ? "\u2713" : item.error ? "!" : item.active ? "\u2022" : "\u00b7";
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
    container.replaceChildren(...setupLog.slice(-5).map((item) => {
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
    if (card) {
      card.classList.toggle("is-error", kind === "error");
      card.classList.toggle("is-verifying", totals.verifying && !setupComplete);
    }
    setText("#setupCount", `${Math.min(totals.readyArtifacts, totals.artifactCount)}/${totals.artifactCount || "?"}`);
    const displayKind = totals.verifying && kind !== "error" && kind !== "ready" ? "verify" : kind;
    const defaultMessage = totals.verifying
      ? `Download finished. Checking ${totals.verifyingArtifacts} ${totals.verifyingArtifacts === 1 ? "file" : "files"} before setup can finish.`
      : setupMessage(totals.progress, label);
    setText("#setupPhase", phaseText(displayKind));
    setText("#setupMessage", message || defaultMessage);
    setProgress(
      totals.progress,
      bytesText,
      `${Math.floor(totals.progress)}%, ${totals.readyArtifacts} of ${totals.artifactCount} files verified`
    );
    renderArtifacts();
    setControls();
  }

  function renderStatus(status, message = "") {
    syncArtifactState(status);
    const ready = Boolean(status?.ready) && totalReady();
    setupComplete = ready;
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
    setNavigationLocked(appUpdateLocked || !ready);
    if (ready) pushLog("ready", "Setup complete", readyText);
  }

  function applyStageArt() {
    startStageAnimation();
  }

  function setNavigationLocked(locked) {
    navigationLocked = locked;
    document.body.classList.toggle("setup-blocked", locked);
    document.body.classList.toggle("app-update-lock", appUpdateLocked);
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
    document.querySelectorAll("[data-caatuu-app-header] a, [data-caatuu-app-header] button").forEach((node) => {
      if (appUpdateLocked) {
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
      const selector = appUpdateLocked
        ? "[data-caatuu-bottom-nav] a, [data-caatuu-bottom-nav] button, [data-caatuu-app-header] a, [data-caatuu-app-header] button"
        : "[data-caatuu-bottom-nav] a, [data-caatuu-bottom-nav] button";
      const target = event.target.closest(selector);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      const message = appUpdateLocked
        ? "Finish or retry the app update before opening other sections."
        : "Finish setup before opening app sections.";
      pushLog("status", "Navigation blocked", message);
      setText("#setupMessage", message);
    }, true);
  }

  function renderSetupEvent(message) {
    if (message.kind === "progress") {
      updateArtifactFromEvent(message);
      const totals = totalsFromArtifacts();
      const group = displayGroupFor(artifactState.get(message.artifactKey) || message);
      const displayRow = displayArtifactRows().find((item) => item.key === group.key);
      const label = displayRow?.label || group.label || message.label || "Artifact";
      latestSetupLabel = label;
      updateSummary("", totals.verifying ? "verify" : "progress", label);
      maybeLogProgress(message);
      return;
    }

    if (message.kind === "status") {
      const itemReady = setupProgressUi().messageMarksReady(message);
      if (itemReady && message.artifactKey) {
        updateArtifactFromEvent({
          ...message,
          ready: true,
          bytes: artifactState.get(message.artifactKey)?.expectedBytes || 1,
          totalBytes: artifactState.get(message.artifactKey)?.expectedBytes || 1
        });
      }
      const group = displayGroupFor(artifactState.get(message.artifactKey) || message);
      const displayRow = displayArtifactRows().find((item) => item.key === group.key);
      const label = displayRow?.label || group.label || message.label || "";
      const kind = setupComplete ? "ready" : "status";
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
    setupComplete = false;
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
    setText("#setupPhase", phaseText("verify"));
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
      if (result?.ok === false) throw new Error(result.message || "Could not send the bug report.");
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
    setupComplete = false;
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
    setText("#setupPhase", phaseText("abort"));
    setText("#setupMessage", "Stopping setup. Caatuu will keep files that were already verified.");
    setControls();

    try {
      const result = await runtime.setup.abort();
      nativeSetupActive = false;
      const status = artifactRows(result).length ? result : await runtime.setup.status();
      syncArtifactState(status);
      const scope = setupMode === "browser" ? "Browser setup" : "Android setup";
      stopSetupUi(`${scope} stopped. Active downloads were cancelled.`);
    } catch (error) {
      stopSetupUi(error?.message || "Setup abort did not finish cleanly.");
    }
  }

  async function updateApp() {
    if (updateRunning) return;
    if (!hasNativeRuntime()) {
      setupUpdateStatus = { updateAvailable: false };
      clearAppUpdateHandoff();
      setControls();
      return;
    }

    clearUpdateStatusPoll();
    updateRunning = true;
    appUpdateUiState = "checking";
    setText("#setupTitle", "Checking for an update");
    setText("#setupPhase", "App update");
    setText("#setupMessage", "Contacting the update server.");
    setText("#setupCount", "Checking");
    setProgress(0, "Contacting server", "Checking the update server");
    $("#nativeSetup")?.classList.toggle("is-error", false);
    setNavigationLocked(appUpdateLocked || !setupComplete);
    setControls();

    try {
      const status = await refreshUpdateAvailability();
      const storedState = updateDownloadState(status);
      if (!hasAppUpdate(status)) {
        const completed = appUpdateLocked && installedUpdateReached(status);
        if (updateStatusProblem(status)) {
          const message = status?.updateError || "The update server could not be reached.";
          pushLog("error", "Update check failed", message);
          setText("#setupTitle", "Update check failed");
          setText("#setupPhase", "Update unavailable");
          setText("#setupMessage", `Could not check for an app update. ${message}`);
          setText("#setupCount", "Try again");
          setProgress(0, "Not downloaded", "Update check failed");
          $("#nativeSetup")?.classList.toggle("is-error", true);
          appUpdateUiState = "retry";
        } else {
          const label = updateStatusLabel(status);
          pushLog("ready", "App is current", `No newer APK is exposed by the server (${label}).`);
          setText("#setupTitle", "Caatuu is current");
          setText("#setupPhase", "App is current");
          setText("#setupMessage", completed
            ? `Caatuu ${status?.currentVersionName || status?.currentVersionCode || ""} is installed and ready.`
            : `No newer app update is exposed by the server (${label}).`);
          setText("#setupCount", "Current");
          setProgress(setupComplete ? 100 : 0, setupComplete ? "Ready" : "No update", "No app update is required");
          $("#nativeSetup")?.classList.toggle("is-error", false);
        }
        if (!updateStatusProblem(status)) {
          if (appUpdateLocked) clearAppUpdateHandoff();
          setNavigationLocked(!setupComplete);
        } else {
          setNavigationLocked(true);
        }
        return;
      }

      appUpdateLocked = true;
      setNavigationLocked(true);
      setControls();

      if (setupRunning || nativeSetupActive) {
        pushLog("status", "Update requested", "Stopping setup before updating.");
        setText("#setupPhase", "App update");
        setText("#setupMessage", "Stopping setup so Android can install the app update.");
        await abortSetup();
      }

      pushLog("status", "Update requested", "Checking APK update.");
      appUpdateUiState = storedState === "ready" ? "installer" : "downloading";
      setText("#setupTitle", storedState === "ready" ? "Installing Caatuu" : "Updating Caatuu");
      setText("#setupPhase", storedState === "ready" ? "Opening installer" : storedState === "partial" ? "Resuming download" : "Downloading update");
      setText("#setupMessage", storedState === "ready"
        ? "The verified APK is ready. Opening the Android installer."
        : storedState === "partial"
          ? "Resuming the saved update download."
          : "Downloading the verified Android update.");
      setText("#setupCount", storedState === "ready" ? "Installing" : storedState === "partial" ? "Resuming" : "Downloading");
      if (storedState === "ready") {
        setProgress(100, "APK verified", "100%, opening the Android installer");
      } else if (storedState === "partial") {
        const bytes = Number(status?.partialBytes || 0);
        const totalBytes = Number(status?.latestBytes || 0);
        setProgress(
          updateDownloadPercent(status),
          totalBytes > 0 ? `${formatBytes(bytes)} / ${formatBytes(totalBytes)}` : formatBytes(bytes),
          `${Math.floor(updateDownloadPercent(status))}%, resuming the app update download`
        );
      } else {
        setProgress(0, "Starting download", "Starting the app update download");
      }
      setControls();

      const result = await runtime.maintenance.updateApp({
        onEvent(message) {
          if (message.kind === "progress") {
            appUpdateUiState = "downloading";
            const bytes = Number(message.bytes || 0);
            const totalBytes = Number(message.totalBytes || 0);
            const rawProgress = totalBytes > 0 ? bytes / totalBytes * 100 : 0;
            const downloaded = totalBytes > 0 && bytes >= totalBytes;
            if (downloaded) appUpdateUiState = "verifying";
            setControls();
            const progress = Math.min(99, rawProgress);
            setText("#setupPhase", downloaded ? "Verifying update" : "Downloading update");
            setText("#setupMessage", downloaded
              ? "Download complete. Verifying the APK before Android can open it."
              : `Downloading update ${formatBytes(bytes)} / ${formatBytes(totalBytes)}.`);
            setText("#setupCount", downloaded ? "Verifying" : "Downloading");
            setProgress(
              progress,
              totalBytes > 0 ? `${formatBytes(bytes)} / ${formatBytes(totalBytes)}` : formatBytes(bytes),
              downloaded ? "99%, verifying the app update" : `${Math.floor(progress)}%, downloading the app update`
            );
            maybeLogProgress({
              ...message,
              label: "App update",
              artifactKey: "app-update"
            });
            return;
          }
          if (message.kind === "status") {
            if (storedState !== "ready") appUpdateUiState = "verifying";
            setControls();
            setText("#setupPhase", storedState === "ready" ? "Opening installer" : "Verifying update");
            setText("#setupCount", storedState === "ready" ? "Installing" : "Verifying");
            setText("#setupMessage", message.message || "Preparing update.");
            pushLog("status", message.message || "Preparing update.", "APK");
          }
        }
      });
      const action = result.action === "settings" ? "Android install permission opened." : "Android installer opened.";
      appUpdateUiState = "installer";
      pushLog("ready", "Update ready", action);
      setText("#setupPhase", "Update verified");
      setText("#setupMessage", `${action} Confirm the update there.`);
      setText("#setupCount", "Verified");
      setProgress(100, "APK verified", "100%, app update verified");
    } catch (error) {
      pushLog("error", "Update failed", error?.message || String(error));
      setText("#setupTitle", "Update stopped");
      setText("#setupPhase", "Update failed");
      setText("#setupMessage", error?.message || "Could not start the update.");
      setText("#setupCount", "Try again");
      setProgress(0, "Not installed", "App update failed");
      $("#nativeSetup")?.classList.toggle("is-error", true);
      appUpdateUiState = "retry";
    } finally {
      updateRunning = false;
      setNavigationLocked(appUpdateLocked || !setupComplete);
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
    $("#setupAction")?.addEventListener("click", () => {
      if (appUpdateLocked) void updateApp();
      else void startSetup();
    });
    $("#setupAbort")?.addEventListener("click", abortSetup);
    $("#setupReportBug")?.addEventListener("click", reportSetupAttention);
    document.addEventListener("click", handleDetailsToggle, true);
    pushLog("status", "Setup check started", "Looking for local files.");

    try {
      if (!hasNativeRuntime()) {
        setupMode = "browser";
        if (appUpdateLocked) clearAppUpdateHandoff();
        const status = await runtime.setup.status();
        renderStatus(status);
        if (!status.ready) await startSetup();
        return;
      }

      setupMode = "native";
      const status = await runtime.setup.status();
      renderStatus(status);
      if (appUpdateLocked) {
        setText("#setupTitle", "Updating Caatuu");
        setText("#setupPhase", "App update");
        setText("#setupMessage", "Checking whether the confirmed update is already downloaded.");
        const updateStatus = await refreshUpdateAvailability();
        if (renderStoredUpdate(updateStatus)) {
          setNavigationLocked(true);
          return;
        }
        appUpdateUiState = hasAppUpdate(updateStatus) ? "available" : "checking";
        await updateApp();
        return;
      }
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
