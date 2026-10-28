# Caatuu product-readiness road map

Public catalog and Android preview status updated: 27 October 2026. Governed-beta gates other than the published preview artifact retain their prior review.

Caatuu is a public development preview. This document is the public release
gate; it contains no personal runway, address, tax, identity-document, or
private financial information.

## Current position

| Area | Status | Release consequence |
| --- | --- | --- |
| First-party software and curriculum license | `CLOSED FOR IDENTIFIED FIRST-PARTY SCOPE` | `AGPL-3.0-only` covers first-party software and the original curricula identified in [LICENSING.md](LICENSING.md#first-party-curriculum), including the 9 September Spanish-course and Norwegian approval and the 4 October Arabic, Scientific Latin, and Georgian approval; third-party terms remain in force |
| Development-course curriculum license | `OWNER APPROVAL RECORDED` | The [9 September](CURRICULUM_LICENSE_APPROVAL_20260909.json) and [4 October](CURRICULUM_LICENSE_APPROVAL_20261004.json) owner approvals clear the identified original curricula for distribution. Courses other than Czech remain development previews. Native-speaker and pronunciation reviews remain pending |
| Exact deployed source | `RECORDED PER ARTIFACT` | The public stable manifest at `/android/caatuu.json` is Android 195 (`0.1.43`), source `4878e23f03b8ae42d515fc08d2119abc334aed5e`. `device_smoke` is `not-run`. Preserve each artifact's own identity and do not infer governed-beta readiness from publication alone |
| Feedback collection | `BOUNDED EDGE CHANNEL READY` | The Pages app remains static. A separate Cloudflare Worker accepts only consented sentence reports and future-only opted-in dictionary gaps into EU D1. Old local queues are never migrated, general diagnostics remain disabled, and the private ledger stays outside Pages and GitHub Releases. |
| AI interaction notice | `CLOSED FOR PREVIEW` | Shared product chrome explicitly tells users they are interacting with AI and warns that output may be wrong |
| Models and training lineage | `IN PROGRESS` | Ship only artifacts whose base revision, adapter owner, training inputs, license, hashes, and model card are complete |
| Dictionaries and datasets | `IN PROGRESS` | Preserve source, attribution, share-alike terms, modifications, and hashes in every distribution |
| Third-party software notices | `BLOCKED` | Browser and APK notice bundles must include every distributed dependency and required license text |
| Artwork and generated assets | `BLOCKED` | Exclude any asset without an author/provider, creation record, redistribution grant, modifications, and attribution decision |
| Signed Android delivery | `VERIFIED PREVIEW ARTIFACT` | Android 195 (`0.1.43`) is the public signed, non-debuggable stable alias. Its manifest records product-package and bundletool audits passed and device smoke not run. The [Android 172 evidence](NORWEGIAN_BOKMAL_COURSE_20260909.md#android-release-result) remains the historical record of that earlier candidate. Publication does not clear governed-beta legal, privacy, or support gates |
| Privacy/operator record | `BLOCKED` | A governed beta needs the real controller record, processor list, lawful bases, retention, deletion, and transfer assessment |
| Publisher and payments | `OWNER GATE` | No store or paid offer until the legal publisher, country, bank, tax treatment, contact, and signing-key custodian are settled |
| Support and security | `PREVIEW BASELINE` | Private contact exists, but supported versions and response commitments begin only with a governed beta |

## Sequence to a governed beta

1. **Source freeze:** inventory the dirty checkout, split it into reviewed
   commits, scan it for credentials and third-party material, and deploy from
   the resulting immutable commit rather than a mutable working directory.
2. **Minimal content set:** select the smallest useful active model,
   dictionary, curriculum, and visual set; clear every included item and exclude
   everything else from catalogs and packages.
3. **Distribution evidence:** generate browser/APK notices, software bills of
   materials, artifact hashes, model cards, and a release manifest tied to the
   source commit.
4. **Trust baseline:** complete the privacy/controller record, threat review,
   backup and signing-key procedure, vulnerability workflow, and ordinary-device
   setup tests.
5. **Signed invited beta:** publish one non-debuggable build to named testers,
   measure setup completion and repeated learning use, and fix failures before
   expanding distribution.
6. **Income validation:** offer one separately contracted, fixed-scope service
   or learning pilot. Keep the core app free and do not attach product benefits
   to voluntary support.
7. **Public/store decision:** only after retained use and operational readiness,
   choose direct distribution, an app store, or both and create the required
   publisher/payment accounts.

## Hard rules

- No unresolved-rights model or asset enters a release because it works
  technically.
- No debug APK becomes the public fallback.
- No payment prompt is added until the recipient and tax/accounting path are
  settled.
- No account, analytics, sync, hosted community, or general diagnostic
  collection is added without an explicit privacy and support review.
- Device-local v1 feedback and dictionary-gap outboxes do not authorize remote
  delivery and are never migrated. New sentence reports require per-report
  consent; new dictionary gaps require a default-off, future-only opt-in. The
  Worker rejects clients without the current reporting-policy marker before it
  reads their bodies.
- Every dictionary-gap channel must remain bounded, require a positive durable
  acknowledgement before removing a local item, expose no ledger read route,
  and stay separate from sentence reports and device or user identifiers.
- External contributions do not reopen until inbound rights preserve the
  project's chosen operating and licensing options.

Detailed component evidence is maintained in
[`LEGAL_INVENTORY.md`](LEGAL_INVENTORY.md), release mechanics in
[`RELEASING.md`](RELEASING.md), and licensing scope in
[`LICENSING.md`](LICENSING.md).
