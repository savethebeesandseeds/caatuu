import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../../../../", import.meta.url);
const czechStatic = new URL("apps/languages/czech/static/", repoRoot);
const languageRuntimeStatic = new URL("apps/language-runtime/static/", repoRoot);
const launcherStatic = new URL("apps/launcher/static/", repoRoot);

const pageNames = ["chat.html", "conjugation-comet.html", "embedding-images.html", "verb-difficulty.html", "audio-lab.html"];
const registrySource = await readFile(new URL("languages.json", launcherStatic), "utf8");
const profileSource = await readFile(new URL("source/shared/course-profile.js", czechStatic), "utf8");
const mandarinProfileSource = await readFile(
  new URL("apps/languages/mandarin-simplified/static/source/shared/course-profile.js", repoRoot),
  "utf8"
);
const learningProfile = await readFile(new URL("source/learning-profile.js", languageRuntimeStatic), "utf8");
const launcher = await readFile(new URL("launcher.js", launcherStatic), "utf8");
const chrome = await readFile(new URL("source/caatuu-chrome.js", languageRuntimeStatic), "utf8");
const runtime = await readFile(new URL("source/shared/runtime.js", czechStatic), "utf8");
const app = await readFile(new URL("source/caatuu-workspace.js", languageRuntimeStatic), "utf8");
const wordWorld = await readFile(new URL("source/product-word-world.mjs", languageRuntimeStatic), "utf8");
const serviceWorker = await readFile(new URL("sw.js", czechStatic), "utf8");
const sharedServiceWorker = await readFile(
  new URL("source/course-service-worker.js", languageRuntimeStatic),
  "utf8"
);
const routes = await readFile(new URL("apps/server/src/routes/mod.rs", repoRoot), "utf8");
const gradle = await readFile(new URL("apps/android/app/build.gradle.kts", repoRoot), "utf8");
const assetClient = await readFile(
  new URL("apps/android/app/src/main/java/com/caatuu/android/CaatuuAssetClient.kt", repoRoot),
  "utf8"
);
const canonicalHome = await readFile(new URL("app/index.html", languageRuntimeStatic), "utf8");
const pages = await Promise.all(
  pageNames.map((name) => readFile(new URL(name, czechStatic), "utf8").then((source) => ({ name, source })))
);

