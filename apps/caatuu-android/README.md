# Caatuu Android

This is the native Android path for the offline Czech model.

The app packages the existing Czech browser UI from `apps/caatuu-czech/static`
and exposes a native `llama.cpp` bridge to that UI. The GGUF model is not put in
Git and is not bundled into the APK. On first use, the app downloads the model
from `caatuu.waajacu.com`, verifies its SHA-256, stores it in app-private
storage, and then works offline.

## Runtime Shape

- UI: existing Czech static app, loaded in a WebView from APK assets.
- Start URL: `https://caatuu.local/cz/home.html`.
- Browser-only launcher files and service workers are not packaged.
- WebView HTTP cache is disabled and service-worker requests are blocked.
- Model runtime: llama.cpp Android binding from `tools/phone-bench/vendor`.
- Model file: `caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf`.
- Android minimum: Android 11 / API 30 by default.
- Android target for debug sideloads: API 30 by default.
- No Termux is needed for this app path.
- No system prompt is added by the Android bridge.
- Thinking toggle: passed into the Qwen chat template as `enable_thinking`.

## Prepare Vendor Code

From PowerShell:

```powershell
cd C:\Work\caatuu
apps\caatuu-android\scripts\prepare-llama-vendor.ps1
```

The clone lands in `tools/phone-bench/vendor/llama.cpp`, which is ignored by Git.
The prepare script also applies `patches/llama-android-thinking.patch` so the
Android wrapper can pass the thinking toggle into the Qwen chat template.

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
  debian:latest `
  bash -lc "bash tools/android-build/setup-container.sh && bash tools/android-build/setup-sdk.sh && bash tools/android-build/build-debug-apk.sh"
```

The debug APK lands at `C:\Work\caatuu\artifacts\android\caatuu.apk`.
Release AAB/APK builds are documented in `tools/android-build/README.md`.

The debug build also creates `C:\Work\caatuu\artifacts\android\caatuu-debug.keystore`
on first use and reuses it for later debug APKs. Keep that local file if you
want Android to accept updates over an already installed debug build.

The debug build writes `C:\Work\caatuu\artifacts\android\caatuu.json`
beside the APK. The Caatuu `Update app` button reads that manifest, verifies
the APK hash, and then opens Android's installer. Android may ask you to allow
installs from Caatuu once during development.

For local phone testing, point the debug updater at the dev server that serves
`/android/caatuu.json` and `/android/caatuu.apk`:

```bash
CAATUU_ANDROID_UPDATE_BASE_URL=http://<your-pc-lan-ip>:8765/android \
  bash tools/android-build/build-debug-apk.sh
```

Debug builds allow cleartext HTTP for local update testing. Release builds keep
cleartext disabled and should use an HTTPS update host.

The build copies Czech static assets into generated APK assets while excluding
heavy model payloads such as `.gguf`, `.bin`, `.params`, `.safetensors`, and
the browser-only WebLLM export. The default APK includes only `arm64-v8a`
native libraries for phones; set `CAATUU_ANDROID_ABIS=arm64-v8a,x86_64` when
you need an emulator build.

The same rule applies to the Czech vector database path. The APK excludes heavy
`data/embeddings/` artifacts such as SQLite databases, ONNX weights, WASM
runtimes, and tensor blobs. The native `VectorDatabaseManager` is prepared to
download a verified SQLite vector database into app-private storage after
install, matching the GGUF model strategy.

The WebView bridge exposes native vector requests:

- `vector_status`: reports local SQLite vector DB state.
- `vector_download`: downloads and verifies the current SQLite vector DB.
- `vector_search`: downloads if needed, then searches locally through Android
  SQLite.

After `vector_download`, the asset client can also serve the local DB back to
browser-side code at `/cz/data/embeddings/.../caatuu-cz-curriculum.sqlite`.

## First Phone Test

1. Install the debug APK.
2. Version 0.1.22 (23) opens the Caatuu Czech home menu.
3. Open `Chat`.
4. Tap `Load model`.
5. Let the one-time model download finish.
6. Type a message and tap `Send`.

After the model is verified once, the app should keep working without network.
The downloaded GGUF lives under Android app-private storage and is removed by
the OS when the app is uninstalled. The Chat settings screen also includes
`Delete model` for manual cleanup during development.
