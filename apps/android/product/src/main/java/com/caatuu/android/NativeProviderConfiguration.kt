package com.caatuu.android

data class NativeCatalogProvider(
    val implementation: String,
    val catalogAsset: String,
)

data class NativeSpeechProvider(
    val implementation: String,
    val locale: String,
)

/**
 * Resolved, build-generated view of the versioned Android provider contract.
 *
 * Provider declarations originate in the selected course's Android asset
 * manifest. Gradle resolves resource names to packaged asset paths before
 * generating BuildConfig. Empty or partially generated declarations are
 * rejected so an enabled capability can never silently select a legacy path.
 */
class NativeProviderConfiguration private constructor(
    val embeddings: NativeCatalogProvider?,
    val dictionary: NativeCatalogProvider?,
    val speech: NativeSpeechProvider?,
) {
    fun requireMatches(capabilities: CourseCapabilities, courseSpeechLocale: String) {
        check(capabilities.isEnabled("embeddings") == (embeddings != null)) {
            "Embedding provider does not match the course capability boundary."
        }
        check(capabilities.isEnabled("dictionary") == (dictionary != null)) {
            "Dictionary provider does not match the course capability boundary."
        }
        check(capabilities.isEnabled("speech") == (speech != null)) {
            "Speech provider does not match the course capability boundary."
        }
        speech?.let { provider ->
            check(provider.locale == courseSpeechLocale) {
                "Speech provider locale does not match the course manifest."
            }
        }
    }

    companion object {
        const val SCHEMA_VERSION = 1
        const val EMBEDDING_IMPLEMENTATION = "vector-database-catalog-v1"
        const val DICTIONARY_IMPLEMENTATION = "sqlite-dictionary-catalog-v1"
        const val SPEECH_IMPLEMENTATION = "android-text-to-speech-v1"

        fun fromGenerated(
            schemaVersion: Int,
            embeddingImplementation: String,
            embeddingCatalogAsset: String,
            dictionaryImplementation: String,
            dictionaryCatalogAsset: String,
            speechImplementation: String,
            speechLocale: String,
        ): NativeProviderConfiguration {
            check(schemaVersion == SCHEMA_VERSION) {
                "Unsupported Android native provider schemaVersion $schemaVersion."
            }
            return NativeProviderConfiguration(
                embeddings = catalogProvider(
                    capability = "embeddings",
                    implementation = embeddingImplementation,
                    catalogAsset = embeddingCatalogAsset,
                    expectedImplementation = EMBEDDING_IMPLEMENTATION,
                ),
                dictionary = catalogProvider(
                    capability = "dictionary",
                    implementation = dictionaryImplementation,
                    catalogAsset = dictionaryCatalogAsset,
                    expectedImplementation = DICTIONARY_IMPLEMENTATION,
                ),
                speech = speechProvider(speechImplementation, speechLocale),
            )
        }

        private fun catalogProvider(
            capability: String,
            implementation: String,
            catalogAsset: String,
            expectedImplementation: String,
        ): NativeCatalogProvider? {
            val normalizedImplementation = implementation.trim()
            val normalizedCatalog = catalogAsset.trim()
            if (normalizedImplementation.isEmpty() && normalizedCatalog.isEmpty()) return null
            check(normalizedImplementation == expectedImplementation) {
                "Unsupported $capability provider implementation."
            }
            check(normalizedCatalog == catalogAsset && isSafeAssetPath(normalizedCatalog)) {
                "$capability provider catalog asset is unsafe."
            }
            return NativeCatalogProvider(normalizedImplementation, normalizedCatalog)
        }

        private fun speechProvider(implementation: String, locale: String): NativeSpeechProvider? {
            val normalizedImplementation = implementation.trim()
            val normalizedLocale = locale.trim()
            if (normalizedImplementation.isEmpty() && normalizedLocale.isEmpty()) return null
            check(normalizedImplementation == SPEECH_IMPLEMENTATION) {
                "Unsupported speech provider implementation."
            }
            check(normalizedLocale.isNotEmpty() && normalizedLocale == locale) {
                "Speech provider locale is invalid."
            }
            return NativeSpeechProvider(normalizedImplementation, normalizedLocale)
        }

        private fun isSafeAssetPath(value: String): Boolean =
            value.isNotEmpty() &&
                !value.startsWith('/') &&
                !value.contains('\\') &&
                value.split('/').all { segment ->
                    segment.isNotEmpty() && segment != "." && segment != ".."
                }
    }
}
