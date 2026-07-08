package com.caatuu.android

import android.app.DownloadManager
import android.content.Context
import android.database.Cursor
import android.net.Uri
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.coroutines.coroutineContext

data class ModelProgress(
    val bytesRead: Long,
    val totalBytes: Long,
)

data class LocalModelSpec(
    val key: String,
    val label: String,
    val shortLabel: String,
    val runId: String,
    val repoId: String,
    val license: String,
    val baseModel: String,
    val adapter: String,
    val intendedUse: String,
    val supportsThinking: Boolean,
    val fileName: String,
    val manifestFileName: String,
    val sha256: String,
    val bytes: Long,
    val quantization: String = "Q4_K_M",
    val format: String = "gguf",
    val runtime: String = "llama.cpp Android",
    val deprecated: Boolean = false,
    val status: String = "active",
    val replacementStatus: String = "",
)

data class LocalModelCatalog(
    val defaultModelKey: String,
    val baseUrl: String,
    val models: List<LocalModelSpec>,
)

class ModelManager(context: Context) {
    private val appContext = context.applicationContext
    private val modelsDir = File(appContext.filesDir, "models")
    private val downloadManager = appContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private val downloadPrefs = appContext.getSharedPreferences(MODEL_DOWNLOAD_PREFS, Context.MODE_PRIVATE)
    private val modelCatalog = loadModelCatalog()
    private val modelSpecs = modelCatalog.models
    private val defaultModelKey = modelCatalog.defaultModelKey
    private val modelBaseUrl = modelCatalog.baseUrl.trimEnd('/')
    private val modelsByKey = modelSpecs.associateBy { it.key }

    private data class ManagedDownloadStatus(
        val id: Long?,
        val status: Int?,
        val reason: Int?,
        val bytes: Long,
        val totalBytes: Long,
        val file: File?,
        val localUri: String?,
    ) {
        val statusName: String = when (status) {
            DownloadManager.STATUS_PENDING -> "pending"
            DownloadManager.STATUS_RUNNING -> "running"
            DownloadManager.STATUS_PAUSED -> "paused"
            DownloadManager.STATUS_SUCCESSFUL -> "successful"
            DownloadManager.STATUS_FAILED -> "failed"
            null -> if (file?.isFile == true) "file-only" else "missing"
            else -> "unknown"
        }

        val isActive: Boolean =
            status == DownloadManager.STATUS_PENDING ||
                status == DownloadManager.STATUS_RUNNING ||
                status == DownloadManager.STATUS_PAUSED

        val isFailed: Boolean = status == DownloadManager.STATUS_FAILED

        fun isCompleteFor(spec: LocalModelSpec): Boolean =
            status == DownloadManager.STATUS_SUCCESSFUL &&
                file?.isFile == true &&
                file.length() == spec.bytes

        fun toJson(spec: LocalModelSpec): JSONObject =
            JSONObject()
                .put("id", id ?: JSONObject.NULL)
                .put("status", statusName)
                .put("reason", reason ?: JSONObject.NULL)
                .put("active", isActive)
                .put("failed", isFailed)
                .put("bytes", bytes)
                .put("totalBytes", totalBytes.takeIf { it > 0L } ?: spec.bytes)
                .put("fileBytes", file?.takeIf { it.isFile }?.length() ?: 0L)
                .put("complete", isCompleteFor(spec))
                .put("resumable", isActive || isCompleteFor(spec))
                .put("localUri", localUri ?: JSONObject.NULL)
    }

    fun modelSpec(modelKey: String?): LocalModelSpec = resolveModel(modelKey)

