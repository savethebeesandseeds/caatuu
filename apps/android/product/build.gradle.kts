import java.io.File

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.jetbrains.kotlin.android)
}

val distributionProfile = providers.gradleProperty("caatuuDistributionProfile").orElse("full")
val workspaceRootDir = layout.projectDirectory.dir("../../..")
val workspaceRootPath = workspaceRootDir.asFile.toPath().toRealPath()

fun confinedWorkspaceRelativePath(value: Any?, label: String): String {
    val relativePath = value?.toString()?.trim().orEmpty()
    check(relativePath.isNotEmpty()) { "$label must be a nonblank repository-relative path." }
    check(!File(relativePath).isAbsolute) { "$label must be repository-relative." }
    val candidate = workspaceRootPath.resolve(relativePath).normalize()
    check(candidate != workspaceRootPath && candidate.startsWith(workspaceRootPath)) {
        "$label must stay inside the Caatuu workspace."
    }
    check(candidate.toFile().exists()) { "$label does not exist: $candidate" }
    val realCandidate = candidate.toRealPath()
    check(realCandidate != workspaceRootPath && realCandidate.startsWith(workspaceRootPath)) {
        "$label must not escape the Caatuu workspace through a link."
    }
    return workspaceRootPath.relativize(realCandidate).toString().replace(File.separatorChar, '/')
}

fun requiredObject(value: Any?, label: String): Map<*, *> {
    check(value is Map<*, *>) { "$label must be a JSON object." }
    return value
}

fun requiredString(value: Any?, label: String): String {
    val result = value?.toString()?.trim().orEmpty()
    check(result.isNotEmpty()) { "$label must be a nonblank string." }
    return result
}

fun normalizedAssetPath(value: Any?, label: String): String {
    val path = requiredString(value, label)
    check(!File(path).isAbsolute && !path.contains('\\') && path.split('/').all { it.isNotEmpty() && it != "." && it != ".." }) {
        "$label must be a normalized relative path."
    }
    return path
}

