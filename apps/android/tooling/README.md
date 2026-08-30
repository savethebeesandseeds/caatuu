# Caatuu Android Build

This folder keeps the Android build environment out of Windows. Repeat
publishes use the reusable `caatuu-dev` container and shared Docker volumes for
downloaded tools. A temporary Debian container remains available only as a
bootstrap or recovery path. Both mount the checkout at `/workspace`.

Android has two deliberate distributions. The full development
application includes the Czech WebView UI and native llama.cpp bridge for the
target phone ABI, but it does not bundle GGUF weights or browser WebLLM exports.
Generation models are optional, on-demand artifacts in that full application.
The `product` application is a separate module and compiled asset allowlist
with no LLM, Chat, generation, Godot, or outbound reporting capability. It is
the canonical direct release and retains verified self-updates, shared assets,
and the course capabilities declared by its manifest. The default Czech course
retains the Czech-to-English dictionary and the English MiniLM embedding pack.

Both Gradle modules select their course with the single repository-relative
`caatuuCourseManifest` property (default:
`apps/languages/czech/course.json`). The manifest owns course identity, route,
entry path, static root, Android enablement, and capabilities. Its
`resources.androidAssetCatalog` owns the exact course file allowlist and may
name reviewed shared runtime shell files; `language-runtime/contract.mjs` is the
required adapter ABI. The build rejects path escapes, catalog/course ID drift,
disabled Android courses, README/test runtime entries, and inconsistent
capabilities. That Android asset catalog also owns `nativeProviders`, a
schema-versioned registry. Enabled embeddings and dictionary providers name a
course-manifest resource rather than a fixed Czech asset path; the build
resolves the resource inside `staticRoot`, requires it in the exact allowlist,
and writes the resolved path into both BuildConfig and the package profile.
Speech explicitly binds Android TTS to `targetLanguage.speechLocale`. Missing,
extra, partial, or unsupported provider declarations stop the build.
`build-product-assets.mjs --course-manifest <file>` is the direct
compiler equivalent. Product profiles always force `llm`, `generation`, and
`chat` off while retaining embeddings, dictionary, learning, and Standard Word
World only when the course declares those capabilities.

At runtime, `product` parses the generated capability object strictly and also
requires the resolved provider registry to match it exactly. It does not
construct the vector database, dictionary, or Android speech manager when the
corresponding capability is false, and it never selects a default catalog path
when a capability is true. Disabled operation names receive the same response
as an unknown native operation. Speech locale and learner language labels are
generated from `targetLanguage` in the selected course manifest; there is no
generic-shell `cs-CZ` fallback.

## Plan

1. Keep the PWA as the light browser app.
2. Keep the native Android app only for phones that need offline CPU inference.
3. Build with command-line SDK tools, JDK 17, Gradle, NDK, and CMake inside
   Docker, not on the Windows host.
4. Build and audit Caatuu releases only through the `product` AAB entrypoint.
   Keep the full development application outside the public product channel.
5. Keep model weights, SDK caches, build outputs, signing keys, and upload
   certificates out of Git.

The native dependency is reproducible: `versions.env` pins llama.cpp by its
full commit hash, and the vendor preparation scripts verify that commit before
applying Caatuu's tracked Android overlay. The fallback Temurin JDK download is
accepted only when its upstream SHA-256 sidecar is available, well formed, and
matches the archive; checksum failures stop the build before extraction.

Setup asset metadata is reproducible as well. Every Gradle build runs
`refreshSetupAssetManifest` before copying browser files into the APK. The task
recalculates every artifact byte count and SHA-256 in
`apps/languages/czech/static/setup-assets.json` from the authoritative shared and
language static files. A missing source, duplicate key/URL, or unsupported path
stops the build. To inspect drift without writing the manifest, run inside
`caatuu-dev`:

```bash
node apps/server/tooling/refresh-setup-assets.mjs --check
```

The build task intentionally updates the tracked manifest when an asset was
edited, so include that generated metadata with the corresponding asset change.

## Canonical repeat public publish

For the installed debug-signing lineage, run the Bash publisher inside the
existing Linux development container:

```bash
docker exec caatuu-dev bash -lc 'cd /workspace && bash apps/android/tooling/publish-public-debug.sh'
```

### Efficient publication practices

The command above is the complete publication workflow. It builds the
public-channel APK, verifies the signing lineage, publishes the immutable
version and latest manifest, downloads the public artifact and compatibility
alias, checks their hashes and byte counts, and runs the runtime-boundary
audit.

For a routine **publish the app** request, a good default is:

