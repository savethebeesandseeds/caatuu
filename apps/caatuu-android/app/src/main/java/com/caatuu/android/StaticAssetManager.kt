package com.caatuu.android

import android.content.Context
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

data class StaticAssetSpec(
    val key: String,
    val label: String,
    val artifactKind: String,
    val assetPath: String,
    val url: String,
    val bytes: Long,
    val sha256: String,
)

class StaticAssetManager(context: Context) {
    private val appContext = context.applicationContext
    private val requiredAssets = loadRequiredAssetSpecs()

    fun requiredAssetSpecs(): List<StaticAssetSpec> = requiredAssets

    fun localAsset(assetPath: String): File? {
        if (assetPath.contains("..")) return null
        return localAssetFile(appContext, assetPath).takeIf { it.isFile }
    }

    fun statusJson(): JSONObject {
        val assets = JSONArray()
        var readyArtifacts = 0
        var bytes = 0L
        var expectedBytes = 0L

        requiredAssets.forEach { spec ->
            val file = localAssetFile(appContext, spec.assetPath)
            val marker = markerFile(appContext, spec)
            val fileBytes = file.takeIf { it.isFile }?.length() ?: 0L
            val ready = file.isFile &&
                marker.isFile &&
                marker.readText().trim() == spec.sha256 &&
                fileBytes == spec.bytes
            if (ready) readyArtifacts += 1
            bytes += fileBytes
            expectedBytes += spec.bytes
            assets.put(
                JSONObject()
                    .put("key", spec.key)
                    .put("label", spec.label)
                    .put("artifactKind", spec.artifactKind)
                    .put("assetPath", spec.assetPath)
                    .put("url", spec.url)
                    .put("expectedBytes", spec.bytes)
                    .put("sha256", spec.sha256)
                    .put("path", file.absolutePath)
                    .put("bytes", fileBytes)
                    .put("downloaded", file.isFile && fileBytes == spec.bytes)
                    .put("verified", ready)
                    .put("ready", ready)
                    .put("partial", file.isFile && fileBytes != spec.bytes),
            )
        }

        return JSONObject()
            .put("ready", readyArtifacts == requiredAssets.size)
            .put("readyArtifacts", readyArtifacts)
            .put("artifactCount", requiredAssets.size)
            .put("bytes", bytes)
            .put("expectedBytes", expectedBytes)
            .put("assets", assets)
    }

