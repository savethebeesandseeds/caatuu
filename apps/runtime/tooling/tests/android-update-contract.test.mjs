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

test("status and download reconcile the server before reusing a local APK", () => {
  assert.match(bridge, /"update_app_status"\s*->\s*emitDone\(id,\s*appUpdateManager\.statusJson\(\)\)/);
  assert.doesNotMatch(bridge, /"update_app_status"[^\n]*updateMutex/);

  const statusJson = kotlinFunction(manager, "suspend fun statusJson(");
  const statusFetch = statusJson.indexOf("fetchJson(updateManifestUrl)");
  const statusReconcile = statusJson.indexOf("reconcileServerTargetLocked(remote)");
  const statusOverlay = statusJson.indexOf("putDownloadSnapshot(local)");
  assert.ok(statusFetch >= 0 && statusFetch < statusReconcile && statusReconcile < statusOverlay,
    "server identity must be validated before local download state is overlaid");
  assert.doesNotMatch(statusJson, /return@withContext status\.putLocalSnapshot/,
    "a reachable server must get a chance to invalidate stale local state");
  assert.match(statusJson,
    /catch \(error: Exception\)[\s\S]*reconcileLocalStateLocked\(\)[\s\S]*putLocalSnapshot\(local\)/,
    "verified local state remains available when the manifest cannot be reached");

  const downloadLatest = kotlinFunction(manager, "suspend fun downloadLatest(");
  const manifestFetch = downloadLatest.indexOf("fetchJson(updateManifestUrl)");
  const downloadReconcile = downloadLatest.indexOf("reconcileServerTargetLocked(remote)");
  const cachedReady = downloadLatest.indexOf("if (snapshot?.ready == true)");
  assert.ok(manifestFetch >= 0 && manifestFetch < downloadReconcile && downloadReconcile < cachedReady,
    "downloadLatest must reconcile the current manifest before reusing a ready APK");

  const updateApp = kotlinFunction(bridge, "private suspend fun updateApp(");
  assert.match(updateApp, /appUpdateManager\.downloadLatest[\s\S]*appUpdateManager\.openInstaller\(\)/,
    "the bridge should reuse-or-download first, then open only a verified installer");
});

test("server artifact identity wins without treating a URL change as new bytes", () => {
  const sameArtifactStart = manager.indexOf("fun sameArtifact(other: UpdateTarget)");
  assert.notEqual(sameArtifactStart, -1);
  const sameArtifactEnd = manager.indexOf("\n    }", sameArtifactStart);
  const sameArtifact = manager.slice(sameArtifactStart, sameArtifactEnd);
  assert.match(sameArtifact, /versionCode == other\.versionCode/);
  assert.match(sameArtifact, /sha256 == other\.sha256/);
  assert.match(sameArtifact, /bytes == other\.bytes/);
  assert.doesNotMatch(sameArtifact, /apkUrl/,
    "a same-origin URL alias change must not discard identical verified APK bytes");

  const reconciliation = kotlinFunction(manager, "private fun reconcileServerTargetLocked(");
  assert.match(reconciliation,
    /remote\.versionCode <= BuildConfig\.VERSION_CODE\.toLong\(\)[\s\S]*clearStoredArtifactsLocked/,
    "a server version that is no longer newer must clear the old local target");
  assert.match(reconciliation,
    /!local\.target\.sameArtifact\(remote\)[\s\S]*clearStoredArtifactsLocked/,
    "different server bytes must replace the locally persisted target");
  assert.match(reconciliation, /stored\.copy\(target = remote\)/,
    "matching bytes retain their download while adopting the latest server metadata");
});

test("ready APK verification is stamped for polling but repeated before installer launch", () => {
  assert.match(manager, /val verifiedBytes: Long = 0L/);
  assert.match(manager, /val verifiedLastModified: Long = 0L/);
  assert.match(manager, /\.put\("verifiedBytes", stored\.verifiedBytes\)/);
  assert.match(manager, /\.put\("verifiedLastModified", stored\.verifiedLastModified\)/);
  assert.match(manager, /verifiedBytes = body\.optLong\("verifiedBytes", 0L\)/);
  assert.match(manager, /verifiedLastModified = body\.optLong\("verifiedLastModified", 0L\)/);

  const reconciliation = kotlinFunction(manager, "private fun reconcileLocalStateLocked(");
  assert.match(reconciliation,
    /if \(!verificationStampMatches\(stored, updateApk\)\) \{\s*verifyTargetFile\(updateApk, stored\.target\)/,
    "status polling may skip hashing only when the persisted file stamp still matches");

  const stamp = kotlinFunction(manager, "private fun verificationStampMatches(");
  assert.match(stamp, /stored\.verified/);
  assert.match(stamp, /stored\.state == DOWNLOAD_STATE_READY/);
  assert.match(stamp, /stored\.verifiedBytes == stored\.target\.bytes/);
  assert.match(stamp, /file\.lastModified\(\) == stored\.verifiedLastModified/);

  const promotion = kotlinFunction(manager, "private fun promoteManagedDownloadLocked(");
  assert.match(promotion, /verifiedBytes = updateApk\.length\(\)/);
  assert.match(promotion, /verifiedLastModified = updateApk\.lastModified\(\)/);

  const installer = kotlinFunction(manager, "suspend fun openInstaller()");
  assert.match(installer, /verifyTargetFile\(updateApk, snapshot\.target\)/,
    "installer launch must always reverify the full APK regardless of its poll stamp");
});

test("integrity retries reconcile a fresh manifest without replacing a raced download", () => {
  const downloadLatest = kotlinFunction(manager, "suspend fun downloadLatest(");
  const retryStart = downloadLatest.indexOf("integrityRetryCount < MAX_UPDATE_INTEGRITY_RETRIES");
  const retryEnd = downloadLatest.indexOf(
    "error(current.error.ifBlank",
    retryStart
  );
  assert.ok(retryStart >= 0 && retryEnd > retryStart, "missing integrity retry branch");
  const retry = downloadLatest.slice(retryStart, retryEnd);

  const raceCheck = retry.indexOf("val raced = synchronized(PROCESS_STATE_LOCK)");
  const racedActive = retry.indexOf("raced?.state == DOWNLOAD_STATE_DOWNLOADING");
  const manifestFetch = retry.indexOf("fetchJson(updateManifestUrl)");
  const manifestReconcile = retry.indexOf("reconcileServerTargetLocked(retryTarget)");
  const reconciledActive = retry.indexOf("reconciled?.state == DOWNLOAD_STATE_DOWNLOADING");
  const restart = retry.indexOf("startManagedDownloadLocked(retryTarget)");
  assert.ok(
    raceCheck >= 0 &&
      raceCheck < racedActive &&
      racedActive < manifestFetch &&
      manifestFetch < manifestReconcile &&
      manifestReconcile < reconciledActive &&
      reconciledActive < restart,
    "only a still-fresh integrity failure may refetch, reconcile, and restart its target"
  );
  assert.doesNotMatch(retry, /startManagedDownloadLocked\(activeTarget\)/,
    "the target that failed integrity must never be restarted after the manifest can change");
});
