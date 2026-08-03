import java.io.File
import java.net.URLDecoder
import java.nio.file.Files
import java.security.MessageDigest

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
val memoryMoonWebArtifactDir = workspaceRootDir.dir("artifacts/games/memory-moon/web/godot-v1")
val memoryMoonGameManifest = workspaceRootDir.file("apps/games/memory-moon/game.json")
val gameReleaseReadinessScript = workspaceRootDir.file("apps/games/tooling/check-release-readiness.mjs")
val memoryMoonGameId = "memory-moon"
val memoryMoonBundleManifestName = "bundle-manifest.json"
val memoryMoonBundleManifest = memoryMoonWebArtifactDir.file(memoryMoonBundleManifestName)
val memoryMoonBundleSchema = "caatuu-game-web-bundle"
val memoryMoonArtifactVersion = "godot-v1"
val requiredMemoryMoonNotices = listOf(
    "LICENSES/Godot-MIT.txt",
    "LICENSES/Macaw-Parts-CC0.md",
    "LICENSES/Memory-Grove-Provenance.md",
    "LICENSES/Memory-Moon-Style-Provenance.md",
    "LICENSES/Quaternius-CC0.txt",
    "THIRD_PARTY_NOTICES.md",
)
val generatedGameAssetsDir = layout.buildDirectory.dir("generated/assets/caatuu-games")
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
    .orElse("https://caatuu.waajacu.com/cz/api/dictionary/gaps")
val hasReleaseSigning = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { provider -> provider.orNull?.isNotBlank() == true }

fun buildConfigString(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

fun readJsonObject(file: File, label: String): Map<*, *> {
    if (!file.isFile) {
        throw GradleException("$label is missing: ${file.absolutePath}")
    }
    return try {
        groovy.json.JsonSlurper().parse(file) as? Map<*, *>
            ?: throw GradleException("$label must contain a JSON object: ${file.absolutePath}")
    } catch (error: GradleException) {
        throw error
    } catch (error: Exception) {
        throw GradleException("$label is not valid JSON: ${file.absolutePath}", error)
    }
}

fun requireExactJsonKeys(value: Map<*, *>, expected: Set<String>, label: String) {
    val actual = value.keys.map { key ->
        key as? String ?: throw GradleException("$label contains a non-string key.")
    }.toSet()
    if (actual != expected) {
        throw GradleException(
            "$label keys do not match the contract. " +
                "Expected ${expected.sorted()}, found ${actual.sorted()}.",
        )
    }
}

fun requireBundlePath(value: Any?, label: String): String {
    val path = value as? String
        ?: throw GradleException("$label must be a string.")
    val segments = path.split("/")
    if (
        path.isEmpty() ||
        path.startsWith("/") ||
        path.contains("\\") ||
        !path.matches(Regex("[A-Za-z0-9._/-]+")) ||
        segments.any { segment -> segment.isEmpty() || segment == "." || segment == ".." }
    ) {
        throw GradleException("$label is not a safe normalized bundle path: $path")
    }
    return path
}

fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    file.inputStream().use { input ->
        while (true) {
            val bytesRead = input.read(buffer)
            if (bytesRead < 0) break
            digest.update(buffer, 0, bytesRead)
        }
    }
    return digest.digest().joinToString("") { byte ->
        "%02x".format(byte.toInt() and 0xff)
    }
}

