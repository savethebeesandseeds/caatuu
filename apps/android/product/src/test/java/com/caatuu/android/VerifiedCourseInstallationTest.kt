package com.caatuu.android

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VerifiedCourseInstallationTest {
    @Test
    fun incompleteAndInterruptedCoursesNeverBecomeInstalled() {
        val root = Files.createTempDirectory("caatuu-installation").toFile()
        try {
            val receipt = root.resolve("cz.receipt")
            var ready = false
            var identityReads = 0
            val install = VerifiedCourseInstallation(receipt, { identityReads++; listOf("course-v1", "shared-v1") }, { ready })
            assertFalse(install.isReady())
            assertFalse(install.adoptVerifiedAssets())
            assertEquals(0, identityReads)
            assertFalse(receipt.exists())
            root.resolve("cz.receipt.pending").writeText("interrupted")
            assertFalse(install.isReady())
            ready = true
            assertTrue(install.adoptVerifiedAssets())
            assertTrue(install.isReady())
            assertFalse(root.resolve("cz.receipt.pending").exists())
            ready = false
            assertFalse(install.isReady())
        } finally { root.deleteRecursively() }
    }

    @Test
    fun existingVerifiedDownloadsAreAdoptedAndManifestChangesInvalidateReadiness() {
        val root = Files.createTempDirectory("caatuu-installation").toFile()
        try {
            val receipt = root.resolve("cz.receipt")
            var identities = listOf("course-v1", "shared-v1")
            val install = VerifiedCourseInstallation(receipt, { identities }, { true })
            assertTrue(install.adoptVerifiedAssets())
            val firstReceipt = receipt.readText()
            identities = listOf("shared-v1", "course-v1", "shared-v1")
            val reordered = VerifiedCourseInstallation(receipt, { identities }, { true })
            assertTrue(reordered.isReady())
            assertTrue(reordered.adoptVerifiedAssets())
            assertEquals(firstReceipt, receipt.readText())
            identities = listOf("course-v2", "shared-v1")
            val updated = VerifiedCourseInstallation(receipt, { identities }, { true })
            assertFalse(updated.isReady())
            assertTrue(updated.adoptVerifiedAssets())
            val restarted = VerifiedCourseInstallation(receipt, { identities }, { true })
            assertTrue(restarted.isReady())
            restarted.invalidate()
            assertFalse(restarted.isReady())
        } finally { root.deleteRecursively() }
    }

    @Test
    fun removingOneReceiptDoesNotInvalidateAnotherCourseOrRemoveSharedFiles() {
        val root = Files.createTempDirectory("caatuu-installation").toFile()
        try {
            val shared = root.resolve("shared-art.png").apply { writeText("shared") }
            val czech = VerifiedCourseInstallation(root.resolve("cz.receipt"), { listOf("cz-v1", "shared-v1") }, { shared.isFile })
            val mandarin = VerifiedCourseInstallation(root.resolve("zh.receipt"), { listOf("zh-v1", "shared-v1") }, { shared.isFile })
            assertTrue(czech.adoptVerifiedAssets())
            assertTrue(mandarin.adoptVerifiedAssets())
            czech.invalidate()
            assertTrue(shared.isFile)
            assertTrue(mandarin.isReady())
        } finally { root.deleteRecursively() }
    }
}
