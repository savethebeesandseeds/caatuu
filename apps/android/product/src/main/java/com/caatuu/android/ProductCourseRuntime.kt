package com.caatuu.android

import java.io.File

/** Metadata is cheap to load; native services activate only for the selected course. */
class ProductCourseRuntime(
    val course: BundledCourse,
    val staticAssetManager: StaticAssetManager,
    private val receiptFile: File,
    vectorFactory: () -> VectorDatabaseManager?,
    dictionaryFactory: () -> DictionaryManager?,
    speechFactory: () -> AndroidSpeechManager?,
) {
    private val providers = NativeProviderConfiguration.fromBundled(course.nativeProviders)
    private val vectorService = lazy {
        vectorFactory().also { check((providers.embeddings != null) == (it != null)) }
    }
    private val dictionaryService = lazy {
        dictionaryFactory().also { check((providers.dictionary != null) == (it != null)) }
    }
    @Volatile private var resumed = false
    private val speechService = lazy {
        speechFactory().also {
            check((providers.speech != null) == (it != null))
            if (resumed) it?.onResume()
        }
    }
    val vectorDatabaseManager: VectorDatabaseManager? get() = vectorService.value
    val dictionaryManager: DictionaryManager? get() = dictionaryService.value
    val speechManager: AndroidSpeechManager? get() = speechService.value
    fun initializedVectorManager(): VectorDatabaseManager? = if (vectorService.isInitialized()) vectorService.value else null

    internal fun storageArtifacts(): List<NativeStorageArtifact> = buildList {
        addAll(staticAssetManager.storageArtifacts(course.id))
        addAll(vectorDatabaseManager?.storageArtifacts(course.id).orEmpty())
        addAll(dictionaryManager?.storageArtifacts(course.id).orEmpty())
    }

    fun hasInstallationReceipt(): Boolean = receiptFile.isFile

    private val installation = VerifiedCourseInstallation(
        receiptFile,
        identities = {
            storageArtifacts().map { "${it.storagePath}:${it.identityMarker}" }
        },
        artifactsReady = {
            staticAssetManager.isReady() &&
                (vectorDatabaseManager?.statusJson()?.optBoolean("verified") != false) &&
                (dictionaryManager?.statusJson()?.optBoolean("available") != false)
        },
    )

    init {
        providers.requireMatches(course.capabilities, course.targetLanguage.speechLocale)
    }

    fun isSetupReady(): Boolean = installation.isReady()
    fun isSetupCommitted(): Boolean = installation.isCommitted()
    fun adoptVerifiedSetup(): Boolean = installation.adoptVerifiedAssets()
    fun invalidateSetup() = installation.invalidate()

    fun onPause() {
        resumed = false
        if (speechService.isInitialized()) speechService.value?.onPause()
    }

    fun onResume() {
        resumed = true
        if (speechService.isInitialized()) speechService.value?.onResume()
    }

    fun destroy() {
        if (speechService.isInitialized()) speechService.value?.destroy()
        if (vectorService.isInitialized()) vectorService.value?.close()
    }
}