val courseManifestRelativePath = confinedWorkspaceRelativePath(
    providers.gradleProperty("caatuuCourseManifest")
        .orElse("apps/languages/czech/course.json")
        .get(),
    "caatuuCourseManifest",
)
val courseManifestFile = workspaceRootDir.file(courseManifestRelativePath)
val courseManifest = requiredObject(
    groovy.json.JsonSlurper().parse(courseManifestFile.asFile),
    "course manifest",
)
check(courseManifest["schemaVersion"] == 1) { "Course manifest schemaVersion must be 1." }
val bundledLanguageId = requiredString(courseManifest["id"], "course id")
val bundledLanguageRoutePrefix = requiredString(courseManifest["routePrefix"], "course routePrefix")
val bundledLanguageEntryPath = requiredString(courseManifest["entryPath"], "course entryPath")
check(Regex("^/[a-z0-9]+(?:-[a-z0-9]+)*$").matches(bundledLanguageRoutePrefix)) {
    "Course routePrefix is invalid: $bundledLanguageRoutePrefix"
}
check(bundledLanguageEntryPath.startsWith("$bundledLanguageRoutePrefix/")) {
    "Course entryPath must stay inside routePrefix."
}
val courseSourceLanguage = requiredObject(courseManifest["sourceLanguage"], "sourceLanguage")
check(courseSourceLanguage["id"] == "en") {
    "Android semantic mediation currently requires English as sourceLanguage.id."
}
val courseSourceLanguageLabel = requiredString(courseSourceLanguage["label"], "sourceLanguage.label")
val courseTargetLanguage = requiredObject(courseManifest["targetLanguage"], "targetLanguage")
val courseTargetLanguageLabel = requiredString(courseTargetLanguage["label"], "targetLanguage.label")
val courseTargetLanguageLocale = requiredString(courseTargetLanguage["locale"], "targetLanguage.locale")
val courseSpeechLocale = requiredString(courseTargetLanguage["speechLocale"], "targetLanguage.speechLocale")
for ((label, locale) in listOf(
    "targetLanguage.locale" to courseTargetLanguageLocale,
    "targetLanguage.speechLocale" to courseSpeechLocale,
)) {
    check(Regex("^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$").matches(locale)) {
        "$label must be a normalized BCP 47 language tag."
    }
}
val coursePlatforms = requiredObject(courseManifest["platforms"], "course platforms")
val courseAndroidPlatform = requiredObject(coursePlatforms["android"], "course Android platform")
check(courseAndroidPlatform["enabled"] == true) { "Course $bundledLanguageId is not enabled for Android." }
val courseCapabilities = requiredObject(courseManifest["capabilities"], "course capabilities")
fun courseCapability(name: String): Boolean {
    val value = courseCapabilities[name]
    check(value is Boolean) { "Course capability $name must be boolean." }
    return value
}
val courseLlmEnabled = courseCapability("llm")
val courseGenerationEnabled = courseCapability("generation")
val courseChatEnabled = courseCapability("chat")
val courseEmbeddingsEnabled = courseCapability("embeddings")
val courseSemanticSearchEnabled = courseCapability("semanticSearch")
val courseDictionaryEnabled = courseCapability("dictionary")
val courseMemoryEnabled = courseCapability("memory")
val courseWordWorldEnabled = courseCapability("wordWorld")
val courseVerbsEnabled = courseCapability("verbs")
val courseConjugationCometEnabled = courseCapability("conjugationComet")
val courseOfflineModelsEnabled = courseCapability("offlineModels")
val courseSpeechEnabled = courseCapability("speech")
val coursePronunciationGuidesEnabled = courseCapability("pronunciationGuides")
check(!courseGenerationEnabled || courseLlmEnabled) { "generation requires llm." }
check(!courseChatEnabled || courseLlmEnabled) { "chat requires llm." }
check(!courseOfflineModelsEnabled || courseLlmEnabled) { "offlineModels requires llm." }
check(!courseSemanticSearchEnabled || courseEmbeddingsEnabled) { "semanticSearch requires embeddings." }
val courseResources = requiredObject(courseManifest["resources"], "course resources")
fun courseResourcePath(name: String, expectedKind: String): String {
    val resource = requiredObject(courseResources[name], "course resource $name")
    check(resource["kind"] == expectedKind) { "Course resource $name must be a $expectedKind." }
    check(resource["state"] == "present") { "Course resource $name must be present for Android." }
    return confinedWorkspaceRelativePath(resource["path"], "course resource $name")
}
val canonicalAppEntryRelativePath = "apps/language-runtime/static/app/index.html"
val appEntryRelativePath = courseResourcePath("appEntry", "file")
check(appEntryRelativePath == canonicalAppEntryRelativePath) {
    "Course appEntry must be $canonicalAppEntryRelativePath."
}
val appEntryFile = workspaceRootDir.file(appEntryRelativePath)
val appAssetCatalogRelativePath = confinedWorkspaceRelativePath(
    "apps/language-runtime/app-assets.json",
    "shared app asset catalog",
)
val appAssetCatalogFile = workspaceRootDir.file(appAssetCatalogRelativePath)
val appAssetCatalog = requiredObject(
    groovy.json.JsonSlurper().parse(appAssetCatalogFile.asFile),
    "shared app asset catalog",
)
check(appAssetCatalog.keys.map { it.toString() }.toSet() == setOf("schemaVersion", "appEntry", "assets")) {
    "Shared app asset catalog must contain exactly schemaVersion, appEntry, and assets."
}
check(appAssetCatalog["schemaVersion"] == 1) { "Shared app asset catalog schemaVersion must be 1." }
check(appAssetCatalog["appEntry"] == canonicalAppEntryRelativePath) {
    "Shared app asset catalog appEntry must be $canonicalAppEntryRelativePath."
}
val sharedAppAssets = (appAssetCatalog["assets"] as? List<*>)?.mapIndexed { index, value ->
    val mapping = requiredObject(value, "shared app asset $index")
    check(mapping.keys.map { it.toString() }.toSet() == setOf("source", "output")) {
        "Shared app asset $index must contain exactly source and output."
    }
    val source = confinedWorkspaceRelativePath(mapping["source"], "shared app asset $index source")
    val output = normalizedAssetPath(mapping["output"], "shared app asset $index output")
    check(output != "index.html" && output != "caatuu-profile.json") {
        "Shared app asset $index cannot replace a reserved Android asset."
    }
    source to output
} ?: error("Shared app asset catalog assets must be an array.")
check(sharedAppAssets.isNotEmpty() && sharedAppAssets.map { it.second }.toSet().size == sharedAppAssets.size) {
    "Shared app asset outputs must be nonempty and unique."
}
val languageStaticRelativePath = courseResourcePath("staticRoot", "directory")
val languageStaticDir = workspaceRootDir.dir(languageStaticRelativePath)
val androidAssetCatalogRelativePath = courseResourcePath("androidAssetCatalog", "file")
val androidAssetCatalogFile = workspaceRootDir.file(androidAssetCatalogRelativePath)
val androidAssetCatalog = requiredObject(
    groovy.json.JsonSlurper().parse(androidAssetCatalogFile.asFile),
    "Android asset catalog",
)
check(androidAssetCatalog["schemaVersion"] == 1) { "Android asset catalog schemaVersion must be 1." }
check(androidAssetCatalog["courseId"] == bundledLanguageId) {
    "Android asset catalog courseId must match the course manifest."
}
fun normalizedCatalogPaths(value: Any?, label: String): List<String> {
    val values = value as? List<*> ?: error("$label must be an array.")
    val paths = values.mapIndexed { index, item ->
        normalizedAssetPath(item, "$label entry $index")
    }
    check(paths.toSet().size == paths.size) { "$label entries must be unique." }
    return paths
}
val androidAssetFiles = normalizedCatalogPaths(androidAssetCatalog["files"], "Android asset files")
check(androidAssetFiles.isNotEmpty()) { "Android asset files must not be empty." }
check("index.html" !in androidAssetFiles) {
    "Android course assets must not declare a course-local index.html."
}
val androidLauncherIconFiles = normalizedCatalogPaths(androidAssetCatalog["launcherIconFiles"], "Android launcher icon files")
fun exactObjectKeys(value: Map<*, *>, expected: Set<String>, label: String) {
    val actual = value.keys.map { key ->
        check(key is String) { "$label keys must be strings." }
        key
    }.toSet()
    check(actual == expected) {
        "$label must contain exactly ${expected.sorted().joinToString(", ")}."
    }
}
val nativeProviderContract = requiredObject(
    androidAssetCatalog["nativeProviders"],
    "Android native provider contract",
)
exactObjectKeys(nativeProviderContract, setOf("schemaVersion", "providers"), "Android native provider contract")
check(nativeProviderContract["schemaVersion"] == 1) {
    "Android native provider contract schemaVersion must be 1."
}
val nativeProviderDeclarations = requiredObject(
    nativeProviderContract["providers"],
    "Android native provider declarations",
)
val expectedNativeProviderNames = buildSet {
    if (courseEmbeddingsEnabled) add("embeddings")
    if (courseDictionaryEnabled) add("dictionary")
    if (courseSpeechEnabled) add("speech")
}
exactObjectKeys(
    nativeProviderDeclarations,
    expectedNativeProviderNames,
    "Android native provider declarations",
)

