plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.jetbrains.kotlin.android)
}

val czechStaticDir = layout.projectDirectory.dir("../../caatuu-czech/static")
val generatedCzechAssetsDir = layout.buildDirectory.dir("generated/assets/caatuu-czech")
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
    .orElse(30)
val androidAbis = providers.environmentVariable("CAATUU_ANDROID_ABIS")
    .map { value -> value.split(",").map { abi -> abi.trim() }.filter { abi -> abi.isNotEmpty() } }
    .orElse(listOf("arm64-v8a"))
val hasReleaseSigning = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { it.isPresent }

val syncCzechAssets by tasks.registering(Sync::class) {
    from(czechStaticDir) {
        exclude("data/models/**/*.gguf")
        exclude("data/models/**/*.bin")
        exclude("data/models/**/*.params")
        exclude("data/models/**/*.safetensors")
        exclude("data/models/**/ndarray-cache.json")
        exclude("data/models/czech-finetuned/**")
    }
    into(generatedCzechAssetsDir)
}

android {
    namespace = "com.caatuu.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.waajacu.caatuu"
        minSdk = androidMinSdk.get()
        targetSdk = androidTargetSdk.get()
        versionCode = 12
        versionName = "0.1.11"

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
            assets.srcDir(generatedCzechAssetsDir)
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
    }
}

tasks.named("preBuild").configure {
    dependsOn(syncCzechAssets)
}

dependencies {
    implementation(project(":llamaLib"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
}
