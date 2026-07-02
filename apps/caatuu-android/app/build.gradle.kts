plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.jetbrains.kotlin.android)
}

val czechStaticDir = layout.projectDirectory.dir("../../caatuu-czech/static")
val generatedCzechAssetsDir = layout.buildDirectory.dir("generated/assets/caatuu-czech")

val syncCzechAssets by tasks.registering(Sync::class) {
    from(czechStaticDir) {
        exclude("data/models/**/*.gguf")
        exclude("data/models/**/*.bin")
        exclude("data/models/**/*.params")
        exclude("data/models/**/*.safetensors")
        exclude("data/models/**/ndarray-cache.json")
    }
    into(generatedCzechAssetsDir)
}

android {
    namespace = "com.caatuu.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.caatuu.android"
        minSdk = 33
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    ndkVersion = "29.0.13113456"

    buildFeatures {
        buildConfig = true
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
    implementation(libs.kotlinx.coroutines.android)
}
