#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, "..", "..");

const options = parseArgs(process.argv.slice(2));
const baseUrl = options.baseUrl ?? "http://127.0.0.1:8765";
const apkPath = resolve(workspaceRoot, options.apk ?? "artifacts/android/caatuu.apk");
const skipHttp = Boolean(options.skipHttp);
const skipApk = Boolean(options.skipApk);

const failures = [];

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--skip-http") {
      parsed.skipHttp = true;
    } else if (arg === "--skip-apk") {
      parsed.skipApk = true;
    } else if (arg.startsWith("--base-url=")) {
      parsed.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--base-url") {
      parsed.baseUrl = args[++index];
    } else if (arg.startsWith("--apk=")) {
      parsed.apk = arg.slice("--apk=".length);
    } else if (arg === "--apk") {
      parsed.apk = args[++index];
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function note(message) {
  console.log(`ok - ${message}`);
}

function finish() {
  if (failures.length === 0) {
    console.log("Caatuu runtime boundary audit passed.");
    return;
  }

  console.error("Caatuu runtime boundary audit failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
}

function listFiles(root, excludedSegments = new Set()) {
  const files = [];

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const rel = relative(root, path).split(sep).join("/");
      if ([...excludedSegments].some((segment) => rel === segment || rel.startsWith(`${segment}/`))) {
        continue;
      }

      const stat = statSync(path);
      if (stat.isDirectory()) {
        walk(path);
      } else if (stat.isFile()) {
        files.push(path);
      }
    }
  }

  walk(root);
  return files;
}

function workspaceRel(file) {
  return relative(workspaceRoot, file).split(sep).join("/");
}

function staticRel(root, file) {
  return relative(root, file).split(sep).join("/");
}

function isPackagedSourceFile(rel) {
  if (!/\.(?:html|css|js|json|webmanifest)$/.test(rel)) return false;
  if (rel.startsWith("vendor/")) return false;
  if (/^data\/models\/.*\.(?:gguf|bin|params|safetensors)$/i.test(rel)) return false;
  if (/^data\/models\/.*\/ndarray-cache\.json$/i.test(rel)) return false;
  if (rel.startsWith("data/models/czech-finetuned/")) return false;
  if (/^data\/embeddings\/.*\.(?:sqlite|db|wasm|onnx|bin|safetensors)$/i.test(rel)) return false;
  return true;
}

function auditLegacyNames() {
  const roots = [
    "README.md",
    "apps/caatuu-unified",
    "apps/caatuu-czech/README.md",
    "apps/caatuu-czech/static",
    "archive/caatuu-chinese/README.md",
    "apps/caatuu-runtime",
    "apps/caatuu-android/README.md",
    "apps/caatuu-android/app/build.gradle.kts",
    "apps/caatuu-android/app/src/main/java/com/caatuu/android",
    "tools/runtime/README.md"
  ];
  const excluded = new Set(["data", "vendor", "build", "target", "target-linux"]);
  const pattern = /device-ai|Device AI|device AI|device_ai|deviceAi/;

  for (const root of roots) {
    const abs = join(workspaceRoot, root);
    if (!existsSync(abs)) continue;

    const files = statSync(abs).isDirectory() ? listFiles(abs, excluded) : [abs];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (pattern.test(content) || pattern.test(relative(workspaceRoot, file))) {
        fail(`legacy device-ai naming remains in ${relative(workspaceRoot, file)}`);
      }
    }
  }

  note("active source tree has no device-ai naming");
}

