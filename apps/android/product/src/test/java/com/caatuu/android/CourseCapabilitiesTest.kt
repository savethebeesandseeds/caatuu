package com.caatuu.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

class CourseCapabilitiesTest {
    @Test
    fun parsesGeneratedBooleanCapabilityObject() {
        val capabilities = CourseCapabilities.fromJson(
            """{"embeddings":true,"dictionary":false,"speech":true}""",
        )

        assertTrue(capabilities.isEnabled("embeddings"))
        assertFalse(capabilities.isEnabled("dictionary"))
        assertTrue(capabilities.isEnabled("speech"))
        assertFalse(capabilities.isEnabled("llm"))
        assertFalse(capabilities.isEnabled("unknownCapability"))
    }

    @Test
    fun malformedInputDisablesEveryCapability() {
        for (rawJson in listOf(
            "",
            "[]",
            "{\"embeddings\":\"true\"}",
            "{\"embeddings\":true,}",
            "{\"embeddings\":true,\"embeddings\":false}",
            "{\"embeddings\":true} trailing",
        )) {
            val capabilities = CourseCapabilities.fromJson(rawJson)
            assertFalse("malformed input must disable embeddings: $rawJson", capabilities.isEnabled("embeddings"))
            assertFalse("malformed input must disable dictionary: $rawJson", capabilities.isEnabled("dictionary"))
            assertFalse("malformed input must disable speech: $rawJson", capabilities.isEnabled("speech"))
        }
    }

    @Test
    fun disabledCapabilityDoesNotInvokeNativeManagerFactory() {
        var constructions = 0
        val capabilities = CourseCapabilities.fromJson(
            """{"embeddings":false,"dictionary":false,"speech":false}""",
        )

        val vectorManager = capabilities.createIfEnabled("embeddings") { constructions += 1; Any() }
        val dictionaryManager = capabilities.createIfEnabled("dictionary") { constructions += 1; Any() }
        val speechManager = capabilities.createIfEnabled("speech") { constructions += 1; Any() }

        assertNull(vectorManager)
        assertNull(dictionaryManager)
        assertNull(speechManager)
        assertEquals(0, constructions)
    }

    @Test
    fun malformedCapabilityJsonDoesNotInvokeNativeManagerFactory() {
        var constructions = 0
        val capabilities = CourseCapabilities.fromJson("not-json")

        val manager = capabilities.createIfEnabled("embeddings") { constructions += 1; Any() }

        assertNull(manager)
        assertEquals(0, constructions)
    }

    @Test
    fun enabledCapabilityInvokesNativeManagerFactoryOnce() {
        var constructions = 0
        val capabilities = CourseCapabilities.fromJson("""{"embeddings":true}""")

        val manager = capabilities.createIfEnabled("embeddings") { constructions += 1; Any() }

        assertTrue(manager != null)
        assertEquals(1, constructions)
    }
}
