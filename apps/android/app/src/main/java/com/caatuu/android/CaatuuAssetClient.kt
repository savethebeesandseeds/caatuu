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

class CaatuuAssetClient(private val context: Context) : WebViewClient() {
    private val vectorDatabaseManager by lazy { VectorDatabaseManager(context) }

    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
    ): Boolean {
        val uri = request.url
        if (isAppRoot(uri)) {
            view.loadUrl(START_URL)
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
            view.loadUrl(START_URL)
            return
        }

        if (isAppRoot(uri)) {
            view.loadUrl(START_URL)
            return
        }

        view.evaluateJavascript(NATIVE_BOUNDARY_SCRIPT, null)
    }

    private fun intercept(uri: Uri): WebResourceResponse? {
        if (!isAppHost(uri)) return forbidden()
        if (isAppRoot(uri)) return redirectToLanguageHome()

        val path = uri.path.orEmpty()
        val assetPath = when {
            path == LANGUAGE_ROUTE_PREFIX || path.startsWith("$LANGUAGE_ROUTE_PREFIX/") -> path
                .removePrefix(LANGUAGE_ROUTE_PREFIX)
                .trimStart('/')
                .ifBlank { "home.html" }
                .replace('\\', '/')
            path.startsWith("/assets/") -> path.trimStart('/').replace('\\', '/')
            else -> return notFound()
        }

        if (assetPath.contains("..")) return notFound()

        val localVectorDatabase = localVectorDatabase(assetPath)
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

        val localSetupAsset = localSetupAsset(assetPath)
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

        return try {
            WebResourceResponse(
                mimeType(assetPath),
                charsetFor(assetPath),
                context.assets.open(assetPath),
            ).apply {
                responseHeaders = mapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Cache-Control" to "no-store",
                )
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
                """<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=$START_URL"><title>Caatuu</title>"""
                    .toByteArray(),
            ),
        )

    private fun localVectorDatabase(assetPath: String): File? {
        val spec = vectorDatabaseManager.defaultSpec()
        val expectedPath = "data/embeddings/${spec.modelFile}"
        if (assetPath != expectedPath) return null

        val file = File(context.filesDir, "vector-dbs/${spec.fileName}")
        return file.takeIf { it.isFile }
    }

    private fun localSetupAsset(assetPath: String): File? {
        val setupManagedPath = assetPath.startsWith("assets/") ||
            assetPath.startsWith("data/embeddings/")
        if (!setupManagedPath || assetPath.contains("..")) return null
        return StaticAssetManager.localAssetFile(context, assetPath).takeIf { it.isFile }
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

    companion object {
        private const val HOST = "caatuu.local"
        private val LANGUAGE_ROUTE_PREFIX = normalizePath(BuildConfig.CAATUU_LANGUAGE_ROUTE_PREFIX)
            .trimEnd('/')
        private val LANGUAGE_ENTRY_PATH = normalizePath(BuildConfig.CAATUU_LANGUAGE_ENTRY_PATH)
        val START_URL = "https://$HOST$LANGUAGE_ENTRY_PATH"
        private val NATIVE_BOUNDARY_SCRIPT = """
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
                      .filter((key) => key.startsWith("caatuu-czech-pwa-") || key.includes("caatuu"))
                      .map((key) => caches.delete(key))))
                    .catch(() => {});
                }
                const entryPath = ${JSONObject.quote(LANGUAGE_ENTRY_PATH)};
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
    }
}
