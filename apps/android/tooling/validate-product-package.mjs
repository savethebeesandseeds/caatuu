#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

const EXPECTED_APPLICATION_ID = "com.waajacu.caatuu";
const EXPECTED_MIN_SDK = 30;
const MINIMUM_TARGET_SDK = 36;
const EXPECTED_MINILM_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41";

const REQUIRED_ASSET_PATHS = [
  "caatuu-profile.json",
  "index.html",
  "setup-assets.json",
  "data/embeddings/models.json",
  "data/embeddings/all-minilm-l6-v2-qint8-v0.1/manifest.json",
  "source/shared/runtime.js",
  "source/shared/vector-db.js",
  "source/shared/semantic-learning.js",
  "source/shared/semantic-learning-core.mjs",
  "data/dictionaries/catalog.json",
  "data/dictionaries/kaikki-cs-en-2026-07-09/manifest.json",
  "vendor/transformers/transformers.min.js",
  "vendor/transformers/LICENSE",
  "vendor/sql.js/sql-wasm.js",
  "vendor/sql.js/sql-wasm.wasm",
  "vendor/sql.js/LICENSE",
];

const REQUIRED_NATIVE_CLASSES = [
  "com.caatuu.android.CaatuuActivity",
  "com.caatuu.android.ProductBridge",
  "com.caatuu.android.AppUpdateManager",
  "com.caatuu.android.CaatuuAssetClient",
  "com.caatuu.android.VectorDatabaseManager",
  "com.caatuu.android.DictionaryManager",
  "com.caatuu.android.StaticAssetManager",
];

const FORBIDDEN_NATIVE_CLASS_PATTERNS = [
  /\bcom\.caatuu\.android\.(?:ModelManager|NativeCzechModel)(?:\$|\b)/,
  /\bcom\.arm\.aichat(?:\.|\b)/,
  /\borg\.godotengine(?:\.|\b)/,
];

const FORBIDDEN_ARCHIVE_PATH_PATTERNS = [
  /(?:^|\/)chat\.html$/i,
  /(?:^|\/)source\/features\/chat\//i,
  /(?:^|\/)data\/models(?:\/|$)/i,
  /(?:^|\/)assets\/games(?:\/|$)/i,
  /(?:^|\/)artifacts\/games(?:\/|$)/i,
  /(?:^|\/)caatuu-game(?:\/|$)/i,
  /(?:^|\/)godot(?:[-_/]|$)/i,
  /\.pck$/i,
  /\.gguf(?:\.|$)/i,
  /(?:^|\/)lib\/(?:[^/]+\/)?lib(?:ai-chat|llama|ggml|kleidiai|godot)[^/]*\.so$/i,
];

const FIRST_PARTY_EXECUTABLE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".webmanifest",
]);

