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

Use an Android build environment with SDK, NDK, CMake, JDK 17, and Gradle.
From the Android project folder:

```powershell
cd C:\Work\caatuu\apps\caatuu-android
gradle assembleDebug
```

Or open `C:\Work\caatuu\apps\caatuu-android` in Android Studio and build the
debug APK.

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