fun verifyGameReleaseReadiness(surface: String) {
    val command = listOf(
        "node",
        gameReleaseReadinessScript.asFile.absolutePath,
        "--repo-root",
        workspaceRootDir.asFile.absolutePath,
        "--surface",
        surface,
        "--require-game",
        memoryMoonGameId,
    )
    val process = try {
        ProcessBuilder(command)
            .directory(workspaceRootDir.asFile)
            .inheritIO()
            .start()
    } catch (error: Exception) {
        throw GradleException("Could not start the canonical game release-readiness checker.", error)
    }
    val exitCode = try {
        process.waitFor()
    } catch (error: InterruptedException) {
        process.destroyForcibly()
        Thread.currentThread().interrupt()
        throw GradleException("Game release-readiness validation was interrupted.", error)
    }
    if (exitCode != 0) {
        throw GradleException("Canonical game release-readiness validation failed for $surface.")
    }
}

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
        exclude("icons/caatuu-czech-1024.png")
    }
    from(launcherStaticDir.dir("assets/icons")) {
        include(
            "*_ui.png",
            "czech_flag.png",
            "dark_mode.png",
            "games_icon.png",
            "gear_icon.png",
            "hello.png",
            "home_icon.png",
            "backpack_icon.png",
            "coin_icon.png",
            "icon_gem.png",
            "items_icon.png",
            "stats_icon.png",
        )
        into("assets/icons")
    }
    from(launcherStaticDir.dir("assets/loading-animation")) {
        include("animations_manifest.json")
        into("assets/loading_animation")
    }
    into(generatedLanguageAssetsDir)
}

val requiredMemoryMoonFiles = listOf("index.html", "index.js", "index.pck", "index.wasm")

