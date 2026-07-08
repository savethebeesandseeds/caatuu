# Caatuu Android Build

This folder keeps the Android build environment out of Windows. It uses a
temporary Debian container, shared Docker volumes for downloaded tools, and the
checked-out workspace mounted at `/workspace`.

The app package stays light: it includes the Czech WebView UI and native
llama.cpp bridge for the target phone ABI, but it does not bundle GGUF weights
or browser WebLLM exports. The first model download is stored in app-private
storage and checked against the SHA-256 in the Android code.

## Plan

1. Keep the PWA as the light browser app.
2. Keep the native Android app only for phones that need offline CPU inference.
3. Build with command-line SDK tools, JDK 17, Gradle, NDK, and CMake inside
   Docker, not on the Windows host.
4. Publish a Play Store AAB when we are ready. Use debug APKs only for local
   phone testing.
5. Keep model weights, SDK caches, build outputs, signing keys, and upload
   certificates out of Git.

## One-Time Debug Build

From PowerShell:

```powershell
docker run --rm -it `
  -v C:\Work\caatuu:/workspace `
  -v caatuu-android-sdk:/opt/android-sdk `
  -v caatuu-gradle-dist:/opt/gradle `
  -v caatuu-gradle-cache:/root/.gradle `
  -w /workspace `
  debian:latest `
  bash -lc "bash tools/android-build/setup-container.sh && bash tools/android-build/setup-sdk.sh && bash tools/android-build/build-debug-apk.sh"
```

The debug APK is written to:

```text
C:\Work\caatuu\artifacts\android\caatuu.apk
```

The matching development update manifest is written to:

```text
C:\Work\caatuu\artifacts\android\caatuu.json
```

The first debug build also creates:

```text
C:\Work\caatuu\artifacts\android\caatuu-debug.keystore
```

That local ignored key is reused by later debug builds so Android can update the
same installed debug package. If you delete it, future debug APKs will be signed
with a new key and Android may require uninstalling the old debug app first.

By default the APK targets Android 11 / API 30 or newer. To test a different
minimum SDK, pass `-e CAATUU_ANDROID_MIN_SDK=33` or another API level to the
Docker command.

Debug sideload APKs default to `targetSdk` 30 for compatibility with Android 11
package installers. For a Play Store release, pass
`-e CAATUU_ANDROID_TARGET_SDK=36`.

For local phone update testing, set the debug update base URL to the dev server
that serves the generated APK and manifest:

```bash
CAATUU_ANDROID_UPDATE_BASE_URL=http://<your-pc-lan-ip>:8765/android \
  bash tools/android-build/build-debug-apk.sh
```

The generated `caatuu.json` will use that URL for `apk_url`, and the debug
APK will use the same base URL for its `Update app` button.

APK builds default to `arm64-v8a`, which is the ABI used by current Android
phones and keeps debug APKs smaller. To build a package that also runs on an
x86_64 emulator, pass `-e CAATUU_ANDROID_ABIS=arm64-v8a,x86_64`.

## Device Smoke Check

After building the debug APK, connect one authorized Android device to the
container and run:

```bash
bash tools/android-build/verify-debug-apk-device.sh
```

The script uses `/opt/android-sdk/platform-tools/adb`, installs
`artifacts/android/caatuu.apk`, launches
`com.waajacu.caatuu/com.caatuu.android.MainActivity`, and writes a report,
logcat, UI dump, and screenshot under:

```text
artifacts/android/device-smoke/
```

It fails if no single authorized device is visible, the package does not stay
running, or retired browser/archive route names appear in logcat.

## Interactive Container

For repeated work, open a shell first:

```powershell
docker run --rm -it `
  -v C:\Work\caatuu:/workspace `
  -v caatuu-android-sdk:/opt/android-sdk `
  -v caatuu-gradle-dist:/opt/gradle `
  -v caatuu-gradle-cache:/root/.gradle `
  -w /workspace `
  debian:latest `
  bash
```

Inside the container:

```bash
bash tools/android-build/setup-container.sh
bash tools/android-build/setup-sdk.sh
bash tools/android-build/build-debug-apk.sh
```

## Signed Release

Store the upload key outside the repository. Mount it read-only into the build
container and pass signing values as environment variables:

```powershell
docker run --rm -it `
  -v C:\Work\caatuu:/workspace `
  -v C:\Work\caatuu-keys:/keys:ro `
  -v caatuu-android-sdk:/opt/android-sdk `
  -v caatuu-gradle-dist:/opt/gradle `
  -v caatuu-gradle-cache:/root/.gradle `
  -e CAATUU_ANDROID_KEYSTORE=/keys/upload.jks `
  -e CAATUU_ANDROID_KEYSTORE_PASSWORD=change-me `
  -e CAATUU_ANDROID_KEY_ALIAS=upload `
  -e CAATUU_ANDROID_KEY_PASSWORD=change-me `
  -w /workspace `
  debian:latest `
  bash -lc "bash tools/android-build/setup-container.sh && bash tools/android-build/setup-sdk.sh && bash tools/android-build/build-release-aab.sh"
```

The Play Store bundle is written to:

```text
C:\Work\caatuu\artifacts\android\caatuu-release.aab
```

Build a signed APK for direct testing with:

```bash
bash tools/android-build/build-release-apk.sh
```

## Distribution Notes

- Google Play uses Android App Bundles for new apps.
- Google Play Console currently has a one-time registration fee.
- New personal developer accounts may need a closed test before production
  access.
- Signing keys must not be committed. The repo ignores common Android key file
  extensions.
- The GGUF model remains an external app-managed download, so app updates stay
  small.
- Native runtime libraries should stay signed inside the APK/AAB, or later be
  delivered through official dynamic delivery. Downloading executable `.so`
  files from our own server during app startup is intentionally avoided.

Official references:

- https://developer.android.com/studio
- https://developer.android.com/tools
- https://developer.android.com/studio/projects/install-ndk
- https://developer.android.com/guide/app-bundle
- https://developer.android.com/studio/publish/app-signing
- https://support.google.com/googleplay/android-developer/answer/6112435
- https://support.google.com/googleplay/android-developer/answer/14151465
