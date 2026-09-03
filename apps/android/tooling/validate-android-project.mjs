import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

export const ANDROID_PROJECT_ISSUE_CODES = Object.freeze({
  FILE_MISSING: "file.missing",
  REQUIRED_CONTRACT_MISSING: "contract.required-missing",
  FORBIDDEN_CONTRACT_PRESENT: "contract.forbidden-present",
  PRODUCT_BRIDGE_OPERATIONS: "bridge.operation-set",
  UPDATE_ORDER: "update.order",
});

export const ANDROID_PROJECT_SOURCE_FILES = Object.freeze({
  settings: "apps/android/settings.gradle.kts",
  appBuild: "apps/android/app/build.gradle.kts",
  productBuild: "apps/android/product/build.gradle.kts",
  productManifest: "apps/android/product/src/main/AndroidManifest.xml",
  productBridge: "apps/android/product/src/main/java/com/caatuu/android/ProductBridge.kt",
  productActivity: "apps/android/product/src/main/java/com/caatuu/android/CaatuuActivity.kt",
  productRuntime: "apps/android/product/src/main/java/com/caatuu/android/ProductCourseRuntime.kt",
  courseRegistry: "apps/android/app/src/main/java/com/caatuu/android/BundledCourseRegistry.kt",
  speechManager: "apps/android/app/src/main/java/com/caatuu/android/AndroidSpeechManager.kt",
  updateManager: "apps/android/app/src/main/java/com/caatuu/android/AppUpdateManager.kt",
  updateFilePaths: "apps/android/product/src/main/res/xml/caatuu_file_paths.xml",
  releaseBuilder: "apps/android/tooling/build-release-aab.sh",
  releasePublisher: "apps/android/tooling/publish-release.sh",
  releaseDeployer: "apps/android/tooling/deploy-pages-release.ps1",
  retiredDebugPublisher: "apps/android/tooling/publish-public-debug.sh",
});

export const PRODUCT_BRIDGE_OPERATIONS = Object.freeze([
  "cancel_request",
  "setup_status",
  "storage_preflight",
  "setup_download",
  "setup_abort",
  "vector_status",
  "vector_download",
  "vector_search",
  "dictionary_status",
  "dictionary_download",
  "dictionary_search",
  "speech_status",
  "speech_speak",
  "speech_stop",
  "speech_install_data",
  "delete_local_pack",
  "clear_cache",
  "update_app_status",
  "update_app",
]);

function addIssue(issues, code, file, message) {
  issues.push({ code, file, message });
}

function requireText(sources, issues, file, contracts) {
  const source = sources[file];
  if (typeof source !== "string") return;
  for (const [label, text] of contracts) {
    if (!source.includes(text)) {
      addIssue(
        issues,
        ANDROID_PROJECT_ISSUE_CODES.REQUIRED_CONTRACT_MISSING,
        ANDROID_PROJECT_SOURCE_FILES[file],
        `${label} is missing`,
      );
    }
  }
}

function forbidText(sources, issues, file, contracts) {
  const source = sources[file];
  if (typeof source !== "string") return;
  for (const [label, text] of contracts) {
    if (source.includes(text)) {
      addIssue(
        issues,
        ANDROID_PROJECT_ISSUE_CODES.FORBIDDEN_CONTRACT_PRESENT,
        ANDROID_PROJECT_SOURCE_FILES[file],
        `${label} must remain absent`,
      );
    }
  }
}

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return "";
  const end = source.indexOf(endMarker, start + startMarker.length);
  return source.slice(start, end < 0 ? source.length : end);
}

