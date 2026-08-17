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
val assetCompiler = workspaceRootDir.file("apps/android/tooling/build-product-assets.mjs")
val generatedAssetsDir = layout.buildDirectory.dir("generated/assets/product")
val productIconSource = languageStaticDir.file("icons/caatuu-czech-512.png")
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
val caatuuVersionCode = providers.gradleProperty("caatuuVersionCode").map(String::toInt).orElse(158)
val caatuuVersionName = providers.gradleProperty("caatuuVersionName").orElse("0.1.6")
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

val generateProductAssets by tasks.registering(Exec::class) {
    group = "build setup"
    description = "Compile the allowlisted, non-generative Caatuu product assets."
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
        buildConfigField("String", "CAATUU_LANGUAGE_ID", buildConfigString(bundledLanguageId.get()))
        buildConfigField("String", "CAATUU_LANGUAGE_ROUTE_PREFIX", buildConfigString(bundledLanguageRoutePrefix.get()))
        buildConfigField("String", "CAATUU_LANGUAGE_ENTRY_PATH", buildConfigString(bundledLanguageEntryPath.get()))
        buildConfigField("boolean", "CAATUU_GENERATIVE_ENABLED", "false")
        buildConfigField("boolean", "CAATUU_EMBEDDINGS_ENABLED", "true")
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
}
