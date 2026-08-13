pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "CaatuuAndroid"

val distributionProfile = providers.gradleProperty("caatuuDistributionProfile").orElse("full").get()
when (distributionProfile) {
    "storeMvp" -> include(":storeMvp")
    "full" -> {
        val llamaLibDir = file("../../tools/on-device-models/vendor/llama.cpp/examples/llama.android/lib")
        if (!llamaLibDir.isDirectory) {
            throw GradleException(
                "Missing llama.cpp Android library at ${llamaLibDir.path}. " +
                    "Run apps/android/scripts/prepare-llama-vendor.ps1 or clone llama.cpp there."
            )
        }

        include(":app")
        include(":llamaLib")
        project(":llamaLib").projectDir = llamaLibDir
    }
    else -> throw GradleException(
        "Unsupported caatuuDistributionProfile '$distributionProfile'. Use 'full' or 'storeMvp'."
    )
}
