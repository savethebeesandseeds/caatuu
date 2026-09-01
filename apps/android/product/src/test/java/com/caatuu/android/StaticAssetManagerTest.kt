package com.caatuu.android

import java.nio.file.Files
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StaticAssetManagerTest {
    @Test
    fun retiredMascotCachesAreDeletedWithoutTouchingActiveAssets() {
        val root = Files.createTempDirectory("caatuu-static-assets").toFile()
        try {
            val retiredAliases = listOf(
                root.resolve("assets/aliens/Czech_Macaw.png"),
                root.resolve("assets/language-mascots/Chinese_Macaw.png"),
            )
            for (asset in retiredAliases) {
                requireNotNull(asset.parentFile).mkdirs()
                asset.writeText("retired")
                asset.resolveSibling("${asset.name}.sha256").writeText("retired")
                asset.resolveSibling("${asset.name}.download").writeText("retired")
            }
            val activeAsset = root.resolve("assets/loading_animation/robot-frame.png")
            requireNotNull(activeAsset.parentFile).mkdirs()
            activeAsset.writeText("active")

            assertTrue(StaticAssetManager.deleteRetiredMascotAssets(root))
            assertFalse(root.resolve("assets/aliens").exists())
            assertFalse(root.resolve("assets/language-mascots").exists())
            assertTrue(activeAsset.isFile)
            assertTrue(StaticAssetManager.deleteRetiredMascotAssets(root))
            assertTrue(activeAsset.isFile)
        } finally {
            root.deleteRecursively()
        }
    }
}
