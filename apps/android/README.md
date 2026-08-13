# Caatuu Android

This directory contains two native Android shells. The default `app` module is
the full development application, including its optional native `llama.cpp`
bridge. The `product` module is the canonical Caatuu application: it
packages a compiled allowlist of the Czech experience with embeddings,
dictionary, speech, local learning data, and standard games, but no LLM, Chat,
generation, Godot, or outbound-reporting capability.

Both shells load a Czech WebView application whose source lives under
`apps/languages/czech/static`. The store compiler does not delete or modify
that development source; it creates a fail-closed release surface under the
`product` build directory. Standalone game artifacts under `artifacts/games`
are excluded from both Android distributions.

## Runtime Shape

- UI: existing Czech static app, loaded in a WebView from APK assets. The full
  module copies the development surface; `product` compiles an explicit
  release allowlist.
- Games: no standalone game export is currently bundled. Memory Moon remains a
  static application placeholder.
- Start URL: `https://caatuu.local/cz/index.html`.
- The shared Czech source assets are packaged for browser/Android parity; heavy
  browser model payloads are excluded.
- WebView HTTP cache is disabled and service-worker requests are blocked by the
  native shell even though the shared `sw.js` source remains in the APK.
- First-run setup downloads verified visual assets, embeddings, and the
  dictionary. The full module may additionally download an optional GGUF;
  `product` has no model catalog or model operation.
- Full-module model runtime: llama.cpp Android binding from
  `tools/on-device-models/vendor`.
- Full-module model file:
  `caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf`.
- Android minimum: Android 11 / API 30 by default.
- Android target SDK: API 36 by default for both debug and release builds.
- No Termux is needed for this app path.
- No system prompt is added by the Android bridge.
- Thinking toggle: passed into the Qwen chat template as `enable_thinking`.

The default build uses these Gradle properties:

```text
caatuuLanguageId=cz
caatuuLanguageAppDir=languages/czech
caatuuLanguageRoutePrefix=/cz
caatuuLanguageEntryPath=/cz/index.html
```

Override all four together for a future language build. That language must also
provide compatible model, dictionary, embedding, and setup catalogs; changing
only the route does not turn the current Czech native adapters into another
language.

## Prepare Vendor Code

From PowerShell:

```powershell
cd C:\Work\caatuu
apps\android\scripts\prepare-llama-vendor.ps1
```

The clone lands in `tools/on-device-models/vendor/llama.cpp`, which is ignored by Git.
Both preparation scripts check out the exact llama.cpp commit declared as
`LLAMA_CPP_COMMIT` in `apps/android/tooling/versions.env`, verify `HEAD`, and then
apply `patches/llama-android-thinking.patch`. The overlay passes the thinking
toggle into the Qwen chat template, fixes native token-position accounting,
surfaces prompt-processing failures, and adds a keep-loaded conversation reset.
A dirty checkout at a different commit is rejected instead of being overwritten.

The bridge serializes inference and artifact mutations. UI deadlines cancel the
matching native request instead of merely hiding its eventual response; a model
download abort is scoped to the selected model. Word World and translation use
fresh conversation state while retaining loaded weights, and Chat's **New**
control explicitly resets the retained native context.

## Build

Use the Docker build path from the repository root. It installs command-line
Android tools inside a Debian container and writes the APK back into the shared
workspace:

```powershell
cd C:\Work\caatuu

docker run --rm -it `
  -v C:\Work\caatuu:/workspace `
  -v caatuu-android-sdk:/opt/android-sdk `
  -v caatuu-gradle-dist:/opt/gradle `
  -v caatuu-gradle-cache:/root/.gradle `
  -w /workspace `
  debian:12 `
  bash -lc "bash apps/android/tooling/setup-container.sh && bash apps/android/tooling/setup-sdk.sh && bash apps/android/tooling/build-debug-apk.sh"
```

The full development APK lands at
`C:\Work\caatuu\artifacts\android\caatuu-debug.apk`. Release AAB/APK builds
are documented in `apps/android/tooling/README.md`. The AAB builder selects only
the separate `product` module and validates an AAB-derived universal APK. That
same stripped, non-debuggable artifact is Caatuu's direct public release and
keeps the verified updater while distribution remains outside Google Play.

The debug build also creates `C:\Work\caatuu\artifacts\android\caatuu-debug.keystore`
on first use and reuses it for later debug APKs. Keep that local file if you
want Android to accept updates over an already installed debug build.

The debug build writes `C:\Work\caatuu\artifacts\android\caatuu-debug.json`
beside the APK. The Caatuu `Update app` button reads that manifest, verifies
the APK hash, and then opens Android's installer. Android may ask you to allow
installs from Caatuu once during development.

A generic debug build uses the reserved `updates.caatuu.invalid` host, so it is
sideload-only and cannot accidentally request debug artifacts from the public
stable channel. Set the LAN update base below before building when testing the
in-app updater.

The full development/direct-download application can deliver remote diagnostics
to `https://caatuu.waajacu.com/api/bug-report` independently of the APK update
channel. Set `CAATUU_ANDROID_REPORT_URL` only when a trusted development server
should receive debug reports instead. `product` keeps bug reports and
dictionary-gap reports local and exposes no delivery bridge operation.

