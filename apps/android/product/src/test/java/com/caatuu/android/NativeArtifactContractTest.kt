package com.caatuu.android

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeArtifactContractTest {
    @Test
    fun dictionaryStorageKeysAreStableSingleSegmentIdentifiers() {
        assertEquals(
            "kaikki-cs-en-2026-07-09",
            NativeArtifactContract.storageKey("kaikki-cs-en-2026-07-09", "Dictionary key"),
        )
        for (value in listOf("..", "../x", "x/y", "x\\y", "/x", " x", "x ", "\tx", "x\n")) {
            assertThrows(value, IllegalArgumentException::class.java) {
                NativeArtifactContract.storageKey(value, "Dictionary key")
            }
        }
    }

    @Test
    fun canonicalBytesMatchJavaScriptSafeIntegerSemantics() {
        assertEquals(1L, NativeArtifactContract.positiveSafeByteCount(1, "bytes"))
        assertEquals(10L, NativeArtifactContract.positiveSafeByteCount(10.0, "bytes"))
        for (value in listOf<Any?>(null, "10", 0, -1, 1.5, 9_007_199_254_740_992L)) {
            assertThrows(value?.toString() ?: "null", IllegalArgumentException::class.java) {
                NativeArtifactContract.positiveSafeByteCount(value, "bytes")
            }
        }
    }

    @Test
    fun localArtifactFilesMustBeExactBasenames() {
        assertEquals(
            "curriculum.sqlite",
            NativeArtifactContract.fileName("curriculum.sqlite", "Embedding manifest file"),
        )
        for (value in listOf("..", "../x", "x/y", "x\\y", "/x", " x", "x ")) {
            assertThrows(value, IllegalArgumentException::class.java) {
                NativeArtifactContract.fileName(value, "Embedding manifest file")
            }
        }
    }

    @Test
    fun canonicalChildRejectsAnExistingLinkOutsideItsParent() {
        val workspace = Files.createTempDirectory("caatuu-artifact-contract").toFile()
        val storage = workspace.resolve("storage").apply { mkdirs() }
        val outside = workspace.resolve("outside").apply { mkdirs() }
        val victim = outside.resolve("preserve.txt").apply { writeText("preserve") }
        val link = storage.resolve("dictionary")
        try {
            Files.createSymbolicLink(link.toPath(), outside.toPath())
            assertThrows(IllegalArgumentException::class.java) {
                NativeArtifactContract.canonicalChild(storage, "dictionary", "Dictionary storage key")
            }
            assertTrue(victim.isFile)
        } finally {
            Files.deleteIfExists(link.toPath())
            workspace.deleteRecursively()
        }
    }

    @Test
    fun identityMarkersBindTheCompleteAuthoritativeTuple() {
        val first = NativeArtifactContract.storageArtifact(
            "cz",
            "vector-dbs/shared.sqlite",
            "https://caatuu.example/models/shared.sqlite",
            "model-v1/shared.sqlite",
            100L,
            "c".repeat(64),
            "embedding-vector-db",
        )
        NativeArtifactContract.requireCompatibleSharedStorage(
            listOf(first, first.copy(courseId = "zh")),
        )

        val variants = listOf(
            first.copy(courseId = "zh", source = "https://caatuu.example/other/shared.sqlite"),
            first.copy(courseId = "zh", declaredPath = "model-v2/shared.sqlite"),
            first.copy(courseId = "zh", bytes = 101L),
            first.copy(courseId = "zh", sha256 = "d".repeat(64)),
            first.copy(courseId = "zh", artifactKind = "dictionary-database"),
        )
        variants.forEach { variant ->
            assertThrows(IllegalArgumentException::class.java) {
                NativeArtifactContract.requireCompatibleSharedStorage(listOf(first, variant))
            }
        }
    }
}
