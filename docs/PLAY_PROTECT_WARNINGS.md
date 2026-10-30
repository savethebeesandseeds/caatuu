# Play Protect warnings

Last reviewed: 28 October 2026

This is the living note for Play Protect warnings on the published Caatuu
Android app. Record the next warning here, and add mitigation ideas under the
list at the bottom.

The capture steps for a new warning stay in
[First Android release](FIRST_ANDROID_RELEASE.md).

## What happened

Through Android 198, the published product was installed from the Caatuu
website and could also install a later package itself. The product manifest
declared `REQUEST_INSTALL_PACKAGES`, and `CAATUU_SELF_UPDATE_ENABLED` was true.
The app checked the public manifest, downloaded an APK, and opened the system
installer.

Play Protect then showed **Harmful app blocked** (“This app may be harmful”)
on Android 198 / 0.1.46. Earlier direct releases had been accepted. Android
195, 197, and 198 differ in `classes.dex` only by the version-name string, and
they share one signer.

The blocked file is package `com.waajacu.caatuu`, 3,522,150 bytes, SHA-256
`0c15cb82f6ca55614e4dfadb6343e60664e8ca63b3c67175338126ddd8ce59a2`. The signer
subject is `CN=Caatuu Debug, O=Waajacu, C=US`, certificate SHA-256
`c663bdec81ef8876f261ebbc3ab95d96789972eb8bc1b22e8e17acf44469af55`. The build
is not debuggable, and cleartext traffic is off. That certificate is the pinned
direct-release lineage.

The warning is a finished classification of that APK hash. The GitHub Pages
hosting limit is a separate problem. A finished harmful-app block is not a
delay while Google re-reads the site.

## The catch

Release notes described a Play build that omits `REQUEST_INSTALL_PACKAGES`.
That omission exists on the legacy `app` module’s `play` build type. The
publisher builds `apps/android/product`. That product had self-update turned
on and declared the permission in its own manifest. Phones install the product
package. The legacy Play variant is not that package.

A read of the update path found its checks in place: HTTPS, the same origin as
the manifest, package name, version, size, SHA-256, and signing lineage. A
failed file is deleted. Release builds reject a debuggable update. The warning
matched the sideload self-updater. It did not match a broken check or unknown
code in the lessons.

## The fix

Android 199 / 0.1.47 removes the self-updater from the published product.
Source revision `3e22d1a46d3c286123c0b2c7b59f0f59d2172308`, published 28
October 2026.

- Product `CAATUU_SELF_UPDATE_ENABLED` is false.
- The product manifest declares `INTERNET` and does not declare
  `REQUEST_INSTALL_PACKAGES`.
- `downloadLatest` and `openInstaller` refuse when the flag is false.
- The Android project validator and the product-package audit reject a product
  that still requests the permission. The sealed 199 package audit passed.
- The signing certificate was kept. A new certificate cannot update installs
  signed by the current one. The pin remains
  `apps/android/tooling/direct-release-certificate.sha256`.
- FileProvider stays, limited to the app’s `updates/` paths. With the flag off,
  the published app does not hand those files to the installer.
- The legacy `app` module still declares the permission on its own debug and
  release shells. That module is not the published package.
  `audit-runtime-boundary.mjs` still checks that shell.
- The maintenance line still says the app store manages updates
  (`maintenance.status.storemanaged`, interface revision `interface-en-57`).
  Changing it would revise the interface catalog. Website wording is an open
  idea below.

Public file:
<https://caatuu.waajacu.com/android/releases/199/caatuu.apk>

SHA-256 `ff8e3fa58bd24ebf38b935334d417c181a992799aea217a1476dc55ec3a969d6`,
3,522,150 bytes. Manifest:
<https://caatuu.waajacu.com/android/caatuu.json>. Pages handoff `1a670e0f`,
tag `caatuu-android-v199`, workflow run
[40754801297](https://github.com/savethebeesandseeds/caatuu/actions/runs/40754801297).

The installed 0.1.46 app keeps showing its own version until 0.1.47 is
installed over it. Android 199 does not install a later package by itself.
New versions come from the website APK.

## Device result

After Android 199 was installed, Play Protect accepted the app. Play Protect
stayed on. No **More details** category was captured. Android 198 is a
different file, and its hash can keep the old verdict.

## When a warning comes back

Leave Play Protect on. Record the exact wording, the **More details** category,
the version, and the APK SHA-256 in this note. Compare permissions, signer,
debuggable flag, native libraries, and `classes.dex` with the previous
accepted package.

A new version is a new hash and a new verdict. It leaves the previous file’s
verdict as it is. Appeal a hash that should be accepted:
[App verification appeal](https://support.google.com/googleplay/android-developer/answer/2992033).
Developer guidance:
[Play Protect warnings](https://developers.google.com/android/play-protect/warning-dev-guidance).

Device-side developer verification uses different wording. It was described for
Brazil, Indonesia, Singapore, and Thailand from 30 September 2026, with a
later wider rollout. Do not record that message as this harmful-app
classification.

## Ideas

These are ideas to try or to remember. They do not authorize a new signing
key, turning the in-app installer back on, or removing course content.

- Keep `REQUEST_INSTALL_PACKAGES` out of the published product. The package
  audit is the guard. A sentence about the legacy Play build type does not
  describe the APK phones install.
- Say on the maintenance screen that new versions come from the Caatuu
  website. That needs a new interface string and a catalog revision, which
  Android 199 skipped on purpose.
- Put the website APK link in the release note. The installed app will not
  offer the next package.
- If a build that already lacks the install permission is blocked, appeal that
  hash and write the **More details** category here before removing more
  behavior.
- A Google Play listing would give the app a store identity. That is a
  separate distribution choice. It does not require putting the sideload
  installer back into the direct APK.
- The certificate subject still says `CN=Caatuu Debug`. Replacing it breaks
  updates for current installs. Keep the pinned lineage.
- A low-install sideloaded app can still be flagged on a later hash. The clean
  Android 199 result is the evidence for this warning. It does not promise the
  same result for every later file.
- Do not ask anyone to turn Play Protect off.