function auditRepoOwnership() {
  const runtimeDir = join(workspaceRoot, "apps/caatuu-runtime");
  const activeChineseDir = join(workspaceRoot, "apps/caatuu-chinese");
  const chineseDir = join(workspaceRoot, "archive/caatuu-chinese");
  const runtimeCargo = join(runtimeDir, "Cargo.toml");
  const runtimeMain = join(runtimeDir, "src/main.rs");
  const runtimeRoutes = join(runtimeDir, "src/routes/mod.rs");
  const composeTools = join(workspaceRoot, "compose.tools.yaml");
  const startScript = join(workspaceRoot, "tools/runtime/start-caatuu.sh");

  assert(existsSync(runtimeCargo), "Rust runtime Cargo.toml should live in apps/caatuu-runtime");
  assert(existsSync(runtimeMain), "Rust runtime source should live in apps/caatuu-runtime/src");
  assert(existsSync(runtimeRoutes), "Rust runtime routes should live in apps/caatuu-runtime/src/routes");
  assert(!existsSync(activeChineseDir), "Chinese app should not live under apps/caatuu-chinese");
  assert(existsSync(chineseDir), "Chinese archive should live under archive/caatuu-chinese");

  if (existsSync(runtimeCargo)) {
    const cargo = readFileSync(runtimeCargo, "utf8");
    assert(cargo.includes('name = "caatuu-runtime"'), "Rust package should be named caatuu-runtime");
    assert(!cargo.includes('name = "caatuu-backend"'), "Rust package should not use the old caatuu-backend name");
  }

  const forbiddenChineseRuntimePaths = [
    "Cargo.toml",
    "Cargo.lock",
    "src",
    "profiles",
    "target",
    "target-linux",
    "env.sh",
    "env.local.sh",
    "run.sh"
  ];
  for (const entry of forbiddenChineseRuntimePaths) {
    assert(!existsSync(join(chineseDir, entry)), `Chinese archive should not contain runtime artifact ${entry}`);
  }

  if (existsSync(chineseDir)) {
    const allowedChineseEntries = new Set(["README.md", "static"]);
    for (const entry of readdirSync(chineseDir)) {
      assert(allowedChineseEntries.has(entry), `Chinese archive should only contain README.md and static/, found ${entry}`);
    }
  }

  const compose = existsSync(composeTools) ? readFileSync(composeTools, "utf8") : "";
  assert(compose.includes("/workspace/apps/caatuu-runtime"), "tools compose build should point at apps/caatuu-runtime");
  assert(!compose.includes("/workspace/apps/caatuu-chinese"), "tools compose build should not point at apps/caatuu-chinese");

  const start = existsSync(startScript) ? readFileSync(startScript, "utf8") : "";
  assert(start.includes("cd /workspace/apps/caatuu-runtime"), "runtime start script should cd into apps/caatuu-runtime");
  assert(start.includes("caatuu-runtime"), "runtime start script should execute caatuu-runtime");
  assert(!start.includes("caatuu-backend"), "runtime start script should not reference the old backend binary");
  assert(!start.includes("/workspace/apps/caatuu-chinese"), "runtime start script should not cd into the Chinese archive");

  const routes = existsSync(runtimeRoutes) ? readFileSync(runtimeRoutes, "utf8") : "";
  assert(routes.includes('workspace.join("archive/caatuu-chinese/static")'), "runtime routes should serve the Chinese archive from archive/caatuu-chinese");
  assert(!routes.includes('workspace.join("apps/caatuu-chinese/static")'), "runtime routes should not serve Chinese from apps/caatuu-chinese");

  note("repo ownership keeps Rust runtime separate from archived Chinese");
}

function request(pathname) {
  const url = new URL(pathname, baseUrl);
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolveRequest, rejectRequest) => {
    const req = client.request(
      url,
      { method: "GET", headers: { "User-Agent": "caatuu-runtime-boundary-audit" } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolveRequest({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body
          });
        });
      }
    );
    req.on("error", rejectRequest);
    req.end();
  });
}

