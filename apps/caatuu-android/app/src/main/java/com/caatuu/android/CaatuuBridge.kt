package com.caatuu.android

import android.app.Activity
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class CaatuuBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val modelManager: ModelManager,
    private val appUpdateManager: AppUpdateManager,
    private val model: NativeCzechModel,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

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
                    "status" -> emitDone(id, modelManager.statusJson())
                    "download" -> downloadModel(id)
                    "load" -> loadModel(id)
                    "prompt" -> runPrompt(id, request)
                    "benchmark" -> runBenchmark(id)
                    "delete_model" -> deleteModel(id)
                    "update_app_status" -> emitDone(id, appUpdateManager.statusJson())
                    "update_app" -> updateApp(id)
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

    private suspend fun downloadModel(id: String) {
        val file = modelManager.ensureModel { progress ->
            emit(
                id,
                "progress",
                JSONObject()
                    .put("phase", "download")
                    .put("bytes", progress.bytesRead)
                    .put("totalBytes", progress.totalBytes),
            )
        }
        emitDone(id, modelManager.statusJson().put("path", file.absolutePath))
    }

    private suspend fun loadModel(id: String) {
        val file = modelManager.ensureModel { progress ->
            emit(
                id,
                "progress",
                JSONObject()
                    .put("phase", "download")
                    .put("bytes", progress.bytesRead)
                    .put("totalBytes", progress.totalBytes),
            )
        }

        emit(id, "status", JSONObject().put("message", "Loading model into llama.cpp."))
        model.load(file)
        emitDone(id, modelManager.statusJson().put("loaded", true))
    }

    private suspend fun runPrompt(id: String, request: JSONObject) {
        val prompt = request.optString("prompt")
        val maxTokens = request.optInt("maxTokens", 384).coerceIn(1, 2048)
        val options = request.optJSONObject("options") ?: JSONObject()
        val enableThinking = options.optBoolean("thinking", false)
        val appliedSettings = JSONObject()
            .put("maxTokens", maxTokens)
            .put("thinkingRequested", enableThinking)
            .put("thinkingActive", true)
            .put("temperatureRequested", options.optDouble("temperature", 0.3))
            .put("temperatureActive", false)
            .put("contextSizeRequested", options.optInt("context_size", 8192))
            .put("contextSizeActive", false)
        var output = ""

        emit(id, "status", JSONObject().put("message", "Generating.").put("settings", appliedSettings))
        withContext(Dispatchers.Default) {
            model.generate(prompt, maxTokens, enableThinking).collect { token ->
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

    private suspend fun deleteModel(id: String) {
        emit(id, "status", JSONObject().put("message", "Unloading model."))
        model.unload()
        emit(id, "status", JSONObject().put("message", "Deleting app-private model files."))
        emitDone(id, modelManager.deleteLocalModel())
    }

    private suspend fun updateApp(id: String) {
        emit(id, "status", JSONObject().put("message", "Downloading latest debug APK."))
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
}
