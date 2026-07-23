import java.net.URLDecoder

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.jetbrains.kotlin.android)
}

val bundledLanguageId = providers.gradleProperty("caatuuLanguageId").orElse("cz")
val bundledLanguageAppDir = providers.gradleProperty("caatuuLanguageAppDir").orElse("languages/czech")
val bundledLanguageRoutePrefix = providers.gradleProperty("caatuuLanguageRoutePrefix").orElse("/cz")
val bundledLanguageEntryPath = providers.gradleProperty("caatuuLanguageEntryPath").orElse("/cz/home.html")
val languageStaticDir = layout.projectDirectory.dir("../../${bundledLanguageAppDir.get()}/static")
val launcherStaticDir = layout.projectDirectory.dir("../../launcher/static")
val generatedLanguageAssetsDir = layout.buildDirectory.dir("generated/assets/caatuu-${bundledLanguageId.get()}")
val workspaceRootDir = layout.projectDirectory.dir("../../..")
val setupAssetManifest = languageStaticDir.file("setup-assets.json")
val setupAssetRefreshScript = workspaceRootDir.file("apps/runtime/tooling/refresh-setup-assets.mjs")
val staticModelCatalog = languageStaticDir.file("data/models/phone-bench/models.json")
val modelCatalogConfig = workspaceRootDir.file("tools/on-device-models/model-configs.json")
val modelCatalogCheckScript = workspaceRootDir.file("apps/runtime/tooling/check-static-model-catalog.mjs")
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
        bundledLanguageRoutePrefix.get(),
    )
    inputs.file(setupAssetRefreshScript)
    inputs.files(providers.provider {
        val manifest = groovy.json.JsonSlurper().parse(setupAssetManifest.asFile) as Map<*, *>
        val artifacts = manifest["artifacts"] as? List<*> ?: emptyList<Any>()
        val languagePrefix = "/${bundledLanguageRoutePrefix.get().trim('/')}"
        artifacts.mapNotNull { value ->
            val artifact = value as? Map<*, *> ?: return@mapNotNull null
            val url = URLDecoder.decode(artifact["url"]?.toString().orEmpty(), Charsets.UTF_8)
            when {
                url.startsWith("/assets/aliens/") -> launcherStaticDir.file(
                    "assets/language-mascots/${url.removePrefix("/assets/aliens/")}"
                ).asFile
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
    dependsOn(refreshSetupAssetManifest, verifyStaticModelCatalog)
    from(languageStaticDir) {
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
        exclude("icons/caatuu-czech-1024.png")
    }
    from(launcherStaticDir.dir("assets/icons")) {
        include(
            "czech_flag.png",
            "dark_mode.png",
            "games_icon.png",
            "gear_icon.png",
            "hello.png",
            "home_icon.png",
            "backpack_icon.png",
            "items_icon.png",
            "stats_icon.png",
        )
        into("assets/icons")
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
        versionCode = 129
        versionName = "0.1.128"
        buildConfigField("String", "CAATUU_LANGUAGE_ID", buildConfigString(bundledLanguageId.get()))
        buildConfigField("String", "CAATUU_LANGUAGE_ROUTE_PREFIX", buildConfigString(bundledLanguageRoutePrefix.get()))
        buildConfigField("String", "CAATUU_LANGUAGE_ENTRY_PATH", buildConfigString(bundledLanguageEntryPath.get()))
        buildConfigField("String", "CAATUU_UPDATE_BASE_URL", buildConfigString(androidUpdateBaseUrl.get()))
        buildConfigField("String", "CAATUU_REPORT_URL", buildConfigString(androidReportUrl.get()))
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
