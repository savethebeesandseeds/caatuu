package com.caatuu.android

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

/** A receipt commits only a complete, currently verified manifest closure. */
internal class VerifiedCourseInstallation(
    private val receipt: File,
    private val identities: () -> List<String>,
    private val artifactsReady: () -> Boolean,
) {
    @Synchronized
    fun isCommitted(): Boolean = runCatching {
        receipt.isFile && receipt.readText().trim() == expectedReceipt
    }.getOrDefault(false)

    @Synchronized
    fun isReady(): Boolean = isCommitted() && artifactsReady()

    @Synchronized
    fun adoptVerifiedAssets(): Boolean {
        if (!artifactsReady()) return false
        val expected = expectedReceipt
        if (receipt.isFile && receipt.readText().trim() == expected) return true
        receipt.parentFile?.mkdirs()
        val pending = File(receipt.parentFile, "${receipt.name}.pending")
        pending.writeText(expected)
        Files.move(pending.toPath(), receipt.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        return true
    }

    @Synchronized
    fun invalidate() {
        check(!receipt.exists() || receipt.delete()) { "Could not invalidate course installation receipt." }
    }

    private val expectedReceipt: String by lazy {
        val canonical = identities().distinct().sorted().joinToString("\n", prefix = "caatuu-course-installation-v1\n")
        MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
