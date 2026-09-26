package com.caatuu.android

import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.InetSocketAddress
import java.net.HttpURLConnection
import java.net.URL
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference
import java.nio.file.Files
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

class AppUpdateTransferTest {
    @Test
    fun everyOwnedTransferStateSkipsTheServerEvenWhenOffline() {
        for (state in listOf("pending", "downloading", "paused", "recovering", "ready")) {
            var requests = 0
            repeat(20) {
                val target = AppUpdateTransferPolicy.localOrRemote(
                    local = { if (AppUpdateTransferPolicy.pinsTarget(state)) "version-178" else null },
                    pinned = { true }, remote = { requests++; throw IOException("offline") },
                )
                assertEquals("version-178", target)
            }
            assertEquals("$state must observe only local progress", 0, requests)
        }
    }

    @Test
    fun aLateManifestResponseCannotReplaceTheTransferThatStartedInFlight() {
        var local: String? = null
        var requests = 0
        val result = AppUpdateTransferPolicy.localOrRemote(
            local = { local }, pinned = { true }, remote = {
                requests++
                local = "downloading-178"
                "old-manifest-177"
            },
        )
        assertEquals(1, requests)
        assertEquals("downloading-178", result)
        assertFalse(AppUpdateTransferPolicy.pinsTarget("failed"))
        assertFalse(AppUpdateTransferPolicy.pinsTarget("idle"))
    }

    @Test
    fun stalledManagedDownloadsRecoverButNetworkRestrictionsDoNot() {
        var time = 0L
        val watch = AppUpdateStallWatch({ time })
        assertFalse(watch.shouldRecover(0, "system"))
        time = 29_999
        assertFalse(watch.shouldRecover(0, "system"))
        time = 30_000
        assertTrue(watch.shouldRecover(0, "system"))
        assertFalse(watch.shouldRecover(200, ""))
        time = 60_000
        assertTrue(watch.shouldRecover(200, "retry"))
        for (reason in listOf("network", "wifi")) {
            time += 1_000_000
            assertFalse(watch.shouldRecover(200, reason))
            time += 29_999
            assertFalse(watch.shouldRecover(200, ""))
        }
    }

    @Test
    fun repeatedManagedRetriesOfTheSamePrefixDoNotKeepTheStallTimerAlive() {
        var time = 0L
        val watch = AppUpdateStallWatch({ time })
        assertFalse(watch.shouldRecover(0, "system"))
        time = 10_000
        assertFalse(watch.shouldRecover(100, ""))
        time = 20_000
        assertFalse(watch.shouldRecover(0, "retry"))
        time = 30_000
        assertFalse(watch.shouldRecover(100, ""))
        time = 40_000
        assertTrue(watch.shouldRecover(0, "retry"))
    }

    @Test
    fun detachedObserverExceptionsAreRecordedWithoutCrashingOrCancellingTheScope() = runBlocking {
        val failures = AppUpdateObservationFailures()
        val supervisor = SupervisorJob()
        val scope = CoroutineScope(supervisor + Dispatchers.Default + failures.handler)
        try {
            scope.launch { throw IOException("simulated preference or query failure") }.join()
            assertTrue(supervisor.isActive)
            assertTrue(failures.hasPending())
            assertTrue(failures.consume())
            assertFalse(failures.consume())
            scope.launch { throw CancellationException("normal cancellation") }.join()
            assertFalse(failures.hasPending())
        } finally { scope.cancel() }
    }

    @Test
    fun aRecoveredTransferResumesThePinnedFileAndReportsRealBytes() = withServer { server, url ->
        val ranges = mutableListOf<String?>()
        server.createContext("/apk") { exchange ->
            ranges += exchange.requestHeaders.getFirst("Range")
            exchange.responseHeaders.add("Content-Range", "bytes 3-7/8")
            exchange.reply(206, "defgh")
        }
        withPartial("abc") { file ->
            val progress = mutableListOf<Long>()
            AppUpdateTransfer().download("$url/apk", file, 8, onProgress = progress::add)
            assertEquals(listOf("bytes=3-"), ranges)
            assertEquals("abcdefgh", file.readText())
            assertEquals(8L, progress.last())
        }
    }

    @Test
    fun aServerThatIgnoresRangeRestartsInsteadOfAppendingDuplicateBytes() = withServer { server, url ->
        server.createContext("/apk") { it.reply(200, "abcdefgh") }
        withPartial("abc") { file ->
            AppUpdateTransfer().download("$url/apk", file, 8)
            assertEquals("abcdefgh", file.readText())
        }
    }

