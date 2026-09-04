import java.io.File
import java.net.URLDecoder

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.jetbrains.kotlin.android)
}

val workspaceRootDir = layout.projectDirectory.dir("../../..")
val workspaceRootPath = workspaceRootDir.asFile.toPath().toRealPath()

fun confinedWorkspaceRelativePath(value: Any?, label: String): String {
    val authoredPath = value?.toString().orEmpty()
    val relativePath = authoredPath.trim()
    check(relativePath.isNotEmpty()) { "$label must be a nonblank repository-relative path." }
    check(authoredPath == relativePath) { "$label must be a trimmed repository-relative path." }
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
    check(realCandidate == candidate) {
        "$label must resolve to its exact declared physical source."
    }
    return workspaceRootPath.relativize(candidate).toString().replace(File.separatorChar, '/')
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
check(
    bundledLanguageId == "cz" &&
        bundledLanguageRoutePrefix == "/cz" &&
        courseTargetLanguage["id"] == "cs" &&
        courseTargetLanguageLocale == "cs-CZ"
) {
    "The :app full native shell supports only the canonical Czech course identity; " +
        "use the capability-gated :product distribution for every other course."
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
val courseVerbsEnabled = courseCapability("verbs")
val courseWordWorldEnabled = courseCapability("wordWorld")
val courseConjugationCometEnabled = courseCapability("conjugationComet")
val courseOfflineModelsEnabled = courseCapability("offlineModels")
val courseSpeechEnabled = courseCapability("speech")
val coursePronunciationGuidesEnabled = courseCapability("pronunciationGuides")
check(!courseGenerationEnabled || courseLlmEnabled) { "generation requires llm." }
check(!courseChatEnabled || courseLlmEnabled) { "chat requires llm." }
check(!courseOfflineModelsEnabled || courseLlmEnabled) { "offlineModels requires llm." }
check(!courseSemanticSearchEnabled || courseEmbeddingsEnabled) { "semanticSearch requires embeddings." }
val disabledFullNativeCapabilities = linkedMapOf(
    "llm" to courseLlmEnabled,
    "generation" to courseGenerationEnabled,
    "chat" to courseChatEnabled,
    "embeddings" to courseEmbeddingsEnabled,
    "semanticSearch" to courseSemanticSearchEnabled,
    "dictionary" to courseDictionaryEnabled,
    "offlineModels" to courseOfflineModelsEnabled,
    "speech" to courseSpeechEnabled,
).filterValues { enabled -> !enabled }.keys
check(disabledFullNativeCapabilities.isEmpty()) {
    "The :app full Czech native shell requires ${disabledFullNativeCapabilities.joinToString()}; " +
        "use the capability-gated :product distribution for courses without these native features."
}
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
val sharedAppAssetOutputs = sharedAppAssets.map { it.second }.toSet()
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
val androidAssetFiles = (androidAssetCatalog["files"] as? List<*>)?.mapIndexed { index, value ->
    normalizedAssetPath(value, "Android asset file $index")
} ?: error("Android asset catalog files must be an array.")
check(androidAssetFiles.isNotEmpty() && androidAssetFiles.toSet().size == androidAssetFiles.size) {
    "Android asset catalog files must be nonempty and unique."
}
for (path in androidAssetFiles) {
    confinedWorkspaceRelativePath(
        "$languageStaticRelativePath/$path",
        "Android course asset $path",
    )
}
check("index.html" !in androidAssetFiles) {
    "Android course assets must not declare a course-local index.html."
}
val androidLauncherIconFiles = (androidAssetCatalog["launcherIconFiles"] as? List<*>)?.mapIndexed { index, value ->
    normalizedAssetPath(value, "Android launcher icon file $index")
} ?: error("Android asset catalog launcherIconFiles must be an array.")
check(androidLauncherIconFiles.toSet().size == androidLauncherIconFiles.size) {
    "Android launcher icon files must be unique."
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
val supplementalSharedRuntimeFiles = sharedRuntimeFiles.filter { path ->
    val output = "language-runtime/$path"
    if (output !in sharedAppAssetOutputs) {
        true
    } else {
        val expectedSource = confinedWorkspaceRelativePath(
            "apps/language-runtime/$path",
            "Android shared runtime file $path",
        )
        val declaredSource = sharedAppAssets.single { it.second == output }.first
        check(declaredSource == expectedSource) {
            "Android shared runtime output conflicts with shared app asset $output."
        }
        false
    }
}
val launcherStaticRelativePath = confinedWorkspaceRelativePath(
    "apps/launcher/static",
    "launcher static root",
)
val launcherStaticDir = workspaceRootDir.dir(launcherStaticRelativePath)
for (path in androidLauncherIconFiles) {
    confinedWorkspaceRelativePath(
        "$launcherStaticRelativePath/assets/icons/$path",
        "Android launcher icon $path",
    )
}
confinedWorkspaceRelativePath(
    "$launcherStaticRelativePath/assets/loading-animation/animations_manifest.json",
    "Android loading animation manifest",
)
val generatedLanguageAssetsDir = layout.buildDirectory.dir("generated/assets/caatuu-$bundledLanguageId")
val setupAssetManifest = languageStaticDir.file("setup-assets.json")
val setupAssetRefreshScript = workspaceRootDir.file("apps/server/tooling/refresh-setup-assets.mjs")
val staticModelCatalog = languageStaticDir.file("data/models/phone-bench/models.json")
val modelCatalogConfig = workspaceRootDir.file("tools/on-device-models/model-configs.json")
val modelCatalogCheckScript = workspaceRootDir.file("apps/server/tooling/check-static-model-catalog.mjs")
val releaseKeystorePath = providers.environmentVariable("CAATUU_ANDROID_KEYSTORE")
val releaseKeystorePassword = providers.environmentVariable("CAATUU_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = providers.environmentVariable("CAATUU_ANDROID_KEY_ALIAS")
val releaseKeyPassword = providers.environmentVariable("CAATUU_ANDROID_KEY_PASSWORD")
val debugKeystorePath = providers.environmentVariable("CAATUU_ANDROID_DEBUG_KEYSTORE")
val debugKeystorePassword = providers.environmentVariable("CAATUU_ANDROID_DEBUG_KEYSTORE_PASSWORD")
    .orElse("android")
val debugKeyAlias = providers.environmentVariable("CAATUU_ANDROID_DEBUG_KEY_ALIAS")
    .orElse("androiddebugkey")
val debugKeyPassword = providers.environmentVariable("CAATUU_ANDROID_DEBUG_KEY_PASSWORD")
    .orElse("android")
val androidMinSdk = providers.environmentVariable("CAATUU_ANDROID_MIN_SDK")
    .map(String::toInt)
    .orElse(30)
val androidTargetSdk = providers.environmentVariable("CAATUU_ANDROID_TARGET_SDK")
    .map(String::toInt)
    .orElse(36)
val androidAbis = providers.environmentVariable("CAATUU_ANDROID_ABIS")
    .map { value -> value.split(",").map { abi -> abi.trim() }.filter { abi -> abi.isNotEmpty() } }
    .orElse(listOf("arm64-v8a"))
val androidUpdateBaseUrl = providers.environmentVariable("CAATUU_ANDROID_UPDATE_BASE_URL")
    .orElse("https://updates.caatuu.invalid/android")
val androidReportUrl = providers.environmentVariable("CAATUU_ANDROID_REPORT_URL")
    .orElse("https://caatuu.waajacu.com/api/bug-report")
val androidDictionaryGapUrl = providers.environmentVariable("CAATUU_ANDROID_DICTIONARY_GAP_URL")
    .orElse("https://caatuu.waajacu.com$bundledLanguageRoutePrefix/api/dictionary/gaps")
val hasReleaseSigning = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { provider -> provider.orNull?.isNotBlank() == true }

fun buildConfigString(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

val refreshSetupAssetManifest by tasks.registering(Exec::class) {
    group = "build setup"
    description = "Refresh setup asset byte counts and SHA-256 values from their source files."
    workingDir(workspaceRootDir)
    commandLine(
        "node",
        setupAssetRefreshScript.asFile.absolutePath,
        "--manifest",
        setupAssetManifest.asFile.absolutePath,
        "--launcher-static",
        launcherStaticDir.asFile.absolutePath,
        "--language-static",
        languageStaticDir.asFile.absolutePath,
        "--language-route-prefix",
        bundledLanguageRoutePrefix,
    )
    inputs.file(setupAssetRefreshScript)
    inputs.files(providers.provider {
        val manifest = groovy.json.JsonSlurper().parse(setupAssetManifest.asFile) as Map<*, *>
        val artifacts = manifest["artifacts"] as? List<*> ?: emptyList<Any>()
        val languagePrefix = "/${bundledLanguageRoutePrefix.trim('/')}"
        artifacts.mapNotNull { value ->
            val artifact = value as? Map<*, *> ?: return@mapNotNull null
            val url = URLDecoder.decode(artifact["url"]?.toString().orEmpty(), Charsets.UTF_8)
            when {
                url.startsWith("/assets/loading_animation/") -> launcherStaticDir.file(
                    "assets/loading-animation/${url.removePrefix("/assets/loading_animation/")}"
                ).asFile
                url.startsWith("/assets/miscellaneous/") -> launcherStaticDir.file(
                    "assets/visual-vocabulary/${url.removePrefix("/assets/miscellaneous/")}"
                ).asFile
                url.startsWith("/assets/") -> launcherStaticDir.file(url.removePrefix("/")).asFile
                url.startsWith("$languagePrefix/") -> languageStaticDir.file(url.removePrefix("$languagePrefix/")).asFile
                else -> null
            }
        }
    })
    outputs.file(setupAssetManifest)
}

val verifyStaticModelCatalog by tasks.registering(Exec::class) {
    group = "verification"
    description = "Fail the Android build when the shipped model catalog is missing or stale."
    workingDir(workspaceRootDir)
    commandLine(
        "node",
        modelCatalogCheckScript.asFile.absolutePath,
        "--config",
        modelCatalogConfig.asFile.absolutePath,
        "--catalog",
        staticModelCatalog.asFile.absolutePath,
    )
    inputs.file(modelCatalogCheckScript)
    inputs.file(modelCatalogConfig)
    inputs.file(staticModelCatalog)
}

val syncLanguageAssets by tasks.registering(Sync::class) {
    dependsOn(refreshSetupAssetManifest)
    if (courseOfflineModelsEnabled) dependsOn(verifyStaticModelCatalog)
    inputs.file(courseManifestFile)
    inputs.file(appEntryFile)
    inputs.file(appAssetCatalogFile)
    inputs.file(androidAssetCatalogFile)
    inputs.property("androidAssetFiles", androidAssetFiles)
    inputs.property("androidLauncherIconFiles", androidLauncherIconFiles)
    inputs.files(sharedAppAssets.map { (source, _) -> workspaceRootDir.file(source) })
    inputs.property("sharedAppAssets", sharedAppAssets.map { (source, output) -> "$source=>$output" })
    inputs.property("sharedRuntimeFiles", supplementalSharedRuntimeFiles)
    from(languageStaticDir) {
        exclude("index.html")
        exclude("games/**")
        exclude("data/models/**/*.gguf")
        exclude("data/models/**/*.bin")
        exclude("data/models/**/*.params")
        exclude("data/models/**/*.safetensors")
        exclude("data/models/**/ndarray-cache.json")
        exclude("data/models/czech-finetuned/**")
        exclude("data/embeddings/all-minilm-l6-v2-qint8-v0.1/runtime/**")
        exclude("data/embeddings/**/*.sqlite")
        exclude("data/embeddings/**/*.db")
        exclude("data/embeddings/**/*.wasm")
        exclude("data/embeddings/**/*.onnx")
        exclude("data/embeddings/**/*.bin")
        exclude("data/embeddings/**/*.safetensors")
        exclude("data/dictionaries/**/*.sqlite")
        exclude("icons/*-1024.png")
    }
    from(launcherStaticDir.dir("assets/icons")) {
        include(*androidLauncherIconFiles.filterNot { "assets/icons/$it" in sharedAppAssetOutputs }.toTypedArray())
        into("assets/icons")
    }
    from(launcherStaticDir.dir("assets/loading-animation")) {
        include("animations_manifest.json")
        into("assets/loading_animation")
    }
    from(appEntryFile) {
        rename { "index.html" }
    }
    for ((source, outputPath) in sharedAppAssets) {
        from(workspaceRootDir.file(source)) {
            into(outputPath.substringBeforeLast('/', ""))
            rename { outputPath.substringAfterLast('/') }
        }
    }
    for (path in supplementalSharedRuntimeFiles) {
        val outputPath = "language-runtime/$path"
        from(workspaceRootDir.file("apps/language-runtime/$path")) {
            into(outputPath.substringBeforeLast('/', ""))
            rename { outputPath.substringAfterLast('/') }
        }
    }
    into(generatedLanguageAssetsDir)
}

android {
    namespace = "com.caatuu.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.waajacu.caatuu"
        minSdk = androidMinSdk.get()
        targetSdk = androidTargetSdk.get()
        versionCode = 143
        versionName = "0.1.142"
        buildConfigField("String", "CAATUU_LANGUAGE_ID", buildConfigString(bundledLanguageId))
        buildConfigField("String", "CAATUU_LANGUAGE_ROUTE_PREFIX", buildConfigString(bundledLanguageRoutePrefix))
        buildConfigField("String", "CAATUU_LANGUAGE_ENTRY_PATH", buildConfigString(bundledLanguageEntryPath))
        buildConfigField("String", "CAATUU_SOURCE_LANGUAGE_LABEL", buildConfigString(courseSourceLanguageLabel))
        buildConfigField("String", "CAATUU_TARGET_LANGUAGE_LABEL", buildConfigString(courseTargetLanguageLabel))
        buildConfigField("String", "CAATUU_TARGET_LANGUAGE_LOCALE", buildConfigString(courseTargetLanguageLocale))
        buildConfigField("String", "CAATUU_SPEECH_LOCALE", buildConfigString(courseSpeechLocale))
        buildConfigField("String", "CAATUU_COURSE_CAPABILITIES_JSON", buildConfigString(groovy.json.JsonOutput.toJson(courseCapabilities)))
        buildConfigField("boolean", "CAATUU_GENERATIVE_ENABLED", (courseLlmEnabled && courseGenerationEnabled).toString())
        buildConfigField("boolean", "CAATUU_EMBEDDINGS_ENABLED", courseEmbeddingsEnabled.toString())
        buildConfigField("boolean", "CAATUU_DICTIONARY_ENABLED", courseDictionaryEnabled.toString())
        buildConfigField("String", "CAATUU_UPDATE_BASE_URL", buildConfigString(androidUpdateBaseUrl.get()))
        buildConfigField("String", "CAATUU_REPORT_URL", buildConfigString(androidReportUrl.get()))
        buildConfigField("String", "CAATUU_DICTIONARY_GAP_URL", buildConfigString(androidDictionaryGapUrl.get()))
        buildConfigField("boolean", "CAATUU_ACCEPT_RELEASE_MIGRATION", "false")
        manifestPlaceholders["caatuuUsesCleartextTraffic"] = "false"

        ndk {
            abiFilters += androidAbis.get()
        }
    }

    ndkVersion = "29.0.13113456"

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        getByName("debug") {
            if (debugKeystorePath.isPresent) {
                storeFile = file(debugKeystorePath.get())
                storePassword = debugKeystorePassword.get()
                keyAlias = debugKeyAlias.get()
                keyPassword = debugKeyPassword.get()
            }
        }
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
            assets.srcDir(generatedLanguageAssetsDir)
        }
    }

    packaging {
        jniLibs.useLegacyPackaging = true
    }

    buildTypes {
        debug {
            isMinifyEnabled = true
            isShrinkResources = true
            manifestPlaceholders["caatuuUsesCleartextTraffic"] = "true"
            buildConfigField("boolean", "CAATUU_SELF_UPDATE_ENABLED", "true")
            buildConfigField("String", "CAATUU_UPDATE_APK_NAME", buildConfigString("caatuu-debug.apk"))
            buildConfigField("String", "CAATUU_UPDATE_MANIFEST_NAME", buildConfigString("caatuu-debug.json"))
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            manifestPlaceholders["caatuuUsesCleartextTraffic"] = "false"
            buildConfigField("boolean", "CAATUU_SELF_UPDATE_ENABLED", "true")
            buildConfigField("String", "CAATUU_UPDATE_APK_NAME", buildConfigString("caatuu.apk"))
            buildConfigField("String", "CAATUU_UPDATE_MANIFEST_NAME", buildConfigString("caatuu.json"))
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        create("play") {
            initWith(getByName("release"))
            matchingFallbacks += listOf("release")
            buildConfigField("boolean", "CAATUU_SELF_UPDATE_ENABLED", "false")
            buildConfigField("String", "CAATUU_UPDATE_APK_NAME", buildConfigString("caatuu.apk"))
            buildConfigField("String", "CAATUU_UPDATE_MANIFEST_NAME", buildConfigString("caatuu.json"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin {
        jvmToolchain(17)
    }
}

gradle.taskGraph.whenReady {
    val releasePackagingRequested = allTasks.any { task ->
        val taskName = task.name.lowercase()
        val releaseOrPlay = taskName.contains("release") || taskName.contains("play")
        val packagesApplication = listOf("assemble", "bundle", "package", "sign")
            .any(taskName::contains)
        releaseOrPlay && packagesApplication
    }
    if (releasePackagingRequested && !hasReleaseSigning) {
        throw GradleException(
            "Release and Play packaging require nonblank CAATUU_ANDROID_KEYSTORE, " +
                "CAATUU_ANDROID_KEYSTORE_PASSWORD, CAATUU_ANDROID_KEY_ALIAS, and " +
                "CAATUU_ANDROID_KEY_PASSWORD.",
        )
    }
}

tasks.named("preBuild").configure {
    dependsOn(syncLanguageAssets)
}

dependencies {
    implementation(project(":llamaLib"))
    implementation(libs.androidx.activity)
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
}
