#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
const workspaceRoot = resolve(scriptDir, "..", "..", "..");
const failures = [];
const HTTP_REQUEST_TIMEOUT_MS = 10_000;
const HTTP_MAX_BODY_BYTES = 1024 * 1024;
const ANDROID_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const ANDROID_MUTABLE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, max-age=0";

const options = parseArgs(process.argv.slice(2));
if (failures.length > 0) {
  finish();
  process.exit(2);
}
const baseUrl = options.baseUrl ?? "http://127.0.0.1:8765";
const defaultApk = existsSync(join(workspaceRoot, "artifacts/android/caatuu.apk"))
  ? "artifacts/android/caatuu.apk"
  : "artifacts/android/caatuu-debug.apk";
const apkPath = resolve(workspaceRoot, options.apk ?? defaultApk);
const skipHttp = Boolean(options.skipHttp);
const skipApk = Boolean(options.skipApk);
const allowDebugArtifacts = Boolean(options.allowDebugArtifacts);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--skip-http") {
      parsed.skipHttp = true;
    } else if (arg === "--skip-apk") {
      parsed.skipApk = true;
    } else if (arg === "--allow-debug-artifacts") {
      parsed.allowDebugArtifacts = true;
    } else if (arg.startsWith("--base-url=")) {
      const value = arg.slice("--base-url=".length);
      if (value) parsed.baseUrl = value;
      else fail("--base-url requires a non-empty value");
    } else if (arg === "--base-url") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) fail("--base-url requires a value");
      else {
        parsed.baseUrl = value;
        index += 1;
      }
    } else if (arg.startsWith("--apk=")) {
      const value = arg.slice("--apk=".length);
      if (value) parsed.apk = value;
      else fail("--apk requires a non-empty value");
    } else if (arg === "--apk") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) fail("--apk requires a value");
      else {
        parsed.apk = value;
        index += 1;
      }
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
  if (!/\.(?:html|css|m?js|json|webmanifest)$/.test(rel)) return false;
  if (rel.startsWith("vendor/")) return false;
  if (/^data\/models\/.*\.(?:gguf|bin|params|safetensors)$/i.test(rel)) return false;
  if (/^data\/models\/.*\/ndarray-cache\.json$/i.test(rel)) return false;
  if (rel.startsWith("data/models/czech-finetuned/")) return false;
  if (/^data\/embeddings\/[^/]+\/runtime\//i.test(rel)) return false;
  if (/^data\/embeddings\/.*\.(?:sqlite|db|wasm|onnx|bin|safetensors)$/i.test(rel)) return false;
  if (/^data\/dictionaries\/.*\.sqlite$/i.test(rel)) return false;
  return true;
}

function auditLegacyNames() {
  const roots = [
    "README.md",
    "apps/launcher",
    "apps/languages/czech/README.md",
    "apps/languages/czech/static",
    "archive/caatuu-chinese/README.md",
    "apps/runtime",
    "apps/android/README.md",
    "apps/android/app/build.gradle.kts",
    "apps/android/app/src/main/java/com/caatuu/android",
    "apps/runtime/tooling/README.md"
  ];
  const excluded = new Set(["data", "vendor", "build", "target", "target-linux"]);
  const pattern = /device-ai|Device AI|device AI|device_ai|deviceAi/;

  for (const root of roots) {
    const abs = join(workspaceRoot, root);
    if (!existsSync(abs)) continue;

    const files = statSync(abs).isDirectory() ? listFiles(abs, excluded) : [abs];
    for (const file of files) {
      // The audit itself contains the retired spellings it is responsible for
      // detecting. Tooling now lives inside apps/runtime, so skip this file
      // explicitly instead of treating its match patterns as product source.
      if (resolve(file) === scriptPath) continue;
      const content = readFileSync(file, "utf8");
      if (pattern.test(content) || pattern.test(relative(workspaceRoot, file))) {
        fail(`legacy device-ai naming remains in ${relative(workspaceRoot, file)}`);
      }
    }
  }

  note("active source tree has no device-ai naming");
}

function auditRepoOwnership() {
  const runtimeDir = join(workspaceRoot, "apps/runtime");
  const activeChineseDir = join(workspaceRoot, "apps/caatuu-chinese");
  const chineseDir = join(workspaceRoot, "archive/caatuu-chinese");
  const runtimeCargo = join(runtimeDir, "Cargo.toml");
  const runtimeMain = join(runtimeDir, "src/main.rs");
  const runtimeRoutes = join(runtimeDir, "src/routes/mod.rs");
  const baseCompose = join(workspaceRoot, "compose.yaml");

  assert(existsSync(runtimeCargo), "Rust runtime Cargo.toml should live in apps/runtime");
  assert(existsSync(runtimeMain), "Rust runtime source should live in apps/runtime/src");
  assert(existsSync(runtimeRoutes), "Rust runtime routes should live in apps/runtime/src/routes");
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

  const compose = existsSync(baseCompose) ? readFileSync(baseCompose, "utf8") : "";
  assert(compose.includes("/workspace/apps/runtime"), "base Compose tooling should point at apps/runtime");
  assert(!compose.includes("/workspace/apps/caatuu-chinese"), "base Compose should not point at apps/caatuu-chinese");

  const routes = existsSync(runtimeRoutes) ? readFileSync(runtimeRoutes, "utf8") : "";
  assert(routes.includes('workspace.join("archive/caatuu-chinese/static")'), "runtime routes should serve the Chinese archive from archive/caatuu-chinese");
  assert(routes.includes('workspace.join("demos")'), "runtime routes should serve isolated projects from the top-level demos directory");
  assert(!routes.includes('workspace.join("apps/caatuu-chinese/static")'), "runtime routes should not serve Chinese from apps/caatuu-chinese");

  note("repo ownership keeps Rust runtime separate from archived Chinese");
}

function request(pathname, { method = "GET" } = {}) {
  const url = new URL(pathname, baseUrl);
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolveRequest, rejectRequest) => {
    let settled = false;
    let timer;
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRequest(value);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRequest(error);
    };
    const req = client.request(
      url,
      { method, headers: { "User-Agent": "caatuu-runtime-boundary-audit" } },
      (res) => {
        let body = "";
        let bodyBytes = 0;
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          bodyBytes += Buffer.byteLength(chunk, "utf8");
          if (bodyBytes > HTTP_MAX_BODY_BYTES) {
            rejectOnce(new Error(`HTTP response exceeded ${HTTP_MAX_BODY_BYTES} bytes for ${url}`));
            res.destroy();
            return;
          }
          body += chunk;
        });
        res.on("error", rejectOnce);
        res.on("end", () => {
          resolveOnce({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body
          });
        });
      }
    );
    timer = setTimeout(() => {
      req.destroy(new Error(`HTTP request timed out after ${HTTP_REQUEST_TIMEOUT_MS} ms: ${url}`));
    }, HTTP_REQUEST_TIMEOUT_MS);
    req.on("error", rejectOnce);
    req.end();
  });
}

function parseHttpJson(response, label) {
  try {
    return JSON.parse(response.body);
  } catch (error) {
    fail(`${label} should contain valid JSON: ${error.message}`);
    return null;
  }
}

function assertCacheControl(response, expected, label) {
  const actual = response.headers["cache-control"] ?? "";
  assert(
    actual === expected,
    `${label} should use Cache-Control: ${expected}, got ${actual || "<missing>"}`
  );
}

