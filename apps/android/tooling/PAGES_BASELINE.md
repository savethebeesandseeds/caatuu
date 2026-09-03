# Android Pages preservation baseline

The large preservation archive permanently holds previous stable 162
(`0.1.10`), transition 161, and their setup dependencies. Current stable 163
(`0.1.11`) is a small separately pinned overlay. The Pages workflow does not
run Gradle, change a version, or sign an APK.

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

Stable 163 is supplied by GitHub Release tag `caatuu-android-v163` as three
exact assets:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `caatuu-163.apk` | 26,553,893 | `fd1d4bd283c558174eacd68e08c01a93235fae0b28970e6993e1e84a2d142545` |
| `caatuu-163.json` | 1,042 | `f77a9f5640cd2f60abb7ef820a4f8e10f8111d0e625cb0fbe011b92dc89b3197` |
| `caatuu-163-release-candidate.json` | 1,104 | `2e7f3a25961184fa516e1704ec538802c24f2e4db205336abb29def87757d71f` |

The receipt binds those APK bytes to source commit
`91ba021979275160ca30cacabe8a954aa1bf2341`, package
`com.waajacu.caatuu`, signer
`c663bdec81ef8876f261ebbc3ab95d96789972eb8bc1b22e8e17acf44469af55`,
and version 163. [`pages-current-release.json`](pages-current-release.json)
pins it as the first entry in an append-only overlay list. A future release is
appended to that small descriptor, retaining 163's immutable paths; it does not
repack the 535 MB baseline.

Release 162 permanently owns
`/assets/planets/agreement-aurora.png` with 1,511,588 bytes and SHA-256
`abfc3a443f60e1a1c2f4c16fbb2cda0e20f46b4daeb75bdc35d3b99718cc79a6`.
The current 1,258,690-byte artwork is published separately at
`/assets/planets/releases/5fe5c25467d51dbe/agreement-aurora.png` with SHA-256
`5fe5c25467d51dbec0c7e6600f187a685ccb0d42c34a47c3d1a737d2b6051966`.
Current Android setup metadata uses that content-addressed URL while retaining
the APK-local path `assets/planets/agreement-aurora.png`.

Run it only in the maintained container environment:

```powershell
docker exec -w /workspace caatuu-dev node apps/android/tooling/package-pages-baseline.mjs --output artifacts/android/caatuu-pages-v162.tar
```

This is packaging and verification of release 162/161, not an Android build.
The final Pages builder verifies and safely extracts the archive:

```powershell
docker exec -w /workspace caatuu-dev node apps/launcher/tooling/build-pages-site.mjs --baseline-archive artifacts/android/caatuu-pages-v162.tar --output artifacts/web/github-pages
```

The manual workflow derives and downloads every exact Android tag and asset in
the validated release list. Neither the workflow nor either tool resolves
`latest`. Publishing the preservation and Android release tags, deploying
Pages, publishing the separate
`caatuu-setup-assets-v1` files, deploying the Worker, and changing DNS are
separate verified actions governed by
[`docs/STATIC_WEB_HOSTING.md`](../../../docs/STATIC_WEB_HOSTING.md).

The private dictionary-gap ledger is deliberately excluded from the public
archive. The public dictionary-gap POST is now a narrow, consent-gated Worker
route; dictionary status/search, debug helper, general diagnostics, legacy API,
and WebSocket routes remain retired. The four large setup files remain in this
preservation archive for byte-for-byte validation, while live requests for
their original paths use the pinned setup Release through the Worker. The local
runtime can remain opt-in for deliberate development and APK/API tests.

Transition 161 remains available only at its immutable version path and the
technical `caatuu-debug.*` compatibility aliases needed by already-installed
preview clients. Pages does not publish `caatuu-preview.*`, and the public
launcher currently advertises signed, non-debuggable stable 163; future
descriptor appends advertise only the newest signed stable release. This
prevents the debuggable transition package from becoming an ungated automatic
fallback.

`publish-release.sh` separates building from local finalization. `--build-once`
creates at most one signed candidate and receipt; receipt reuse and
`--adopt-existing` never invoke Gradle. It finalizes local immutable inputs for
this Pages pipeline but does not deploy. The separate
`deploy-pages-release.ps1` command consumes one version-owned receipt, appends
or reuses its descriptor entry, uploads the exact three assets, dispatches
Pages, and performs public verification without rebuilding.
