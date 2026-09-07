package com.caatuu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CourseSetupSessionTest {
    @Test
    fun revisitingTheActiveCourseReusesItsSetupAndAnotherCourseCannotAbortIt() {
        val session = CourseSetupSession()
        val operation = Any()
        assertTrue(session.begin("zh", operation))
        assertFalse(session.begin("zh", Any()))
        assertEquals("zh", session.courseId)
        assertThrows(IllegalStateException::class.java) { session.begin("cz", Any()) }
        assertThrows(IllegalStateException::class.java) { session.requireOwner("cz") }
        session.requireOwner("zh")
        assertEquals("zh", session.courseId)
        session.finish(operation)
        assertNull(session.courseId)
        assertTrue(session.begin("cz", Any()))
    }

    @Test
    fun staleCompletionCannotClearANewerSetupOperation() {
        val session = CourseSetupSession()
        val first = Any()
        val second = Any()
        assertTrue(session.begin("zh", first))
        session.finish(first)
        assertTrue(session.begin("cz", second))
        session.finish(first)
        assertEquals("cz", session.courseId)
        session.finish(second)
        assertNull(session.courseId)
    }
}