    suspend fun ensureAsset(spec: StaticAssetSpec, onProgress: (ModelProgress) -> Unit): File =
        withContext(Dispatchers.IO) {
            val file = localAssetFile(appContext, spec.assetPath)
            val marker = markerFile(appContext, spec)
            file.parentFile?.mkdirs()

            if (file.isFile && marker.isFile && marker.readText().trim() == spec.sha256 && file.length() == spec.bytes) {
                onProgress(ModelProgress(spec.bytes, spec.bytes))
                return@withContext file
            }
            if (file.isFile && file.length() == spec.bytes && sha256(file) == spec.sha256) {
                marker.writeText(spec.sha256)
                onProgress(ModelProgress(spec.bytes, spec.bytes))
                return@withContext file
            }

            file.delete()
            marker.delete()

            val tmpFile = File(file.parentFile, "${file.name}.download")
            if (tmpFile.isFile && tmpFile.length() > spec.bytes) tmpFile.delete()
            var downloaded = false
            var lastError: Exception? = null

            for (attempt in 1..ASSET_DOWNLOAD_ATTEMPTS) {
                coroutineContext.ensureActive()
                if (downloaded) break
                val resumeBytes = tmpFile
                    .takeIf { it.isFile }
                    ?.length()
                    ?.takeIf { it in 1 until spec.bytes }
                    ?: 0L
                val connection = (URL(spec.url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = ASSET_CONNECT_TIMEOUT_MS
                    readTimeout = ASSET_READ_TIMEOUT_MS
                    instanceFollowRedirects = true
                    if (resumeBytes > 0L) setRequestProperty("Range", "bytes=$resumeBytes-")
                }

                try {
                    connection.connect()
                    val statusCode = connection.responseCode
                    if (statusCode !in 200..299) {
                        throw IOException("Asset download failed with HTTP $statusCode for ${spec.assetPath}")
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
                        lastError = IOException("Asset download stopped at ${tmpFile.length()} of ${spec.bytes} bytes")
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    lastError = error
                } finally {
                    connection.disconnect()
                }

                if (!downloaded && attempt < ASSET_DOWNLOAD_ATTEMPTS) {
                    delay(ASSET_RETRY_DELAY_MS * attempt)
                }
            }

            if (!downloaded) throw lastError ?: IOException("Asset download failed for ${spec.assetPath}")

            val actualSha = sha256(tmpFile)
            if (actualSha != spec.sha256) {
                tmpFile.delete()
                throw IOException("Asset SHA-256 mismatch for ${spec.assetPath}: expected ${spec.sha256}, got $actualSha")
            }

            tmpFile.copyTo(file, overwrite = true)
            tmpFile.delete()
            marker.writeText(spec.sha256)
            onProgress(ModelProgress(spec.bytes, spec.bytes))
            file
        }

    suspend fun deleteLocalAssets(): JSONObject =
        withContext(Dispatchers.IO) {
            val root = rootDir(appContext)
            val bytesDeleted = directorySize(root)
            val deleted = !root.exists() || root.deleteRecursively()
            JSONObject()
                .put("storageScope", "app-private filesDir/setup-assets")
                .put("deletedOnUninstall", true)
                .put("path", root.absolutePath)
                .put("bytesDeleted", bytesDeleted)
                .put("deleted", deleted)
                .put("status", statusJson())
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

    private fun directorySize(file: File): Long {
        if (!file.exists()) return 0L
        if (file.isFile) return file.length()
        return file.listFiles()?.sumOf { directorySize(it) } ?: 0L
    }

    private fun loadRequiredAssetSpecs(): List<StaticAssetSpec> {
        val manifest = appContext.assets.open(SETUP_ASSET_MANIFEST).bufferedReader().use { reader ->
            JSONObject(reader.readText())
        }
        val artifacts = manifest.getJSONArray("artifacts")
        val specs = mutableListOf<StaticAssetSpec>()
        for (index in 0 until artifacts.length()) {
            val item = artifacts.getJSONObject(index)
            if (!item.optBoolean("native_required", false)) continue

            val key = item.optString("key").takeIf { it.isNotBlank() }
                ?: throw IllegalStateException("$SETUP_ASSET_MANIFEST artifact $index is missing key.")
            val url = item.optString("url", "")
            val assetPath = item.optString("asset_path").takeIf { it.isNotBlank() }
                ?: url.trimStart('/')
            require(assetPath.isNotBlank() && !assetPath.contains("..")) {
                "$SETUP_ASSET_MANIFEST artifact $key has an invalid asset path."
            }

            specs += StaticAssetSpec(
                key = key,
                label = item.optString("label", key),
                artifactKind = item.optString("artifact_kind", "visual-asset"),
                assetPath = assetPath,
                url = resolveArtifactUrl(url, assetPath),
                bytes = item.getLong("bytes"),
                sha256 = item.getString("sha256"),
            )
        }

        if (specs.isEmpty()) throw IllegalStateException("$SETUP_ASSET_MANIFEST does not define native setup assets.")
        return specs
    }

    private fun resolveArtifactUrl(url: String, assetPath: String): String =
        when {
            url.startsWith("https://") || url.startsWith("http://") -> url
            url.startsWith("/") -> "$ASSET_BASE_URL$url"
            url.isNotBlank() -> "$ASSET_BASE_URL/${url.trimStart('/')}"
            else -> "$ASSET_BASE_URL/$assetPath"
        }

    companion object {
        private const val ASSET_DOWNLOAD_ATTEMPTS = 4
        private const val ASSET_CONNECT_TIMEOUT_MS = 30_000
        private const val ASSET_READ_TIMEOUT_MS = 120_000
        private const val ASSET_RETRY_DELAY_MS = 1_000L
        private const val ASSET_ROOT = "setup-assets"
        private const val ASSET_BASE_URL = "https://caatuu.waajacu.com"
        private const val SETUP_ASSET_MANIFEST = "setup-assets.json"

        fun rootDir(context: Context): File = File(context.filesDir, ASSET_ROOT)

        fun localAssetFile(context: Context, assetPath: String): File =
            File(rootDir(context), assetPath)

        private fun markerFile(context: Context, spec: StaticAssetSpec): File =
            File(rootDir(context), "${spec.assetPath}.sha256")
    }
}
