package com.caatuu.android

import android.content.Context
import com.arm.aichat.AiChat
import com.arm.aichat.InferenceEngine
import com.arm.aichat.isModelLoaded
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.File

class NativeCzechModel(context: Context) {
    private val appContext = context.applicationContext
    private var engineInstance: InferenceEngine? = null
    private val engine: InferenceEngine
        get() = engineInstance ?: AiChat.getInferenceEngine(appContext).also { engineInstance = it }
    private var loadedPath: String? = null
    private var loadedModelKey: String? = null

    suspend fun load(modelFile: File, modelKey: String) =
        withContext(Dispatchers.Default) {
            val activeEngine = engine
            if (activeEngine.state.value is InferenceEngine.State.Error) {
                activeEngine.cleanUp()
            }
            waitForEngine(activeEngine)
            if (loadedPath == modelFile.absolutePath && loadedModelKey == modelKey && activeEngine.state.value.isModelLoaded) {
                return@withContext
            }

            if (activeEngine.state.value.isModelLoaded) {
                activeEngine.cleanUp()
                loadedPath = null
                loadedModelKey = null
            }

            try {
                withTimeout(MODEL_LOAD_TIMEOUT_MS) {
                    activeEngine.loadModel(modelFile.absolutePath)
                }
                check(activeEngine.state.value.isModelLoaded) {
                    "llama.cpp finished loading but did not report ModelReady."
                }
                loadedPath = modelFile.absolutePath
                loadedModelKey = modelKey
            } catch (error: Exception) {
                loadedPath = null
                loadedModelKey = null
                resetAfterLoadFailure(activeEngine)
                throw error
            }
        }

    fun generate(prompt: String, maxTokens: Int, enableThinking: Boolean, modelKey: String): Flow<String> {
        require(prompt.isNotBlank()) { "Prompt is empty." }
        check(engine.state.value.isModelLoaded) { "Model is not loaded." }
        check(loadedModelKey == modelKey) {
            "Selected model is not loaded. Requested $modelKey, loaded ${loadedModelKey ?: "none"}."
        }
        return engine.sendUserPrompt(prompt, maxTokens, enableThinking)
    }

    fun isLoaded(modelKey: String): Boolean =
        currentLoadedModelKey() == modelKey

    fun currentLoadedModelKey(): String? {
        val instance = engineInstance ?: return null
        return loadedModelKey.takeIf { instance.state.value.isModelLoaded }
    }

    suspend fun resetConversation(): Boolean =
        withContext(Dispatchers.Default) {
            val activeEngine = engineInstance ?: return@withContext false
            if (!activeEngine.state.value.isModelLoaded || loadedModelKey == null) return@withContext false
            activeEngine.resetConversation()
            true
        }

    suspend fun benchmark(): String =
        withContext(Dispatchers.Default) {
            check(engine.state.value.isModelLoaded) { "Model is not loaded." }
            engine.bench(pp = 128, tg = 32, pl = 1, nr = 1)
        }

    fun unload() {
        engineInstance?.cleanUp()
        loadedPath = null
        loadedModelKey = null
    }

    fun destroy() {
        engineInstance?.destroy()
        engineInstance = null
        loadedPath = null
        loadedModelKey = null
    }

    private fun resetAfterLoadFailure(activeEngine: InferenceEngine) {
        runCatching {
            when (activeEngine.state.value) {
                is InferenceEngine.State.Error,
                is InferenceEngine.State.ModelReady,
                -> activeEngine.cleanUp()
                else -> activeEngine.destroy()
            }
        }
        if (activeEngine === engineInstance) {
            engineInstance = null
        }
    }

    private suspend fun waitForEngine(activeEngine: InferenceEngine) {
        withTimeout(30_000) {
            activeEngine.state.first { state ->
                when (state) {
                    is InferenceEngine.State.Initialized,
                    is InferenceEngine.State.ModelReady,
                    -> true
                    is InferenceEngine.State.Error -> throw state.exception
                    else -> false
                }
            }
        }
    }

    private companion object {
        const val MODEL_LOAD_TIMEOUT_MS = 6 * 60_000L
    }
}
