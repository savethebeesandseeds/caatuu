# Caatuu Android Build

This folder keeps the Android build environment out of Windows. It uses a
temporary Debian container, shared Docker volumes for downloaded tools, and the
checked-out workspace mounted at `/workspace`.

The app package stays light: it includes the Czech WebView UI and native
llama.cpp bridge, but it does not bundle GGUF weights. The first model download
is stored in app-private storage and checked against the SHA-256 in the Android
code.

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
C:\Work\caatuu\artifacts\android\caatuu-debug.apk
```

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
- The model remains an external app-managed download, so app updates stay small.

Official references:

- https://developer.android.com/studio
- https://developer.android.com/tools
- https://developer.android.com/studio/projects/install-ndk
- https://developer.android.com/guide/app-bundle
- https://developer.android.com/studio/publish/app-signing
- https://support.google.com/googleplay/android-developer/answer/6112435
- https://support.google.com/googleplay/android-developer/answer/14151465
