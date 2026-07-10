package com.caatuu.android

import android.app.Activity
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID
import kotlin.coroutines.coroutineContext
import kotlin.math.max

class CaatuuBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val modelManager: ModelManager,
    private val vectorDatabaseManager: VectorDatabaseManager,
    private val staticAssetManager: StaticAssetManager,
    private val appUpdateManager: AppUpdateManager,
    private val model: NativeCzechModel,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var activeSetupJob: Job? = null

    @JavascriptInterface
    fun postMessage(rawMessage: String) {
        scope.launch {
            val request = try {
                JSONObject(rawMessage)
            } catch (error: Exception) {
                return@launch
            }

            val id = request.optString("id")
            if (id.isBlank()) return@launch

            try {
                when (request.optString("type")) {
                    "status" -> emitDone(id, modelStatusJson(requestModelKey(request)))
                    "start_download" -> startModelDownload(id, request)
                    "cancel_download" -> cancelModelDownload(id)
                    "download" -> downloadModel(id, request)
                    "load" -> loadModel(id, request)
                    "prompt" -> runPrompt(id, request)
                    "benchmark" -> runBenchmark(id)
                    "setup_status" -> emitDone(id, setupStatusJson())
                    "storage_preflight" -> emitDone(id, storagePreflightJson())
                    "setup_download" -> runSetupDownload(id)
                    "setup_abort" -> abortSetup(id)
                    "vector_status" -> emitDone(id, vectorDatabaseManager.statusJson())
                    "vector_download" -> downloadVectorDatabase(id)
                    "vector_search" -> searchVectorDatabase(id, request)
                    "delete_model" -> deleteLocalPack(id)
                    "clear_cache" -> clearCache(id)
                    "update_app_status" -> emitDone(id, appUpdateManager.statusJson())
                    "update_app" -> updateApp(id)
                    "report_bug" -> reportBug(id, request)
                    else -> throw IllegalArgumentException("Unknown native request type.")
                }
            } catch (error: Exception) {
                emitError(id, error)
            }
        }
    }

    fun destroy() {
        scope.cancel()
        model.destroy()
    }

    private suspend fun downloadModel(id: String, request: JSONObject) {
        val modelKey = requestModelKey(request)
        val file = modelManager.ensureModel(modelKey) { progress ->
            emit(
                id,
                "progress",
                JSONObject()
                    .put("phase", "download")
                    .put("bytes", progress.bytesRead)
                    .put("totalBytes", progress.totalBytes),
            )
        }
        emitDone(id, modelStatusJson(modelKey).put("path", file.absolutePath))
    }

    private suspend fun startModelDownload(id: String, request: JSONObject) {
        val modelKey = requestModelKey(request)
        emit(id, "status", JSONObject().put("message", "Starting Android system download."))
        emitDone(id, modelManager.startManagedDownload(modelKey))
    }

    private suspend fun cancelModelDownload(id: String) {
        emitDone(
            id,
            JSONObject()
                .put("aborted", true)
                .put("cancelledModelDownloads", modelManager.cancelRequiredDownloads()),
        )
    }

    private suspend fun loadModel(id: String, request: JSONObject) {
        val modelKey = requestModelKey(request)
        val spec = modelManager.modelSpec(modelKey)
        val file = modelManager.ensureModel(modelKey) { progress ->
            emit(
                id,
                "progress",
                JSONObject()
                    .put("phase", "download")
                    .put("bytes", progress.bytesRead)
                    .put("totalBytes", progress.totalBytes),
            )
        }

        emit(id, "status", JSONObject().put("message", "Loading ${spec.shortLabel} into llama.cpp."))
        model.load(file, spec.key)
        emitDone(id, modelStatusJson(spec.key))
    }

    private suspend fun runPrompt(id: String, request: JSONObject) {
        val spec = modelManager.modelSpec(requestModelKey(request))
        val prompt = request.optString("prompt")
        val maxTokens = request.optInt("maxTokens", 384).coerceIn(1, 2048)
        val options = request.optJSONObject("options") ?: JSONObject()
        val enableThinking = spec.supportsThinking && options.optBoolean("thinking", false)
        if (!model.isLoaded(spec.key)) {
            emit(id, "status", JSONObject().put("message", "Loading selected model before generating."))
            val file = modelManager.ensureModel(spec.key) { progress ->
                emit(
                    id,
                    "progress",
                    JSONObject()
                        .put("phase", "download")
                        .put("bytes", progress.bytesRead)
                        .put("totalBytes", progress.totalBytes),
                )
            }
            model.load(file, spec.key)
        }
        val appliedSettings = JSONObject()
            .put("modelKey", spec.key)
            .put("modelLabel", spec.label)
            .put("loadedModelKey", model.currentLoadedModelKey())
            .put("maxTokens", maxTokens)
            .put("thinkingRequested", options.optBoolean("thinking", false))
            .put("thinkingActive", enableThinking)
            .put("temperatureRequested", options.optDouble("temperature", 0.3))
            .put("temperatureActive", false)
            .put("contextSizeRequested", options.optInt("context_size", 8192))
            .put("contextSizeActive", false)
        var output = ""

        emit(id, "status", JSONObject().put("message", "Generating.").put("settings", appliedSettings))
        withContext(Dispatchers.Default) {
            model.generate(prompt, maxTokens, enableThinking, spec.key).collect { token ->
                output += token
                emit(id, "token", JSONObject().put("token", token))
            }
        }

        emitDone(id, JSONObject().put("output", output).put("settings", appliedSettings))
    }

    private suspend fun runBenchmark(id: String) {
        emit(id, "status", JSONObject().put("message", "Running native benchmark."))
        emitDone(id, JSONObject().put("result", model.benchmark()))
    }

    private suspend fun downloadVectorDatabase(id: String) {
        val spec = vectorDatabaseManager.defaultSpec()
        val file = vectorDatabaseManager.ensureDatabase(spec) { progress ->
            emit(
                id,
                "progress",
                JSONObject()
                    .put("phase", "vector_download")
                    .put("bytes", progress.bytesRead)
                    .put("totalBytes", progress.totalBytes),
            )
        }
        emitDone(id, vectorDatabaseManager.statusJson(spec).put("path", file.absolutePath))
    }

    private suspend fun prepareRequiredArtifacts(id: String) {
        val requiredModels = modelManager.requiredModelSpecs()
        val requiredAssets = staticAssetManager.requiredAssetSpecs()
        val artifactCount = requiredModels.size + 1 + requiredAssets.size

        requiredModels.forEachIndexed { index, spec ->
            emit(
                id,
                "status",
                JSONObject()
                    .put("phase", "model")
                    .put("artifactKind", "gguf-model")
                    .put("artifactKey", spec.key)
                    .put("label", spec.shortLabel)
                    .put("artifactIndex", index + 1)
                    .put("artifactCount", artifactCount)
                    .put("message", "Preparing ${spec.shortLabel}."),
            )
            val file = modelManager.ensureModel(spec.key) { progress ->
                emit(
                    id,
                    "progress",
                    JSONObject()
                        .put("phase", "model_download")
                        .put("artifactKind", "gguf-model")
                        .put("artifactKey", spec.key)
                        .put("label", spec.shortLabel)
                        .put("artifactIndex", index + 1)
                        .put("artifactCount", artifactCount)
                        .put("bytes", progress.bytesRead)
                        .put("totalBytes", progress.totalBytes),
                )
            }
            emit(
                id,
                "status",
                JSONObject()
                    .put("phase", "model_ready")
                    .put("artifactKind", "gguf-model")
                    .put("artifactKey", spec.key)
                    .put("label", spec.shortLabel)
                    .put("artifactIndex", index + 1)
                    .put("artifactCount", artifactCount)
                    .put("path", file.absolutePath)
                    .put("message", "${spec.shortLabel} is ready."),
            )
        }

        val vectorSpec = vectorDatabaseManager.defaultSpec()
        val vectorIndex = requiredModels.size + 1
        emit(
            id,
            "status",
            JSONObject()
                .put("phase", "vector")
                .put("artifactKind", "embedding-vector-db")
                .put("artifactKey", vectorSpec.key)
                .put("label", "Embeddings")
                .put("artifactIndex", vectorIndex)
                .put("artifactCount", artifactCount)
                .put("message", "Preparing embeddings."),
        )
        val vectorFile = vectorDatabaseManager.ensureDatabase(vectorSpec) { progress ->
            emit(
                id,
                "progress",
                JSONObject()
                    .put("phase", "vector_download")
                    .put("artifactKind", "embedding-vector-db")
                    .put("artifactKey", vectorSpec.key)
                    .put("label", "Embeddings")
                    .put("artifactIndex", vectorIndex)
                    .put("artifactCount", artifactCount)
                    .put("bytes", progress.bytesRead)
                    .put("totalBytes", progress.totalBytes),
            )
        }
        emit(
            id,
            "status",
            JSONObject()
                .put("phase", "vector_ready")
                .put("artifactKind", "embedding-vector-db")
                .put("artifactKey", vectorSpec.key)
                .put("label", "Embeddings")
                .put("artifactIndex", vectorIndex)
                .put("artifactCount", artifactCount)
                .put("path", vectorFile.absolutePath)
                .put("message", "Embeddings are ready."),
        )

        requiredAssets.forEachIndexed { index, spec ->
            val artifactIndex = requiredModels.size + 2 + index
            emit(
                id,
                "status",
                JSONObject()
                    .put("phase", "asset")
                    .put("artifactKind", spec.artifactKind)
                    .put("artifactKey", spec.key)
                    .put("label", spec.label)
                    .put("artifactIndex", artifactIndex)
                    .put("artifactCount", artifactCount)
                    .put("message", "Preparing ${spec.label}."),
            )
            val file = staticAssetManager.ensureAsset(spec) { progress ->
                emit(
                    id,
                    "progress",
                    JSONObject()
                        .put("phase", "asset_download")
                        .put("artifactKind", spec.artifactKind)
                        .put("artifactKey", spec.key)
                        .put("label", spec.label)
                        .put("artifactIndex", artifactIndex)
                        .put("artifactCount", artifactCount)
                        .put("bytes", progress.bytesRead)
                        .put("totalBytes", progress.totalBytes),
                )
            }
            emit(
                id,
                "status",
                JSONObject()
                    .put("phase", "asset_ready")
                    .put("artifactKind", spec.artifactKind)
                    .put("artifactKey", spec.key)
                    .put("label", spec.label)
                    .put("artifactIndex", artifactIndex)
                    .put("artifactCount", artifactCount)
                    .put("path", file.absolutePath)
                    .put("message", "${spec.label} is ready."),
            )
        }

        emitDone(id, setupStatusJson())
    }

    private suspend fun runSetupDownload(id: String) {
        activeSetupJob?.takeIf { it.isActive }?.let {
            emitDone(
                id,
                setupStatusJson()
                    .put("setupActive", true)
                    .put("message", "Setup is already running."),
            )
            return
        }

        val currentJob = coroutineContext[Job]
        activeSetupJob = currentJob
        try {
            val preflight = storagePreflightJson()
            if (!preflight.optBoolean("ok", true)) {
                throw IllegalStateException(preflight.optString("message", "Not enough storage for Caatuu setup."))
            }
            prepareRequiredArtifacts(id)
        } catch (error: CancellationException) {
            emitError(id, Exception("Setup aborted."))
        } finally {
            if (activeSetupJob == currentJob) activeSetupJob = null
        }
    }

    private suspend fun reportBug(id: String, request: JSONObject) {
        val result = withContext(Dispatchers.IO) {
            val reportId = UUID.randomUUID().toString()
            val payload = request.optJSONObject("payload") ?: JSONObject()
            val report = JSONObject()
                .put("report_id", reportId)
                .put("received_at_ms", System.currentTimeMillis())
                .put("source", "caatuu-android")
                .put(
                    "app",
                    JSONObject()
                        .put("versionCode", BuildConfig.VERSION_CODE)
                        .put("versionName", BuildConfig.VERSION_NAME)
                        .put("applicationId", BuildConfig.APPLICATION_ID),
                )
                .put("device", androidDeviceJson())
                .put("payload", payload)

            val bytes = report.toString(2).toByteArray(StandardCharsets.UTF_8)
            require(bytes.size <= MAX_BUG_REPORT_BYTES) { "Bug report is too large." }

            val reportsDir = File(activity.applicationContext.filesDir, "bug-reports")
            reportsDir.mkdirs()
            val reportFile = File(reportsDir, "${System.currentTimeMillis()}-${reportId.take(8)}.json")
            reportFile.writeBytes(bytes)

            val remote = runCatching { postRemoteBugReport(bytes) }
                .getOrElse { error ->
                    JSONObject()
                        .put("ok", false)
                        .put("message", error.message ?: error::class.java.simpleName)
                }

            JSONObject()
                .put("ok", true)
                .put("reportId", reportId)
                .put("storedLocal", true)
                .put("path", reportFile.absolutePath)
                .put("remote", remote)
        }
        emitDone(id, result)
    }

    private suspend fun abortSetup(id: String) {
        val wasActive = activeSetupJob?.isActive == true
        activeSetupJob?.cancel(CancellationException("Setup aborted by user."))
        activeSetupJob = null
        val cancelledModels = modelManager.cancelRequiredDownloads()
        emitDone(
            id,
            setupStatusJson()
                .put("aborted", true)
                .put("setupWasActive", wasActive)
                .put("cancelledModelDownloads", cancelledModels),
        )
    }

    private suspend fun searchVectorDatabase(id: String, request: JSONObject) {
        val text = request.optString("text").trim()
        if (text.isBlank()) throw IllegalArgumentException("Vector search text is empty.")

        val limit = request.optInt("limit", 10).coerceIn(1, 100)
        val vectorSpec = vectorDatabaseManager.defaultSpec()
        vectorDatabaseManager.ensureDatabase(vectorSpec) { progress ->
            emit(
                id,
                "progress",
                JSONObject()
                    .put("phase", "vector_download")
                    .put("bytes", progress.bytesRead)
                    .put("totalBytes", progress.totalBytes),
            )
        }

        val results = vectorDatabaseManager.searchText(text, limit, vectorSpec, requestSourceKinds(request))
        emitDone(
            id,
            JSONObject()
                .put("status", vectorDatabaseManager.statusJson(vectorSpec))
                .put("results", JSONArray().also { array ->
                    results.forEach { result -> array.put(vectorResultJson(result)) }
                }),
        )
    }

    private suspend fun clearCache(id: String) {
        emit(id, "status", JSONObject().put("message", "Unloading model."))
        model.unload()
        emit(id, "status", JSONObject().put("message", "Clearing temporary cache and update APK."))

        val updateResult = appUpdateManager.clearDownloadedUpdate()
        val appCacheResult = clearDirectoryContents(activity.applicationContext.cacheDir)
        val webViewCacheCleared = withContext(Dispatchers.Main) {
            webView.clearCache(true)
            true
        }

        emitDone(
            id,
            JSONObject()
                .put("storageScope", "app-private cacheDir and downloaded update APK")
                .put("localPackPreserved", true)
                .put("modelFilesPreserved", true)
                .put("vectorDatabasePreserved", true)
                .put("staticAssetsPreserved", true)
                .put("deletedOnUninstall", true)
                .put(
                    "bytesDeleted",
                    updateResult.optLong("bytesDeleted") +
                        appCacheResult.optLong("bytesDeleted"),
                )
                .put("updateApk", updateResult)
                .put("appCache", appCacheResult)
                .put("webViewCacheCleared", webViewCacheCleared),
        )
    }

    private suspend fun deleteLocalPack(id: String) {
        emit(id, "status", JSONObject().put("message", "Unloading model."))
        model.unload()
        emit(id, "status", JSONObject().put("message", "Deleting local setup files."))

        val modelResult = modelManager.deleteLocalModel()
        val vectorResult = vectorDatabaseManager.deleteLocalDatabases()
        val assetResult = staticAssetManager.deleteLocalAssets()
        emitDone(
            id,
            JSONObject()
                .put("storageScope", "app-private filesDir local pack")
                .put("deletedOnUninstall", true)
                .put(
                    "bytesDeleted",
                    modelResult.optLong("bytesDeleted") +
                        vectorResult.optLong("bytesDeleted") +
                        assetResult.optLong("bytesDeleted"),
                )
                .put("model", modelResult)
                .put("vectorDatabase", vectorResult)
                .put("staticAssets", assetResult),
        )
    }

    private suspend fun updateApp(id: String) {
        emit(id, "status", JSONObject().put("message", "Checking cached update APK."))
        val result = appUpdateManager.downloadLatest { progress ->
            emit(
                id,
                "progress",
                JSONObject()
                    .put("phase", "download")
                    .put("bytes", progress.bytesRead)
                    .put("totalBytes", progress.totalBytes),
            )
        }
        val action = appUpdateManager.openInstaller()
        emitDone(id, result.put("action", action))
    }

    private fun emitDone(id: String, result: JSONObject) {
        emit(id, "done", JSONObject().put("result", result))
    }

    private fun requestModelKey(request: JSONObject): String? =
        request.optString("modelKey").takeIf { it.isNotBlank() }
            ?: request.optString("model_key").takeIf { it.isNotBlank() }

    private fun requestSourceKinds(request: JSONObject): Set<String> {
        val sourceKinds = request.optJSONArray("sourceKinds") ?: request.optJSONArray("source_kinds") ?: return emptySet()
        val values = mutableSetOf<String>()
        for (index in 0 until sourceKinds.length()) {
            val value = sourceKinds.optString(index).trim()
            if (value.isNotBlank()) values += value
        }
        return values
    }

    private fun modelStatusJson(modelKey: String?): JSONObject {
        val spec = modelManager.modelSpec(modelKey)
        return modelManager.statusJson(spec.key)
            .put("loaded", model.isLoaded(spec.key))
            .put("loadedModelKey", model.currentLoadedModelKey())
    }

    private fun setupStatusJson(): JSONObject {
        val modelStatuses = JSONArray()
        val requiredModels = modelManager.requiredModelSpecs()
        val assetStatus = staticAssetManager.statusJson()
        var readyArtifacts = 0
        var bytes = 0L
        var expectedBytes = 0L

        requiredModels.forEach { spec ->
            val status = modelStatusJson(spec.key)
                .put("artifactKind", "gguf-model")
                .put("required", true)
            val ready = status.optBoolean("verified")
            if (ready) readyArtifacts += 1
            status.put("ready", ready)
            bytes += status.optLong("bytes", 0L)
            expectedBytes += status.optLong("expectedBytes", 0L)
            modelStatuses.put(status)
        }

        val vectorStatus = vectorDatabaseManager.statusJson()
            .put("required", true)
        val vectorReady = vectorStatus.optBoolean("verified")
        if (vectorReady) readyArtifacts += 1
        vectorStatus.put("ready", vectorReady)
        bytes += vectorStatus.optLong("bytes", 0L)
        expectedBytes += vectorStatus.optLong("expectedBytes", 0L)

        readyArtifacts += assetStatus.optInt("readyArtifacts", 0)
        bytes += assetStatus.optLong("bytes", 0L)
        expectedBytes += assetStatus.optLong("expectedBytes", 0L)

        val artifactCount = requiredModels.size + 1 + assetStatus.optInt("artifactCount", 0)
        return JSONObject()
            .put("ready", readyArtifacts == artifactCount)
            .put("setupActive", activeSetupJob?.isActive == true)
            .put("readyArtifacts", readyArtifacts)
            .put("artifactCount", artifactCount)
            .put("bytes", bytes)
            .put("expectedBytes", expectedBytes)
            .put("models", modelStatuses)
            .put("vectorDatabase", vectorStatus)
            .put("staticAssets", assetStatus)
    }

    private fun storagePreflightJson(): JSONObject {
        val status = setupStatusJson()
        val expectedBytes = status.optLong("expectedBytes", 0L)
        val bytes = status.optLong("bytes", 0L)
        val remainingBytes = (expectedBytes - bytes).coerceAtLeast(0L)
        val reserveBytes = max(256L * 1024L * 1024L, expectedBytes / 8L)
        val requiredBytes = remainingBytes + reserveBytes
        val filesAvailable = activity.applicationContext.filesDir.usableSpace
        val externalAvailable = activity.applicationContext
            .getExternalFilesDir("model-downloads")
            ?.usableSpace
            ?: filesAvailable
        val availableBytes = minOf(filesAvailable, externalAvailable)
        val ok = availableBytes >= requiredBytes

        return JSONObject()
            .put("ok", ok)
            .put("available", true)
            .put("scope", "app-private filesDir and model-downloads")
            .put("bytes", bytes)
            .put("expectedBytes", expectedBytes)
            .put("remainingBytes", remainingBytes)
            .put("reserveBytes", reserveBytes)
            .put("requiredBytes", requiredBytes)
            .put("availableBytes", availableBytes)
            .put("filesAvailableBytes", filesAvailable)
            .put("externalAvailableBytes", externalAvailable)
            .put(
                "message",
                if (ok) {
                    "Storage looks ready."
                } else {
                    "Not enough storage for Caatuu setup: needs about ${requiredBytes / 1024L / 1024L} MB free, device reports ${availableBytes / 1024L / 1024L} MB."
                },
            )
    }

    private fun androidDeviceJson(): JSONObject =
        JSONObject()
            .put("manufacturer", Build.MANUFACTURER)
            .put("brand", Build.BRAND)
            .put("model", Build.MODEL)
            .put("device", Build.DEVICE)
            .put("sdkInt", Build.VERSION.SDK_INT)
            .put("release", Build.VERSION.RELEASE)

    private fun reportEndpoint(): String {
        val base = BuildConfig.CAATUU_UPDATE_BASE_URL.trimEnd('/')
        val root = if (base.endsWith("/android")) base.removeSuffix("/android") else base
        return "$root/api/bug-report"
    }

    private fun postRemoteBugReport(bytes: ByteArray): JSONObject {
        val connection = URL(reportEndpoint()).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Content-Length", bytes.size.toString())
        return try {
            connection.outputStream.use { output -> output.write(bytes) }
            val status = connection.responseCode
            val body = runCatching {
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            }.getOrDefault("")
            JSONObject()
                .put("ok", status in 200..299)
                .put("status", status)
                .put("endpoint", reportEndpoint())
                .put("body", body.take(600))
        } finally {
            connection.disconnect()
        }
    }

    private fun vectorResultJson(result: VectorSearchResult): JSONObject =
        JSONObject()
            .put("chunkId", result.chunkId)
            .put("documentId", result.documentId)
            .put("text", result.text)
            .put("sourceKind", result.sourceKind)
            .put("sourceId", result.sourceId)
            .put("locale", result.locale)
            .put("title", result.title)
            .put("score", result.score.toDouble())
            .put("chunkMetadataJson", result.chunkMetadataJson)
            .put("documentMetadataJson", result.documentMetadataJson)

    private fun emitError(id: String, error: Exception) {
        emit(
            id,
            "error",
            JSONObject().put("message", error.message ?: error::class.java.simpleName),
        )
    }

    private fun emit(id: String, kind: String, body: JSONObject = JSONObject()) {
        body.put("id", id)
        body.put("kind", kind)

        val payload = JSONObject.quote(body.toString())
        activity.runOnUiThread {
            webView.evaluateJavascript(
                "window.CaatuuNative && window.CaatuuNative.receive($payload);",
                null,
            )
        }
    }

    private suspend fun clearDirectoryContents(directory: File): JSONObject =
        withContext(Dispatchers.IO) {
            val bytesDeleted = directorySize(directory)
            var deleted = true
            if (directory.exists()) {
                directory.listFiles()?.forEach { child ->
                    deleted = child.deleteRecursively() && deleted
                }
            }
            directory.mkdirs()
            JSONObject()
                .put("storageScope", "app-private cacheDir")
                .put("deletedOnUninstall", true)
                .put("path", directory.absolutePath)
                .put("bytesDeleted", bytesDeleted)
                .put("deleted", deleted)
        }

    private fun directorySize(file: File): Long {
        if (!file.exists()) return 0L
        if (file.isFile) return file.length()
        return file.listFiles()?.sumOf { directorySize(it) } ?: 0L
    }

    companion object {
        private const val MAX_BUG_REPORT_BYTES = 16 * 1024
    }
}