async function auditHttpRoutes() {
  if (skipHttp) {
    note("HTTP route audit skipped");
    return;
  }

  const root = await request("/");
  assert(root.status === 200, `/ should return 200, got ${root.status}`);
  assert(root.body.includes("<title>Caatuu</title>"), "launcher root should serve the Caatuu title");
  assert(root.body.includes('href="/cz/home.html"'), "launcher fallback should link to the Czech entry page");
  assert(root.body.includes('data-android-download'), "launcher root should expose a channel-aware Android download");
  assert(root.body.includes('/launcher.js?v=7'), "launcher root should load current language and Android channel discovery");
  assert(root.body.includes("Checking Android build"), "launcher root should announce Android channel discovery");
  assert(!root.body.includes('href="/android/caatuu-debug.apk"'), "launcher root must not offer a debug APK as a normal download");
  assert(root.body.includes("Continue in Browser"), "launcher root should offer browser continuation");
  assert(root.body.includes("Welcome space language traveler"), "launcher root should use the welcome eyebrow");
  assert(root.body.includes("Language App"), "launcher root should explain what Caatuu is");
  assert(root.body.includes("free, robust, agentic language-learning app"), "launcher root should describe Caatuu as free, robust, and agentic");
  assert(root.body.includes("Don't lose time, let's get started learning."), "launcher root should include the getting-started footnote");
  assert(root.body.includes("Available languages"), "launcher root should list available languages");
  assert(root.body.includes('aria-label="Czech"'), "launcher root should list Czech as an available language");
  assert(root.body.includes('<img class="flag-icon" src="/assets/icons/czech_flag.png" alt="">'), "launcher root should render the Czech flag PNG");
  assert(root.body.includes('<span class="language-choice-code">CZ</span>'), "launcher root should label the Czech language row");
  assert(root.body.includes("/assets/miscellaneous/burrow-review_062.png"), "launcher root should use the storybook schoolhouse showcase art");
  assert(root.body.includes("/assets/macaw/actions/macaw%20(23).png"), "launcher root should include the reading macaw");
  assert(root.body.includes("/assets/macaw/actions/macaw%20(62).png"), "launcher root should include the exploring macaw");
  assert(!root.body.includes("Select your planet"), "launcher root should not include the language selector");
  assert(!root.body.includes("/assets/macaw/actions/explorer_select.png"), "launcher root should keep language-selection art off the home page");
  assert(!root.body.includes('href="/archive/chinese/"'), "launcher root should not link to the Chinese archive");
  assert(!root.body.includes("Chinese trainer"), "launcher root should not show the Chinese archive");
  assert(!root.body.includes("Chinese_Macaw"), "launcher root should not render the Chinese app art directly");

  const launcher = await request("/launcher.js");
  assert(launcher.status === 200, `/launcher.js should return 200, got ${launcher.status}`);
  assert(launcher.body.includes('const registryPath = "/languages.json"'), "launcher should discover active languages from the registry");
  assert(launcher.body.includes('channel.kind === "preview"'), "launcher should identify the explicit preview channel");
  assert(launcher.body.includes('manifest.build_type === "debug" && manifest.debuggable === true'), "launcher should require preview manifests to describe debuggable builds");
  assert(launcher.body.includes('manifest.build_type === "release" && manifest.debuggable === false'), "launcher should require stable manifests to describe non-debuggable release builds");
  assert(!launcher.body.includes("caatuu-debug"), "launcher must not contain a public debug-channel fallback");

  const demos = await request("/demos/");
  assert(demos.status === 200, `/demos/ should return 200, got ${demos.status}`);
  assert(demos.body.includes("Caatuu Demos"), "demo catalog should identify itself");

  const worldMovement = await request("/demos/world-movement/");
  assert(worldMovement.status === 200, `/demos/world-movement/ should return 200, got ${worldMovement.status}`);
  assert(worldMovement.body.includes("World Movement Lab"), "world-movement route should serve the movement lab");

  const languageRegistryResponse = await request("/languages.json");
  assert(languageRegistryResponse.status === 200, `/languages.json should return 200, got ${languageRegistryResponse.status}`);
  const languageRegistry = parseHttpJson(languageRegistryResponse, "language registry");
  const activeCzech = languageRegistry?.languages?.find((language) => language.id === "cz" && language.status === "active");
  assert(languageRegistry?.schemaVersion === 1, "language registry should use the supported schema");
  assert(languageRegistry?.defaultLanguage === "cz", "language registry should name its default app");
  assert(activeCzech?.entryPath === "/cz/home.html", "active Czech registry entry should match the served route");
  assert(activeCzech?.platforms?.android?.channels?.length === 2, "public language registry should expose stable and explicit preview channels");
  assert(activeCzech?.platforms?.android?.channels?.[0]?.kind === "release", "public language registry should prefer the stable Android channel");
  assert(activeCzech?.platforms?.android?.channels?.[0]?.manifest === "/android/caatuu.json", "public language registry should expose the signed release manifest first");
  assert(activeCzech?.platforms?.android?.channels?.[1]?.kind === "preview", "public language registry should label the gated preview channel");
  assert(activeCzech?.platforms?.android?.channels?.[1]?.manifest === "/android/caatuu-preview.json", "public language registry should use the user-facing preview alias");

  const unknownRoot = await request("/definitely-missing-caatuu-page");
  assert(unknownRoot.status === 404, `/definitely-missing-caatuu-page should return 404, got ${unknownRoot.status}`);
  assert(unknownRoot.body.includes("This is not the page you are looking for"), "unknown root route should serve the branded not-found page");
  assert(!unknownRoot.body.includes("Move along, learner."), "not-found page should not include the removed speech bubble");
  assert(unknownRoot.body.includes("<summary>Details</summary>"), "not-found page should label the collapsible section Details");
  assert(unknownRoot.body.includes("HTTP 404 Not Found"), "not-found page should expose precise technical details");
  assert(unknownRoot.body.includes("/assets/macaw/actions/jedy_%20stop.png"), "not-found page should use the requested macaw art");

  const czechHome = await request("/cz/home.html");
  assert(czechHome.status === 200, `/cz/home.html should return 200, got ${czechHome.status}`);
  assert(czechHome.body.includes("<title>Caatuu</title>"), "Czech home should serve the shared Caatuu title");
  assert(!czechHome.body.includes("archive/chinese"), "Czech home should not include archive links");

  const setupAssets = await request("/cz/setup-assets.json");
  assert(setupAssets.status === 200, `/cz/setup-assets.json should return 200, got ${setupAssets.status}`);
  assert(setupAssets.body.includes("/assets/aliens/Czech_Macaw.png"), "Czech setup assets should use moved Czech_Macaw art");

  const loadingAnimationManifestResponse = await request("/assets/loading_animation/animations_manifest.json");
  assert(
    loadingAnimationManifestResponse.status === 200,
    `loading animation manifest should return 200, got ${loadingAnimationManifestResponse.status}`
  );
  const loadingAnimationManifest = parseHttpJson(
    loadingAnimationManifestResponse,
    "loading animation manifest"
  );
  const loadingAnimationSequence = loadingAnimationManifest?.animations?.[0];
  const loadingAnimationFile = loadingAnimationSequence?.sprites?.[0]?.file;
  assert(loadingAnimationFile, "loading animation manifest should contain at least one available frame");
  const loadingAnimationUrl = `/assets/loading_animation/${[
    loadingAnimationSequence.folder,
    loadingAnimationFile
  ].map(encodeURIComponent).join("/")}`;

  for (const [url, label] of [
    ["/assets/aliens/Czech_Macaw.png", "language mascot alias"],
    [loadingAnimationUrl, "loading animation alias"],
    ["/assets/miscellaneous/burrow-review_062.png", "visual vocabulary alias"]
  ]) {
    const asset = await request(url, { method: "HEAD" });
    assert(asset.status === 200, `${label} should return 200, got ${asset.status}`);
  }

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
  assert(archiveApi.status === 404, `/archive/chinese/api/v1/health should be disabled by default, got ${archiveApi.status}`);

  const androidManifest = await request("/android/caatuu.json");
  const androidApk = await request("/android/caatuu.apk", { method: "HEAD" });
  const stablePublicationContract = await request("/android/releases/status");
  assert(stablePublicationContract.status === 204, `stable immutable publication contract should return 204, got ${stablePublicationContract.status}`);
  assertCacheControl(androidManifest, ANDROID_MUTABLE_CACHE_CONTROL, "stable manifest alias");
  assertCacheControl(androidApk, ANDROID_MUTABLE_CACHE_CONTROL, "stable APK alias");
  assertCacheControl(stablePublicationContract, ANDROID_MUTABLE_CACHE_CONTROL, "stable publication status");
  if (androidManifest.status === 200) {
    const manifest = parseHttpJson(androidManifest, "stable Android manifest");
    assert(androidApk.status === 200, `/android/caatuu.apk should return 200 when its manifest is published, got ${androidApk.status}`);
    if (manifest) {
      assert(manifest.build_type === "release", "stable Android manifest should describe a release build");
      assert(manifest.debuggable === false, "stable Android manifest should reject debuggable builds");
      assert(/^[a-f0-9]{64}$/.test(manifest.sha256), "stable Android manifest should expose a SHA-256 digest");
      const expectedPath = `/android/releases/${manifest.version_code}/caatuu.apk`;
      assert(new URL(manifest.apk_url).pathname === expectedPath, `stable Android manifest should point to immutable ${expectedPath}`);
      const immutableApk = await request(expectedPath, { method: "HEAD" });
      assert(immutableApk.status === 200, `stable immutable APK should return 200, got ${immutableApk.status}`);
      assertCacheControl(immutableApk, ANDROID_IMMUTABLE_CACHE_CONTROL, "stable versioned APK");
    }
  } else {
    assert(androidManifest.status === 404, `/android/caatuu.json should return a release manifest or 404, got ${androidManifest.status}`);
    assert(androidApk.status === 404, `/android/caatuu.apk should not be published without its release manifest, got ${androidApk.status}`);
  }

  const debugAndroidManifest = await request("/android/caatuu-debug.json");
  const debugAndroidApk = await request("/android/caatuu-debug.apk", { method: "HEAD" });
  const previewAndroidManifest = await request("/android/caatuu-preview.json");
  const previewAndroidApk = await request("/android/caatuu-preview.apk", { method: "HEAD" });
  const debugPublicationContract = await request("/android/debug-releases/status");
  const termuxInstall = await request("/android/termux-install-debug.sh");
  if (allowDebugArtifacts) {
    assert(debugAndroidManifest.status === 200, `/android/caatuu-debug.json should return 200 when debug artifacts are enabled, got ${debugAndroidManifest.status}`);
    assert(debugAndroidApk.status === 200, `/android/caatuu-debug.apk should return 200 when debug artifacts are enabled, got ${debugAndroidApk.status}`);
    assert(previewAndroidManifest.status === 200, `/android/caatuu-preview.json should return 200 when preview artifacts are enabled, got ${previewAndroidManifest.status}`);
    assert(previewAndroidApk.status === 200, `/android/caatuu-preview.apk should return 200 when preview artifacts are enabled, got ${previewAndroidApk.status}`);
    assert(previewAndroidManifest.body === debugAndroidManifest.body, "preview and installed-client manifests should describe identical bytes");
    assert(debugPublicationContract.status === 204, `debug immutable publication contract should return 204, got ${debugPublicationContract.status}`);
    assertCacheControl(debugAndroidManifest, ANDROID_MUTABLE_CACHE_CONTROL, "debug manifest alias");
    assertCacheControl(debugAndroidApk, ANDROID_MUTABLE_CACHE_CONTROL, "debug APK alias");
    assertCacheControl(previewAndroidManifest, ANDROID_MUTABLE_CACHE_CONTROL, "preview manifest alias");
    assertCacheControl(previewAndroidApk, ANDROID_MUTABLE_CACHE_CONTROL, "preview APK alias");
    assertCacheControl(debugPublicationContract, ANDROID_MUTABLE_CACHE_CONTROL, "debug publication status");
    assertCacheControl(termuxInstall, ANDROID_MUTABLE_CACHE_CONTROL, "debug install helper");
    const manifest = parseHttpJson(debugAndroidManifest, "debug Android manifest");
    if (manifest) {
      assert(manifest.build_type === "debug", "debug Android manifest should identify its channel");
      assert(manifest.debuggable === true, "debug Android manifest should identify a debuggable build");
      assert(/^[a-f0-9]{64}$/.test(manifest.sha256), "debug Android manifest should expose a SHA-256 digest");
      const expectedPath = `/android/debug-releases/${manifest.version_code}/caatuu-debug.apk`;
      assert(new URL(manifest.apk_url).pathname === expectedPath, `debug manifest should point to immutable ${expectedPath}`);
      const immutableApk = await request(expectedPath, { method: "HEAD" });
      assert(immutableApk.status === 200, `debug immutable APK should return 200, got ${immutableApk.status}`);
      assertCacheControl(immutableApk, ANDROID_IMMUTABLE_CACHE_CONTROL, "debug versioned APK");
    }
    assert(termuxInstall.status === 200, `/android/termux-install-debug.sh should return 200 when debug artifacts are enabled, got ${termuxInstall.status}`);
    assert(termuxInstall.body.includes('EXPECTED_SHA="${EXPECTED_SHA:-}"'), "Termux install helper should not hardcode a stale expected SHA");
    assert(termuxInstall.body.includes('"sha256"'), "Termux install helper should read sha256 from the manifest");
  } else {
    assert(debugAndroidManifest.status === 404, `/android/caatuu-debug.json should be private by default, got ${debugAndroidManifest.status}`);
    assert(debugAndroidApk.status === 404, `/android/caatuu-debug.apk should be private by default, got ${debugAndroidApk.status}`);
    assert(previewAndroidManifest.status === 404, `/android/caatuu-preview.json should be private by default, got ${previewAndroidManifest.status}`);
    assert(previewAndroidApk.status === 404, `/android/caatuu-preview.apk should be private by default, got ${previewAndroidApk.status}`);
    assert(debugPublicationContract.status === 404, `debug immutable publication contract should be private by default, got ${debugPublicationContract.status}`);
    assert(termuxInstall.status === 404, `/android/termux-install-debug.sh should be private by default, got ${termuxInstall.status}`);
  }

  const oldZh = await request("/zh/");
  assert(oldZh.status === 308, `/zh/ should redirect with 308, got ${oldZh.status}`);
  assert(oldZh.headers.location === "/archive/chinese/", `/zh/ should redirect to /archive/chinese/, got ${oldZh.headers.location}`);

  note(`HTTP route boundary matches ${baseUrl}`);
}