1. Run relevant focused source tests.
2. Run `publish-public-debug.sh` and wait for its result.
3. If it exits successfully, optionally read the public manifest once to report
   the published version and URL.

Avoid automatically preceding it with `assembleDebug` or
`build-public-debug-apk.sh`, and avoid automatically repeating its APK download
or full audit afterward. Those duplicate passes often add minutes without
increasing assurance. A separate local build remains useful when a local APK,
device test, or pre-publication package inspection is part of the task.

If the terminal or client stops waiting while publication continues, inspect
the existing process and its output before deciding whether a retry is needed.
Additional verification is reasonable when output is incomplete, the publisher
fails, an artifact does not match, signing is in doubt, publication tooling
changed, or the user requests an independent release audit.

These are efficiency practices rather than hard restrictions. Keep the
certificate, immutable-version, and public verification safeguards inside the
canonical script.

If the development container is not already running, start it once:

```bash
docker compose --profile dev up -d caatuu-dev
```

Before running it, increment `versionCode` and `versionName` in
`apps/android/app/build.gradle.kts`. The helper refuses to overwrite an
equal or newer public version. For an intentional same-version repair, pass
`ALLOW_SAME_VERSION=1` to the Linux process.

The public-preview publisher is intentionally fail-closed about signing. It
requires the existing ignored
`artifacts/android/caatuu-debug.keystore` and verifies the built APK against
the tracked, non-secret certificate fingerprint in
`apps/android/tooling/public-debug-certificate.sha256`. If the keystore is
missing or the fingerprint differs, restore the original keystore; do not
generate a replacement for an update. A replacement key starts a new install
lineage and existing phones cannot accept it as an update.

```bash
docker exec -e ALLOW_SAME_VERSION=1 caatuu-dev bash -lc \
  'cd /workspace && bash apps/android/tooling/publish-public-debug.sh'
```

The helper performs the complete publication contract:

1. Runs entirely in the existing `caatuu-dev` Linux container and reuses its
   persistent Android SDK, Gradle distribution, and Gradle cache volumes.
2. Runs `build-public-debug-apk.sh` inside that container.
3. Requires the public runtime's immutable-publication capability before it
   changes any artifacts.
4. Requires the established debug keystore and verifies its public certificate
   fingerprint before any artifact is finalized.
5. Serializes artifact finalization with a Linux publication lock so concurrent
   builds cannot race the immutable-version check.
6. Publishes the APK at a version-owned URL such as
   `/android/debug-releases/112/caatuu-debug.apk`; a version code can never be
   overwritten with different bytes.
7. Publishes the small latest-version manifest last, then downloads both the
   immutable APK and the manual-download alias and verifies SHA-256 and byte
   count before running the public runtime-boundary audit.

The gated runtime exposes the same published pair through two names:

- `/android/caatuu-debug.json` and `/android/caatuu-debug.apk` remain the
  compatibility contract used by installed debug-signing-lineage apps.
- `/android/caatuu-preview.json` and `/android/caatuu-preview.apk` are the
  user-facing aliases used by the website. They are labeled **preview**, never
  release or beta, and disappear when the debug-download gate is disabled.

This split is deliberate: the manifest is mutable and answers "what is
latest?", while every APK URL is immutable and answers "what exact bytes did
this manifest describe?" Android can safely pause or resume an old download
without a newer publication changing the file beneath it.

Public route exposure is deployment configuration, not build logic. Configure
it once in the ignored root `.env`:

```dotenv
CAATUU_ENABLE_ANDROID_DEBUG_DOWNLOADS=1
```

Then recreate the lightweight runtime once:

```bash
docker compose up -d --force-recreate caatuu
```

The publication job checks this configuration before building, but it does not
mount the Docker socket or modify running infrastructure.

Do not start a bare `debian:12` container for a routine publish. The command in
the next section is only for bootstrapping or recovering when `caatuu-dev` and
its persistent tool volumes are unavailable.

## Bootstrap/fallback debug build

From PowerShell:

```powershell
docker run --rm -it `
  -v C:\Work\caatuu:/workspace `
  -v caatuu-android-sdk:/opt/android-sdk `
  -v caatuu-gradle-dist:/opt/gradle `
  -v caatuu-gradle-cache:/root/.gradle `
  -w /workspace `
  debian:12 `
  bash -lc "bash apps/android/tooling/setup-container.sh && bash apps/android/tooling/setup-sdk.sh && bash apps/android/tooling/build-debug-apk.sh"
