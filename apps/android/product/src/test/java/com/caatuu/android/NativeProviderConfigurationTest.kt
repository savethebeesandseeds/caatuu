package com.caatuu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeProviderConfigurationTest {
    @Test
    fun resolvesNonCzechCatalogPathsWithoutDefaults() {
        val configuration = NativeProviderConfiguration.fromGenerated(
            schemaVersion = 1,
            embeddingImplementation = "vector-database-catalog-v1",
            embeddingCatalogAsset = "native/semantic/catalog.json",
            dictionaryImplementation = "",
            dictionaryCatalogAsset = "",
            speechImplementation = "",
            speechLocale = "",
        )

        assertEquals("native/semantic/catalog.json", configuration.embeddings?.catalogAsset)
        assertNull(configuration.webViewEmbeddings)
        assertNull(configuration.dictionary)
        assertNull(configuration.speech)
        configuration.requireMatches(
            CourseCapabilities.fromJson("""{"embeddings":true,"dictionary":false,"speech":false}"""),
            "xx-Test",
        )
    }

    @Test
    fun keepsWebViewEmbeddingProviderOutOfTheNativeVectorManagerBoundary() {
        val configuration = NativeProviderConfiguration.fromBundled(
            BundledNativeProviders(
                schemaVersion = 1,
                embeddings = BundledCatalogProvider(
                    implementation = "webview-english-minilm-v1",
                    catalogAsset = "courses/zh/data/embeddings/catalog.json",
                ),
                speech = BundledSpeechProvider(
                    implementation = "android-text-to-speech-v1",
                    locale = "zh-CN",
                ),
            ),
        )

        assertNull(configuration.embeddings)
        assertEquals(
            "courses/zh/data/embeddings/catalog.json",
            configuration.webViewEmbeddings?.catalogAsset,
        )
        configuration.requireMatches(
            CourseCapabilities.fromJson("""{"embeddings":true,"dictionary":false,"speech":true}"""),
            "zh-CN",
        )
    }

    @Test
    fun rejectsMissingUnsafeOrUnsupportedProviderConfiguration() {
        for (catalog in listOf("", "/absolute/catalog.json", "../catalog.json", "a\\catalog.json")) {
            assertThrows(IllegalStateException::class.java) {
                NativeProviderConfiguration.fromGenerated(
                    schemaVersion = 1,
                    embeddingImplementation = "vector-database-catalog-v1",
                    embeddingCatalogAsset = catalog,
                    dictionaryImplementation = "",
                    dictionaryCatalogAsset = "",
                    speechImplementation = "",
                    speechLocale = "",
                )
            }
        }
        assertThrows(IllegalStateException::class.java) {
            NativeProviderConfiguration.fromGenerated(
                schemaVersion = 2,
                embeddingImplementation = "vector-database-catalog-v1",
                embeddingCatalogAsset = "native/semantic/catalog.json",
                dictionaryImplementation = "",
                dictionaryCatalogAsset = "",
                speechImplementation = "",
                speechLocale = "",
            )
        }
    }

    @Test
    fun rejectsCapabilityAndSpeechLocaleMismatches() {
        val configuration = NativeProviderConfiguration.fromGenerated(
            schemaVersion = 1,
            embeddingImplementation = "",
            embeddingCatalogAsset = "",
            dictionaryImplementation = "",
            dictionaryCatalogAsset = "",
            speechImplementation = "android-text-to-speech-v1",
            speechLocale = "cs-CZ",
        )
        val capabilities = CourseCapabilities.fromJson(
            """{"embeddings":false,"dictionary":false,"speech":true}""",
        )
        assertThrows(IllegalStateException::class.java) {
            configuration.requireMatches(capabilities, "sk-SK")
        }
    }
}
