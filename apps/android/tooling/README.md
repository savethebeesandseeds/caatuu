# Caatuu Android Build

Receipt-only promotion reads its expected course catalog and shared application
bytes directly from the sealed source commit using Git objects. It keeps the
current package integrity checks and does not rebuild or change the checkout
when newer courses have been added. See the
[release recovery table](../../../docs/ANDROID_RELEASE_OPERATIONS.md#recovery-decision-table).
When source advanced before the first Pages handoff, receipt-only deployment
also requires `-ExpectedSourceRevision` with that exact recorded commit.

This folder keeps the Android build environment out of Windows. Repeat
publishes use the reusable `caatuu-dev` container and shared Docker volumes for
downloaded tools, with the canonical checkout mounted at `/workspace`. Legacy
bootstrap helpers are not alternate release environments; creating a replacement
container requires explicit authorization under the repository safety policy.

Android has two deliberate distributions. The full development
application includes the Czech WebView UI and native llama.cpp bridge for the
target phone ABI, but it does not bundle GGUF weights or browser WebLLM exports.
Generation models are optional, on-demand artifacts in that full application.
The `product` application is a separate module and compiled asset allowlist
with no LLM, Chat, generation, Godot, or outbound reporting capability. It is
the canonical direct release and retains verified self-updates, shared assets,
and the per-course capabilities declared by the manifests in
`apps/android/course-bundle.json`. Czech, Mandarin, English-to-Spanish,
Spanish-to-English, and English-to-Norwegian Bokmål use the same packaged app
document and shared runtime; their files live below `courses/<id>/`.
The English MiniLM weights are not APK payload: setup downloads the hash-pinned
shared runtime once into app-private storage, where every course reuses it.

The product compiler's default delivery mode is a bootstrap APK. Its reviewed
engine, setup catalogs, provider descriptors, interface strings and native shell
stay packaged; curriculum and larger artwork use the existing selected-course
setup download path. Logical asset paths stay the same. Shared objects install
once into shared app storage, while course content remains below
`courses/<id>/`. The complete runtime catalogs remain authoritative for the
union of packaged and downloaded content. Website/single-course exports select
full delivery explicitly.

Background music follows that shared setup delivery: all three tracks and their
credits/license texts are hash-pinned in each course's setup catalog and reuse
one shared installed copy. No music audio is bundled in either the bootstrap
product APK or the full development APK; the full asset sync also checks its
final output directory for accidental audio inclusion.
Browser setup verifies the same songs into the origin-wide `caatuu-music-v1`
cache, outside individual course precaches; changing or reinstalling a course
reuses those bytes. The music player reads that cache without initiating a
download. Native WebView and browser service-worker responses support byte
ranges from verified music so offline seeking and looping remain local.

## About and offline license notices

The product compiler must preserve the shared About markup and its message keys.
Course-specific lists come from the pinned runtime and current content manifests;
Android adds its own native dependency graph. Never replace the detailed list with
a generic embedding notice or imply that optional models are all in use.
See the [audit and remaining review boundaries](../../../docs/ABOUT_LICENSE_AUDIT.md).

After a product dependency change, refresh the inventory in the existing container:

```powershell
docker exec -w /workspace caatuu-dev bash -lc 'python3 apps/android/tooling/refresh-license-notices.py'
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses
docker exec -w /workspace/apps/android caatuu-dev bash -lc 'gradle -PcaatuuDistributionProfile=product :product:verifyProductDependencyNotices --offline --no-daemon --console=plain'
docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/license-catalog.test.mjs apps/language-runtime/tests/workspace-shell-controller.test.mjs
docker exec -w /workspace caatuu-dev node --test apps/android/tooling/tests/license-delivery.test.mjs
```

The Python command resolves dependency metadata without an APK build. It records
cached POM evidence, preserves embedded LICENSE/NOTICE files, and stops for an
unrecognized license. Review generated changes before release. Asset generation
depends on the Gradle inventory check, so new or stale coordinates fail the build.
First-party and scoped corpus notices are exact copies of tracked authorities.
Supplemental upstream texts retain their provenance in the audit; never rewrite
already-published, hash-pinned runtime objects to add a notice.

## Startup and setup delivery

Android starts the canonical illustrated Home for the last visited bundled
course (or the default course on a fresh installation). Its existing setup card
and language chooser work before a course is installed. The shared bootstrap
waits for native verification before loading course feature providers or game
content. Only Home, the course profile and web manifest bypass the per-course
installation gate; curriculum and native learning operations still require a
verified installation. The legacy `/setup.html` entry redirects to Home.
Essential Home artwork is packaged, so this first screen also renders offline.
The smaller UI artwork preserves the original assets and logical URLs.
Regenerate those reviewed copies with
`docker exec -w /workspace caatuu-dev caatuu-animated-fabric python /workspace/apps/language-runtime/tooling/build-home-art.py`;
append `--check` for a read-only reproducibility check.

`build-product-assets.mjs` writes the companion folder beside the product
output, normally `product/build/generated/assets/product-setup`. Its
`caatuu-setup-payload.json` inventory records `{path, file, assetPath, bytes,
sha256}` for every removed logical asset. Public `path` is
`assets/setup/<sha256>/<filename>` and archive `file` is
`objects/<sha256>/<filename>`. The payload contains transformed production
bytes; it never re-reads a newer checkout at deployment time.

The maintained builder calls `setup-payload.mjs` to create a deterministic
regular-file ustar archive with exact inventory closure, no links or path
escapes, and a 256 MiB transport safety limit. It verifies every object against
the small APK-embedded course setup catalogs before sealing `artifacts.setup`
in the existing version-1 candidate receipt. Candidate archives use their own
SHA-256 filenames, so a repaired build can coexist with a failed attempt.
Old receipts omit this optional
record. The finalizer installs the version-owned archive before its completion
receipt; retries retain the same hash. The deployer uploads the optional fourth
GitHub Release asset and Pages retains each immutable object for every recorded
Android version. Public verification hashes current setup objects using the
verified APK as the authority. See the
[release operations runbook](../../../docs/ANDROID_RELEASE_OPERATIONS.md).

Development courses may be bundled for hands-on APK testing without claiming
their pending curriculum reviews are complete. Android enablement does not
promote a course to active status or enable its Pages route.

Image-search keymaps retain metadata for both packaged images and images in
the validated, hash-pinned setup storage catalog. Filtering only by APK files
would make downloaded artwork invisible to game hints and developer search.
Use each compiler's own projected setup catalog when collecting that metadata:
single-course website exports do not carry the Android bundle's shared
embedding-runtime catalog.

The full Gradle module selects one course with `caatuuCourseManifest`. The
product module selects a repository-relative bundle with `caatuuCourseBundle`
(default: `apps/android/course-bundle.json`). Each manifest owns course identity,
route, entry path, static root, Android enablement, and capabilities. Its
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
`build-product-assets.mjs --course-bundle <file>` is the canonical product
compiler equivalent; `--course-manifest` remains a focused single-course test
surface. Product profiles always force `llm`, `generation`, and
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

Setup asset metadata is reproducible as well. The full development module runs
`refreshSetupAssetManifest` before copying browser files into the APK. The task
recalculates every artifact byte count and SHA-256 in
`apps/languages/czech/static/setup-assets.json` from the authoritative shared and
language static files. A missing source, duplicate key/URL, or unsupported path
stops the build. To inspect drift without writing the manifest, run inside
`caatuu-dev`:

```bash
node apps/server/tooling/refresh-setup-assets.mjs --check
```

That development task updates the tracked manifest when an asset was edited,
so include the generated metadata with the corresponding asset change. The
public `product` compiler instead validates its declared sources and writes
packaged setup projections into build output; routine deployment does not
refresh tracked source manifests.

## Canonical release workflow

Read the [Android release operations runbook](../../../docs/ANDROID_RELEASE_OPERATIONS.md)
for source checks, the recovery decision table, executable failure tests and
the incident handoff standard. This README owns implementation details; the
runbook owns the operator procedure.

A release has two separate operations: build and locally finalize one signed
candidate, then deploy those exact bytes. Routine Android deployment rebuilds
neither the app nor the website. It restores the hash-pinned published website
artifact, preserves its current file inventory, and overlays the sealed Android
release and download aliases. Website changes require an explicit
`deployment_scope=website` dispatch of the existing Pages workflow.

The routine entrypoint orchestrates both operations with one command:

```powershell
pwsh -NoProfile -File apps/android/tooling/release-android.ps1
```

When a finalized receipt already exists for the declared version, the wrapper
skips the build operation and resumes receipt-only deployment. The two
lower-level commands below remain available for inspection and recovery.

Public verification allows 30 seconds for metadata and range requests, and
120 seconds for each complete APK download, including reading its body.
The immutable APK and stable alias must both match the receipt's exact bytes
and SHA-256. A slow download never calls the builder or changes the release.

For a new version, increment `versionCode` and `versionName`, then commit and
push that exact source on `main`. The wrapper invokes this guarded lower-level
command in the existing durable development container:

```bash
docker exec -w /workspace caatuu-dev \
  bash apps/android/tooling/publish-release.sh --build-once
```

That command performs at most one Android build.
Before signing, the publisher runs focused Android safety contracts and the
content release validator. Full fixture builds and website export tests belong
to source CI, not every APK publication. The real asset compiler and final
archive audit still enforce package capabilities and source/asset integrity.
The publisher can reuse a fresh builder's full archive audit only within the
same invocation, using a private challenge bound to pre-audit APK/AAB and optional setup archive hashes,
the sealed receipt, clean source revision and verifier/launcher identities.
It still checks copied hashes, package/version/debug state and the signing pin.
Missing or stale proof, changed inputs and adopted candidates retain the full
audit path; receipts are not a permanent validation cache.
Interface words, catalog revision literals, corpus counts and particular artwork
filenames are not release requirements: tests derive changing metadata from the
authoritative catalogs, and forbidden features are checked structurally.
The asset compiler and signed-archive audit share one forbidden-source policy,
including JSON interface text. Product-only catalog projection removes disabled
generation offers in every packaged locale while retaining unavailable-state
messages and leaving the browser authority unchanged.
The product developer hub retains its audio, image, dictionary, and verb
inspectors, but projects out the browser-only Chat entry and generation
implementation. Browser development keeps the full hub.

The builder writes a version-owned receipt under
`artifacts/android/release-candidates/` that binds
the APK, AAB and optional setup archive hashes and sizes, plus package, version, signer, and source commit. It
then finalizes the same APK at `artifacts/android/releases/<versionCode>/`.

If a valid receipt already exists, `--build-once` reuses it. A bare
`publish-release.sh` also promotes the current sealed receipt without building.
Changed bytes, a different source commit, or a reused version code fail closed.
All signed release builds share one fail-fast lock because Gradle and the output
artifact paths are shared. If another session already owns that lock, a second
session exits immediately with instructions to inspect the running build and
reuse its receipt; it never starts another Gradle build or waits silently.
The tracked Pages current-release descriptor is the durable version floor. If
mutable aliases or a local receipt disappear, the tools still refuse to rebuild
that released version or move the stable channel backward.

The canonical checkout must remain on `main`, with no other local or remote
branches. Inactive detached recovery worktree registrations are preserved and
do not block publication; they are never used for building or deploying. Before
release, verify that the existing build container mounts `C:\Work\caatuu` at
`/workspace` and that no alternate checkout is actively serving or building.

When a signed candidate was built before receipt support, adopt it explicitly:

```bash
docker exec -w /workspace caatuu-dev \
  bash apps/android/tooling/publish-release.sh \
    --adopt-existing \
    --expected-apk-sha256 <approved-apk-sha256> \
    --source-revision <pushed-main-commit>
```

Adoption validates the package boundary, version, non-debuggable state, signing
certificate, exact hash, and source commit, then seals and promotes the existing
files. It does not invoke Gradle.

The publisher finalizes local immutable inputs for the Pages pipeline. It does
not itself create a GitHub Release, deploy Pages, change DNS, or verify the
public site. After inspecting its receipt, run the receipt-only deployer from
the Windows host, where `gh` is authenticated:

```powershell
pwsh -NoProfile -File apps/android/tooling/deploy-pages-release.ps1 `
  -CandidateReceipt artifacts/android/releases/<versionCode>/caatuu-release-candidate.json
```

The deployer updates only the append-only Pages release descriptor, commits and
pushes that handoff on `main`, uploads only missing exact release assets,
dispatches the Pages workflow in `android` scope, and verifies the public
Android manifests, retained downloads and exact stable APK bytes. Browser
interface schemas and reporting-service health do not gate an Android update.
It never invokes the builder, Gradle, or the website compiler. Rerun this command
after an interrupted upload or deployment; do not rerun `--build-once`.
Short allowlisted network reads have three attempts at most, a 60-second
per-attempt limit and 2/4-second backoff. Permanent/authentication/certificate
errors stop. Uploads, finalization and dispatch are never blindly repeated:
uncertain responses require exact server-state reconciliation. The native
PowerShell failure/resume and retry suites run in source CI without real
builds or publication; commands and coverage are in the runbook.
The compatibility transition remains the frozen version 161 artifact; never
build a new transition for each stable release.

### Website preservation, not recompilation

`pages-website-snapshot.mjs` and `pages-android-overlay.mjs` are helpers in the
existing release workflow, not alternate publication entrypoints. The live
`caatuu-web-bundle.json` names a source-pinned, hash-checked website archive in
GitHub Releases. Explicit website publications seal a new archive automatically;
Android publications keep that archive and every subsequent live immutable
addition, including setup assets needed by older installed releases. They can
add missing content-addressed setup files only from the verified sealed APK or
its receipt-bound companion archive. Both deployment scopes retain objects
from all earlier recorded companion archives.
They cannot replace website files, overwrite an immutable release, or roll back
the live stable version. GitHub Pages still requires uploading a complete site
artifact, but that is file transport, not a source build.

Setup uses a packaged asset directly when its actual APK bytes match its
catalog receipt; it does not download a second copy from the website. The
compiler marks these entries `android_packaged`, and the final archive audit
checks every marked entry. New curriculum and artwork downloads are checked
against the sealed companion before signing and included in the verified site
before the stable alias is published. Other external downloads are checked
against the published byte inventory during asset compilation. Changed artwork
receives its own immutable URL; never replace files still required by older
installations. These checks use artifact paths and hashes.

The one-time `pages-website-bootstrap.json` receipt preserves the last deployed
website before snapshot support (successful run 33749970406). Its bytes were
captured against the public inventory, reusing only locally cached files with
matching hashes. It is used only when the public manifest has no snapshot field
and still matches that exact inventory. It is never regenerated on an APK retry.

Release timings are printed per phase. A successful receipt skips all build
work; deployment repair uses the same receipt. Do not promise a fixed duration:
signing/build time, artifact transport and Pages availability are separate.

Bounded Windows metadata reads select the first executable in normal PATH
order. Multiple Git installations must never become a combined process path;
the native network suite exercises this case with the real process runner.

The release key remains the existing ignored
`artifacts/android/caatuu-debug.keystore`, pinned by
`apps/android/tooling/direct-release-certificate.sha256`. If either is missing
or mismatched, stop and recover the original key. Generating a replacement
would break updates for existing installations.

## Bootstrap/fallback debug build

This legacy bootstrap section is for a separately authorized development
environment only. Its disposable-container command is not the routine build,
publication or release-recovery path. Reuse `caatuu-dev` for this repository;
do not create a replacement container without the explicit authorization and
configuration checks required by `AGENTS.md`.

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

For a development-only artifact configured with the public host, use the
retired command's explicit local-build mode:

```bash
bash apps/android/tooling/publish-public-debug.sh --local-build
```

This mode delegates to `build-public-debug-apk.sh` and creates local debug
artifacts, but it does not publish or verify a public download. Older installed
debug-lineage apps move to the stable channel through the transition package
created by `publish-release.sh`; do not revive the retired debug channel.

When `CAATUU_ENABLE_ANDROID_DEBUG_DOWNLOADS=1` is present in the ignored root
`.env`, the generic sideload builder refuses to run with its invalid default
update host. This prevents a local build from silently replacing the live
public manifest. The public debug channel is retired: use `publish-release.sh`
for the hosted stable channel, or disable the public route before making a
sideload-only build. `publish-public-debug.sh --local-build` remains only as a
development-artifact convenience and does not publish.

The default runtime binds only to Windows loopback and keeps all debug download
routes disabled. For a trusted LAN phone test, temporarily opt in from
PowerShell using the same IP that you put in the APK:

```powershell
$env:CAATUU_PHONE_DEBUG_BIND = "<your-pc-lan-ip>"
docker compose -f compose.yaml -f compose/phone-debug.yaml up -d --force-recreate caatuu
```

You can audit the deliberately exposed debug channel with:

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
envelope. The public path is now owned by the consent-gated Pages Worker, which
requires a policy marker this legacy bridge does not send, so public attempts
fail without storage. Release variants require HTTPS; debug builds may override
the URL with a trusted HTTP LAN endpoint. Stable product releases 162/163 keep
this outbox local and do not package that bridge request or endpoint.

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

For repeated work, open a shell in the existing durable container:

```powershell
docker exec -it -w /workspace caatuu-dev bash
```

The durable setup is idempotent and is maintained separately. For ordinary
work, run only the operation you need inside the container, for example:

```bash
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
C:\Work\caatuu\artifacts\android\caatuu-inspection-debug-signed.apks
C:\Work\caatuu\artifacts\android\caatuu-inspection-debug-signed-universal.apk
```

For a publishable candidate, keep the upload key outside the repository and
make all four signing values available through the managed `caatuu-dev`
configuration. Use the canonical build/finalize command in "Canonical release
workflow"; do not launch a second disposable build container. If the managed
container cannot see the signing configuration, stop and repair that documented
container setup before publishing.

The signed bundle is written to:

```text
C:\Work\caatuu\artifacts\android\caatuu.aab
```

The script rejects partial signing configuration. The `product` module packages
no native inference library and does not include the full `:app` or `:llamaLib`
modules in its Gradle graph. Its direct-release APK retains only the verified
Caatuu updater.

### Publish Caatuu

Use the build-once or receipt-promotion command documented in
"Canonical release workflow" above. The local finalizer writes:

```text
/android/releases/<versionCode>/caatuu.apk
/android/releases/<versionCode>/caatuu.json
/android/caatuu.apk
/android/caatuu.json
```

The immutable directory also contains the release-candidate receipt. The Pages
packager later publishes the version-owned APK and manifest and updates the
stable aliases. Compatibility version 161 is retained separately and is never
regenerated by the publisher.

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

Signed direct builds also emit a receipt. Running the builder again for the same
sealed source/version verifies and reuses the receipt instead of starting
Gradle.

## Update channel contract

- `caatuu-debug.apk` is the frozen version 161 compatibility artifact, not a
  current development channel.
- `publish-release.sh` creates the local `caatuu.apk` and `caatuu.json` aliases.
  The Pages builder creates the public `/android/caatuu.{apk,json}` aliases from
  the newest release in the append-only descriptor; those public aliases are
  the stable update channel used by normal installs.
- `caatuu-debug.json` points to the frozen transition 161 APK for installations
  made before the direct-release migration.
- Do not rename or copy a debug build over the stable filenames. It breaks
  signing continuity and makes an unsafe artifact look like a release.
- Never reuse a `versionCode` for changed bytes. Candidate receipts and the
  finalizer reject a different APK, AAB, setup payload, manifest, or source commit.
- The release publisher serializes the immutable check and final artifact moves
  through `artifacts/android/.artifact-publication.lock`; do not bypass that
  lock with manual copies.
- The release publisher pins the installed certificate lineage. Treat a
  missing keystore or fingerprint mismatch as a recovery task, never as
  permission to mint a new public update key.
- The Pages deployment publishes the immutable APK and manifest before serving
  the stable aliases and verifies the resulting public bytes.
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
