# Caatuu component release-validator registry

Last reviewed: 7 September 2026

This registry maps each component contract accepted by the version 1 release
manifest to its owner and current executable validation. It is deliberately
honest about incomplete coverage. The top-level release validator checks the
reference envelope and known legacy shape; it does not turn a partial component
check into payload-closure proof.

Commands run from the repository root in the maintained development or CI
container. `<candidate-url>`, `<apk>`, and `<catalog>` are immutable candidate
inputs recorded by release automation.

Android operations and resume rules are maintained in
[`ANDROID_RELEASE_OPERATIONS.md`](ANDROID_RELEASE_OPERATIONS.md). Native
PowerShell orchestration/retry tests run on the Windows host or CI's PowerShell
runner; Node/compiler/package checks run in the maintained container.

| Kind | Contract | Owner | Current executable validation | Payload-closure status |
| --- | --- | --- | --- | --- |
| `web` | `caatuu-web-bundle` v1 | `apps/launcher`, `apps/android`, and all catalog-declared Pages course packs | Pages cutover: `node apps/launcher/tooling/build-pages-site.mjs --baseline-archive <caatuu-pages-v162.tar> --output <bundle-dir>`; use `--validate-only` with the same archive to recheck existing bytes. `build-static-site.mjs` validates only the browser-core intermediate. | `web-static-pages-cutover` enforces exact archive digest and extraction, final file-set/SHA-256/size, every append-only Android release overlay, stable aliases, frozen 162/161 compatibility paths, native and browser setup closure, original keymaps, legacy asset bytes, route/import checks, service-worker precache/range boundaries, and the Pages size ceiling. Public HTTPS, MIME, redirect, cache, and byte-range behavior still require post-deployment verification. |
| `runtime` | `caatuu-runtime-image` v1 | `apps/server` | Locked Rust tests, Compose validation, then `node apps/server/tooling/audit-runtime-boundary.mjs --base-url <candidate-url>` | Runtime behavior is tested; a standalone image manifest and layer-closure validator is still missing. |
| `android` | `caatuu-android-update` v1 | `apps/android` | `publish-release.sh --build-once` performs preflight, signed package validation and receipt finalization; `deploy-pages-release.ps1 -CandidateReceipt <receipt>` verifies exact uploaded/public bytes without rebuilding. The wrapper is `release-android.ps1`. Full runtime auditing remains available through `audit-runtime-boundary.mjs`; channel gates remain in [`FIRST_ANDROID_RELEASE.md`](FIRST_ANDROID_RELEASE.md). | Direct-download APK/update and sealed package validation exist. Same-invocation audit reuse requires matching evidence; old/adopted candidates retain the full audit. Simulated orchestration failures are source-CI coverage, not device evidence. Store AAB delivery is outside v1 and needs a new registered contract. |
| `model-catalog` | `caatuu-model-catalog` v1 | `tools/on-device-models` and the language app | `node apps/server/tooling/check-static-model-catalog.mjs --catalog <catalog>` | Catalog/config consistency is checked; release automation must additionally verify every referenced model and model-card byte/hash. |
| `dictionary-catalog` | `caatuu-dictionary-catalog` v1 | selected language app and runtime | `node apps/server/tooling/audit-runtime-boundary.mjs --base-url <candidate-url>` | Integrated catalog behavior is checked; a standalone dictionary payload-closure validator is still missing. |
| `embedding-catalog` | `caatuu-embedding-catalog` v1 | selected language app | Runtime contract tests and `node apps/server/tooling/audit-runtime-boundary.mjs --base-url <candidate-url>` | Integrated behavior is checked; a standalone embedding payload-closure validator is still missing. |
| `static-assets` | `caatuu-static-assets` v1 | owning app or course pack | `node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses --check` followed by the runtime boundary audit | Setup assets are byte/hash checked; a general standalone static-assets manifest validator is still missing. |
| `other` | Explicit `caatuu-*` contract | Named component owner | No implicit validator | It must not carry release-critical content until its contract and executable validator are added here. |

Before publication, release automation must record each command, validator
source revision, pinned execution environment, exit status, and immutable
output as evidence. Any `missing` coverage above keeps the corresponding
complete-integrity acceptance row open.