```

The debug APK is written to:

```text
C:\Work\caatuu\artifacts\android\caatuu-debug.apk
```

That filename is a convenience alias. The updater uses the immutable copy:

```text
C:\Work\caatuu\artifacts\android\debug-releases\<versionCode>\caatuu-debug.apk
```

The matching development update manifest is written to:

```text
C:\Work\caatuu\artifacts\android\caatuu-debug.json
```

Without an explicit update base, both the APK and manifest use the reserved
`updates.caatuu.invalid` host. That safe default is intended for direct
sideloading; it prevents a debug build from probing the public stable channel.

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

Debug and release builds default to `targetSdk` 36. Override
`CAATUU_ANDROID_TARGET_SDK` only for a deliberate compatibility experiment;
published releases must continue to meet current store requirements.

For local phone update testing, set the debug update base URL to the dev server
that serves the generated APK and manifest:

```bash
CAATUU_ANDROID_UPDATE_BASE_URL=http://<your-pc-lan-ip>:8765/android \
  bash apps/android/tooling/build-debug-apk.sh
```

The generated `caatuu-debug.json` uses the same base URL plus the immutable
`debug-releases/<versionCode>/caatuu-debug.apk` path. The debug APK uses the
same base URL for its `Update app` button.

For Caatuu's explicit public sideload channel, use the hosted wrapper:

```bash
bash apps/android/tooling/build-public-debug-apk.sh
```

For routine publication, use the Bash publisher above. Calling the hosted
wrapper directly is appropriate only from an already prepared Linux container;
it creates the artifact pair but does not verify the public download.

This keeps generic debug builds fail-closed while publishing the installed
debug-signing lineage at `https://caatuu.waajacu.com/android/caatuu-debug.json`.
The current debug-signed app can update only from this matching channel.

When `CAATUU_ENABLE_ANDROID_DEBUG_DOWNLOADS=1` is present in the ignored root
`.env`, the generic sideload builder refuses to run with its invalid default
update host. This prevents a local build from silently replacing the live
public manifest. Use `publish-public-debug.sh` for the hosted channel, or
disable the public route before making a sideload-only build.

The default runtime binds only to Windows loopback and keeps all debug download
routes disabled. For a trusted LAN phone test, temporarily opt in from
PowerShell using the same IP that you put in the APK:

```powershell
$env:CAATUU_PHONE_DEBUG_BIND = "<your-pc-lan-ip>"
docker compose -f compose.yaml -f compose/phone-debug.yaml up -d --force-recreate caatuu
```

Do not combine the phone-debug override with the public tunnel. You can audit
the deliberately exposed debug channel with:

```powershell
node apps\server\tooling\audit-runtime-boundary.mjs --base-url http://<your-pc-lan-ip>:8765 --apk artifacts\android\caatuu-debug.apk --allow-debug-artifacts
```

Restore loopback-only, debug-disabled service after testing:

```powershell
Remove-Item Env:\CAATUU_PHONE_DEBUG_BIND
docker compose up -d --force-recreate caatuu
```

APK builds default to `arm64-v8a`, which is the ABI used by current Android
phones and keeps debug APKs smaller. To build a package that also runs on an
x86_64 emulator, pass `-e CAATUU_ANDROID_ABIS=arm64-v8a,x86_64`.

`CAATUU_ANDROID_REPORT_URL` is separate from the update base and defaults to
`https://caatuu.waajacu.com/api/bug-report` for the full application. Override
it only for a trusted development diagnostics endpoint. The `product` bridge
has no report operation; its compiled browser surface keeps bug reports local.

For the full application, `CAATUU_ANDROID_DICTIONARY_GAP_URL` independently defaults to
`https://caatuu.waajacu.com/cz/api/dictionary/gaps`. It is used only by the
strict `report_dictionary_gap` bridge request: the native shell forwards the
validated dictionary-gap payload without a device, app, or diagnostics
envelope. Release variants require HTTPS; debug builds may override it with a
trusted HTTP LAN endpoint. The `product` surface keeps this outbox local and
does not package that bridge request or endpoint.

## Device Smoke Check

After building the debug APK, connect one authorized Android device to the
container and run:

```bash
bash apps/android/tooling/verify-debug-apk-device.sh
```

The script uses `/opt/android-sdk/platform-tools/adb`, installs
`artifacts/android/caatuu-debug.apk`, launches
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
  debian:12 `
  bash
```

Inside the container:

```bash
bash apps/android/tooling/setup-container.sh
bash apps/android/tooling/setup-sdk.sh
bash apps/android/tooling/build-debug-apk.sh
```

## Caatuu product build

The canonical builder selects only the separate `:product` module, compiles its
fail-closed asset allowlist, runs release Lint/R8, validates the AAB with
bundletool, derives a universal APK, and audits both archives. Run it in the
established container:

