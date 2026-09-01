# Caatuu product-readiness road map

Last reviewed: 1 September 2026

Caatuu is a public development preview. This document is the public release
gate; it contains no personal runway, address, tax, identity-document, or
private financial information.

## Current position

| Area | Status | Release consequence |
| --- | --- | --- |
| First-party software and curriculum license | `CLOSED` | `AGPL-3.0-only` covers first-party software plus Caatuu-authored English/Mandarin curriculum; third-party and separately licensed model, data, art, dependency, and brand terms remain in force |
| Exact deployed source | `BLOCKED` | The live development checkout contains unpublished changes; do not call it a governed beta until one clean commit exactly represents the deployed first-party source |
| Feedback collection | `PLANNED LOCAL-ONLY CUTOVER` | The planned Pages origin accepts and stores no general sentence, diagnostic, or dictionary-gap reports. Legacy full-development clients may still attempt their compiled public URLs and receive a failed static response. Before DNS cutover, the bounded dictionary-gap ledger must be frozen and backed up privately, never in the Pages or GitHub Release payload. |
| AI interaction notice | `CLOSED FOR PREVIEW` | Shared product chrome explicitly tells users they are interacting with AI and warns that output may be wrong |
| Models and training lineage | `IN PROGRESS` | Ship only artifacts whose base revision, adapter owner, training inputs, license, hashes, and model card are complete |
| Dictionaries and datasets | `IN PROGRESS` | Preserve source, attribution, share-alike terms, modifications, and hashes in every distribution |
| Third-party software notices | `BLOCKED` | Browser and APK notice bundles must include every distributed dependency and required license text |
| Artwork and generated assets | `BLOCKED` | Exclude any asset without an author/provider, creation record, redistribution grant, modifications, and attribution decision |
| Signed Android delivery | `EXISTING BASELINE` | Stable 162 is signed, non-debuggable, versioned, hashed, and frozen for Pages; that technical artifact does not by itself clear the governed-beta legal, privacy, or support gates |
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
- Device-local feedback and dictionary-gap outboxes do not authorize remote
  delivery. The planned Pages origin accepts and stores nothing on those
  routes; legacy full-development clients may still attempt their compiled
  public URLs and receive a failed static response.
- Any deliberate local-development dictionary-gap test must remain bounded,
  require a positive durable server acknowledgement before removing a local
  item, expose no ledger read route, and stay separate from sentence reports
  and device or user identifiers.
- External contributions do not reopen until inbound rights preserve the
  project's chosen operating and licensing options.

Detailed component evidence is maintained in
[`LEGAL_INVENTORY.md`](LEGAL_INVENTORY.md), release mechanics in
[`RELEASING.md`](RELEASING.md), and licensing scope in
[`LICENSING.md`](LICENSING.md).
