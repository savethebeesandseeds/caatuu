(() => {
  const UPDATE_INTENT_KEY = "caatuu-czech.pendingAppUpdate.v1";
  const UPDATE_STATUS_FRESH_MS = 3 * 60 * 1000;
  let sharedUpdateController = null;

  function updateDownloadState(status) {
    const current = Number(status?.currentVersionCode || 0);
    const latest = Number(status?.latestVersionCode || 0);
    const downloaded = Number(status?.downloadedVersionCode || latest || 0);
    const targetsNewerVersion = downloaded <= 0 || downloaded > current;
    const matchesLatest = latest <= 0 || downloaded <= 0 || downloaded === latest;
    const nativeState = String(status?.downloadState || "").toLowerCase();
    if ((status?.downloadReady || status?.readyToInstall) && targetsNewerVersion && matchesLatest) return "ready";
    if (targetsNewerVersion && (
      status?.downloadActive ||
      ["downloading", "pending", "running"].includes(nativeState)
    )) return "active";
    if (targetsNewerVersion && nativeState === "failed") return "failed";
    if (targetsNewerVersion && (
      status?.resumable ||
      ["partial", "paused"].includes(nativeState) ||
      (Number(status?.partialBytes || 0) > 0 && (latest <= 0 || latest > current))
    )) return "partial";
    return "idle";
  }

  function updateDownloadPercent(status) {
    const explicit = Number(status?.downloadProgress);
    if (Number.isFinite(explicit) && explicit > 0) {
      return Math.max(0, Math.min(99, explicit <= 1 ? explicit * 100 : explicit));
    }
    const bytes = Number(status?.partialBytes || 0);
    const total = Number(status?.latestBytes || 0);
    if (bytes <= 0 || total <= 0) return 0;
    return Math.max(0, Math.min(99, bytes / total * 100));
  }

  function hasNativeAppUpdate(status) {
    if (status?.selfUpdateEnabled === false) return false;
    const latest = Number(status?.latestVersionCode || status?.downloadedVersionCode || 0);
    const current = Number(status.currentVersionCode || 0);
    if (updateDownloadState(status) !== "idle") return latest > current;
    if (!status?.updateAvailable) return false;
    return latest > current;
  }

  function setUpdateAppControl(button, runtime, status, { busy = false } = {}) {
    if (!button) return;
    const native = runtime?.env === "android";
    const selfUpdateEnabled = status?.selfUpdateEnabled !== false;
    const available = native && hasNativeAppUpdate(status);
    const visible = native && selfUpdateEnabled;
    const downloadState = updateDownloadState(status);
    button.hidden = !visible;
    button.disabled = busy || !visible || downloadState === "active";
    const latestName = String(status?.latestVersionName || "").trim();
    const currentName = String(status?.currentVersionName || "").trim();
    const statusProblem = status?.serverReachable === false || Boolean(status?.updateError);
    button.textContent = busy
      ? "Checking for updates..."
      : available && downloadState === "ready"
        ? `Install${latestName ? ` ${latestName}` : " update"}`
        : available && downloadState === "active"
          ? `Downloading ${updateDownloadPercent(status).toFixed(0)}%`
        : available && downloadState === "partial"
          ? "Resume update"
          : available && downloadState === "failed"
            ? "Retry update"
          : available
            ? `Update${latestName ? ` ${latestName}` : ""}`
            : statusProblem
              ? "Retry check"
              : "Check for updates";
    button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
    button.setAttribute("aria-busy", busy ? "true" : "false");
    button.classList?.toggle("is-busy", busy);
    const row = button.closest("[data-maintenance-action-row]");
    if (row) {
      row.hidden = !visible;
      row.classList?.toggle("is-busy", busy);
      const copy = row.querySelector?.("[data-update-app-copy]");
      if (copy && visible) {
        copy.textContent = busy
          ? "Contacting the update server. This can take a few seconds."
          : available && downloadState === "ready"
            ? `Version ${latestName || status?.downloadedVersionName || status?.latestVersionCode || "new"} is already downloaded and verified. Install it now.`
            : available && downloadState === "active"
              ? `Version ${latestName || status?.latestVersionCode || "new"} is downloading in the background (${updateDownloadPercent(status).toFixed(0)}%).`
            : available && downloadState === "partial"
              ? `${updateDownloadPercent(status).toFixed(0)}% of version ${latestName || status?.latestVersionCode || "new"} is saved. Resume without starting over.`
              : available && downloadState === "failed"
                ? "The saved update download stopped. Retry it without losing a valid completed installer."
              : available
                ? `Version ${latestName || status?.latestVersionCode || "new"} is available. Installed: ${currentName || status?.currentVersionCode || "unknown"}.`
                : statusProblem
                  ? "The last update check did not finish. Try checking again."
                  : `Installed version ${currentName || status?.currentVersionCode || "unknown"}. Check for a newer version.`;
      }
    }
  }

  function createUpdateController(runtime = window.CaatuuRuntime) {
    const button = document.querySelector("#updateApp");
    if (!button || !runtime?.maintenance) return null;
    let currentStatus = null;
    let checkedAt = 0;
    let inFlight = null;

    const statusNode = () => document.querySelector("#maintenanceStatus");
    const versionNode = () => document.querySelector("#settingsVersion");
    const setMessage = (message) => {
      const node = statusNode();
      if (node) node.textContent = message;
    };
    const render = (status = currentStatus, { busy = false } = {}) => {
      setUpdateAppControl(button, runtime, status || { updateAvailable: false }, { busy });
      if (runtime.env === "android") {
        setVersionNote(versionNode(), status);
      } else {
        const node = versionNode();
        if (node) node.textContent = "Browser app - use Update to load the latest version";
      }
      const browserInstall = document.querySelector("#browserInstallActions");
      if (browserInstall) browserInstall.hidden = runtime.env === "android";
    };

    async function refresh({ force = false, announce = true } = {}) {
      if (runtime.env !== "android") {
        render({ updateAvailable: false, selfUpdateEnabled: false });
        try {
          const status = await runtime.maintenance.updateStatus();
          currentStatus = status;
          if (status?.currentVersionName || status?.currentVersionCode) setVersionNote(versionNode(), status);
        } catch (error) {
          // Browser version metadata is optional.
        }
        return currentStatus;
      }
      if (!force && currentStatus && Date.now() - checkedAt < UPDATE_STATUS_FRESH_MS) {
        render(currentStatus);
        if (announce) setMessage(updateStatusLine(currentStatus));
        return currentStatus;
      }
      if (inFlight) return inFlight;

      render(currentStatus || { updateAvailable: false, selfUpdateEnabled: true }, { busy: true });
      if (announce) setMessage("Checking the update server...");
      inFlight = runtime.maintenance.updateStatus()
        .then((status) => {
          currentStatus = status;
          checkedAt = Date.now();
          render(status);
          if (announce) setMessage(updateStatusLine(status));
          return status;
        })
        .catch((error) => {
          currentStatus = {
            updateAvailable: false,
            serverReachable: false,
            updateError: error?.message || String(error)
          };
          render(currentStatus);
          setMessage(`Update check failed. ${currentStatus.updateError}`);
          return currentStatus;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    }

    async function activate() {
      if (inFlight) return inFlight;
      const status = await refresh({ force: true, announce: true });
      if (!hasNativeAppUpdate(status)) return status;

      setMessage(`Update ${status.latestVersionName || status.latestVersionCode || "available"} is ready for confirmation.`);
      const confirmed = await confirmAppUpdate(status);
      if (!confirmed) {
        setMessage("Update postponed. You can start it here whenever you are ready.");
        return status;
      }
      render(status, { busy: true });
      setMessage("Opening Setup for the app update...");
      beginAppUpdate(status);
      return status;
    }

    button.dataset.sharedUpdateControl = "true";
    button.addEventListener("click", activate);
    render({ updateAvailable: false, selfUpdateEnabled: runtime.env === "android" });
    return Object.freeze({ activate, refresh, render });
  }

  function getUpdateController() {
    if (!sharedUpdateController) sharedUpdateController = createUpdateController();
    return sharedUpdateController;
  }

  function refreshSharedUpdateControl(options) {
    return getUpdateController()?.refresh(options);
  }

  function updateConfirmation(status) {
    const latest = status?.latestVersionName || status?.latestVersionCode || "the latest version";
    const current = status?.currentVersionName || status?.currentVersionCode || "unknown";
    const downloadState = updateDownloadState(status);
    if (downloadState === "ready") {
      return {
        latest,
        current,
        title: `Install Caatuu ${latest}?`,
        versions: `Installed: ${current}. Downloaded and verified: ${latest}.`,
        action: `Install ${latest}`
      };
    }
    if (downloadState === "partial") {
      return {
        latest,
        current,
        title: `Resume Caatuu ${latest}?`,
        versions: `Installed: ${current}. Downloaded: ${updateDownloadPercent(status).toFixed(0)}% of ${latest}.`,
        action: "Resume update"
      };
    }
    return {
      latest,
      current,
      title: `Install Caatuu ${latest}?`,
      versions: `Installed: ${current}. Available: ${latest}.`,
      action: `Update to ${latest}`
    };
  }

  function confirmAppUpdate(status) {
    const confirmation = updateConfirmation(status);
    const dialog = document.querySelector("#appUpdateConfirmDialog");
    if (!dialog || typeof dialog.showModal !== "function") {
      return Promise.resolve(window.confirm?.(`Update Caatuu from ${confirmation.current} to ${confirmation.latest}?`) ?? false);
    }

    const title = dialog.querySelector("#appUpdateConfirmTitle");
    const versions = dialog.querySelector("#appUpdateConfirmVersions");
    const action = dialog.querySelector("#appUpdateConfirmAction");
    if (title) title.textContent = confirmation.title;
    if (versions) versions.textContent = confirmation.versions;
    if (action) action.textContent = confirmation.action;
    dialog.returnValue = "";

    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
      dialog.showModal();
    });
  }

  function beginAppUpdate(status) {
    const intent = {
      requestedAt: new Date().toISOString(),
      currentVersionCode: Number(status?.currentVersionCode || 0),
      currentVersionName: String(status?.currentVersionName || ""),
      latestVersionCode: Number(status?.latestVersionCode || 0),
      latestVersionName: String(status?.latestVersionName || "")
    };
    try {
      window.localStorage.setItem(UPDATE_INTENT_KEY, JSON.stringify(intent));
    } catch (error) {
      // The query parameter still preserves the handoff if session storage is unavailable.
    }
    window.location.href = `home.html?app-update=1&version=${encodeURIComponent(intent.latestVersionName || intent.latestVersionCode || "latest")}`;
  }

  function pendingAppUpdate() {
    try {
      const value = JSON.parse(window.localStorage.getItem(UPDATE_INTENT_KEY) || "null");
      return value && typeof value === "object" ? value : null;
    } catch (error) {
      return null;
    }
  }

  function clearPendingAppUpdate() {
    try {
      window.localStorage.removeItem(UPDATE_INTENT_KEY);
    } catch (error) {
      // Nothing else is required when storage is unavailable.
    }
  }

  function updateStatusLine(status) {
    const versionName = status?.currentVersionName || "unknown";
    const versionCode = status?.currentVersionCode || "?";
    if (status?.selfUpdateEnabled === false) {
      return `Caatuu ${versionName} (${versionCode}). Updates are managed by the app store.`;
    }
    if (hasNativeAppUpdate(status)) {
      const latestName = status.latestVersionName || "latest";
      const latestCode = status.latestVersionCode || "?";
      const downloadState = updateDownloadState(status);
      if (downloadState === "ready") {
        return `Caatuu ${latestName} (${latestCode}) is downloaded and verified. It is ready to install.`;
      }
      if (downloadState === "active") {
        return `Caatuu ${latestName} (${latestCode}) is downloading in the background (${updateDownloadPercent(status).toFixed(0)}%).`;
      }
      if (downloadState === "partial") {
        return `Caatuu ${latestName} (${latestCode}) is ${updateDownloadPercent(status).toFixed(0)}% downloaded and can be resumed.`;
      }
      if (downloadState === "failed") {
        return `The Caatuu ${latestName} (${latestCode}) download stopped and can be retried.`;
      }
      return `Update available: ${latestName} (${latestCode}). Installed: ${versionName} (${versionCode}).`;
    }
    if (status?.serverReachable === false || status?.updateError) {
      const detail = status?.updateError ? ` ${status.updateError}` : "";
      return `Caatuu ${versionName} (${versionCode}). Could not check for updates.${detail}`;
    }
    return `Caatuu ${versionName} (${versionCode}). App is up to date.`;
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
    updateDownloadState,
    updateDownloadPercent,
    setUpdateAppControl,
    createUpdateController,
    getUpdateController,
    refreshSharedUpdateControl,
    updateConfirmation,
    confirmAppUpdate,
    beginAppUpdate,
    pendingAppUpdate,
    clearPendingAppUpdate,
    updateStatusLine,
    versionLine,
    setVersionNote,
    updateProgressMessage,
    updateResultMessage,
    cacheResultMessage
  });

  if (typeof document !== "undefined") {
    const bindSharedControl = () => getUpdateController();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bindSharedControl, { once: true });
    } else {
      bindSharedControl();
    }
    document.addEventListener("caatuu:settings-open", () => {
      void refreshSharedUpdateControl({ force: true, announce: true });
    });
  }
})();
