(() => {
  const UPDATE_INTENT_KEY = "caatuu.pendingAppUpdate.v1";
  const UPDATE_STATUS_FRESH_MS = 3 * 60 * 1000;
  const interfaceContent = globalThis.CaatuuI18n;
  if (!interfaceContent || typeof interfaceContent.t !== "function") {
    throw new Error("Caatuu interface content must be installed before maintenance UI.");
  }
  const t = (messageId, parameters = {}) => interfaceContent.t(messageId, parameters);
  let sharedUpdateController = null;

  function installSharedMaintenanceRuntime() {
    const course = window.CaatuuCourse;
    const runtime = window.CaatuuRuntime || {};
    if (!course?.id || runtime.maintenance) return;
    const android = typeof window.CaatuuAndroid?.postMessage === "function";
    const pending = new Map();
    let sequence = 0;

    function nativeCall(type, handlers = {}, timeoutMs = 0) {
      const id = `shared-maintenance-${Date.now()}-${++sequence}`;
      return new Promise((resolve, reject) => {
        const timeout = timeoutMs ? window.setTimeout(() => {
          pending.delete(id);
          reject(new Error(t("maintenance.copy.checkfailed")));
        }, timeoutMs) : null;
        pending.set(id, { resolve, reject, timeout, onEvent: handlers.onEvent });
        try {
          window.CaatuuAndroid.postMessage(JSON.stringify({ id, type }));
        } catch (error) {
          pending.delete(id);
          if (timeout !== null) window.clearTimeout(timeout);
          reject(error);
        }
      });
    }

    if (android) {
      const previous = window.CaatuuNative?.receive?.bind(window.CaatuuNative);
      window.CaatuuNative = {
        ...(window.CaatuuNative || {}),
        receive(raw) {
          let message;
          try { message = typeof raw === "string" ? JSON.parse(raw) : raw; }
          catch { return; }
          const request = pending.get(message?.id);
          if (!request) { previous?.(raw); return; }
          if (message.kind === "done" || message.kind === "error") {
            pending.delete(message.id);
            if (request.timeout !== null) window.clearTimeout(request.timeout);
            if (message.kind === "done") request.resolve(message.result || {});
            else request.reject(new Error(message.message || t("maintenance.copy.failed")));
          } else {
            try { request.onEvent?.(message); } catch { /* Keep native completion reachable. */ }
          }
        }
      };
    }

    async function clearBrowserCache() {
      const prefix = String(course.cache?.prefix || "").trim();
      const fallback = String(course.cache?.setupFallback || "").trim();
      const result = { cacheNamesDeleted: [], bytesDeleted: 0 };
      const before = await window.navigator?.storage?.estimate?.();
      if (window.caches) {
        const names = await window.caches.keys();
        for (const name of names) {
          if ((prefix && name.startsWith(prefix)) || (fallback && name === fallback)) {
            if (await window.caches.delete(name)) result.cacheNamesDeleted.push(name);
          }
        }
      }
      const after = await window.navigator?.storage?.estimate?.();
      if (before && after) result.bytesDeleted = Math.max(0, (before.usage || 0) - (after.usage || 0));
      return result;
    }

    window.CaatuuRuntime = {
      ...runtime,
      env: android ? "android" : "browser",
      maintenance: Object.freeze({
        async updateStatus() {
          if (android) return nativeCall("update_app_status", {}, 30_000);
          return { updateAvailable: false, selfUpdateEnabled: false };
        },
        async updateApp(handlers = {}) {
          if (android) return nativeCall("update_app", handlers);
          if (window.navigator?.onLine === false) return { reloaded: false, offline: true };
          const registration = await window.navigator?.serviceWorker?.getRegistration?.();
          await registration?.update();
          const worker = registration?.installing || registration?.waiting;
          if (worker && worker.state !== "activated") {
            // Do not reload into the old offline cache while the new worker installs.
            await new Promise((resolve, reject) => {
              const finish = (error) => {
                window.clearTimeout(timeout);
                worker.removeEventListener("statechange", changed);
                if (error) reject(error); else resolve();
              };
              const changed = () => {
                if (worker.state === "activated") finish();
                else if (worker.state === "redundant") finish(new Error("Browser update did not activate"));
                else if (worker.state === "installed") worker.postMessage({ type: "SKIP_WAITING" });
              };
              const timeout = window.setTimeout(() => finish(new Error("Browser update timed out")), 30_000);
              worker.addEventListener("statechange", changed);
              changed();
            });
          }
          window.location.reload();
          return { updateAvailable: false, reloaded: true };
        },
        clearCache(handlers = {}) {
          return android ? nativeCall("clear_cache", handlers, 120_000) : clearBrowserCache();
        },
        async cacheStatus() {
          return { available: Boolean(window.caches), cacheNames: await window.caches?.keys() || [] };
        }
      })
    };
  }

  installSharedMaintenanceRuntime();

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
    const current = Number(status?.currentVersionCode || 0);
    if (updateDownloadState(status) !== "idle") return latest > current;
    if (!status?.updateAvailable) return false;
    return latest > current;
  }

  function setUpdateAppControl(button, runtime, status, { busy = false, checked = false } = {}) {
    if (!button) return;
    const native = runtime?.env === "android";
    const available = native ? hasNativeAppUpdate(status) : status?.updateAvailable === true;
    const visible = available;
    const downloadState = updateDownloadState(status);
    button.hidden = !visible;
    button.disabled = busy || !visible || downloadState === "active";
    const latestName = String(status?.latestVersionName || "").trim();
    const currentName = String(status?.currentVersionName || "").trim();
    const statusProblem = status?.serverReachable === false || Boolean(status?.updateError);
    const label = button.querySelector("[data-app-update-label]") || button;
    label.textContent = !native && !busy ? t("settings.update.title") : busy
      ? t("maintenance.action.checking")
      : available && downloadState === "ready"
        ? latestName
          ? t("maintenance.action.installversion", { version: latestName })
          : t("maintenance.action.installupdate")
        : available && downloadState === "active"
          ? t("maintenance.action.downloading", { percent: updateDownloadPercent(status).toFixed(0) })
        : available && downloadState === "partial"
          ? t("maintenance.action.resume")
          : available && downloadState === "failed"
            ? t("maintenance.action.retryupdate")
          : available
            ? latestName
              ? t("maintenance.action.updateversion", { version: latestName })
              : t("maintenance.action.update")
            : statusProblem
              ? t("maintenance.action.retrycheck")
              : checked
                ? t("maintenance.action.uptodate")
                : t("maintenance.action.check");
    button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
    button.setAttribute("aria-busy", busy ? "true" : "false");
    button.classList?.toggle("is-busy", busy);
    const row = button.closest("[data-maintenance-action-row], [data-app-update-container]");
    if (row) {
      row.hidden = !visible;
      row.classList?.toggle("is-busy", busy);
      const copy = row.querySelector?.("[data-update-app-copy]");
      if (copy && visible) {
        if (!native) { copy.textContent = t("maintenance.browser.description"); return; }
        const latestDisplay = latestName || status?.downloadedVersionName || status?.latestVersionCode || t("maintenance.version.new");
        const currentDisplay = currentName || status?.currentVersionCode || t("maintenance.version.unknownvalue");
        copy.textContent = busy
          ? t("maintenance.copy.contacting")
          : available && downloadState === "ready"
            ? t("maintenance.copy.ready", { version: latestDisplay })
            : available && downloadState === "active"
              ? t("maintenance.copy.downloading", {
                version: latestName || status?.latestVersionCode || t("maintenance.version.new"),
                percent: updateDownloadPercent(status).toFixed(0)
              })
            : available && downloadState === "partial"
              ? t("maintenance.copy.partial", {
                percent: updateDownloadPercent(status).toFixed(0),
                version: latestName || status?.latestVersionCode || t("maintenance.version.new")
              })
              : available && downloadState === "failed"
                ? t("maintenance.copy.failed")
              : available
                ? t("maintenance.copy.available", {
                  version: latestName || status?.latestVersionCode || t("maintenance.version.new"),
                  current: currentDisplay
                })
                : statusProblem
                  ? t("maintenance.copy.checkfailed")
                  : checked
                    ? t("maintenance.copy.current", {
                      version: currentName || status?.currentVersionCode || t("maintenance.version.thisversion")
                    })
                    : t("maintenance.copy.installed", { version: currentDisplay });
      }
    }
  }

  function createUpdateController(runtime = window.CaatuuRuntime) {
    const buttons = () => [...document.querySelectorAll("#updateApp, [data-app-update-control]")];
    if (!buttons().length || !runtime?.maintenance) return null;
    let currentStatus = null;
    let checkedAt = 0;
    let inFlight = null;
    let confirmedCurrent = false;
    let activePoll = null;
    const serviceWorker = runtime.env === "android" ? null : window.navigator?.serviceWorker;
    let previousController = serviceWorker?.controller;
    let browserUpdateAvailable = false;
    const observedRegistrations = new WeakSet();
    const observedWorkers = new WeakSet();

    function browserUpdateReady() {
      browserUpdateAvailable = true;
      currentStatus = { ...currentStatus, updateAvailable: true };
      render();
    }

    function observeBrowserRegistration(registration) {
      if (!registration || observedRegistrations.has(registration)) return;
      observedRegistrations.add(registration);
      const observeWorker = (worker) => {
        // The first offline installation is not an update to an existing app.
        const installedWorker = registration.active || serviceWorker?.controller;
        if (!worker || !installedWorker || worker === installedWorker || observedWorkers.has(worker)) return;
        observedWorkers.add(worker);
        const changed = () => {
          if (worker.state === "installed" || worker.state === "activated") browserUpdateReady();
        };
        worker.addEventListener?.("statechange", changed);
        changed();
      };
      registration.addEventListener?.("updatefound", () => observeWorker(registration.installing));
      observeWorker(registration.installing);
      observeWorker(registration.waiting);
    }

    async function browserUpdateStatus() {
      const registration = await serviceWorker?.getRegistration?.();
      observeBrowserRegistration(registration);
      if (window.navigator?.onLine !== false) await registration?.update();
      const status = await runtime.maintenance.updateStatus();
      return { ...status, updateAvailable: browserUpdateAvailable || status?.updateAvailable === true };
    }

    function scheduleActivePoll(status) {
      if (activePoll !== null) window.clearTimeout(activePoll);
      activePoll = null;
      if (runtime.env !== "android" || window.CaatuuCourse?.browserProviders?.setupProvider
        || updateDownloadState(status) !== "active" || document.visibilityState === "hidden") return;
      activePoll = window.setTimeout?.(() => {
        activePoll = null;
        void refresh({ force: true, announce: true });
      }, 2500) ?? null;
    }

    const statusNode = () => document.querySelector("#maintenanceStatus");
    const versionNode = () => document.querySelector("#settingsVersion");
    const setMessage = (message) => {
      const node = statusNode();
      if (node) { node.textContent = message; node.hidden = !message; }
      const homeStatus = document.querySelector("#homeUpdateStatus");
      if (homeStatus) { homeStatus.textContent = message; homeStatus.hidden = !message; }
    };
    const render = (status = currentStatus, { busy = false } = {}) => {
      scheduleActivePoll(status);
      buttons().forEach((button) => {
        // Settings is created lazily, after the Home control may already exist.
        if (button.dataset.sharedUpdateControl !== "true") {
          button.dataset.sharedUpdateControl = "true";
          button.addEventListener("click", activate);
        }
        setUpdateAppControl(button, runtime, status || { updateAvailable: false }, {
          busy,
          checked: confirmedCurrent
        });
      });
      if (runtime.env === "android") {
        setVersionNote(versionNode(), status);
      }
      const browserInstall = document.querySelector("#browserInstallActions");
      if (browserInstall) browserInstall.hidden = runtime.env === "android";
    };

    async function refresh({ force = false, announce = true } = {}) {
      if (!force && currentStatus && Date.now() - checkedAt < UPDATE_STATUS_FRESH_MS) {
        render(currentStatus);
        if (announce && runtime.env === "android") setMessage(updateStatusLine(currentStatus));
        return currentStatus;
      }
      if (inFlight) return inFlight;

      confirmedCurrent = false;
      render(currentStatus || { updateAvailable: false, selfUpdateEnabled: true }, { busy: true });
      if (announce) setMessage(t("maintenance.status.checkingserver"));
      inFlight = (runtime.env === "android" ? runtime.maintenance.updateStatus() : browserUpdateStatus())
        .then((status) => {
          currentStatus = status;
          checkedAt = Date.now();
          confirmedCurrent = !hasNativeAppUpdate(status)
            && status?.serverReachable !== false
            && !status?.updateError;
          render(status);
          if (status?.currentVersionName || status?.currentVersionCode) setVersionNote(versionNode(), status);
          if (announce && runtime.env === "android") setMessage(updateStatusLine(status));
          return status;
        })
        .catch((error) => {
          currentStatus = {
            ...currentStatus,
            updateAvailable: currentStatus?.updateAvailable === true || browserUpdateAvailable,
            serverReachable: false,
            updateError: error?.message || String(error)
          };
          confirmedCurrent = false;
          render(currentStatus);
          if (announce) setMessage(t("maintenance.copy.checkfailed"));
          return currentStatus;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    }

    async function activate() {
      if (inFlight) return inFlight;
      if (runtime.env !== "android") {
        if (!currentStatus?.updateAvailable) return refresh({ force: true, announce: false });
        render(currentStatus, { busy: true });
        setMessage(t("maintenance.action.checking"));
        inFlight = Promise.resolve().then(() => runtime.maintenance.updateApp())
          .then((result) => {
            setMessage(t(result?.offline ? "maintenance.browser.offline" : "maintenance.browser.checked"));
            return result;
          }).catch(() => setMessage(t("maintenance.copy.checkfailed")))
          .finally(() => { inFlight = null; render(); });
        return inFlight;
      }
      const status = await refresh({ force: true, announce: true });
      if (!hasNativeAppUpdate(status)) return status;

      setMessage(t("maintenance.status.readyforconfirmation", {
        version: status.latestVersionName || status.latestVersionCode || t("maintenance.version.available")
      }));
      const confirmed = await confirmAppUpdate(status);
      if (!confirmed) {
        setMessage(t("maintenance.status.postponed"));
        return status;
      }
      render(status, { busy: true });
      if (!window.CaatuuCourse?.browserProviders?.setupProvider) {
        // Courses without a setup provider must complete the confirmed update here.
        inFlight = runtime.maintenance.updateApp({
          onEvent(message) {
            const progress = updateProgressMessage(message, (bytes) => `${Math.round(Number(bytes || 0) / 1048576)} MB`);
            if (progress) setMessage(progress);
          }
        }).then(async (result) => {
          try { currentStatus = await runtime.maintenance.updateStatus(); }
          catch { currentStatus = status; } // Opening the installer remains a success if a later check fails.
          render(currentStatus);
          setMessage(updateResultMessage(result));
          return result;
        }).catch(() => {
          render(status);
          setMessage(t("maintenance.copy.failed"));
        }).finally(() => { inFlight = null; });
        return inFlight;
      }
      setMessage(t("maintenance.status.openingsetup"));
      beginAppUpdate(status);
      return status;
    }

    render({ updateAvailable: false, selfUpdateEnabled: runtime.env === "android" });
    serviceWorker?.addEventListener?.("controllerchange", () => {
      const controller = serviceWorker.controller;
      if (previousController && controller && controller !== previousController) browserUpdateReady();
      previousController = controller;
    });
    window.addEventListener?.("online", () => { void refresh({ force: true, announce: false }); });
    document.addEventListener?.("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        if (activePoll !== null) window.clearTimeout(activePoll);
        activePoll = null;
      } else {
        void refresh({ force: true, announce: false });
      }
    });
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
    const latest = status?.latestVersionName || status?.latestVersionCode || t("maintenance.version.latest");
    const current = status?.currentVersionName || status?.currentVersionCode || t("maintenance.version.unknownvalue");
    const downloadState = updateDownloadState(status);
    if (downloadState === "ready") {
      return {
        latest,
        current,
        title: t("maintenance.dialog.install.title", { version: latest }),
        versions: t("maintenance.dialog.ready.versions", { current, latest }),
        action: t("maintenance.dialog.install.action", { version: latest })
      };
    }
    if (downloadState === "partial") {
      return {
        latest,
        current,
        title: t("maintenance.dialog.resume.title", { version: latest }),
        versions: t("maintenance.dialog.partial.versions", {
          current,
          percent: updateDownloadPercent(status).toFixed(0),
          latest
        }),
        action: t("maintenance.action.resume")
      };
    }
    return {
      latest,
      current,
      title: t("maintenance.dialog.install.title", { version: latest }),
      versions: t("maintenance.dialog.available.versions", { current, latest }),
      action: t("maintenance.dialog.update.action", { version: latest })
    };
  }

  function confirmAppUpdate(status) {
    const confirmation = updateConfirmation(status);
    const dialog = document.querySelector("#appUpdateConfirmDialog");
    if (!dialog || typeof dialog.showModal !== "function") {
      return Promise.resolve(window.confirm?.(t("maintenance.dialog.fallback", {
        current: confirmation.current,
        latest: confirmation.latest
      })) ?? false);
    }

    // Home can open this dialog while its Settings ancestors are display:none.
    // A modal there makes the page inert without displaying the confirmation.
    if (dialog.parentElement !== document.body) document.body.append(dialog);

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
      // Setup remains reachable even when the update intent cannot be persisted.
    }
    window.location.href = "index.html";
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
    const versionName = status?.currentVersionName || t("maintenance.version.unknownvalue");
    const versionCode = status?.currentVersionCode || "?";
    if (status?.selfUpdateEnabled === false) {
      return t("maintenance.status.storemanaged", { version: versionName, code: versionCode });
    }
    if (hasNativeAppUpdate(status)) {
      const latestName = status.latestVersionName || t("maintenance.version.latestvalue");
      const latestCode = status.latestVersionCode || "?";
      const downloadState = updateDownloadState(status);
      if (downloadState === "ready") {
        return t("maintenance.status.downloaded", { version: latestName, code: latestCode });
      }
      if (downloadState === "active") {
        return t("maintenance.status.downloading", {
          version: latestName,
          code: latestCode,
          percent: updateDownloadPercent(status).toFixed(0)
        });
      }
      if (downloadState === "partial") {
        return t("maintenance.status.partial", {
          version: latestName,
          code: latestCode,
          percent: updateDownloadPercent(status).toFixed(0)
        });
      }
      if (downloadState === "failed") {
        return t("maintenance.status.failed", { version: latestName, code: latestCode });
      }
      return t("maintenance.status.available", {
        latest: latestName,
        latestcode: latestCode,
        current: versionName,
        currentcode: versionCode
      });
    }
    if (status?.serverReachable === false || status?.updateError) {
      return t("maintenance.status.unreachable", { version: versionName, code: versionCode });
    }
    return t("maintenance.status.uptodate", { version: versionName, code: versionCode });
  }

  function versionLine(status, fallback = t("maintenance.version.unknown")) {
    const versionName = status?.currentVersionName;
    const versionCode = status?.currentVersionCode;
    if (versionName || versionCode) {
      return t("maintenance.version.line", {
        version: versionName || t("maintenance.version.unknownvalue"),
        code: versionCode || "?"
      });
    }
    return fallback;
  }

  function setVersionNote(element, status) {
    if (!element) return;
    const fallback = element.dataset.fallbackVersion || element.textContent.trim() || t("maintenance.version.unknown");
    element.textContent = versionLine(status, fallback);
  }

  function updateProgressMessage(message, formatBytes) {
    if (message?.kind === "progress" && message.phase === "download") {
      const total = Number(message.totalBytes || 0);
      const bytes = Number(message.bytes || 0);
      if (total > 0) {
        return t("maintenance.progress.download.percent", {
          bytes: formatBytes(bytes),
          total: formatBytes(total),
          percent: (bytes / total * 100).toFixed(1)
        });
      }
      return t("maintenance.progress.download", {
        bytes: formatBytes(bytes),
        total: formatBytes(total)
      });
    }
    if (message?.kind === "status") return t("maintenance.progress.preparing");
    return "";
  }

  function updateResultMessage(result) {
    const state = result?.reused ? "reused" : result?.resumed ? "resumed" : "fresh";
    if (result?.action === "settings") {
      return t(`maintenance.result.settings.${state}`);
    }
    return t(`maintenance.result.installer.${state}`);
  }

  function cacheResultMessage(result, formatBytes, {
    storageScopeFallback = t("maintenance.cache.localscope"),
    includeStorageScope = true
  } = {}) {
    const updateBytes = result?.updateApk?.bytesDeleted || 0;
    const scope = includeStorageScope ? result?.storageScope || storageScopeFallback : storageScopeFallback;
    const parameters = {
      bytes: formatBytes(result?.bytesDeleted || 0),
      scope
    };
    return updateBytes > 0
      ? t("maintenance.cache.cleared.withapk", {
        ...parameters,
        updatebytes: formatBytes(updateBytes)
      })
      : t("maintenance.cache.cleared", parameters);
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
    const bindSharedControl = () => { void refreshSharedUpdateControl({ announce: false }); };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bindSharedControl, { once: true });
    } else {
      bindSharedControl();
    }
    document.addEventListener("caatuu:settings-open", () => {
      void refreshSharedUpdateControl({ announce: false });
    });
  }
})();
