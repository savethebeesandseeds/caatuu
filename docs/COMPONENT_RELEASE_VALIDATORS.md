# Caatuu component release-validator registry

Last reviewed: 27 August 2026

This registry maps each component contract accepted by the version 1 release
manifest to its owner and current executable validation. It is deliberately
honest about incomplete coverage. The top-level release validator checks the
reference envelope and known legacy shape; it does not turn a partial component
check into payload-closure proof.

Commands run from the repository root in the maintained development or CI
container. `<candidate-url>`, `<apk>`, and `<catalog>` are immutable candidate
inputs recorded by release automation.

| Kind | Contract | Owner | Current executable validation | Payload-closure status |
| --- | --- | --- | --- | --- |
| `web` | `caatuu-web-bundle` v1 | `apps/launcher` and the selected language app | `node apps/launcher/tooling/build-static-site.mjs --output <bundle-dir>`; use `--validate-only` to recheck existing bytes | Exact file-set, SHA-256, size, setup-asset, keymap, route/import, service-worker, capability, Standard Word World, and server/model-boundary closure is enforced for `web-static-core`. Public origin behavior still requires post-deployment verification. |
| `runtime` | `caatuu-runtime-image` v1 | `apps/server` | Locked Rust tests, Compose validation, then `node apps/server/tooling/audit-runtime-boundary.mjs --base-url <candidate-url>` | Runtime behavior is tested; a standalone image manifest and layer-closure validator is still missing. |
| `android` | `caatuu-android-update` v1 | `apps/android` | `node apps/server/tooling/audit-runtime-boundary.mjs --base-url <candidate-url> --apk <apk>` plus the signed-package audit required by [`FIRST_ANDROID_RELEASE.md`](FIRST_ANDROID_RELEASE.md) | Direct-download APK/update validation exists. Store AAB delivery is outside v1 and needs a new registered contract. |
| `model-catalog` | `caatuu-model-catalog` v1 | `tools/on-device-models` and the language app | `node apps/server/tooling/check-static-model-catalog.mjs --catalog <catalog>` | Catalog/config consistency is checked; release automation must additionally verify every referenced model and model-card byte/hash. |
| `dictionary-catalog` | `caatuu-dictionary-catalog` v1 | selected language app and runtime | `node apps/server/tooling/audit-runtime-boundary.mjs --base-url <candidate-url>` | Integrated catalog behavior is checked; a standalone dictionary payload-closure validator is still missing. |
| `embedding-catalog` | `caatuu-embedding-catalog` v1 | selected language app | Runtime contract tests and `node apps/server/tooling/audit-runtime-boundary.mjs --base-url <candidate-url>` | Integrated behavior is checked; a standalone embedding payload-closure validator is still missing. |
| `static-assets` | `caatuu-static-assets` v1 | owning app | `node apps/server/tooling/refresh-setup-assets.mjs --check` followed by the runtime boundary audit | Setup assets are byte/hash checked; a general standalone static-assets manifest validator is still missing. |
| `other` | Explicit `caatuu-*` contract | Named component owner | No implicit validator | It must not carry release-critical content until its contract and executable validator are added here. |

Before publication, release automation must record each command, validator
source revision, pinned execution environment, exit status, and immutable
output as evidence. Any `missing` coverage above keeps the corresponding
complete-integrity acceptance row open.
