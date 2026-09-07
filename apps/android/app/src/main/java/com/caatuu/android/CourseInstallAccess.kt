package com.caatuu.android

/** Install status belongs to the requested course, never the previously visible page. */
internal object CourseInstallAccess {
    fun assetPath(
        resolution: BundledAssetResolution,
        isReady: (String, Boolean) -> Boolean,
    ): String? {
        val course = resolution.course ?: return resolution.assetPath
        // The existing Home and its identity must work before installation.
        // Curriculum and course feature providers still require a verified receipt.
        if (resolution.assetPath == "index.html" || resolution.courseRelativePath in setOf(
                "source/shared/course-profile.js", "manifest.webmanifest",
            )) return resolution.assetPath
        return resolution.assetPath.takeIf { isReady(course.id, false) }
    }
}
