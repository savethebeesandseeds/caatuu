# Caatuu Android

This is the native Android path for the offline Czech model.

The app packages the existing Czech browser UI from `apps/caatuu-czech/static`
and exposes a native `llama.cpp` bridge to that UI. The GGUF model is not put in
Git and is not bundled into the APK. On first use, the app downloads the model
from `caatuu.waajacu.com`, verifies its SHA-256, stores it in app-private
storage, and then works offline.

## Runtime Shape

- UI: existing Czech static app, loaded in a WebView from APK assets.
- Model runtime: llama.cpp Android binding from `tools/phone-bench/vendor`.
- Model file: `caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf`.
- Android minimum: Android 11 / API 30 by default.
- No Termux is needed for this app path.
- No system prompt is added by the Android bridge.

## Prepare Vendor Code

From PowerShell:

```powershell
cd C:\Work\caatuu
apps\caatuu-android\scripts\prepare-llama-vendor.ps1
```

The clone lands in `tools/phone-bench/vendor/llama.cpp`, which is ignored by Git.

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

The debug APK lands at `C:\Work\caatuu\artifacts\android\caatuu-debug.apk`.
Release AAB/APK builds are documented in `tools/android-build/README.md`.

The build copies Czech static assets into generated APK assets while excluding
heavy model payloads such as `.gguf`, `.bin`, `.params`, and `.safetensors`.

## First Phone Test

1. Install the debug APK.
2. Open Device AI inside the app.
3. Select `Caatuu Czech LoRA - trained hard`.
4. Tap `Load native model`.
5. Let the one-time model download finish.
6. Type a prompt and run it.

After the model is verified once, the app should keep working without network.