    @Test
    fun anEmptyPreallocatedManagedFileMustDownloadInsteadOfPretendingToBeComplete() = withServer { server, url ->
        val requests = AtomicInteger()
        server.createContext("/apk") {
            requests.incrementAndGet()
            assertNull(it.requestHeaders.getFirst("Range"))
            it.reply(200, "abcdefgh")
        }
        withPartial("stale123") { file ->
            val managed = file.resolveSibling("managed.apk")
            RandomAccessFile(managed, "rw").use { it.setLength(8) }
            AppUpdatePartialFile.importManaged(managed, file, 0, 8)
            assertFalse(file.exists())
            AppUpdateTransfer().download("$url/apk", file, 8)
            assertEquals(1, requests.get())
            assertEquals("abcdefgh", file.readText())
        }
    }

    @Test
    fun aPartiallyReceivedPreallocatedManagedFileResumesOnlyConfirmedBytes() = withServer { server, url ->
        val requests = AtomicInteger()
        server.createContext("/apk") {
            requests.incrementAndGet()
            assertEquals("bytes=3-", it.requestHeaders.getFirst("Range"))
            it.responseHeaders.add("Content-Range", "bytes 3-7/8")
            it.reply(206, "defgh")
        }
        withPartial("stale123") { file ->
            val managed = file.resolveSibling("managed.apk").apply { writeText("abc") }
            RandomAccessFile(managed, "rw").use { it.setLength(8) }
            AppUpdatePartialFile.importManaged(managed, file, 3, 8)
            assertEquals("abc", file.readText())
            AppUpdateTransfer().download("$url/apk", file, 8)
            assertEquals(1, requests.get())
            assertEquals("abcdefgh", file.readText())
        }
    }

    @Test
    fun wrongResumeRangeIsRejectedWithoutCorruptingTheSavedPartial() = withServer { server, url ->
        val requests = AtomicInteger()
        server.createContext("/apk") {
            requests.incrementAndGet()
            it.responseHeaders.add("Content-Range", "bytes 0-4/8")
            it.reply(206, "abcde")
        }
        withPartial("abc") { file ->
            assertThrows(IOException::class.java) { AppUpdateTransfer().download("$url/apk", file, 8) }
            assertEquals(3, requests.get())
            assertEquals("abc", file.readText())
        }
    }

    @Test
    fun interruptedHttpBodyResumesOnTheNextBoundedAttempt() = withServer { server, url ->
        val requests = AtomicInteger()
        server.createContext("/apk") {
            if (requests.incrementAndGet() == 1) {
                it.sendResponseHeaders(200, 8)
                it.responseBody.write("abc".toByteArray())
                it.responseBody.close()
            } else {
                assertEquals("bytes=3-", it.requestHeaders.getFirst("Range"))
                it.responseHeaders.add("Content-Range", "bytes 3-7/8")
                it.reply(206, "defgh")
            }
        }
        withPartial("") { file ->
            AppUpdateTransfer(readTimeoutMillis = 500).download("$url/apk", file, 8)
            assertEquals(2, requests.get())
            assertEquals("abcdefgh", file.readText())
        }
    }

    @Test
    fun persistentHttpFailureStopsAfterThreeAttemptsInsteadOfPollingForever() = withServer { server, url ->
        val requests = AtomicInteger()
        server.createContext("/apk") { requests.incrementAndGet(); it.reply(503, "unavailable") }
        withPartial("") { file ->
            assertThrows(IOException::class.java) { AppUpdateTransfer().download("$url/apk", file, 8) }
            assertEquals(3, requests.get())
            assertEquals(0, file.length())
        }
    }

    @Test
    fun oversizedPayloadIsRejectedAndCancellationIsNotRetried() = withServer { server, url ->
        val requests = AtomicInteger()
        server.createContext("/apk") { requests.incrementAndGet(); it.reply(200, "too much data") }
        withPartial("") { file ->
            assertThrows(IOException::class.java) { AppUpdateTransfer().download("$url/apk", file, 4) }
            assertTrue(file.length() <= 4)
            val before = requests.get()
            assertThrows(CancellationException::class.java) {
                AppUpdateTransfer().download("$url/apk", file, 4, checkActive = { throw CancellationException() })
            }
            assertEquals(before, requests.get())
        }
    }

