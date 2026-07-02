package com.caatuu.android

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

data class ModelProgress(
    val bytesRead: Long,
    val totalBytes: Long,
)

class ModelManager(context: Context) {
    private val appContext = context.applicationContext
    private val modelsDir = File(appContext.filesDir, "models")
    private val modelFile = File(modelsDir, MODEL_NAME)
    private val shaFile = File(modelsDir, "$MODEL_NAME.sha256")

    fun statusJson(): JSONObject =
        JSONObject()
            .put("runtime", "llama.cpp Android")
            .put("modelName", MODEL_NAME)
            .put("modelUrl", MODEL_URL)
            .put("sha256", MODEL_SHA256)
            .put("expectedBytes", MODEL_BYTES)
            .put("path", modelFile.absolutePath)
            .put("downloaded", modelFile.isFile)
            .put("bytes", modelFile.takeIf { it.isFile }?.length() ?: 0L)
            .put("verified", isMarkedVerified())

    suspend fun ensureModel(onProgress: (ModelProgress) -> Unit): File =
        withContext(Dispatchers.IO) {
            modelsDir.mkdirs()
            if (isMarkedVerified() && modelFile.isFile) return@withContext modelFile

            if (modelFile.isFile && modelFile.length() == MODEL_BYTES && sha256(modelFile) == MODEL_SHA256) {
                markVerified()
                return@withContext modelFile
            }

            modelFile.delete()
            val tmpFile = File(modelsDir, "$MODEL_NAME.download")
            tmpFile.delete()

            val connection = (URL(MODEL_URL).openConnection() as HttpURLConnection).apply {
                connectTimeout = 30_000
                readTimeout = 30_000
                instanceFollowRedirects = true
            }

            try {
                connection.connect()
                val totalBytes = connection.contentLengthLong.takeIf { it > 0L } ?: MODEL_BYTES
                require(connection.responseCode in 200..299) {
                    "Model download failed with HTTP ${connection.responseCode}"
                }

                val digest = MessageDigest.getInstance("SHA-256")
                var bytesRead = 0L
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)

                connection.inputStream.use { input ->
                    FileOutputStream(tmpFile).use { output ->
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            digest.update(buffer, 0, read)
                            bytesRead += read
                            onProgress(ModelProgress(bytesRead, totalBytes))
                        }
                    }
                }

                val actualSha = digest.digest().toHex()
                require(actualSha == MODEL_SHA256) {
                    "Model SHA-256 mismatch: expected $MODEL_SHA256, got $actualSha"
                }
                require(tmpFile.length() == MODEL_BYTES) {
                    "Model size mismatch: expected $MODEL_BYTES bytes, got ${tmpFile.length()}"
                }

                if (!tmpFile.renameTo(modelFile)) {
                    tmpFile.copyTo(modelFile, overwrite = true)
                    tmpFile.delete()
                }
                markVerified()
                modelFile
            } finally {
                connection.disconnect()
                if (tmpFile.isFile && !modelFile.isFile) tmpFile.delete()
            }
        }

    private fun isMarkedVerified(): Boolean =
        shaFile.isFile && shaFile.readText().trim() == MODEL_SHA256 && modelFile.length() == MODEL_BYTES

    private fun markVerified() {
        shaFile.writeText(MODEL_SHA256)
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
        const val MODEL_NAME = "caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf"
        const val MODEL_URL =
            "https://caatuu.waajacu.com/cz/data/models/phone-bench/caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf"
        const val MODEL_SHA256 =
            "09f0055af18dfc7cfa85950699c96c8a40e6c32eb5682afc2bfa6fb8cf7561e7"
        const val MODEL_BYTES = 1_107_408_608L
    }
}