fun courseResourceAssetPath(name: String): String {
    val resourceRelativePath = courseResourcePath(name, "file")
    val staticRootPath = languageStaticDir.asFile.toPath().toRealPath()
    val resourcePath = workspaceRootPath.resolve(resourceRelativePath).normalize().toRealPath()
    check(resourcePath != staticRootPath && resourcePath.startsWith(staticRootPath)) {
        "Course resource $name must be a file inside staticRoot."
    }
    val assetPath = staticRootPath.relativize(resourcePath).toString().replace(File.separatorChar, '/')
    check(assetPath in androidAssetFiles) {
        "Android asset catalog must package resources.$name as $assetPath."
    }
    return assetPath
}

fun catalogProvider(
    name: String,
    implementation: String,
    resourceName: String,
): Pair<String, String> {
    val declaration = requiredObject(nativeProviderDeclarations[name], "Android native provider $name")
    exactObjectKeys(declaration, setOf("implementation", "resource"), "Android native provider $name")
    check(declaration["implementation"] == implementation) {
        "Android native provider $name implementation is unsupported."
    }
    check(declaration["resource"] == resourceName) {
        "Android native provider $name must reference resources.$resourceName."
    }
    return implementation to courseResourceAssetPath(resourceName)
}

val embeddingNativeProvider = if (courseEmbeddingsEnabled) {
    catalogProvider("embeddings", "vector-database-catalog-v1", "embeddingCatalog")
} else {
    "" to ""
}
val dictionaryNativeProvider = if (courseDictionaryEnabled) {
    catalogProvider("dictionary", "sqlite-dictionary-catalog-v1", "dictionaryCatalog")
} else {
    "" to ""
}
val speechNativeProvider = if (courseSpeechEnabled) {
    val declaration = requiredObject(nativeProviderDeclarations["speech"], "Android native provider speech")
    exactObjectKeys(declaration, setOf("implementation", "localeSource"), "Android native provider speech")
    check(declaration["implementation"] == "android-text-to-speech-v1") {
        "Android native provider speech implementation is unsupported."
    }
    check(declaration["localeSource"] == "targetLanguage.speechLocale") {
        "Android native provider speech locale source is unsupported."
    }
    "android-text-to-speech-v1" to courseSpeechLocale
} else {
    "" to ""
}
val declaredSharedRuntimeFiles = when (val value = androidAssetCatalog["sharedRuntimeFiles"]) {
    null -> emptyList()
    is List<*> -> value.mapIndexed { index, item -> requiredString(item, "Android shared runtime file $index") }
    else -> error("Android asset catalog sharedRuntimeFiles must be an array when present.")
}
val sharedRuntimeFiles = (listOf("contract.mjs") + declaredSharedRuntimeFiles).distinct()
for (path in sharedRuntimeFiles) {
    check(!File(path).isAbsolute && !path.contains('\\') && path.split('/').all { it.isNotEmpty() && it != "." && it != ".." }) {
        "Android shared runtime file must be a normalized relative path: $path"
    }
    check(!Regex("(?:^|/)(?:README(?:\\.[^/]*)?|tests?)(?:/|$)", RegexOption.IGNORE_CASE).containsMatchIn(path)) {
        "Android shared runtime file is not packageable: $path"
    }
    confinedWorkspaceRelativePath("apps/language-runtime/$path", "Android shared runtime file $path")
}
val launcherStaticDir = workspaceRootDir.dir("apps/launcher/static")
val assetCompiler = workspaceRootDir.file("apps/android/tooling/build-product-assets.mjs")
val generatedAssetsDir = layout.buildDirectory.dir("generated/assets/product")
val productIconRelativePath = androidAssetFiles.singleOrNull { Regex("^icons/[A-Za-z0-9._-]+-512\\.png$").matches(it) }
    ?: error("Android asset catalog must contain exactly one icons/*-512.png product icon.")