function unzip(args) {
  const execOptions = {
    cwd: workspaceRoot,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  };
  try {
    return execFileSync("unzip", args, execOptions);
  } catch (error) {
    if (args[0] === "-Z1") {
      return execFileSync("tar", ["-tf", args[1]], execOptions);
    }
    if (args[0] === "-p") {
      const archive = args[1];
      return args
        .slice(2)
        .map((entry) => execFileSync("tar", ["-xOf", archive, entry], execOptions))
        .join("");
    }
    throw error;
  }
}

function unzipBuffer(archive, entry) {
  const execOptions = {
    cwd: workspaceRoot,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  };
  try {
    return execFileSync("unzip", ["-p", archive, entry], execOptions);
  } catch {
    return execFileSync("tar", ["-xOf", archive, entry], execOptions);
  }
}

function readUtf8Length(buffer, offset) {
  const first = buffer.readUInt8(offset);
  if ((first & 0x80) === 0) return [first, offset + 1];
  return [((first & 0x7f) << 8) | buffer.readUInt8(offset + 1), offset + 2];
}

function readUtf16Length(buffer, offset) {
  const first = buffer.readUInt16LE(offset);
  if ((first & 0x8000) === 0) return [first, offset + 2];
  return [((first & 0x7fff) << 16) | buffer.readUInt16LE(offset + 2), offset + 4];
}

function parseAndroidStringPool(buffer, chunkOffset) {
  const headerSize = buffer.readUInt16LE(chunkOffset + 2);
  const chunkSize = buffer.readUInt32LE(chunkOffset + 4);
  const stringCount = buffer.readUInt32LE(chunkOffset + 8);
  const flags = buffer.readUInt32LE(chunkOffset + 16);
  const stringsStart = buffer.readUInt32LE(chunkOffset + 20);
  const utf8 = (flags & 0x100) !== 0;
  const strings = [];

  for (let index = 0; index < stringCount; index += 1) {
    const stringOffset = buffer.readUInt32LE(chunkOffset + headerSize + index * 4);
    let cursor = chunkOffset + stringsStart + stringOffset;
    let byteLength;
    if (utf8) {
      [, cursor] = readUtf8Length(buffer, cursor);
      [byteLength, cursor] = readUtf8Length(buffer, cursor);
      strings.push(buffer.toString("utf8", cursor, cursor + byteLength));
    } else {
      let utf16Length;
      [utf16Length, cursor] = readUtf16Length(buffer, cursor);
      byteLength = utf16Length * 2;
      strings.push(buffer.toString("utf16le", cursor, cursor + byteLength));
    }
  }

  return { strings, chunkSize };
}

function parseAndroidTypedValue(buffer, offset, strings, rawValueIndex) {
  if (rawValueIndex !== 0xffffffff) return strings[rawValueIndex];

  const dataType = buffer.readUInt8(offset + 15);
  const data = buffer.readUInt32LE(offset + 16);
  if (dataType === 0x03) return strings[data];
  if (dataType === 0x12) return data !== 0;
  if (dataType === 0x10 || dataType === 0x11) return data;
  return data;
}

function parseAndroidBinaryManifest(buffer) {
  const RES_XML_TYPE = 0x0003;
  const RES_STRING_POOL_TYPE = 0x0001;
  const RES_XML_START_ELEMENT_TYPE = 0x0102;

  if (buffer.length < 8 || buffer.readUInt16LE(0) !== RES_XML_TYPE) {
    throw new Error("AndroidManifest.xml is not Android binary XML");
  }

  const documentSize = Math.min(buffer.readUInt32LE(4), buffer.length);
  let strings = null;
  const parsed = {
    packageName: null,
    versionCode: null,
    versionName: null,
    minSdkVersion: null,
    targetSdkVersion: null,
    debuggable: false,
    usesCleartextTraffic: false
  };

  for (let offset = buffer.readUInt16LE(2); offset + 8 <= documentSize;) {
    const chunkType = buffer.readUInt16LE(offset);
    const headerSize = buffer.readUInt16LE(offset + 2);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (headerSize < 8 || chunkSize < headerSize || offset + chunkSize > documentSize) {
      throw new Error(`invalid binary XML chunk at byte ${offset}`);
    }

    if (chunkType === RES_STRING_POOL_TYPE) {
      strings = parseAndroidStringPool(buffer, offset).strings;
    } else if (chunkType === RES_XML_START_ELEMENT_TYPE) {
      if (!strings) throw new Error("start element appears before the string pool");
      const extensionOffset = offset + headerSize;
      const tagNameIndex = buffer.readUInt32LE(extensionOffset + 4);
      const tagName = strings[tagNameIndex];
      const attributeStart = buffer.readUInt16LE(extensionOffset + 8);
      const attributeSize = buffer.readUInt16LE(extensionOffset + 10);
      const attributeCount = buffer.readUInt16LE(extensionOffset + 12);
      if (attributeSize < 20) throw new Error(`invalid attribute size on <${tagName}>`);

      const attributes = {};
      for (let index = 0; index < attributeCount; index += 1) {
        const attributeOffset = extensionOffset + attributeStart + index * attributeSize;
        if (attributeOffset + 20 > offset + chunkSize) {
          throw new Error(`attribute extends beyond <${tagName}> chunk`);
        }
        const nameIndex = buffer.readUInt32LE(attributeOffset + 4);
        const rawValueIndex = buffer.readUInt32LE(attributeOffset + 8);
        attributes[strings[nameIndex]] = parseAndroidTypedValue(buffer, attributeOffset, strings, rawValueIndex);
      }

      if (tagName === "manifest") {
        parsed.packageName = attributes.package ?? null;
        parsed.versionCode = attributes.versionCode ?? null;
        parsed.versionName = attributes.versionName ?? null;
      } else if (tagName === "uses-sdk") {
        parsed.minSdkVersion = attributes.minSdkVersion ?? null;
        parsed.targetSdkVersion = attributes.targetSdkVersion ?? null;
      } else if (tagName === "application") {
        parsed.debuggable = attributes.debuggable === true;
        parsed.usesCleartextTraffic = attributes.usesCleartextTraffic === true;
      }
    }

    offset += chunkSize;
  }

  if (!strings || !parsed.packageName) {
    throw new Error("Android manifest package metadata was not found");
  }
  return parsed;
}