    fun statusJson(modelKey: String? = null): JSONObject {
        val spec = resolveModel(modelKey)
        val file = modelFile(spec)
        val tmpFile = downloadFile(spec)
        val managed = runCatching { managedDownloadStatus(spec) }.getOrNull()
        val finalBytes = file.takeIf { it.isFile }?.length() ?: 0L
        val tempBytes = tmpFile.takeIf { it.isFile }?.length() ?: 0L
        val managedBytes = managed?.bytes?.takeIf { it > 0L }
            ?: managed?.file?.takeIf { it.isFile }?.length()
            ?: 0L
        val localBytes = listOf(finalBytes, tempBytes, managedBytes).maxOrNull() ?: 0L
        val completeFile = file.isFile && finalBytes == spec.bytes
        val partialFile = file.isFile && localBytes != spec.bytes
        val partialDownload = tmpFile.isFile && tempBytes in 1 until spec.bytes
        val completeDownload = tmpFile.isFile && tempBytes == spec.bytes
        val completeManagedDownload = managed?.isCompleteFor(spec) == true
        val activeManagedDownload = managed?.isActive == true
        val failedManagedDownload = managed?.isFailed == true
        val partialManagedDownload = activeManagedDownload && managedBytes in 1 until spec.bytes
        val verified = isMarkedVerified(spec)
        val downloadCompletePendingVerify = completeDownload || completeManagedDownload || (completeFile && !verified)
        return JSONObject()
            .put("runtime", spec.runtime)
            .put("modelKey", spec.key)
            .put("defaultModelKey", defaultModelKey)
            .put("label", spec.label)
            .put("shortLabel", spec.shortLabel)
            .put("runId", spec.runId)
            .put("repoId", spec.repoId)
            .put("license", spec.license)
            .put("baseModel", spec.baseModel)
            .put("adapter", spec.adapter)
            .put("intendedUse", spec.intendedUse)
            .put("deprecated", spec.deprecated)
            .put("status", spec.status)
            .put("replacementStatus", spec.replacementStatus)
            .put("replacement_status", spec.replacementStatus)
            .put("format", spec.format)
            .put("quantization", spec.quantization)
            .put("modelName", spec.fileName)
            .put("modelFile", spec.fileName)
            .put("modelUrl", modelUrl(spec))
            .put("manifestUrl", "$modelBaseUrl/${spec.manifestFileName}")
            .put("sha256", spec.sha256)
            .put("expectedBytes", spec.bytes)
            .put("path", file.absolutePath)
            .put("storageScope", "app-private filesDir")
            .put("deletedOnUninstall", true)
            .put("generationControls", generationControls(spec))
            .put("models", modelCatalogJson())
            .put("downloaded", completeFile || completeManagedDownload)
            .put("partial", partialFile || partialDownload || partialManagedDownload)
            .put("resumable", partialDownload || completeDownload || activeManagedDownload || completeManagedDownload)
            .put("downloadActive", activeManagedDownload)
            .put("downloadFailed", failedManagedDownload)
            .put("downloadCompletePendingVerify", downloadCompletePendingVerify)
            .put(
                "downloadNeedsStart",
                !verified && !completeFile && !completeDownload && !completeManagedDownload && !activeManagedDownload,
            )
            .put("bytes", localBytes)
            .put("finalBytes", finalBytes)
            .put("downloadBytes", tempBytes)
            .put("managedDownloadBytes", managedBytes)
            .put("downloadManager", managed?.toJson(spec) ?: JSONObject.NULL)
            .put("verified", verified)
            .put(
                "localState",
                when {
                    verified -> "verified"
                    completeFile -> "downloaded-unverified"
                    partialFile -> "partial"
                    completeManagedDownload -> "download-complete-pending-verify"
                    activeManagedDownload -> "system-download-${managed.statusName}"
                    completeDownload -> "download-complete-pending-verify"
                    partialDownload -> "partial-download"
                    else -> "missing"
                },
            )
    }

    suspend fun ensureModel(modelKey: String?, onProgress: (ModelProgress) -> Unit): File =
        withContext(Dispatchers.IO) {
            val spec = resolveModel(modelKey)
            val file = modelFile(spec)
            val marker = shaFile(spec)
            modelsDir.mkdirs()
            if (isMarkedVerified(spec) && file.isFile) return@withContext file

            if (file.isFile && file.length() == spec.bytes && sha256(file) == spec.sha256) {
                markVerified(marker, spec)
                return@withContext file
            }

            file.delete()
            marker.delete()

            val sourceFile = completeLegacyDownload(spec) ?: waitForManagedDownload(spec, onProgress)

            val actualSha = sha256(sourceFile)
            if (actualSha != spec.sha256) {
                sourceFile.delete()
                clearManagedDownload(spec, removeFile = false)
                throw IOException("Model SHA-256 mismatch: expected ${spec.sha256}, got $actualSha")
            }
            if (sourceFile.length() != spec.bytes) {
                throw IOException("Model size mismatch: expected ${spec.bytes} bytes, got ${sourceFile.length()}")
            }

            if (sourceFile != file) {
                sourceFile.copyTo(file, overwrite = true)
                sourceFile.delete()
            }
            markVerified(marker, spec)
            clearManagedDownload(spec, removeFile = false)
            file
        }