```powershell
docker exec -w /workspace caatuu-dev bash apps/android/tooling/build-release-aab.sh
```

With no signing variables, that command creates an explicitly unsigned
engineering milestone. It also creates a non-publishable universal inspection
APK using a one-use temporary identity, verifies it, and deletes the identity.
These artifacts prove package behavior but cannot be uploaded as a release:

```text
C:\Work\caatuu\artifacts\android\caatuu-unsigned.aab
C:\Work\caatuu\artifacts\android\caatuu-unsigned-direct.apk
C:\Work\caatuu\artifacts\android\caatuu-inspection-debug-signed.apks
C:\Work\caatuu\artifacts\android\caatuu-inspection-debug-signed-universal.apk
```

For a publishable candidate, store the upload key outside the repository,
expose it read-only to `caatuu-dev`, and pass all four signing values together:

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
  debian:12 `
  bash -lc "bash apps/android/tooling/setup-container.sh && bash apps/android/tooling/setup-sdk.sh && bash apps/android/tooling/build-release-aab.sh"
```

The signed bundle is written to:

```text
C:\Work\caatuu\artifacts\android\caatuu.aab
```

The script rejects partial signing configuration. The `product` module packages
no native inference library and does not include the full `:app` or `:llamaLib`
modules in its Gradle graph. Its direct-release APK retains only the verified
Caatuu updater.

### Publish Caatuu

To publish the non-debuggable Caatuu product, first commit and push the exact
source branch, assign a version code greater than every previously distributed
same-package APK, and run:

```bash
docker exec -w /workspace caatuu-dev \
  bash apps/android/tooling/publish-release.sh
```

The publisher writes the immutable release and then the stable aliases:

```text
/android/releases/<versionCode>/caatuu.apk
/android/releases/<versionCode>/caatuu.json
/android/caatuu.apk
/android/caatuu.json
```

Version 0.1.0 deliberately uses the already-installed tester signing lineage,
so it can replace older development installs without erasing app-private data.
This direct-release identity is not the future Google Play app-signing or upload
key. The publisher builds the signed AAB, selects its bundletool-derived APK,
reruns the product audit, refuses dirty consumed source or an unpushed commit,
serializes immutable publication, and verifies the public bytes, manifest,
certificate, and cache headers.

Older installs still request `/android/caatuu-debug.json` and refuse a direct
debug-to-release archive change. The publisher therefore provides one stripped,
debuggable transition package that accepts only the next same-origin,
same-signing-lineage release. After installing it, Backpack discovers the
non-debuggable stable product. This transition is not a second product channel
and must not be overwritten by a public development build.

Build a signed APK for direct testing with:

```bash
bash apps/android/tooling/build-release-apk.sh
```

That command requires the same signing environment variables and writes the
audited local artifacts:

```text
C:\Work\caatuu\artifacts\android\caatuu-universal.apk
C:\Work\caatuu\artifacts\android\caatuu.aab
```

Only `publish-release.sh` writes the stable manifest and public aliases.

## Update channel contract

- `caatuu-debug.apk` is a development artifact and is not a product release.
- `caatuu.apk` and `caatuu.json` come only from `publish-release.sh` and are the
  stable update channel used by normal installs.
- `caatuu-debug.json` is a temporary compatibility manifest for installations
  made before 0.1.0; it points to the stripped transition APK, which then points
  to the stable immutable product manifest.
- Do not rename or copy a debug build over the stable filenames. It breaks
  signing continuity and makes an unsafe artifact look like a release.
- Never reuse a `versionCode` for changed bytes. Both build scripts refuse to
  replace an existing immutable APK whose SHA-256 differs.
- The release publisher serializes the immutable check and final artifact moves
  through `artifacts/android/.artifact-publication.lock`; do not bypass that
  lock with manual copies.
- The release publisher pins the installed certificate lineage. Treat a
  missing keystore or fingerprint mismatch as a recovery task, never as
  permission to mint a new public update key.
- Publish the immutable APK first and the mutable manifest last. The canonical
  publisher enforces and verifies this ordering.
- The retired public debug command cannot overwrite the stable product.

## Distribution Notes

- Google Play uses Android App Bundles for new apps.
- Google Play Console currently has a one-time registration fee.
- New personal developer accounts may need a closed test before production
  access.
- Signing keys must not be committed. The repo ignores common Android key file
  extensions.
- The development app may keep the GGUF as an external app-managed download.
  The `product` AAB contains no GGUF catalog, URL, operation, or
  inference library.
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
