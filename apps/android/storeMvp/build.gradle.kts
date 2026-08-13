plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.jetbrains.kotlin.android)
}

val distributionProfile = providers.gradleProperty("caatuuDistributionProfile").orElse("full")
val bundledLanguageId = providers.gradleProperty("caatuuLanguageId").orElse("cz")
val bundledLanguageAppDir = providers.gradleProperty("caatuuLanguageAppDir").orElse("languages/czech")
val bundledLanguageRoutePrefix = providers.gradleProperty("caatuuLanguageRoutePrefix").orElse("/cz")
val bundledLanguageEntryPath = providers.gradleProperty("caatuuLanguageEntryPath").orElse("/cz/index.html")
val workspaceRootDir = layout.projectDirectory.dir("../../..")
val languageStaticDir = workspaceRootDir.dir("apps/${bundledLanguageAppDir.get()}/static")
val launcherStaticDir = workspaceRootDir.dir("apps/launcher/static")
val assetCompiler = workspaceRootDir.file("apps/android/tooling/build-store-mvp-assets.mjs")
val generatedAssetsDir = layout.buildDirectory.dir("generated/assets/store-mvp")
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
val releaseSigningValues = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).map { provider -> provider.orNull?.isNotBlank() == true }
val hasReleaseSigning = releaseSigningValues.all { it }
val hasPartialReleaseSigning = releaseSigningValues.any { it } && !hasReleaseSigning

check(distributionProfile.get() == "storeMvp") {
    "The :storeMvp module must be configured with -PcaatuuDistributionProfile=storeMvp."
}
check(!hasPartialReleaseSigning) {
    "Store MVP signing requires all four CAATUU_ANDROID_KEYSTORE, " +
        "CAATUU_ANDROID_KEYSTORE_PASSWORD, CAATUU_ANDROID_KEY_ALIAS, and " +
        "CAATUU_ANDROID_KEY_PASSWORD values, or none for an explicitly unsigned milestone build."
}

fun buildConfigString(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

val generateStoreMvpAssets by tasks.registering(Exec::class) {
    group = "build setup"
    description = "Compile the allowlisted, non-generative Store MVP WebView assets."
    workingDir(workspaceRootDir)
    commandLine(
        "node",
        assetCompiler.asFile.absolutePath,
        "--source",
        languageStaticDir.asFile.absolutePath,
        "--launcher",
        launcherStaticDir.asFile.absolutePath,
        "--output",
        generatedAssetsDir.get().asFile.absolutePath,
    )
    inputs.file(assetCompiler)
    inputs.dir(languageStaticDir)
    inputs.dir(launcherStaticDir)
    outputs.dir(generatedAssetsDir)
}

android {
    namespace = "com.caatuu.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.waajacu.caatuu"
        minSdk = androidMinSdk.get()
        targetSdk = androidTargetSdk.get()
        versionCode = 144
        versionName = "0.1.143-store-mvp-preview.1"
        buildConfigField("String", "CAATUU_DISTRIBUTION_PROFILE", buildConfigString("storeMvp"))
        buildConfigField("String", "CAATUU_LANGUAGE_ID", buildConfigString(bundledLanguageId.get()))
        buildConfigField("String", "CAATUU_LANGUAGE_ROUTE_PREFIX", buildConfigString(bundledLanguageRoutePrefix.get()))
        buildConfigField("String", "CAATUU_LANGUAGE_ENTRY_PATH", buildConfigString(bundledLanguageEntryPath.get()))
        buildConfigField("boolean", "CAATUU_GENERATIVE_ENABLED", "false")
        buildConfigField("boolean", "CAATUU_EMBEDDINGS_ENABLED", "true")
        buildConfigField("boolean", "CAATUU_GODOT_ENABLED", "false")
        buildConfigField("boolean", "CAATUU_SELF_UPDATE_ENABLED", "false")
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
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
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
                "com/caatuu/android/AppUpdateManager.kt",
                "com/caatuu/android/CaatuuBridge.kt",
                "com/caatuu/android/MainActivity.kt",
                "com/caatuu/android/ModelManager.kt",
                "com/caatuu/android/NativeCzechModel.kt",
            )
        }
    }
}

tasks.named("preBuild").configure {
    dependsOn(generateStoreMvpAssets)
}

dependencies {
    implementation(libs.androidx.activity)
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
}
