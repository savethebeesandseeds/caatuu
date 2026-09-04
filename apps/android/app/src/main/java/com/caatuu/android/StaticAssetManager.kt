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

class StaticAssetManager(
    context: Context,
    manifestAssetPath: String = DEFAULT_SETUP_ASSET_MANIFEST,
    courseAssetPrefix: String = "",
    private val requireNativeAssets: Boolean = true,
) {
    private val appContext = context.applicationContext
    private val manifestAssetPath = manifestAssetPath.also { path ->
        require(isSafeAssetPath(path)) { "Setup asset manifest path is unsafe." }
    }
    private val courseAssetPrefix = courseAssetPrefix.also { path ->
        require(path.isEmpty() || isSafeAssetPath(path)) { "Course asset prefix is unsafe." }
    }.trimEnd('/')
    init {
        deleteRetiredMascotAssets(rootDir(appContext))
    }
    private val requiredAssets = loadRequiredAssetSpecs()

    fun requiredAssetSpecs(): List<StaticAssetSpec> = requiredAssets

    internal fun storageArtifacts(courseId: String): List<NativeStorageArtifact> =
        requiredAssets.map { spec ->
            NativeArtifactContract.storageArtifact(
                courseId,
                "setup-assets/${spec.assetPath}",
                spec.url,
                spec.assetPath,
                spec.bytes,
                spec.sha256,
                spec.artifactKind,
            )
        }

    fun ownsAssetPath(assetPath: String): Boolean =
        requiredAssets.any { spec -> spec.assetPath == assetPath }

    fun localAsset(assetPath: String): File? {
        val spec = requiredAssets.firstOrNull { candidate -> candidate.assetPath == assetPath } ?: return null
        return verifiedLocalAsset(spec)
    }

    internal fun verifiedLocalAsset(assetPath: String): File? =
        requiredAssets.firstOrNull { spec -> spec.assetPath == assetPath }?.let(::verifiedLocalAsset)

    private fun verifiedLocalAsset(spec: StaticAssetSpec): File? {
        val file = localAssetFile(appContext, spec.assetPath)
        val marker = markerFile(appContext, spec)
        return file.takeIf {
            it.isFile &&
                it.length() == spec.bytes &&
                marker.isFile &&
                marker.readText().trim() == identityMarker(spec)
        }
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
                marker.readText().trim() == identityMarker(spec) &&
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

            if (verifiedLocalAsset(spec) != null) {
                onProgress(ModelProgress(spec.bytes, spec.bytes))
                return@withContext file
            }
            if (file.isFile && file.length() == spec.bytes && sha256(file) == spec.sha256) {
                marker.writeText(identityMarker(spec))
                onProgress(ModelProgress(spec.bytes, spec.bytes))
                return@withContext file
            }

            file.delete()
            marker.delete()

            val tmpFile = NativeArtifactContract.canonicalChild(
                requireNotNull(file.parentFile),
                "${file.name}.download",
                "Setup asset temporary download",
            )
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
            marker.writeText(identityMarker(spec))
            onProgress(ModelProgress(spec.bytes, spec.bytes))
            file
        }

    suspend fun deleteLocalAssets(): JSONObject =
        withContext(Dispatchers.IO) {
            val root = rootDir(appContext)
            var bytesDeleted = 0L
            var deleted = true
            requiredAssets.forEach { spec ->
                val file = localAssetFile(appContext, spec.assetPath)
                val download = File(file.parentFile, "${file.name}.download")
                val marker = markerFile(appContext, spec)
                for (candidate in listOf(file, download, marker)) {
                    bytesDeleted += directorySize(candidate)
                    if (candidate.exists()) deleted = candidate.deleteRecursively() && deleted
                }
                removeEmptyParents(file.parentFile, root)
            }
            JSONObject()
                .put("storageScope", "app-private filesDir/setup-assets")
                .put("deletedOnUninstall", true)
                .put("path", root.absolutePath)
                .put("bytesDeleted", bytesDeleted)
                .put("deleted", deleted)
                .put("status", statusJson())
        }

    private fun removeEmptyParents(start: File?, root: File) {
        var directory = start
        while (directory != null && directory != root && directory.startsWith(root)) {
            if (directory.listFiles()?.isNotEmpty() == true) return
            if (!directory.delete()) return
            directory = directory.parentFile
        }
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
        val manifest = appContext.assets.open(manifestAssetPath).bufferedReader().use { reader ->
            JSONObject(reader.readText())
        }
        val artifacts = manifest.getJSONArray("artifacts")
        val specs = mutableListOf<StaticAssetSpec>()
        for (index in 0 until artifacts.length()) {
            val item = artifacts.getJSONObject(index)
            if (!item.optBoolean("native_required", false)) continue

            val key = NativeArtifactContract.trimmedText(
                item.getString("key"),
                "$manifestAssetPath artifact $index key",
            )
            val url = item.optString("url", "")
            val authoredAssetPath = item.optString("asset_path").takeIf { it.isNotBlank() }
                ?: url.trimStart('/')
            require(authoredAssetPath.isNotBlank() && isSafeAssetPath(authoredAssetPath)) {
                "$manifestAssetPath artifact $key has an invalid asset path."
            }
            val assetPath = packagedAssetPath(authoredAssetPath)

            val artifactKind = NativeArtifactContract.artifactKind(
                item.getString("artifact_kind"),
                "$manifestAssetPath artifact $key kind",
            )
            val resolvedUrl = NativeArtifactContract.httpsUrl(
                resolveArtifactUrl(url, authoredAssetPath),
                "$manifestAssetPath artifact $key URL",
            )
            specs += StaticAssetSpec(
                key = key,
                label = NativeArtifactContract.trimmedText(item.optString("label", key), "Setup asset label"),
                artifactKind = artifactKind,
                assetPath = assetPath,
                url = resolvedUrl,
                bytes = NativeArtifactContract.positiveSafeByteCount(item.opt("bytes"), "Setup asset bytes"),
                sha256 = NativeArtifactContract.sha256(item.getString("sha256"), "Setup asset SHA-256"),
            )
        }

        if (requireNativeAssets && specs.isEmpty()) {
            throw IllegalStateException("$manifestAssetPath does not define native setup assets.")
        }
        return specs
    }

    private fun resolveArtifactUrl(url: String, assetPath: String): String =
        when {
            url.startsWith("https://") || url.startsWith("http://") -> url
            url.startsWith("/") -> "$ASSET_BASE_URL$url"
            url.isNotBlank() -> "$ASSET_BASE_URL/${url.trimStart('/')}"
            else -> "$ASSET_BASE_URL/$assetPath"
        }

    private fun packagedAssetPath(authoredAssetPath: String): String =
        when {
            courseAssetPrefix.isEmpty() -> authoredAssetPath
            authoredAssetPath.startsWith("assets/") -> authoredAssetPath
            authoredAssetPath.startsWith("language-runtime/") -> authoredAssetPath
            else -> "$courseAssetPrefix/$authoredAssetPath"
        }

    companion object {
        private const val ASSET_DOWNLOAD_ATTEMPTS = 4
        private const val ASSET_CONNECT_TIMEOUT_MS = 30_000
        private const val ASSET_READ_TIMEOUT_MS = 120_000
        private const val ASSET_RETRY_DELAY_MS = 1_000L
        private const val ASSET_ROOT = "setup-assets"
        private const val ASSET_BASE_URL = "https://caatuu.waajacu.com"
        private const val DEFAULT_SETUP_ASSET_MANIFEST = "setup-assets.json"
        private val RETIRED_MASCOT_ASSET_DIRECTORIES = listOf(
            "assets/aliens",
            "assets/language-mascots",
        )

        fun rootDir(context: Context): File = NativeArtifactContract.canonicalChild(
            context.filesDir,
            ASSET_ROOT,
            "Setup asset storage root",
        )

        fun localAssetFile(context: Context, assetPath: String): File =
            NativeArtifactContract.canonicalDescendant(
                rootDir(context),
                assetPath,
                "Setup asset storage path",
            )

        internal fun deleteRetiredMascotAssets(root: File): Boolean =
            RETIRED_MASCOT_ASSET_DIRECTORIES
                .map { path -> File(root, path) }
                .map { directory -> !directory.exists() || directory.deleteRecursively() }
                .all { deleted -> deleted }

        private fun isSafeAssetPath(value: String): Boolean =
            value.isNotEmpty() &&
                !value.startsWith('/') &&
                !value.contains('\\') &&
                value.split('/').all { it.isNotEmpty() && it != "." && it != ".." }

        private fun markerFile(context: Context, spec: StaticAssetSpec): File =
            NativeArtifactContract.canonicalDescendant(
                rootDir(context),
                "${spec.assetPath}.sha256",
                "Setup asset identity marker",
            )

        private fun identityMarker(spec: StaticAssetSpec): String =
            NativeArtifactContract.artifactIdentityMarker(
                spec.artifactKind,
                spec.url,
                spec.assetPath,
                spec.bytes,
                spec.sha256,
            )
    }
}
