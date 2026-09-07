package com.caatuu.android

/** Install status belongs to the requested course, never the previously visible page. */
internal object CourseInstallAccess {
    fun assetPath(
        resolution: BundledAssetResolution,
        isReady: (String, Boolean) -> Boolean,
    ): String? {
        val course = resolution.course ?: return resolution.assetPath
        val isEntry = resolution.assetPath == "index.html"
        if (isReady(course.id, isEntry)) return resolution.assetPath
        return if (isEntry) "course-install.html" else null
    }
}
