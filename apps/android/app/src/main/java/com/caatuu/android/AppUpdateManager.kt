package com.caatuu.android

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.coroutines.coroutineContext

class AppUpdateManager(context: Context) {
    private class UpdateHttpException(val statusCode: Int) : IOException(
        "The Caatuu update service returned HTTP $statusCode. Please try again.",
    )

    private data class UpdateTarget(
        val manifestJson: String,
        val versionCode: Long,
        val versionName: String,
        val sha256: String,
        val bytes: Long,
        val apkUrl: String,
    ) {
        fun manifest(): JSONObject = JSONObject(manifestJson)

        fun sameArtifact(other: UpdateTarget): Boolean =
            versionCode == other.versionCode &&
                sha256 == other.sha256 &&
                bytes == other.bytes
    }

    private data class StoredUpdateState(
        val target: UpdateTarget,
        val downloadId: Long?,
        val downloadFileName: String,
        val verified: Boolean,
        val state: String,
        val error: String,
        val verifiedBytes: Long = 0L,
        val verifiedLastModified: Long = 0L,
    )

    private data class ManagedDownloadStatus(
        val id: Long,
        val status: Int?,
        val reason: Int?,
        val bytes: Long,
        val totalBytes: Long,
        val file: File?,
    )

    private data class UpdateSnapshot(
        val target: UpdateTarget,
        val state: String,
        val downloadActive: Boolean,
        val resumable: Boolean,
        val downloadedBytes: Long,
        val totalBytes: Long,
        val error: String = "",
    ) {
        val ready: Boolean = state == DOWNLOAD_STATE_READY
    }

    private val appContext = context.applicationContext
    private val downloadManager = appContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private val updatePrefs = appContext.getSharedPreferences(UPDATE_PREFS, Context.MODE_PRIVATE)
    private val updatesDir = File(appContext.filesDir, "updates")
    private val updateApk = File(updatesDir, BuildConfig.CAATUU_UPDATE_APK_NAME)
    private val updateBaseUrl = BuildConfig.CAATUU_UPDATE_BASE_URL.trimEnd('/')
    private val updateApkUrl = "$updateBaseUrl/${BuildConfig.CAATUU_UPDATE_APK_NAME}"
    private val updateManifestUrl = "$updateBaseUrl/${BuildConfig.CAATUU_UPDATE_MANIFEST_NAME}"

    init {
        validateChannelUrl(URL(updateManifestUrl), "Update manifest")
        synchronized(PROCESS_STATE_LOCK) {
            File(appContext.cacheDir, LEGACY_UPDATES_DIRECTORY).deleteRecursively()
            updatesDir.mkdirs()
            val stored = loadStoredStateLocked()
            if (stored?.target?.versionCode?.let { it <= BuildConfig.VERSION_CODE.toLong() } == true) {
                clearStoredArtifactsLocked(stored)
            } else {
                pruneStaleUpdateFilesLocked(stored)
            }
        }
    }

    suspend fun statusJson(): JSONObject =
        withContext(Dispatchers.IO) {
            val status = baseStatusJson()
            if (!BuildConfig.CAATUU_SELF_UPDATE_ENABLED) {
                return@withContext status
                    .put("serverReachable", false)
                    .put("updateAvailable", false)
                    .put("updateManagement", "store")
            }

            try {
                val remote = updateTarget(fetchJson(updateManifestUrl), requireNewer = false)
                val local = synchronized(PROCESS_STATE_LOCK) {
                    reconcileServerTargetLocked(remote)
                }
                status.putManifestStatus(remote)
                if (local != null) status.putDownloadSnapshot(local)
                status
            } catch (error: Exception) {
                val local = synchronized(PROCESS_STATE_LOCK) { reconcileLocalStateLocked() }
                val fallback = status
                    .put("serverReachable", false)
                    .put("updateAvailable", false)
                    .put("updateError", publicUpdateError(error))
                if (local != null) fallback.putLocalSnapshot(local) else fallback
            }
        }

    fun clearDownloadedUpdate(): JSONObject =
        synchronized(PROCESS_STATE_LOCK) {
            val stored = loadStoredStateLocked()
            val managedRoot = managedUpdatesRootOrNull()
            val bytesDeleted = directorySize(updatesDir) + directorySize(managedRoot)
            val downloadIds = mutableSetOf<Long>()
            stored?.downloadId?.let(downloadIds::add)
            downloadIds += managedDownloadIdsUnderRootLocked(managedRoot)
            val cancelledDownloads = if (downloadIds.isEmpty()) {
                0
            } else {
                runCatching { downloadManager.remove(*downloadIds.toLongArray()) }.getOrDefault(0)
            }

            val internalDeleted = !updatesDir.exists() || updatesDir.deleteRecursively()
            val managedDeleted = managedRoot == null || !managedRoot.exists() || managedRoot.deleteRecursively()
            updatesDir.mkdirs()
            check(updatePrefs.edit().remove(UPDATE_STATE_KEY).commit()) {
                "Could not clear persisted app update state."
            }

            JSONObject()
                .put("storageScope", "app-private update files and managed downloads")
                .put("path", updatesDir.absolutePath)
                .put("deletedOnUninstall", true)
                .put("bytesDeleted", bytesDeleted)
                .put("cancelledDownloads", cancelledDownloads)
                .put("deleted", internalDeleted && managedDeleted)
        }

