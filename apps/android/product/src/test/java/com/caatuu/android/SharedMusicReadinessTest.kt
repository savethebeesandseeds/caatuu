package com.caatuu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SharedMusicReadinessTest {
    private fun spec(name: String, kind: String = "music", path: String = "assets/music/audio/$name.mp3") =
        StaticAssetSpec(name, name, kind, path, "/$path", 12L, "a".repeat(64))

    @Test
    fun allDeclaredMusicMustBeVerifiedFromACommittedOwner() {
        val tracks = listOf(spec("woodland"), spec("birds"), spec("town"))
        val verified = mutableSetOf(tracks[0].assetPath, tracks[1].assetPath)
        assertFalse(SharedMusicReadiness.isReady(tracks, { true }, verified::contains))
        verified.add(tracks[2].assetPath)
        assertTrue(SharedMusicReadiness.isReady(tracks, { true }, verified::contains))
        assertFalse(SharedMusicReadiness.isReady(tracks, { false }, verified::contains))
    }

    @Test
    fun emptyCatalogsAndOtherArtifactKindsCannotClaimMusicReadiness() {
        assertFalse(SharedMusicReadiness.isReady(emptyList(), { true }, { true }))
        assertFalse(SharedMusicReadiness.isReady(listOf(spec("image", "image")), { true }, { true }))
        assertFalse(SharedMusicReadiness.isReady(listOf(spec("outside", path = "data/outside.mp3")), { true }, { true }))
    }

    @Test
    fun onlyMusicIsInspectedAndUncommittedOwnersNeverProbeFiles() {
        val inspected = mutableListOf<String>()
        val declarations = listOf(spec("woodland"), spec("large-model", "embedding-model", "native/model.onnx"))
        assertFalse(SharedMusicReadiness.isReady(declarations, { false }, { inspected.add(it); true }))
        assertTrue(inspected.isEmpty())
        assertTrue(SharedMusicReadiness.isReady(declarations, { true }, { inspected.add(it); true }))
        assertEquals(listOf("assets/music/audio/woodland.mp3"), inspected)
    }

    @Test
    fun anotherInstalledCourseCanOwnTheSharedTracks() {
        val tracks = listOf(spec("woodland"), spec("birds"), spec("town"))
        val installedOwners = listOf(false, true)
        assertTrue(installedOwners.any { committed ->
            SharedMusicReadiness.isReady(tracks, { committed }, { true })
        })
    }
}
