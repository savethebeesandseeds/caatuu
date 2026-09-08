package com.caatuu.android

/** Use only declared shared music and the same verified-owner gate as asset serving. */
internal object SharedMusicReadiness {
    fun isReady(
        declarations: List<StaticAssetSpec>,
        ownerReady: () -> Boolean,
        assetVerified: (String) -> Boolean,
    ): Boolean {
        val music = declarations.filter { it.artifactKind == "music" }
        return music.isNotEmpty() &&
            music.all { it.assetPath.startsWith("assets/music/audio/") && it.assetPath.endsWith(".mp3") } &&
            ownerReady() && music.all { assetVerified(it.assetPath) }
    }
}