    suspend fun downloadLatest(onProgress: (ModelProgress) -> Unit): JSONObject =
        withContext(Dispatchers.IO) {
            require(BuildConfig.CAATUU_SELF_UPDATE_ENABLED) {
                "This Caatuu build is updated by its app store."
            }

            var snapshot = synchronized(PROCESS_STATE_LOCK) { reconcileLocalStateLocked() }
            var target = snapshot?.target
            val remote = try {
                updateTarget(fetchJson(updateManifestUrl), requireNewer = false)
            } catch (error: Exception) {
                if (
                    snapshot == null ||
                    snapshot.state == DOWNLOAD_STATE_IDLE ||
                    snapshot.state == DOWNLOAD_STATE_FAILED
                ) {
                    throw error
                }
                null
            }

            if (remote != null) {
                if (remote.versionCode <= BuildConfig.VERSION_CODE.toLong()) {
                    synchronized(PROCESS_STATE_LOCK) {
                        clearStoredArtifactsLocked(loadStoredStateLocked())
                    }
                    updateTarget(remote.manifest(), requireNewer = true)
                }
                snapshot = synchronized(PROCESS_STATE_LOCK) {
                    reconcileServerTargetLocked(remote)
                }
                target = remote
            }

            if (snapshot?.ready == true) {
                return@withContext updateResult(snapshot.target, reused = true)
            }

            // A failed verification can belong to a manifest fetched while a
            // publication was changing. Do not keep retrying that stale target:
            // discard it and fetch the current manifest before downloading again.
            if (snapshot?.state == DOWNLOAD_STATE_FAILED) {
                clearDownloadedUpdate()
                snapshot = null
            }

            val downloadTarget = target ?: snapshot?.target
                ?: error("Could not determine the available Caatuu update.")
            val hadManagedDownload = snapshot?.state == DOWNLOAD_STATE_DOWNLOADING ||
                snapshot?.state == DOWNLOAD_STATE_PAUSED
            var integrityRetryCount = 0

            if (snapshot == null || snapshot.state == DOWNLOAD_STATE_IDLE || snapshot.state == DOWNLOAD_STATE_FAILED) {
                snapshot = PROCESS_UPDATE_MUTEX.withLock {
                    synchronized(PROCESS_STATE_LOCK) {
                        val raced = reconcileLocalStateLocked()
                        when {
                            raced?.ready == true -> raced
                            raced?.state == DOWNLOAD_STATE_DOWNLOADING || raced?.state == DOWNLOAD_STATE_PAUSED -> raced
                            else -> startManagedDownloadLocked(downloadTarget)
                        }
                    }
                }
            }

            var activeTarget = snapshot.target
            while (true) {
                coroutineContext.ensureActive()
                val current = synchronized(PROCESS_STATE_LOCK) { reconcileLocalStateLocked() }
                    ?: error("The managed app update disappeared. Start the update again.")
                activeTarget = current.target
                onProgress(ModelProgress(current.downloadedBytes, current.totalBytes))

                when (current.state) {
                    DOWNLOAD_STATE_READY -> {
                        return@withContext updateResult(
                            activeTarget,
                            recovered = hadManagedDownload,
                            resumed = hadManagedDownload,
                        )
                    }
                    DOWNLOAD_STATE_FAILED -> {
                        if (
                            integrityRetryCount < MAX_UPDATE_INTEGRITY_RETRIES &&
                            isRetryableIntegrityFailure(current.error)
                        ) {
                            PROCESS_UPDATE_MUTEX.withLock {
                                val raced = synchronized(PROCESS_STATE_LOCK) {
                                    reconcileLocalStateLocked()
                                }
                                when {
                                    raced?.ready == true -> raced
                                    raced?.state == DOWNLOAD_STATE_DOWNLOADING ||
                                        raced?.state == DOWNLOAD_STATE_PAUSED -> raced
                                    else -> {
                                        val retryTarget = updateTarget(
                                            fetchJson(updateManifestUrl),
                                            requireNewer = false,
                                        )
                                        synchronized(PROCESS_STATE_LOCK) {
                                            val reconciled = reconcileServerTargetLocked(retryTarget)
                                            if (retryTarget.versionCode <= BuildConfig.VERSION_CODE.toLong()) {
                                                updateTarget(retryTarget.manifest(), requireNewer = true)
                                            }
                                            when {
                                                reconciled?.ready == true -> reconciled
                                                reconciled?.state == DOWNLOAD_STATE_DOWNLOADING ||
                                                    reconciled?.state == DOWNLOAD_STATE_PAUSED -> reconciled
                                                else -> startManagedDownloadLocked(retryTarget)
                                            }
                                        }
                                    }
                                }
                            }
                            integrityRetryCount += 1
                            continue
                        }
                        error(current.error.ifBlank { "Android could not finish the app update download." })
                    }
                    DOWNLOAD_STATE_IDLE -> {
                        error("The app update is not downloading. Start the update again.")
                    }
                }

                delay(DOWNLOAD_POLL_MILLIS)
            }
            @Suppress("UNREACHABLE_CODE")
            error("The app update monitor stopped unexpectedly.")
        }

