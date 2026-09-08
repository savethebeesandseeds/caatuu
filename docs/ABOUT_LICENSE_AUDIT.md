# About and license delivery audit

Reviewed 8 September 2026 against the canonical source and the existing
`artifacts/android/releases/170/caatuu.apk`. This audit covers the browser app
and Android **product** distribution. It is evidence of implementation and
delivery, not a new license grant or completion of outstanding ownership reviews.

## Confirmed defects

- `transformChromeJs` replaced `modelLicenseList` with a generic embedding
  paragraph and removed the capability-aware AI notice. The packaged workspace
  still tried to render the missing list. The transformation now preserves the
  complete shared About section, including its interface message keys.
- The browser supplied a fixed Czech Word World description to every course.
  At review time it claimed 792 MIT records for Mandarin; the actual Mandarin
  manifest declares 592 records and AGPL-3.0-only. Notices now read each course's
  current manifest. The historical Czech Standard corpus retains its explicit,
  scoped MIT grant; Spanish course manifests retain their pending status.
- Caatuu's own license had prose and a source link, but no list entry or offline
  copy. Both are now included, scoped to first-party software and documentation.

## Usage and notice evidence

| Component | Actual use / scope | Notice authority |
| --- | --- | --- |
| Caatuu | First-party software and documentation | [Root AGPL-3.0-only](../LICENSE), exact offline copy |
| MiniLM, Transformers.js, ONNX Runtime Web | Shared local inference on authored English text; on-demand loading with lexical fallback | [Pinned runtime notices](../apps/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/THIRD_PARTY_NOTICES.json), runtime loader and setup delivery |
| English concepts | Authored English learning and embedding input | [Runtime concept catalog](../apps/language-runtime/static/data/english-concepts/word-world-starter-v1.json), including its scoped grant |
| Word World content | Current course's guided learning content | Course-owned manifest and, for Czech Standard, its [historical MIT grant](../tools/czech-ml/data/word-world/standard-v0.1/README.md) |
| Czech dictionary | Native SQLite / browser dictionary provider | [Attribution and modifications](../apps/languages/czech/static/data/dictionaries/ATTRIBUTION.md); recorded redistribution choice CC BY-SA 4.0 |
| sql.js 1.13.0 | Czech browser vector database; retained in Android offline course files | Existing [MIT text](../apps/languages/czech/static/vendor/sql.js/LICENSE) |
| Android dependencies | Resolved product `releaseRuntimeClasspath`, including platform variant and BOM metadata | [Generated inventory](../apps/language-runtime/static/legal/android-dependencies.json) with cached POM hashes and [embedded notices](../apps/language-runtime/static/legal/ANDROID-NOTICES.txt) |
| Speech voices | Device/browser provider, not redistributed voice models | Explicit provider-specific-terms entry |
| Music | Three catalogued tracks, shared setup downloads | Existing [music evidence](../apps/launcher/static/assets/music/MUSIC_LICENSE_NOTES.md) and credits retained |
| Optional generation models | Available only where course/distribution capabilities enable them | Model catalog; labeled optional/legacy instead of claiming every model is active |

The Android runtime graph currently resolves 35 component coordinates. The
inventory describes that graph, not a claim that every coordinate contributes
classes to a shrinker-produced APK. The Gradle `verifyProductDependencyNotices`
task compares the inventory to the actual resolved graph before asset generation.

## Offline delivery

The shared asset catalog and all four course offline allowlists include Caatuu,
ONNX, Android dependency, sql.js, Czech corpus, and dictionary notice texts.
Existing hash-pinned MiniLM and Transformers notices remain in setup delivery;
their presence must be checked in the APK **and downloaded asset union**, not
only by searching the ZIP. Previously published runtime objects were not changed.
The Transformers license also has an exact `.txt` copy so Android's existing MIME
mapping displays it as text instead of treating extensionless `LICENSE` as a binary.

The supplemental ONNX MIT text is copied from the [pinned upstream commit](https://raw.githubusercontent.com/microsoft/onnxruntime/b7804b056c30aa35c1748f8e4e239d0e2ff25d6d/LICENSE).
The dictionary's CC BY-SA text is the [SPDX license-list text](https://raw.githubusercontent.com/spdx/license-list-data/main/text/CC-BY-SA-4.0.txt),
checked against the [Creative Commons legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode.txt).
Its recorded SHA-256 is `cde7883b9050a1104f4ac19a1572aafd6e5d7323b68351aaf51fbf4beba54966`.

Regeneration and verification commands are documented in the
[Android tooling README](../apps/android/tooling/README.md#about-and-offline-license-notices).

## Remaining review boundaries

- Artwork provenance and brand terms are incomplete in the
  [legal inventory](LEGAL_INVENTORY.md). The app now states the separate terms
  and pending review explicitly; this change does not grant artwork rights.
- Spanish and Spanish-to-English content remains `release-review-required`.
  The reviewed Android APK includes these development courses, so the older
  inventory statement that Spanish was absent from Android was inaccurate.
  Notice corrections do not constitute content clearance or platform promotion.
- The Rust server and the full development Android application's additional
  native generation dependencies require their own inventories. This product
  audit does not close those entries or authorize a release containing them.
- Optional/derived model and legacy curriculum provenance reviews remain open.

## Regression coverage

- Course license tests derive counts and grants from authoritative manifests,
  preserve unknown grants, and verify offline text mappings and source copies.
- Workspace startup tests cover capability-gated catalog loading and unrelated
  course-resource isolation.
- Product transformation tests require exact shared About markup parity; the
  product bundle contract exercises actual compiled assets for every course.
- The native Gradle guard verifies the resolved dependency graph without building
  an APK. New versions or dependencies require reviewed notice regeneration.

Validation completed: 23 focused license, bootstrap-delivery and workspace tests;
the compiled multi-course bundle and About transformation contracts; the native
dependency guard; and the repository Markdown link check. The live Mandarin
About page displayed the corrected entries without console errors. Local legal
texts return HTTP 200 with `text/plain`. The Codex browser blocks direct plaintext
navigation (`ERR_BLOCKED_BY_CLIENT`), so reading them on an Android device remains
part of the next APK/device check; Android's inspected asset client supports
same-origin navigation and UTF-8 `.txt` responses.

At the time of the initial audit, no APK had been rebuilt or published. The fix
requires a new APK before it changes an installed copy; subsequent releases are
recorded in the [changelog](../CHANGELOG.md).
