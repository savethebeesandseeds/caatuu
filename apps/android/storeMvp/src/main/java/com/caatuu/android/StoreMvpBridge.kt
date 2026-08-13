package com.caatuu.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.coroutines.coroutineContext
import kotlin.math.max

class StoreMvpBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val vectorDatabaseManager: VectorDatabaseManager,
    private val dictionaryManager: DictionaryManager,
    private val staticAssetManager: StaticAssetManager,
    private val speechManager: AndroidSpeechManager,
    private val onThemeChanged: (String) -> Unit,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val artifactMutex = Mutex()
    private val requestStateLock = Any()
    private val activeRequests = mutableMapOf<String, Job>()
    private var activeSetupJob: Job? = null

    @JavascriptInterface
    fun setTheme(theme: String) {
        val normalizedTheme = if (theme == "light") "light" else "dark"
        activity.runOnUiThread { onThemeChanged(normalizedTheme) }
    }

    @JavascriptInterface
    fun isDeveloperPreview(): Boolean = BuildConfig.DEBUG

    @JavascriptInterface
    fun postMessage(rawMessage: String) {
        scope.launch {
            val request = runCatching { JSONObject(rawMessage) }.getOrNull() ?: return@launch
            val id = request.optString("id").trim()
            if (id.isBlank()) return@launch
            val currentJob = coroutineContext[Job] ?: return@launch
            val registered = synchronized(requestStateLock) {
                if (activeRequests.containsKey(id)) {
                    false
                } else {
                    activeRequests[id] = currentJob
                    true
                }
            }
            if (!registered) {
                emitError(id, IllegalStateException("A native request with this ID is already active."))
                return@launch
            }

            try {
                when (request.optString("type")) {
                    "cancel_request" -> cancelNativeRequest(id, request)
                    "setup_status" -> emitDone(id, setupStatusJson())
                    "storage_preflight" -> emitDone(id, storagePreflightJson())
                    "setup_download" -> runSetupDownload(id)
                    "setup_abort" -> abortSetup(id)
                    "vector_status" -> emitDone(id, vectorDatabaseManager.statusJson())
                    "vector_download" -> downloadVectorDatabase(id)
                    "vector_search" -> searchVectorDatabase(id, request)
                    "dictionary_status" -> emitDone(id, dictionaryManager.statusJson())
                    "dictionary_download" -> downloadDictionary(id)
                    "dictionary_search" -> searchDictionary(id, request)
                    "speech_status" -> speechStatus(id, request)
                    "speech_speak" -> speakSpeech(id, request)
                    "speech_stop" -> stopSpeech(id)
                    "speech_install_data" -> installSpeechData(id)
                    "delete_local_pack" -> deleteLocalPack(id)
                    "clear_cache" -> clearCache(id)
                    "update_app_status", "update_app" -> emitDone(id, storeUpdateStatusJson())
                    else -> throw IllegalArgumentException("Unknown native request type.")
                }
            } catch (error: Exception) {
                emitError(id, error)
            } finally {
                synchronized(requestStateLock) {
                    if (activeRequests[id] == currentJob) activeRequests.remove(id)
                }
            }
        }
    }

    fun onPause() {
        speechManager.onPause()
    }

    fun onResume() {
        speechManager.onResume()
    }

    fun destroy() {
        speechManager.destroy()
        vectorDatabaseManager.close()
        scope.cancel()
    }

    private suspend fun cancelNativeRequest(id: String, request: JSONObject) {
        val requestId = request.optString("requestId").trim()
        require(requestId.isNotBlank()) { "The native request ID to cancel is missing." }
        val job = synchronized(requestStateLock) {
            activeRequests[requestId]?.takeIf { it.isActive }
        }
        if (job != null && job != coroutineContext[Job]) {
            job.cancel(CancellationException("Native request cancelled after its UI deadline."))
            job.cancelAndJoin()
        }
        emitDone(
            id,
            JSONObject()
                .put("cancelled", job != null)
                .put("requestId", requestId),
        )
    }

    private suspend fun downloadVectorDatabase(id: String) {
        val spec = vectorDatabaseManager.defaultSpec()
        val file = artifactMutex.withLock {
            vectorDatabaseManager.ensureDatabase(spec) { progress ->
                emitProgress(id, "vector_download", progress)
            }
        }
        emitDone(id, vectorDatabaseManager.statusJson(spec).put("path", file.absolutePath))
    }

    private suspend fun searchVectorDatabase(id: String, request: JSONObject) {
        val input = request.optJSONArray("vector")
            ?: throw IllegalArgumentException("The WebView semantic runtime must provide a query vector.")
        val spec = vectorDatabaseManager.defaultSpec()
        require(input.length() == spec.embeddingDimension) {
            "Expected ${spec.embeddingDimension} query dimensions, received ${input.length()}."
        }
        val vector = FloatArray(input.length()) { index -> input.getDouble(index).toFloat() }
        val limit = request.optInt("limit", 10).coerceIn(1, 100)
        val sourceKinds = requestStringSet(request, "sourceKinds", "source_kinds")
        val results = artifactMutex.withLock {
            vectorDatabaseManager.ensureDatabase(spec) { progress ->
                emitProgress(id, "vector_download", progress)
            }
            vectorDatabaseManager.searchVector(vector, limit, spec, sourceKinds)
        }
        emitDone(
            id,
            JSONObject()
                .put("status", vectorDatabaseManager.statusJson(spec))
                .put("results", JSONArray().also { array ->
                    results.forEach { result -> array.put(vectorResultJson(result)) }
                }),
        )
    }

    private suspend fun downloadDictionary(id: String) {
        val file = artifactMutex.withLock {
            dictionaryManager.ensureDatabase { progress ->
                emitProgress(id, "dictionary_download", progress)
            }
        }
        emitDone(id, dictionaryManager.statusJson().put("path", file.absolutePath))
    }

    private suspend fun searchDictionary(id: String, request: JSONObject) {
        val query = request.optString("query").trim()
        require(query.isNotBlank()) { "Dictionary search text is empty." }
        val limit = request.optInt("limit", 12).coerceIn(1, 60)
        val result = artifactMutex.withLock { dictionaryManager.search(query, limit) }
        emitDone(id, result)
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
            check(preflight.optBoolean("ok")) {
                preflight.optString("message", "Not enough storage for Caatuu setup.")
            }
            artifactMutex.withLock { prepareRequiredArtifacts(id) }
        } catch (error: CancellationException) {
            emitError(id, Exception("Setup aborted."))
        } finally {
            if (activeSetupJob == currentJob) activeSetupJob = null
        }
    }

    private suspend fun prepareRequiredArtifacts(id: String) {
        val requiredAssets = staticAssetManager.requiredAssetSpecs()
        val (setupAnimationAssets, remainingAssets) = requiredAssets.partition {
            it.assetPath.startsWith("assets/loading_animation/")
        }
        val prioritizedAssets = setupAnimationAssets + remainingAssets
        val artifactCount = requiredAssets.size + 2

        prioritizedAssets.forEachIndexed { index, spec ->
            val artifactIndex = index + 1
            emitArtifactStatus(
                id = id,
                phase = "asset",
                spec = spec,
                artifactIndex = artifactIndex,
                artifactCount = artifactCount,
                message = "Preparing ${spec.label}.",
            )
            val file = staticAssetManager.ensureAsset(spec) { progress ->
                emitArtifactProgress(id, "asset_download", spec, artifactIndex, artifactCount, progress)
            }
            emitArtifactStatus(
                id = id,
                phase = "asset_ready",
                spec = spec,
                artifactIndex = artifactIndex,
                artifactCount = artifactCount,
                message = "${spec.label} is ready.",
                path = file.absolutePath,
            )
        }

        val vectorSpec = vectorDatabaseManager.defaultSpec()
        val vectorIndex = requiredAssets.size + 1
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
            emitSetupProgress(
                id,
                "vector_download",
                "embedding-vector-db",
                vectorSpec.key,
                "Embeddings",
                vectorIndex,
                artifactCount,
                progress,
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

        val dictionaryStatus = dictionaryManager.statusJson()
        val dictionaryKey = dictionaryStatus.getString("key")
        val dictionaryLabel = dictionaryStatus.optString("label", "Czech to English Dictionary")
        val dictionaryIndex = requiredAssets.size + 2
        emit(
            id,
            "status",
            JSONObject()
                .put("phase", "dictionary")
                .put("artifactKind", "dictionary-database")
                .put("artifactKey", dictionaryKey)
                .put("label", dictionaryLabel)
                .put("artifactIndex", dictionaryIndex)
                .put("artifactCount", artifactCount)
                .put("message", "Preparing the Czech to English dictionary."),
        )
        val dictionaryFile = dictionaryManager.ensureDatabase { progress ->
            emitSetupProgress(
                id,
                "dictionary_download",
                "dictionary-database",
                dictionaryKey,
                dictionaryLabel,
                dictionaryIndex,
                artifactCount,
                progress,
            )
        }
        emit(
            id,
            "status",
            JSONObject()
                .put("phase", "dictionary_ready")
                .put("artifactKind", "dictionary-database")
                .put("artifactKey", dictionaryKey)
                .put("label", dictionaryLabel)
                .put("artifactIndex", dictionaryIndex)
                .put("artifactCount", artifactCount)
                .put("path", dictionaryFile.absolutePath)
                .put("message", "The Czech to English dictionary is ready."),
        )
        emitDone(id, setupStatusJson().put("setupActive", false))
    }

    private fun setupStatusJson(): JSONObject {
        val assetStatus = staticAssetManager.statusJson()
        val vectorStatus = vectorDatabaseManager.statusJson().put("required", true)
        val vectorReady = vectorStatus.optBoolean("verified")
        vectorStatus.put("ready", vectorReady)
        val dictionaryStatus = dictionaryManager.statusJson()
            .put("artifactKind", "dictionary-database")
            .put("required", true)
        val dictionaryReady = dictionaryStatus.optBoolean("available")
        dictionaryStatus
            .put("verified", dictionaryReady)
            .put("ready", dictionaryReady)

        val readyArtifacts = assetStatus.optInt("readyArtifacts") +
            (if (vectorReady) 1 else 0) +
            (if (dictionaryReady) 1 else 0)
        val artifactCount = assetStatus.optInt("artifactCount") + 2
        val bytes = assetStatus.optLong("bytes") +
            vectorStatus.optLong("bytes") +
            dictionaryStatus.optLong("bytes")
        val expectedBytes = assetStatus.optLong("expectedBytes") +
            vectorStatus.optLong("expectedBytes") +
            dictionaryStatus.optLong("expectedBytes")

        return JSONObject()
            .put("ready", readyArtifacts == artifactCount)
            .put("setupActive", activeSetupJob?.isActive == true)
            .put("readyArtifacts", readyArtifacts)
            .put("artifactCount", artifactCount)
            .put("bytes", bytes)
            .put("expectedBytes", expectedBytes)
            .put("vectorDatabase", vectorStatus)
            .put("dictionary", dictionaryStatus)
            .put("staticAssets", assetStatus)
    }

    private fun storagePreflightJson(): JSONObject {
        val status = setupStatusJson()
        val expectedBytes = status.optLong("expectedBytes")
        val bytes = status.optLong("bytes")
        val remainingBytes = (expectedBytes - bytes).coerceAtLeast(0L)
        val reserveBytes = max(256L * 1024L * 1024L, expectedBytes / 8L)
        val requiredBytes = remainingBytes + reserveBytes
        val availableBytes = activity.applicationContext.filesDir.usableSpace
        val ok = availableBytes >= requiredBytes
        return JSONObject()
            .put("ok", ok)
            .put("available", true)
            .put("scope", "app-private filesDir")
            .put("bytes", bytes)
            .put("expectedBytes", expectedBytes)
            .put("remainingBytes", remainingBytes)
            .put("reserveBytes", reserveBytes)
            .put("requiredBytes", requiredBytes)
            .put("availableBytes", availableBytes)
            .put(
                "message",
                if (ok) {
                    "Storage looks ready."
                } else {
                    "Not enough storage for Caatuu setup: needs about ${requiredBytes / 1024L / 1024L} MB free, device reports ${availableBytes / 1024L / 1024L} MB."
                },
            )
    }

    private suspend fun abortSetup(id: String) {
        val wasActive = cancelActiveSetup("Setup aborted by user.")
        emitDone(
            id,
            setupStatusJson()
                .put("aborted", true)
                .put("setupWasActive", wasActive),
        )
    }

    private suspend fun deleteLocalPack(id: String) {
        val setupWasActive = cancelActiveSetup("Setup stopped before deleting local files.")
        artifactMutex.withLock {
            val vectorResult = vectorDatabaseManager.deleteLocalDatabases()
            val dictionaryResult = dictionaryManager.deleteLocalDatabase()
            val assetResult = staticAssetManager.deleteLocalAssets()
            emitDone(
                id,
                JSONObject()
                    .put("storageScope", "app-private filesDir local pack")
                    .put("deletedOnUninstall", true)
                    .put("setupWasActive", setupWasActive)
                    .put(
                        "bytesDeleted",
                        vectorResult.optLong("bytesDeleted") +
                            dictionaryResult.optLong("bytesDeleted") +
                            assetResult.optLong("bytesDeleted"),
                    )
                    .put("vectorDatabase", vectorResult)
                    .put("dictionary", dictionaryResult)
                    .put("staticAssets", assetResult),
            )
        }
    }

    private suspend fun clearCache(id: String) {
        val appCacheResult = clearDirectoryContents(activity.applicationContext.cacheDir)
        val webViewCacheCleared = withContext(Dispatchers.Main.immediate) {
            webView.clearCache(true)
            true
        }
        emitDone(
            id,
            JSONObject()
                .put("storageScope", "app-private cacheDir")
                .put("localPackPreserved", true)
                .put("vectorDatabasePreserved", true)
                .put("dictionaryPreserved", true)
                .put("staticAssetsPreserved", true)
                .put("deletedOnUninstall", true)
                .put("bytesDeleted", appCacheResult.optLong("bytesDeleted"))
                .put("appCache", appCacheResult)
                .put("webViewCacheCleared", webViewCacheCleared),
        )
    }

    private suspend fun speechStatus(id: String, request: JSONObject) {
        val locale = request.optString("locale", "cs-CZ")
        val voice = request.optString("voice").trim()
        require(voice.length <= MAX_SPEECH_VOICE_CHARACTERS) { "Speech voice name is too long." }
        emitDone(id, speechManager.status(locale, voice))
    }

    private suspend fun speakSpeech(id: String, request: JSONObject) {
        val text = request.optString("text").trim()
        val locale = request.optString("locale", "cs-CZ")
        val rate = request.optDouble("rate", 0.9).toFloat()
        val pitch = request.optDouble("pitch", 1.0).toFloat()
        val voice = request.optString("voice").trim()
        require(rate.isFinite()) { "Speech rate is invalid." }
        require(pitch.isFinite()) { "Speech pitch is invalid." }
        require(voice.length <= MAX_SPEECH_VOICE_CHARACTERS) { "Speech voice name is too long." }
        val result = speechManager.speak(text, locale, rate, pitch, voice) { utteranceId ->
            emit(
                id,
                "speech",
                JSONObject()
                    .put("phase", "started")
                    .put("utteranceId", utteranceId)
                    .put("runtime", "android-text-to-speech"),
            )
        }
        emitDone(id, result)
    }

    private fun stopSpeech(id: String) {
        emitDone(
            id,
            JSONObject()
                .put("runtime", "android-text-to-speech")
                .put("stopped", speechManager.stop()),
        )
    }

    private fun installSpeechData(id: String) {
        val candidates = mutableListOf<Intent>()
        speechManager.defaultEnginePackageName()
            .takeIf { it.isNotBlank() }
            ?.let { enginePackage ->
                candidates += Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA)
                    .setPackage(enginePackage)
            }
        candidates += Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA)
        candidates += Intent(ACTION_TEXT_TO_SPEECH_SETTINGS)
        candidates += Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)
        candidates += Intent(Settings.ACTION_SETTINGS)
        var launchedAction = ""
        for (intent in candidates) {
            try {
                activity.startActivity(intent)
                speechManager.refreshVoiceDataAfterInstallerReturns()
                launchedAction = intent.action.orEmpty()
                break
            } catch (_: ActivityNotFoundException) {
                // Try another standard Android settings destination.
            } catch (_: SecurityException) {
                // The device may restrict a particular settings destination.
            }
        }
        check(launchedAction.isNotBlank()) {
            "This device does not expose text-to-speech voice installation settings."
        }
        emitDone(
            id,
            JSONObject()
                .put("runtime", "android-text-to-speech")
                .put("launched", true)
                .put("action", launchedAction)
                .put("willRefreshOnResume", true),
        )
    }

    private fun storeUpdateStatusJson(): JSONObject =
        JSONObject()
            .put("selfUpdateEnabled", false)
            .put("storeManaged", true)
            .put("updateAvailable", false)
            .put("serverReachable", true)
            .put("currentVersionCode", BuildConfig.VERSION_CODE)
            .put("currentVersionName", BuildConfig.VERSION_NAME)
            .put("downloadReady", false)
            .put("readyToInstall", false)
            .put("downloadActive", false)
            .put("resumable", false)
            .put("downloadState", "store-managed")
            .put("message", "Updates are managed by the app store.")

    private suspend fun cancelActiveSetup(reason: String): Boolean {
        val job = activeSetupJob?.takeIf { it.isActive } ?: return false
        if (job != coroutineContext[Job]) {
            job.cancel(CancellationException(reason))
            job.cancelAndJoin()
        }
        if (activeSetupJob == job) activeSetupJob = null
        return true
    }

    private fun emitArtifactStatus(
        id: String,
        phase: String,
        spec: StaticAssetSpec,
        artifactIndex: Int,
        artifactCount: Int,
        message: String,
        path: String? = null,
    ) {
        val body = JSONObject()
            .put("phase", phase)
            .put("artifactKind", spec.artifactKind)
            .put("artifactKey", spec.key)
            .put("label", spec.label)
            .put("artifactIndex", artifactIndex)
            .put("artifactCount", artifactCount)
            .put("message", message)
        if (path != null) body.put("path", path)
        emit(id, "status", body)
    }

    private fun emitArtifactProgress(
        id: String,
        phase: String,
        spec: StaticAssetSpec,
        artifactIndex: Int,
        artifactCount: Int,
        progress: ArtifactProgress,
    ) {
        emitSetupProgress(
            id,
            phase,
            spec.artifactKind,
            spec.key,
            spec.label,
            artifactIndex,
            artifactCount,
            progress,
        )
    }

    private fun emitSetupProgress(
        id: String,
        phase: String,
        artifactKind: String,
        artifactKey: String,
        label: String,
        artifactIndex: Int,
        artifactCount: Int,
        progress: ArtifactProgress,
    ) {
        emit(
            id,
            "progress",
            JSONObject()
                .put("phase", phase)
                .put("artifactKind", artifactKind)
                .put("artifactKey", artifactKey)
                .put("label", label)
                .put("artifactIndex", artifactIndex)
                .put("artifactCount", artifactCount)
                .put("bytes", progress.bytesRead)
                .put("totalBytes", progress.totalBytes),
        )
    }

    private fun emitProgress(id: String, phase: String, progress: ArtifactProgress) {
        emit(
            id,
            "progress",
            JSONObject()
                .put("phase", phase)
                .put("bytes", progress.bytesRead)
                .put("totalBytes", progress.totalBytes),
        )
    }

    private fun requestStringSet(request: JSONObject, camelKey: String, snakeKey: String): Set<String> {
        val values = request.optJSONArray(camelKey) ?: request.optJSONArray(snakeKey) ?: return emptySet()
        return buildSet {
            for (index in 0 until values.length()) {
                values.optString(index).trim().takeIf { it.isNotBlank() }?.let(::add)
            }
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
        return file.listFiles()?.sumOf(::directorySize) ?: 0L
    }

    private fun emitDone(id: String, result: JSONObject) {
        emit(id, "done", JSONObject().put("result", result))
    }

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

    private companion object {
        const val ACTION_TEXT_TO_SPEECH_SETTINGS = "com.android.settings.TTS_SETTINGS"
        const val MAX_SPEECH_VOICE_CHARACTERS = 256
    }
}