function requireOrder(sources, issues, file, label, scope, markers) {
  const source = sources[file];
  if (typeof source !== "string") return;
  const target = scope ? section(source, scope[0], scope[1]) : source;
  let cursor = -1;
  for (const marker of markers) {
    const next = target.indexOf(marker, cursor + 1);
    if (next < 0 || next <= cursor) {
      addIssue(
        issues,
        ANDROID_PROJECT_ISSUE_CODES.UPDATE_ORDER,
        ANDROID_PROJECT_SOURCE_FILES[file],
        `${label} must preserve: ${markers.join(" -> ")}`,
      );
      return;
    }
    cursor = next;
  }
}

function validateBridgeOperations(sources, issues) {
  const bridge = sources.productBridge;
  if (typeof bridge !== "string") return;
  const dispatch = section(
    bridge,
    'when (request.optString("type")) {',
    "else -> throw IllegalArgumentException",
  );
  const actual = [...dispatch.matchAll(/"([a-z_]+)"\s*->/gu)].map((match) => match[1]);
  if (
    actual.length !== PRODUCT_BRIDGE_OPERATIONS.length
    || actual.some((operation, index) => operation !== PRODUCT_BRIDGE_OPERATIONS[index])
  ) {
    addIssue(
      issues,
      ANDROID_PROJECT_ISSUE_CODES.PRODUCT_BRIDGE_OPERATIONS,
      ANDROID_PROJECT_SOURCE_FILES.productBridge,
      `expected ${PRODUCT_BRIDGE_OPERATIONS.join(", ")}; found ${actual.join(", ")}`,
    );
  }
}

function validateUpdateIdentity(sources, issues) {
  const manager = sources.updateManager;
  if (typeof manager !== "string") return;
  const identity = section(manager, "fun sameArtifact(other: UpdateTarget)", "\n    }");
  for (const [label, text] of [
    ["version-bound update identity", "versionCode == other.versionCode"],
    ["hash-bound update identity", "sha256 == other.sha256"],
    ["length-bound update identity", "bytes == other.bytes"],
  ]) {
    if (!identity.includes(text)) {
      addIssue(
        issues,
        ANDROID_PROJECT_ISSUE_CODES.REQUIRED_CONTRACT_MISSING,
        ANDROID_PROJECT_SOURCE_FILES.updateManager,
        `${label} is missing`,
      );
    }
  }
  if (identity.includes("apkUrl")) {
    addIssue(
      issues,
      ANDROID_PROJECT_ISSUE_CODES.FORBIDDEN_CONTRACT_PRESENT,
      ANDROID_PROJECT_SOURCE_FILES.updateManager,
      "the download URL must not define immutable APK identity",
    );
  }
}

function finishReport(issues) {
  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
  });
}

