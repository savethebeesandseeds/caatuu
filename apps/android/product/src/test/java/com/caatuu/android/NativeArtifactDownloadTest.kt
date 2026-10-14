package com.caatuu.android

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.nio.file.Files
import java.util.concurrent.CancellationException
import org.junit.Assert.*
import org.junit.Test

class NativeArtifactDownloadTest {
    @Test
    fun completedDownloadsWithMissingOrWrongSizedFilesFailInsteadOfRemainingPending() {
        for (actualBytes in listOf(null, 0L, 7L, 9L)) {
            assertThrows(java.io.IOException::class.java) {
                NativeArtifactDownload.requireCompletedSize(actualBytes, 8L)
            }
        }
    }

    @Test
    fun exactSizedCompletedDownloadCanContinueToChecksumVerification() {
        NativeArtifactDownload.requireCompletedSize(8L, 8L)
    }

    @Test
    fun exactCatalogSizeCompletesAndReportsReceivedBytes() = withPartial("") { file ->
        val progress = mutableListOf<Long>()
        FileOutputStream(file).use { output ->
            assertEquals(6L, NativeArtifactDownload.copyBounded(
                ByteArrayInputStream("abcdef".toByteArray()), output, 6L,
                onProgress = progress::add,
            ))
        }
        assertEquals("abcdef", file.readText())
        assertEquals(listOf(6L), progress)
    }

    @Test
    fun resumedBodyCountsTheExistingPrefixAgainstTheLimit() = withPartial("abc") { file ->
        FileOutputStream(file, true).use { output ->
            assertEquals(6L, NativeArtifactDownload.copyBounded(
                ByteArrayInputStream("def".toByteArray()), output, 6L, startBytes = 3L,
            ))
        }
        assertEquals("abcdef", file.readText())
    }

    @Test
    fun bodyWithoutAnEndCannotWriteBeyondThePinnedSize() = withPartial("") { file ->
        var received = 0
        val unboundedBody = object : InputStream() {
            override fun read(): Int = error("Expected buffered reads")
            override fun read(buffer: ByteArray, offset: Int, count: Int): Int {
                val chunk = minOf(3, count)
                repeat(chunk) { buffer[offset + it] = 65 }
                received += chunk
                return chunk
            }
        }
        FileOutputStream(file).use { output ->
            assertThrows(NativeArtifactSizeException::class.java) {
                NativeArtifactDownload.copyBounded(unboundedBody, output, 16L)
            }
        }
        assertEquals(18, received)
        assertEquals(15L, file.length())
    }

    @Test
    fun oversizedResumeChunkDoesNotChangeTheSavedPrefix() = withPartial("abc") { file ->
        FileOutputStream(file, true).use { output ->
            assertThrows(NativeArtifactSizeException::class.java) {
                NativeArtifactDownload.copyBounded(
                    ByteArrayInputStream("defg".toByteArray()), output, 6L, startBytes = 3L,
                )
            }
        }
        assertEquals("abc", file.readText())
    }

    @Test
    fun shortBodyRemainsAvailableForTheExistingRetryPolicy() = withPartial("") { file ->
        FileOutputStream(file).use { output ->
            assertEquals(3L, NativeArtifactDownload.copyBounded(
                ByteArrayInputStream("abc".toByteArray()), output, 6L,
            ))
        }
        assertEquals("abc", file.readText())
    }

    @Test
    fun cancellationWhileReadingDoesNotWriteTheReturnedChunk() = withPartial("") { file ->
        var cancelled = false
        val input = object : InputStream() {
            override fun read(): Int = error("Expected buffered reads")
            override fun read(buffer: ByteArray, offset: Int, count: Int): Int {
                buffer[offset] = 65
                cancelled = true
                return 1
            }
        }
        FileOutputStream(file).use { output ->
            assertThrows(CancellationException::class.java) {
                NativeArtifactDownload.copyBounded(input, output, 6L,
                    checkActive = { if (cancelled) throw CancellationException() })
            }
        }
        assertEquals(0L, file.length())
    }

    @Test
    fun aLargeResumeOffsetCannotOverflowTheSizeCheck() {
        val output = ByteArrayOutputStream()
        assertThrows(NativeArtifactSizeException::class.java) {
            NativeArtifactDownload.copyBounded(
                ByteArrayInputStream(byteArrayOf(65, 66)), output, Long.MAX_VALUE,
                startBytes = Long.MAX_VALUE - 1,
            )
        }
        assertEquals(0, output.size())
    }

    private fun withPartial(contents: String, block: (File) -> Unit) {
        val directory = Files.createTempDirectory("caatuu-artifact-download").toFile()
        try { block(directory.resolve("artifact.download").apply { writeText(contents) }) }
        finally { directory.deleteRecursively() }
    }
}