    suspend fun openInstaller(): String {
        require(BuildConfig.CAATUU_SELF_UPDATE_ENABLED) {
            "This Caatuu build is updated by its app store."
        }

        val readyApk = withContext(Dispatchers.IO) {
            synchronized(PROCESS_STATE_LOCK) {
                val snapshot = reconcileLocalStateLocked()
                    ?: error("No downloaded APK is available.")
                require(snapshot.ready) { "The downloaded APK is not ready to install." }
                try {
                    verifyTargetFile(updateApk, snapshot.target)
                } catch (error: Exception) {
                    updateApk.delete()
                    persistStateLocked(
                        StoredUpdateState(
                            target = snapshot.target,
                            downloadId = null,
                            downloadFileName = managedDownloadFileName(snapshot.target),
                            verified = false,
                            state = DOWNLOAD_STATE_FAILED,
                            error = error.message ?: "Downloaded APK verification failed.",
                            verifiedBytes = 0L,
                            verifiedLastModified = 0L,
                        ),
                    )
                    throw error
                }
                updateApk
            }
        }

        return withContext(Dispatchers.Main) {
            if (!canRequestPackageInstalls()) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${appContext.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                appContext.startActivity(intent)
                return@withContext "settings"
            }

            val apkUri = FileProvider.getUriForFile(
                appContext,
                "${appContext.packageName}.files",
                readyApk,
            )
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(apkUri, APK_MIME_TYPE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            appContext.startActivity(intent)
            "installer"
        }
    }

    private fun canRequestPackageInstalls(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            appContext.packageManager.canRequestPackageInstalls()

    private fun fetchJson(url: String): JSONObject {
        var lastError: Exception? = null
        for (attempt in 0 until UPDATE_MANIFEST_ATTEMPTS) {
            try {
                return fetchJsonOnce(url)
            } catch (error: Exception) {
                lastError = error
                val finalAttempt = attempt == UPDATE_MANIFEST_ATTEMPTS - 1
                if (finalAttempt || !isRetryableUpdateError(error)) {
                    if (error is IOException && error !is UpdateHttpException) {
                        throw IOException(
                            "Could not reach the Caatuu update service. Please try again.",
                            error,
                        )
                    }
                    throw error
                }
                Thread.sleep(UPDATE_RETRY_DELAYS_MILLIS[attempt])
            }
        }
        throw lastError ?: IOException("Could not reach the Caatuu update service. Please try again.")
    }

    private fun fetchJsonOnce(url: String): JSONObject {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 10_000
            instanceFollowRedirects = false
            useCaches = false
            setRequestProperty("Cache-Control", "no-cache")
        }

        return try {
            connection.connect()
            val responseCode = connection.responseCode
            if (responseCode !in 200..299) {
                throw UpdateHttpException(responseCode)
            }
            val declaredBytes = connection.contentLengthLong
            require(declaredBytes <= 0L || declaredBytes <= MAX_UPDATE_MANIFEST_BYTES.toLong()) {
                "Update manifest is larger than the allowed limit."
            }
            JSONObject(readLimitedManifest(connection))
        } finally {
            connection.disconnect()
        }
    }

    private fun isRetryableUpdateError(error: Exception): Boolean =
        when (error) {
            is UpdateHttpException -> error.statusCode in RETRYABLE_HTTP_CODES || error.statusCode >= 500
            is IOException -> true
            else -> false
        }

    private fun publicUpdateError(error: Exception): String =
        when (error) {
            is UpdateHttpException -> error.message.orEmpty()
            is IOException -> "Could not reach the Caatuu update service. Please try again."
            else -> "The Caatuu update check could not be completed. Please try again."
        }

    private fun updateTarget(manifest: JSONObject, requireNewer: Boolean): UpdateTarget {
        val versionCode = manifest.optLong("version_code", 0L)
        require(versionCode > 0L) { "Update manifest has an invalid version_code." }
        if (requireNewer) {
            require(versionCode > BuildConfig.VERSION_CODE.toLong()) {
                "Caatuu is already up to date."
            }
        }

        val versionName = manifest.optString("version_name").trim()
        require(versionName.isNotBlank()) { "Update manifest is missing version_name." }
        val expectedSha = manifest.optString("sha256").trim().lowercase()
        require(expectedSha.matches(SHA256_PATTERN)) { "Update manifest has an invalid sha256." }
        val expectedBytes = manifest.optLong("bytes", 0L)
        require(expectedBytes > 0L) { "Update manifest is missing bytes." }
        require(expectedBytes <= MAX_UPDATE_APK_BYTES) { "Update APK is larger than the allowed limit." }
        require(manifest.optString("package_name") == appContext.packageName) {
            "Update manifest package does not match Caatuu."
        }
        val expectedBuildType = if (BuildConfig.DEBUG) "debug" else "release"
        require(manifest.optString("build_type") == expectedBuildType) {
            "Update manifest build type does not match the installed channel."
        }
        require(manifest.optBoolean("debuggable", !BuildConfig.DEBUG) == BuildConfig.DEBUG) {
            "Update manifest debuggable flag does not match the installed channel."
        }
        val apkUrl = validateUpdateUrl(
            manifest.optString("apk_url").takeIf { it.isNotBlank() } ?: updateApkUrl,
        )

        val canonicalManifest = JSONObject(manifest.toString())
            .put("version_code", versionCode)
            .put("version_name", versionName)
            .put("sha256", expectedSha)
            .put("bytes", expectedBytes)
            .put("apk_url", apkUrl)
        return UpdateTarget(
            manifestJson = canonicalManifest.toString(),
            versionCode = versionCode,
            versionName = versionName,
            sha256 = expectedSha,
            bytes = expectedBytes,
            apkUrl = apkUrl,
        )
    }

    private fun validateUpdateUrl(value: String): String {
        val manifestUrl = URL(updateManifestUrl)
        val candidate = URL(value)
        validateChannelUrl(candidate, "Update APK")
        require(
            candidate.protocol == manifestUrl.protocol &&
                candidate.host.equals(manifestUrl.host, ignoreCase = true) &&
                candidate.effectivePort() == manifestUrl.effectivePort(),
        ) { "Update APK must use the same origin as its manifest." }
        return candidate.toExternalForm()
    }

    private fun URL.effectivePort(): Int = if (port >= 0) port else defaultPort

    private fun validateChannelUrl(candidate: URL, label: String) {
        require(candidate.protocol in setOf("http", "https")) { "$label URL must use HTTP or HTTPS." }
        require(BuildConfig.DEBUG || candidate.protocol == "https") { "Release updates require HTTPS." }
        require(candidate.host.isNotBlank()) { "$label URL must include a host." }
        require(candidate.userInfo.isNullOrBlank() && candidate.ref.isNullOrBlank()) {
            "$label URL must not contain credentials or a fragment."
        }
        require(candidate.query.isNullOrBlank()) { "$label URL must not contain a query string." }
    }

    private fun readLimitedManifest(connection: HttpURLConnection): String =
        connection.inputStream.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var total = 0
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                require(total <= MAX_UPDATE_MANIFEST_BYTES) {
                    "Update manifest is larger than the allowed limit."
                }
                output.write(buffer, 0, read)
            }
            output.toString(Charsets.UTF_8.name())
        }

    private fun startManagedDownloadLocked(target: UpdateTarget): UpdateSnapshot {
        clearStoredArtifactsLocked(loadStoredStateLocked())
        updatesDir.mkdirs()
        val managedRoot = managedUpdatesRoot()
        managedRoot.mkdirs()
        val downloadFile = File(managedRoot, managedDownloadFileName(target))
        downloadFile.delete()

        val descriptor = StoredUpdateState(
            target = target,
            downloadId = null,
            downloadFileName = downloadFile.name,
            verified = false,
            state = DOWNLOAD_STATE_IDLE,
            error = "",
        )
        persistStateLocked(descriptor)

        val request = DownloadManager.Request(Uri.parse(target.apkUrl))
            .addRequestHeader("Cache-Control", "no-cache")
            .setTitle("Caatuu ${target.versionName}")
            .setDescription("Downloading a verified Caatuu app update.")
            .setMimeType(APK_MIME_TYPE)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(false)
            .setRequiresCharging(false)
            .setRequiresDeviceIdle(false)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationUri(Uri.fromFile(downloadFile))

        return try {
            val downloadId = downloadManager.enqueue(request)
            val started = descriptor.copy(
                downloadId = downloadId,
                state = DOWNLOAD_STATE_DOWNLOADING,
            )
            persistStateLocked(started)
            snapshot(started, DOWNLOAD_STATE_DOWNLOADING, 0L, target.bytes)
        } catch (error: Exception) {
            persistStateLocked(
                descriptor.copy(
                    state = DOWNLOAD_STATE_FAILED,
                    error = error.message ?: "Android could not start the app update download.",
                ),
            )
            throw error
        }
    }

    private fun reconcileServerTargetLocked(remote: UpdateTarget): UpdateSnapshot? {
        val local = reconcileLocalStateLocked()
        if (remote.versionCode <= BuildConfig.VERSION_CODE.toLong()) {
            if (local != null || loadStoredStateLocked() != null || updateApk.exists()) {
                clearStoredArtifactsLocked(loadStoredStateLocked())
            }
            return null
        }
        if (local == null) return null
        if (!local.target.sameArtifact(remote)) {
            clearStoredArtifactsLocked(loadStoredStateLocked())
            return null
        }

        val stored = loadStoredStateLocked() ?: return local
        if (stored.target.manifestJson == remote.manifestJson) return local
        persistStateLocked(stored.copy(target = remote))
        return local.copy(target = remote)
    }

    private fun reconcileLocalStateLocked(): UpdateSnapshot? {
        var stored = loadStoredStateLocked() ?: return null
        if (stored.target.versionCode <= BuildConfig.VERSION_CODE.toLong()) {
            clearStoredArtifactsLocked(stored)
            return null
        }

        if (updateApk.isFile) {
            try {
                if (!verificationStampMatches(stored, updateApk)) {
                    verifyTargetFile(updateApk, stored.target)
                }
                val managedState = stored
                cleanupManagedDownloadLocked(managedState)
                val verifiedBytes = updateApk.length()
                val verifiedLastModified = updateApk.lastModified()
                if (
                    !stored.verified ||
                    stored.downloadId != null ||
                    stored.downloadFileName.isNotBlank() ||
                    stored.verifiedBytes != verifiedBytes ||
                    stored.verifiedLastModified != verifiedLastModified
                ) {
                    stored = stored.copy(
                        downloadId = null,
                        downloadFileName = "",
                        verified = true,
                        state = DOWNLOAD_STATE_READY,
                        error = "",
                        verifiedBytes = verifiedBytes,
                        verifiedLastModified = verifiedLastModified,
                    )
                    persistStateLocked(stored)
                }
                return snapshot(stored, DOWNLOAD_STATE_READY, updateApk.length(), stored.target.bytes)
            } catch (error: Exception) {
                updateApk.delete()
                stored = stored.copy(
                    downloadId = null,
                    downloadFileName = "",
                    verified = false,
                    state = DOWNLOAD_STATE_FAILED,
                    error = error.message ?: "Downloaded APK verification failed.",
                    verifiedBytes = 0L,
                    verifiedLastModified = 0L,
                )
                persistStateLocked(stored)
            }
        } else if (stored.verified) {
            stored = stored.copy(
                verified = false,
                state = DOWNLOAD_STATE_FAILED,
                error = "The verified update APK is missing. Download it again.",
                verifiedBytes = 0L,
                verifiedLastModified = 0L,
            )
            persistStateLocked(stored)
        }

        var managed = stored.downloadId?.let(::queryManagedDownloadLocked)
        if (managed == null) {
            managed = findManagedDownloadLocked(stored)
            if (managed != null && stored.downloadId != managed.id) {
                stored = stored.copy(downloadId = managed.id)
                persistStateLocked(stored)
            }
        }

        val stagedFile = managed?.file ?: managedDownloadFileOrNull(stored)
        if (managed?.status == DownloadManager.STATUS_SUCCESSFUL) {
            return try {
                promoteManagedDownloadLocked(stored, managed, stagedFile ?: error("Downloaded APK is missing."))
            } catch (error: Exception) {
                cleanupManagedDownloadLocked(stored, deleteStagedFile = true)
                val failed = stored.copy(
                    downloadId = null,
                    verified = false,
                    state = DOWNLOAD_STATE_FAILED,
                    error = error.message ?: "Downloaded APK verification failed.",
                    verifiedBytes = 0L,
                    verifiedLastModified = 0L,
                )
                persistStateLocked(failed)
                snapshot(
                    failed,
                    DOWNLOAD_STATE_FAILED,
                    stagedFile?.takeIf { it.isFile }?.length() ?: 0L,
                    stored.target.bytes,
                )
            }
        }

        if (managed == null) {
            val bytes = stagedFile?.takeIf { it.isFile }?.length() ?: 0L
            val state = when {
                stored.state == DOWNLOAD_STATE_FAILED -> DOWNLOAD_STATE_FAILED
                bytes > 0L -> DOWNLOAD_STATE_FAILED
                else -> DOWNLOAD_STATE_IDLE
            }
            val error = when {
                stored.error.isNotBlank() -> stored.error
                bytes > 0L -> "Android lost the managed download record. Start the update again."
                else -> ""
            }
            if (stored.state != state || stored.error != error || stored.downloadId != null) {
                stored = stored.copy(downloadId = null, state = state, error = error)
                persistStateLocked(stored)
            }
            return snapshot(stored, state, bytes, stored.target.bytes, error)
        }

        val totalBytes = managed.totalBytes.takeIf { it > 0L } ?: stored.target.bytes
        return when (managed.status) {
            DownloadManager.STATUS_PENDING,
            DownloadManager.STATUS_RUNNING,
            -> {
                stored = persistStateHintLocked(stored, DOWNLOAD_STATE_DOWNLOADING, "")
                snapshot(stored, DOWNLOAD_STATE_DOWNLOADING, managed.bytes, totalBytes)
            }
            DownloadManager.STATUS_PAUSED -> {
                stored = persistStateHintLocked(stored, DOWNLOAD_STATE_PAUSED, "")
                snapshot(stored, DOWNLOAD_STATE_PAUSED, managed.bytes, totalBytes)
            }
            DownloadManager.STATUS_FAILED -> {
                val message = "Android download failed${managed.reason?.let { " (reason $it)" } ?: ""}."
                stored = persistStateHintLocked(stored, DOWNLOAD_STATE_FAILED, message)
                snapshot(stored, DOWNLOAD_STATE_FAILED, managed.bytes, totalBytes, message)
            }
            else -> snapshot(stored, DOWNLOAD_STATE_IDLE, managed.bytes, totalBytes)
        }
    }

    private fun promoteManagedDownloadLocked(
        stored: StoredUpdateState,
        managed: ManagedDownloadStatus?,
        source: File,
    ): UpdateSnapshot {
        verifyTargetFile(source, stored.target)
        updatesDir.mkdirs()
        val temporary = File(updatesDir, "${BuildConfig.CAATUU_UPDATE_APK_NAME}.verified")
        temporary.delete()
        source.copyTo(temporary, overwrite = true)
        try {
            verifyTargetFile(temporary, stored.target)
            moveIntoPlace(temporary, updateApk)
            verifyTargetFile(updateApk, stored.target)
        } finally {
            temporary.delete()
        }

        val ready = stored.copy(
            downloadId = null,
            downloadFileName = "",
            verified = true,
            state = DOWNLOAD_STATE_READY,
            error = "",
            verifiedBytes = updateApk.length(),
            verifiedLastModified = updateApk.lastModified(),
        )
        persistStateLocked(ready)
        managed?.id?.let { runCatching { downloadManager.remove(it) } }
        source.delete()
        return snapshot(ready, DOWNLOAD_STATE_READY, updateApk.length(), stored.target.bytes)
    }

    private fun snapshot(
        stored: StoredUpdateState,
        state: String,
        downloadedBytes: Long,
        totalBytes: Long,
        error: String = stored.error,
    ): UpdateSnapshot =
        UpdateSnapshot(
            target = stored.target,
            state = state,
            downloadActive = state == DOWNLOAD_STATE_DOWNLOADING,
            resumable = state == DOWNLOAD_STATE_DOWNLOADING || state == DOWNLOAD_STATE_PAUSED,
            downloadedBytes = downloadedBytes.coerceAtLeast(0L),
            totalBytes = totalBytes.takeIf { it > 0L } ?: stored.target.bytes,
            error = error,
        )

    private fun queryManagedDownloadLocked(downloadId: Long): ManagedDownloadStatus? {
        val cursor = downloadManager.query(DownloadManager.Query().setFilterById(downloadId))
        cursor.use {
            if (it == null || !it.moveToFirst()) return null
            return managedDownloadStatusFromCursor(it)
        }
    }

    private fun findManagedDownloadLocked(stored: StoredUpdateState): ManagedDownloadStatus? {
        val expectedFile = managedDownloadFileOrNull(stored)?.canonicalFile
        val cursor = downloadManager.query(DownloadManager.Query())
        cursor.use {
            if (it == null) return null
            var match: ManagedDownloadStatus? = null
            while (it.moveToNext()) {
                if (it.stringColumn(DownloadManager.COLUMN_URI) != stored.target.apkUrl) continue
                val candidate = managedDownloadStatusFromCursor(it)
                val candidateFile = candidate.file?.canonicalFile
                if (expectedFile != null && candidateFile != null && candidateFile != expectedFile) continue
                if (match == null || candidate.id > match.id) match = candidate
            }
            return match
        }
    }

    private fun managedDownloadStatusFromCursor(cursor: Cursor): ManagedDownloadStatus {
        val localUri = cursor.stringColumn(DownloadManager.COLUMN_LOCAL_URI)
        return ManagedDownloadStatus(
            id = cursor.longColumn(DownloadManager.COLUMN_ID),
            status = cursor.intColumn(DownloadManager.COLUMN_STATUS),
            reason = cursor.intColumn(DownloadManager.COLUMN_REASON),
            bytes = cursor.longColumn(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR),
            totalBytes = cursor.longColumn(DownloadManager.COLUMN_TOTAL_SIZE_BYTES),
            file = fileFromLocalUri(localUri),
        )
    }

    private fun managedDownloadIdsUnderRootLocked(root: File?): Set<Long> {
        val canonicalRoot = root?.canonicalFile ?: return emptySet()
        val prefix = canonicalRoot.path.trimEnd(File.separatorChar) + File.separator
        val ids = mutableSetOf<Long>()
        val cursor = downloadManager.query(DownloadManager.Query())
        cursor.use {
            if (it == null) return ids
            while (it.moveToNext()) {
                val file = fileFromLocalUri(it.stringColumn(DownloadManager.COLUMN_LOCAL_URI))?.canonicalFile
                if (file != null && file.path.startsWith(prefix)) {
                    ids += it.longColumn(DownloadManager.COLUMN_ID)
                }
            }
        }
        return ids
    }

    private fun cleanupManagedDownloadLocked(
        stored: StoredUpdateState,
        deleteStagedFile: Boolean = true,
    ) {
        stored.downloadId?.let { runCatching { downloadManager.remove(it) } }
        if (deleteStagedFile) managedDownloadFileOrNull(stored)?.delete()
    }

    private fun clearStoredArtifactsLocked(stored: StoredUpdateState?) {
        val managedRoot = managedUpdatesRootOrNull()
        val downloadIds = managedDownloadIdsUnderRootLocked(managedRoot).toMutableSet()
        stored?.downloadId?.let(downloadIds::add)
        if (downloadIds.isNotEmpty()) {
            runCatching { downloadManager.remove(*downloadIds.toLongArray()) }
        }
        stored?.let { managedDownloadFileOrNull(it)?.delete() }
        updateApk.delete()
        File(updatesDir, "${BuildConfig.CAATUU_UPDATE_APK_NAME}.verified").delete()
        managedRoot?.deleteRecursively()
        check(updatePrefs.edit().remove(UPDATE_STATE_KEY).commit()) {
            "Could not clear persisted app update state."
        }
    }

    private fun persistStateHintLocked(
        stored: StoredUpdateState,
        state: String,
        error: String,
    ): StoredUpdateState {
        if (stored.state == state && stored.error == error) return stored
        return stored.copy(state = state, error = error).also(::persistStateLocked)
    }

    private fun persistStateLocked(stored: StoredUpdateState) {
        val body = JSONObject()
            .put("manifest", stored.target.manifest())
            .put("downloadId", stored.downloadId ?: JSONObject.NULL)
            .put("downloadFileName", stored.downloadFileName)
            .put("verified", stored.verified)
            .put("state", stored.state)
            .put("error", stored.error)
            .put("verifiedBytes", stored.verifiedBytes)
            .put("verifiedLastModified", stored.verifiedLastModified)
            .toString()
        check(updatePrefs.edit().putString(UPDATE_STATE_KEY, body).commit()) {
            "Could not persist app update state."
        }
    }

    private fun loadStoredStateLocked(): StoredUpdateState? {
        val raw = updatePrefs.getString(UPDATE_STATE_KEY, null) ?: return null
        return try {
            val body = JSONObject(raw)
            val target = updateTarget(body.getJSONObject("manifest"), requireNewer = false)
            StoredUpdateState(
                target = target,
                downloadId = body.optLong("downloadId", -1L).takeIf { it > 0L },
                downloadFileName = body.optString("downloadFileName"),
                verified = body.optBoolean("verified", false),
                state = body.optString("state", DOWNLOAD_STATE_IDLE).takeIf { it in DOWNLOAD_STATES }
                    ?: DOWNLOAD_STATE_IDLE,
                error = body.optString("error"),
                verifiedBytes = body.optLong("verifiedBytes", 0L),
                verifiedLastModified = body.optLong("verifiedLastModified", 0L),
            )
        } catch (_: Exception) {
            updatePrefs.edit().remove(UPDATE_STATE_KEY).commit()
            null
        }
    }

    private fun managedUpdatesRoot(): File =
        managedUpdatesRootOrNull() ?: error("App-specific download storage is unavailable.")

    private fun managedUpdatesRootOrNull(): File? =
        appContext.getExternalFilesDir(MANAGED_UPDATES_DIRECTORY)

    private fun managedDownloadFileName(target: UpdateTarget): String =
        "caatuu-${target.versionCode}-${target.sha256.take(16)}.apk"

    private fun managedDownloadFileOrNull(stored: StoredUpdateState): File? {
        if (stored.downloadFileName.isBlank()) return null
        return managedUpdatesRootOrNull()?.resolve(stored.downloadFileName)
    }

    private fun verifyTargetFile(file: File, target: UpdateTarget) {
        require(file.isFile) { "Downloaded APK is missing." }
        require(file.length() == target.bytes) {
            "APK size mismatch: expected ${target.bytes} bytes, got ${file.length()}"
        }
        val actualSha = sha256(file)
        require(actualSha == target.sha256) {
            "APK SHA-256 mismatch: expected ${target.sha256}, got $actualSha"
        }
        verifyUpdateArchive(file, target.manifest())
    }

    private fun verificationStampMatches(stored: StoredUpdateState, file: File): Boolean =
        stored.verified &&
            stored.state == DOWNLOAD_STATE_READY &&
            file.isFile &&
            stored.verifiedBytes == stored.target.bytes &&
            file.length() == stored.verifiedBytes &&
            stored.verifiedLastModified > 0L &&
            file.lastModified() == stored.verifiedLastModified

    private fun isRetryableIntegrityFailure(error: String): Boolean =
        error.startsWith("APK size mismatch:") || error.startsWith("APK SHA-256 mismatch:")

    private fun verifyUpdateArchive(file: File, manifest: JSONObject) {
        val archive = archivePackageInfo(file)
            ?: error("Downloaded APK package metadata could not be read.")
        val installed = installedPackageInfo()

        require(archive.packageName == appContext.packageName) {
            "Downloaded APK package does not match Caatuu."
        }
        require(manifest.optString("package_name") == archive.packageName) {
            "Update manifest package does not match the APK."
        }
        require(archive.longVersionCode == manifest.optLong("version_code", 0L)) {
            "Update manifest version does not match the APK."
        }

        val archiveDebuggable = archive.applicationInfo
            ?.let { info -> info.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0 }
            ?: false
        require(archiveDebuggable == BuildConfig.DEBUG) {
            "Downloaded APK build type does not match the installed update channel."
        }
        require(manifest.optBoolean("debuggable", !archiveDebuggable) == archiveDebuggable) {
            "Update manifest debuggable flag does not match the APK."
        }
        val expectedBuildType = if (BuildConfig.DEBUG) "debug" else "release"
        require(manifest.optString("build_type") == expectedBuildType) {
            "Update manifest build type does not match the installed channel."
        }

        val installedSigners = currentSignerFingerprints(installed)
        val archiveLineage = signerLineageFingerprints(archive)
        require(installedSigners.isNotEmpty() && archiveLineage.containsAll(installedSigners)) {
            "Downloaded APK signer does not continue the installed Caatuu signing lineage."
        }
    }

    @Suppress("DEPRECATION")
    private fun archivePackageInfo(file: File): PackageInfo? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            appContext.packageManager.getPackageArchiveInfo(
                file.absolutePath,
                PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
            )
        } else {
            appContext.packageManager.getPackageArchiveInfo(
                file.absolutePath,
                PackageManager.GET_SIGNING_CERTIFICATES,
            )
        }

    @Suppress("DEPRECATION")
    private fun installedPackageInfo(): PackageInfo =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            appContext.packageManager.getPackageInfo(
                appContext.packageName,
                PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
            )
        } else {
            appContext.packageManager.getPackageInfo(
                appContext.packageName,
                PackageManager.GET_SIGNING_CERTIFICATES,
            )
        }

    private fun currentSignerFingerprints(packageInfo: PackageInfo): Set<String> =
        packageInfo.signingInfo
            ?.apkContentsSigners
            .orEmpty()
            .mapTo(mutableSetOf(), ::signatureFingerprint)

    private fun signerLineageFingerprints(packageInfo: PackageInfo): Set<String> {
        val signingInfo = packageInfo.signingInfo ?: return emptySet()
        val signatures = if (signingInfo.hasMultipleSigners()) {
            signingInfo.apkContentsSigners
        } else {
            signingInfo.signingCertificateHistory
        }
        return signatures.orEmpty().mapTo(mutableSetOf(), ::signatureFingerprint)
    }

    private fun signatureFingerprint(signature: Signature): String =
        MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).toHex()

    private fun baseStatusJson(): JSONObject =
        JSONObject()
            .put("selfUpdateEnabled", BuildConfig.CAATUU_SELF_UPDATE_ENABLED)
            .put("currentVersionCode", BuildConfig.VERSION_CODE)
            .put("currentVersionName", BuildConfig.VERSION_NAME)
            .put("manifestUrl", updateManifestUrl)
            .put("apkUrl", updateApkUrl)
            .put("updatePath", updatesDir.absolutePath)
            .put("cachePath", updatesDir.absolutePath)
            .put("deletedOnUninstall", true)
            .put("canRequestPackageInstalls", canRequestPackageInstalls())
            .put("downloaded", false)
            .put("downloadReady", false)
            .put("readyToInstall", false)
            .put("downloadState", DOWNLOAD_STATE_IDLE)
            .put("downloadActive", false)
            .put("resumable", false)
            .put("downloadedVersionCode", 0)
            .put("downloadedVersionName", "")
            .put("downloadedBytes", 0L)
            .put("bytes", 0L)
            .put("partialBytes", 0L)
            .put("totalBytes", 0L)
            .put("latestBytes", 0L)
            .put("progress", 0.0)
            .put("downloadProgress", 0.0)
            .put("updateAvailable", false)

    private fun JSONObject.putLocalSnapshot(snapshot: UpdateSnapshot): JSONObject {
        put("statusSource", "local")
            .put("latestVersionCode", snapshot.target.versionCode)
            .put("latestVersionName", snapshot.target.versionName)
            .put("latestBytes", snapshot.target.bytes)
            .put("latestSha256", snapshot.target.sha256)
            .put("manifest", snapshot.target.manifest())
            .put("apkUrl", snapshot.target.apkUrl)
            .put("updateAvailable", snapshot.target.versionCode > BuildConfig.VERSION_CODE.toLong())
        return putDownloadSnapshot(snapshot)
    }

    private fun JSONObject.putDownloadSnapshot(snapshot: UpdateSnapshot): JSONObject {
        val progress = if (snapshot.totalBytes > 0L) {
            (snapshot.downloadedBytes.toDouble() / snapshot.totalBytes.toDouble() * 100.0)
                .coerceIn(0.0, 100.0)
        } else {
            0.0
        }
        return put("downloaded", snapshot.ready)
            .put("downloadReady", snapshot.ready)
            .put("readyToInstall", snapshot.ready)
            .put("downloadState", snapshot.state)
            .put("downloadActive", snapshot.downloadActive)
            .put("resumable", snapshot.resumable)
            .put("downloadedVersionCode", snapshot.target.versionCode)
            .put("downloadedVersionName", snapshot.target.versionName)
            .put("downloadedBytes", snapshot.downloadedBytes)
            .put("bytes", snapshot.downloadedBytes)
            .put("partialBytes", if (snapshot.ready) 0L else snapshot.downloadedBytes)
            .put("totalBytes", snapshot.totalBytes)
            .put("progress", progress)
            .put("downloadProgress", progress)
            .put("downloadError", snapshot.error)
    }

    private fun JSONObject.putManifestStatus(target: UpdateTarget): JSONObject {
        return put("statusSource", "server")
            .put("serverReachable", true)
            .put("latestVersionCode", target.versionCode)
            .put("latestVersionName", target.versionName)
            .put("latestBytes", target.bytes)
            .put("totalBytes", target.bytes)
            .put("latestSha256", target.sha256)
            .put("manifest", target.manifest())
            .put("apkUrl", target.apkUrl)
            .put("updateAvailable", target.versionCode > BuildConfig.VERSION_CODE.toLong())
    }

    private fun updateResult(
        target: UpdateTarget,
        reused: Boolean = false,
        recovered: Boolean = false,
        resumed: Boolean = false,
    ): JSONObject =
        JSONObject()
            .put("currentVersionCode", BuildConfig.VERSION_CODE)
            .put("currentVersionName", BuildConfig.VERSION_NAME)
            .put("manifest", target.manifest())
            .put("apkUrl", target.apkUrl)
            .put("path", updateApk.absolutePath)
            .put("bytes", updateApk.length())
            .put("downloadedBytes", updateApk.length())
            .put("totalBytes", target.bytes)
            .put("latestBytes", target.bytes)
            .put("sha256", target.sha256)
            .put("verified", true)
            .put("downloadReady", true)
            .put("readyToInstall", true)
            .put("downloadState", DOWNLOAD_STATE_READY)
            .put("downloadActive", false)
            .put("resumable", false)
            .put("downloadedVersionCode", target.versionCode)
            .put("downloadedVersionName", target.versionName)
            .put("progress", 100.0)
            .put("downloadProgress", 100.0)
            .put("reused", reused)
            .put("recovered", recovered)
            .put("resumed", resumed)

    private fun moveIntoPlace(source: File, destination: File) {
        destination.delete()
        if (!source.renameTo(destination)) {
            source.copyTo(destination, overwrite = true)
            source.delete()
        }
    }

    private fun pruneStaleUpdateFilesLocked(stored: StoredUpdateState?) {
        val allowedInternal = if (stored == null) emptySet() else setOf(BuildConfig.CAATUU_UPDATE_APK_NAME)
        updatesDir.listFiles()?.forEach { file ->
            if (file.isFile && file.name !in allowedInternal) file.delete()
        }
        val allowedManaged = stored
            ?.downloadFileName
            ?.takeIf { it.isNotBlank() }
            ?.let(::setOf)
            ?: emptySet()
        managedUpdatesRootOrNull()?.listFiles()?.forEach { file ->
            if (file.isFile && file.name !in allowedManaged) file.delete()
        }
        if (stored == null) updateApk.delete()
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        file.inputStream().use { input ->
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().toHex()
    }

    private fun directorySize(file: File?): Long {
        if (file == null || !file.exists()) return 0L
        if (file.isFile) return file.length()
        return file.listFiles()?.sumOf { directorySize(it) } ?: 0L
    }

    private fun Cursor.longColumn(name: String): Long =
        getColumnIndex(name)
            .takeIf { it >= 0 && !isNull(it) }
            ?.let { getLong(it) }
            ?: 0L

    private fun Cursor.intColumn(name: String): Int? =
        getColumnIndex(name)
            .takeIf { it >= 0 && !isNull(it) }
            ?.let { getInt(it) }

    private fun Cursor.stringColumn(name: String): String? =
        getColumnIndex(name)
            .takeIf { it >= 0 && !isNull(it) }
            ?.let { getString(it) }

    private fun fileFromLocalUri(localUri: String?): File? {
        val uri = localUri?.let { runCatching { Uri.parse(it) }.getOrNull() } ?: return null
        return uri.path?.takeIf { uri.scheme == "file" }?.let(::File)
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    companion object {
        private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
        private const val UPDATE_PREFS = "caatuu-app-update-v2"
        private const val UPDATE_STATE_KEY = "state"
        private const val MANAGED_UPDATES_DIRECTORY = "update-downloads"
        private const val LEGACY_UPDATES_DIRECTORY = "updates"
        private const val DOWNLOAD_STATE_READY = "ready"
        private const val DOWNLOAD_STATE_DOWNLOADING = "downloading"
        private const val DOWNLOAD_STATE_PAUSED = "paused"
        private const val DOWNLOAD_STATE_FAILED = "failed"
        private const val DOWNLOAD_STATE_IDLE = "idle"
        private const val DOWNLOAD_POLL_MILLIS = 750L
        private const val MAX_UPDATE_MANIFEST_BYTES = 64 * 1024
        private const val MAX_UPDATE_APK_BYTES = 1024L * 1024L * 1024L
        private const val UPDATE_MANIFEST_ATTEMPTS = 4
        private const val MAX_UPDATE_INTEGRITY_RETRIES = 1
        private val UPDATE_RETRY_DELAYS_MILLIS = longArrayOf(600L, 1_400L, 2_800L)
        private val RETRYABLE_HTTP_CODES = setOf(408, 425, 429)
        private val DOWNLOAD_STATES = setOf(
            DOWNLOAD_STATE_READY,
            DOWNLOAD_STATE_DOWNLOADING,
            DOWNLOAD_STATE_PAUSED,
            DOWNLOAD_STATE_FAILED,
            DOWNLOAD_STATE_IDLE,
        )
        private val SHA256_PATTERN = Regex("^[0-9a-fA-F]{64}$")
        private val PROCESS_UPDATE_MUTEX = Mutex()
        private val PROCESS_STATE_LOCK = Any()
    }
}
