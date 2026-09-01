# Android Pages preservation baseline

The GitHub Pages cutover uses the already-built stable 162 (`0.1.10`) and
transition 161 packages. It does not run Gradle, change a version, sign an APK,
or create a new Android release.

The deterministic preservation archive is:

```text
local path: artifacts/android/caatuu-pages-v162.tar
GitHub tag: caatuu-pages-v162
asset name: caatuu-pages-v162.tar
bytes: 535674368
sha256: 9564bf5dc318ab642468787dd6ef23e4e70923887ca622620d045255734cc6c5
```

`package-pages-baseline.mjs` can reproduce only those frozen bytes. It verifies
the exact APK-embedded setup manifest, all 662 native-required artifacts, the
dictionary and vector databases, original keymaps, runtime files, and legacy
assets. It refuses source drift, a different deterministic result, and any
attempt to overwrite a different archive.

Run it only in the maintained container environment:

```powershell
docker exec -w /workspace caatuu-dev node apps/android/tooling/package-pages-baseline.mjs --output artifacts/android/caatuu-pages-v162.tar
```

This is packaging and verification of release 162/161, not an Android build.
The final Pages builder verifies and safely extracts the archive:

```powershell
docker exec -w /workspace caatuu-dev node apps/launcher/tooling/build-pages-site.mjs --baseline-archive artifacts/android/caatuu-pages-v162.tar --output artifacts/web/github-pages
```

The manual workflow downloads the exact GitHub Release tag. Neither the
workflow nor either tool resolves `latest`. Publishing the archive, deploying
Pages, accepting Pages' cache behavior, changing DNS, and retiring the tunnel
are separate maintainer-confirmed actions governed by
[`docs/STATIC_WEB_HOSTING.md`](../../../docs/STATIC_WEB_HOSTING.md).

The private dictionary-gap ledger is deliberately excluded from the public
archive. Preserve it through the private-backup gate in the hosting document.
The former public dictionary-gap, status, debug helper, diagnostics, API, and
WebSocket routes are retired; the local runtime can remain opt-in for deliberate
development and APK/API tests.

Transition 161 remains available only at its immutable version path and the
technical `caatuu-debug.*` compatibility aliases needed by already-installed
preview clients. Pages does not publish `caatuu-preview.*`, and the public
launcher advertises only signed, non-debuggable stable 162. This prevents the
debuggable transition package from becoming an ungated automatic fallback.

The current `publish-release.sh` publishes through the self-hosted runtime and
requires its dynamic status and cache-header contracts. Do not use it as a
public publisher after the Pages cutover. A future Android release must extend
the maintained publisher to create and verify a new immutable preservation
asset, update a reviewed pinned descriptor on `main`, deploy Pages atomically,
and validate the resulting same-origin public bytes. Until then, 162/161 remain
the fixed Pages baseline and local APK builds remain local tests.