const registry = JSON.parse(registrySource);
const profileContext = { window: {} };
vm.runInNewContext(profileSource, profileContext, { filename: "course-profile.js" });
const course = profileContext.window.CaatuuCourse;
const mandarinProfileContext = { window: {} };
vm.runInNewContext(mandarinProfileSource, mandarinProfileContext, { filename: "mandarin-course-profile.js" });
const mandarinCourse = mandarinProfileContext.window.CaatuuCourse;
const internalCatalog = JSON.parse(await readFile(new URL("apps/languages/catalog.json", repoRoot), "utf8"));
const czechManifest = JSON.parse(await readFile(new URL("apps/languages/czech/course.json", repoRoot), "utf8"));
const czechAndroidAssets = JSON.parse(await readFile(new URL("apps/languages/czech/android-assets.json", repoRoot), "utf8"));
const czechSetupAssets = JSON.parse(await readFile(new URL("setup-assets.json", czechStatic), "utf8"));
const sharedAppAssetCatalog = JSON.parse(await readFile(new URL("apps/language-runtime/app-assets.json", repoRoot), "utf8"));
const serverLanguageCatalog = await readFile(new URL("apps/server/src/language_catalog.rs", repoRoot), "utf8");
const sharedAppAssetOutputs = new Set(sharedAppAssetCatalog.assets.map(({ output }) => output));
const sharedInterfaceSource = `${canonicalHome}\n${chrome}`;
const sharedInterfaceIconNames = [...new Set(
  [
    ...[...sharedInterfaceSource.matchAll(/\/assets\/icons\/([^"'?]+_ui\.png)/gu)]
      .map((match) => match[1])
      .filter((name) => !name.includes("${")),
    ...(chrome.includes("difficulty_medal_${option.level}_ui.png")
      ? [1, 2, 3].map((level) => `difficulty_medal_${level}_ui.png`)
      : [])
  ]
)].sort();
const courseProfileIconNames = [...new Set(
  [...profileSource.matchAll(/\/assets\/icons\/([^"'?]+\.png)/gu)].map((match) => match[1])
)].sort();
const courseIdentityIconNames = [course.targetLanguage.flagSrc]
  .map((source) => /^\/assets\/icons\/([^"'?]+\.png)$/u.exec(source)?.[1])
  .filter(Boolean);
const interfaceIconNames = [...new Set([...sharedInterfaceIconNames, ...courseProfileIconNames])].sort();
const interfaceIconFiles = await Promise.all(
  interfaceIconNames.map((name) => readFile(new URL(`assets/icons/${name}`, launcherStatic)))
);

test("public registry and Czech course profile describe the same active app", () => {
  assert.equal(registry.schemaVersion, 1);
  assert.equal(course.schemaVersion, registry.schemaVersion);
  const ids = registry.languages.map((language) => language.id);
  assert.equal(new Set(ids).size, ids.length, "language IDs must be unique");
  assert.ok(ids.includes(registry.defaultLanguage), "default language must exist");

  const publicCourse = registry.languages.find((language) => language.id === course.id);
  assert.ok(publicCourse, "Czech course must be publicly registered");
  assert.equal(publicCourse.status, "active");
  assert.equal(publicCourse.routePrefix, course.routePrefix);
  assert.equal(publicCourse.entryPath, course.entryPath);
  assert.equal(publicCourse.locale, course.targetLanguage.locale);
  assert.equal(publicCourse.direction, course.targetLanguage.direction);
  assert.equal(publicCourse.shortCode, course.targetLanguage.shortCode);
  assert.equal(publicCourse.flagSrc, "/assets/icons/czech_flag_ui.png");
  assert.equal(course.targetLanguage.flagSrc, "/assets/icons/czech_flag_ui.png");
  assert.equal(publicCourse.sourceLanguage.id, course.sourceLanguage.id);
  assert.deepEqual(
    [...publicCourse.capabilities].sort(),
    Object.keys(course.capabilities)
      .filter((key) => publicCourse.capabilities.includes(key) && course.capabilities[key])
      .sort()
  );
  assert.equal(course.targetLanguage.script, czechManifest.targetLanguage.script);
  assert.equal(course.targetLanguage.speechLocale, czechManifest.targetLanguage.speechLocale);
  assert.equal(course.languageAdapter.module, "source/language/adapter.mjs");
  assert.deepEqual(publicCourse.platforms.android.channels, [
    { kind: "release", manifest: "/android/caatuu.json", artifact: "/android/caatuu.apk", minimumVersionCode: 160 },
    { kind: "preview", manifest: "/android/caatuu-preview.json", artifact: "/android/caatuu-preview.apk", minimumVersionCode: 160 }
  ], "the public launcher must label its gated preview channel explicitly");
});

test("course profile is immutable and owns language-scoped persistence", () => {
  assert.ok(Object.isFrozen(course));
  assert.ok(Object.isFrozen(course.targetLanguage));
  assert.ok(Object.isFrozen(course.storage));
  for (const [name, key] of Object.entries(course.storage)) {
    if (name === "namespace") continue;
    assert.ok(key.startsWith(`${course.storage.namespace}.`), `${name} must stay inside the course namespace`);
  }

  assert.match(chrome, /const themeStorageKey = course\.storage\.theme/);
  assert.match(chrome, /const fontSizeStorageKey = course\.storage\.fontSize/);
  assert.match(learningProfile, /course\.storage\.learningPreferences/);
  assert.match(learningProfile, /course\.storage\.learningPerformance/);
  assert.match(runtime, /const cachePrefix = course\.cache\.prefix/);
  assert.match(runtime, /const modulePath = String\(course\.languageAdapter\?\.module/);
  assert.match(runtime, /adapter\.languageTags\?\.locale !== course\.targetLanguage\.locale/);
  assert.match(runtime, /language:\s*\{\s*adapter: loadLanguageAdapter/);
  assert.match(app, /const verbStorageKey = course\.storage\.verbMemory/);
  assert.doesNotMatch(app, /["']cs-CZ["']/);
  assert.match(wordWorld, /const targetSpeechLocale = course\.targetLanguage\.speechLocale \|\| targetLocale/);
  assert.doesNotMatch(wordWorld, /["']cs-CZ["']/);
});

test("shared course chrome gates Android publication and developer tools through course data", () => {
  assert.match(chrome, /const androidPlatform = course\.platforms\?\.android/);
  assert.match(chrome, /androidPlatform\?\.enabled !== true \|\| !Array\.isArray\(androidPlatform\.channels\)/);
  assert.match(chrome, /const channels = configuredAndroidChannels\(\)/);
  assert.match(chrome, /Number\.isSafeInteger\(manifest\?\.version_code\)/);
  assert.match(chrome, /manifest\.version_code < channel\.minimumVersionCode/);
  assert.match(chrome, /disableAndroidInstallDiscovery\(action, status\)/);
  assert.match(chrome, /action\.hidden = true/);
  assert.doesNotMatch(chrome, /\/android\/caatuu(?:-preview)?\.(?:json|apk)/u);

  assert.equal(course.platforms.android.enabled, true);
  assert.equal(course.platforms.android.channels.length, 2);
  assert.equal(mandarinCourse.platforms.android.enabled, false);
  assert.equal(mandarinCourse.platforms.android.channels.length, 0);

  const channelValidationStart = chrome.indexOf("function validAndroidChannelManifest(channel, manifest)");
  const channelValidationEnd = chrome.indexOf("function disableAndroidInstallDiscovery(action, status)", channelValidationStart);
  assert.ok(channelValidationStart >= 0 && channelValidationEnd > channelValidationStart);
  const androidContext = {
    course,
    URL,
    window: { location: { origin: "https://caatuu.example" } }
  };
  vm.runInNewContext(
    `${chrome.slice(channelValidationStart, channelValidationEnd)}\nthis.validManifest = validAndroidChannelManifest; this.configuredChannels = configuredAndroidChannels;`,
    androidContext,
    { filename: "caatuu-chrome-android-channels.js" }
  );
  const releaseChannel = course.platforms.android.channels[0];
  const releaseManifest = {
    package_name: "com.waajacu.caatuu",
    build_type: "release",
    debuggable: false,
    version_code: 160
  };
  assert.equal(androidContext.validManifest(releaseChannel, releaseManifest), true);
  assert.equal(androidContext.validManifest(releaseChannel, { ...releaseManifest, version_code: 159 }), false);
  assert.equal(androidContext.validManifest(releaseChannel, { ...releaseManifest, version_code: "160" }), false);
  androidContext.course = {
    platforms: {
      android: {
        enabled: true,
        channels: [{ kind: "release", manifest: "/android/example.json", artifact: "/android/example.apk" }]
      }
    }
  };
  assert.equal(androidContext.configuredChannels().length, 0, "runtime data without a compatibility floor must fail closed");

  const developerStart = chrome.indexOf("function renderDeveloperToolLinks()");
  const developerEnd = chrome.indexOf("function renderSettingsPanel(panel)", developerStart);
  assert.ok(developerStart >= 0 && developerEnd > developerStart);
  const developerContext = { course };
  vm.runInNewContext(
    `${chrome.slice(developerStart, developerEnd)}\nthis.renderLinks = renderDeveloperToolLinks; this.reconcile = reconcileDeveloperToolVisibility;`,
    developerContext,
    { filename: "caatuu-chrome-developer-tools.js" }
  );
  const czechLinks = developerContext.renderLinks();
  for (const route of ["chat.html", "audio-lab.html", "index.html", "embedding-images.html", "verb-difficulty.html"]) {
    assert.ok(czechLinks.includes(`href="${route}"`), `Czech developer tools must use the authored ${route} route`);
  }

  developerContext.course = mandarinCourse;
  assert.equal(developerContext.renderLinks(), "", "Mandarin must not inherit conventional Czech developer-page names");
  let removed = 0;
  developerContext.reconcile({
    querySelector(selector) {
      assert.equal(selector, ".developer-tools-details");
      return { remove() { removed += 1; } };
    }
  }, "");
  assert.equal(removed, 1, "an empty Developer section must be removed from the shared settings DOM");
  assert.match(chrome, /const routes = course\.routes \|\| \{\}/);
  assert.doesNotMatch(
    chrome.slice(developerStart, developerEnd),
    /href:\s*["'](?:chat|audio-lab|embedding-images|verb-difficulty)\.html["']/u
  );
});

test("the canonical home and Czech secondary pages load course data before shared runtime", () => {
  const profileIndex = canonicalHome.indexOf('src="source/shared/course-profile.js?v=course-25"');
  const bootstrapIndex = canonicalHome.indexOf('src="/language-runtime/static/source/app-bootstrap.mjs?v=app-10"');
  assert.ok(profileIndex >= 0, "the canonical app must load its route-local course profile");
  assert.ok(bootstrapIndex > profileIndex, "the canonical app must load its course profile before the shared bootstrap");
  for (const { name, source } of pages) {
    const profileIndex = source.indexOf('src="source/shared/course-profile.js?v=course-25"');
    const learningIndex = source.indexOf('src="/language-runtime/static/source/learning-profile.js?v=learning-5"');
    const runtimeIndex = source.indexOf('src="source/shared/runtime.js');
    const semanticIndex = source.indexOf('src="source/shared/semantic-learning.js?v=semantic-learning-7"');
    const chromeIndex = source.indexOf('src="/language-runtime/static/source/caatuu-chrome.js');
    assert.ok(profileIndex >= 0, `${name} must load the course profile`);
    assert.ok(learningIndex > profileIndex, `${name} must load learning state after the course profile`);
    assert.ok(runtimeIndex > profileIndex, `${name} must load the profile before runtime.js`);
    assert.ok(semanticIndex > runtimeIndex, `${name} must load semantic state after runtime.js`);
    assert.ok(chromeIndex > semanticIndex, `${name} must load semantic state before chrome.js`);
    assert.match(source, /window\.CaatuuCourse\.storage\.theme/);
    assert.match(source, /window\.CaatuuCourse\.storage\.fontSize/);
  }
  assert.match(
    serviceWorker,
    /importScripts\("\/language-runtime\/static\/source\/course-service-worker\.js"\)/
  );
  assert.match(
    sharedServiceWorker,
    /const CAATUU_CANONICAL_APP_ENTRY = "apps\/language-runtime\/static\/app\/index\.html"/
  );
  assert.match(sharedServiceWorker, /application\?\.appEntry !== CAATUU_CANONICAL_APP_ENTRY/);
  assert.match(sharedServiceWorker, /Array\.isArray\(offline\?\.assets\)/);
  const offlineAssets = new Set(czechSetupAssets.offline.assets.map((asset) => asset.replace(/^\.\//u, "")));
  for (const asset of [
    "source/shared/course-profile.js?v=course-25",
    "source/language/adapter.mjs",
    "/language-runtime/contract.mjs",
    "/language-runtime/static/source/learning-profile.js?v=learning-5",
    "source/shared/semantic-learning.js?v=semantic-learning-7",
    "/language-runtime/static/source/caatuu-chrome.js?v=chrome-122"
  ]) {
    assert.ok(offlineAssets.has(asset), `setup-assets.json must own ${asset}`);
  }
});

test("launcher discovers active languages instead of embedding product behavior", () => {
  assert.match(launcher, /const registryPath = "\/languages\.json"/);
  assert.match(launcher, /registry\.languages\.filter\(\(language\) => language\.status === "active"\)/);
  assert.match(launcher, /browserEntry\.href = browser\?\.enabled \? browser\.entryPath : language\.entryPath/);
  assert.match(launcher, /android\.channels/);
  assert.match(launcher, /channel\.kind === "preview"/);
  assert.match(launcher, /manifest\.build_type === "debug" && manifest\.debuggable === true/);
  assert.match(launcher, /manifest\.build_type === "release" && manifest\.debuggable === false/);
  assert.match(launcher, /Number\.isSafeInteger\(manifest\?\.version_code\)/);
  assert.match(launcher, /manifest\.version_code < channel\.minimumVersionCode/);
  assert.doesNotMatch(launcher, /caatuu-debug/);
  assert.doesNotMatch(launcher, /\/android\/caatuu/u, "launcher JavaScript must not invent Czech Android channels");
  const loadRegistryStart = launcher.indexOf("async function loadRegistry()");
  const loadRegistryEnd = launcher.indexOf("function scheduleAvailabilityRefresh", loadRegistryStart);
  assert.ok(loadRegistryStart >= 0 && loadRegistryEnd > loadRegistryStart);
  const loadRegistry = launcher.slice(loadRegistryStart, loadRegistryEnd);
  assert.match(loadRegistry, /catch \(error\)[\s\S]*setDownloadUnavailable\("Android availability could not be loaded"\)/);
  assert.doesNotMatch(loadRegistry, /selectAvailableChannel\(/, "registry failure must not expose an invented Android download");
});

test("launcher recovers from stale normal-browser availability state", () => {
  assert.match(launcher, /function freshRequestUrl\(path, purpose = "availability"\)/);
  assert.match(launcher, /function versionedArtifactUrl\(path, manifest\)/);
  assert.match(launcher, /caatuu_release/);
  assert.match(launcher, /Check Android download again/);
  assert.match(launcher, /window\.addEventListener\("pageshow"/);
  assert.match(launcher, /document\.addEventListener\("visibilitychange"/);
  assert.match(launcher, /removeLegacyRootServiceWorker/);
  assert.match(launcher, /scopePath === "\/" \? registration\.unregister\(\)/);
  assert.match(routes, /HeaderValue::from_static\("no-store, max-age=0"\)/);
  assert.match(chrome, /caatuu_release/);
  assert.match(chrome, /caatuu:settings-open/);
  assert.match(chrome, /action\.textContent = "Check again"/);
});

test("runtime and Android mount the language declared by their build contracts", () => {
  const catalogEntry = internalCatalog.courses.find((entry) => entry.id === czechManifest.id);
  assert.deepEqual(catalogEntry, {
    id: "cz",
    manifest: "apps/languages/czech/course.json"
  });
  assert.equal(czechManifest.routePrefix, course.routePrefix);
  assert.equal(czechManifest.entryPath, course.entryPath);
  assert.equal(czechManifest.platforms.browser.enabled, true);
  assert.equal(czechManifest.platforms.browser.backend, "czech-dictionary");
  assert.equal(czechManifest.resources.staticRoot.path, "apps/languages/czech/static");
  assert.deepEqual(czechManifest.resources.appEntry, {
    kind: "file",
    path: "apps/language-runtime/static/app/index.html",
    scope: "shared",
    state: "present"
  });

  assert.match(routes, /load_mounted_language_apps\(&workspace\)/);
  assert.match(routes, /mounted_language_apps\.iter\(\)\.fold/);
  assert.match(routes, /route_service\(&entry_route, ServeFile::new\(spec\.app_entry\.clone\(\)\)\)/);
  assert.match(routes, /route_service\(&index_route, ServeFile::new\(spec\.app_entry\.clone\(\)\)\)/);
  assert.match(routes, /\.nest\(&spec\.route_prefix, build_language_app\(spec\)\)/);
  assert.doesNotMatch(routes, /ACTIVE_LANGUAGE_APPS/);
  assert.match(serverLanguageCatalog, /apps\/languages\/catalog\.json/);
  assert.match(serverLanguageCatalog, /browser-enabled course/);
  assert.match(serverLanguageCatalog, /CANONICAL_BROWSER_APP_ENTRY_PATH/);
  assert.match(serverLanguageCatalog, /app_entry_resource\.scope != "shared"/);

  assert.match(gradle, /gradleProperty\("caatuuCourseManifest"\)/);
  assert.match(gradle, /\.orElse\("apps\/languages\/czech\/course\.json"\)/);
  assert.match(gradle, /val bundledLanguageId = requiredString\(courseManifest\["id"\], "course id"\)/);
  assert.match(gradle, /val languageStaticRelativePath = courseResourcePath\("staticRoot", "directory"\)/);
  assert.match(gradle, /val courseCapabilities = requiredObject\(courseManifest\["capabilities"\], "course capabilities"\)/);
  assert.match(gradle, /bundledLanguageId == "cz"/);
  assert.match(gradle, /supports only the canonical Czech course identity/);
  assert.doesNotMatch(gradle, /caatuuLanguageId|caatuuLanguageAppDir/);
  assert.match(gradle, /buildConfigField\("String", "CAATUU_LANGUAGE_ROUTE_PREFIX"/);
  assert.match(gradle, /buildConfigField\("String", "CAATUU_LANGUAGE_ENTRY_PATH"/);
  assert.match(assetClient, /path == LANGUAGE_ROUTE_PREFIX \|\| path\.startsWith\("\$LANGUAGE_ROUTE_PREFIX\/"\)/);
  assert.match(assetClient, /val START_URL = "https:\/\/\$HOST\$LANGUAGE_ENTRY_PATH"/);
  assert.doesNotMatch(assetClient, /path == "\/cz"/);
  assert.doesNotMatch(assetClient, /location\.replace\("\/cz/);
});

test("Android caches immutable APK resources while mutable local assets stay fresh", () => {
  assert.match(assetClient, /BUNDLED_ASSET_HEADERS = mapOf\(/);
  assert.match(assetClient, /"Cache-Control" to "private, max-age=31536000, immutable"/);
  assert.match(assetClient, /context\.assets\.open\(assetPath\),[\s\S]*?responseHeaders = BUNDLED_ASSET_HEADERS/);
  assert.match(assetClient, /localVectorDatabase\.inputStream\(\),[\s\S]*?"Cache-Control" to "no-store"/);
  assert.match(assetClient, /localSetupAsset\.inputStream\(\),[\s\S]*?"Cache-Control" to "no-store"/);
});

test("Android packages shared app icons from the app catalog and the current course identity from its course catalog", () => {
  assert.equal(sharedAppAssetCatalog.appEntry, "apps/language-runtime/static/app/index.html");
  assert.match(
    gradle,
    /for \(\(source, outputPath\) in sharedAppAssets\) \{[\s\S]*?from\(workspaceRootDir\.file\(source\)\)/
  );
  assert.match(
    gradle,
    /androidLauncherIconFiles\.filterNot \{ "assets\/icons\/\$it" in sharedAppAssetOutputs \}/
  );
  assert.ok(sharedInterfaceIconNames.length > 0, "the shared interface should declare optimized UI icons");
  assert.deepEqual(
    sharedInterfaceIconNames.filter((iconName) => !sharedAppAssetOutputs.has(`assets/icons/${iconName}`)),
    [],
    "the shared app asset catalog must own every shared UI icon"
  );
  assert.deepEqual(
    courseIdentityIconNames.filter((iconName) => !czechAndroidAssets.launcherIconFiles.includes(iconName)),
    [],
    "the Czech Android catalog must own its course identity icons"
  );
  assert.deepEqual(
    interfaceIconFiles.map((icon) => icon.byteLength > 0),
    interfaceIconNames.map(() => true)
  );
});