function readSafeUInt64LE(buffer, offset, label) {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} is too large`);
  return Number(value);
}

function readLengthPrefixed32(buffer, offset, limit = buffer.length) {
  if (offset + 4 > limit) throw new Error("truncated length-prefixed APK signing field");
  const length = buffer.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  if (end > limit) throw new Error("APK signing field exceeds its container");
  return { payload: buffer.subarray(start, end), nextOffset: end };
}

function extractApkSignerCertificates(apk) {
  const ZIP_EOCD = 0x06054b50;
  const APK_SIG_MAGIC = Buffer.from("APK Sig Block 42", "ascii");
  const SIGNATURE_SCHEME_IDS = new Set([0x7109871a, 0xf05368c0, 0x1b93ad61]);
  const minimumEocdOffset = Math.max(0, apk.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = apk.length - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (apk.readUInt32LE(offset) === ZIP_EOCD) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("APK ZIP end-of-central-directory record was not found");

  const centralDirectoryOffset = apk.readUInt32LE(eocdOffset + 16);
  const footerOffset = centralDirectoryOffset - 24;
  if (footerOffset < 0 || !apk.subarray(footerOffset + 8, centralDirectoryOffset).equals(APK_SIG_MAGIC)) {
    throw new Error("APK Signing Block was not found");
  }

  const blockSize = readSafeUInt64LE(apk, footerOffset, "APK Signing Block size");
  const blockOffset = centralDirectoryOffset - blockSize - 8;
  if (blockOffset < 0 || readSafeUInt64LE(apk, blockOffset, "APK Signing Block header size") !== blockSize) {
    throw new Error("APK Signing Block size headers do not match");
  }

  const certificateBuffers = [];
  for (let offset = blockOffset + 8; offset < footerOffset;) {
    const pairSize = readSafeUInt64LE(apk, offset, "APK signing pair size");
    const pairEnd = offset + 8 + pairSize;
    if (pairSize < 4 || pairEnd > footerOffset) throw new Error("invalid APK signing pair size");
    const pairId = apk.readUInt32LE(offset + 8);
    if (SIGNATURE_SCHEME_IDS.has(pairId)) {
      const signerSequence = readLengthPrefixed32(apk.subarray(offset + 12, pairEnd), 0);
      const signers = signerSequence.payload;
      for (let signerOffset = 0; signerOffset < signers.length;) {
        const signerField = readLengthPrefixed32(signers, signerOffset);
        signerOffset = signerField.nextOffset;
        const signedDataField = readLengthPrefixed32(signerField.payload, 0);
        const digestsField = readLengthPrefixed32(signedDataField.payload, 0);
        const certificatesField = readLengthPrefixed32(signedDataField.payload, digestsField.nextOffset);
        for (let certificateOffset = 0; certificateOffset < certificatesField.payload.length;) {
          const certificateField = readLengthPrefixed32(certificatesField.payload, certificateOffset);
          certificateOffset = certificateField.nextOffset;
          certificateBuffers.push(certificateField.payload);
        }
      }
    }
    offset = pairEnd;
  }

  if (certificateBuffers.length === 0) throw new Error("APK v2/v3 signer certificate was not found");
  const uniqueCertificates = new Map();
  for (const certificate of certificateBuffers) {
    const digest = createHash("sha256").update(certificate).digest("hex");
    uniqueCertificates.set(digest, new X509Certificate(certificate));
  }
  return [...uniqueCertificates.values()];
}

function auditApk() {
  if (skipApk) {
    note("APK audit skipped");
    return;
  }

  assert(existsSync(apkPath), `APK does not exist at ${apkPath}`);
  if (!existsSync(apkPath)) return;

  const apkRel = relative(workspaceRoot, apkPath).split(sep).join("/");
  const apkBuffer = readFileSync(apkPath);
  const entries = unzip(["-Z1", apkRel]).split(/\r?\n/).filter(Boolean);
  const entrySet = new Set(entries);
  const requiredEntries = [
    "assets/home.html",
    "assets/index.html",
    "assets/chat.html",
    "assets/app.js",
    "assets/chat.js",
    "assets/course-profile.js",
    "assets/runtime.js",
    "assets/chrome.js",
    "assets/maintenance-ui.js",
    "assets/setup-progress.js",
    "assets/setup.js",
    "assets/sw.js",
    "assets/vector-db.js",
    "assets/word-net-core.mjs",
    "assets/setup-assets.json",
    "assets/data/models/phone-bench/models.json",
    "assets/data/embeddings/models.json",
    "assets/data/embeddings/caatuu-local-hash-v0.1/manifest.json",
    "assets/data/embeddings/all-minilm-l6-v2-qint8-v0.1/manifest.json",
    "assets/assets/icons/czech_flag.png",
    "assets/assets/icons/dark_mode.png",
    "assets/assets/icons/games_icon.png",
    "assets/assets/icons/gear_icon.png",
    "assets/assets/icons/hello.png",
    "assets/assets/icons/home_icon.png",
    "assets/assets/icons/backpack_icon.png",
    "assets/assets/icons/items_icon.png",
    "assets/assets/icons/stats_icon.png",
    "assets/vendor/sql.js/sql-wasm.js",
    "assets/vendor/sql.js/sql-wasm.wasm",
    "assets/vendor/transformers/transformers.min.js"
  ];
  for (const entry of requiredEntries) {
    assert(entrySet.has(entry), `APK is missing ${entry}`);
  }

  const staticRoot = join(workspaceRoot, "apps/languages/czech/static");
  const packagedSourceFiles = listFiles(staticRoot)
    .map((file) => ({ file, rel: staticRel(staticRoot, file) }))
    .filter(({ rel }) => isPackagedSourceFile(rel))
    .map(({ file, rel }) => ({ file, entry: `assets/${rel}` }));
  for (const { file, entry } of packagedSourceFiles) {
    assert(entrySet.has(entry), `APK is missing shared source file ${entry}`);
    if (entrySet.has(entry)) {
      try {
        assert(
          readFileSync(file).equals(unzipBuffer(apkRel, entry)),
          `APK contains a stale copy of shared source file ${entry}`
        );
      } catch (error) {
        fail(`Unable to compare packaged source file ${entry}: ${error.message}`);
      }
    }
  }

  const forbiddenEntryPatterns = [
    /^assets\/.*device-ai/i,
    /^assets\/launcher\//,
    /^assets\/archive\//,
    /^assets\/data\/models\/.*\.(?:gguf|bin|params|safetensors)$/i,
    /^assets\/data\/models\/.*\/ndarray-cache\.json$/i,
    /^assets\/data\/embeddings\/.*\.(?:sqlite|db|wasm|onnx|bin|safetensors)$/i,
    /^assets\/data\/dictionaries\/.*\.sqlite$/i,
    /^assets\/assets\/aliens\/(?:Chinese|English_American|Chinese_Macaw|Czech\.png)/,
    /^assets\/assets\/icons\/(?:china_flag|english_flag|france_flag|germany_flag|japan_flag|spain_flag)\.png$/,
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

  const apkName = basename(apkPath);
  const debugBuild = apkName === "caatuu-debug.apk";
  const releaseBuild = apkName === "caatuu.apk";
  assert(debugBuild || releaseBuild, `Android APK audit requires a channel filename (caatuu.apk or caatuu-debug.apk), got ${apkName}`);

  try {
    const signerCertificates = extractApkSignerCertificates(apkBuffer);
    const signerSubjects = signerCertificates.map((certificate) => certificate.subject);
    if (debugBuild) {
      assert(signerSubjects.some((subject) => /CN=Caatuu Debug(?:\n|,|$)/.test(subject)), "debug Android APK should use the dedicated Caatuu Debug signer");
    } else {
      assert(signerSubjects.every((subject) => !/(?:Android|Caatuu) Debug/i.test(subject)), "stable Android APK must not use a debug signing certificate");
    }

    const binaryManifest = parseAndroidBinaryManifest(unzipBuffer(apkRel, "AndroidManifest.xml"));
    assert(binaryManifest.packageName === "com.waajacu.caatuu", `Android APK package should be com.waajacu.caatuu, got ${binaryManifest.packageName}`);
    assert(binaryManifest.debuggable === debugBuild, `Android APK binary debuggable flag should match the ${debugBuild ? "debug" : "release"} channel`);
    assert(Number(binaryManifest.minSdkVersion) >= 30, `Android APK minSdkVersion should be at least 30, got ${binaryManifest.minSdkVersion}`);
    assert(Number(binaryManifest.targetSdkVersion) >= 36, `Android APK targetSdkVersion should be at least 36, got ${binaryManifest.targetSdkVersion}`);
    if (releaseBuild) {
      assert(binaryManifest.usesCleartextTraffic === false, "stable Android APK must disable cleartext traffic in its binary manifest");
    }

    const manifestPath = join(workspaceRoot, debugBuild ? "artifacts/android/caatuu-debug.json" : "artifacts/android/caatuu.json");
    assert(existsSync(manifestPath), `Android APK should have a matching update manifest at ${manifestPath}`);
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const sha256 = createHash("sha256").update(apkBuffer).digest("hex");
      assert(manifest.sha256 === sha256, "Android update manifest sha256 should match the APK");
      assert(manifest.bytes === statSync(apkPath).size, "Android update manifest byte size should match the APK");
      const expectedPath = debugBuild
        ? `/android/debug-releases/${manifest.version_code}/caatuu-debug.apk`
        : `/android/releases/${manifest.version_code}/caatuu.apk`;
      assert(new URL(manifest.apk_url).pathname === expectedPath, `Android update manifest should use immutable ${expectedPath}`);
      if (debugBuild && manifest.apk_url && !allowDebugArtifacts) {
        assert(new URL(manifest.apk_url).hostname !== "caatuu.waajacu.com", "debug Android manifest must not target the public host unless debug artifacts were explicitly allowed");
      }
      assert(manifest.build_type === (debugBuild ? "debug" : "release"), "Android manifest build_type should match its APK channel");
      assert(manifest.debuggable === debugBuild, "Android manifest debuggable flag should match its APK channel");
      assert(manifest.package_name === binaryManifest.packageName, "Android update manifest package_name should match the APK binary manifest");
      assert(manifest.version_code === binaryManifest.versionCode, "Android update manifest version_code should match the APK binary manifest");
      assert(manifest.version_name === binaryManifest.versionName, "Android update manifest version_name should match the APK binary manifest");

      const packagedAbis = new Set(entries.flatMap((entry) => {
        const match = /^lib\/([^/]+)\//.exec(entry);
        return match ? [match[1]] : [];
      }));
      const declaredAbis = new Set(String(manifest.abis ?? "").split(",").map((abi) => abi.trim()).filter(Boolean));
      assert(packagedAbis.size > 0, "Android APK should contain at least one native ABI");
      assert(
        packagedAbis.size === declaredAbis.size && [...packagedAbis].every((abi) => declaredAbis.has(abi)),
        `Android update manifest ABIs (${[...declaredAbis].join(", ")}) should match packaged ABIs (${[...packagedAbis].join(", ")})`
      );
    }
  } catch (error) {
    fail(`Unable to inspect Android APK binary manifest: ${error.message}. Ensure unzip or tar can extract AndroidManifest.xml.`);
  }

  note("Android APK contains only the expected native Czech shell assets");
}

function auditRuntimeAdapterBoundary() {
  const staticRoot = join(workspaceRoot, "apps/languages/czech/static");
  const runtimePath = join(staticRoot, "runtime.js");
  const runtime = readFileSync(runtimePath, "utf8");
  const appScripts = listFiles(staticRoot, new Set(["vendor"]))
    .filter((file) => /\.(?:m?js|html)$/.test(file))
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
  assert(runtime.includes('cache: "no-store"'), "browser setup downloads should bypass the PWA response cache");
  assert(runtime.includes("cancelTimedOutNativeRequest(id)"), "a timed-out UI request should cancel its native Android work");
  assert(runtime.includes('type: "cancel_request"'), "runtime.js should use request-scoped native cancellation");
  assert(runtime.includes("browserSetupGeneration"), "browser setup aborts should invalidate the complete setup run");
  assert((runtime.match(/assertBrowserSetupActive\(generation\)/g) || []).length >= 8, "browser setup should check cancellation between download, verification, and cache phases");
  assert(runtime.includes("const storedSha = (cached.headers.get(\"x-caatuu-setup-sha256\")"), "browser setup status should reuse verified cache metadata instead of rehashing every artifact");
  assert(runtime.includes("let browserModelLoad = null"), "browser model initialization should have a single tracked owner");
  assert(runtime.includes("if (browserModelLoad)"), "concurrent browser model loads should wait for the active initialization");
  assert(runtime.includes("await disposeBrowserEngine(engine)"), "a browser engine that finishes after cancellation should be disposed");
  assert(runtime.includes('nativeCall("reset_conversation", { modelKey })'), "the shared model adapter should expose conversation reset");
  const serviceWorker = readFileSync(join(staticRoot, "sw.js"), "utf8");
  assert(serviceWorker.includes('if (request.cache === "no-store")'), "the service worker should honor no-store setup downloads");
  assert(serviceWorker.includes("event.respondWith(fetch(request))"), "no-store setup downloads should go directly to the network");
  assert(serviceWorker.includes("A full quota must not hide a valid network response"), "opportunistic PWA cache failures should not fail successful network requests");
  const chrome = readFileSync(join(staticRoot, "chrome.js"), "utf8");
  const chromeCss = readFileSync(join(staticRoot, "chrome.css"), "utf8");
  const maintenanceUi = readFileSync(join(staticRoot, "maintenance-ui.js"), "utf8");
  const app = readFileSync(join(staticRoot, "app.js"), "utf8");
  const chat = readFileSync(join(staticRoot, "chat.js"), "utf8");
  const wordNet = readFileSync(join(staticRoot, "word-net.js"), "utf8");
  const wordNetQueue = readFileSync(join(staticRoot, "word-net-queue.mjs"), "utf8");
  const wordNetHtml = readFileSync(join(staticRoot, "word-net.html"), "utf8");
  const wordNetCss = readFileSync(join(staticRoot, "word-net.css"), "utf8");
  const dictionaryFull = readFileSync(join(staticRoot, "dictionary-full.js"), "utf8");
  assert(chrome.includes("renderAppHeader"), "chrome.js should own shared app header rendering");
  assert(chrome.includes("renderSettingsPanel"), "chrome.js should own shared settings rendering");
  assert(chrome.includes("renderBottomNav"), "chrome.js should own shared bottom nav rendering");
  assert(!chrome.includes('id="closeSettings"'), "shared Settings should not require a dedicated close button");
  assert(chrome.includes("advancedLink && panel && !panel.hidden"), "developer links should dismiss Settings even when their URL is already active");
  assert(chrome.includes('id="refreshBrowserAction">Update</button>'), "browser Settings should expose an explicit Update action");
  assert(chrome.includes('navigationAction.id !== "openSettings"'), "bottom navigation should dismiss Settings before continuing to another section");
  assert(chrome.includes("navigator.serviceWorker?.getRegistration"), "browser Update should ask the service worker for current assets before reloading");
  assert(maintenanceUi.includes("Browser app - use Update to load the latest version"), "browser version guidance should match the Update action");
  assert(chromeCss.includes("max-height: none"), "the local-artifact license list should show every row without an inner scroller");
  assert(!dictionaryFull.includes('source.textContent = "Wiktionary"'), "dictionary results should not repeat a Wiktionary link on every entry");
  assert(app.includes("CaatuuMaintenanceUi"), "app.js should use the shared maintenance UI helper");
  assert(app.includes('button.textContent = "Browser"'), "the browser install control should use the concise Browser label");
  assert(chat.includes("CaatuuMaintenanceUi"), "chat.js should use the shared maintenance UI helper");
  assert(wordNet.includes("runtimeAdapter()?.dictionary"), "Word World should use the shared Czech-to-English dictionary runtime");
  assert(wordNetHtml.includes('id="wordNetGenerationToggle"') && wordNetHtml.includes('data-generation-mode="random"') && wordNetHtml.includes('data-generation-mode="selected"'), "Word World should configure random and selected-word generation from the upper control");
  assert(wordNetHtml.includes('class="word-net-shuffle-icon"') && wordNetHtml.includes('data-generation-icon="random"'), "Word World's random generation control should use the crossed shuffle icon");
  assert(wordNet.includes('generationIcon.toggleAttribute("hidden"') && wordNetCss.includes('[data-generation-icon][hidden]'), "Word World should render exactly one generation-mode icon for HTML and SVG symbols");
  assert(wordNet.includes("generateFromConfiguredMode") && wordNet.includes("setGenerationMode(mode)"), "Word World's generation menu should save its mode and generate through one control");
  assert(wordNetHtml.includes('id="wordNetPrevious"') && wordNetHtml.includes('id="wordNetNext"') && wordNet.includes('$("#wordNetPrevious")') && wordNet.includes('$("#wordNetNext")'), "Word World should provide clickable previous and next controls at the panel edges");
  assert(!wordNet.includes("word-net-next-word") && !wordNetHtml.includes('id="wordNetNextWord"'), "Word World should not render a generation action above the selected token");
  assert(wordNet.includes("interpretHorizontalSwipe") && wordNet.includes("showPreviousSentence()"), "Word World should support next-on-swipe-left and previous-on-swipe-right navigation");
  assert(wordNet.includes("selectWord(button.dataset.word)"), "word clicks should select and translate instead of generating immediately");
  assert(!wordNet.includes('generateSentenceForWord(button.dataset.word, { source: "choice" })'), "word clicks should not generate the next sentence directly");
  assert(wordNetHtml.includes('id="wordNetDiagnostics"') && wordNet.includes("syncDiagnostics"), "Word World should expose compact live runtime details");
  assert(wordNet.includes("state.branchQueue.size") && wordNet.includes("diagnosticsModel"), "Word World runtime details should report the real branch queue and active model lane");
  assert(wordNet.includes('Boolean(state.selectedWord) && translationEnabled') && !wordNet.includes('Translation hidden.'), "Word World should remove the selected-word card when translation is off");
  const wordNetInit = wordNet.slice(
    wordNet.indexOf("async function init"),
    wordNet.indexOf("\ninit();"),
  );
  assert(
    wordNet.includes('const PREPARED_QUEUE_STORAGE_KEY = `${course.storage.namespace}.wordNet.preparedQueue.v2`')
      && wordNet.includes("entries: loadPreparedQueue()")
      && wordNet.includes("entries: state.branchQueue.snapshot()")
      && wordNetInit.includes("hydrateQueueFromHistory()"),
    "Word World should restore and persist its versioned prepared-sentence queue",
  );
  assert(
    wordNet.includes("const PREPARED_QUEUE_CAPACITY = 512")
      && wordNetQueue.includes("capacity = 512"),
    "Word World's reusable sentence queue should retain up to 512 prepared entries",
  );
  const wordNetRandomGeneration = wordNet.slice(
    wordNet.indexOf("function takeQueuedRandomCandidate"),
    wordNet.indexOf("function applyTranslationMode"),
  );
  const wordNetQueueTakeAny = wordNetQueue.slice(
    wordNetQueue.indexOf("takeAny({ preferredWords = []"),
    wordNetQueue.indexOf("markUsed(sentence)"),
  );
  assert(
    wordNetRandomGeneration.includes("state.branchQueue.takeAny({")
      && wordNetRandomGeneration.includes("async function generateRandomPhrase")
      && wordNetRandomGeneration.includes('cancelBackgroundWork({ preservePrefetch: state.translationMode === "off" })')
      && wordNetQueueTakeAny.includes("return this.use(this.choose(")
      && !wordNetQueueTakeAny.includes("this.entries ="),
    "Word World's random path should reuse saved entries without deleting them",
  );
  const wordNetSelectedGeneration = wordNet.slice(
    wordNet.indexOf("async function generateSentenceForWord"),
    wordNet.indexOf("function showPreparedPhrase"),
  );
  assert(
    wordNetSelectedGeneration.includes("state.branchQueue.take(target, {")
      && wordNetSelectedGeneration.includes("excludeFingerprints: queueAvoidFingerprints()")
      && wordNetSelectedGeneration.includes('cancelBackgroundWork({ preservePrefetch: Boolean(queued) && state.translationMode === "off" })'),
    "Word World's selected-word path should prefer an exact queued branch while avoiding recent sentences",
  );
  const wordNetSchedulePrefetch = wordNet.slice(
    wordNet.indexOf("function schedulePrefetch"),
    wordNet.indexOf("function nextPrefetchTarget"),
  );
  assert(
    wordNetSchedulePrefetch.includes('document.visibilityState === "hidden"')
      && wordNetSchedulePrefetch.includes('state.backgroundActivity === "prefetch"')
      && !wordNetSchedulePrefetch.includes("nativeWordNetRuntimeAvailable"),
    "Word World should prepare its queue in browser fallback as well as Android",
  );
  const wordNetPrefetchAllowance = wordNet.slice(
    wordNet.indexOf("async function prefetchAllowance"),
    wordNet.indexOf("function schedulePrefetch"),
  );
  assert(
    wordNetPrefetchAllowance.includes('state.generationMode !== "selected"')
      && wordNetPrefetchAllowance.includes("selectedLaneDeficit")
      && wordNet.includes("state.prefetchAttemptedWords = new Map()"),
    "Selected-word mode should refill its own priority lane even when the random reserve is full",
  );
  const wordNetRunPrefetch = wordNet.slice(
    wordNet.indexOf("async function runPrefetch"),
    wordNet.indexOf("async function requestSentenceCandidate"),
  );
  const wordNetShowPreparedPhrase = wordNet.slice(
    wordNet.indexOf("function showPreparedPhrase"),
    wordNet.indexOf("function freshSeedWord"),
  );
  assert(
    wordNetRunPrefetch.includes("rememberPreparedCandidate(target, candidate)")
      && wordNetShowPreparedPhrase.includes("rememberPreparedCandidate(target, candidate, { used: true })"),
    "Word World should retain both speculative and foreground-generated sentences",
  );
  assert(
    wordNet.includes("const PREFETCH_TRANSLATION_BATCH_SIZE = 5")
      && wordNetRunPrefetch.includes("translatePreparedBatch")
      && wordNetRunPrefetch.includes("state.prefetchGeneratedSinceTranslation")
      && wordNetQueue.includes("setTranslation(sentence, translation)")
      && wordNet.includes('return "visible";'),
    "Word World should batch English enrichment and persist translations with prepared Czech sentences",
  );
  const wordNetRememberStep = wordNet.slice(
    wordNet.indexOf("function rememberStep"),
    wordNet.indexOf("function showPreviousSentence"),
  );
  assert(
    wordNet.includes("const HISTORY_LIMIT = 256")
      && wordNet.includes("history: loadHistory()")
      && wordNetRememberStep.includes("saveHistory()")
      && wordNetRememberStep.includes("state.history.slice(0, HISTORY_LIMIT)"),
    "Word World should persist up to 256 previous sentences across launches",
  );
  assert(
    wordNet.includes("state.branchQueue.restore(loadPreparedQueue())")
      && wordNet.includes("freshReserve: PREFETCH_FRESH_TARGET")
      && wordNetQueue.includes("fresh.length > this.freshReserve"),
    "queue persistence should merge saved snapshots and retain a bounded fresh reserve",
  );
  assert(chat.includes("models.resetConversation"), "New chat and reload should reset the model's retained native context");
  assert(chat.includes("options.stateless"), "one-shot language models should request a fresh context");
  const appUiSources = ["app.js", "chat.js", "index.html", "chat.html"]
    .map((name) => [name, readFileSync(join(staticRoot, name), "utf8")]);
  for (const [name, source] of appUiSources) {
    assert(!source.includes("appSettingsPanel"), `${name} should not use a page-specific settings panel id`);
    assert(!source.includes("openAppSettings"), `${name} should not use a page-specific settings open button id`);
  }
  assert(!chrome.includes("appSettingsPanel"), "chrome.js should not support the old page-specific settings panel mount");

  const dictionaryCatalog = JSON.parse(readFileSync(join(staticRoot, "data/dictionaries/catalog.json"), "utf8"));
  const activeDictionary = dictionaryCatalog.dictionaries?.find((item) => item.key === dictionaryCatalog.default_dictionary);
  assert(activeDictionary?.status === "active", "the full dictionary should be an active Caatuu artifact");
  assert(activeDictionary?.usage_scope === "app_and_games", "the full dictionary should be described for app and game use");

  note("first-party UI controllers use the runtime adapter boundary");
}

function auditSetupManifest() {
  const manifestPath = join(workspaceRoot, "apps/languages/czech/static/setup-assets.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  assert(artifacts.length > 0, "setup-assets.json should define setup artifacts");

  for (const artifact of artifacts) {
    const target = `${artifact.url || ""} ${artifact.asset_path || ""}`;
    const decodedUrl = decodeURIComponent(String(artifact.url || ""));
    const sourcePath = decodedUrl.startsWith("/assets/")
      ? join(workspaceRoot, "apps/launcher/static", sourceAssetPathForPublic(decodedUrl.slice(1)))
      : decodedUrl.startsWith("/cz/")
        ? join(workspaceRoot, "apps/languages/czech/static", decodedUrl.slice(4))
        : "";
    assert(Boolean(sourcePath), `${artifact.key} should use a supported setup asset URL`);
    if (sourcePath) {
      assert(existsSync(sourcePath), `${artifact.key} setup asset should exist at ${relative(workspaceRoot, sourcePath)}`);
      if (existsSync(sourcePath)) {
        const sourceBytes = statSync(sourcePath).size;
        const sourceSha256 = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
        assert(Number(artifact.bytes) === sourceBytes, `${artifact.key} setup asset size should match its source file`);
        assert(artifact.sha256 === sourceSha256, `${artifact.key} setup asset SHA-256 should match its source file`);
      }
    }
    if (artifact.artifact_kind?.startsWith("browser-")) {
      assert(!artifact.native_required, `${artifact.key} is browser-only and should not be native_required`);
      assert(Boolean(artifact.browser_required), `${artifact.key} should be browser_required`);
    }
    if (artifact.native_required) {
      assert(!/vendor\/sql\.js|vector-db\.js/i.test(target), `${artifact.key} should not make packaged browser code native-required`);
    }
    if (/data\/embeddings\/[^/]+\/runtime\//i.test(target)) {
      assert(Boolean(artifact.native_required), `${artifact.key} semantic runtime should be required by Android setup`);
      assert(Boolean(artifact.browser_required), `${artifact.key} semantic runtime should be required by browser setup`);
    }
  }

  note("setup artifact manifest matches source files and separates browser and Android requirements");
}

function sourceAssetPathForPublic(publicPath) {
  if (publicPath.startsWith("assets/aliens/")) {
    return `assets/language-mascots/${publicPath.slice("assets/aliens/".length)}`;
  }
  if (publicPath.startsWith("assets/loading_animation/")) {
    return `assets/loading-animation/${publicPath.slice("assets/loading_animation/".length)}`;
  }
  if (publicPath.startsWith("assets/miscellaneous/")) {
    return `assets/visual-vocabulary/${publicPath.slice("assets/miscellaneous/".length)}`;
  }
  return publicPath;
}

function auditAndroidSource() {
  const clientPath = join(workspaceRoot, "apps/android/app/src/main/java/com/caatuu/android/CaatuuAssetClient.kt");
  const mainPath = join(workspaceRoot, "apps/android/app/src/main/java/com/caatuu/android/MainActivity.kt");
  const modelManagerPath = join(workspaceRoot, "apps/android/app/src/main/java/com/caatuu/android/ModelManager.kt");
  const nativeModelPath = join(workspaceRoot, "apps/android/app/src/main/java/com/caatuu/android/NativeCzechModel.kt");
  const vectorDatabaseManagerPath = join(workspaceRoot, "apps/android/app/src/main/java/com/caatuu/android/VectorDatabaseManager.kt");
  const dictionaryManagerPath = join(workspaceRoot, "apps/android/app/src/main/java/com/caatuu/android/DictionaryManager.kt");
  const staticAssetManagerPath = join(workspaceRoot, "apps/android/app/src/main/java/com/caatuu/android/StaticAssetManager.kt");
  const bridgePath = join(workspaceRoot, "apps/android/app/src/main/java/com/caatuu/android/CaatuuBridge.kt");
  const appUpdateManagerPath = join(workspaceRoot, "apps/android/app/src/main/java/com/caatuu/android/AppUpdateManager.kt");
  const filePathsPath = join(workspaceRoot, "apps/android/app/src/main/res/xml/caatuu_file_paths.xml");
  const gradlePath = join(workspaceRoot, "apps/android/app/build.gradle.kts");
  const playManifestPath = join(workspaceRoot, "apps/android/app/src/play/AndroidManifest.xml");
  const maintenanceUiPath = join(workspaceRoot, "apps/languages/czech/static/maintenance-ui.js");
  const debugBuildPath = join(workspaceRoot, "apps/android/tooling/build-debug-apk.sh");
  const publicDebugPublisherPath = join(workspaceRoot, "apps/android/tooling/publish-public-debug.sh");
  const releaseBuildPath = join(workspaceRoot, "apps/android/tooling/build-release-apk.sh");
  const releaseAabBuildPath = join(workspaceRoot, "apps/android/tooling/build-release-aab.sh");
  const runtimeConfigPath = join(workspaceRoot, "apps/runtime/src/config.rs");
  const runtimeMainPath = join(workspaceRoot, "apps/runtime/src/main.rs");
  const runtimeRoutesPath = join(workspaceRoot, "apps/runtime/src/routes/mod.rs");
  const composePath = join(workspaceRoot, "compose.yaml");
  const phoneDebugComposePath = join(workspaceRoot, "compose/phone-debug.yaml");
  const termuxInstallPath = join(workspaceRoot, "apps/android/tooling/termux-install-debug.sh");
  const androidVersionsPath = join(workspaceRoot, "apps/android/tooling/versions.env");
  const setupJdkPath = join(workspaceRoot, "apps/android/tooling/setup-jdk.sh");
  const prepareLlamaPath = join(workspaceRoot, "apps/android/scripts/prepare-llama-vendor.sh");
  const prepareLlamaPowerShellPath = join(workspaceRoot, "apps/android/scripts/prepare-llama-vendor.ps1");
  const llamaPatchPath = join(workspaceRoot, "apps/android/patches/llama-android-thinking.patch");
  const client = readFileSync(clientPath, "utf8");
  const main = readFileSync(mainPath, "utf8");
  const modelManager = readFileSync(modelManagerPath, "utf8");
  const nativeModel = readFileSync(nativeModelPath, "utf8");
  const vectorDatabaseManager = readFileSync(vectorDatabaseManagerPath, "utf8");
  const dictionaryManager = readFileSync(dictionaryManagerPath, "utf8");
  const staticAssetManager = readFileSync(staticAssetManagerPath, "utf8");
  const bridge = readFileSync(bridgePath, "utf8");
  const appUpdateManager = readFileSync(appUpdateManagerPath, "utf8");
  const filePaths = readFileSync(filePathsPath, "utf8");
  const gradle = readFileSync(gradlePath, "utf8");
  const playManifest = readFileSync(playManifestPath, "utf8");
  const maintenanceUi = readFileSync(maintenanceUiPath, "utf8");
  const debugBuild = readFileSync(debugBuildPath, "utf8");
  const publicDebugPublisher = readFileSync(publicDebugPublisherPath, "utf8");
  const releaseBuild = readFileSync(releaseBuildPath, "utf8");
  const releaseAabBuild = readFileSync(releaseAabBuildPath, "utf8");
  const runtimeConfig = readFileSync(runtimeConfigPath, "utf8");
  const runtimeMain = readFileSync(runtimeMainPath, "utf8");
  const runtimeRoutes = readFileSync(runtimeRoutesPath, "utf8");
  const compose = readFileSync(composePath, "utf8");
  const phoneDebugCompose = readFileSync(phoneDebugComposePath, "utf8");
  const termuxInstall = readFileSync(termuxInstallPath, "utf8");
  const androidVersions = readFileSync(androidVersionsPath, "utf8");
  const setupJdk = readFileSync(setupJdkPath, "utf8");
  const prepareLlama = readFileSync(prepareLlamaPath, "utf8");
  const prepareLlamaPowerShell = readFileSync(prepareLlamaPowerShellPath, "utf8");
  const llamaPatch = readFileSync(llamaPatchPath, "utf8");

  assert(client.includes('val START_URL = "https://$HOST$LANGUAGE_ENTRY_PATH"'), "Android start URL should come from the bundled language contract");
  assert(client.includes('path == LANGUAGE_ROUTE_PREFIX || path.startsWith("$LANGUAGE_ROUTE_PREFIX/")'), "Android asset client should serve its configured language route");
  assert(!client.includes('path == "/cz"'), "Android asset routing should not contain a literal Czech route");
  assert(client.includes('path.startsWith("/assets/")'), "Android asset client should serve shared asset paths");
  assert(client.includes('assetPath.startsWith("data/embeddings/")'), "Android asset client should serve downloaded semantic runtime assets to the WebView");
  assert(!/archive\/chinese|\/zh\b/.test(client), "Android asset client should not serve archive or /zh paths");
  assert(client.includes('uri.scheme == "https" && uri.host == HOST && (uri.port == -1 || uri.port == 443)'), "Android app origin should require HTTPS, the exact app host, and the default HTTPS port");
  assert(client.includes('if (assetPath.contains("..")) return notFound()'), "Android asset client should reject path traversal attempts");
  assert(main.includes("blockNetworkLoads = true"), "Android service worker settings should block network loads");
  assert(main.includes("setServiceWorkerClient"), "Android should install a service worker blocker");
  assert(client.includes("openExternalUrl(uri)"), "Android should open non-app links outside the privileged WebView");
  assert(client.includes("if (!isAppHost(uri)) return forbidden()"), "Android should block external WebView subresources");
  assert(client.includes('"js", "mjs" -> "text/javascript"'), "Android should serve ES modules with a JavaScript MIME type");
  assert(client.includes('"css", "html", "js", "mjs", "json", "svg", "txt", "webmanifest" -> "UTF-8"'), "Android should give ES modules an explicit UTF-8 charset");
  assert(client.includes("else -> return notFound()"), "Android should fail closed for unknown same-host paths");
  assert(!client.includes("            302,"), "Android WebResourceResponse should not use an unsupported redirect status");
  assert(bridge.includes("inferenceMutex.withLock"), "Android should serialize native model load/generate operations");
  assert(bridge.includes("activeModelPreparationJobs"), "Android should track cancellable model preparation jobs");
  assert(bridge.includes("jobs.forEach { it.cancelAndJoin() }"), "Android should stop active model preparation before taking the artifact lock");
  assert(bridge.includes("runCancellableModelPreparation"), "Android model load and download paths should use cancellable preparation");
  assert(bridge.includes('"cancel_request" -> cancelNativeRequest(id, request)'), "Android should accept request-scoped cancellation from UI deadlines");
  assert(bridge.includes("activeRequests[requestId]?.job"), "Android should cancel the exact timed-out native request");
  assert(bridge.includes('"reset_conversation" -> resetConversation(id, request)'), "Android should expose keep-loaded conversation reset");
  assert(bridge.includes('options.optBoolean("stateless", false)'), "Android should support one-shot model generation without retained chat context");
  assert(nativeModel.includes("activeEngine.resetConversation()"), "the Android model wrapper should reset conversation state without reloading model weights");
  assert(bridge.includes('"cancel_download" -> cancelModelDownload(id, request)'), "Android should retain the requested model key when cancelling a download");
  assert(bridge.includes("modelManager.cancelModelDownload(spec.key)"), "Android should cancel only the selected model outside setup cleanup");
  assert(modelManager.includes("suspend fun cancelModelDownload(modelKey: String?)"), "Android ModelManager should expose targeted model cancellation");
  assert(modelManager.includes('MODEL_CATALOG_ASSET = "data/models/phone-bench/models.json"'), "Android ModelManager should read the shared model catalog");
  assert(vectorDatabaseManager.includes('EMBEDDING_CATALOG_ASSET = "data/embeddings/models.json"'), "Android VectorDatabaseManager should read the shared embedding catalog");
  assert(vectorDatabaseManager.includes("parseVectorDatabaseSpec"), "Android VectorDatabaseManager should parse embedding manifests instead of duplicating a hard-coded catalog");
  assert(!vectorDatabaseManager.includes("DEFAULT_DATABASE_URL"), "Android VectorDatabaseManager should not hard-code the embedding database URL");
  assert(!vectorDatabaseManager.includes("DEFAULT_DATABASE_SHA256"), "Android VectorDatabaseManager should not hard-code the embedding database hash");
  assert(dictionaryManager.includes('CATALOG_ASSET = "data/dictionaries/catalog.json"'), "Android DictionaryManager should read the shared dictionary catalog");
  assert(dictionaryManager.includes("SQLiteDatabase.OPEN_READONLY"), "Android full-dictionary lookup should use a read-only local SQLite database");
  assert(dictionaryManager.includes("Dictionary checksum did not match the catalog"), "Android should verify the dictionary download before publishing it");
  assert(bridge.includes('"dictionary_status" -> emitDone(id, dictionaryManager.statusJson())'), "Android should expose dictionary availability to the shared UI");
  assert(bridge.includes('"dictionary_download" -> downloadDictionary(id)'), "Android should expose a standalone dictionary recovery download");
  assert(bridge.includes('"dictionary_search" -> searchDictionary(id, request)'), "Android should expose local dictionary search");
  assert(bridge.includes("val dictionaryFile = dictionaryManager.ensureDatabase"), "Android initial setup should download and verify the full dictionary");
  assert(bridge.includes('.put("dictionary", dictionaryStatus)'), "Android setup status should include the required dictionary artifact");
  assert(bridge.includes('.put("artifactKind", "dictionary-database")'), "Android setup events should identify the dictionary artifact");
  assert(main.includes("dictionaryManager = DictionaryManager(applicationContext)"), "Android should wire the native dictionary manager into the bridge");
  assert(staticAssetManager.includes('SETUP_ASSET_MANIFEST = "setup-assets.json"'), "Android StaticAssetManager should read the shared setup manifest");
  assert(staticAssetManager.includes("native_required"), "Android StaticAssetManager should filter setup-assets.json by native_required");
  assert(!staticAssetManager.includes("private val REQUIRED_ASSETS = listOf"), "Android setup assets should not be duplicated as a hard-coded Kotlin list");
  assert(
    bridge.includes('it.assetPath.startsWith("assets/loading_animation/")'),
    "Android initial setup should prioritize the loading animation within the visual assets",
  );
  assert(
    bridge.indexOf("prioritizedAssets.forEachIndexed") < bridge.indexOf("requiredModels.forEachIndexed"),
    "Android initial setup should download visual assets before the larger language models",
  );
  assert(bridge.includes('emitDone(id, setupStatusJson().put("setupActive", false))'), "Android terminal setup result should clear setupActive");
  assert(!gradle.includes('exclude("sw.js")'), "Android asset packaging should include sw.js as shared source");
  assert(!gradle.includes('exclude("vector-db.js")'), "Android asset packaging should include vector-db.js as shared source");
  assert(!gradle.includes('exclude("vendor/sql.js/**")'), "Android asset packaging should include sql.js for shared WebView vector search");
  assert(gradle.includes('exclude("data/embeddings/all-minilm-l6-v2-qint8-v0.1/runtime/**")'), "Android asset packaging should exclude the downloaded semantic runtime");
  assert(gradle.includes('exclude("data/embeddings/**/*.sqlite")'), "Android asset packaging should exclude the heavy embedding SQLite DB");
  assert(gradle.includes('exclude("data/dictionaries/**/*.sqlite")'), "Android asset packaging should exclude the full dictionary SQLite DB");
  assert(gradle.includes('.orElse(36)'), "Android targetSdk should default to the current API level");
  assert(gradle.includes('buildConfigString("caatuu-debug.apk")'), "Android debug builds should check the debug APK channel");
  assert(gradle.includes('buildConfigString("caatuu-debug.json")'), "Android debug builds should check the debug manifest channel");
  assert(gradle.includes('buildConfigString("caatuu.apk")'), "Android release builds should check the stable APK channel");
  assert(gradle.includes('buildConfigString("caatuu.json")'), "Android release builds should check the stable manifest channel");
  assert(gradle.includes('environmentVariable("CAATUU_ANDROID_REPORT_URL")'), "Android bug reporting should have an independently configurable endpoint");
  assert(gradle.includes('buildConfigField("String", "CAATUU_REPORT_URL"'), "Android builds should expose the dedicated bug-report endpoint");
  assert(gradle.includes('gradleProperty("caatuuLanguageId")'), "Android builds should select the bundled language explicitly");
  assert(gradle.includes('buildConfigField("String", "CAATUU_LANGUAGE_ROUTE_PREFIX"'), "Android builds should expose the selected language route");
  assert(gradle.includes('buildConfigField("String", "CAATUU_LANGUAGE_ENTRY_PATH"'), "Android builds should expose the selected language entry page");
  assert(gradle.includes("provider.orNull?.isNotBlank() == true"), "Android release signing should reject missing and blank credentials");
  assert(gradle.includes("gradle.taskGraph.whenReady"), "Android builds should inspect the requested task graph before packaging");
  assert(gradle.includes('listOf("assemble", "bundle", "package", "sign")'), "Android should guard every release and Play packaging task");
  assert(gradle.includes("releasePackagingRequested && !hasReleaseSigning"), "Android release and Play packaging should fail closed without signing credentials");
  assert(!/if \(previousVersion == BuildConfig\.VERSION_CODE\) \{\s*webView\.clearCache\(true\)/.test(main), "Android should preserve the WebView cache when the bundled version has not changed");
  assert(bridge.includes("URL(BuildConfig.CAATUU_REPORT_URL)"), "Android bug reports should not derive their endpoint from the updater URL");
  assert(bridge.includes('check(remote.optBoolean("ok"))'), "Android should not report locally stored but unsent bug reports as sent");
  assert(/debug\s*\{[\s\S]*?buildConfigField\("boolean", "CAATUU_SELF_UPDATE_ENABLED", "true"\)/.test(gradle), "Android debug builds should keep explicit self-update support");
  assert(/release\s*\{[\s\S]*?buildConfigField\("boolean", "CAATUU_SELF_UPDATE_ENABLED", "true"\)/.test(gradle), "Android release APK builds should keep explicit self-update support");
  assert(/create\("play"\)\s*\{[\s\S]*?buildConfigField\("boolean", "CAATUU_SELF_UPDATE_ENABLED", "false"\)/.test(gradle), "Android Play builds should disable sideload self-updates");
  assert((gradle.match(/buildConfigField\("boolean", "CAATUU_SELF_UPDATE_ENABLED", "false"\)/g) || []).length === 1, "only the Android Play variant should disable self-updates");
  assert(playManifest.includes('android:name="android.permission.REQUEST_INSTALL_PACKAGES"'), "Android Play manifest should identify the sideload permission override");
  assert(playManifest.includes('tools:node="remove"'), "Android Play manifest should remove REQUEST_INSTALL_PACKAGES");
  assert(maintenanceUi.includes("if (status?.selfUpdateEnabled === false) return false;"), "maintenance UI should treat store-managed builds as having no native self-update");
  assert(maintenanceUi.includes("const visible = native && selfUpdateEnabled;"), "maintenance UI should keep native self-update controls visible for manual checks");
  assert(
    maintenanceUi.includes('? `Update${latestName ?') && maintenanceUi.includes(': "Check for updates"'),
    "maintenance UI should name available versions and distinguish them from manual checks"
  );
  assert(maintenanceUi.includes("Updates are managed by the app store."), "maintenance UI should explain store-managed updates");
  assert(maintenanceUi.includes("status?.serverReachable === false || status?.updateError"), "maintenance UI should not claim an update check succeeded when the server was unreachable");
  assert(debugBuild.includes('artifacts/android/caatuu-debug.apk'), "debug build script should only publish caatuu-debug.apk");
  assert(debugBuild.includes('artifacts/android/caatuu-debug.json'), "debug build script should only publish caatuu-debug.json");
  assert(debugBuild.includes('debug-releases/$version_code/caatuu-debug.apk'), "debug build should publish immutable versioned APKs");
  assert(debugBuild.includes('Refusing to replace immutable APK'), "debug build should reject same-version byte replacement");
  assert(debugBuild.includes('CAATUU_ENABLE_ANDROID_DEBUG_DOWNLOADS'), "generic debug builds should detect an enabled public debug route");
  assert(debugBuild.includes('overwrite the live manifest with an invalid update origin'), "generic debug builds should refuse to poison the public update manifest");
  assert(publicDebugPublisher.includes("java -version 2>&1 | grep -q 'version \"17'"), "public debug publisher should verify Java 17 before building");
  assert(debugBuild.includes('"build_type": "debug"'), "debug build manifest should identify the debug channel");
  assert(debugBuild.includes('"debuggable": true'), "debug build manifest should identify the APK as debuggable");
  assert(debugBuild.includes("verify --verbose --print-certs"), "debug build should cryptographically verify the APK before publishing");
  assert(releaseBuild.includes(":app:assembleRelease"), "release build script should assemble the release variant");
  assert(releaseBuild.includes('artifacts/android/caatuu.apk'), "release build script should publish the stable APK filename");
  assert(releaseBuild.includes('artifacts/android/caatuu.json'), "release build script should publish the stable manifest filename");
  assert(releaseBuild.includes('releases/$version_code/caatuu.apk'), "release build should publish immutable versioned APKs");
  assert(releaseBuild.includes('Refusing to replace immutable APK'), "release build should reject same-version byte replacement");
  assert(releaseBuild.includes('CAATUU_ANDROID_KEYSTORE'), "release build script should require an explicit signing keystore");
  assert(releaseBuild.includes('"build_type": "release"'), "release build manifest should identify the release channel");
  assert(releaseBuild.includes('"debuggable": false'), "release build manifest should reject debuggable APKs");
  assert(releaseBuild.includes("verify --verbose --print-certs"), "release build should cryptographically verify the APK before publishing");
  assert(releaseAabBuild.includes(":app:bundlePlay"), "Play bundle build should invoke the Play variant");
  assert(releaseAabBuild.includes("app/build/outputs/bundle/play/app-play.aab"), "Play bundle build should read the Play variant output");
  assert(releaseAabBuild.includes("artifacts/android/caatuu-release.aab"), "Play bundle build should publish the release AAB artifact");
  assert(appUpdateManager.includes('validateChannelUrl(URL(updateManifestUrl), "Update manifest")'), "Android updater should validate its configured manifest URL before use");
  assert(appUpdateManager.includes('require(BuildConfig.DEBUG || candidate.protocol == "https")'), "Android release updater should require HTTPS");
  assert(appUpdateManager.includes("instanceFollowRedirects = false"), "Android updater should refuse unchecked HTTP redirects");
  assert(appUpdateManager.includes("useCaches = false"), "Android updater should bypass cached update manifests");
  assert(appUpdateManager.includes('.addRequestHeader("Cache-Control", "no-cache")'), "Android updater should bypass cached APK responses");
  assert(appUpdateManager.includes("if (managed?.status == DownloadManager.STATUS_SUCCESSFUL)"), "Android updater should promote a managed destination only after DownloadManager reports completion");
  assert(!appUpdateManager.includes("stagedFile.length() == stored.target.bytes"), "Android updater should never infer completion from a potentially preallocated file length");
  assert(appUpdateManager.includes("integrityRetryCount < MAX_UPDATE_INTEGRITY_RETRIES"), "Android updater should retry one clean download after a transport integrity failure");
  assert(appUpdateManager.includes("val raced = reconcileLocalStateLocked()"), "Android updater should reconcile again inside its retry mutex before replacing a download");
  assert(appUpdateManager.includes("managedDownloadIdsUnderRootLocked(managedRoot).toMutableSet()"), "Android updater should discover orphaned managed downloads before a clean restart");
  assert(appUpdateManager.includes("downloadManager.remove(*downloadIds.toLongArray())"), "Android updater should cancel orphaned managed downloads before deleting their files");
  assert(appUpdateManager.includes("File(appContext.cacheDir, LEGACY_UPDATES_DIRECTORY).deleteRecursively()"), "Android updater should remove abandoned cache-era update files during migration");
  assert(appUpdateManager.includes('candidate.effectivePort() == manifestUrl.effectivePort()'), "Android updater should require the APK URL to use the manifest origin");
  assert(appUpdateManager.includes('"Update APK must use the same origin as its manifest."'), "Android updater should enforce same-origin APK downloads");
  assert(appUpdateManager.includes("verifyUpdateArchive(file, target.manifest())"), "Android updater should inspect downloaded APK metadata before installation");
  assert(appUpdateManager.includes("require(archive.packageName == appContext.packageName)"), "Android updater should require the downloaded APK package to match the installed app");
  assert(appUpdateManager.includes('require(manifest.optString("package_name") == archive.packageName)'), "Android updater should require manifest and APK package names to agree");
  assert(appUpdateManager.includes("archiveLineage.containsAll(installedSigners)"), "Android updater should require the downloaded APK to continue the installed signing lineage");
  assert(appUpdateManager.includes("import android.app.DownloadManager"), "Android should own app update transfers outside the Activity lifecycle");
  assert(appUpdateManager.includes("appContext.getSharedPreferences(UPDATE_PREFS"), "Android updater should persist its target and managed download id");
  assert(appUpdateManager.includes('File(appContext.filesDir, "updates")'), "verified update APKs should survive cache eviction");
  assert(filePaths.includes("<files-path") && filePaths.includes('path="updates/"'), "FileProvider should expose persistent verified update APKs");
  assert(/downloadActive = state == DOWNLOAD_STATE_DOWNLOADING,\s*\n/.test(appUpdateManager), "paused updates should not be reported as actively downloading");
  assert(appUpdateManager.includes('put("downloadProgress", progress)'), "Android update status should expose progress under the shared UI field name");
  assert(bridge.includes('"update_app_status" -> emitDone(id, appUpdateManager.statusJson())'), "update status should remain readable while an update operation owns its mutex");
  assert(/LLAMA_CPP_COMMIT="\$\{LLAMA_CPP_COMMIT:-[0-9a-f]{40}\}"/.test(androidVersions), "Android versions should pin llama.cpp to a full commit hash");
  assert(prepareLlama.includes('source "$repo_root/apps/android/tooling/versions.env"'), "llama.cpp preparation should load the pinned Android versions");
  assert(prepareLlama.includes('fetch --depth 1 "$llama_remote" "$LLAMA_CPP_COMMIT"'), "llama.cpp preparation should fetch the pinned commit directly");
  assert(prepareLlama.includes("checkout --detach FETCH_HEAD"), "llama.cpp preparation should use a detached pinned checkout");
  assert(prepareLlama.includes('rev-parse HEAD'), "llama.cpp preparation should verify the checked-out commit");
  assert(prepareLlama.includes('android_abis_raw="${CAATUU_ANDROID_ABIS:-arm64-v8a}"'), "llama.cpp preparation should load the configured Android ABIs");
  assert(prepareLlama.includes('abiFilters += listOf($abi_list)'), "llama.cpp preparation should propagate Android ABI filters into the vendor library");
  assert(prepareLlamaPowerShell.includes("fetch --depth 1 $llamaRemote $llamaCommit"), "PowerShell llama.cpp preparation should fetch the pinned commit directly");
  assert(prepareLlamaPowerShell.includes("checkout --detach FETCH_HEAD"), "PowerShell llama.cpp preparation should use a detached pinned checkout");
  assert(prepareLlamaPowerShell.includes('$env:CAATUU_ANDROID_ABIS'), "PowerShell llama.cpp preparation should load the configured Android ABIs");
  assert(prepareLlamaPowerShell.includes('abiFilters += listOf($abiList)'), "PowerShell llama.cpp preparation should propagate Android ABI filters into the vendor library");
  assert(llamaPatch.includes("suspend fun resetConversation()"), "the pinned llama.cpp overlay should expose keep-loaded conversation reset");
  assert(llamaPatch.includes("reset_conversation_states()"), "the pinned llama.cpp overlay should clear chat, KV, and sampler state");
  assert(llamaPatch.includes("throw IOException(\"Failed to process user prompt: $result\")"), "native prompt-processing errors should fail instead of returning an empty success");
  assert(llamaPatch.includes("stop_generation_position = current_position + n_predict"), "native generation should not double-count prompt tokens");
  assert(llamaPatch.includes("stop_generation_position = current_position + remaining_generation"), "native context shifting should preserve the remaining token budget");
  assert(setupJdk.includes('curl -fL --retry 3 -o "$checksum_file"'), "JDK setup should require the upstream checksum sidecar");
  assert(setupJdk.includes('^[0-9a-fA-F]{64}$'), "JDK setup should validate the checksum format");
  assert(!setupJdk.includes("validating extracted Java version instead"), "JDK setup should not fall back after checksum failure");
  assert(runtimeConfig.includes('env_flag("ENABLE_ANDROID_DEBUG_DOWNLOADS")'), "runtime debug downloads should require an explicit opt-in flag");
  assert(runtimeRoutes.includes("if !debug_downloads_enabled"), "runtime should keep debug download routes disabled by default");
  assert(runtimeRoutes.includes(".merge(android_debug_router("), "runtime should isolate Android debug routes behind their gate");
  assert(runtimeRoutes.includes('"/android/releases"'), "runtime should expose immutable stable APK paths");
  assert(runtimeRoutes.includes('"/android/debug-releases"'), "runtime should expose immutable debug APK paths behind the debug gate");
  assert(runtimeRoutes.includes('"/android/caatuu-preview.apk"'), "runtime should expose a user-facing preview APK alias behind the debug gate");
  assert(runtimeRoutes.includes('"/android/caatuu-preview.json"'), "runtime should expose a user-facing preview manifest alias behind the debug gate");
  assert(runtimeRoutes.includes('"public, max-age=31536000, immutable"'), "versioned Android artifacts should be explicitly immutable");
  assert(runtimeRoutes.includes('"no-store, no-cache, must-revalidate, max-age=0"'), "mutable Android aliases and status routes should bypass caches");
  assert(runtimeRoutes.includes('HeaderName::from_static("x-content-type-options")'), "runtime should prevent MIME sniffing on every response");
  assert(runtimeRoutes.includes('HeaderName::from_static("referrer-policy")'), "runtime should set a global referrer policy");
  assert(runtimeRoutes.includes('HeaderValue::from_static("no-referrer")'), "runtime should suppress referrer disclosure");
  assert(runtimeMain.includes('unwrap_or_else(|_| "127.0.0.1".to_string())'), "direct runtime launches should bind to loopback by default");
  assert(compose.includes('"127.0.0.1:8765:9172"'), "normal Compose runtime should publish only on host loopback");
  assert(compose.includes('BIND_ADDR: "0.0.0.0"'), "Compose should explicitly bind the server inside its container network");
  assert(compose.includes("TCP-LISTEN:7979,reuseaddr,fork TCP:host.docker.internal:7979"), "shared tunnel should preserve its existing Minerals origin forward");
  assert(compose.includes('wait -n "$${forward_pid}" "$${shared_forward_pid}" "$${tunnel_pid}"'), "tunnel service should exit when any forwarding process stops");
  assert(phoneDebugCompose.includes('ENABLE_ANDROID_DEBUG_DOWNLOADS: "1"'), "phone-debug Compose override should explicitly enable debug routes");
  assert(phoneDebugCompose.includes("CAATUU_PHONE_DEBUG_BIND:?"), "phone-debug Compose override should require an explicit LAN bind address");
  assert(!termuxInstall.includes("caatuu.waajacu.com/android/caatuu-debug"), "Termux helper should not assume debug artifacts are available on the public stable host");

  note("Android source enforces the configured language runtime boundary");
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
