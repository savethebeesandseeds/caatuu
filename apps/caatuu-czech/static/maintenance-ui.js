(() => {
  function hasNativeAppUpdate(status) {
    if (!status?.updateAvailable) return false;
    const latest = Number(status.latestVersionCode || 0);
    const current = Number(status.currentVersionCode || 0);
    return latest > current;
  }

  function setUpdateAppControl(button, runtime, status, { busy = false } = {}) {
    if (!button) return;
    const available = runtime?.env === "android" && hasNativeAppUpdate(status);
    button.hidden = !busy && !available;
    button.disabled = busy || !available;
    button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
    const row = button.closest("[data-maintenance-action-row]");
    if (row) row.hidden = button.hidden;
  }

  function updateStatusLine(status) {
    const versionName = status?.currentVersionName || "unknown";
    const versionCode = status?.currentVersionCode || "?";
    if (hasNativeAppUpdate(status)) {
      const latestName = status.latestVersionName || "latest";
      const latestCode = status.latestVersionCode || "?";
      return `Update available: ${latestName} (${latestCode}). Installed: ${versionName} (${versionCode}).`;
    }
    return `Android native ${versionName} (${versionCode}). App is up to date.`;
  }

  function versionLine(status, fallback = "Version unknown") {
    const versionName = status?.currentVersionName;
    const versionCode = status?.currentVersionCode;
    if (versionName || versionCode) {
      return `Version ${versionName || "unknown"} (${versionCode || "?"})`;
    }
    return fallback;
  }

  function setVersionNote(element, status) {
    if (!element) return;
    const fallback = element.dataset.fallbackVersion || element.textContent.trim() || "Version unknown";
    element.textContent = versionLine(status, fallback);
  }

  function updateProgressMessage(message, formatBytes) {
    if (message?.kind === "progress" && message.phase === "download") {
      const total = Number(message.totalBytes || 0);
      const bytes = Number(message.bytes || 0);
      const pct = total > 0 ? ` ${(bytes / total * 100).toFixed(1)}%` : "";
      return `Downloading update ${formatBytes(bytes)} / ${formatBytes(total)}${pct}`;
    }
    if (message?.kind === "status") return message.message || "Preparing update.";
    return "";
  }

  function updateResultMessage(result) {
    const installerPrefix = result?.reused
      ? "Using the already downloaded verified APK. "
      : result?.resumed
        ? "Download resumed and verified. "
        : "";
    if (result?.action === "settings") {
      return `${installerPrefix}Android opened install permission settings. Allow installs for Caatuu, then tap Update App again.`;
    }
    return `${installerPrefix}Android installer opened. Confirm the update there.`;
  }

  function cacheResultMessage(result, formatBytes, { storageScopeFallback = "local cache", includeStorageScope = true } = {}) {
    const updateBytes = result?.updateApk?.bytesDeleted || 0;
    const updateText = updateBytes > 0 ? ` Cached update APK removed: ${formatBytes(updateBytes)}.` : "";
    const scope = includeStorageScope ? ` from ${result?.storageScope || storageScopeFallback}` : ` from ${storageScopeFallback}`;
    return `Cleared ${formatBytes(result?.bytesDeleted || 0)}${scope}.${updateText}`;
  }

  window.CaatuuMaintenanceUi = Object.freeze({
    hasNativeAppUpdate,
    setUpdateAppControl,
    updateStatusLine,
    versionLine,
    setVersionNote,
    updateProgressMessage,
    updateResultMessage,
    cacheResultMessage
  });
})();
