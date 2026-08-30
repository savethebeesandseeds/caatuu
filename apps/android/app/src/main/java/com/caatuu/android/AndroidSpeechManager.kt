package com.caatuu.android

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class AndroidSpeechManager(
    context: Context,
    configuredLocaleTag: String = BuildConfig.CAATUU_SPEECH_LOCALE,
    targetLanguageLabel: String = BuildConfig.CAATUU_TARGET_LANGUAGE_LABEL,
) {
    private data class ActiveUtterance(
        val id: String,
        val localeTag: String,
        val voiceName: String,
        val localService: Boolean?,
        val continuation: CancellableContinuation<JSONObject>,
        val onStarted: (String) -> Unit,
    )

    private val applicationContext = context.applicationContext
    private val learnerLanguageLabel = targetLanguageLabel.trim().also {
        require(it.isNotEmpty()) { "Target language label is missing." }
    }
    private val configuredLocale = Locale.forLanguageTag(configuredLocaleTag.trim().replace('_', '-')).also {
        require(it.language.isNotBlank()) { "Configured speech locale is invalid." }
    }
    private val defaultLocaleTag = configuredLocale.toLanguageTag()
    private val supportedLanguage = configuredLocale.language
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var initialization = CompletableDeferred<Int>()
    private val stateLock = Any()
    @Volatile private var engine: TextToSpeech? = null
    @Volatile private var destroyed = false
    private var acceptingSpeech = false
    private var lifecycleGeneration = 0L
    private var activeUtterance: ActiveUtterance? = null
    private var refreshVoiceDataOnResume = false

    private val progressListener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            val active = synchronized(stateLock) {
                activeUtterance?.takeIf { it.id == utteranceId }
            } ?: return
            runCatching { active.onStarted(active.id) }
        }

        override fun onDone(utteranceId: String?) {
            settleUtterance(utteranceId, outcome = "completed")
        }

        @Deprecated("Deprecated by Android")
        override fun onError(utteranceId: String?) {
            failUtterance(utteranceId, TextToSpeech.ERROR)
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            failUtterance(utteranceId, errorCode)
        }

        override fun onStop(utteranceId: String?, interrupted: Boolean) {
            settleUtterance(utteranceId, outcome = "stopped")
        }
    }

    init {
        val initialInitialization = initialization
        runOnMain { initializeEngine(initialInitialization) }
    }

    suspend fun status(localeTag: String, requestedVoiceName: String = ""): JSONObject {
        val locale = parseLocale(localeTag)
        if (locale.language != supportedLanguage) {
            return unavailableStatus(locale, "unsupported-locale")
        }

        val initializationStatus = withTimeoutOrNull(INITIALIZATION_TIMEOUT_MILLIS) {
            initialization.await()
        } ?: return unavailableStatus(locale, "initialization-timeout", ready = false)

        if (initializationStatus != TextToSpeech.SUCCESS) {
            return unavailableStatus(locale, "engine-unavailable")
        }

        return withContext(Dispatchers.Main.immediate) {
            val currentEngine = engine
                ?: return@withContext unavailableStatus(locale, "engine-unavailable")
            if (destroyed) return@withContext unavailableStatus(locale, "engine-unavailable")

            val availability = currentEngine.isLanguageAvailable(locale)
            if (availability == TextToSpeech.LANG_MISSING_DATA) {
                return@withContext unavailableStatus(locale, "missing-language-data")
            }
            if (availability == TextToSpeech.LANG_NOT_SUPPORTED) {
                return@withContext unavailableStatus(locale, "no-language-voice")
            }

            val configured = currentEngine.setLanguage(locale)
            if (configured == TextToSpeech.LANG_MISSING_DATA) {
                return@withContext unavailableStatus(locale, "missing-language-data")
            }
            if (configured == TextToSpeech.LANG_NOT_SUPPORTED) {
                return@withContext unavailableStatus(locale, "no-language-voice")
            }

            val voices = eligibleVoices(currentEngine, locale)
            if (voices.isEmpty()) {
                val reason = if (hasUninstalledVoiceData(currentEngine, locale)) {
                    "missing-language-data"
                } else {
                    "no-language-voice"
                }
                return@withContext unavailableStatus(locale, reason)
            }

            val requested = requestedVoiceName.trim()
            val voice = selectVoice(voices, requested)
            if (voice == null) {
                return@withContext unavailableStatus(
                    locale,
                    "requested-voice-unavailable",
                    voices = voices,
                    requestedVoiceName = requested,
                )
            }
            val activeVoice = activateVoice(currentEngine, voice, requested)
            availableStatus(locale, activeVoice, voices, requested)
        }
    }

    suspend fun speak(
        text: String,
        localeTag: String,
        rate: Float,
        pitch: Float,
        requestedVoiceName: String,
        onStarted: (utteranceId: String) -> Unit,
    ): JSONObject {
        val requestGeneration = synchronized(stateLock) {
            check(acceptingSpeech && !destroyed) {
                "$learnerLanguageLabel pronunciation is available only while the app is in the foreground."
            }
            lifecycleGeneration
        }
        val sentence = text.trim()
        require(sentence.isNotBlank()) { "Speech text is empty." }
        require(sentence.length <= MAX_SENTENCE_CHARACTERS) { "Speech text is too long." }
        require(sentence.length <= TextToSpeech.getMaxSpeechInputLength()) {
            "Speech text exceeds the Android text-to-speech limit."
        }

        val locale = parseLocale(localeTag)
        require(locale.language == supportedLanguage) {
            "Only $learnerLanguageLabel pronunciation is supported."
        }
        val initializationStatus = withTimeoutOrNull(INITIALIZATION_TIMEOUT_MILLIS) {
            initialization.await()
        } ?: throw IllegalStateException("Android text-to-speech initialization timed out.")
        check(initializationStatus == TextToSpeech.SUCCESS) {
            "Android text-to-speech is unavailable."
        }

        return withContext(Dispatchers.Main.immediate) {
            requireSpeechRequestIsCurrent(requestGeneration)
            val currentEngine = checkNotNull(engine) { "Android text-to-speech is unavailable." }
            check(!destroyed) { "Android text-to-speech is unavailable." }
            val availability = currentEngine.isLanguageAvailable(locale)
            check(availability != TextToSpeech.LANG_MISSING_DATA) {
                "The $learnerLanguageLabel text-to-speech language data is missing."
            }
            check(availability != TextToSpeech.LANG_NOT_SUPPORTED) {
                "This text-to-speech engine does not support $learnerLanguageLabel."
            }
            val configured = currentEngine.setLanguage(locale)
            check(configured != TextToSpeech.LANG_MISSING_DATA) {
                "The $learnerLanguageLabel text-to-speech language data is missing."
            }
            check(configured != TextToSpeech.LANG_NOT_SUPPORTED) {
                "This text-to-speech engine does not support $learnerLanguageLabel."
            }

            val voices = eligibleVoices(currentEngine, locale)
            check(voices.isNotEmpty()) {
                if (hasUninstalledVoiceData(currentEngine, locale)) {
                    "The $learnerLanguageLabel text-to-speech voice data is not installed."
                } else {
                    "This text-to-speech engine has no available $learnerLanguageLabel voice."
                }
            }
            val requested = requestedVoiceName.trim()
            val preferredVoice = selectVoice(voices, requested)
            check(preferredVoice != null) {
                "The selected $learnerLanguageLabel voice is not installed or is no longer available."
            }
            val selectedVoice = activateVoice(currentEngine, preferredVoice, requested)
            check(currentEngine.setSpeechRate(rate.coerceIn(MIN_RATE, MAX_RATE)) == TextToSpeech.SUCCESS) {
                "The text-to-speech engine rejected the speech rate."
            }
            check(currentEngine.setPitch(pitch.coerceIn(MIN_PITCH, MAX_PITCH)) == TextToSpeech.SUCCESS) {
                "The text-to-speech engine rejected the speech pitch."
            }

            stopActiveUtterance(currentEngine)
            withTimeout(UTTERANCE_TIMEOUT_MILLIS) {
                awaitUtterance(
                    currentEngine,
                    sentence,
                    locale.toLanguageTag(),
                    selectedVoice,
                    requestGeneration,
                    onStarted,
                )
            }
        }
    }

    fun onResume() {
        val shouldRefreshVoiceData = synchronized(stateLock) {
            if (!destroyed) acceptingSpeech = true
            refreshVoiceDataOnResume.also { refreshVoiceDataOnResume = false }
        }
        if (shouldRefreshVoiceData) runOnMain { reinitializeEngine() }
    }

    fun onPause() {
        synchronized(stateLock) {
            acceptingSpeech = false
            lifecycleGeneration += 1
        }
        stop()
    }

    fun refreshVoiceDataAfterInstallerReturns() {
        synchronized(stateLock) {
            if (!destroyed) refreshVoiceDataOnResume = true
        }
    }

    fun defaultEnginePackageName(): String = engine?.defaultEngine.orEmpty()

    fun stop(): Boolean {
        val active = synchronized(stateLock) {
            activeUtterance.also { activeUtterance = null }
        }
        active?.let { resumeUtterance(it, utteranceResult(it, "stopped")) }
        val currentEngine = engine
        if (currentEngine != null) runOnMain { currentEngine.stop() }
        return active != null
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        synchronized(stateLock) {
            acceptingSpeech = false
            lifecycleGeneration += 1
        }
        stop()
        if (!initialization.isCompleted) initialization.complete(TextToSpeech.ERROR)
        val currentEngine = engine
        engine = null
        if (currentEngine != null) {
            runOnMain {
                currentEngine.stop()
                currentEngine.shutdown()
            }
        }
    }

    private fun initializeEngine(initializationState: CompletableDeferred<Int>) {
        if (destroyed || engine != null) return
        try {
            var candidate: TextToSpeech? = null
            candidate = TextToSpeech(applicationContext) { status ->
                mainHandler.post {
                    if (destroyed) {
                        candidate?.shutdown()
                        if (!initializationState.isCompleted) {
                            initializationState.complete(TextToSpeech.ERROR)
                        }
                        return@post
                    }
                    val readyStatus = if (status == TextToSpeech.SUCCESS) {
                        candidate?.setOnUtteranceProgressListener(progressListener)
                            ?: TextToSpeech.ERROR
                    } else {
                        status
                    }
                    if (!initializationState.isCompleted) initializationState.complete(readyStatus)
                }
            }
            engine = candidate
        } catch (error: Exception) {
            if (!initializationState.isCompleted) initializationState.complete(TextToSpeech.ERROR)
        }
    }

    private fun reinitializeEngine() {
        if (destroyed) return
        val previousEngine = engine
        engine = null
        previousEngine?.stop()
        previousEngine?.shutdown()

        val nextInitialization = CompletableDeferred<Int>()
        initialization = nextInitialization
        initializeEngine(nextInitialization)
    }

    private suspend fun awaitUtterance(
        currentEngine: TextToSpeech,
        sentence: String,
        localeTag: String,
        voice: Voice?,
        requestGeneration: Long,
        onStarted: (String) -> Unit,
    ): JSONObject = suspendCancellableCoroutine { continuation ->
        val utteranceId = UUID.randomUUID().toString()
        val active = ActiveUtterance(
            id = utteranceId,
            localeTag = localeTag,
            voiceName = voice?.name.orEmpty(),
            localService = voice?.let { !it.isNetworkConnectionRequired },
            continuation = continuation,
            onStarted = onStarted,
        )
        synchronized(stateLock) {
            check(activeUtterance == null) { "A $learnerLanguageLabel utterance is already active." }
            activeUtterance = active
        }
        continuation.invokeOnCancellation { cancelUtterance(utteranceId) }

        try {
            requireSpeechRequestIsCurrent(requestGeneration)
            val result = currentEngine.speak(
                sentence,
                TextToSpeech.QUEUE_FLUSH,
                Bundle(),
                utteranceId,
            )
            if (result == TextToSpeech.ERROR) {
                failUtterance(utteranceId, result)
            }
        } catch (error: Exception) {
            failUtterance(utteranceId, error)
        }
    }

    private fun eligibleVoices(currentEngine: TextToSpeech, locale: Locale): List<Voice> {
        val requestedTag = locale.toLanguageTag().lowercase(Locale.ROOT)
        val currentVoiceName = currentEngine.voice?.name.orEmpty()
        return currentEngine.voices
            ?.asSequence()
            ?.filter { it.locale.language.equals(locale.language, ignoreCase = true) }
            ?.filter { it.name.isNotBlank() && it.name.length <= MAX_VOICE_NAME_CHARACTERS }
            ?.filterNot { voiceDataIsMissing(it) }
            ?.sortedWith(
                compareBy<Voice>(
                    { if (it.isNetworkConnectionRequired) 1 else 0 },
                    { if (it.locale.toLanguageTag().lowercase(Locale.ROOT) == requestedTag) 0 else 1 },
                    { if (it.name == currentVoiceName) 0 else 1 },
                    { it.name.lowercase(Locale.ROOT) },
                ),
            )
            ?.toList()
            .orEmpty()
    }

    private fun hasUninstalledVoiceData(currentEngine: TextToSpeech, locale: Locale): Boolean =
        currentEngine.voices
            ?.any {
                it.locale.language.equals(locale.language, ignoreCase = true) &&
                    voiceDataIsMissing(it)
            }
            ?: false

    private fun voiceDataIsMissing(voice: Voice): Boolean =
        voice.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) == true

    private fun selectVoice(voices: List<Voice>, requestedVoiceName: String): Voice? =
        if (requestedVoiceName.isNotBlank()) {
            voices.firstOrNull { it.name == requestedVoiceName }
        } else {
            voices.firstOrNull()
        }

    private fun activateVoice(
        currentEngine: TextToSpeech,
        selectedVoice: Voice,
        requestedVoiceName: String,
    ): Voice {
        check(currentEngine.setVoice(selectedVoice) == TextToSpeech.SUCCESS) {
            if (requestedVoiceName.isNotBlank()) {
                "The text-to-speech engine rejected the selected $learnerLanguageLabel voice."
            } else {
                "The text-to-speech engine rejected its preferred $learnerLanguageLabel voice."
            }
        }
        val activeVoice = currentEngine.voice
        check(activeVoice != null && activeVoice.name == selectedVoice.name) {
            if (requestedVoiceName.isNotBlank()) {
                "The text-to-speech engine did not activate the selected $learnerLanguageLabel voice."
            } else {
                "The text-to-speech engine did not activate its preferred $learnerLanguageLabel voice."
            }
        }
        return activeVoice
    }

    private fun stopActiveUtterance(currentEngine: TextToSpeech) {
        val previous = synchronized(stateLock) {
            activeUtterance.also { activeUtterance = null }
        }
        previous?.let { resumeUtterance(it, utteranceResult(it, "stopped")) }
        currentEngine.stop()
    }

    private fun cancelUtterance(utteranceId: String) {
        val cancelled = synchronized(stateLock) {
            activeUtterance
                ?.takeIf { it.id == utteranceId }
                ?.also { activeUtterance = null }
        } ?: return
        runOnMain { engine?.stop() }
        if (cancelled.continuation.isActive) {
            resumeUtterance(cancelled, utteranceResult(cancelled, "stopped"))
        }
    }

    private fun settleUtterance(utteranceId: String?, outcome: String) {
        val active = takeUtterance(utteranceId) ?: return
        resumeUtterance(active, utteranceResult(active, outcome))
    }

    private fun failUtterance(utteranceId: String?, errorCode: Int) {
        failUtterance(
            utteranceId,
            IllegalStateException("Android text-to-speech failed with code $errorCode."),
        )
    }

    private fun failUtterance(utteranceId: String?, error: Exception) {
        val active = takeUtterance(utteranceId) ?: return
        if (active.continuation.isActive) active.continuation.resumeWithException(error)
    }

    private fun requireSpeechRequestIsCurrent(requestGeneration: Long) {
        synchronized(stateLock) {
            check(acceptingSpeech && !destroyed && lifecycleGeneration == requestGeneration) {
                "$learnerLanguageLabel pronunciation was cancelled because the app left the foreground."
            }
        }
    }

    private fun takeUtterance(utteranceId: String?): ActiveUtterance? =
        synchronized(stateLock) {
            activeUtterance
                ?.takeIf { it.id == utteranceId }
                ?.also { activeUtterance = null }
        }

    private fun resumeUtterance(active: ActiveUtterance, result: JSONObject) {
        if (active.continuation.isActive) active.continuation.resume(result)
    }

    private fun utteranceResult(active: ActiveUtterance, outcome: String): JSONObject =
        JSONObject()
            .put("runtime", RUNTIME_NAME)
            .put("outcome", outcome)
            .put("completed", outcome == "completed")
            .put("stopped", outcome == "stopped")
            .put("locale", active.localeTag)
            .put("voice", active.voiceName)
            .put("localService", active.localService ?: JSONObject.NULL)

    private fun availableStatus(
        locale: Locale,
        voice: Voice?,
        voices: List<Voice>,
        requestedVoiceName: String = "",
    ): JSONObject =
        JSONObject()
            .put("runtime", RUNTIME_NAME)
            .put("supported", true)
            .put("ready", true)
            .put("available", true)
            .put("locale", locale.toLanguageTag())
            .put("voice", voice?.name.orEmpty())
            .put("localService", voice?.let { !it.isNetworkConnectionRequired } ?: JSONObject.NULL)
            .put("localVoiceAvailable", voices.any { !it.isNetworkConnectionRequired })
            .put("voices", voiceOptions(voices))
            .put("requestedVoice", requestedVoiceName)
            .put("requestedVoiceAvailable", true)
            .put("reason", "")

    private fun voiceOptions(voices: List<Voice>): JSONArray =
        JSONArray().apply {
            voices.take(MAX_REPORTED_VOICES).forEach { voice ->
                put(
                    JSONObject()
                        .put("id", voice.name)
                        .put("name", voice.name)
                        .put("locale", voice.locale.toLanguageTag())
                        .put("localService", !voice.isNetworkConnectionRequired)
                        .put("installed", true),
                )
            }
        }

    private fun unavailableStatus(
        locale: Locale,
        reason: String,
        ready: Boolean = true,
        voices: List<Voice> = emptyList(),
        requestedVoiceName: String = "",
    ): JSONObject =
        JSONObject()
            .put("runtime", RUNTIME_NAME)
            .put("supported", true)
            .put("ready", ready)
            .put("available", false)
            .put("locale", locale.toLanguageTag())
            .put("voice", "")
            .put("localService", JSONObject.NULL)
            .put("localVoiceAvailable", voices.any { !it.isNetworkConnectionRequired })
            .put("voices", voiceOptions(voices))
            .put("requestedVoice", requestedVoiceName)
            .put("requestedVoiceAvailable", requestedVoiceName.isBlank())
            .put("reason", reason)

    private fun parseLocale(localeTag: String): Locale {
        val normalized = localeTag.trim().replace('_', '-').ifBlank { defaultLocaleTag }
        val locale = Locale.forLanguageTag(normalized)
        require(locale.language.isNotBlank()) { "Speech locale is invalid." }
        return locale
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
    }

    companion object {
        private const val RUNTIME_NAME = "android-text-to-speech"
        private const val MAX_SENTENCE_CHARACTERS = 1_000
        private const val MAX_VOICE_NAME_CHARACTERS = 256
        private const val MAX_REPORTED_VOICES = 64
        private const val INITIALIZATION_TIMEOUT_MILLIS = 8_000L
        private const val UTTERANCE_TIMEOUT_MILLIS = 45_000L
        private const val MIN_RATE = 0.5f
        private const val MAX_RATE = 1.5f
        private const val MIN_PITCH = 0.5f
        private const val MAX_PITCH = 1.5f
    }
}
