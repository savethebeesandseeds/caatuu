package com.caatuu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BundledCourseRegistryTest {
    @Test
    fun resolvesBothCoursesThroughOneRootEntryAndNamespacedAssets() {
        val registry = BundledCourseRegistry.fromJson(BUNDLE_JSON)

        assertEquals("cz", registry.defaultCourseId)
        assertEquals("https://caatuu.local/cz/index.html", registry.startUrl)
        assertTrue(registry.isBundled("cz"))
        assertTrue(registry.isBundled("zh"))
        assertFalse(registry.isBundled("sk"))

        assertEquals("index.html", registry.resolveAsset("/cz/index.html")?.assetPath)
        assertEquals("index.html", registry.resolveAsset("/zh/index.html")?.assetPath)
        assertEquals(
            "courses/cz/source/shared/course-profile.js",
            registry.resolveAsset("/cz/source/shared/course-profile.js")?.assetPath,
        )
        assertEquals(
            "courses/zh/data/embeddings/catalog.json",
            registry.resolveAsset("/zh/data/embeddings/catalog.json")?.assetPath,
        )
        assertEquals(
            "language-runtime/static/source/app-bootstrap.mjs",
            registry.resolveAsset("/language-runtime/static/source/app-bootstrap.mjs")?.assetPath,
        )
        assertEquals(
            "assets/icons/china_flag.png",
            registry.resolveAsset("/assets/icons/china_flag.png")?.assetPath,
        )
    }

    @Test
    fun rejectsUnknownUnsafeAndUntrustedRoutes() {
        val registry = BundledCourseRegistry.fromJson(BUNDLE_JSON)

        assertNull(registry.resolveAsset("/sk/index.html"))
        assertNull(registry.resolveAsset("/zh/../cz/source/shared/course-profile.js"))
        assertNull(registry.resolveAsset("/zh//source/shared/course-profile.js"))
        assertNull(registry.courseForTrustedUrl("https://example.com/zh/index.html"))
        assertNull(registry.courseForTrustedUrl("http://caatuu.local/zh/index.html"))
        assertEquals("zh", registry.courseForTrustedUrl("https://caatuu.local/zh/index.html?game=word-net")?.id)
    }

    @Test
    fun preservesCourseSpecificCapabilityAndProviderBoundaries() {
        val registry = BundledCourseRegistry.fromJson(BUNDLE_JSON)
        val czech = requireNotNull(registry.course("cz"))
        val mandarin = requireNotNull(registry.course("zh"))

        assertTrue(czech.capabilities.isEnabled("dictionary"))
        assertFalse(mandarin.capabilities.isEnabled("dictionary"))
        assertEquals(
            "courses/cz/data/embeddings/models.json",
            czech.nativeProviders.embeddings?.catalogAsset,
        )
        assertEquals(
            "webview-english-minilm-v1",
            mandarin.nativeProviders.embeddings?.implementation,
        )
        assertEquals("cs-CZ", czech.nativeProviders.speech?.locale)
        assertEquals("zh-CN", mandarin.nativeProviders.speech?.locale)
    }

    @Test
    fun rejectsCapabilityProviderMismatchAndDuplicateRoutes() {
        val missingMandarinSpeech = BUNDLE_JSON.replace(
            "\"speech\":true",
            "\"speech\":false",
        )
        assertThrows(IllegalStateException::class.java) {
            BundledCourseRegistry.fromJson(missingMandarinSpeech)
        }

        val duplicateRoute = BUNDLE_JSON.replace(
            "\"routePrefix\":\"/zh\"",
            "\"routePrefix\":\"/cz\"",
        )
        assertThrows(IllegalStateException::class.java) {
            BundledCourseRegistry.fromJson(duplicateRoute)
        }
    }

    private companion object {
        val BUNDLE_JSON = """
            {
              "schemaVersion":1,
              "defaultCourseId":"cz",
              "courses":[
                {
                  "id":"cz",
                  "routePrefix":"/cz",
                  "entryPath":"/cz/index.html",
                  "assetPrefix":"courses/cz",
                  "sourceLanguage":{"id":"en","label":"English","locale":"en"},
                  "targetLanguage":{"id":"cs","label":"Czech","locale":"cs-CZ","speechLocale":"cs-CZ"},
                  "capabilities":{"embeddings":true,"dictionary":true,"speech":true,"wordWorld":true},
                  "nativeProviders":{"schemaVersion":1,"providers":{
                    "embeddings":{"implementation":"vector-database-catalog-v1","catalogAsset":"courses/cz/data/embeddings/models.json"},
                    "dictionary":{"implementation":"sqlite-dictionary-catalog-v1","catalogAsset":"courses/cz/data/dictionaries/catalog.json"},
                    "speech":{"implementation":"android-text-to-speech-v1","locale":"cs-CZ"}
                  }}
                },
                {
                  "id":"zh",
                  "routePrefix":"/zh",
                  "entryPath":"/zh/index.html",
                  "assetPrefix":"courses/zh",
                  "sourceLanguage":{"id":"en","label":"English","locale":"en"},
                  "targetLanguage":{"id":"zh","label":"Mandarin","locale":"zh-Hans","speechLocale":"zh-CN"},
                  "capabilities":{"embeddings":true,"dictionary":false,"speech":true,"wordWorld":true},
                  "nativeProviders":{"schemaVersion":1,"providers":{
                    "embeddings":{"implementation":"webview-english-minilm-v1","catalogAsset":"courses/zh/data/embeddings/catalog.json"},
                    "speech":{"implementation":"android-text-to-speech-v1","locale":"zh-CN"}
                  }}
                }
              ]
            }
        """.trimIndent()
    }
}
