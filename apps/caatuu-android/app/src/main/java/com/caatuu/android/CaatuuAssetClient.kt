package com.caatuu.android

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream
import java.io.FileNotFoundException

class CaatuuAssetClient(private val context: Context) : WebViewClient() {
    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? = intercept(request.url)

    private fun intercept(uri: Uri): WebResourceResponse? {
        if (uri.scheme != "https" || uri.host != HOST) return null

        val path = uri.path.orEmpty()
        if (path != "/cz" && !path.startsWith("/cz/")) return null

        val assetPath = path
            .removePrefix("/cz")
            .trimStart('/')
            .ifBlank { "index.html" }
            .replace('\\', '/')

        if (assetPath.contains("..")) return notFound()

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
            "js" -> "text/javascript"
            "json" -> "application/json"
            "svg" -> "image/svg+xml"
            "webmanifest" -> "application/manifest+json"
            "wasm" -> "application/wasm"
            else -> "application/octet-stream"
        }

    private fun charsetFor(path: String): String? =
        when (path.substringAfterLast('.', "").lowercase()) {
            "css", "html", "js", "json", "svg", "txt", "webmanifest" -> "UTF-8"
            else -> null
        }

    companion object {
        private const val HOST = "caatuu.local"
        const val START_URL = "https://$HOST/cz/index.html"
    }
}
