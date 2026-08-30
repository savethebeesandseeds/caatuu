package com.caatuu.android

/** Native services scoped to one physically bundled Android course. */
data class ProductCourseRuntime(
    val course: BundledCourse,
    val vectorDatabaseManager: VectorDatabaseManager?,
    val dictionaryManager: DictionaryManager?,
    val staticAssetManager: StaticAssetManager,
    val speechManager: AndroidSpeechManager?,
) {
    init {
        val providers = NativeProviderConfiguration.fromBundled(course.nativeProviders)
        providers.requireMatches(course.capabilities, course.targetLanguage.speechLocale)
        check((providers.embeddings != null) == (vectorDatabaseManager != null)) {
            "Native embedding manager does not match the bundled course provider."
        }
        check((providers.dictionary != null) == (dictionaryManager != null)) {
            "Dictionary manager does not match the bundled course provider."
        }
        check((providers.speech != null) == (speechManager != null)) {
            "Speech manager does not match the bundled course provider."
        }
    }
}
