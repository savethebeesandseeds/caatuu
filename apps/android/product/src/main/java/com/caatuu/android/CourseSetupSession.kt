package com.caatuu.android

/** One resumable setup operation has one course owner, even when its screen reloads. */
internal class CourseSetupSession {
    @Volatile var courseId: String? = null
        private set
    private var token: Any? = null

    @Synchronized
    fun begin(selectedCourse: String, operation: Any): Boolean {
        requireOwner(selectedCourse)
        if (token != null) return false
        token = operation
        courseId = selectedCourse
        return true
    }

    @Synchronized
    fun requireOwner(selectedCourse: String) {
        check(courseId == null || courseId == selectedCourse) {
            "Another course's setup is still running. Return to that course to finish or cancel it."
        }
    }

    @Synchronized
    fun finish(operation: Any) {
        if (token !== operation) return
        token = null
        courseId = null
    }
}
