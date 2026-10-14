package com.caatuu.android

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

internal class NativeArtifactSizeException(expectedBytes: Long) : IOException(
    "Artifact download exceeds its verified size of $expectedBytes bytes.",
)

/** Bound disk writes by the pinned catalog size, including resumed and chunked bodies. */
internal object NativeArtifactDownload {
    fun requireCompletedSize(actualBytes: Long?, expectedBytes: Long) {
        if (actualBytes != expectedBytes) {
            throw IOException("Artifact size mismatch: expected $expectedBytes bytes, got ${actualBytes ?: "no file"}.")
        }
    }

    fun copyBounded(
        input: InputStream,
        output: OutputStream,
        expectedBytes: Long,
        startBytes: Long = 0L,
        checkActive: () -> Unit = {},
        onProgress: (Long) -> Unit = {},
    ): Long {
        require(expectedBytes > 0L && startBytes in 0..expectedBytes)
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var bytesRead = startBytes
        while (true) {
            checkActive()
            val read = input.read(buffer)
            checkActive()
            if (read < 0) return bytesRead
            if (read.toLong() > expectedBytes - bytesRead) {
                throw NativeArtifactSizeException(expectedBytes)
            }
            output.write(buffer, 0, read)
            bytesRead += read
            onProgress(bytesRead)
        }
    }
}