val verifyBundledGameArtifacts by tasks.registering {
    group = "verification"
    description = "Verify the complete Memory Moon Web bundle manifest before Android packaging."
    inputs.dir(memoryMoonWebArtifactDir)
    inputs.file(memoryMoonGameManifest)
    doLast {
        val artifactRoot = memoryMoonWebArtifactDir.asFile
        val bundleManifestFile = memoryMoonBundleManifest.asFile
        if (!artifactRoot.isDirectory || !bundleManifestFile.isFile || bundleManifestFile.length() == 0L) {
            throw GradleException(
                "Memory Moon Web bundle or ${memoryMoonBundleManifestName} is missing: " +
                    "${artifactRoot.absolutePath}. Run the root memory-moon-godot-export service " +
                    "before building Android.",
            )
        }

        val gameDefinition = readJsonObject(memoryMoonGameManifest.asFile, "Memory Moon game manifest")
        val expectedGameVersion = gameDefinition["version"] as? String
            ?: throw GradleException("Memory Moon game manifest has no version string.")
        val expectedEngine = gameDefinition["engine"] as? Map<*, *>
            ?: throw GradleException("Memory Moon game manifest has no engine object.")
        val expectedEngineName = expectedEngine["name"] as? String
            ?: throw GradleException("Memory Moon game manifest has no engine.name string.")
        val expectedEngineVersion = expectedEngine["version"] as? String
            ?: throw GradleException("Memory Moon game manifest has no engine.version string.")

        val bundleManifest = readJsonObject(bundleManifestFile, "Memory Moon bundle manifest")
        requireExactJsonKeys(
            bundleManifest,
            setOf(
                "schema_name",
                "schema_version",
                "game",
                "engine",
                "entrypoint",
                "required_notices",
                "files",
            ),
            "Memory Moon bundle manifest",
        )
        val schemaVersion = bundleManifest["schema_version"]
        if (
            bundleManifest["schema_name"] != memoryMoonBundleSchema ||
            schemaVersion !is Number ||
            schemaVersion.toString() != "1"
        ) {
            throw GradleException("Memory Moon bundle manifest schema is unsupported.")
        }
        if (bundleManifest["entrypoint"] != "index.html") {
            throw GradleException("Memory Moon bundle manifest entrypoint must be index.html.")
        }

        val game = bundleManifest["game"] as? Map<*, *>
            ?: throw GradleException("Memory Moon bundle manifest has no game object.")
        requireExactJsonKeys(game, setOf("id", "version", "artifact_version"), "Memory Moon bundle game")
        if (
            game["id"] != memoryMoonGameId ||
            game["version"] != expectedGameVersion ||
            game["artifact_version"] != memoryMoonArtifactVersion
        ) {
            throw GradleException(
                "Memory Moon bundle game identity/version is stale. " +
                "Expected $memoryMoonGameId $expectedGameVersion $memoryMoonArtifactVersion.",
            )
        }

        val engine = bundleManifest["engine"] as? Map<*, *>
            ?: throw GradleException("Memory Moon bundle manifest has no engine object.")
        requireExactJsonKeys(engine, setOf("name", "version"), "Memory Moon bundle engine")
        val bundledEngineVersion = engine["version"] as? String
            ?: throw GradleException("Memory Moon bundle engine has no version string.")
        val expectedEnginePattern = Regex(
            """${Regex.escape(expectedEngineVersion)}\.stable\.[A-Za-z0-9._-]+""",
        )
        if (engine["name"] != expectedEngineName || !expectedEnginePattern.matches(bundledEngineVersion)) {
            throw GradleException(
                "Memory Moon bundle engine identity/version is stale. " +
                    "Expected $expectedEngineName ${expectedEngineVersion}.stable.*, found " +
                    "${engine["name"]} $bundledEngineVersion.",
            )
        }

        val manifestNotices = (bundleManifest["required_notices"] as? List<*>)?.mapIndexed { index, value ->
            requireBundlePath(value, "Memory Moon required_notices[$index]")
        } ?: throw GradleException("Memory Moon bundle manifest has no required_notices array.")
        if (manifestNotices != requiredMemoryMoonNotices) {
            throw GradleException(
                "Memory Moon bundle required notices do not match the Android delivery contract.",
            )
        }

        val fileEntries = bundleManifest["files"] as? List<*>
            ?: throw GradleException("Memory Moon bundle manifest has no files array.")
        if (fileEntries.isEmpty()) {
            throw GradleException("Memory Moon bundle manifest files array is empty.")
        }
        val expectedSizes = linkedMapOf<String, Long>()
        val expectedHashes = linkedMapOf<String, String>()
        fileEntries.forEachIndexed { index, rawEntry ->
            val entry = rawEntry as? Map<*, *>
                ?: throw GradleException("Memory Moon bundle files[$index] must be an object.")
            requireExactJsonKeys(entry, setOf("path", "bytes", "sha256"), "Memory Moon bundle files[$index]")
            val path = requireBundlePath(entry["path"], "Memory Moon bundle files[$index].path")
            if (path == memoryMoonBundleManifestName || expectedSizes.containsKey(path)) {
                throw GradleException("Memory Moon bundle contains a reserved or duplicate path: $path")
            }
            val byteValue = entry["bytes"]
            if (byteValue !is Number) {
                throw GradleException("Memory Moon bundle files[$index].bytes must be a JSON number.")
            }
            val byteText = byteValue.toString()
            val bytes = byteText.toLongOrNull()
            if (bytes == null || bytes < 0L || bytes.toString() != byteText) {
                throw GradleException("Memory Moon bundle files[$index].bytes is not a nonnegative integer.")
            }
            val hash = entry["sha256"] as? String
                ?: throw GradleException("Memory Moon bundle files[$index].sha256 must be a string.")
            if (!hash.matches(Regex("[0-9a-f]{64}"))) {
                throw GradleException("Memory Moon bundle files[$index].sha256 must be lowercase SHA-256.")
            }
            expectedSizes[path] = bytes
            expectedHashes[path] = hash
        }

        val requiredDeliveredFiles = requiredMemoryMoonFiles + requiredMemoryMoonNotices
        val omittedRequiredFiles = requiredDeliveredFiles.filterNot(expectedSizes::containsKey)
        if (omittedRequiredFiles.isNotEmpty()) {
            throw GradleException(
                "Memory Moon bundle manifest omits required files: ${omittedRequiredFiles.sorted()}.",
            )
        }
        requiredDeliveredFiles.forEach { path ->
            if (expectedSizes.getValue(path) == 0L) {
                throw GradleException("Memory Moon required bundle file is empty: $path")
            }
        }

        val actualFiles = linkedMapOf<String, File>()
        artifactRoot.walkTopDown()
            .onEnter { directory ->
                if (Files.isSymbolicLink(directory.toPath())) {
                    throw GradleException("Memory Moon bundle contains a symbolic link: ${directory.absolutePath}")
                }
                true
            }
            .forEach { file ->
                if (file == artifactRoot) return@forEach
                if (Files.isSymbolicLink(file.toPath())) {
                    throw GradleException("Memory Moon bundle contains a symbolic link: ${file.absolutePath}")
                }
                if (file.isFile) {
                    val path = requireBundlePath(
                        artifactRoot.toPath().relativize(file.toPath()).toString().replace(File.separatorChar, '/'),
                        "Memory Moon delivered file",
                    )
                    if (path != memoryMoonBundleManifestName) {
                        actualFiles[path] = file
                    }
                } else if (!file.isDirectory) {
                    throw GradleException("Memory Moon bundle contains an unsupported entry: ${file.absolutePath}")
                }
            }

        val missingFiles = expectedSizes.keys - actualFiles.keys
        val staleExtraFiles = actualFiles.keys - expectedSizes.keys
        if (missingFiles.isNotEmpty() || staleExtraFiles.isNotEmpty()) {
            throw GradleException(
                "Memory Moon bundle contents do not match ${memoryMoonBundleManifestName}: " +
                    "missing=${missingFiles.sorted()}, stale extras=${staleExtraFiles.sorted()}.",
            )
        }

        expectedSizes.keys.sorted().forEach { path ->
            val file = actualFiles.getValue(path)
            val expectedBytes = expectedSizes.getValue(path)
            if (file.length() != expectedBytes) {
                throw GradleException(
                    "Memory Moon bundle byte count mismatch for $path: " +
                        "expected $expectedBytes, found ${file.length()}.",
                )
            }
            val actualHash = sha256(file)
            val expectedHash = expectedHashes.getValue(path)
            if (actualHash != expectedHash) {
                throw GradleException(
                    "Memory Moon bundle SHA-256 mismatch for $path: " +
                        "expected $expectedHash, found $actualHash.",
                )
            }
        }
    }
}