export function validateAndroidProjectSources(sources) {
  const issues = [];

  requireText(sources, issues, "settings", [
    ["exclusive product module selection", '"product" -> include(":product")'],
    ["full development profile", '"full" -> {'],
    ["legacy app module selection", 'include(":app")'],
    ["legacy native model module selection", 'include(":llamaLib")'],
  ]);
  requireText(sources, issues, "productBuild", [
    ["product-only Gradle profile", "-PcaatuuDistributionProfile=product"],
    ["course bundle authority", "CAATUU_COURSE_BUNDLE_ASSET"],
    ["manifest-derived capabilities", "CAATUU_COURSE_CAPABILITIES_JSON"],
    ["disabled generation", 'CAATUU_GENERATIVE_ENABLED\", \"false'],
    ["disabled Godot runtime", 'CAATUU_GODOT_ENABLED\", \"false'],
    ["verified self update", 'CAATUU_SELF_UPDATE_ENABLED\", \"true'],
    ["canonical asset compiler", "build-product-assets.mjs"],
  ]);
  forbidText(sources, issues, "productBuild", [
    ["llama module dependency", 'project(":llamaLib")'],
    ["legacy model vendor preparation", "prepare-llama-vendor"],
  ]);
  requireText(sources, issues, "appBuild", [
    ["standalone game asset exclusion", 'exclude("games/**")'],
    ["canonical shared app document", "apps/language-runtime/static/app/index.html"],
  ]);
  forbidText(sources, issues, "appBuild", [
    ["parallel generated game assets", "generatedGameAssetsDir"],
    ["game export coupling", "check-release-readiness"],
  ]);
  requireText(sources, issues, "productManifest", [
    ["network permission", "android.permission.INTERNET"],
    ["verified update install permission", "android.permission.REQUEST_INSTALL_PACKAGES"],
    ["TTS service discovery", "android.intent.action.TTS_SERVICE"],
    ["cleartext transport prohibition", 'android:usesCleartextTraffic="false"'],
    ["private FileProvider", 'android:name="androidx.core.content.FileProvider"'],
    ["Android back integration", 'android:enableOnBackInvokedCallback="true"'],
  ]);
  forbidText(sources, issues, "productManifest", [
    ["microphone permission", "android.permission.RECORD_AUDIO"],
  ]);
  requireText(sources, issues, "productActivity", [
    ["bundled course registry", "BundledCourseRegistry.load"],
    ["manifest-native provider configuration", "NativeProviderConfiguration.fromBundled"],
    ["product bridge installation", "ProductBridge("],
    ["edge-to-edge system UI", "WindowCompat.enableEdgeToEdge(window)"],
  ]);
  requireText(sources, issues, "productRuntime", [
    ["capability-gated vector manager", "val vectorDatabaseManager: VectorDatabaseManager?"],
    ["capability-gated dictionary manager", "val dictionaryManager: DictionaryManager?"],
    ["capability-gated speech manager", "val speechManager: AndroidSpeechManager?"],
  ]);
  requireText(sources, issues, "productBridge", [
    ["trusted course lookup", "courseRegistry.courseForTrustedUrl(webView.url)"],
    ["bundled course query", "courseRegistry.isBundled(id)"],
    ["non-preview product bridge", "fun isDeveloperPreview(): Boolean = false"],
    ["native theme bridge", "fun setTheme(theme: String)"],
  ]);
  forbidText(sources, issues, "productBridge", [
    ["legacy model manager", "ModelManager"],
    ["legacy native Czech model", "NativeCzechModel"],
    ["remote diagnostics operation", '"report_bug"'],
    ["model deletion operation", '"delete_model"'],
  ]);
  validateBridgeOperations(sources, issues);
  requireText(sources, issues, "courseRegistry", [
    ["trusted URL resolver", "fun courseForTrustedUrl"],
    ["shared runtime route", 'SHARED_LANGUAGE_RUNTIME_ROUTE_PREFIX = "/language-runtime/"'],
    ["safe relative path gate", "isSafeRelativePath(relativePath)"],
  ]);
  forbidText(sources, issues, "courseRegistry", [
    ["standalone game route", 'startsWith("/games/")'],
  ]);
  requireText(sources, issues, "speechManager", [
    ["manifest speech locale", "BuildConfig.CAATUU_SPEECH_LOCALE"],
    ["manifest target language label", "BuildConfig.CAATUU_TARGET_LANGUAGE_LABEL"],
    ["bounded platform input", "TextToSpeech.getMaxSpeechInputLength()"],
    ["utterance completion listener", "UtteranceProgressListener"],
    ["engine shutdown", "currentEngine.shutdown()"],
  ]);
  forbidText(sources, issues, "speechManager", [
    ["hard-coded Czech locale", "CZECH_LANGUAGE"],
  ]);
  requireText(sources, issues, "updateManager", [
    ["persistent update directory", 'File(appContext.filesDir, "updates")'],
    ["release migration build gate", "BuildConfig.CAATUU_ACCEPT_RELEASE_MIGRATION"],
    ["release-shaped migration", 'buildType == "release"'],
    ["signing lineage check", "archiveLineage.containsAll(installedSigners)"],
  ]);
  requireText(sources, issues, "updateFilePaths", [
    ["persistent FileProvider update path", 'path="updates/"'],
  ]);
  requireOrder(
    sources,
    issues,
    "updateManager",
    "managed download handoff",
    ["private fun startManagedDownloadLocked(", "private fun promoteManagedDownloadLocked("],
    ["persistStateLocked(descriptor)", "downloadManager.enqueue(request)", "persistStateLocked(started)"],
  );
  requireOrder(
    sources,
    issues,
    "updateManager",
    "verified APK promotion",
    ["private fun promoteManagedDownloadLocked(", "private fun reconcileServerTargetLocked("],
    [
      "verifyTargetFile(source",
      "moveIntoPlace(temporary, updateApk)",
      "verifyTargetFile(updateApk",
      "persistStateLocked(ready)",
    ],
  );
  requireOrder(
    sources,
    issues,
    "updateManager",
    "installer re-verification",
    ["suspend fun openInstaller()", "private suspend fun fetchJson("],
    ["verifyTargetFile(updateApk, snapshot.target)", "Intent(Intent.ACTION_VIEW)"],
  );
  validateUpdateIdentity(sources, issues);
  requireText(sources, issues, "releaseBuilder", [
    ["product Gradle profile", "-PcaatuuDistributionProfile=product"],
    ["product asset generation", ":product:generateProductAssets"],
    ["release lint", ":product:lintRelease"],
    ["release bundle build", ":product:bundleRelease"],
    ["AAB-derived package validator", "validate-product-package.mjs"],
    ["bundletool universal APK", "--mode=universal"],
  ]);
  forbidText(sources, issues, "releaseBuilder", [
    ["legacy app build", ":app:"],
    ["legacy model build", ":llamaLib:"],
  ]);
  requireText(sources, issues, "releasePublisher", [
    ["stable channel", 'channel: "stable"'],
    ["product profile", 'profile: "product"'],
    ["immutable release path", 'versioned_relative_dir="releases/$version_code"'],
    ["product package validation", "validate-product-package.mjs"],
    ["sealed receipt verification", 'release-candidate.mjs" "${verify_arguments[@]}"'],
    ["immutable APK protection", "Refusing to replace immutable APK bytes"],
  ]);
  requireText(sources, issues, "releaseDeployer", [
    ["receipt-only public deployment", "$CandidateReceipt"],
    ["public artifact hash verification", "Get-FileHash -LiteralPath $source -Algorithm SHA256"],
    ["public release upload", '"release", "upload"'],
    ["exact Pages workflow dispatch", '"workflow", "run"'],
    ["public route verifier", "verify-public-pages-release.mjs"],
  ]);
  requireText(sources, issues, "retiredDebugPublisher", [
    ["retired debug channel notice", "The public debug channel is retired"],
    ["canonical release publisher referral", "publish-release.sh"],
  ]);

  return finishReport(issues);
}

export async function loadAndroidProjectSources({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const resolvedRoot = path.resolve(repoRoot);
  const entries = await Promise.all(
    Object.entries(ANDROID_PROJECT_SOURCE_FILES).map(async ([name, relativePath]) => {
      try {
        return [name, await readFile(path.join(resolvedRoot, relativePath), "utf8"), null];
      } catch (error) {
        return [name, undefined, error];
      }
    }),
  );
  const sources = {};
  const issues = [];
  for (const [name, source, error] of entries) {
    if (error) {
      addIssue(
        issues,
        ANDROID_PROJECT_ISSUE_CODES.FILE_MISSING,
        ANDROID_PROJECT_SOURCE_FILES[name],
        error.message,
      );
    } else {
      sources[name] = source;
    }
  }
  return { sources, issues };
}

export async function validateAndroidProject(options = {}) {
  const { sources, issues } = await loadAndroidProjectSources(options);
  const sourceReport = validateAndroidProjectSources(sources);
  return finishReport([...issues, ...sourceReport.issues]);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const report = await validateAndroidProject();
  if (!report.valid) {
    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Android project contract is valid.\n");
  }
}