async function auditHttpRoutes() {
  if (skipHttp) {
    note("HTTP route audit skipped");
    return;
  }

  const root = await request("/");
  assert(root.status === 200, `/ should return 200, got ${root.status}`);
  assert(root.body.includes("<title>Caatuu</title>"), "launcher root should serve the Caatuu title");
  assert(root.body.includes('href="/cz/"'), "launcher root should link to the Czech app");
  assert(root.body.includes('href="/android/caatuu.apk"'), "launcher root should link to the Android APK");
  assert(root.body.includes("Download the app"), "launcher root should offer the app download");
  assert(root.body.includes("Continue in Browser"), "launcher root should offer browser continuation");
  assert(root.body.includes("Welcome"), "launcher root should use the welcome eyebrow");
  assert(root.body.includes("Playful Czech practice for curious learners"), "launcher root should explain what Caatuu is");
  assert(root.body.includes("/assets/characters/macaw/explorer_hello.png.png"), "launcher root should use the hello explorer art");
  assert(root.body.includes("/assets/characters/macaw/explorer_select.png"), "launcher root should use the language-selection art");
  assert(!root.body.includes('href="/archive/chinese/"'), "launcher root should not link to the Chinese archive");
  assert(!root.body.includes("Chinese trainer"), "launcher root should not show the Chinese archive");
  assert(!root.body.includes("Chinese_Macaw"), "launcher root should not render the Chinese app art directly");

  const unknownRoot = await request("/definitely-missing-caatuu-page");
  assert(unknownRoot.status === 404, `/definitely-missing-caatuu-page should return 404, got ${unknownRoot.status}`);
  assert(unknownRoot.body.includes("This is not the page you are looking for"), "unknown root route should serve the branded not-found page");
  assert(!unknownRoot.body.includes("Move along, learner."), "not-found page should not include the removed speech bubble");
  assert(unknownRoot.body.includes("<summary>Details</summary>"), "not-found page should label the collapsible section Details");
  assert(unknownRoot.body.includes("HTTP 404 Not Found"), "not-found page should expose precise technical details");
  assert(unknownRoot.body.includes("/assets/characters/macaw/jedy_%20stop.png"), "not-found page should use the requested macaw art");

  const czechHome = await request("/cz/home.html");
  assert(czechHome.status === 200, `/cz/home.html should return 200, got ${czechHome.status}`);
  assert(czechHome.body.includes("<title>Caatuu Czech</title>"), "Czech home should serve the Czech title");
  assert(czechHome.body.includes("Czech_Macaw.png"), "Czech home should use Czech_Macaw art");
  assert(!czechHome.body.includes("archive/chinese"), "Czech home should not include archive links");

  const oldCzechFile = await request("/cz/device-ai.html");
  assert(oldCzechFile.status === 404, `/cz/device-ai.html should be retired as 404, got ${oldCzechFile.status}`);

  const rootApi = await request("/api/v1/health");
  assert(rootApi.status === 410, `/api/v1/health should be retired as 410, got ${rootApi.status}`);

  const rootWs = await request("/ws");
  assert(rootWs.status === 410, `/ws should be retired as 410, got ${rootWs.status}`);

  const archive = await request("/archive/chinese/");
  assert(archive.status === 200, `/archive/chinese/ should return 200, got ${archive.status}`);
  assert(archive.body.includes("<title>Caatuu Chinese</title>"), "archive should serve the Chinese title");
  assert(archive.body.includes("Chinese_Macaw.png"), "archive should keep Chinese art");

  const archiveApi = await request("/archive/chinese/api/v1/health");
  assert(archiveApi.status === 200, `/archive/chinese/api/v1/health should return 200, got ${archiveApi.status}`);

  const androidManifest = await request("/android/caatuu.json");
  assert(androidManifest.status === 200, `/android/caatuu.json should return 200, got ${androidManifest.status}`);
  assert(androidManifest.body.includes('"sha256"'), "Android update manifest should expose sha256");
  assert(androidManifest.body.includes('"apk_url"'), "Android update manifest should expose apk_url");
  assert(androidManifest.body.includes("/android/caatuu.apk"), "Android update manifest should point to /android/caatuu.apk");

  const legacyAndroidManifest = await request("/android/caatuu-debug.json");
  assert(legacyAndroidManifest.status === 200, `/android/caatuu-debug.json compatibility route should return 200, got ${legacyAndroidManifest.status}`);

  const termuxInstall = await request("/android/termux-install-debug.sh");
  assert(termuxInstall.status === 200, `/android/termux-install-debug.sh should return 200, got ${termuxInstall.status}`);
  assert(termuxInstall.body.includes('EXPECTED_SHA="${EXPECTED_SHA:-}"'), "Termux install helper should not hardcode a stale expected SHA");
  assert(termuxInstall.body.includes('"sha256"'), "Termux install helper should read sha256 from the manifest");

  const oldZh = await request("/zh/");
  assert(oldZh.status === 308, `/zh/ should redirect with 308, got ${oldZh.status}`);
  assert(oldZh.headers.location === "/archive/chinese/", `/zh/ should redirect to /archive/chinese/, got ${oldZh.headers.location}`);

  note(`HTTP route boundary matches ${baseUrl}`);
}

