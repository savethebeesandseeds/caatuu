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

    fun statusJson(): JSONObject =
        JSONObject()
            .put("currentVersionCode", BuildConfig.VERSION_CODE)
            .put("currentVersionName", BuildConfig.VERSION_NAME)
            .put("manifestUrl", UPDATE_MANIFEST_URL)
            .put("apkUrl", UPDATE_APK_URL)
            .put("cachePath", updatesDir.absolutePath)
            .put("deletedOnUninstall", true)
            .put("canRequestPackageInstalls", canRequestPackageInstalls())
            .put("downloaded", updateApk.isFile)
            .put("bytes", updateApk.takeIf { it.isFile }?.length() ?: 0L)

    suspend fun downloadLatest(onProgress: (ModelProgress) -> Unit): JSONObject =
        withContext(Dispatchers.IO) {
            updatesDir.mkdirs()
            val manifest = fetchJson(UPDATE_MANIFEST_URL)
            val apkUrl = manifest.optString("apk_url").takeIf { it.isNotBlank() } ?: UPDATE_APK_URL
            val expectedSha = manifest.optString("sha256").takeIf { it.isNotBlank() }
                ?: error("Update manifest is missing sha256.")
            val expectedBytes = manifest.optLong("bytes", 0L).takeIf { it > 0L }
                ?: error("Update manifest is missing bytes.")
            val tmpFile = File(updatesDir, "$UPDATE_APK_NAME.download")

            tmpFile.delete()
            updateApk.delete()

            val connection = (URL(apkUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 30_000
                readTimeout = 30_000
                instanceFollowRedirects = true
            }

            try {
                connection.connect()
                require(connection.responseCode in 200..299) {
                    "APK download failed with HTTP ${connection.responseCode}"
                }
                val totalBytes = connection.contentLengthLong.takeIf { it > 0L } ?: expectedBytes
                val digest = MessageDigest.getInstance("SHA-256")
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var bytesRead = 0L

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
                require(actualSha == expectedSha) {
                    "APK SHA-256 mismatch: expected $expectedSha, got $actualSha"
                }
                require(tmpFile.length() == expectedBytes) {
                    "APK size mismatch: expected $expectedBytes bytes, got ${tmpFile.length()}"
                }

                if (!tmpFile.renameTo(updateApk)) {
                    tmpFile.copyTo(updateApk, overwrite = true)
                    tmpFile.delete()
                }

                JSONObject()
                    .put("currentVersionCode", BuildConfig.VERSION_CODE)
                    .put("currentVersionName", BuildConfig.VERSION_NAME)
                    .put("manifest", manifest)
                    .put("apkUrl", apkUrl)
                    .put("path", updateApk.absolutePath)
                    .put("bytes", updateApk.length())
                    .put("sha256", actualSha)
                    .put("verified", actualSha == expectedSha)
            } finally {
                connection.disconnect()
                if (tmpFile.isFile && !updateApk.isFile) tmpFile.delete()
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
                "Update manifest failed with HTTP ${connection.responseCode}"
            }
            JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    companion object {
        private const val UPDATE_APK_NAME = "caatuu-debug.apk"
        private const val UPDATE_BASE_URL = "https://caatuu.waajacu.com/android"
        private const val UPDATE_APK_URL = "$UPDATE_BASE_URL/$UPDATE_APK_NAME"
        private const val UPDATE_MANIFEST_URL = "$UPDATE_BASE_URL/caatuu-debug.json"
        private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
    }
}
