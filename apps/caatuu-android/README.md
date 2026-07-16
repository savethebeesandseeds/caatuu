# Caatuu Android

This is the native Android shell. Its current default course and native model
adapter are Czech, but the packaged static app and WebView entry route are build
configuration rather than literals in the shell.

The app packages the existing Czech browser UI from `apps/caatuu-czech/static`
and exposes a native `llama.cpp` bridge to that UI. The GGUF model is not put in
Git and is not bundled into the APK. On first use, the app downloads the model
from `caatuu.waajacu.com`, verifies its SHA-256, stores it in app-private
storage, and then works offline.

## Runtime Shape

- UI: existing Czech static app, loaded in a WebView from APK assets.
- Start URL: `https://caatuu.local/cz/home.html`.
- The shared Czech source assets are packaged for browser/Android parity; heavy
  browser model payloads are excluded.
- WebView HTTP cache is disabled and service-worker requests are blocked by the
  native shell even though the shared `sw.js` source remains in the APK.
- First-run setup downloads verified visual assets before GGUF models,
  embeddings, and the dictionary. This lets the setup animation begin while
  the larger language artifacts are still being prepared.
- Model runtime: llama.cpp Android binding from `tools/phone-bench/vendor`.
- Model file: `caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf`.
- Android minimum: Android 11 / API 30 by default.
- Android target SDK: API 36 by default for both debug and release builds.
- No Termux is needed for this app path.
- No system prompt is added by the Android bridge.
- Thinking toggle: passed into the Qwen chat template as `enable_thinking`.

The default build uses these Gradle properties:

```text
caatuuLanguageId=cz
caatuuLanguageAppDir=caatuu-czech
caatuuLanguageRoutePrefix=/cz
caatuuLanguageEntryPath=/cz/home.html
```

Override all four together for a future language build. That language must also
provide compatible model, dictionary, embedding, and setup catalogs; changing
only the route does not turn the current Czech native adapters into another
language.

## Prepare Vendor Code

From PowerShell:

```powershell
cd C:\Work\caatuu
apps\caatuu-android\scripts\prepare-llama-vendor.ps1
```

The clone lands in `tools/phone-bench/vendor/llama.cpp`, which is ignored by Git.
Both preparation scripts check out the exact llama.cpp commit declared as
`LLAMA_CPP_COMMIT` in `tools/android-build/versions.env`, verify `HEAD`, and then
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
  bash -lc "bash tools/android-build/setup-container.sh && bash tools/android-build/setup-sdk.sh && bash tools/android-build/build-debug-apk.sh"
```

The debug APK lands at
`C:\Work\caatuu\artifacts\android\caatuu-debug.apk`. Release AAB/APK builds
are documented in `tools/android-build/README.md`; the AAB uses a store-managed
update variant, while the directly distributed APK retains Caatuu's signed updater.

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

Remote diagnostics use `https://caatuu.waajacu.com/api/bug-report` independently
of the APK update channel. Set `CAATUU_ANDROID_REPORT_URL` only when a trusted
development server should receive debug reports instead.

For local phone testing, point the debug updater at the dev server that serves
`/android/caatuu-debug.json` and `/android/caatuu-debug.apk`:

```bash
CAATUU_ANDROID_UPDATE_BASE_URL=http://<your-pc-lan-ip>:8765/android \
  bash tools/android-build/build-debug-apk.sh
```

The normal Compose runtime is deliberately loopback-only and does not mount
debug download routes. Expose them temporarily on one trusted LAN interface
from PowerShell:

```powershell
$env:CAATUU_PHONE_DEBUG_BIND = "<your-pc-lan-ip>"
docker compose -f compose.yaml -f compose.phone-debug.yaml up -d --force-recreate caatuu
```

Do not start the public tunnel with this override. After the phone test,
restore the fail-closed server:

```powershell
Remove-Item Env:\CAATUU_PHONE_DEBUG_BIND
docker compose up -d --force-recreate caatuu
```

Debug builds allow cleartext HTTP for local update testing. Release builds keep
cleartext disabled and should use an HTTPS update host.

Android update channels are intentionally separate:

- `caatuu-debug.apk` and `caatuu-debug.json` are debug-signed, debuggable
  developer artifacts.
- `caatuu.apk` and `caatuu.json` are created only by the signed release APK
  build and are the stable in-app update channel.

Never copy or rename a debug APK into the stable channel. The stable manifest
may be absent until release signing credentials are available.

The build copies Czech static assets into generated APK assets while excluding
heavy model payloads such as `.gguf`, `.bin`, `.params`, `.safetensors`, and
the browser-only WebLLM export. The default APK includes only `arm64-v8a`
native libraries for phones; set `CAATUU_ANDROID_ABIS=arm64-v8a,x86_64` when
you need an emulator build.

The same rule applies to the Czech semantic-search artifacts. The APK excludes
the SQLite database, ONNX weights, ONNX Runtime WASM, and model configuration
under `data/embeddings/`. The setup flow downloads and verifies those artifacts
into app-private storage after install, matching the GGUF model strategy.

The WebView bridge exposes native artifact-management requests:

- `vector_status`: reports local SQLite vector DB state.
- `vector_download`: downloads and verifies the current SQLite vector DB.
- `vector_search`: remains a compatibility entry point, but native text search
  rejects model mismatches instead of hashing a semantic query.

After setup, the asset client serves the verified DB, model, and WASM artifacts
back to browser-side code under `/cz/data/embeddings/...`. Both the browser PWA
and Android WebView run the same local MiniLM query embedder and sql.js search,
so they cannot silently drift to different vector spaces.

## First Phone Test

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
