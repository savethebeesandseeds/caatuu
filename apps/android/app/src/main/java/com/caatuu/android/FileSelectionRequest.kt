package com.caatuu.android

import java.net.URI

/** One outstanding system picker owns one WebView callback. */
internal class FileSelectionRequest<T> {
    private var callback: ((T?) -> Unit)? = null
    private var destroyed = false

    fun begin(onResult: (T?) -> Unit): Boolean {
        if (destroyed || callback != null) {
            onResult(null)
            return false
        }
        callback = onResult
        return true
    }

    fun finish(value: T?) {
        val pending = callback
        callback = null
        pending?.invoke(value)
    }

    fun destroy() {
        destroyed = true
        finish(null)
    }
}

internal object FileSelectionPolicy {
    fun trustedPage(url: String?): Boolean = runCatching {
        val uri = URI(url ?: return false)
        uri.scheme == "https" && uri.host == BundledCourseRegistry.APP_HOST &&
            uri.userInfo == null && (uri.port == -1 || uri.port == 443)
    }.getOrDefault(false)

    fun acceptedMimeTypes(acceptTypes: Array<String>): Array<String> {
        val types = acceptTypes.flatMap { it.split(',') }.map { it.trim() }.filter { it.isNotEmpty() }
        // Android document providers commonly label .caatuu backups as generic
        // binary data. An extension-only filter must not hide those backups.
        if (types.isEmpty() || types.any { it.startsWith(".") || it.equals("application/vnd.caatuu.progress+json", ignoreCase = true) }) return arrayOf("*/*")
        val mime = Regex("[A-Za-z0-9!#$&^_.+*-]+/[A-Za-z0-9!#$&^_.+*-]+")
        return types.filter { mime.matches(it) }.distinct().ifEmpty { listOf("*/*") }.toTypedArray()
    }

    fun allowedDocument(scheme: String?, authority: String?, ownAuthority: String, granted: Boolean): Boolean =
        scheme == "content" && !authority.isNullOrBlank() && authority != ownAuthority && granted
}