    suspend fun startManagedDownload(modelKey: String?): JSONObject =
        withContext(Dispatchers.IO) {
            val spec = resolveModel(modelKey)
            val file = modelFile(spec)
            val marker = shaFile(spec)
            modelsDir.mkdirs()

            if (isMarkedVerified(spec) && file.isFile) {
                return@withContext statusJson(spec.key).put("downloadStarted", false)
            }

            if (file.isFile) {
                if (file.length() == spec.bytes && sha256(file) == spec.sha256) {
                    markVerified(marker, spec)
                    return@withContext statusJson(spec.key).put("downloadStarted", false)
                }
                file.delete()
                marker.delete()
            }

            val legacyDownload = completeLegacyDownload(spec)
            if (legacyDownload != null) {
                if (sha256(legacyDownload) == spec.sha256) {
                    return@withContext statusJson(spec.key).put("downloadStarted", false)
                }
                legacyDownload.delete()
            }

            val managed = managedDownloadStatus(spec)
            if (managed?.isCompleteFor(spec) == true) {
                val managedFile = managed.file ?: managedDownloadFile(spec)
                if (managedFile.isFile && sha256(managedFile) == spec.sha256) {
                    return@withContext statusJson(spec.key).put("downloadStarted", false)
                }
                clearManagedDownload(spec, removeFile = true)
            }
            if (managed?.isActive == true) {
                return@withContext statusJson(spec.key).put("downloadStarted", false)
            }
            if (managed?.isFailed == true) {
                clearManagedDownload(spec, removeFile = true)
            }

            val downloadId = enqueueManagedDownload(spec)
            statusJson(spec.key)
                .put("downloadStarted", true)
                .put("downloadId", downloadId)
        }

    suspend fun cancelRequiredDownloads(): JSONObject =
        withContext(Dispatchers.IO) {
            val cancelledModels = JSONArray()
            var cancelled = 0
            var bytesDeleted = 0L

            requiredModelSpecs().forEach { spec ->
                val status = runCatching { managedDownloadStatus(spec) }.getOrNull()
                val target = managedDownloadsRootOrNull()?.resolve(spec.fileName)
                val targetBytes = target?.takeIf { it.isFile }?.length() ?: 0L
                val shouldCancel = !isMarkedVerified(spec) &&
                    (status?.isActive == true || status?.isFailed == true || targetBytes > 0L)

                if (shouldCancel) {
                    bytesDeleted += targetBytes
                    clearManagedDownload(spec, removeFile = true)
                    cancelled += 1
                    cancelledModels.put(
                        JSONObject()
                            .put("modelKey", spec.key)
                            .put("label", spec.shortLabel)
                            .put("bytesDeleted", targetBytes),
                    )
                }
            }

            JSONObject()
                .put("cancelled", cancelled)
                .put("bytesDeleted", bytesDeleted)
                .put("models", cancelledModels)
        }

    suspend fun deleteLocalModel(): JSONObject =
        withContext(Dispatchers.IO) {
            val bytesDeleted = directorySize(modelsDir) + (managedDownloadsRootOrNull()?.let { directorySize(it) } ?: 0L)
            modelSpecs.forEach { spec -> clearManagedDownload(spec, removeFile = true) }
            val deleted = !modelsDir.exists() || modelsDir.deleteRecursively()
            val downloadDir = managedDownloadsRootOrNull()
            val downloadsDeleted = downloadDir == null || !downloadDir.exists() || downloadDir.deleteRecursively()
            JSONObject()
                .put("storageScope", "app-private filesDir")
                .put("deletedOnUninstall", true)
                .put("path", modelsDir.absolutePath)
                .put("downloadManagerPath", downloadDir?.absolutePath ?: JSONObject.NULL)
                .put("bytesDeleted", bytesDeleted)
                .put("deleted", deleted && downloadsDeleted)
                .put("status", statusJson())
        }

