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

    suspend fun load(modelFile: File) =
        withContext(Dispatchers.Default) {
            waitForEngine()
            if (loadedPath == modelFile.absolutePath && engine.state.value.isModelLoaded) return@withContext

            if (engine.state.value.isModelLoaded) {
                engine.cleanUp()
            }

            engine.loadModel(modelFile.absolutePath)
            loadedPath = modelFile.absolutePath
        }

    fun generate(prompt: String, maxTokens: Int): Flow<String> {
        require(prompt.isNotBlank()) { "Prompt is empty." }
        check(engine.state.value.isModelLoaded) { "Model is not loaded." }
        return engine.sendUserPrompt(prompt, maxTokens)
    }

    suspend fun benchmark(): String =
        withContext(Dispatchers.Default) {
            check(engine.state.value.isModelLoaded) { "Model is not loaded." }
            engine.bench(pp = 128, tg = 32, pl = 1, nr = 1)
        }

    fun destroy() {
        engineInstance?.destroy()
    }

    private suspend fun waitForEngine() {
        withTimeout(30_000) {
            engine.state.first { state ->
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
}
