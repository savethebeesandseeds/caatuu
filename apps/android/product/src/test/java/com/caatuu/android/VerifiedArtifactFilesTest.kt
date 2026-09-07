package com.caatuu.android

import java.nio.file.Files
import java.nio.file.attribute.FileTime
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VerifiedArtifactFilesTest {
    @Test
    fun equalLengthCorruptionCannotReuseAPreviousVerification() {
        val root = Files.createTempDirectory("caatuu-verified-assets").toFile()
        try {
            val file = root.resolve("art.png").apply { writeText("good") }
            val verifier = VerifiedArtifactFiles()
            val hash = hash("good")
            assertTrue(verifier.matches(file, 4L, hash))
            val changedTime = file.lastModified() + 2_000
            file.writeText("evil")
            Files.setLastModifiedTime(file.toPath(), FileTime.fromMillis(changedTime))
            assertFalse(verifier.matches(file, 4L, hash))
            assertFalse(VerifiedArtifactFiles().matches(file, 4L, hash))
            file.writeText("good")
            assertTrue(verifier.matches(file, 4L, hash))
        } finally { root.deleteRecursively() }
    }

    @Test
    fun newerSharedBytesHaveADifferentPhysicalPathAndLeaveTheInstalledVersionIntact() {
        val root = Files.createTempDirectory("caatuu-asset-versions").toFile()
        try {
            val oldPath = NativeArtifactContract.staticAssetStoragePath("assets/planet.png", hash("old"))
            val newPath = NativeArtifactContract.staticAssetStoragePath("assets/planet.png", hash("new"))
            assertNotEquals(oldPath, newPath)
            assertEquals(oldPath, NativeArtifactContract.staticAssetStoragePath("assets/planet.png", hash("old")))
            val installed = root.resolve(oldPath).apply { requireNotNull(parentFile).mkdirs(); writeText("old") }
            val candidate = root.resolve(newPath).apply { requireNotNull(parentFile).mkdirs(); writeText("bad") }
            val verifier = VerifiedArtifactFiles()
            assertFalse(verifier.matches(candidate, 3L, hash("new")))
            assertTrue(verifier.matches(installed, 3L, hash("old")))
            assertEquals("old", installed.readText())
        } finally { root.deleteRecursively() }
    }

    private fun hash(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}
