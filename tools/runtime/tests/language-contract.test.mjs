import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../../../", import.meta.url);
const czechStatic = new URL("apps/caatuu-czech/static/", repoRoot);
const unifiedStatic = new URL("apps/caatuu-unified/static/", repoRoot);

const pageNames = ["home.html", "index.html", "chat.html", "word-net.html", "embedding-images.html"];
const [registrySource, profileSource, learningProfile, launcher, chrome, runtime, app, wordWorld, serviceWorker, routes, gradle, assetClient, ...pages] = await Promise.all([
  readFile(new URL("languages.json", unifiedStatic), "utf8"),
  readFile(new URL("course-profile.js", czechStatic), "utf8"),
  readFile(new URL("learning-profile.js", czechStatic), "utf8"),
  readFile(new URL("launcher.js", unifiedStatic), "utf8"),
  readFile(new URL("chrome.js", czechStatic), "utf8"),
  readFile(new URL("runtime.js", czechStatic), "utf8"),
  readFile(new URL("app.js", czechStatic), "utf8"),
  readFile(new URL("word-net.js", czechStatic), "utf8"),
  readFile(new URL("sw.js", czechStatic), "utf8"),
  readFile(new URL("apps/caatuu-runtime/src/routes/mod.rs", repoRoot), "utf8"),
  readFile(new URL("apps/caatuu-android/app/build.gradle.kts", repoRoot), "utf8"),
  readFile(new URL("apps/caatuu-android/app/src/main/java/com/caatuu/android/CaatuuAssetClient.kt", repoRoot), "utf8"),
  ...pageNames.map((name) => readFile(new URL(name, czechStatic), "utf8").then((source) => ({ name, source })))
]);

const registry = JSON.parse(registrySource);
const profileContext = { window: {} };
vm.runInNewContext(profileSource, profileContext, { filename: "course-profile.js" });
const course = profileContext.window.CaatuuCourse;

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
  assert.equal(publicCourse.flagSrc, "/assets/icons/czech_flag.png");
  assert.equal(course.targetLanguage.flagSrc, "logos/czech_flag.png");
  assert.equal(publicCourse.sourceLanguage.id, course.sourceLanguage.id);
  assert.deepEqual([...publicCourse.capabilities].sort(), Object.keys(course.capabilities).filter((key) => course.capabilities[key]).sort());
  assert.deepEqual(publicCourse.platforms.android.channels, [
    { manifest: "/android/caatuu.json", artifact: "/android/caatuu.apk" }
  ], "the public launcher must not silently fall back to a debug APK");
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
  assert.match(learningProfile, /course\.storage\.learningPreferences/);
  assert.match(learningProfile, /course\.storage\.learningPerformance/);
  assert.match(runtime, /const cachePrefix = course\.cache\.prefix/);
  assert.match(app, /const verbStorageKey = course\.storage\.verbMemory/);
  assert.doesNotMatch(app, /["']cs-CZ["']/);
  assert.match(wordWorld, /const targetLocale = course\.targetLanguage\.locale/);
  assert.doesNotMatch(wordWorld, /toLocaleLowerCase\("cs-CZ"\)/);
});

test("every Czech page loads its course profile before runtime and shared Chrome", () => {
  for (const { name, source } of pages) {
    const profileIndex = source.indexOf('src="course-profile.js?v=course-3"');
    const learningIndex = source.indexOf('src="learning-profile.js?v=learning-1"');
    const runtimeIndex = source.indexOf('src="runtime.js');
    const chromeIndex = source.indexOf('src="chrome.js');
    assert.ok(profileIndex >= 0, `${name} must load the course profile`);
    assert.ok(learningIndex > profileIndex, `${name} must load learning state after the course profile`);
    assert.ok(runtimeIndex > profileIndex, `${name} must load the profile before runtime.js`);
    assert.ok(chromeIndex > learningIndex, `${name} must load learning state before chrome.js`);
    assert.match(source, /window\.CaatuuCourse\.storage\.theme/);
  }
  assert.match(serviceWorker, /\.\/course-profile\.js\?v=course-3/);
  assert.match(serviceWorker, /\.\/learning-profile\.js\?v=learning-1/);
});

test("launcher discovers active languages instead of embedding product behavior", () => {
  assert.match(launcher, /const registryPath = "\/languages\.json"/);
  assert.match(launcher, /registry\.languages\.filter\(\(language\) => language\.status === "active"\)/);
  assert.match(launcher, /browserEntry\.href = browser\?\.enabled \? browser\.entryPath : language\.entryPath/);
  assert.match(launcher, /android\.channels/);
  assert.match(launcher, /manifest\?\.build_type !== "release"/);
  assert.match(launcher, /manifest\?\.debuggable !== false/);
  assert.doesNotMatch(launcher, /caatuu-debug/);
});

test("runtime and Android mount the language declared by their build contracts", () => {
  assert.match(routes, /const ACTIVE_LANGUAGE_APPS: &\[LanguageAppSpec\]/);
  assert.match(routes, /id: "cz",\s*route_prefix: "\/cz",\s*static_dir: "apps\/caatuu-czech\/static",\s*entry_file: "home\.html"/);
  assert.match(routes, /ACTIVE_LANGUAGE_APPS\.iter\(\)\.fold/);
  assert.match(routes, /route_service\(&entry_route, ServeFile::new\(entry_file\)\)/);
  assert.match(routes, /\.nest\(spec\.route_prefix, build_language_app/);

  assert.match(gradle, /gradleProperty\("caatuuLanguageId"\)\.orElse\("cz"\)/);
  assert.match(gradle, /gradleProperty\("caatuuLanguageAppDir"\)\.orElse\("caatuu-czech"\)/);
  assert.match(gradle, /buildConfigField\("String", "CAATUU_LANGUAGE_ROUTE_PREFIX"/);
  assert.match(gradle, /buildConfigField\("String", "CAATUU_LANGUAGE_ENTRY_PATH"/);
  assert.match(assetClient, /path == LANGUAGE_ROUTE_PREFIX \|\| path\.startsWith\("\$LANGUAGE_ROUTE_PREFIX\/"\)/);
  assert.match(assetClient, /val START_URL = "https:\/\/\$HOST\$LANGUAGE_ENTRY_PATH"/);
  assert.doesNotMatch(assetClient, /path == "\/cz"/);
  assert.doesNotMatch(assetClient, /location\.replace\("\/cz/);
});