    private fun resolveModel(modelKey: String?): LocalModelSpec {
        val key = modelKey?.takeIf { it.isNotBlank() } ?: defaultModelKey
        return modelsByKey[key] ?: modelsByKey.getValue(defaultModelKey)
    }

    fun requiredModelSpecs(): List<LocalModelSpec> =
        modelSpecs.filter { spec -> spec.status == "active" && !spec.deprecated }

    private fun modelUrl(spec: LocalModelSpec): String = "$modelBaseUrl/${spec.fileName}"

    private fun modelFile(spec: LocalModelSpec): File = File(modelsDir, spec.fileName)

    private fun downloadFile(spec: LocalModelSpec): File = File(modelsDir, "${spec.fileName}.download")

    private fun managedDownloadsRoot(): File =
        appContext.getExternalFilesDir("model-downloads")
            ?.resolve("models")
            ?.also { it.mkdirs() }
            ?: throw IOException("Android app-specific external storage is not available for system downloads.")

    private fun managedDownloadsRootOrNull(): File? =
        appContext.getExternalFilesDir("model-downloads")?.resolve("models")

    private fun managedDownloadFile(spec: LocalModelSpec): File = File(managedDownloadsRoot(), spec.fileName)

    private fun shaFile(spec: LocalModelSpec): File = File(modelsDir, "${spec.fileName}.sha256")

    private fun completeLegacyDownload(spec: LocalModelSpec): File? {
        val tmpFile = downloadFile(spec)
        return tmpFile.takeIf { it.isFile && it.length() == spec.bytes }
    }

