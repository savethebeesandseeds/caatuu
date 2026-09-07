package com.caatuu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CourseInstallAccessTest {
    @Test
    fun pickerAndBundledRuntimeDoNotActivateAnyCourse() {
        for (path in listOf("setup.html", "caatuu-course-bundle.json", "language-runtime/static/source/course-install.mjs")) {
            assertEquals(path, CourseInstallAccess.assetPath(BundledAssetResolution(path)) { _, _ ->
                error("The neutral shell must not activate a course.")
            })
        }
    }

    @Test
    fun originalHomeAndItsProfileLoadBeforeSetupWhilePartialDataIsBlocked() {
        val selected = course("zh")
        val requests = mutableListOf<Pair<String, Boolean>>()
        val ready: (String, Boolean) -> Boolean = { id, adopt -> requests += id to adopt; false }
        assertEquals("index.html", CourseInstallAccess.assetPath(BundledAssetResolution("index.html", selected, "index.html"), ready))
        for (path in listOf("source/shared/course-profile.js", "manifest.webmanifest")) {
            assertEquals("courses/zh/$path", CourseInstallAccess.assetPath(BundledAssetResolution("courses/zh/$path", selected, path), ready))
        }
        assertNull(CourseInstallAccess.assetPath(BundledAssetResolution("courses/zh/data/words.json", selected, "data/words.json"), ready))
        assertNull(CourseInstallAccess.assetPath(BundledAssetResolution("courses/zh/source/games/game.js", selected, "source/games/game.js"), ready))
        assertEquals(listOf("zh" to false, "zh" to false), requests)
    }

    @Test
    fun readyCourseCanLoadItsDataWhileOtherCoursesRemainBlocked() {
        val ready: (String, Boolean) -> Boolean = { id, _ -> id == "zh" }
        assertEquals("index.html", CourseInstallAccess.assetPath(BundledAssetResolution("index.html", course("zh")), ready))
        assertEquals("courses/zh/data/words.json", CourseInstallAccess.assetPath(BundledAssetResolution("courses/zh/data/words.json", course("zh")), ready))
        assertNull(CourseInstallAccess.assetPath(BundledAssetResolution("courses/cz/data/words.json", course("cz")), ready))
    }

    private fun course(id: String) = BundledCourse(
        id, "/$id", "/$id/index.html", "courses/$id",
        BundledLanguage("en", "English", "en"), BundledLanguage(id, id, id),
        CourseCapabilities.fromMap(emptyMap()), BundledNativeProviders(1),
    )
}