val syncGameAssets by tasks.registering(Sync::class) {
    dependsOn(verifyBundledGameArtifacts)
    from(memoryMoonWebArtifactDir) {
        into("games/memory-moon/godot-v1")
    }
    into(generatedGameAssetsDir)
}

android {
    namespace = "com.caatuu.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.waajacu.caatuu"
        minSdk = androidMinSdk.get()
        targetSdk = androidTargetSdk.get()
        versionCode = 137
        versionName = "0.1.136"
        buildConfigField("String", "CAATUU_LANGUAGE_ID", buildConfigString(bundledLanguageId.get()))
        buildConfigField("String", "CAATUU_LANGUAGE_ROUTE_PREFIX", buildConfigString(bundledLanguageRoutePrefix.get()))
        buildConfigField("String", "CAATUU_LANGUAGE_ENTRY_PATH", buildConfigString(bundledLanguageEntryPath.get()))
        buildConfigField("String", "CAATUU_UPDATE_BASE_URL", buildConfigString(androidUpdateBaseUrl.get()))
        buildConfigField("String", "CAATUU_REPORT_URL", buildConfigString(androidReportUrl.get()))
        buildConfigField("String", "CAATUU_DICTIONARY_GAP_URL", buildConfigString(androidDictionaryGapUrl.get()))
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
            assets.srcDir(generatedGameAssetsDir)
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

val androidAppProjectPath = project.path

gradle.taskGraph.whenReady {
    val releasePackagingRequested = allTasks.any { task ->
        if (task.project.path != androidAppProjectPath) return@any false
        val taskName = task.name.lowercase()
        val releaseOrPlay = taskName.contains("release") || taskName.contains("play")
        val packagesApplication = listOf("assemble", "bundle", "package", "sign")
            .any(taskName::contains)
        releaseOrPlay && packagesApplication
    }
    if (releasePackagingRequested) {
        verifyGameReleaseReadiness("android-release-play")
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
    dependsOn(syncLanguageAssets, syncGameAssets)
}

dependencies {
    implementation(project(":llamaLib"))
    implementation(libs.androidx.activity)
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
}