    private fun managedDownloadStatus(spec: LocalModelSpec): ManagedDownloadStatus? {
        val target = managedDownloadsRootOrNull()?.resolve(spec.fileName)
        val storedId = storedDownloadId(spec)
        if (storedId == null) {
            return target
                ?.takeIf { it.isFile }
                ?.let { file ->
                    ManagedDownloadStatus(
                        id = null,
                        status = null,
                        reason = null,
                        bytes = file.length(),
                        totalBytes = spec.bytes,
                        file = file,
                        localUri = Uri.fromFile(file).toString(),
                    )
                }
        }

        val cursor = downloadManager.query(DownloadManager.Query().setFilterById(storedId))
        cursor.use {
            if (it == null || !it.moveToFirst()) {
                clearStoredDownload(spec)
                return target
                    ?.takeIf { file -> file.isFile }
                    ?.let { file ->
                        ManagedDownloadStatus(
                            id = null,
                            status = null,
                            reason = null,
                            bytes = file.length(),
                            totalBytes = spec.bytes,
                            file = file,
                            localUri = Uri.fromFile(file).toString(),
                        )
                    }
            }

            val localUri = it.stringColumn(DownloadManager.COLUMN_LOCAL_URI)
            val file = fileFromLocalUri(localUri) ?: target
            return ManagedDownloadStatus(
                id = storedId,
                status = it.intColumn(DownloadManager.COLUMN_STATUS),
                reason = it.intColumn(DownloadManager.COLUMN_REASON),
                bytes = it.longColumn(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
                    .takeIf { bytes -> bytes > 0L }
                    ?: file?.takeIf { localFile -> localFile.isFile }?.length()
                    ?: 0L,
                totalBytes = it.longColumn(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
                    .takeIf { bytes -> bytes > 0L }
                    ?: spec.bytes,
                file = file,
                localUri = localUri,
            )
        }
    }

    private suspend fun waitForManagedDownload(spec: LocalModelSpec, onProgress: (ModelProgress) -> Unit): File {
        downloadFile(spec).takeIf { it.isFile && it.length() > spec.bytes }?.delete()

        managedDownloadStatus(spec)?.let { status ->
            if (status.isCompleteFor(spec)) {
                onProgress(ModelProgress(spec.bytes, spec.bytes))
                return status.file ?: managedDownloadFile(spec)
            }
        }

        if (managedDownloadStatus(spec)?.isActive != true) {
            enqueueManagedDownload(spec)
        }

        var restarts = 0
        while (true) {
            coroutineContext.ensureActive()
            val status = managedDownloadStatus(spec)
            if (status == null) {
                enqueueManagedDownload(spec)
                delay(MODEL_DOWNLOAD_POLL_MS)
                continue
            }

            val totalBytes = status.totalBytes.takeIf { it > 0L } ?: spec.bytes
            onProgress(ModelProgress(status.bytes, totalBytes))

            if (status.isCompleteFor(spec)) {
                onProgress(ModelProgress(spec.bytes, spec.bytes))
                return status.file ?: managedDownloadFile(spec)
            }

            if (status.isFailed) {
                if (status.reason == DownloadManager.ERROR_CANNOT_RESUME || restarts >= MODEL_DOWNLOAD_MANAGER_RESTARTS) {
                    return recoverAndDownloadDirect(spec, status, onProgress)
                }
                restarts += 1
                clearManagedDownload(spec, removeFile = true)
                enqueueManagedDownload(spec)
            }

            delay(MODEL_DOWNLOAD_POLL_MS)
        }
    }

    private suspend fun recoverAndDownloadDirect(
        spec: LocalModelSpec,
        status: ManagedDownloadStatus,
        onProgress: (ModelProgress) -> Unit,
    ): File {
        recoverManagedPartialDownload(spec, status)
        clearManagedDownload(spec, removeFile = true)
        return downloadModelDirect(spec, onProgress)
    }

    private fun recoverManagedPartialDownload(spec: LocalModelSpec, status: ManagedDownloadStatus) {
        val source = status.file?.takeIf { it.isFile } ?: return
        val sourceBytes = source.length()
        if (sourceBytes !in 1 until spec.bytes) return

        val tmpFile = downloadFile(spec)
        val tmpBytes = tmpFile.takeIf { it.isFile }?.length() ?: 0L
        if (tmpBytes >= sourceBytes && tmpBytes <= spec.bytes) return

        tmpFile.parentFile?.mkdirs()
        source.copyTo(tmpFile, overwrite = true)
    }

    private suspend fun downloadModelDirect(spec: LocalModelSpec, onProgress: (ModelProgress) -> Unit): File {
        val tmpFile = downloadFile(spec)
        tmpFile.parentFile?.mkdirs()

        var downloaded = false
        var lastError: Exception? = null
        for (attempt in 1..MODEL_DIRECT_DOWNLOAD_ATTEMPTS) {
            coroutineContext.ensureActive()
            if (downloaded) break
            if (tmpFile.isFile && tmpFile.length() > spec.bytes) tmpFile.delete()

            val resumeBytes = tmpFile
                .takeIf { it.isFile }
                ?.length()
                ?.takeIf { it in 1 until spec.bytes }
                ?: 0L

            val connection = (URL(modelUrl(spec)).openConnection() as HttpURLConnection).apply {
                connectTimeout = MODEL_DIRECT_CONNECT_TIMEOUT_MS
                readTimeout = MODEL_DIRECT_READ_TIMEOUT_MS
                instanceFollowRedirects = true
                if (resumeBytes > 0L) {
                    setRequestProperty("Range", "bytes=$resumeBytes-")
                }
            }

            try {
                connection.connect()
                val statusCode = connection.responseCode
                if (statusCode !in 200..299) {
                    throw IOException("Model download failed with HTTP $statusCode for ${spec.fileName}")
                }

                val append = resumeBytes > 0L && statusCode == HttpURLConnection.HTTP_PARTIAL
                if (!append) tmpFile.delete()

                val totalBytes = if (append) {
                    spec.bytes
                } else {
                    connection.contentLengthLong.takeIf { it > 0L } ?: spec.bytes
                }
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var bytesRead = if (append) resumeBytes else 0L

                connection.inputStream.use { input ->
                    FileOutputStream(tmpFile, append).use { output ->
                        while (true) {
                            coroutineContext.ensureActive()
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            bytesRead += read
                            onProgress(ModelProgress(bytesRead, totalBytes))
                        }
                    }
                }

                downloaded = tmpFile.length() == spec.bytes
                if (!downloaded) {
                    lastError = IOException("Model download stopped at ${tmpFile.length()} of ${spec.bytes} bytes")
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                lastError = error
            } finally {
                connection.disconnect()
            }

            if (!downloaded && attempt < MODEL_DIRECT_DOWNLOAD_ATTEMPTS) {
                delay(MODEL_DIRECT_RETRY_DELAY_MS * attempt)
            }
        }

        if (!downloaded) {
            val detail = lastError?.message ?: "unknown network error"
            throw IOException("Model direct download failed after $MODEL_DIRECT_DOWNLOAD_ATTEMPTS attempts: $detail", lastError)
        }

        return tmpFile
    }

    private fun enqueueManagedDownload(spec: LocalModelSpec): Long {
        val target = managedDownloadFile(spec)
        clearManagedDownload(spec, removeFile = false)
        target.delete()
        target.parentFile?.mkdirs()

        val request = DownloadManager.Request(Uri.parse(modelUrl(spec)))
            .setTitle("Caatuu ${spec.shortLabel}")
            .setDescription("Downloading ${spec.quantization} GGUF model for offline use.")
            .setMimeType("application/octet-stream")
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(false)
            .setRequiresCharging(false)
            .setRequiresDeviceIdle(false)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationUri(Uri.fromFile(target))

        val id = downloadManager.enqueue(request)
        downloadPrefs.edit()
            .putLong(downloadIdKey(spec), id)
            .putString(downloadShaKey(spec), spec.sha256)
            .putString(downloadFileKey(spec), spec.fileName)
            .apply()
        return id
    }

    private fun storedDownloadId(spec: LocalModelSpec): Long? {
        val id = downloadPrefs.getLong(downloadIdKey(spec), -1L)
        if (id < 0L) return null
        val matchesSpec = downloadPrefs.getString(downloadShaKey(spec), null) == spec.sha256 &&
            downloadPrefs.getString(downloadFileKey(spec), null) == spec.fileName
        if (!matchesSpec) {
            clearStoredDownload(spec)
            return null
        }
        return id
    }

    private fun clearManagedDownload(spec: LocalModelSpec, removeFile: Boolean) {
        storedDownloadId(spec)?.let { id ->
            runCatching { downloadManager.remove(id) }
        }
        clearStoredDownload(spec)
        if (removeFile) {
            runCatching { managedDownloadsRootOrNull()?.resolve(spec.fileName)?.delete() }
        }
    }

    private fun clearStoredDownload(spec: LocalModelSpec) {
        downloadPrefs.edit()
            .remove(downloadIdKey(spec))
            .remove(downloadShaKey(spec))
            .remove(downloadFileKey(spec))
            .apply()
    }

    private fun downloadIdKey(spec: LocalModelSpec): String = "model.${spec.key}.downloadId"

    private fun downloadShaKey(spec: LocalModelSpec): String = "model.${spec.key}.sha256"

    private fun downloadFileKey(spec: LocalModelSpec): String = "model.${spec.key}.fileName"

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
        return uri.path?.takeIf { uri.scheme == "file" }?.let { File(it) }
    }

    private fun generationControls(spec: LocalModelSpec): JSONObject =
        JSONObject()
            .put(
                "maxTokens",
                JSONObject()
                    .put("active", true)
                    .put("min", 1)
                    .put("max", 2048)
                    .put("default", 384),
            )
            .put(
                "thinking",
                JSONObject()
                    .put("active", spec.supportsThinking)
                    .put("default", false)
                    .put(
                        "method",
                        if (spec.supportsThinking) "Qwen chat-template enable_thinking" else "unsupported by selected base model",
                    ),
            )
            .put(
                "temperature",
                JSONObject()
                    .put("active", false)
                    .put("nativeDefault", 0.3)
                    .put("pending", "Native sampler temperature is hard-coded today."),
            )
            .put(
                "contextSize",
                JSONObject()
                    .put("active", false)
                    .put("nativeDefault", 8192)
                    .put("pending", "Native context size is hard-coded today."),
            )

    private fun modelCatalogJson(): JSONArray =
        JSONArray().also { array ->
            requiredModelSpecs().forEach { spec ->
                array.put(
                    JSONObject()
                        .put("key", spec.key)
                        .put("label", spec.label)
                        .put("short_label", spec.shortLabel)
                        .put("run_id", spec.runId)
                        .put("repo_id", spec.repoId)
                        .put("license", spec.license)
                        .put("base_model", spec.baseModel)
                        .put("adapter", spec.adapter)
                        .put("intended_use", spec.intendedUse)
                        .put("deprecated", spec.deprecated)
                        .put("status", spec.status)
                        .put("replacement_status", spec.replacementStatus)
                        .put("supports_thinking", spec.supportsThinking)
                        .put("runtime", spec.runtime)
                        .put("format", spec.format)
                        .put("quantization", spec.quantization)
                        .put("model_file", spec.fileName)
                        .put("manifest_file", spec.manifestFileName)
                        .put("bytes", spec.bytes)
                        .put("sha256", spec.sha256),
                )
            }
        }

    private fun loadModelCatalog(): LocalModelCatalog {
        val json = appContext.assets.open(MODEL_CATALOG_ASSET).bufferedReader().use { reader ->
            JSONObject(reader.readText())
        }
        val modelsJson = json.getJSONArray("models")
        val specs = mutableListOf<LocalModelSpec>()
        for (index in 0 until modelsJson.length()) {
            specs += parseModelSpec(modelsJson.getJSONObject(index))
        }
        if (specs.isEmpty()) throw IllegalStateException("$MODEL_CATALOG_ASSET does not define any models.")

        val requestedDefault = json.optString("default_model", FALLBACK_DEFAULT_MODEL_KEY)
        val resolvedDefault = requestedDefault.takeIf { key -> specs.any { it.key == key } } ?: specs.first().key
        return LocalModelCatalog(
            defaultModelKey = resolvedDefault,
            baseUrl = json.optString("base_url", FALLBACK_MODEL_BASE_URL),
            models = specs,
        )
    }

    private fun parseModelSpec(item: JSONObject): LocalModelSpec {
        val key = item.getString("key")
        val label = item.optString("label", key)
        return LocalModelSpec(
            key = key,
            label = label,
            shortLabel = item.optString("short_label", label),
            runId = item.optString("run_id", key),
            repoId = item.optString("repo_id", ""),
            license = item.optString("license", ""),
            baseModel = item.optString("base_model", ""),
            adapter = item.optString("adapter", ""),
            intendedUse = item.optString("intended_use", ""),
            supportsThinking = item.optBoolean("supports_thinking", false),
            fileName = item.getString("model_file"),
            manifestFileName = item.optString("manifest_file", "$key.manifest.json"),
            sha256 = item.getString("sha256"),
            bytes = item.getLong("bytes"),
            quantization = item.optString("quantization", "Q4_K_M"),
            format = item.optString("format", "gguf"),
            runtime = item.optString("runtime", "llama.cpp"),
            deprecated = item.optBoolean("deprecated", false),
            status = item.optString("status", "active"),
            replacementStatus = item.optString("replacement_status", ""),
        )
    }

    private fun directorySize(file: File): Long {
        if (!file.exists()) return 0L
        if (file.isFile) return file.length()
        return file.listFiles()?.sumOf { directorySize(it) } ?: 0L
    }

    private fun isMarkedVerified(spec: LocalModelSpec): Boolean {
        val file = modelFile(spec)
        val marker = shaFile(spec)
        return marker.isFile && marker.readText().trim() == spec.sha256 && file.length() == spec.bytes
    }

    private fun markVerified(marker: File, spec: LocalModelSpec) {
        marker.writeText(spec.sha256)
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().toHex()
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    companion object {
        private const val MODEL_DOWNLOAD_PREFS = "caatuu-model-downloads"
        private const val MODEL_DOWNLOAD_POLL_MS = 1_000L
        private const val MODEL_DOWNLOAD_MANAGER_RESTARTS = 3
        private const val MODEL_DIRECT_DOWNLOAD_ATTEMPTS = 4
        private const val MODEL_DIRECT_CONNECT_TIMEOUT_MS = 30_000
        private const val MODEL_DIRECT_READ_TIMEOUT_MS = 120_000
        private const val MODEL_DIRECT_RETRY_DELAY_MS = 1_500L
        private const val MODEL_CATALOG_ASSET = "data/models/phone-bench/models.json"
        private const val FALLBACK_DEFAULT_MODEL_KEY = "cstinyllama-1.2b-czech-word-sentence-001"
        private const val FALLBACK_MODEL_BASE_URL = "https://caatuu.waajacu.com/cz/data/models/phone-bench"
    }
}