const FORBIDDEN_FIRST_PARTY_SOURCE_PATTERNS = [
  /@mlc-ai\/web-llm/i,
  /(?:^|["'`(\s])(?:\.\/|\.\.\/|\/)?data\/models\//i,
  /\b(?:llama\.cpp|ggml|gguf|webllm)\b/i,
  /\bdebug-chat\b/i,
  /\bchat\.html\b/i,
  /\bwordNetGenerativeDialog\b/,
  /data-content-mode\s*=\s*["']generative["']/i,
  /\bGenerative mode\b/i,
  /\bmodels\.generate\s*\(/,
  /\b(?:loadModelCatalog|loadBrowserModel|generateBrowser|browserFallbackModel|webllmCdn)\b/,
  /nativeCall\(\s*["'](?:prompt|start_download|cancel_download|reset_conversation|benchmark|delete_model)["']/,
  /["'](?:prompt|start_download|cancel_download|reset_conversation|benchmark|delete_model)["']\s*->/,
  /(?:^|["'`(\s])\/?games\/caatuu-game(?:\/|\b)/i,
  /\bgodot-v\d+\b/i,
];

function usage() {
  console.log(
    "Usage: node apps/android/tooling/validate-product-package.mjs " +
      "--aab <caatuu.aab> --apk <aab-derived-universal.apk> " +
      "[--apkanalyzer <path>] [--unzip <path>] [--allow-transition-debug]",
  );
}

function parseArguments(argv) {
  const options = { apkanalyzer: "apkanalyzer", unzip: "unzip", allowTransitionDebug: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--allow-transition-debug") {
      options.allowTransitionDebug = true;
      continue;
    }
    if (!["--aab", "--apk", "--apkanalyzer", "--unzip"].includes(argument)) {
      throw new Error(`unknown option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  if (!options.aab || !options.apk) throw new Error("--aab and --apk are required");
  return { ...options, help: false };
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: options.encoding ?? "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString("utf8")
      : String(error.stderr || "");
    throw new Error(`${basename(command)} ${args.join(" ")} failed${stderr ? `: ${stderr.trim()}` : ""}`);
  }
}

function archiveEntries(unzip, archive) {
  return run(unzip, ["-Z1", archive])
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function archiveBuffer(unzip, archive, entry) {
  return run(unzip, ["-p", archive, entry], { encoding: "buffer" });
}

function archiveText(unzip, archive, entry) {
  return archiveBuffer(unzip, archive, entry).toString("utf8");
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeAssetPath(entry, kind) {
  if (kind === "aab") {
    const match = /^base\/assets\/(.+)$/u.exec(entry);
    return match?.[1] ?? null;
  }
  const match = /^assets\/(.+)$/u.exec(entry);
  return match?.[1] ?? null;
}

function archiveEntryForAsset(assetPath, kind) {
  return kind === "aab" ? `base/assets/${assetPath}` : `assets/${assetPath}`;
}

function assertNoForbiddenPaths(entries, label) {
  for (const entry of entries) {
    for (const pattern of FORBIDDEN_ARCHIVE_PATH_PATTERNS) {
      assert(!pattern.test(entry), `${label} contains forbidden product path ${entry}`);
    }
  }
}

function assertRequiredAssets(entries, kind, label) {
  const entrySet = new Set(entries);
  for (const assetPath of REQUIRED_ASSET_PATHS) {
    const expected = archiveEntryForAsset(assetPath, kind);
    assert(entrySet.has(expected), `${label} is missing required product asset ${expected}`);
  }
}

function parseJsonAsset(unzip, archive, assetPath, kind, label) {
  const entry = archiveEntryForAsset(assetPath, kind);
  try {
    return JSON.parse(archiveText(unzip, archive, entry));
  } catch (error) {
    fail(`${label} contains invalid ${entry}: ${error.message}`);
  }
}

function assertStoreProfile(profile, label) {
  const expectedTopLevelKeys = ["capabilities", "privacy", "profile", "schemaVersion"];
  const expectedCapabilityKeys = [
    "chat",
    "dictionary",
    "embeddings",
    "generation",
    "godot",
    "imageLookup",
    "llm",
    "stats",
    "wordWorldStandardOnly",
  ];
  const expectedPrivacyKeys = ["bugReportsLocalOnly", "dictionaryGapReportsLocalOnly"];
  assert(
    JSON.stringify(Object.keys(profile ?? {}).sort()) === JSON.stringify(expectedTopLevelKeys),
    `${label} store profile must contain only the reviewed top-level keys`,
  );
  assert(
    JSON.stringify(Object.keys(profile?.capabilities ?? {}).sort()) ===
      JSON.stringify(expectedCapabilityKeys),
    `${label} store profile must contain the exact reviewed capabilities`,
  );
  assert(
    JSON.stringify(Object.keys(profile?.privacy ?? {}).sort()) === JSON.stringify(expectedPrivacyKeys),
    `${label} store profile must contain the exact reviewed privacy flags`,
  );
  assert(profile?.schemaVersion === 1, `${label} store profile must use schemaVersion 1`);
  assert(profile?.profile === "product", `${label} profile must identify the Caatuu product`);
  for (const capability of ["chat", "llm", "generation", "godot"]) {
    assert(
      profile?.capabilities?.[capability] === false,
      `${label} store profile capability ${capability} must be false`,
    );
  }
  for (const capability of ["embeddings", "imageLookup", "stats", "dictionary"]) {
    assert(
      profile?.capabilities?.[capability] === true,
      `${label} store profile capability ${capability} must be true`,
    );
  }
  assert(
    profile?.capabilities?.wordWorldStandardOnly === true,
    `${label} store profile must force Word World Standard-only mode`,
  );
  assert(
    profile?.privacy?.bugReportsLocalOnly === true,
    `${label} store profile must keep bug reports local-only`,
  );
  assert(
    profile?.privacy?.dictionaryGapReportsLocalOnly === true,
    `${label} store profile must keep dictionary-gap reports local-only`,
  );
}

function assertEmbeddingCatalog(catalog, manifest, label) {
  assert(catalog?.default_model === "all-minilm-l6-v2-qint8-v0.1", `${label} must select MiniLM`);
  const active = catalog?.models?.find((model) => model?.key === catalog.default_model);
  assert(active?.status === "active", `${label} MiniLM embedding catalog entry must be active`);
  assert(
    active?.embedding_model_revision === EXPECTED_MINILM_REVISION,
    `${label} MiniLM catalog revision must remain pinned`,
  );
  assert(manifest?.model_id === catalog.default_model, `${label} embedding manifest must match the catalog`);
  assert(
    manifest?.model_revision === EXPECTED_MINILM_REVISION,
    `${label} MiniLM manifest revision must remain pinned`,
  );
  assert(manifest?.model_license === "Apache-2.0", `${label} MiniLM manifest must retain Apache-2.0`);
  assert(Array.isArray(manifest?.runtime?.artifacts), `${label} embedding manifest must list runtime artifacts`);
  for (const suffix of [
    "onnx/model_qint8_arm64.onnx",
    "ort/ort-wasm-simd-threaded.mjs",
    "ort/ort-wasm-simd-threaded.wasm",
    "LICENSE-APACHE-2.0.txt",
    "THIRD_PARTY_NOTICES.json",
  ]) {
    assert(
      manifest.runtime.artifacts.some((artifact) => artifact?.file === suffix),
      `${label} embedding manifest is missing runtime artifact ${suffix}`,
    );
  }
}

function assertDictionaryCatalog(catalog, manifest, label) {
  assert(
    catalog?.default_dictionary === "kaikki-cs-en-2026-07-09",
    `${label} must select the reviewed Czech-English dictionary`,
  );
  const active = catalog?.dictionaries?.find(
    (dictionary) => dictionary?.key === catalog.default_dictionary,
  );
  assert(active?.status === "active", `${label} default dictionary catalog entry must be active`);
  assert(active?.artifact_kind === "dictionary-database", `${label} default dictionary kind is incorrect`);
  assert(active?.direction === "cs-en", `${label} default dictionary direction must be cs-en`);
  assert(
    Number.isSafeInteger(active?.bytes) && active.bytes > 0,
    `${label} default dictionary must declare a positive byte count`,
  );
  assert(
    /^[a-f0-9]{64}$/u.test(active?.sha256 ?? ""),
    `${label} default dictionary must have a SHA-256`,
  );
  assert(
    /^https:\/\/[a-z0-9.-]+(?:\/|$)/iu.test(active?.download_url ?? ""),
    `${label} default dictionary must use an HTTPS download URL`,
  );
  assert(
    active?.manifest_file === `${catalog.default_dictionary}/manifest.json`,
    `${label} default dictionary must identify its packaged manifest`,
  );
  for (const field of ["key", "status", "artifact_kind", "direction", "bytes", "sha256", "download_url"]) {
    assert(
      manifest?.[field] === active[field],
      `${label} dictionary manifest ${field} must match the catalog`,
    );
  }
}

function assertSetupEmbeddingBoundary(setup, label) {
  const embeddingArtifacts = (setup?.artifacts ?? []).filter(
    (artifact) => artifact?.artifact_kind === "embedding-runtime",
  );
  assert(embeddingArtifacts.length === 10, `${label} setup manifest must retain all 10 embedding runtime artifacts`);
  assert(
    embeddingArtifacts.every(
      (artifact) =>
        artifact.native_required === true &&
        artifact.browser_required === true &&
        Number.isSafeInteger(artifact.bytes) &&
        artifact.bytes > 0 &&
        /^[a-f0-9]{64}$/u.test(artifact.sha256),
    ),
    `${label} embedding runtime entries must remain required and hash-pinned`,
  );
  const targets = embeddingArtifacts.map(
    (artifact) => `${decodeURIComponent(String(artifact.url || ""))} ${artifact.asset_path || ""}`,
  );
  for (const suffix of [
    "/onnx/model_qint8_arm64.onnx",
    "/ort/ort-wasm-simd-threaded.mjs",
    "/ort/ort-wasm-simd-threaded.wasm",
  ]) {
    assert(targets.some((target) => target.includes(suffix)), `${label} setup manifest is missing ${suffix}`);
  }
}

function assertEmbeddingConfinement(vectorSource, label) {
  for (const pattern of [
    /env\.allowRemoteModels\s*=\s*false/,
    /env\.allowLocalModels\s*=\s*true/,
    /pipeline\(\s*["']feature-extraction["']/,
    /local_files_only\s*:\s*true/,
  ]) {
    assert(pattern.test(vectorSource), `${label} vector runtime is missing local embedding confinement ${pattern}`);
  }
}

function assertNoForbiddenFirstPartySource(unzip, archive, entries, kind, label) {
  for (const entry of entries) {
    const assetPath = normalizeAssetPath(entry, kind);
    if (!assetPath || assetPath.startsWith("vendor/")) continue;
    const extension = assetPath.slice(assetPath.lastIndexOf("."));
    if (!FIRST_PARTY_EXECUTABLE_EXTENSIONS.has(extension)) continue;
    const source = archiveText(unzip, archive, entry);
    for (const pattern of FORBIDDEN_FIRST_PARTY_SOURCE_PATTERNS) {
      assert(!pattern.test(source), `${label} first-party asset ${entry} contains forbidden product pattern ${pattern}`);
    }
  }
}

function assertAssetBoundary(unzip, archive, entries, kind, label) {
  assertNoForbiddenPaths(entries, label);
  assertRequiredAssets(entries, kind, label);

  const profile = parseJsonAsset(unzip, archive, "caatuu-profile.json", kind, label);
  assertStoreProfile(profile, label);
  const catalog = parseJsonAsset(unzip, archive, "data/embeddings/models.json", kind, label);
  const manifest = parseJsonAsset(
    unzip,
    archive,
    "data/embeddings/all-minilm-l6-v2-qint8-v0.1/manifest.json",
    kind,
    label,
  );
  assertEmbeddingCatalog(catalog, manifest, label);
  const dictionaryCatalog = parseJsonAsset(
    unzip,
    archive,
    "data/dictionaries/catalog.json",
    kind,
    label,
  );
  const dictionaryManifest = parseJsonAsset(
    unzip,
    archive,
    "data/dictionaries/kaikki-cs-en-2026-07-09/manifest.json",
    kind,
    label,
  );
  assertDictionaryCatalog(dictionaryCatalog, dictionaryManifest, label);
  const setup = parseJsonAsset(unzip, archive, "setup-assets.json", kind, label);
  assertSetupEmbeddingBoundary(setup, label);
  assertEmbeddingConfinement(
    archiveText(unzip, archive, archiveEntryForAsset("source/shared/vector-db.js", kind)),
    label,
  );
  assertNoForbiddenFirstPartySource(unzip, archive, entries, kind, label);
}

function assertApkManifest(apkanalyzerPath, apk, allowTransitionDebug = false) {
  const command = (subject, verb) => run(apkanalyzerPath, [subject, verb, apk]).trim();
  assert(command("manifest", "application-id") === EXPECTED_APPLICATION_ID, "Caatuu APK application ID is incorrect");
  assert(Number(command("manifest", "min-sdk")) === EXPECTED_MIN_SDK, "Caatuu APK min SDK must be 30");
  assert(Number(command("manifest", "target-sdk")) >= MINIMUM_TARGET_SDK, "Caatuu APK target SDK must be at least 36");
  assert(
    command("manifest", "debuggable") === (allowTransitionDebug ? "true" : "false"),
    allowTransitionDebug
      ? "Caatuu transition APK must be debuggable for compatibility with the old updater"
      : "Caatuu APK must be non-debuggable",
  );

  const permissions = new Set(
    command("manifest", "permissions")
      .split(/\r?\n/u)
      .map((permission) => permission.trim())
      .filter(Boolean),
  );
  assert(permissions.has("android.permission.INTERNET"), "Caatuu APK must retain INTERNET permission");
  assert(
    permissions.has("android.permission.REQUEST_INSTALL_PACKAGES"),
    "direct Caatuu APK must retain REQUEST_INSTALL_PACKAGES for verified self-updates",
  );

  const manifest = command("manifest", "print");
  assert(/android:usesCleartextTraffic="false"/u.test(manifest), "Caatuu APK must disable cleartext traffic");
  assert(/android:name="com\.caatuu\.android\.CaatuuActivity"/u.test(manifest), "Caatuu APK must launch CaatuuActivity");
  assert(/androidx\.core\.content\.FileProvider/u.test(manifest), "Caatuu APK must expose its private verified-update FileProvider");
  assert(!/android:name="com\.caatuu\.android\.MainActivity"/u.test(manifest), "Caatuu APK must not retain the development MainActivity");
}

function assertDexBoundary(apkanalyzerPath, apk) {
  const dex = run(apkanalyzerPath, ["dex", "packages", "--defined-only", apk]);
  for (const className of REQUIRED_NATIVE_CLASSES) {
    assert(
      new RegExp(`\\b${escapeRegExp(className)}(?:\\$|\\s|$)`, "u").test(dex),
      `Caatuu APK is missing native class ${className}`,
    );
  }
  for (const pattern of FORBIDDEN_NATIVE_CLASS_PATTERNS) {
    assert(!pattern.test(dex), `Caatuu APK contains forbidden native class pattern ${pattern}`);
  }
  for (const method of [
    "runPrompt",
    "loadModel",
    "downloadModel",
    "startModelDownload",
    "resetConversation",
    "runBenchmark",
  ]) {
    assert(!new RegExp(`\\b${method}\\b`, "u").test(dex), `Caatuu APK contains forbidden bridge method ${method}`);
  }

  const bridgeCode = run(apkanalyzerPath, [
    "dex",
    "code",
    "--class",
    "com.caatuu.android.ProductBridge",
    apk,
  ]);
  for (const operation of [
    "start_download",
    "cancel_download",
    "reset_conversation",
    "prompt",
    "benchmark",
    "delete_model",
  ]) {
    assert(
      !new RegExp(`const-string[^\\n]+"${operation}"`, "u").test(bridgeCode),
      `Caatuu bridge exposes forbidden native operation ${operation}`,
    );
  }
}

function verifyAabDerivedApkAssets(unzip, aab, aabEntries, apk, apkEntries, allowTransitionDebug = false) {
  const aabAssets = new Map(
    aabEntries
      .map((entry) => [normalizeAssetPath(entry, "aab"), entry])
      .filter(([assetPath]) => assetPath && !assetPath.endsWith("/")),
  );
  const apkAssets = new Map(
    apkEntries
      .map((entry) => [normalizeAssetPath(entry, "apk"), entry])
      .filter(([assetPath]) => assetPath && !assetPath.endsWith("/")),
  );
  for (const [assetPath, aabEntry] of aabAssets) {
    const apkEntry = apkAssets.get(assetPath);
    assert(Boolean(apkEntry), `universal APK is missing AAB asset ${assetPath}`);
    assert(
      archiveBuffer(unzip, aab, aabEntry).equals(archiveBuffer(unzip, apk, apkEntry)),
      `universal APK contains bytes different from the AAB for ${assetPath}`,
    );
  }
  const derivedApkAssets = [...apkAssets.keys()].filter((assetPath) => !aabAssets.has(assetPath));
  const expectedDerivedAssets = allowTransitionDebug
    ? []
    : ["dexopt/baseline.prof", "dexopt/baseline.profm"];
  assert(
    JSON.stringify(derivedApkAssets.sort()) === JSON.stringify(expectedDerivedAssets),
    `universal APK contains unexpected bundletool-derived assets: ${derivedApkAssets.join(", ")}`,
  );
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`Caatuu package validator usage error: ${error.message}`);
    usage();
    process.exitCode = 2;
    return;
  }
  if (options.help) return usage();

  const aab = resolve(options.aab);
  const apk = resolve(options.apk);
  try {
    assert(existsSync(aab), `Caatuu AAB does not exist at ${aab}`);
    assert(existsSync(apk), `AAB-derived universal APK does not exist at ${apk}`);

    const aabEntries = archiveEntries(options.unzip, aab);
    const apkEntries = archiveEntries(options.unzip, apk);
    assertAssetBoundary(options.unzip, aab, aabEntries, "aab", "Caatuu AAB");
    assertAssetBoundary(options.unzip, apk, apkEntries, "apk", "AAB-derived universal APK");
    verifyAabDerivedApkAssets(
      options.unzip,
      aab,
      aabEntries,
      apk,
      apkEntries,
      options.allowTransitionDebug,
    );
    assertApkManifest(options.apkanalyzer, apk, options.allowTransitionDebug);
    assertDexBoundary(options.apkanalyzer, apk);

    console.log(`Caatuu package boundary passed for ${basename(aab)} and ${basename(apk)}.`);
  } catch (error) {
    console.error(`Caatuu package boundary failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
