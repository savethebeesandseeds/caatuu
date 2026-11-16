package com.caatuu.android

import org.junit.Assert.*
import org.junit.Test

class FileSelectionRequestTest {
    @Test fun selectedDocumentCompletesExactlyOnce() {
        val results = mutableListOf<String?>()
        val request = FileSelectionRequest<String>()
        assertTrue(request.begin { results += it })
        request.finish("content://documents/backup")
        request.finish("unexpected")
        assertEquals(listOf("content://documents/backup"), results)
    }

    @Test fun concurrentRequestCannotStealAnEarlierPickerResult() {
        val first = mutableListOf<String?>()
        val second = mutableListOf<String?>()
        val request = FileSelectionRequest<String>()
        assertTrue(request.begin { first += it })
        assertFalse(request.begin { second += it })
        request.finish("first")
        assertEquals(listOf("first"), first)
        assertEquals(listOf<String?>(null), second)
    }

    @Test fun cancelAllowsRetryAndDestroyCancelsBeforeIgnoringLateResults() {
        val results = mutableListOf<String?>()
        val request = FileSelectionRequest<String>()
        assertTrue(request.begin { results += it })
        request.finish(null)
        assertTrue(request.begin { results += it })
        request.destroy()
        request.finish("late document")
        assertFalse(request.begin { results += it })
        assertEquals(listOf<String?>(null, null, null), results)
    }

    @Test fun recreatedActivityIgnoresAResultWithNoLiveWebViewCallback() {
        val request = FileSelectionRequest<String>()
        request.finish("result from destroyed activity")
        val results = mutableListOf<String?>()
        assertTrue(request.begin { results += it })
        assertTrue(results.isEmpty())
        request.finish("new document")
        assertEquals(listOf("new document"), results)
    }

    @Test fun onlyTheBundledHttpsOriginMayOpenThePicker() {
        assertTrue(FileSelectionPolicy.trustedPage("https://caatuu.local/cz/index.html"))
        assertTrue(FileSelectionPolicy.trustedPage("https://caatuu.local:443/he/index.html"))
        for (url in listOf(null, "", "http://caatuu.local/", "https://caatuu.local.evil/",
            "https://caatuu.local:8443/", "https://user@caatuu.local/", "file:///data/data/backup", "invalid uri")) {
            assertFalse(url, FileSelectionPolicy.trustedPage(url))
        }
    }

    @Test fun customBackupExtensionRemainsVisibleWithGenericProviderMimeTypes() {
        assertArrayEquals(arrayOf("*/*"), FileSelectionPolicy.acceptedMimeTypes(
            arrayOf(".caatuu", "application/vnd.caatuu.progress+json")))
        assertArrayEquals(arrayOf("application/json", "text/plain"), FileSelectionPolicy.acceptedMimeTypes(
            arrayOf("application/json,text/plain", "application/json")))
        assertArrayEquals(arrayOf("*/*"), FileSelectionPolicy.acceptedMimeTypes(
            arrayOf("application/vnd.caatuu.progress+json")))
        assertArrayEquals(arrayOf("*/*"), FileSelectionPolicy.acceptedMimeTypes(emptyArray()))
    }

    @Test fun documentsRequireAnExplicitReadGrantAndCannotExposePrivateAppFiles() {
        val own = "com.caatuu.android.files"
        assertTrue(FileSelectionPolicy.allowedDocument("content", "documents", own, true))
        assertFalse(FileSelectionPolicy.allowedDocument("content", "documents", own, false))
        assertFalse(FileSelectionPolicy.allowedDocument("file", "documents", own, true))
        assertFalse(FileSelectionPolicy.allowedDocument("https", "documents", own, true))
        assertFalse(FileSelectionPolicy.allowedDocument("content", own, own, true))
        assertFalse(FileSelectionPolicy.allowedDocument("content", null, own, true))
    }
}
