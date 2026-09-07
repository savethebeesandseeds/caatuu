package com.caatuu.android

import java.io.File
import java.nio.file.Files
import java.nio.file.attribute.BasicFileAttributes
import java.nio.file.attribute.FileTime
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/** Immutable downloaded bytes are rehashed after restart or any observed file change. */
internal class VerifiedArtifactFiles {
    private data class Identity(val bytes: Long, val modified: FileTime, val created: FileTime, val sha256: String)
    private val verified = ConcurrentHashMap<String, Identity>()

    fun matches(file: File, bytes: Long, sha256: String): Boolean = runCatching {
        if (!file.isFile || file.length() != bytes) return@runCatching false
        val path = file.canonicalPath
        fun identity(): Identity {
            val attributes = Files.readAttributes(file.toPath(), BasicFileAttributes::class.java)
            return Identity(attributes.size(), attributes.lastModifiedTime(), attributes.creationTime(), sha256)
        }
        val before = identity()
        if (verified[path] == before) return@runCatching true
        verified.remove(path)
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (actual != sha256 || before != identity()) return@runCatching false
        verified[path] = before
        true
    }.getOrDefault(false)
}
