# Caatuu product-readiness road map

License and Android artifact status updated: 9 September 2026; other readiness gates retain their prior review.

Caatuu is a public development preview. This document is the public release
gate; it contains no personal runway, address, tax, identity-document, or
private financial information.

## Current position

| Area | Status | Release consequence |
| --- | --- | --- |
| First-party software and curriculum license | `CLOSED FOR IDENTIFIED FIRST-PARTY SCOPE` | `AGPL-3.0-only` covers first-party software and the original English, Mandarin, Spanish-course and Norwegian curriculum identified in [LICENSING.md](LICENSING.md#first-party-curriculum); third-party terms remain in force |
| Spanish-course and Norwegian curriculum license | `OWNER APPROVAL RECORDED` | The [9 September owner approval](CURRICULUM_LICENSE_APPROVAL_20260909.json) clears the identified original curricula for distribution; formal catalog gates record `release-cleared`. Courses remain development previews and native-speaker/pronunciation reviews remain pending |
| Exact deployed source | `RECORDED PER ARTIFACT` | Android 172 pins its clean, pushed source revision in the public manifest and sealed receipt; the website retains its separately verified snapshot. Preserve these identities and do not infer governed-beta readiness from publication alone |
| Feedback collection | `BOUNDED EDGE CHANNEL READY` | The Pages app remains static. A separate Cloudflare Worker accepts only consented sentence reports and future-only opted-in dictionary gaps into EU D1. Old local queues are never migrated, general diagnostics remain disabled, and the private ledger stays outside Pages and GitHub Releases. |
| AI interaction notice | `CLOSED FOR PREVIEW` | Shared product chrome explicitly tells users they are interacting with AI and warns that output may be wrong |
| Models and training lineage | `IN PROGRESS` | Ship only artifacts whose base revision, adapter owner, training inputs, license, hashes, and model card are complete |
| Dictionaries and datasets | `IN PROGRESS` | Preserve source, attribution, share-alike terms, modifications, and hashes in every distribution |
| Third-party software notices | `BLOCKED` | Browser and APK notice bundles must include every distributed dependency and required license text |
| Artwork and generated assets | `BLOCKED` | Exclude any asset without an author/provider, creation record, redistribution grant, modifications, and attribution decision |
| Signed Android delivery | `VERIFIED ARTIFACT` | Android 172 (0.1.20) is signed, non-debuggable and published with verified APK/setup bytes; see the [release evidence](NORWEGIAN_BOKMAL_COURSE_20260909.md#android-release-result). This does not establish physical-device testing or clear governed-beta legal, privacy and support gates |
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