val productIconSource = languageStaticDir.file(productIconRelativePath)
val generatedProductIconResDir = layout.buildDirectory.dir("generated/res/product-icon")
val releaseKeystorePath = providers.environmentVariable("CAATUU_ANDROID_KEYSTORE")
val releaseKeystorePassword = providers.environmentVariable("CAATUU_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = providers.environmentVariable("CAATUU_ANDROID_KEY_ALIAS")
val releaseKeyPassword = providers.environmentVariable("CAATUU_ANDROID_KEY_PASSWORD")
val androidMinSdk = providers.environmentVariable("CAATUU_ANDROID_MIN_SDK")
    .map(String::toInt)
    .orElse(30)
val androidTargetSdk = providers.environmentVariable("CAATUU_ANDROID_TARGET_SDK")
    .map(String::toInt)
    .orElse(36)
val androidUpdateBaseUrl = providers.environmentVariable("CAATUU_ANDROID_UPDATE_BASE_URL")
    .orElse("https://caatuu.waajacu.com/android")
val caatuuVersionCode = providers.gradleProperty("caatuuVersionCode").map(String::toInt).orElse(160)
val caatuuVersionName = providers.gradleProperty("caatuuVersionName").orElse("0.1.8")
val releaseSigningValues = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).map { provider -> provider.orNull?.isNotBlank() == true }
val hasReleaseSigning = releaseSigningValues.all { it }
val hasPartialReleaseSigning = releaseSigningValues.any { it } && !hasReleaseSigning

