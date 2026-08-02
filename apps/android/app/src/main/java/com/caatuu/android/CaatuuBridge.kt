package com.caatuu.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.text.Normalizer
import java.util.UUID
import kotlin.coroutines.coroutineContext
import kotlin.math.max

class CaatuuBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val modelManager: ModelManager,
    private val vectorDatabaseManager: VectorDatabaseManager,
    private val dictionaryManager: DictionaryManager,
    private val staticAssetManager: StaticAssetManager,
    private val appUpdateManager: AppUpdateManager,
    private val speechManager: AndroidSpeechManager,
    private val model: NativeCzechModel,
    private val onThemeChanged: (String) -> Unit,
) {
    private data class ActiveNativeRequest(
        val job: Job,
        val type: String,
        val modelKey: String?,
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var activeSetupJob: Job? = null
    private val activeRequestStateLock = Any()
    private val activeRequests = mutableMapOf<String, ActiveNativeRequest>()
    private val inferenceMutex = Mutex()
    private val artifactMutex = Mutex()
    private val modelCancellationMutex = Mutex()
    private val modelPreparationStateLock = Any()
    private val activeModelPreparationJobs = mutableMapOf<Job, String>()
    private val modelCancellationsInProgress = mutableSetOf<String>()
    private val updateMutex = Mutex()
    private val bugReportMutex = Mutex()
    private val dictionaryGapReportMutex = Mutex()

    @JavascriptInterface
    fun setTheme(theme: String) {
        val normalizedTheme = if (theme == "light") "light" else "dark"
        activity.runOnUiThread { onThemeChanged(normalizedTheme) }
    }

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
            val type = request.optString("type")
            val currentJob = coroutineContext[Job] ?: return@launch
            val modelKey = activeRequestModelKey(type, request)
            val registered = synchronized(activeRequestStateLock) {
                if (activeRequests.containsKey(id)) {
                    false
                } else {
                    activeRequests[id] = ActiveNativeRequest(currentJob, type, modelKey)
                    true
                }
            }
            if (!registered) {
                emitError(id, IllegalStateException("A native request with this ID is already active."))
                return@launch
            }

            try {
                if (modelKey != null) {
                    synchronized(modelPreparationStateLock) {
                        check(modelKey !in modelCancellationsInProgress) {
                            "Model download cancellation is in progress."
                        }
                    }
                }
                when (type) {
                    "status" -> emitDone(id, modelStatusJson(requestModelKey(request)))
                    "start_download" -> startModelDownload(id, request)
                    "cancel_download" -> cancelModelDownload(id, request)
                    "cancel_request" -> cancelNativeRequest(id, request)
                    "download" -> downloadModel(id, request)
                    "load" -> loadModel(id, request)
                    "reset_conversation" -> resetConversation(id, request)
                    "prompt" -> runPrompt(id, request)
                    "benchmark" -> runBenchmark(id)
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
                    "delete_model" -> deleteLocalPack(id)
                    "clear_cache" -> clearCache(id)
                    "update_app_status" -> emitDone(id, appUpdateManager.statusJson())
                    "update_app" -> updateApp(id)
                    "report_bug" -> reportBug(id, request)
                    "report_dictionary_gap" -> reportDictionaryGap(id, request)
                    else -> throw IllegalArgumentException("Unknown native request type.")
                }
            } catch (error: Exception) {
                emitError(id, error)
            } finally {
                synchronized(activeRequestStateLock) {
                    if (activeRequests[id]?.job == currentJob) activeRequests.remove(id)
                }
            }
        }
    }

    fun destroy() {
        speechManager.destroy()
        scope.cancel()
        model.destroy()
    }

    fun onPause() {
        speechManager.onPause()
    }

    fun onResume() {
        speechManager.onResume()
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
                // Try the next standard Android settings destination.
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

    private suspend fun downloadModel(id: String, request: JSONObject) {
        val spec = modelManager.modelSpec(requestModelKey(request))
        val file = runCancellableModelPreparation(spec.key) {
            modelManager.ensureModel(spec.key) { progress ->
                emit(
                    id,
                    "progress",
                    JSONObject()
                        .put("phase", "download")
                        .put("bytes", progress.bytesRead)
                        .put("totalBytes", progress.totalBytes),
                )
            }
        }
        emitDone(id, modelStatusJson(spec.key).put("path", file.absolutePath))
    }

    private suspend fun startModelDownload(id: String, request: JSONObject) {
        val spec = modelManager.modelSpec(requestModelKey(request))
        runCancellableModelPreparation(spec.key) {
            emit(id, "status", JSONObject().put("message", "Starting Android system download."))
            emitDone(id, modelManager.startManagedDownload(spec.key))
        }
    }

    private suspend fun cancelModelDownload(id: String, request: JSONObject) {
        val spec = modelManager.modelSpec(requestModelKey(request))
        modelCancellationMutex.withLock {
            val preparationJobs = synchronized(modelPreparationStateLock) {
                modelCancellationsInProgress += spec.key
                activeModelPreparationJobs
                    .filterValues { it == spec.key }
                    .keys
                    .filter { it.isActive }
            }
            val requestJobs = synchronized(activeRequestStateLock) {
                activeRequests.values
                    .filter { it.modelKey == spec.key && it.job.isActive }
                    .map { it.job }
            }
            val jobs = (preparationJobs + requestJobs).distinct()
            try {
                jobs.forEach { it.cancel(CancellationException("Model download cancelled by user.")) }
                jobs.forEach { it.cancelAndJoin() }
                val cancelledDownloads = artifactMutex.withLock {
                    modelManager.cancelModelDownload(spec.key)
                }
                emitDone(
                    id,
                    JSONObject()
                        .put("aborted", true)
                        .put("cancelledModelDownloads", cancelledDownloads),
                )
            } finally {
                synchronized(modelPreparationStateLock) {
                    modelCancellationsInProgress -= spec.key
                }
            }
        }
    }

    private suspend fun cancelNativeRequest(id: String, request: JSONObject) {
        val requestId = request.optString("requestId").trim()
        require(requestId.isNotBlank()) { "The native request ID to cancel is missing." }
        val job = synchronized(activeRequestStateLock) {
            activeRequests[requestId]?.job?.takeIf { it.isActive }
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

    private suspend fun loadModel(id: String, request: JSONObject) =
        inferenceMutex.withLock {
            val modelKey = requestModelKey(request)
            val spec = modelManager.modelSpec(modelKey)
            val file = runCancellableModelPreparation(spec.key) {
                modelManager.ensureModel(modelKey) { progress ->
                    emit(
                        id,
                        "progress",
                        JSONObject()
                            .put("phase", "download")
                            .put("bytes", progress.bytesRead)
                            .put("totalBytes", progress.totalBytes),
                    )
                }
            }

            emit(id, "status", JSONObject().put("message", "Loading ${spec.shortLabel} into llama.cpp."))
            model.load(file, spec.key)
            emitDone(id, modelStatusJson(spec.key))
        }

    private suspend fun runPrompt(id: String, request: JSONObject) =
        inferenceMutex.withLock {
            val spec = modelManager.modelSpec(requestModelKey(request))
            val prompt = request.optString("prompt")
            val maxTokens = request.optInt("maxTokens", 384).coerceIn(1, 2048)
            val options = request.optJSONObject("options") ?: JSONObject()
            val enableThinking = spec.supportsThinking && options.optBoolean("thinking", false)
            if (!model.isLoaded(spec.key)) {
                emit(id, "status", JSONObject().put("message", "Loading selected model before generating."))
                val file = runCancellableModelPreparation(spec.key) {
                    modelManager.ensureModel(spec.key) { progress ->
                        emit(
                            id,
                            "progress",
                            JSONObject()
                                .put("phase", "download")
                                .put("bytes", progress.bytesRead)
                                .put("totalBytes", progress.totalBytes),
                        )
                    }
                }
                model.load(file, spec.key)
            }
            val stateless = options.optBoolean("stateless", false)
            if (stateless) {
                emit(id, "status", JSONObject().put("message", "Starting a fresh model context."))
                model.resetConversation()
            }
            val appliedSettings = JSONObject()
                .put("modelKey", spec.key)
                .put("modelLabel", spec.label)
                .put("loadedModelKey", model.currentLoadedModelKey())
                .put("maxTokens", maxTokens)
                .put("thinkingRequested", options.optBoolean("thinking", false))
                .put("thinkingActive", enableThinking)
                .put("stateless", stateless)
                .put("temperatureRequested", options.optDouble("temperature", 0.3))
                .put("temperatureActive", false)
                .put("contextSizeRequested", options.optInt("context_size", 8192))
                .put("contextSizeActive", false)
            var output = ""

            emit(id, "status", JSONObject().put("message", "Generating.").put("settings", appliedSettings))
            try {
                withTimeout(generationTimeoutMillis(maxTokens)) {
                    withContext(Dispatchers.Default) {
                        model.generate(prompt, maxTokens, enableThinking, spec.key).collect { token ->
                            output += token
                            emit(id, "token", JSONObject().put("token", token))
                        }
                    }
                }
            } catch (error: CancellationException) {
                withContext(NonCancellable) {
                    try {
                        model.resetConversation()
                    } catch (_: Exception) {
                        // Cancellation must still release the inference lock even if reset fails.
                    }
                }
                throw error
            }

            emitDone(id, JSONObject().put("output", output).put("settings", appliedSettings))
        }

    private suspend fun runBenchmark(id: String) =
        inferenceMutex.withLock {
            emit(id, "status", JSONObject().put("message", "Running native benchmark."))
            emitDone(id, JSONObject().put("result", model.benchmark()))
        }

    private suspend fun resetConversation(id: String, request: JSONObject) =
        inferenceMutex.withLock {
            val spec = modelManager.modelSpec(requestModelKey(request))
            val reset = if (model.isLoaded(spec.key)) model.resetConversation() else false
            emitDone(id, modelStatusJson(spec.key).put("conversationReset", reset))
        }

    private suspend fun downloadVectorDatabase(id: String) {
        val spec = vectorDatabaseManager.defaultSpec()
        val file = artifactMutex.withLock {
            vectorDatabaseManager.ensureDatabase(spec) { progress ->
                emit(
                    id,
                    "progress",
                    JSONObject()
                        .put("phase", "vector_download")
                        .put("bytes", progress.bytesRead)
                        .put("totalBytes", progress.totalBytes),
                )
            }
        }
        emitDone(id, vectorDatabaseManager.statusJson(spec).put("path", file.absolutePath))
    }

    private suspend fun downloadDictionary(id: String) {
        val file = artifactMutex.withLock {
            dictionaryManager.ensureDatabase { progress ->
                emit(
                    id,
                    "progress",
                    JSONObject()
                        .put("phase", "dictionary_download")
                        .put("bytes", progress.bytesRead)
                        .put("totalBytes", progress.totalBytes),
                )
            }
        }
        emitDone(id, dictionaryManager.statusJson().put("path", file.absolutePath))
    }

    private suspend fun searchDictionary(id: String, request: JSONObject) {
        val query = request.optString("query").trim()
        if (query.isBlank()) throw IllegalArgumentException("Dictionary search text is empty.")
        val limit = request.optInt("limit", 12).coerceIn(1, 60)
        val result = artifactMutex.withLock { dictionaryManager.search(query, limit) }
        emitDone(id, result)
    }

    private suspend fun prepareRequiredArtifacts(id: String) {
        val requiredModels = modelManager.requiredModelSpecs()
        val requiredAssets = staticAssetManager.requiredAssetSpecs()
        val (setupAnimationAssets, remainingAssets) = requiredAssets.partition {
            it.assetPath.startsWith("assets/loading_animation/")
        }
        val prioritizedAssets = setupAnimationAssets + remainingAssets
        val artifactCount = requiredModels.size + 2 + requiredAssets.size

        // Animation frames lead the visual-asset stage so the setup screen can
        // begin moving before the remaining assets and larger models finish.
        prioritizedAssets.forEachIndexed { index, spec ->
            val artifactIndex = index + 1
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

        requiredModels.forEachIndexed { index, spec ->
            val artifactIndex = requiredAssets.size + index + 1
            emit(
                id,
                "status",
                JSONObject()
                    .put("phase", "model")
                    .put("artifactKind", "gguf-model")
                    .put("artifactKey", spec.key)
                    .put("label", spec.shortLabel)
                    .put("artifactIndex", artifactIndex)
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
                    .put("phase", "model_ready")
                    .put("artifactKind", "gguf-model")
                    .put("artifactKey", spec.key)
                    .put("label", spec.shortLabel)
                    .put("artifactIndex", artifactIndex)
                    .put("artifactCount", artifactCount)
                    .put("path", file.absolutePath)
                    .put("message", "${spec.shortLabel} is ready."),
            )
        }

        val vectorSpec = vectorDatabaseManager.defaultSpec()
        val vectorIndex = requiredAssets.size + requiredModels.size + 1
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

        val dictionaryStatus = dictionaryManager.statusJson()
        val dictionaryKey = dictionaryStatus.getString("key")
        val dictionaryLabel = dictionaryStatus.optString("label", "Czech to English Dictionary")
        val dictionaryIndex = requiredAssets.size + requiredModels.size + 2
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
            emit(
                id,
                "progress",
                JSONObject()
                    .put("phase", "dictionary_download")
                    .put("artifactKind", "dictionary-database")
                    .put("artifactKey", dictionaryKey)
                    .put("label", dictionaryLabel)
                    .put("artifactIndex", dictionaryIndex)
                    .put("artifactCount", artifactCount)
                    .put("bytes", progress.bytesRead)
                    .put("totalBytes", progress.totalBytes),
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
            artifactMutex.withLock { prepareRequiredArtifacts(id) }
        } catch (error: CancellationException) {
            emitError(id, Exception("Setup aborted."))
        } finally {
            if (activeSetupJob == currentJob) activeSetupJob = null
        }
    }

    private suspend fun reportBug(id: String, request: JSONObject) {
        val result = bugReportMutex.withLock {
            withContext(Dispatchers.IO) {
            val payload = request.optJSONObject("payload") ?: JSONObject()
            val stableFeedbackId = payload.optJSONObject("feedback")
                ?.optString("clientReportId")
                ?.takeIf { value -> value.isNotBlank() }
                ?.let { value -> runCatching { UUID.fromString(value).toString() }.getOrNull() }
            val reportId = stableFeedbackId ?: UUID.randomUUID().toString()
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
            check(reportsDir.mkdirs() || reportsDir.isDirectory) { "Could not prepare bug report storage." }
            val reportFile = if (stableFeedbackId != null) {
                File(reportsDir, "feedback-$reportId.json")
            } else {
                File(reportsDir, "${System.currentTimeMillis()}-${reportId.take(8)}.json")
            }
            val deliveryBytes = publishBugReportAtomically(
                directory = reportsDir,
                reportFile = reportFile,
                reportId = reportId,
                bytes = bytes,
            )

            val remote = runCatching { postRemoteBugReport(deliveryBytes) }
                .getOrElse { error ->
                    JSONObject()
                        .put("ok", false)
                        .put("message", error.message ?: error::class.java.simpleName)
                }
            check(remote.optBoolean("ok")) {
                val detail = remote.optString("message")
                    .ifBlank { "HTTP ${remote.optInt("status", 0)}" }
                "Could not send the bug report ($detail). A local diagnostic copy was kept; please try again."
            }

            JSONObject()
                .put("ok", true)
                .put("reportId", reportId)
                .put("storedLocal", true)
                .put("storedAs", reportFile.name)
                .put("remote", remote)
            }
        }
        emitDone(id, result)
    }

    private suspend fun reportDictionaryGap(id: String, request: JSONObject) {
        val result = dictionaryGapReportMutex.withLock {
            withContext(Dispatchers.IO) {
                val payload = request.optJSONObject("payload")
                    ?: throw IllegalArgumentException("Dictionary gap payload is missing.")
                val report = validatedDictionaryGapReport(payload)
                val bytes = report.toString().toByteArray(StandardCharsets.UTF_8)
                require(bytes.size <= MAX_DICTIONARY_GAP_REPORT_BYTES) {
                    "Dictionary gap report is too large."
                }
                postRemoteDictionaryGap(bytes)
            }
        }
        emitDone(id, result)
    }

    private fun validatedDictionaryGapReport(payload: JSONObject): JSONObject {
        val keys = mutableSetOf<String>()
        val iterator = payload.keys()
        while (iterator.hasNext()) keys += iterator.next()
        require(keys == DICTIONARY_GAP_REPORT_FIELDS) {
            "Dictionary gap payload has unsupported fields."
        }

        val schema = strictDictionaryGapString(payload, "schema", MAX_DICTIONARY_GAP_SCHEMA_CHARACTERS)
        val targetWord = strictDictionaryGapString(payload, "targetWord", MAX_DICTIONARY_GAP_WORD_CHARACTERS)
        val normalizedWord = strictDictionaryGapString(payload, "normalizedWord", MAX_DICTIONARY_GAP_WORD_CHARACTERS)
        val dictionaryKey = strictDictionaryGapString(payload, "dictionaryKey", MAX_DICTIONARY_GAP_KEY_CHARACTERS)
        val dictionaryDirection = strictDictionaryGapString(
            payload,
            "dictionaryDirection",
            MAX_DICTIONARY_GAP_DIRECTION_CHARACTERS,
        )
        val lookupOutcome = strictDictionaryGapString(
            payload,
            "lookupOutcome",
            MAX_DICTIONARY_GAP_OUTCOME_CHARACTERS,
        )
        val lookupReturned = when (val value = payload.opt("lookupReturned")) {
            is Int -> value
            is Long -> {
                require(value in Int.MIN_VALUE..Int.MAX_VALUE) {
                    "Dictionary gap lookupReturned is invalid."
                }
                value.toInt()
            }
            else -> throw IllegalArgumentException("Dictionary gap lookupReturned must be an integer.")
        }

        require(schema == DICTIONARY_GAP_REPORT_SCHEMA) {
            "Dictionary gap schema is not supported."
        }
        require(dictionaryKey == DICTIONARY_GAP_DICTIONARY_KEY) {
            "Dictionary gap dictionaryKey is not supported."
        }
        require(dictionaryDirection == DICTIONARY_GAP_DICTIONARY_DIRECTION) {
            "Dictionary gap dictionaryDirection is not supported."
        }
        require(normalizedWord == targetWord.lowercase()) {
            "Dictionary gap normalizedWord does not match targetWord."
        }
        require(lookupOutcome in DICTIONARY_GAP_LOOKUP_OUTCOMES) {
            "Dictionary gap lookupOutcome is not supported."
        }
        require(lookupReturned in 0..MAX_DICTIONARY_GAP_LOOKUP_RETURNED) {
            "Dictionary gap lookupReturned must be between 0 and $MAX_DICTIONARY_GAP_LOOKUP_RETURNED."
        }
        require(
            (lookupOutcome == "no_results" && lookupReturned == 0) ||
                (lookupOutcome == "no_exact_usable_entry" && lookupReturned > 0),
        ) { "Dictionary gap lookupOutcome does not match lookupReturned." }

        return JSONObject()
            .put("schema", schema)
            .put("targetWord", targetWord)
            .put("normalizedWord", normalizedWord)
            .put("dictionaryKey", dictionaryKey)
            .put("dictionaryDirection", dictionaryDirection)
            .put("lookupOutcome", lookupOutcome)
            .put("lookupReturned", lookupReturned)
    }

    private fun strictDictionaryGapString(payload: JSONObject, key: String, maxCharacters: Int): String {
        val raw = payload.opt(key)
        require(raw is String) { "Dictionary gap $key must be text." }
        val normalized = Normalizer.normalize(raw, Normalizer.Form.NFC)
        val compact = buildString(normalized.length) {
            var pendingSpace = false
            normalized.forEach { character ->
                if (character.isWhitespace() || Character.isSpaceChar(character)) {
                    if (isNotEmpty()) pendingSpace = true
                } else {
                    require(!Character.isISOControl(character)) {
                        "Dictionary gap $key contains unsupported characters."
                    }
                    require(character !in '\u0300'..'\u036f') {
                        "Dictionary gap $key must use composed Unicode text."
                    }
                    if (pendingSpace) append(' ')
                    append(character)
                    pendingSpace = false
                }
            }
        }
        require(compact.isNotEmpty() && compact == raw) {
            "Dictionary gap $key is empty or not normalized."
        }
        require(compact.codePointCount(0, compact.length) <= maxCharacters) {
            "Dictionary gap $key is too long."
        }
        return compact
    }

    private fun completeBugReportBytes(reportFile: File, reportId: String): ByteArray? {
        if (!reportFile.isFile) return null
        return runCatching {
            val bytes = reportFile.readBytes()
            val report = JSONObject(String(bytes, StandardCharsets.UTF_8))
            bytes.takeIf {
                report.optString("report_id") == reportId && report.has("payload")
            }
        }.getOrNull()
    }

    private fun publishBugReportAtomically(
        directory: File,
        reportFile: File,
        reportId: String,
        bytes: ByteArray,
    ): ByteArray {
        completeBugReportBytes(reportFile, reportId)?.let { return it }
        if (reportFile.exists()) {
            check(reportFile.delete()) { "Could not replace an incomplete bug report file." }
        }

        reserveLocalBugReportSpace(directory, bytes.size.toLong())
        val temporaryFile = File.createTempFile(".${reportFile.name}-", ".tmp", directory)
        try {
            temporaryFile.outputStream().use { output ->
                output.write(bytes)
                output.flush()
                output.fd.sync()
            }
            if (!temporaryFile.renameTo(reportFile)) {
                return completeBugReportBytes(reportFile, reportId)
                    ?: error("Could not publish bug report file.")
            }
            return bytes
        } finally {
            temporaryFile.delete()
        }
    }

    private fun reserveLocalBugReportSpace(directory: File, incomingBytes: Long) {
        val reports = directory.listFiles { file -> file.isFile && file.extension == "json" }
            ?.sortedBy { file -> file.lastModified() }
            ?.toMutableList()
            ?: mutableListOf()
        var storedBytes = reports.sumOf { file -> file.length() }

        while (
            reports.isNotEmpty() &&
            (reports.size >= MAX_LOCAL_BUG_REPORTS || storedBytes + incomingBytes > MAX_LOCAL_BUG_REPORT_BYTES)
        ) {
            val oldest = reports.removeAt(0)
            val bytes = oldest.length()
            check(oldest.delete()) { "Could not prune old bug report storage." }
            storedBytes = (storedBytes - bytes).coerceAtLeast(0L)
        }
    }

    private suspend fun abortSetup(id: String) {
        val wasActive = cancelActiveSetup("Setup aborted by user.")
        val cancelledModels = artifactMutex.withLock { modelManager.cancelRequiredDownloads() }
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

        artifactMutex.withLock {
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
    }

    private suspend fun clearCache(id: String) =
        inferenceMutex.withLock {
            emit(id, "status", JSONObject().put("message", "Unloading model."))
            model.unload()
            emit(id, "status", JSONObject().put("message", "Clearing temporary cache and update APK."))

            updateMutex.lock()
            val (updateResult, appCacheResult) = try {
                appUpdateManager.clearDownloadedUpdate() to
                    clearDirectoryContents(activity.applicationContext.cacheDir)
            } finally {
                updateMutex.unlock()
            }
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
                    .put("dictionaryPreserved", true)
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
        val setupWasActive = cancelActiveSetup("Setup stopped before deleting local files.")
        inferenceMutex.withLock {
            artifactMutex.withLock {
                val cancelledModels = modelManager.cancelRequiredDownloads()
                emit(id, "status", JSONObject().put("message", "Unloading model."))
                model.unload()
                emit(id, "status", JSONObject().put("message", "Deleting local setup files."))

                val modelResult = modelManager.deleteLocalModel()
                val vectorResult = vectorDatabaseManager.deleteLocalDatabases()
                val dictionaryResult = dictionaryManager.deleteLocalDatabase()
                val assetResult = staticAssetManager.deleteLocalAssets()
                emitDone(
                    id,
                    JSONObject()
                        .put("storageScope", "app-private filesDir local pack")
                        .put("deletedOnUninstall", true)
                        .put("setupWasActive", setupWasActive)
                        .put("cancelledModelDownloads", cancelledModels)
                        .put(
                            "bytesDeleted",
                            modelResult.optLong("bytesDeleted") +
                                vectorResult.optLong("bytesDeleted") +
                                dictionaryResult.optLong("bytesDeleted") +
                                assetResult.optLong("bytesDeleted"),
                        )
                        .put("model", modelResult)
                        .put("vectorDatabase", vectorResult)
                        .put("dictionary", dictionaryResult)
                        .put("staticAssets", assetResult),
                )
            }
        }
    }

    private suspend fun updateApp(id: String) {
        check(updateMutex.tryLock()) { "An app update or cache operation is already running." }
        try {
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
        } finally {
            updateMutex.unlock()
        }
    }

    private suspend fun cancelActiveSetup(reason: String): Boolean {
        val job = activeSetupJob?.takeIf { it.isActive } ?: return false
        if (job != coroutineContext[Job]) {
            job.cancel(CancellationException(reason))
            job.cancelAndJoin()
        }
        if (activeSetupJob == job) activeSetupJob = null
        return true
    }

    private suspend fun <T> runCancellableModelPreparation(modelKey: String, block: suspend () -> T): T =
        supervisorScope {
            val task = async(start = CoroutineStart.LAZY) {
                artifactMutex.withLock {
                    synchronized(modelPreparationStateLock) {
                        check(modelKey !in modelCancellationsInProgress) {
                            "Model download cancellation is in progress."
                        }
                    }
                    block()
                }
            }

            val registered = synchronized(modelPreparationStateLock) {
                if (modelKey in modelCancellationsInProgress) {
                    false
                } else {
                    activeModelPreparationJobs[task] = modelKey
                    true
                }
            }
            if (!registered) {
                task.cancel()
                throw IllegalStateException("Model download cancellation is in progress.")
            }

            try {
                task.start()
                task.await()
            } catch (error: CancellationException) {
                val cancelledByRequest = synchronized(modelPreparationStateLock) {
                    modelKey in modelCancellationsInProgress
                }
                if (cancelledByRequest) {
                    throw IllegalStateException("Model download cancelled.")
                }
                throw error
            } finally {
                synchronized(modelPreparationStateLock) {
                    activeModelPreparationJobs.remove(task)
                }
            }
        }

    private fun emitDone(id: String, result: JSONObject) {
        emit(id, "done", JSONObject().put("result", result))
    }

    private fun requestModelKey(request: JSONObject): String? =
        request.optString("modelKey").takeIf { it.isNotBlank() }
            ?: request.optString("model_key").takeIf { it.isNotBlank() }

    private fun activeRequestModelKey(type: String, request: JSONObject): String? =
        when (type) {
            "start_download", "download", "load", "reset_conversation", "prompt" ->
                modelManager.modelSpec(requestModelKey(request)).key
            else -> null
        }

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

        val dictionaryStatus = dictionaryManager.statusJson()
            .put("artifactKind", "dictionary-database")
            .put("required", true)
        val dictionaryReady = dictionaryStatus.optBoolean("available")
        if (dictionaryReady) readyArtifacts += 1
        dictionaryStatus
            .put("verified", dictionaryReady)
            .put("ready", dictionaryReady)
        bytes += dictionaryStatus.optLong("bytes", 0L)
        expectedBytes += dictionaryStatus.optLong("expectedBytes", 0L)

        readyArtifacts += assetStatus.optInt("readyArtifacts", 0)
        bytes += assetStatus.optLong("bytes", 0L)
        expectedBytes += assetStatus.optLong("expectedBytes", 0L)

        val artifactCount = requiredModels.size + 2 + assetStatus.optInt("artifactCount", 0)
        return JSONObject()
            .put("ready", readyArtifacts == artifactCount)
            .put("setupActive", activeSetupJob?.isActive == true)
            .put("readyArtifacts", readyArtifacts)
            .put("artifactCount", artifactCount)
            .put("bytes", bytes)
            .put("expectedBytes", expectedBytes)
            .put("models", modelStatuses)
            .put("vectorDatabase", vectorStatus)
            .put("dictionary", dictionaryStatus)
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

    private fun dictionaryGapEndpoint(): String {
        val endpoint = URL(BuildConfig.CAATUU_DICTIONARY_GAP_URL)
        require(endpoint.protocol in setOf("http", "https")) {
            "Dictionary gap URL must use HTTP or HTTPS."
        }
        require(BuildConfig.DEBUG || endpoint.protocol == "https") {
            "Release dictionary gap delivery requires HTTPS."
        }
        require(
            endpoint.host.isNotBlank() &&
                endpoint.userInfo.isNullOrBlank() &&
                endpoint.query.isNullOrBlank() &&
                endpoint.ref.isNullOrBlank(),
        ) { "Dictionary gap URL must not contain credentials, a query, or a fragment." }
        return endpoint.toExternalForm()
    }

    private fun postRemoteDictionaryGap(bytes: ByteArray): JSONObject {
        val endpoint = dictionaryGapEndpoint()
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        connection.instanceFollowRedirects = false
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Content-Length", bytes.size.toString())
        return try {
            connection.outputStream.use { output -> output.write(bytes) }
            val status = connection.responseCode
            val body = runCatching {
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                stream?.bufferedReader()?.use { reader ->
                    val response = StringBuilder()
                    val buffer = CharArray(512)
                    while (true) {
                        val count = reader.read(buffer)
                        if (count < 0) break
                        check(response.length + count <= MAX_DICTIONARY_GAP_RESPONSE_CHARS) {
                            "Dictionary gap response is too large."
                        }
                        response.append(buffer, 0, count)
                    }
                    response.toString()
                }.orEmpty()
            }.getOrElse { error ->
                throw IllegalStateException("Could not read the dictionary gap response.", error)
            }
            val responseJson = runCatching { JSONObject(body) }
                .getOrElse { error ->
                    throw IllegalStateException("Dictionary gap server returned an invalid response.", error)
                }
            check(status in 200..299) {
                responseJson.optString("message").ifBlank {
                    "Dictionary gap server returned HTTP $status."
                }
            }
            check(responseJson.optBoolean("ok", false) && responseJson.optBoolean("stored", false)) {
                responseJson.optString("message").ifBlank {
                    "Dictionary gap server did not confirm durable storage."
                }
            }
            JSONObject()
                .put("ok", true)
                .put("stored", true)
                .put("deduplicated", responseJson.optBoolean("deduplicated", false))
        } finally {
            connection.disconnect()
        }
    }

    private fun reportEndpoint(): String {
        val endpoint = URL(BuildConfig.CAATUU_REPORT_URL)
        require(endpoint.protocol in setOf("http", "https")) {
            "Bug report URL must use HTTP or HTTPS."
        }
        require(BuildConfig.DEBUG || endpoint.protocol == "https") {
            "Release bug reports require HTTPS."
        }
        require(
            endpoint.host.isNotBlank() &&
                endpoint.userInfo.isNullOrBlank() &&
                endpoint.query.isNullOrBlank() &&
                endpoint.ref.isNullOrBlank(),
        ) { "Bug report URL must be a plain host URL without credentials, query, or fragment." }
        return endpoint.toExternalForm()
    }

    private fun postRemoteBugReport(bytes: ByteArray): JSONObject {
        val endpoint = reportEndpoint()
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        connection.instanceFollowRedirects = false
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Content-Length", bytes.size.toString())
        return try {
            connection.outputStream.use { output -> output.write(bytes) }
            val status = connection.responseCode
            val body = runCatching {
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                stream?.bufferedReader()?.use { reader ->
                    val response = StringBuilder()
                    val buffer = CharArray(2048)
                    while (true) {
                        val count = reader.read(buffer)
                        if (count < 0) break
                        check(response.length + count <= MAX_BUG_REPORT_RESPONSE_CHARS) {
                            "Bug report response is too large."
                        }
                        response.append(buffer, 0, count)
                    }
                    response.toString()
                }.orEmpty()
            }.getOrDefault("")
            val responseJson = runCatching { JSONObject(body) }.getOrNull()
            val acknowledged = status in 200..299 && responseJson?.optBoolean("ok", false) == true
            JSONObject()
                .put("ok", acknowledged)
                .put("status", status)
                .put("endpoint", endpoint)
                .put("message", responseJson?.optString("message").orEmpty())
                .put("body", body)
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

    private fun generationTimeoutMillis(maxTokens: Int): Long =
        (GENERATION_TIMEOUT_FLOOR_MILLIS + maxTokens * GENERATION_TIMEOUT_PER_TOKEN_MILLIS)
            .coerceAtMost(GENERATION_TIMEOUT_CEILING_MILLIS)

    companion object {
        private const val ACTION_TEXT_TO_SPEECH_SETTINGS = "com.android.settings.TTS_SETTINGS"
        private const val GENERATION_TIMEOUT_FLOOR_MILLIS = 3L * 60L * 1000L
        private const val GENERATION_TIMEOUT_PER_TOKEN_MILLIS = 2_000L
        private const val GENERATION_TIMEOUT_CEILING_MILLIS = 30L * 60L * 1000L
        private const val MAX_SPEECH_VOICE_CHARACTERS = 256
        private const val DICTIONARY_GAP_REPORT_SCHEMA = "caatuu.dictionary-gap-report.v1"
        private const val DICTIONARY_GAP_DICTIONARY_KEY = "kaikki-cs-en-2026-07-09"
        private const val DICTIONARY_GAP_DICTIONARY_DIRECTION = "cs-en"
        private const val MAX_DICTIONARY_GAP_REPORT_BYTES = 2 * 1024
        private const val MAX_DICTIONARY_GAP_RESPONSE_CHARS = 600
        private const val MAX_DICTIONARY_GAP_SCHEMA_CHARACTERS = 80
        private const val MAX_DICTIONARY_GAP_WORD_CHARACTERS = 120
        private const val MAX_DICTIONARY_GAP_KEY_CHARACTERS = 120
        private const val MAX_DICTIONARY_GAP_DIRECTION_CHARACTERS = 24
        private const val MAX_DICTIONARY_GAP_OUTCOME_CHARACTERS = 80
        private const val MAX_DICTIONARY_GAP_LOOKUP_RETURNED = 60
        private val DICTIONARY_GAP_REPORT_FIELDS = setOf(
            "schema",
            "targetWord",
            "normalizedWord",
            "dictionaryKey",
            "dictionaryDirection",
            "lookupOutcome",
            "lookupReturned",
        )
        private val DICTIONARY_GAP_LOOKUP_OUTCOMES = setOf(
            "no_results",
            "no_exact_usable_entry",
        )
        private const val MAX_BUG_REPORT_BYTES = 16 * 1024
        private const val MAX_BUG_REPORT_RESPONSE_CHARS = 600
        private const val MAX_LOCAL_BUG_REPORTS = 100
        private const val MAX_LOCAL_BUG_REPORT_BYTES = 2L * 1024L * 1024L
    }
}
