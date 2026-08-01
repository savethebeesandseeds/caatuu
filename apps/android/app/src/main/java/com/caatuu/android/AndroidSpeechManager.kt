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

class AndroidSpeechManager(context: Context) {
    private data class ActiveUtterance(
        val id: String,
        val localeTag: String,
        val voiceName: String,
        val localService: Boolean?,
        val continuation: CancellableContinuation<JSONObject>,
        val onStarted: (String) -> Unit,
    )

    private val applicationContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private val initialization = CompletableDeferred<Int>()
    private val stateLock = Any()
    @Volatile private var engine: TextToSpeech? = null
    @Volatile private var destroyed = false
    private var acceptingSpeech = false
    private var lifecycleGeneration = 0L
    private var activeUtterance: ActiveUtterance? = null

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
        runOnMain { initializeEngine() }
    }

    suspend fun status(localeTag: String, requestedVoiceName: String = ""): JSONObject {
        val locale = parseLocale(localeTag)
        if (locale.language != CZECH_LANGUAGE) {
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

            val voice = selectVoice(currentEngine, locale, requestedVoiceName)
            if (voice != null) currentEngine.voice = voice
            availableStatus(locale, currentEngine.voice ?: voice, eligibleVoices(currentEngine, locale))
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
                "Czech pronunciation is available only while the app is in the foreground."
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
        require(locale.language == CZECH_LANGUAGE) { "Only Czech pronunciation is supported." }
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
                "The Czech text-to-speech language data is missing."
            }
            check(availability != TextToSpeech.LANG_NOT_SUPPORTED) {
                "This text-to-speech engine does not support Czech."
            }
            val configured = currentEngine.setLanguage(locale)
            check(configured != TextToSpeech.LANG_MISSING_DATA) {
                "The Czech text-to-speech language data is missing."
            }
            check(configured != TextToSpeech.LANG_NOT_SUPPORTED) {
                "This text-to-speech engine does not support Czech."
            }

            val preferredVoice = selectVoice(currentEngine, locale, requestedVoiceName)
            if (preferredVoice != null) currentEngine.voice = preferredVoice
            check(currentEngine.setSpeechRate(rate.coerceIn(MIN_RATE, MAX_RATE)) == TextToSpeech.SUCCESS) {
                "The text-to-speech engine rejected the speech rate."
            }
            check(currentEngine.setPitch(pitch.coerceIn(MIN_PITCH, MAX_PITCH)) == TextToSpeech.SUCCESS) {
                "The text-to-speech engine rejected the speech pitch."
            }

            stopActiveUtterance(currentEngine)
            val selectedVoice = currentEngine.voice ?: preferredVoice
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
        synchronized(stateLock) {
            if (!destroyed) acceptingSpeech = true
        }
    }

    fun onPause() {
        synchronized(stateLock) {
            acceptingSpeech = false
            lifecycleGeneration += 1
        }
        stop()
    }

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

    private fun initializeEngine() {
        if (destroyed || engine != null) return
        try {
            var candidate: TextToSpeech? = null
            candidate = TextToSpeech(applicationContext) { status ->
                mainHandler.post {
                    if (destroyed) {
                        candidate?.shutdown()
                        if (!initialization.isCompleted) initialization.complete(TextToSpeech.ERROR)
                        return@post
                    }
                    val readyStatus = if (status == TextToSpeech.SUCCESS) {
                        candidate?.setOnUtteranceProgressListener(progressListener)
                            ?: TextToSpeech.ERROR
                    } else {
                        status
                    }
                    if (!initialization.isCompleted) initialization.complete(readyStatus)
                }
            }
            engine = candidate
        } catch (error: Exception) {
            if (!initialization.isCompleted) initialization.complete(TextToSpeech.ERROR)
        }
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
            check(activeUtterance == null) { "A Czech utterance is already active." }
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
            ?.sortedWith(
                compareBy<Voice>(
                    { if (it.locale.toLanguageTag().lowercase(Locale.ROOT) == requestedTag) 0 else 1 },
                    { if (it.isNetworkConnectionRequired) 1 else 0 },
                    { if (it.name == currentVoiceName) 0 else 1 },
                    { it.name.lowercase(Locale.ROOT) },
                ),
            )
            ?.toList()
            .orEmpty()
    }

    private fun selectVoice(
        currentEngine: TextToSpeech,
        locale: Locale,
        requestedVoiceName: String = "",
    ): Voice? {
        val voices = eligibleVoices(currentEngine, locale)
        val requested = requestedVoiceName.trim()
        return voices.firstOrNull { requested.isNotBlank() && it.name == requested }
            ?: voices.firstOrNull()
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
                "Czech pronunciation was cancelled because the app left the foreground."
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

    private fun availableStatus(locale: Locale, voice: Voice?, voices: List<Voice>): JSONObject =
        JSONObject()
            .put("runtime", RUNTIME_NAME)
            .put("supported", true)
            .put("ready", true)
            .put("available", true)
            .put("locale", locale.toLanguageTag())
            .put("voice", voice?.name.orEmpty())
            .put("localService", voice?.let { !it.isNetworkConnectionRequired } ?: JSONObject.NULL)
            .put("voices", voiceOptions(voices))
            .put("reason", "")

    private fun voiceOptions(voices: List<Voice>): JSONArray =
        JSONArray().apply {
            voices.take(MAX_REPORTED_VOICES).forEach { voice ->
                put(
                    JSONObject()
                        .put("id", voice.name)
                        .put("name", voice.name)
                        .put("locale", voice.locale.toLanguageTag())
                        .put("localService", !voice.isNetworkConnectionRequired),
                )
            }
        }

    private fun unavailableStatus(
        locale: Locale,
        reason: String,
        ready: Boolean = true,
    ): JSONObject =
        JSONObject()
            .put("runtime", RUNTIME_NAME)
            .put("supported", true)
            .put("ready", ready)
            .put("available", false)
            .put("locale", locale.toLanguageTag())
            .put("voice", "")
            .put("localService", JSONObject.NULL)
            .put("voices", JSONArray())
            .put("reason", reason)

    private fun parseLocale(localeTag: String): Locale {
        val normalized = localeTag.trim().replace('_', '-').ifBlank { DEFAULT_LOCALE_TAG }
        val locale = Locale.forLanguageTag(normalized)
        require(locale.language.isNotBlank()) { "Speech locale is invalid." }
        return locale
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
    }

    companion object {
        private const val RUNTIME_NAME = "android-text-to-speech"
        private const val CZECH_LANGUAGE = "cs"
        private const val DEFAULT_LOCALE_TAG = "cs-CZ"
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