function unzip(args) {
  return execFileSync("unzip", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function auditApk() {
  if (skipApk) {
    note("APK audit skipped");
    return;
  }

  assert(existsSync(apkPath), `APK does not exist at ${apkPath}`);
  if (!existsSync(apkPath)) return;

  const apkRel = relative(workspaceRoot, apkPath).split(sep).join("/");
  const entries = unzip(["-Z1", apkRel]).split(/\r?\n/).filter(Boolean);
  const entrySet = new Set(entries);
  const requiredEntries = [
    "assets/home.html",
    "assets/index.html",
    "assets/chat.html",
    "assets/app.js",
    "assets/chat.js",
    "assets/runtime.js",
    "assets/chrome.js",
    "assets/maintenance-ui.js",
    "assets/setup.js",
    "assets/sw.js",
    "assets/vector-db.js",
    "assets/setup-assets.json",
    "assets/data/models/phone-bench/models.json",
    "assets/data/embeddings/models.json",
    "assets/data/embeddings/caatuu-local-hash-v0.1/manifest.json"
  ];
  for (const entry of requiredEntries) {
    assert(entrySet.has(entry), `APK is missing ${entry}`);
  }

  const staticRoot = join(workspaceRoot, "apps/caatuu-czech/static");
  const packagedSourceFiles = listFiles(staticRoot)
    .map((file) => staticRel(staticRoot, file))
    .filter(isPackagedSourceFile)
    .map((rel) => `assets/${rel}`);
  for (const entry of packagedSourceFiles) {
    assert(entrySet.has(entry), `APK is missing shared source file ${entry}`);
  }

  const forbiddenEntryPatterns = [
    /^assets\/.*device-ai/i,
    /^assets\/launcher\//,
    /^assets\/archive\//,
    /^assets\/vendor\/sql\.js\//,
    /^assets\/data\/models\/.*\.(?:gguf|bin|params|safetensors)$/i,
    /^assets\/data\/models\/.*\/ndarray-cache\.json$/i,
    /^assets\/data\/embeddings\/.*\.(?:sqlite|db|wasm|onnx|bin|safetensors)$/i,
    /^assets\/assets\/aliens\/(?:Chinese|English_American|Chinese_Macaw|Czech\.png)/,
  ];
  for (const entry of entries) {
    for (const pattern of forbiddenEntryPatterns) {
      if (pattern.test(entry)) {
        fail(`APK contains browser/archive-only asset ${entry}`);
      }
    }
  }

  const source = unzip([
    "-p",
    apkRel,
    "assets/app.js",
    "assets/chat.js",
    "assets/maintenance-ui.js",
    "assets/home.html",
    "assets/index.html",
    "assets/chrome.js",
    "assets/runtime.js"
  ]);
  const forbiddenSourcePatterns = [
    /device-ai|Device AI|device AI|device_ai|deviceAi/,
    /archive\/chinese/,
    /\/zh\b/,
    /Chinese_Macaw|English_American|Chinese\.png/
  ];
  for (const pattern of forbiddenSourcePatterns) {
    assert(!pattern.test(source), `APK Czech shell source contains forbidden pattern ${pattern}`);
  }

  const runtime = unzip(["-p", apkRel, "assets/runtime.js"]);
  assert(runtime.includes("caatuu.local"), "APK runtime.js should identify the native host");
  assert(runtime.includes("isNativeShell"), "APK runtime.js should expose native shell detection");
  assert(runtime.includes("isBrowserShell"), "APK runtime.js should expose browser shell detection");

  const manifestPath = join(workspaceRoot, "artifacts/android/caatuu.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const sha256 = createHash("sha256").update(readFileSync(apkPath)).digest("hex");
    assert(manifest.sha256 === sha256, "Android update manifest sha256 should match the APK");
    assert(manifest.bytes === statSync(apkPath).size, "Android update manifest byte size should match the APK");
    assert(manifest.apk_url?.endsWith("/android/caatuu.apk"), "Android update manifest should use the stable caatuu.apk URL");
  }
  assert(!existsSync(join(workspaceRoot, "artifacts/android/caatuu-debug.apk")), "Legacy caatuu-debug.apk should not remain as a duplicate artifact");
  assert(!existsSync(join(workspaceRoot, "artifacts/android/caatuu-debug.json")), "Legacy caatuu-debug.json should not remain as a duplicate artifact");

  note("Android APK contains only the expected native Czech shell assets");
}

function auditRuntimeAdapterBoundary() {
  const staticRoot = join(workspaceRoot, "apps/caatuu-czech/static");
  const runtimePath = join(staticRoot, "runtime.js");
  const runtime = readFileSync(runtimePath, "utf8");
  const appScripts = listFiles(staticRoot, new Set(["vendor"]))
    .filter((file) => /\.(?:js|html)$/.test(file))
    .filter((file) => !["runtime.js", "sw.js"].includes(staticRel(staticRoot, file)));

  for (const file of appScripts) {
    const source = readFileSync(file, "utf8");
    assert(!/CaatuuAndroid|CaatuuNative|nativeCall\s*\(/.test(source), `${workspaceRel(file)} should use CaatuuRuntime instead of the native bridge`);
    assert(!/web-llm|CreateMLCEngine|chat\.completions\.create|browserEngine/.test(source), `${workspaceRel(file)} should use CaatuuRuntime instead of owning the browser model runtime`);
  }

  assert(runtime.includes("window.CaatuuRuntime"), "runtime.js should expose window.CaatuuRuntime");
  assert(runtime.includes("window.CaatuuNative"), "runtime.js should own the native callback receiver");
  assert(runtime.includes("CaatuuAndroid"), "runtime.js should be the only first-party UI file that talks to CaatuuAndroid");
  assert(runtime.includes("CreateMLCEngine"), "runtime.js should own the browser WebLLM engine");
  const chrome = readFileSync(join(staticRoot, "chrome.js"), "utf8");
  const app = readFileSync(join(staticRoot, "app.js"), "utf8");
  const chat = readFileSync(join(staticRoot, "chat.js"), "utf8");
  assert(chrome.includes("renderAppHeader"), "chrome.js should own shared app header rendering");
  assert(chrome.includes("renderSettingsPanel"), "chrome.js should own shared settings rendering");
  assert(chrome.includes("renderBottomNav"), "chrome.js should own shared bottom nav rendering");
  assert(app.includes("CaatuuMaintenanceUi"), "app.js should use the shared maintenance UI helper");
  assert(chat.includes("CaatuuMaintenanceUi"), "chat.js should use the shared maintenance UI helper");
  const appUiSources = ["app.js", "chat.js", "index.html", "chat.html"]
    .map((name) => [name, readFileSync(join(staticRoot, name), "utf8")]);
  for (const [name, source] of appUiSources) {
    assert(!source.includes("appSettingsPanel"), `${name} should not use a page-specific settings panel id`);
    assert(!source.includes("openAppSettings"), `${name} should not use a page-specific settings open button id`);
  }
  assert(!chrome.includes("appSettingsPanel"), "chrome.js should not support the old page-specific settings panel mount");

  note("first-party UI controllers use the runtime adapter boundary");
}

function auditSetupManifest() {
  const manifestPath = join(workspaceRoot, "apps/caatuu-czech/static/setup-assets.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  assert(artifacts.length > 0, "setup-assets.json should define setup artifacts");

  for (const artifact of artifacts) {
    const target = `${artifact.url || ""} ${artifact.asset_path || ""}`;
    if (artifact.artifact_kind?.startsWith("browser-")) {
      assert(!artifact.native_required, `${artifact.key} is browser-only and should not be native_required`);
      assert(Boolean(artifact.browser_required), `${artifact.key} should be browser_required`);
    }
    if (artifact.native_required) {
      assert(!/vendor\/sql\.js|vector-db\.js|data\/embeddings/i.test(target), `${artifact.key} should not make browser runtime/data native-required`);
    }
  }

  note("setup artifact manifest separates browser and Android requirements");
}

function auditAndroidSource() {
  const clientPath = join(workspaceRoot, "apps/caatuu-android/app/src/main/java/com/caatuu/android/CaatuuAssetClient.kt");
  const mainPath = join(workspaceRoot, "apps/caatuu-android/app/src/main/java/com/caatuu/android/MainActivity.kt");
  const modelManagerPath = join(workspaceRoot, "apps/caatuu-android/app/src/main/java/com/caatuu/android/ModelManager.kt");
  const vectorDatabaseManagerPath = join(workspaceRoot, "apps/caatuu-android/app/src/main/java/com/caatuu/android/VectorDatabaseManager.kt");
  const staticAssetManagerPath = join(workspaceRoot, "apps/caatuu-android/app/src/main/java/com/caatuu/android/StaticAssetManager.kt");
  const gradlePath = join(workspaceRoot, "apps/caatuu-android/app/build.gradle.kts");
  const client = readFileSync(clientPath, "utf8");
  const main = readFileSync(mainPath, "utf8");
  const modelManager = readFileSync(modelManagerPath, "utf8");
  const vectorDatabaseManager = readFileSync(vectorDatabaseManagerPath, "utf8");
  const staticAssetManager = readFileSync(staticAssetManagerPath, "utf8");
  const gradle = readFileSync(gradlePath, "utf8");

  assert(client.includes('const val START_URL = "https://$HOST/cz/home.html"'), "Android start URL should be Czech home");
  assert(client.includes('path == "/cz" || path.startsWith("/cz/")'), "Android asset client should serve /cz paths");
  assert(client.includes('path.startsWith("/assets/")'), "Android asset client should serve shared asset paths");
  assert(!/archive\/chinese|\/zh\b/.test(client), "Android asset client should not serve archive or /zh paths");
  assert(main.includes("blockNetworkLoads = true"), "Android service worker settings should block network loads");
  assert(main.includes("setServiceWorkerClient"), "Android should install a service worker blocker");
  assert(modelManager.includes('MODEL_CATALOG_ASSET = "data/models/phone-bench/models.json"'), "Android ModelManager should read the shared model catalog");
  assert(vectorDatabaseManager.includes('EMBEDDING_CATALOG_ASSET = "data/embeddings/models.json"'), "Android VectorDatabaseManager should read the shared embedding catalog");
  assert(vectorDatabaseManager.includes("parseVectorDatabaseSpec"), "Android VectorDatabaseManager should parse embedding manifests instead of duplicating a hard-coded catalog");
  assert(!vectorDatabaseManager.includes("DEFAULT_DATABASE_URL"), "Android VectorDatabaseManager should not hard-code the embedding database URL");
  assert(!vectorDatabaseManager.includes("DEFAULT_DATABASE_SHA256"), "Android VectorDatabaseManager should not hard-code the embedding database hash");
  assert(staticAssetManager.includes('SETUP_ASSET_MANIFEST = "setup-assets.json"'), "Android StaticAssetManager should read the shared setup manifest");
  assert(staticAssetManager.includes("native_required"), "Android StaticAssetManager should filter setup-assets.json by native_required");
  assert(!staticAssetManager.includes("private val REQUIRED_ASSETS = listOf"), "Android setup assets should not be duplicated as a hard-coded Kotlin list");
  assert(!gradle.includes('exclude("sw.js")'), "Android asset packaging should include sw.js as shared source");
  assert(!gradle.includes('exclude("vector-db.js")'), "Android asset packaging should include vector-db.js as shared source");
  assert(gradle.includes('exclude("vendor/sql.js/**")'), "Android asset packaging should exclude browser sql.js vendor runtime");
  assert(gradle.includes('exclude("data/embeddings/**/*.sqlite")'), "Android asset packaging should exclude the heavy embedding SQLite DB");

  note("Android source enforces the native Czech runtime boundary");
}

async function main() {
  auditLegacyNames();
  auditRepoOwnership();
  auditRuntimeAdapterBoundary();
  auditSetupManifest();
  auditAndroidSource();
  await auditHttpRoutes();
  auditApk();
  finish();
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
