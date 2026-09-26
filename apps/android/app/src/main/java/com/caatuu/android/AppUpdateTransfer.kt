package com.caatuu.android

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** DownloadManager may preallocate its destination. Only its received-byte counter is resumable. */
internal object AppUpdatePartialFile {
    fun importManaged(source: File?, destination: File, confirmedBytes: Long, expectedBytes: Long,
        checkActive: () -> Unit = {}) {
        checkActive()
        val received = if (source?.isFile == true) minOf(confirmedBytes, source.length(), expectedBytes) else 0L
        if (received <= 0L) {
            destination.delete()
            return
        }
        destination.parentFile?.mkdirs()
        source!!.inputStream().use { input ->
            checkActive()
            FileOutputStream(destination, false).use { output ->
                val buffer = ByteArray(64 * 1024)
                var remaining = received
                while (remaining > 0L) {
                    checkActive()
                    val read = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                    checkActive()
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    remaining -= read
                }
            }
        }
    }
}

/** The transfer owns its target until it succeeds or the user retries a failure. */
internal object AppUpdateTransferPolicy {
    fun pinsTarget(state: String?): Boolean = state in setOf("pending", "downloading", "paused", "recovering", "ready")

    /** Recheck after the request too: a download may start while the server is responding. */
    fun <T> localOrRemote(local: () -> T?, pinned: (T) -> Boolean, remote: () -> T): T {
        local()?.takeIf(pinned)?.let { return it }
        val response = try { remote() } catch (error: IOException) {
            return local()?.takeIf(pinned) ?: throw error
        }
        return local()?.takeIf(pinned) ?: response
    }
}

/** Uses elapsed time, never wall-clock time. Android's network restrictions are not bypassed. */
internal class AppUpdateStallWatch(
    private val clock: () -> Long,
    private val timeoutMillis: Long = 30_000L,
) {
    private var lastBytes = -1L
    private var lastMovement = clock()

    fun shouldRecover(bytes: Long, waitReason: String): Boolean {
        val now = clock()
        if (bytes > lastBytes || waitReason == "network" || waitReason == "wifi") {
            lastBytes = maxOf(lastBytes, bytes)
            lastMovement = now
            return false
        }
        return now - lastMovement >= timeoutMillis
    }
}

/** Bounded fallback for a stalled Android DownloadManager job. Final APK verification stays native. */
internal class AppUpdateTransfer(
    private val connectTimeoutMillis: Int = 10_000,
    private val readTimeoutMillis: Int = 10_000,
    private val attempts: Int = 3,
    private val openConnection: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection },
    private val clock: () -> Long = { System.nanoTime() / 1_000_000L },
    private val deadlineMillis: Long = 120_000L,
) {
    fun download(
        url: String,
        file: File,
        expectedBytes: Long,
        checkActive: () -> Unit = {},
        onProgress: (Long) -> Unit = {},
    ): File {
        require(expectedBytes > 0L)
        val started = clock()
        val checkTransfer = {
            checkActive()
            if (clock() - started >= deadlineMillis) throw IOException("App update download timed out. Try again.")
        }
        checkTransfer()
        file.parentFile?.mkdirs()
        var lastError: IOException? = null
        repeat(attempts) {
            checkTransfer()
            if (file.length() > expectedBytes) file.delete()
            if (file.isFile && file.length() == expectedBytes) return file
            val offset = file.takeIf { it.isFile }?.length() ?: 0L
            var connection: HttpURLConnection? = null
            try {
                connection = connect(URL(url), offset, checkTransfer)
                val code = connection.responseCode
                if (code != HttpURLConnection.HTTP_OK && code != HttpURLConnection.HTTP_PARTIAL) {
                    throw IOException("App update download returned HTTP $code. Try again.")
                }
                val append = code == HttpURLConnection.HTTP_PARTIAL
                if (append) {
                    val range = connection.getHeaderField("Content-Range").orEmpty()
                    val match = CONTENT_RANGE.matchEntire(range)
                    if (match == null || match.groupValues[1].toLongOrNull() != offset ||
                        match.groupValues[3].toLongOrNull() != expectedBytes ||
                        match.groupValues[2].toLongOrNull()?.let { it >= offset && it < expectedBytes } != true
                    ) throw IOException("App update download returned an invalid resume range. Try again.")
                }
                var bytes = if (append) offset else 0L
                connection.inputStream.use { input ->
                    checkTransfer()
                    FileOutputStream(file, append).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            checkTransfer()
                            val read = input.read(buffer)
                            checkTransfer()
                            if (read < 0) break
                            if (bytes + read > expectedBytes) throw IOException("App update download exceeds its verified size.")
                            output.write(buffer, 0, read)
                            bytes += read
                            onProgress(bytes)
                        }
                    }
                }
                if (file.length() != expectedBytes) throw IOException("App update download stopped before it finished. Try again.")
                return file
            } catch (error: IOException) {
                lastError = error
            } finally {
                connection?.disconnect()
            }
        }
        throw IOException("App update download could not finish. Check your connection and try again.", lastError)
    }

    private fun connect(initial: URL, offset: Long, checkActive: () -> Unit): HttpURLConnection {
        var url = initial
        repeat(6) {
            checkActive()
            val connection = openConnection(url).apply {
                connectTimeout = connectTimeoutMillis
                readTimeout = readTimeoutMillis
                instanceFollowRedirects = false
                useCaches = false
                setRequestProperty("Accept-Encoding", "identity")
                if (offset > 0L) setRequestProperty("Range", "bytes=$offset-")
            }
            try {
                val code = connection.responseCode
                if (code !in setOf(301, 302, 303, 307, 308)) return connection
                val next = URL(url, connection.getHeaderField("Location") ?: throw IOException("Missing update download redirect."))
                require(next.protocol == "https" || (initial.protocol == "http" && next.protocol == "http")) {
                    "App update download cannot redirect to an insecure connection."
                }
                require(next.userInfo.isNullOrBlank()) { "App update redirect cannot contain credentials." }
                url = next
            } catch (error: Exception) {
                connection.disconnect()
                throw error
            }
            connection.disconnect()
        }
        throw IOException("Too many update download redirects.")
    }

    private companion object {
        val CONTENT_RANGE = Regex("bytes (\\d+)-(\\d+)/(\\d+)")
    }
}
