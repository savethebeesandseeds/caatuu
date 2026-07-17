import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [manager, bridge, filePaths, maintenanceUi, setup] = await Promise.all([
  readFile(new URL(
    "../../../../apps/android/app/src/main/java/com/caatuu/android/AppUpdateManager.kt",
    import.meta.url
  ), "utf8"),
  readFile(new URL(
    "../../../../apps/android/app/src/main/java/com/caatuu/android/CaatuuBridge.kt",
    import.meta.url
  ), "utf8"),
  readFile(new URL(
    "../../../../apps/android/app/src/main/res/xml/caatuu_file_paths.xml",
    import.meta.url
  ), "utf8"),
  readFile(new URL("../../../../apps/languages/czech/static/maintenance-ui.js", import.meta.url), "utf8"),
  readFile(new URL("../../../../apps/languages/czech/static/setup.js", import.meta.url), "utf8")
]);

function kotlinFunction(source, signature, nextSignature = "\n    private ") {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing source contract: ${signature}`);
  const end = source.indexOf(nextSignature, start + signature.length);
  return source.slice(start, end < 0 ? source.length : end);
}

test("Android owns update transfers outside the Activity lifecycle", () => {
  assert.match(manager, /import android\.app\.DownloadManager/);
  assert.match(manager, /getSystemService\(Context\.DOWNLOAD_SERVICE\) as DownloadManager/);
  assert.match(manager, /DownloadManager\.Request\(Uri\.parse\(/);
  assert.match(manager, /downloadManager\.enqueue\(/);
  assert.match(manager, /downloadManager\.query\(DownloadManager\.Query\(\)\.setFilterById\(/);
  assert.match(manager, /DownloadManager\.STATUS_(?:PENDING|RUNNING)/);
  assert.match(manager, /DownloadManager\.STATUS_PAUSED/);
  assert.match(manager, /DownloadManager\.STATUS_SUCCESSFUL/);
  assert.match(manager, /DownloadManager\.STATUS_FAILED/);
  assert.match(manager, /appContext\.getExternalFilesDir\(/);
});

test("update identity and verified APK survive process and cache recreation", () => {
  assert.match(manager, /appContext\.getSharedPreferences\(/);
  assert.match(manager, /updatePrefs\.edit\(\)\.putString\(/);
  assert.match(manager, /File\(appContext\.filesDir,\s*"updates"\)/);
  assert.doesNotMatch(manager, /File\(appContext\.cacheDir,\s*"updates"\)/);
  assert.match(filePaths, /<files-path[\s\S]*?path="updates\/"/,
    "FileProvider must expose the persistent verified update directory");

  const startDownload = kotlinFunction(manager, "private fun startManagedDownloadLocked(");
  const descriptor = startDownload.indexOf("persistStateLocked(descriptor)");
  const enqueue = startDownload.indexOf("downloadManager.enqueue(request)");
  const persistedId = startDownload.indexOf("persistStateLocked(started)");
  assert.ok(descriptor >= 0 && descriptor < enqueue, "persist the target before handing work to Android");
  assert.ok(enqueue < persistedId, "persist Android's download id immediately after enqueue");
  assert.match(manager, /findManagedDownloadLocked\(/, "a process restart can recover a raced download id");

  const promotion = kotlinFunction(manager, "private fun promoteManagedDownloadLocked(");
  const verifyStaged = promotion.indexOf("verifyTargetFile(source");
  const publish = promotion.indexOf("moveIntoPlace(temporary, updateApk)");
  const verifyPublished = promotion.indexOf("verifyTargetFile(updateApk");
  const persistReady = promotion.indexOf("persistStateLocked(ready)");
  assert.ok(verifyStaged >= 0 && verifyStaged < publish, "verify the managed download before publishing it");
  assert.ok(publish < verifyPublished && verifyPublished < persistReady,
    "only persist ready after the final app-private APK is verified");

  const reconciliation = kotlinFunction(manager, "private fun reconcileLocalStateLocked(");
  assert.match(reconciliation, /if \(managed\?\.status == DownloadManager\.STATUS_SUCCESSFUL\)/,
    "promote an Android-managed destination only after DownloadManager reports success");
  assert.doesNotMatch(reconciliation, /stagedFile\.length\(\) == stored\.target\.bytes/,
    "never infer download completion from a potentially preallocated destination length");

  const downloadLatest = kotlinFunction(manager, "suspend fun downloadLatest(");
  assert.match(downloadLatest, /integrityRetryCount < MAX_UPDATE_INTEGRITY_RETRIES/,
    "retry one clean download after a genuine transport integrity failure");
  assert.match(downloadLatest, /PROCESS_UPDATE_MUTEX\.withLock[\s\S]*val raced = reconcileLocalStateLocked\(\)[\s\S]*raced\?\.state == DOWNLOAD_STATE_DOWNLOADING[\s\S]*startManagedDownloadLocked\(activeTarget\)/,
    "concurrent integrity retries must reuse a raced active download instead of cancelling it");

  assert.match(startDownload, /clearStoredArtifactsLocked\(loadStoredStateLocked\(\)\)/,
    "every replacement download must remove the previous managed record and partial file first");

  const clearArtifacts = kotlinFunction(manager, "private fun clearStoredArtifactsLocked(");
  assert.match(clearArtifacts, /managedDownloadIdsUnderRootLocked\(managedRoot\)/,
    "a clean restart must discover orphaned Android downloads under the managed update directory");
  assert.match(clearArtifacts, /downloadManager\.remove\(\*downloadIds\.toLongArray\(\)\)/,
    "a clean restart must cancel every discovered Android download before deleting its destination");
  assert.match(manager, /File\(appContext\.cacheDir, LEGACY_UPDATES_DIRECTORY\)\.deleteRecursively\(\)/,
    "the durable updater must remove abandoned cache-era update files during migration");
});

test("native update status exposes explicit idle, active, paused, failed, and ready semantics", () => {
  for (const field of [
    "downloadReady",
    "readyToInstall",
    "downloadState",
    "downloadActive",
    "resumable",
    "downloadedVersionCode",
    "downloadedVersionName",
    "partialBytes",
    "latestBytes",
    "downloadProgress"
  ]) {
    assert.match(manager, new RegExp(`\\.put\\("${field}"`), `missing status field ${field}`);
  }
  for (const state of ["ready", "downloading", "paused", "failed", "idle"]) {
    assert.match(manager, new RegExp(`DOWNLOAD_STATE_[A-Z_]+ = "${state}"`), `missing update state ${state}`);
  }
  assert.match(manager, /downloadActive = state == DOWNLOAD_STATE_DOWNLOADING,\s*\n/,
    "a paused system transfer must not be reported as actively downloading");
  assert.match(manager,
    /resumable = state == DOWNLOAD_STATE_DOWNLOADING \|\| state == DOWNLOAD_STATE_PAUSED/,
    "paused downloads remain resumable by Android");
});

test("update handoff and Setup labels remain durable and unambiguous", () => {
  assert.match(maintenanceUi, /window\.localStorage\.setItem\(UPDATE_INTENT_KEY/);
  assert.match(maintenanceUi, /window\.localStorage\.getItem\(UPDATE_INTENT_KEY/);
  assert.match(setup, /Boolean\(window\.CaatuuMaintenanceUi\?\.pendingAppUpdate\?\.\(\)\)/);
  assert.doesNotMatch(setup, /Continue update/);
  for (const label of [
    "Install update",
    "Resume download",
    "Retry update",
    "Open installer"
  ]) {
    assert.match(setup, new RegExp(label));
  }
  assert.match(setup, /continuing in the background/i);
});

test("status checks stay responsive and a ready APK installs without contacting the server", () => {
  assert.match(bridge, /"update_app_status"\s*->\s*emitDone\(id,\s*appUpdateManager\.statusJson\(\)\)/);
  assert.doesNotMatch(bridge, /"update_app_status"[^\n]*updateMutex/);

  const statusJson = kotlinFunction(manager, "suspend fun statusJson(");
  const localStatus = statusJson.indexOf("if (local != null)");
  const statusFetch = statusJson.indexOf("fetchJson(updateManifestUrl)");
  assert.ok(localStatus >= 0 && localStatus < statusFetch,
    "status must return persisted local state before checking the network");

  const downloadLatest = kotlinFunction(manager, "suspend fun downloadLatest(");
  const cachedReady = downloadLatest.indexOf("if (snapshot?.ready == true)");
  const manifestFetch = downloadLatest.indexOf("fetchJson(updateManifestUrl)");
  assert.ok(cachedReady >= 0 && cachedReady < manifestFetch,
    "downloadLatest must reuse a verified local APK before fetching a manifest");

  const updateApp = kotlinFunction(bridge, "private suspend fun updateApp(");
  assert.match(updateApp, /appUpdateManager\.downloadLatest[\s\S]*appUpdateManager\.openInstaller\(\)/,
    "the bridge should reuse-or-download first, then open only a verified installer");
});
