(() => {
  const $ = (selector) => document.querySelector(selector);
  const runtime = window.CaatuuRuntime;
  const maxLogEntries = 36;
  let setupRunning = false;
  let setupAborted = false;
  let nativeSetupActive = false;
  let updateRunning = false;
  let navigationLocked = false;
  let setupMode = "native";
  let detailsOpen = false;
  let detailsTouched = false;
  let setupUpdateStatus = null;
  let setupStatusPollTimer = null;
  const artifactState = new Map();
  const setupLog = [];
  const progressLogBuckets = new Map();

  const setupMessages = [
    { max: 4, text: "Caatuu is checking the phone before packing the local brain." },
    { max: 18, text: "The Czech examples are moving into local storage." },
    { max: 36, text: "The translator is landing next to the Czech practice model." },
    { max: 54, text: "The embeddings map is getting ready for fast local lookup." },
    { max: 72, text: "Caatuu is becoming useful without asking the browser for help." },
    { max: 88, text: "Every byte is being checked before the app trusts it." },
    { max: 99.5, text: "Almost ready. The offline workspace is closing the suitcase." },
    { max: Infinity, text: "Ready. Caatuu can work from local storage." }
  ];

  function hasNativeRuntime() {
    return runtime?.env === "android";
  }

  function setText(selector, value) {
    const node = $(selector);
    if (node) node.textContent = value;
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

  function setupMessage(progress, label = "") {
    const percent = clampPercent(progress);
    const message = setupMessages.find((item) => percent <= item.max)?.text || setupMessages[setupMessages.length - 1].text;
    return `(${percent.toFixed(0)}%) ${label ? `${label}: ` : ""}${message}`;
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
    setText("#setupProgressText", `${percent.toFixed(0)}%`);
    if (bytesText) setText("#setupBytes", bytesText);
  }

  function setControls() {
    const action = $("#setupAction");
    const abort = $("#setupAbort");
    const update = $("#setupUpdate");
    const detailsToggle = $("#setupDetailsToggle");
    const ready = totalReady();
    const setupActive = setupRunning || nativeSetupActive;
    const updateAvailable = hasNativeRuntime() && hasAppUpdate();
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
      update.hidden = !updateRunning && (!updateAvailable || setupActive);
      update.disabled = updateRunning || setupActive || !updateAvailable;
      update.textContent = updateRunning ? "Updating" : "Update App";
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
        ready: Boolean(item.ready)
      });
    });
  }

  function updateArtifactFromEvent(message) {
    const key = message.artifactKey || message.key || message.label || "current";
    const existing = artifactState.get(key) || {};
    const totalBytes = Number(message.totalBytes || existing.expectedBytes || 0);
    const bytes = Number(message.bytes || existing.bytes || 0);
    artifactState.set(key, {
      ...existing,
      key,
      label: message.label || existing.label || key,
      kind: message.artifactKind || existing.kind || message.phase || "artifact",
      bytes: Math.max(bytes, Number(existing.bytes || 0)),
      expectedBytes: totalBytes,
      ready: bytes > 0 && totalBytes > 0 && bytes >= totalBytes
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
    const rows = [...artifactState.values()];
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "setup-artifact";
      empty.dataset.ready = "false";
      empty.dataset.kind = "manifest";
      empty.style.setProperty("--artifact-progress", "0%");
      empty.innerHTML = "<strong>Setup manifest</strong><span>0%</span>";
      container.replaceChildren(empty);
      return;
    }
    container.replaceChildren(...rows.map((item) => {
      const row = document.createElement("div");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      const percent = artifactPercent(item);
      row.className = "setup-artifact";
      row.dataset.ready = item.ready ? "true" : "false";
      row.dataset.kind = item.kind || "artifact";
      row.style.setProperty("--artifact-progress", `${percent}%`);
      title.textContent = item.label || item.key || "Artifact";
      meta.textContent = item.ready ? `${percent.toFixed(0)}% ready` : `${percent.toFixed(0)}%`;
      meta.title = `${formatBytes(item.bytes)} / ${formatBytes(item.expectedBytes || item.bytes)}`;
      row.append(title, meta);
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
    const label = message.label || "Artifact";
    const totalBytes = Number(message.totalBytes || 0);
    const bytes = Number(message.bytes || 0);
    if (!totalBytes) return;
    const percent = clampPercent(bytes / totalBytes * 100);
    const bucket = Math.floor(percent / 20) * 20;
    const key = `${message.artifactKey || label}:progress`;
    if (progressLogBuckets.get(key) === bucket && percent < 100) return;
    progressLogBuckets.set(key, bucket);
    pushLog("progress", `Downloading ${label}`, `${formatBytes(bytes)} / ${formatBytes(totalBytes)}`);
  }

  function updateSummary(message = "", kind = "status", label = "") {
    const totals = totalsFromArtifacts();
    const bytesText = totals.expectedBytes > 0
      ? `${formatBytes(totals.bytes)} / ${formatBytes(totals.expectedBytes)}`
      : `${totals.readyArtifacts} of ${totals.artifactCount || 0} ready`;
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
    if (card) card.classList.toggle("is-ready", ready);
    setText("#setupTitle", ready ? "Caatuu is ready" : "Preparing Caatuu");
    updateSummary(message || (ready ? readyText : "Preparing local intelligence."), ready ? "ready" : "status");
    if (ready || !hasNativeRuntime()) applyStageArt();
    setNavigationLocked(!ready);
    if (ready) pushLog("ready", "Setup complete", readyText);
  }

  function applyStageArt() {
    const art = $(".stage-art");
    const src = art?.dataset.setupArtSrc;
    if (art && src && art.getAttribute("src") !== src) {
      art.src = src;
    }
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
      const label = message.label || "Artifact";
      const bytesText = `${formatBytes(totals.bytes)} / ${formatBytes(totals.expectedBytes || message.totalBytes)}`;
      setText(
        "#setupMessage",
        `${setupMessage(totals.progress, label)} ${formatBytes(message.bytes)} / ${formatBytes(message.totalBytes)}.`
      );
      setText("#setupPhase", phaseText("progress", label));
      setProgress(totals.progress, bytesText);
      renderArtifacts();
      maybeLogProgress(message);
      return;
    }

    if (message.kind === "status") {
      const label = message.label || "";
      const kind = String(message.phase || "").includes("ready") ? "ready" : "status";
      if (kind === "ready" && message.artifactKey) {
        updateArtifactFromEvent({
          ...message,
          bytes: artifactState.get(message.artifactKey)?.expectedBytes || 1,
          totalBytes: artifactState.get(message.artifactKey)?.expectedBytes || 1
        });
      }
      updateSummary(message.message || setupMessage(totalsFromArtifacts().progress, label), kind, label);
      pushLog(kind, message.message || (label ? `Preparing ${label}` : "Setup event"), message.phase || "");
    }
  }

  function stopSetupUi(message = "Setup stopped. You can retry or update the app.") {
    setupRunning = false;
    setupAborted = true;
    nativeSetupActive = false;
    setNavigationLocked(true);
    setText("#setupTitle", "Setup stopped");
    updateSummary(message, "error");
    pushLog("error", "Setup stopped", message);
    setControls();
  }

  async function startSetup() {
    if (setupRunning || updateRunning) return;
    clearSetupStatusPoll();
    setupRunning = true;
    setupAborted = false;
    progressLogBuckets.clear();
    setControls();
    pushLog("status", "Setup started", setupMode === "browser" ? "Caching browser files." : "Preparing local app storage.");

    try {
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
    if (setupRunning) {
      pushLog("status", "Update held", "Finish or abort setup before updating Caatuu.");
      setText("#setupMessage", "Finish or abort setup before updating Caatuu.");
      setControls();
      return;
    }
    if (!hasNativeRuntime()) {
      setupUpdateStatus = { updateAvailable: false };
      setControls();
      return;
    }

    const status = await refreshUpdateAvailability();
    if (!hasAppUpdate(status)) {
      pushLog("ready", "App is current", "No newer APK is exposed by the server.");
      setControls();
      return;
    }

    updateRunning = true;
    setControls();

    if (setupRunning) {
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
    }
  }

  async function initSetup() {
    const card = $("#nativeSetup");
    if (!card) return;
    card.hidden = false;
    bindNavigationLock();
    setNavigationLocked(true);
    $("#setupAction")?.addEventListener("click", startSetup);
    $("#setupAbort")?.addEventListener("click", abortSetup);
    $("#setupDetailsToggle")?.addEventListener("click", handleDetailsToggle);
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
