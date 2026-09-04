package com.caatuu.android

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileNotFoundException

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
) : WebViewClient() {

    val startUrl: String = courseRegistry.startUrl
    @Volatile
    private var activeCourseId: String = courseRegistry.defaultCourseId

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
    ): WebResourceResponse? = intercept(request.url)

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

        view.evaluateJavascript(nativeBoundaryScript(), null)
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        courseRegistry.courseForTrustedUrl(url)?.let { course -> activeCourseId = course.id }
        super.onPageStarted(view, url, favicon)
    }

    private fun intercept(uri: Uri): WebResourceResponse? {
        if (!isAppHost(uri)) return forbidden()
        if (isAppRoot(uri)) return redirectToLanguageHome()

        val resolution = courseRegistry.resolveAsset(uri.path.orEmpty()) ?: return notFound()
        val assetPath = resolution.assetPath
        val relativePath = resolution.courseRelativePath
        val capabilities = resolution.course?.capabilities
        if (relativePath?.startsWith("data/embeddings/") == true && capabilities?.isEnabled("embeddings") != true) {
            return notFound()
        }
        if (relativePath?.startsWith("data/dictionaries/") == true && capabilities?.isEnabled("dictionary") != true) {
            return notFound()
        }
        val vectorManager = vectorDatabaseManagers[activeCourseId]
        val staticManager = staticAssetManagers[activeCourseId]
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

        val localSetupAsset = localSetupAsset(assetPath, staticManager)
        if (localSetupAsset != null) {
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
        if (staticManager?.ownsAssetPath(assetPath) == true) return notFound()

        return try {
            WebResourceResponse(
                mimeType(assetPath),
                charsetFor(assetPath),
                context.assets.open(assetPath),
            ).apply {
                responseHeaders = BUNDLED_ASSET_HEADERS
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
        isAppHost(uri) && (uri.path.isNullOrBlank() || uri.path == "/" || uri.path == "/index.html")

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

    private fun localSetupAsset(
        assetPath: String,
        manager: StaticAssetManager?,
    ): File? {
        manager ?: return null
        return manager.verifiedLocalAsset(assetPath)
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
            JSONObject.quote(courseRegistry.defaultCourse.entryPath),
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
