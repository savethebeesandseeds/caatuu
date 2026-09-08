package com.caatuu.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.FilterInputStream

class CaatuuAssetClient(
    private val context: Context,
    private val courseCapabilities: CourseCapabilities = CourseCapabilities.fromJson(
        BuildConfig.CAATUU_COURSE_CAPABILITIES_JSON,
    ),
    private val vectorDatabaseManager: VectorDatabaseManager? = null,
    private val courseRegistry: BundledCourseRegistry = legacyCourseRegistry(courseCapabilities),
    private val vectorDatabaseManagers: Map<String, VectorDatabaseManager> = vectorDatabaseManager
        ?.let { mapOf(courseRegistry.defaultCourseId to it) }
        ?: emptyMap(),
    private val staticAssetManagers: Map<String, StaticAssetManager> = emptyMap(),
    private val vectorDatabaseManagerForCourse: ((String) -> VectorDatabaseManager?)? = null,
    private val courseSetupReady: ((String, Boolean) -> Boolean)? = null,
    preferredCourseId: String? = null,
    private val onCourseVisited: ((String) -> Unit)? = null,
) : WebViewClient() {

    private var selectedCourseId = preferredCourseId
    val startUrl: String get() = courseRegistry.startUrlForCourse(selectedCourseId)

    init {
        vectorDatabaseManagers.forEach { (courseId, _) ->
            val course = checkNotNull(courseRegistry.course(courseId)) {
                "Embedding manager course is not bundled."
            }
            check(course.capabilities.isEnabled("embeddings")) {
                "Embedding manager does not match the course capability boundary."
            }
        }
        check(staticAssetManagers.keys.all(courseRegistry::isBundled)) {
            "Static asset manager course is not bundled."
        }
    }

    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
    ): Boolean {
        val uri = request.url
        if (isAppRoot(uri)) {
            view.loadUrl(startUrl)
            return true
        }
        if (isAppHost(uri)) return false

        openExternalUrl(uri)
        return true
    }

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? = intercept(
        request.url,
        request.requestHeaders.entries.firstOrNull { it.key.equals("Range", ignoreCase = true) }?.value,
    )

    override fun onPageFinished(view: WebView, url: String?) {
        super.onPageFinished(view, url)

        val uri = url?.let(Uri::parse) ?: return
        if (!isAppHost(uri)) {
            view.stopLoading()
            view.loadUrl(startUrl)
            return
        }

        if (isAppRoot(uri)) {
            view.loadUrl(startUrl)
            return
        }

        courseRegistry.courseForTrustedUrl(url)?.let { course ->
            selectedCourseId = course.id
            onCourseVisited?.invoke(course.id)
        }
        view.evaluateJavascript(nativeBoundaryScript(), null)
    }

    private fun intercept(uri: Uri, rangeHeader: String? = null): WebResourceResponse? {
        if (!isAppHost(uri)) return forbidden()
        if (isAppRoot(uri)) return redirectToLanguageHome()

        val resolution = courseRegistry.resolveAsset(uri.path.orEmpty()) ?: return notFound()
        val assetPath = resolution.assetPath
        val relativePath = resolution.courseRelativePath
        val capabilities = resolution.course?.capabilities
        val requestedCourse = resolution.course
        if (courseSetupReady != null) {
            val permittedPath = CourseInstallAccess.assetPath(resolution, courseSetupReady) ?: return notFound()
            if (permittedPath != assetPath) return bundledAsset(permittedPath, noStore = true)
        }
        if (relativePath?.startsWith("data/embeddings/") == true && capabilities?.isEnabled("embeddings") != true) {
            return notFound()
        }
        if (relativePath?.startsWith("data/dictionaries/") == true && capabilities?.isEnabled("dictionary") != true) {
            return notFound()
        }
        val requestedCourseId = requestedCourse?.id ?: courseRegistry.defaultCourseId
        val vectorManager = vectorDatabaseManagerForCourse?.invoke(requestedCourseId)
            ?: vectorDatabaseManagers[requestedCourseId]
        val selectedVectorPath = vectorManager?.let { manager ->
            assetPath == manager.modelAssetPath(manager.defaultSpec())
        } == true
        val localVectorDatabase = localVectorDatabase(assetPath, vectorManager)
        if (localVectorDatabase != null) {
            return WebResourceResponse(
                "application/vnd.sqlite3",
                null,
                localVectorDatabase.inputStream(),
            ).apply {
                responseHeaders = mapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Cache-Control" to "no-store",
                )
            }
        }
        if (selectedVectorPath) return notFound()

        val assetOwners = staticAssetManagers.filterValues { it.ownsAssetPath(assetPath) }
        val readyOwners = assetOwners.filter { (courseId, _) ->
            courseSetupReady == null || courseSetupReady.invoke(courseId, false)
        }
        val localSetupAsset = readyOwners.values.firstNotNullOfOrNull { it.verifiedLocalAsset(assetPath) }
        if (localSetupAsset != null) {
            if (assetPath.startsWith("assets/music/audio/")) {
                return localMusicAsset(assetPath, localSetupAsset, rangeHeader)
            }
            return WebResourceResponse(
                mimeType(assetPath),
                charsetFor(assetPath),
                localSetupAsset.inputStream(),
            ).apply {
                responseHeaders = mapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Cache-Control" to "no-store",
                )
            }
        }
        if (assetOwners.isNotEmpty()) return notFound()

        return bundledAsset(assetPath, noStore = assetPath == "index.html" || assetPath == "setup.html")
    }

    // Chromium seeks in and loops downloaded audio using HTTP byte ranges.
    // Serve only the already verified setup file, without buffering the song.
    private fun localMusicAsset(assetPath: String, file: File, rangeHeader: String?): WebResourceResponse {
        val size = file.length()
        val headers = mutableMapOf(
            "Access-Control-Allow-Origin" to "*",
            "Cache-Control" to "no-store",
            "Accept-Ranges" to "bytes",
            "Content-Length" to size.toString(),
        )
        val match = rangeHeader?.trim()?.let { Regex("bytes=(\\d*)-(\\d*)").matchEntire(it) }
        var start = 0L
        var end = size - 1
        val partial = match != null && match.groupValues.drop(1).any { it.isNotEmpty() }
        if (partial) {
            val first = match!!.groupValues[1]
            val last = match.groupValues[2]
            if (first.isEmpty()) {
                val suffix = last.toLongOrNull() ?: 0L
                start = if (suffix > 0) (size - suffix).coerceAtLeast(0L) else size
            } else {
                start = first.toLongOrNull() ?: size
                end = if (last.isEmpty()) size - 1 else (last.toLongOrNull() ?: -1L).coerceAtMost(size - 1)
            }
            if (start >= size || end < start) {
                headers["Content-Range"] = "bytes */$size"
                headers["Content-Length"] = "0"
                return WebResourceResponse(mimeType(assetPath), null, 416, "Range Not Satisfiable", headers, ByteArrayInputStream(byteArrayOf()))
            }
        }
        val length = (end - start + 1).coerceAtLeast(0L)
        headers["Content-Length"] = length.toString()
        if (partial) headers["Content-Range"] = "bytes $start-$end/$size"
        val input = file.inputStream()
        input.channel.position(start)
        val bounded = object : FilterInputStream(input) {
            private var remaining = length
            override fun read(): Int {
                if (remaining <= 0) return -1
                val value = `in`.read()
                if (value >= 0) remaining -= 1
                return value
            }
            override fun read(buffer: ByteArray, offset: Int, count: Int): Int {
                if (count == 0) return 0
                if (remaining <= 0) return -1
                val read = `in`.read(buffer, offset, minOf(count.toLong(), remaining).toInt())
                if (read > 0) remaining -= read.toLong()
                return read
            }
            override fun available(): Int = minOf(`in`.available().toLong(), remaining).toInt()
            override fun skip(count: Long): Long = `in`.skip(minOf(count.coerceAtLeast(0L), remaining)).also { remaining -= it }
        }
        return WebResourceResponse(mimeType(assetPath), null, if (partial) 206 else 200,
            if (partial) "Partial Content" else "OK", headers, bounded)
    }

    private fun bundledAsset(assetPath: String, noStore: Boolean = false): WebResourceResponse {
        return try {
            WebResourceResponse(
                mimeType(assetPath),
                charsetFor(assetPath),
                context.assets.open(assetPath),
            ).apply {
                responseHeaders = if (noStore) BUNDLED_ASSET_HEADERS + ("Cache-Control" to "no-store") else BUNDLED_ASSET_HEADERS
            }
        } catch (_: FileNotFoundException) {
            notFound()
        } catch (_: Exception) {
            notFound()
        }
    }

    private fun isAppHost(uri: Uri): Boolean =
        uri.scheme == "https" && uri.host == HOST && (uri.port == -1 || uri.port == 443)

    private fun isAppRoot(uri: Uri): Boolean =
        isAppHost(uri) && (uri.path.isNullOrBlank() || uri.path == "/" || uri.path == "/index.html"
            || (courseSetupReady != null && uri.path == "/setup.html"))

    private fun openExternalUrl(uri: Uri) {
        if (uri.scheme !in setOf("http", "https")) return
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { context.startActivity(intent) }
    }

    private fun forbidden(): WebResourceResponse =
        WebResourceResponse(
            "text/plain",
            "UTF-8",
            403,
            "Forbidden",
            mapOf("Cache-Control" to "no-store"),
            ByteArrayInputStream("External content is not available inside Caatuu.".toByteArray()),
        )

    private fun redirectToLanguageHome(): WebResourceResponse =
        WebResourceResponse(
            "text/html",
            "UTF-8",
            200,
            "OK",
            mapOf("Cache-Control" to "no-store"),
            ByteArrayInputStream(
                """<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=$startUrl"><title>Caatuu</title>"""
                    .toByteArray(),
            ),
        )

    private fun localVectorDatabase(assetPath: String, manager: VectorDatabaseManager?): File? {
        manager ?: return null
        val spec = manager.defaultSpec()
        val expectedPath = manager.modelAssetPath(spec)
        if (assetPath != expectedPath) return null

        return manager.verifiedDatabaseFile(spec)
    }

    private fun notFound(): WebResourceResponse =
        WebResourceResponse(
            "text/plain",
            "UTF-8",
            404,
            "Not Found",
            mapOf("Cache-Control" to "no-store"),
            ByteArrayInputStream("Not found".toByteArray()),
        )

    private fun mimeType(path: String): String =
        when (path.substringAfterLast('.', "").lowercase()) {
            "css" -> "text/css"
            "html" -> "text/html"
            "jpg", "jpeg" -> "image/jpeg"
            "js", "mjs" -> "text/javascript"
            "json" -> "application/json"
            "mp3" -> "audio/mpeg"
            "txt" -> "text/plain"
            "png" -> "image/png"
            "sqlite", "db" -> "application/vnd.sqlite3"
            "svg" -> "image/svg+xml"
            "webmanifest" -> "application/manifest+json"
            "wasm" -> "application/wasm"
            else -> "application/octet-stream"
        }

    private fun charsetFor(path: String): String? =
        when (path.substringAfterLast('.', "").lowercase()) {
            "css", "html", "js", "mjs", "json", "svg", "txt", "webmanifest" -> "UTF-8"
            else -> null
        }

    private fun nativeBoundaryScript(): String =
        NATIVE_BOUNDARY_SCRIPT_TEMPLATE.replace(
            ENTRY_PATH_PLACEHOLDER,
            JSONObject.quote(Uri.parse(startUrl).path),
        )

    companion object {
        private const val HOST = BundledCourseRegistry.APP_HOST
        private const val ENTRY_PATH_PLACEHOLDER = "__CAATUU_ENTRY_PATH__"
        private val BUNDLED_ASSET_HEADERS = mapOf(
            "Access-Control-Allow-Origin" to "*",
            "Cache-Control" to "private, max-age=31536000, immutable",
        )
        private val LANGUAGE_ENTRY_PATH = normalizePath(BuildConfig.CAATUU_LANGUAGE_ENTRY_PATH)
        val START_URL = "https://$HOST$LANGUAGE_ENTRY_PATH"
        private val NATIVE_BOUNDARY_SCRIPT_TEMPLATE = """
            (() => {
              try {
                if ("serviceWorker" in navigator) {
                  navigator.serviceWorker.getRegistrations()
                    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
                    .catch(() => {});
                }
                if ("caches" in window) {
                  caches.keys()
                    .then((keys) => Promise.all(keys
                      .filter((key) => key.includes("caatuu"))
                      .map((key) => caches.delete(key))))
                    .catch(() => {});
                }
                const entryPath = __CAATUU_ENTRY_PATH__;
                if (location.origin === "https://caatuu.local" && (location.pathname === "/" || location.pathname === "/index.html")) {
                  location.replace(entryPath);
                }
              } catch (error) {}
            })();
        """

        private fun normalizePath(value: String): String {
            val trimmed = value.trim()
            require(trimmed.isNotEmpty() && !trimmed.contains("..")) { "Language path must be absolute and safe." }
            return if (trimmed.startsWith('/')) trimmed else "/$trimmed"
        }

        private fun legacyCourseRegistry(capabilities: CourseCapabilities): BundledCourseRegistry =
            BundledCourseRegistry.singleLegacy(
                id = BuildConfig.CAATUU_LANGUAGE_ID,
                routePrefix = BuildConfig.CAATUU_LANGUAGE_ROUTE_PREFIX,
                entryPath = BuildConfig.CAATUU_LANGUAGE_ENTRY_PATH,
                sourceLanguageLabel = BuildConfig.CAATUU_SOURCE_LANGUAGE_LABEL,
                targetLanguageLabel = BuildConfig.CAATUU_TARGET_LANGUAGE_LABEL,
                targetLanguageLocale = BuildConfig.CAATUU_TARGET_LANGUAGE_LOCALE,
                speechLocale = BuildConfig.CAATUU_SPEECH_LOCALE,
                capabilities = capabilities,
            )
    }
}