Missing Czech dictionary lookups use a separate, narrow native delivery route.
The bridge accepts only the dictionary-gap schema and its six data fields, adds
no device or app metadata, and posts it directly to
`https://caatuu.waajacu.com/cz/api/dictionary/gaps`. The shared UI keeps failed
deliveries in its device-local outbox and retries them later. Set
`CAATUU_ANDROID_DICTIONARY_GAP_URL` only for a trusted development server;
release builds require HTTPS while debug builds may use HTTP for LAN testing.

For local phone testing, point the debug updater at the dev server that serves
`/android/caatuu-debug.json` and `/android/caatuu-debug.apk`:

```bash
CAATUU_ANDROID_UPDATE_BASE_URL=http://<your-pc-lan-ip>:8765/android \
  bash apps/android/tooling/build-debug-apk.sh
```

The normal Compose runtime is deliberately loopback-only and does not mount
debug download routes. Expose them temporarily on one trusted LAN interface
from PowerShell:

```powershell
$env:CAATUU_PHONE_DEBUG_BIND = "<your-pc-lan-ip>"
docker compose -f compose.yaml -f compose/phone-debug.yaml up -d --force-recreate caatuu
```

Do not start the public tunnel with this override. After the phone test,
restore the fail-closed server:

```powershell
Remove-Item Env:\CAATUU_PHONE_DEBUG_BIND
docker compose up -d --force-recreate caatuu
```

Debug builds allow cleartext HTTP for local update testing. Release builds keep
cleartext disabled and should use an HTTPS update host.

Android release identities are intentionally separate:

- `caatuu-debug.apk` remains a debuggable developer artifact only.
- `caatuu.apk` and `caatuu.json` are the canonical non-debuggable product and
  stable in-app update channel.
- `caatuu-debug.json` is retained temporarily as an update bridge for installs
  made before version 0.1.0; it points those installations to the stable APK.

Never copy or rename a debug APK into the stable channel. The stable manifest
may be absent until release signing credentials are available.

The full build copies Czech static assets into generated APK assets while
excluding heavy model payloads such as `.gguf`, `.bin`, `.params`,
`.safetensors`, and the browser-only WebLLM export. `product` instead emits an
exact allowlist and rejects Chat, generation/model catalogs and URLs, inference
native libraries, Godot exports/routes, and outbound-reporting code. The full
APK includes only `arm64-v8a` native libraries by default; set
`CAATUU_ANDROID_ABIS=arm64-v8a,x86_64` when an emulator build needs both.

Android packaging is intentionally independent from the standalone Caatuu Game.
`syncLanguageAssets` excludes `games/**`, no generated game asset source is
registered, and the WebView asset client rejects `/games/**`. Application builds
must therefore succeed when `artifacts/games/` is absent and APK audits reject
any accidental `assets/games/` entry.

The same rule applies to the Czech semantic-search artifacts. Each Android
package excludes
the SQLite database, ONNX weights, ONNX Runtime WASM, and model configuration
under `data/embeddings/`. The setup flow downloads and verifies those artifacts
into app-private storage after install. In `product`, this embedding path is
retained independently of the excluded LLM path.

The WebView bridge exposes native artifact-management requests:

- `vector_status`: reports local SQLite vector DB state.
- `vector_download`: downloads and verifies the current SQLite vector DB.
- `vector_search`: remains a compatibility entry point, but native text search
  rejects model mismatches instead of hashing a semantic query.

After setup, the asset client serves the verified DB, model, and WASM artifacts
back to browser-side code under `/cz/data/embeddings/...`. Both the browser PWA
and Android WebView run the same local MiniLM query embedder and sql.js search,
so they cannot silently drift to different vector spaces.

## Full Development App Phone Test

1. Install the debug APK.
2. Confirm that the app opens the Caatuu Czech home menu.
3. Open `Chat`.
4. Tap `Load model`.
5. Let the one-time model download finish.
6. Type a message and tap `Send`.

After the model is verified once, the app should keep working without network.
The downloaded GGUF lives under Android app-private storage and is removed by
the OS when the app is uninstalled. The Chat settings screen also includes
`Delete model` for manual cleanup during development.

For a `product` candidate, generate the universal APK from the AAB with the
canonical AAB builder, install that derived APK, and test Home, setup,
dictionary, speech, image retrieval, statistics, Standard Word World, restart,
and offline behavior. Chat, model controls, generative content, Godot routes,
and report delivery must remain absent. An unsigned milestone
or its ephemeral inspection APK is never a publishable release.
