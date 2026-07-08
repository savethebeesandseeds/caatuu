package com.caatuu.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class AppUpdateManager(context: Context) {
    private val appContext = context.applicationContext
    private val updatesDir = File(appContext.cacheDir, "updates")
    private val updateApk = File(updatesDir, UPDATE_APK_NAME)
    private val updateBaseUrl = BuildConfig.CAATUU_UPDATE_BASE_URL.trimEnd('/')
    private val updateApkUrl = "$updateBaseUrl/$UPDATE_APK_NAME"
    private val updateManifestUrl = "$updateBaseUrl/$UPDATE_MANIFEST_NAME"

    init {
        pruneStaleUpdateFiles()
    }

    suspend fun statusJson(): JSONObject =
        withContext(Dispatchers.IO) {
            val status = baseStatusJson()
            try {
                val manifest = fetchJson(updateManifestUrl)
                status.putManifestStatus(manifest)
            } catch (error: Exception) {
                status
                    .put("serverReachable", false)
                    .put("updateAvailable", false)
                    .put("updateError", error.message ?: error::class.java.simpleName)
            }
        }

    fun clearDownloadedUpdate(): JSONObject {
        val bytesDeleted = directorySize(updatesDir)
        val deleted = !updatesDir.exists() || updatesDir.deleteRecursively()
        updatesDir.mkdirs()
        return JSONObject()
            .put("storageScope", "cached APK updates")
            .put("path", updatesDir.absolutePath)
            .put("deletedOnUninstall", true)
            .put("bytesDeleted", bytesDeleted)
            .put("deleted", deleted)
    }

    suspend fun downloadLatest(onProgress: (ModelProgress) -> Unit): JSONObject =
        withContext(Dispatchers.IO) {
            updatesDir.mkdirs()
            pruneStaleUpdateFiles()
            val manifest = fetchJson(updateManifestUrl)
            val latestVersionCode = manifest.optInt("version_code", 0)
            require(latestVersionCode > BuildConfig.VERSION_CODE) {
                "Caatuu is already up to date."
            }
            val apkUrl = manifest.optString("apk_url").takeIf { it.isNotBlank() } ?: updateApkUrl
            val expectedSha = manifest.optString("sha256").takeIf { it.isNotBlank() }
                ?: error("Update manifest is missing sha256.")
            val expectedBytes = manifest.optLong("bytes", 0L).takeIf { it > 0L }
                ?: error("Update manifest is missing bytes.")
            val tmpFile = partialUpdateApk()

            if (isVerifiedFile(updateApk, expectedSha, expectedBytes)) {
                tmpFile.delete()
                return@withContext updateResult(manifest, apkUrl, expectedSha, reused = true)
            }

            if (isVerifiedFile(tmpFile, expectedSha, expectedBytes)) {
                moveIntoPlace(tmpFile, updateApk)
                return@withContext updateResult(manifest, apkUrl, expectedSha, reused = true, recovered = true)
            }

            if (updateApk.exists()) updateApk.delete()
            if (tmpFile.exists() && tmpFile.length() > expectedBytes) tmpFile.delete()

            val startBytes = tmpFile.takeIf { it.isFile }?.length()?.takeIf { it in 1 until expectedBytes } ?: 0L
            val connection = (URL(apkUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 30_000
                readTimeout = 30_000
                instanceFollowRedirects = true
                if (startBytes > 0L) setRequestProperty("Range", "bytes=$startBytes-")
            }

            connection.connect()
            try {
                val resumed = startBytes > 0L && connection.responseCode == HttpURLConnection.HTTP_PARTIAL
                if (startBytes > 0L && !resumed) {
                    connection.disconnect()
                    tmpFile.delete()
                    return@withContext downloadLatest(onProgress)
                }
                require(connection.responseCode in 200..299) {
                    "APK download failed with HTTP ${connection.responseCode}"
                }

                val totalBytes = expectedBytes
                var bytesRead = if (resumed) startBytes else 0L
                onProgress(ModelProgress(bytesRead, totalBytes))

                connection.inputStream.use { input ->
                    FileOutputStream(tmpFile, resumed).use { output ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            bytesRead += read
                            onProgress(ModelProgress(bytesRead, totalBytes))
                        }
                    }
                }

                require(tmpFile.length() == expectedBytes) {
                    "APK size mismatch: expected $expectedBytes bytes, got ${tmpFile.length()}"
                }
                val actualSha = sha256(tmpFile)
                require(actualSha == expectedSha) {
                    "APK SHA-256 mismatch: expected $expectedSha, got $actualSha"
                }

                moveIntoPlace(tmpFile, updateApk)
                updateResult(manifest, apkUrl, actualSha, resumed = resumed)
            } finally {
                connection.disconnect()
            }
        }

    fun openInstaller(): String {
        require(updateApk.isFile) { "No downloaded APK is available." }

        if (!canRequestPackageInstalls()) {
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${appContext.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            appContext.startActivity(intent)
            return "settings"
        }

        val apkUri = FileProvider.getUriForFile(
            appContext,
            "${appContext.packageName}.files",
            updateApk,
        )
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(apkUri, APK_MIME_TYPE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        appContext.startActivity(intent)
        return "installer"
    }

    private fun canRequestPackageInstalls(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            appContext.packageManager.canRequestPackageInstalls()

    private fun fetchJson(url: String): JSONObject {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 10_000
            instanceFollowRedirects = true
        }

        return try {
            connection.connect()
            require(connection.responseCode in 200..299) {
                "Update manifest failed with HTTP ${connection.responseCode} at $url"
            }
            JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }

    private fun partialUpdateApk(): File = File(updatesDir, "$UPDATE_APK_NAME.download")

    private fun baseStatusJson(): JSONObject {
        pruneStaleUpdateFiles()
        return JSONObject()
            .put("currentVersionCode", BuildConfig.VERSION_CODE)
            .put("currentVersionName", BuildConfig.VERSION_NAME)
            .put("manifestUrl", updateManifestUrl)
            .put("apkUrl", updateApkUrl)
            .put("cachePath", updatesDir.absolutePath)
            .put("deletedOnUninstall", true)
            .put("canRequestPackageInstalls", canRequestPackageInstalls())
            .put("downloaded", updateApk.isFile)
            .put("bytes", updateApk.takeIf { it.isFile }?.length() ?: 0L)
            .put("partialBytes", partialUpdateApk().takeIf { it.isFile }?.length() ?: 0L)
            .put("updateAvailable", false)
    }

    private fun JSONObject.putManifestStatus(manifest: JSONObject): JSONObject {
        val latestVersionCode = manifest.optInt("version_code", 0)
        val latestVersionName = manifest.optString("version_name", "")
        return put("serverReachable", true)
            .put("latestVersionCode", latestVersionCode)
            .put("latestVersionName", latestVersionName)
            .put("latestBytes", manifest.optLong("bytes", 0L))
            .put("latestSha256", manifest.optString("sha256", ""))
            .put("manifest", manifest)
            .put("updateAvailable", latestVersionCode > BuildConfig.VERSION_CODE)
    }

    private fun isVerifiedFile(file: File, expectedSha: String, expectedBytes: Long): Boolean =
        file.isFile && file.length() == expectedBytes && sha256(file) == expectedSha

    private fun updateResult(
        manifest: JSONObject,
        apkUrl: String,
        sha: String,
        reused: Boolean = false,
        recovered: Boolean = false,
        resumed: Boolean = false,
    ): JSONObject =
        JSONObject()
            .put("currentVersionCode", BuildConfig.VERSION_CODE)
            .put("currentVersionName", BuildConfig.VERSION_NAME)
            .put("manifest", manifest)
            .put("apkUrl", apkUrl)
            .put("path", updateApk.absolutePath)
            .put("bytes", updateApk.length())
            .put("sha256", sha)
            .put("verified", true)
            .put("reused", reused)
            .put("recovered", recovered)
            .put("resumed", resumed)

    private fun moveIntoPlace(source: File, destination: File) {
        destination.delete()
        if (!source.renameTo(destination)) {
            source.copyTo(destination, overwrite = true)
            source.delete()
        }
    }

    private fun pruneStaleUpdateFiles() {
        if (!updatesDir.exists()) return
        val allowed = setOf(UPDATE_APK_NAME, "$UPDATE_APK_NAME.download")
        updatesDir.listFiles()?.forEach { file ->
            val isUpdateArtifact = file.name.endsWith(".apk") || file.name.endsWith(".apk.download")
            if (file.isFile && file.name !in allowed && isUpdateArtifact) {
                file.delete()
            }
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        file.inputStream().use { input ->
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().toHex()
    }

    private fun directorySize(file: File): Long {
        if (!file.exists()) return 0L
        if (file.isFile) return file.length()
        return file.listFiles()?.sumOf { directorySize(it) } ?: 0L
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    companion object {
        private const val UPDATE_APK_NAME = "caatuu.apk"
        private const val UPDATE_MANIFEST_NAME = "caatuu.json"
        private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
    }
}