    @Test
    fun cancellationWhileReadingDoesNotWriteTheReturnedChunk() {
        var cancelled = false
        withPartial("") { file ->
            val transfer = AppUpdateTransfer(openConnection = { url ->
                connection(url, object : InputStream() {
                    override fun read(): Int { cancelled = true; return 65 }
                    override fun read(bytes: ByteArray, offset: Int, count: Int): Int {
                        bytes[offset] = 65
                        cancelled = true
                        return 1
                    }
                })
            })
            assertThrows(CancellationException::class.java) {
                transfer.download("https://example.test/apk", file, 8,
                    checkActive = { if (cancelled) throw CancellationException() })
            }
            assertEquals(0L, file.length())
        }
    }

    @Test
    fun aSlowTrickleStillHitsTheOverallMonotonicDeadline() {
        var elapsed = 0L
        withPartial("") { file ->
            val transfer = AppUpdateTransfer(clock = { elapsed }, deadlineMillis = 30,
                openConnection = { url ->
                    connection(url, object : InputStream() {
                        override fun read(): Int { elapsed += 10; return 65 }
                        override fun read(bytes: ByteArray, offset: Int, count: Int): Int {
                            elapsed += 10
                            bytes[offset] = 65
                            return 1
                        }
                    })
                })
            assertThrows(IOException::class.java) { transfer.download("https://example.test/apk", file, 100) }
            assertEquals(30L, elapsed)
            assertEquals(2L, file.length())
        }
    }

    private fun connection(url: URL, input: InputStream): HttpURLConnection = object : HttpURLConnection(url) {
        override fun connect() {}
        override fun disconnect() {}
        override fun usingProxy() = false
        override fun getResponseCode() = 200
        override fun getInputStream() = input
    }

    private fun withServer(block: (TestServer, String) -> Unit) {
        val server = TestServer()
        server.start()
        try { block(server, "http://127.0.0.1:${server.port}") } finally { server.stop() }
    }

    private fun withPartial(contents: String, block: (java.io.File) -> Unit) {
        val root = Files.createTempDirectory("caatuu-update-transfer").toFile()
        try { block(root.resolve("caatuu.apk.part").apply { writeText(contents) }) }
        finally { root.deleteRecursively() }
    }

    private fun Exchange.reply(code: Int, contents: String) {
        val bytes = contents.toByteArray()
        sendResponseHeaders(code, bytes.size.toLong())
        responseBody.use { it.write(bytes) }
    }

    /** Real loopback HTTP, using only the java.net APIs available to Android unit tests. */
    private class TestServer {
        private val socket = ServerSocket().apply { bind(InetSocketAddress("127.0.0.1", 0)) }
        private val handlers = ConcurrentHashMap<String, (Exchange) -> Unit>()
        private val failure = AtomicReference<Throwable?>()
        val port: Int get() = socket.localPort
        fun createContext(path: String, handler: (Exchange) -> Unit) { handlers[path] = handler }
        fun start() {
            Thread {
                while (!socket.isClosed) {
                    val client = try { socket.accept() } catch (_: IOException) { break }
                    try {
                        client.use {
                            val reader = it.getInputStream().bufferedReader()
                            val path = reader.readLine().split(" ")[1]
                            val exchange = Exchange(it)
                            while (true) {
                                val line = reader.readLine() ?: break
                                if (line.isBlank()) break
                                exchange.requestHeaders.add(line.substringBefore(":"), line.substringAfter(":").trim())
                            }
                            (handlers[path] ?: error("No HTTP test handler for $path"))(exchange)
                        }
                    } catch (error: Throwable) { failure.set(error) }
                }
            }.apply { isDaemon = true; start() }
        }
        fun stop() {
            socket.close()
            failure.get()?.let { throw AssertionError("HTTP fixture failed", it) }
        }
    }

    private class Headers {
        private val values = linkedMapOf<String, String>()
        fun add(name: String, value: String) { values[name.lowercase()] = value }
        fun getFirst(name: String): String? = values[name.lowercase()]
        fun encoded(): String = values.entries.joinToString("") { "${it.key}: ${it.value}\r\n" }
    }

    private class Exchange(client: Socket) {
        val requestHeaders = Headers()
        val responseHeaders = Headers()
        val responseBody = client.getOutputStream()
        fun sendResponseHeaders(code: Int, bytes: Long) {
            responseHeaders.add("Content-Length", bytes.toString())
            responseHeaders.add("Connection", "close")
            responseBody.write(("HTTP/1.1 $code Test\r\n" + responseHeaders.encoded() + "\r\n").toByteArray())
        }
    }
}