check(distributionProfile.get() == "product") {
    "The :product module must be configured with -PcaatuuDistributionProfile=product."
}
check(!hasPartialReleaseSigning) {
    "Caatuu product signing requires all four CAATUU_ANDROID_KEYSTORE, " +
        "CAATUU_ANDROID_KEYSTORE_PASSWORD, CAATUU_ANDROID_KEY_ALIAS, and " +
        "CAATUU_ANDROID_KEY_PASSWORD values, or none for an explicitly unsigned milestone build."
}

fun buildConfigString(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

val packagedCourseCapabilities = linkedMapOf(
    "chat" to false,
    "llm" to false,
    "generation" to false,
    "godot" to false,
    "embeddings" to courseEmbeddingsEnabled,
    "semanticSearch" to courseSemanticSearchEnabled,
    "imageLookup" to courseWordWorldEnabled,
    "stats" to courseMemoryEnabled,
    "dictionary" to courseDictionaryEnabled,
    "memory" to courseMemoryEnabled,
    "verbs" to courseVerbsEnabled,
    "wordWorld" to courseWordWorldEnabled,
    "conjugationComet" to courseConjugationCometEnabled,
    "offlineModels" to false,
    "speech" to courseSpeechEnabled,
    "pronunciationGuides" to coursePronunciationGuidesEnabled,
    "wordWorldStandardOnly" to courseWordWorldEnabled,
)

val generateProductAssets by tasks.registering(Exec::class) {
    group = "build setup"
    description = "Compile the allowlisted, non-generative Caatuu product assets."
    workingDir(workspaceRootDir)
    commandLine(
        "node",
        assetCompiler.asFile.absolutePath,
        "--course-manifest",
        courseManifestFile.asFile.absolutePath,
        "--launcher",
        launcherStaticDir.asFile.absolutePath,
        "--output",
        generatedAssetsDir.get().asFile.absolutePath,
    )
    inputs.file(assetCompiler)
    inputs.file(courseManifestFile)
    inputs.file(appEntryFile)
    inputs.file(appAssetCatalogFile)
    inputs.file(androidAssetCatalogFile)
    inputs.property("androidAssetFiles", androidAssetFiles)
    inputs.property("androidLauncherIconFiles", androidLauncherIconFiles)
    inputs.files(sharedRuntimeFiles.map { path -> workspaceRootDir.file("apps/language-runtime/$path") })
    inputs.property("sharedRuntimeFiles", sharedRuntimeFiles)
    inputs.files(sharedAppAssets.map { (source, _) -> workspaceRootDir.file(source) })
    inputs.property("sharedAppAssets", sharedAppAssets.map { (source, output) -> "$source=>$output" })
    inputs.property("embeddingNativeProvider", embeddingNativeProvider)
    inputs.property("dictionaryNativeProvider", dictionaryNativeProvider)
    inputs.property("speechNativeProvider", speechNativeProvider)
    inputs.dir(languageStaticDir)
    inputs.dir(launcherStaticDir)
    outputs.dir(generatedAssetsDir)
}

val generateProductIconResources by tasks.registering(Sync::class) {
    group = "build setup"
    description = "Package the canonical Caatuu bird as the Android application icon."
    from(productIconSource) {
        into("drawable-nodpi")
        rename { "caatuu_app_icon.png" }
    }
    into(generatedProductIconResDir)
    inputs.file(productIconSource)
    outputs.dir(generatedProductIconResDir)
}

android {
    namespace = "com.caatuu.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.waajacu.caatuu"
        minSdk = androidMinSdk.get()
        targetSdk = androidTargetSdk.get()
        versionCode = caatuuVersionCode.get()
        versionName = caatuuVersionName.get()
        buildConfigField("String", "CAATUU_DISTRIBUTION_PROFILE", buildConfigString("product"))
        buildConfigField("String", "CAATUU_LANGUAGE_ID", buildConfigString(bundledLanguageId))
        buildConfigField("String", "CAATUU_LANGUAGE_ROUTE_PREFIX", buildConfigString(bundledLanguageRoutePrefix))
        buildConfigField("String", "CAATUU_LANGUAGE_ENTRY_PATH", buildConfigString(bundledLanguageEntryPath))
        buildConfigField("String", "CAATUU_SOURCE_LANGUAGE_LABEL", buildConfigString(courseSourceLanguageLabel))
        buildConfigField("String", "CAATUU_TARGET_LANGUAGE_LABEL", buildConfigString(courseTargetLanguageLabel))
        buildConfigField("String", "CAATUU_TARGET_LANGUAGE_LOCALE", buildConfigString(courseTargetLanguageLocale))
        buildConfigField("String", "CAATUU_SPEECH_LOCALE", buildConfigString(courseSpeechLocale))
        buildConfigField("String", "CAATUU_COURSE_CAPABILITIES_JSON", buildConfigString(groovy.json.JsonOutput.toJson(packagedCourseCapabilities)))
        buildConfigField("int", "CAATUU_NATIVE_PROVIDER_SCHEMA_VERSION", "1")
        buildConfigField("String", "CAATUU_EMBEDDING_PROVIDER", buildConfigString(embeddingNativeProvider.first))
        buildConfigField("String", "CAATUU_EMBEDDING_CATALOG_ASSET", buildConfigString(embeddingNativeProvider.second))
        buildConfigField("String", "CAATUU_DICTIONARY_PROVIDER", buildConfigString(dictionaryNativeProvider.first))
        buildConfigField("String", "CAATUU_DICTIONARY_CATALOG_ASSET", buildConfigString(dictionaryNativeProvider.second))
        buildConfigField("String", "CAATUU_SPEECH_PROVIDER", buildConfigString(speechNativeProvider.first))
        buildConfigField("String", "CAATUU_SPEECH_PROVIDER_LOCALE", buildConfigString(speechNativeProvider.second))
        buildConfigField("boolean", "CAATUU_GENERATIVE_ENABLED", "false")
        buildConfigField("boolean", "CAATUU_EMBEDDINGS_ENABLED", courseEmbeddingsEnabled.toString())
        buildConfigField("boolean", "CAATUU_DICTIONARY_ENABLED", courseDictionaryEnabled.toString())
        buildConfigField("boolean", "CAATUU_GODOT_ENABLED", "false")
        buildConfigField("boolean", "CAATUU_SELF_UPDATE_ENABLED", "true")
        buildConfigField("boolean", "CAATUU_ACCEPT_RELEASE_MIGRATION", "false")
        buildConfigField("String", "CAATUU_UPDATE_BASE_URL", buildConfigString(androidUpdateBaseUrl.get()))
        buildConfigField("String", "CAATUU_UPDATE_APK_NAME", buildConfigString("caatuu.apk"))
        buildConfigField("String", "CAATUU_UPDATE_MANIFEST_NAME", buildConfigString("caatuu.json"))
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseKeystorePath.get())
                storePassword = releaseKeystorePassword.get()
                keyAlias = releaseKeyAlias.get()
                keyPassword = releaseKeyPassword.get()
            }
        }
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(generatedAssetsDir)
            res.srcDir(generatedProductIconResDir)
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            buildConfigField("boolean", "CAATUU_ACCEPT_RELEASE_MIGRATION", "true")
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin {
        jvmToolchain(17)
        sourceSets.getByName("main").kotlin.apply {
            srcDir("../app/src/main/java")
            exclude(
                "com/caatuu/android/CaatuuBridge.kt",
                "com/caatuu/android/MainActivity.kt",
                "com/caatuu/android/ModelManager.kt",
                "com/caatuu/android/NativeCzechModel.kt",
            )
        }
    }
}

tasks.named("preBuild").configure {
    dependsOn(generateProductAssets, generateProductIconResources)
}

dependencies {
    implementation(libs.androidx.activity)
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    testImplementation(libs.junit)
}
