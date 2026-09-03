# First Android release planning notes

Last reviewed: 3 September 2026

This document is the working brief to inspect before planning Caatuu's first
real Android release. It records current preview risks, decisions that still
belong to the maintainer, and the evidence required before an invited beta,
public beta, or stable release. It does not authorize a release by itself.

The governing channel definitions and mandatory gates remain in
[`RELEASING.md`](RELEASING.md). Product, legal, privacy, and source-readiness
blockers remain in [`PRODUCT_READINESS.md`](PRODUCT_READINESS.md).

## Current preview baseline

The publicly tested APK is a development-preview artifact:

- package ID: `com.waajacu.caatuu`;
- debug-signed with the persistent `Caatuu Debug` certificate;
- `android:debuggable=true`;
- Android target SDK 36;
- APK Signature Scheme v2;
- permissions include `INTERNET` and `REQUEST_INSTALL_PACKAGES`; and
- distributed outside Google Play with Caatuu's verified direct updater.

An audit of available preview APKs from version codes 112 through 132 found the
same package ID, signer certificate, target SDK, debuggable state, and
permissions. The later Play Protect warning therefore was not caused by a
recent signer change or newly added permission.

The warning is nevertheless important. Frequent, low-install sideloaded builds
produce new APK hashes with little reputation, while a debug certificate,
debuggable application, and permission to request APK installation are
avoidable risk signals. Google may classify a new or rare app as uncommon
without asserting that it is malware, but a real release must not depend on
users bypassing or disabling Play Protect.

`REQUEST_INSTALL_PACKAGES` was introduced for the direct self-update workflow,
not for background installation. The dedicated Google Play variant must omit
that permission and leave updates to the store. The signed direct-download
variant may retain the updater only if its user interaction, provenance,
privacy implications, and failure recovery are reviewed explicitly.

## Maintainer decisions before release work

Record these decisions before generating a release signing identity or opening
a store listing:

1. **Distribution:** Google Play, signed direct download, or both.
2. **Release stage:** invited beta, public beta, or stable.
3. **Signing custody:** owner of the release/upload keys, protected storage,
   two independent backups, recovery procedure, and permitted operators.
4. **Update ownership:** store-managed updates, Caatuu's signed direct updater,
   or a clearly separated channel for each.
5. **Identity continuity:** confirmation that
   `com.waajacu.caatuu` is the permanent application ID.
6. **Preview migration:** whether existing debug installs are replaced,
   uninstalled, or given a documented data-export path. A release key cannot
   update an app installed under the debug key.
7. **Release naming:** semantic prerelease version, user-facing channel label,
   support window, and minimum Android version.
8. **Publisher record:** legal publisher, public contact, privacy controller,
   support address, and store-account custodian.

## Non-negotiable release properties

The first external beta and every later release must be:

- built from one reviewed, immutable source commit;
- signed with the long-lived release identity, never the debug key;
- non-debuggable and built with cleartext traffic disabled;
- assigned a strictly increasing Android `versionCode`;
- published under the correct release channel without copying or renaming a
  debug artifact;
- reproducibly tied to its source commit, signer fingerprint, SHA-256, byte
  size, build environment, and release notes;
- limited to an audited permission allowlist;
- packaged with complete applicable license and notice material;
- consistent with the published privacy, security, and support statements; and
- installed and exercised successfully on ordinary physical devices with Play
  Protect enabled.

For Google Play, use the `play` application variant produced by
`apps/android/tooling/build-release-aab.sh`. It disables Caatuu's direct updater
and omits `REQUEST_INSTALL_PACKAGES`.

For a routine signed direct-download release, use the maintained release
entrypoint:

```powershell
pwsh -NoProfile -File apps/android/tooling/release-android.ps1
```

It runs the guarded build at most once, creates the stable
`caatuu.apk`/`caatuu.json` pair and sealed receipt using the protected
release-signing environment, then deploys those exact bytes as documented in
[`STATIC_WEB_HOSTING.md`](STATIC_WEB_HOSTING.md). Never substitute
`caatuu-debug.apk`. A retry after finalization skips the build stage.

## Pre-publication evidence

Keep a release record containing:

- source commit and confirmation that the intended tree is clean;
- application ID, `versionName`, and `versionCode`;
- build command, container image/tool versions, and build timestamp;
- signer subject and SHA-256 certificate fingerprint;
- APK/AAB SHA-256 and exact byte size;
- manifest comparison against the approved permission and component allowlists;
- confirmation that `android:debuggable` is false;
- confirmation that cleartext traffic is disabled;
- successful Android signature verification;
- immutable artifact URL and manifest URL;
- public download hash/size verification after upload;
- software/model/data/art provenance and third-party notice results;
- automated test results and unresolved known limitations;
- physical-device installation, first setup, offline-use, background/resume,
  update, rollback/failure, and data-preservation results; and
- Play Protect or Play Console result captured with the exact APK hash.

Publication must place the immutable artifact first and the mutable update
manifest last. Changed bytes always require a new `versionCode`; never overwrite
an immutable release or repair it in place.

## Play Protect investigation record

If Google warns about a candidate:

1. Capture the complete warning and its **More details** reason.
2. Record device, Android version, installer source, download URL, app version,
   APK SHA-256, signer fingerprint, date, and whether the device had seen an
   earlier Caatuu build.
3. Confirm that the downloaded bytes match the release record.
4. Compare certificate, manifest, permissions, native libraries, and signing
   schemes with the preceding approved candidate.
5. Distinguish an uncommon-app/reputation warning from a specific potentially
   harmful application classification.
6. Use Google Play Console review or Google's app-verification appeal process
   for a false positive. Do not instruct testers to disable Play Protect.
7. Block wider distribution until the result is understood and documented.

Release signing improves identity and removes the largest avoidable preview
signals, but it cannot guarantee immediate reputation for a rare app distributed
outside a store. An internal or closed Google Play test is the preferred first
external validation path.

## Suggested first-release sequence

1. Close the blockers in [`PRODUCT_READINESS.md`](PRODUCT_READINESS.md).
2. Freeze and review the smallest releasable content and source set.
3. Establish release/upload keys, backups, custody, and certificate records.
4. Build a non-debuggable signed candidate and run the complete package audit.
5. Test installation and setup on clean physical devices with Play Protect on.
6. Publish through Google Play internal testing to named devices/testers.
7. If direct distribution remains desired, test the separately signed direct
   channel and updater without mixing its artifacts with the Play channel.
8. Advance to an invited or closed beta only after the release record is
   complete and all mandatory gates are green.

## Official Android and Google references

- [Sign your app](https://developer.android.com/studio/publish/app-signing)
- [Android App Bundles](https://developer.android.com/guide/app-bundle)
- [Google Play Protect](https://support.google.com/googleplay/answer/2812853)
- [App verification appeal](https://support.google.com/googleplay/android-developer/answer/2992033)
- [Potentially harmful application classifications](https://support.google.com/googleplay/android-developer/answer/17190352)
