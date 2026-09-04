# Caatuu first Android release map

Status: active release plan
Created: 13 August 2026
Target: Google Play, free `v0.1.0`
Application ID: `com.waajacu.caatuu`

This is the execution map for turning the current Caatuu development preview
into its first governed Android release. It consolidates the product, content,
technical, legal, privacy, business, store, and operational work that must be
finished before publication.

The map is fail-closed: a failed or unknown required gate blocks promotion. A
debug APK, a locally successful build, or a Play Console upload is not by
itself a release. The submitted artifact will be an Android App Bundle (AAB);
Google Play will generate device APKs from it.

This public document must not contain the maintainer's home address, identity
documents, tax details, bank details, private account recovery information, or
signing-key locations. Those records belong in an encrypted private owner
register outside Git.

## 1. Release decisions

These decisions define the default `v0.1.0` path. Changing one requires an
explicit update to this document and a re-audit of the affected gates.

| Decision | First release |
| --- | --- |
| Distribution | Google Play |
| Price | Free |
| Publisher | Individual maintainer, with public developer name `Waajacu` |
| Company | Not required for the free first release |
| Bank or merchant account | Not required while the app is free and has no purchases |
| Ads and analytics | None |
| Accounts and cloud sync | None |
| LLM generation | Excluded from the store artifact and production release surface |
| Embeddings | Included; required for image retrieval and semantic statistics |
| Godot | Source retained, but excluded from the app and production release surface |
| Monetization | Deferred; no donation prompt, paid unlock, billing SDK, or custom-object purchase in `v0.1.0` |
| Learning data | Device-local |
| Outbound feedback | Disabled for the simplest release privacy boundary unless a separate approved data-flow gate is completed |
| Audience | Treat as including children; the current content targets ages 6–10 |
| Android support | Android 11/API 30 or newer, initially `arm64-v8a` |
| License | First-party software and Caatuu-authored English/Mandarin curriculum remain `AGPL-3.0-only`; third-party or separately licensed data, art, models, brands, and dependencies keep their separate terms |

The AGPL permits commercial use. It does not prevent a later paid product or
service. Waajacu's brand, trusted distribution, reviewed content, hosted
services, support, and separately licensed custom objects can remain the
product differentiation.

## 2. Caatuu product boundary

The repository may keep research and future product work. The Play artifact
must contain only an explicit release allowlist.

| Capability | `v0.1.0` disposition |
| --- | --- |
| Czech launcher and shared product chrome | Include |
| Word World in curated Standard mode | Include after release-subset review |
| Verb Nebula | Include after stable-content migration and review |
| Conjugation Comet | Candidate; include only if its six-verb pilot passes its gates |
| Agreement Aurora | Stretch candidate; include only if its exact content and interface pass |
| Case Cosmos | Defer by default; promote only if its exact content and interface pass |
| Memory Moon placeholder | Hide and exclude |
| Sounds Quasar placeholder / Battle of the Robots | Defer and exclude |
| Dictionary and Android Czech speech | Include |
| MiniLM embeddings, vector database, image lookup, semantic evidence and statistics | Include |
| Chat, text generation, model download/delete controls and generative settings | Exclude |
| llama.cpp, ggml native libraries and GGUF/model catalogs | Exclude |
| Godot project, export, route and launcher link | Exclude from release; preserve source |
| Backpack and statistics | Include after progression consistency and honest-label gates |
| Coins, gems, purchases and paid inventory | Hide unless they have a complete free, earned-only purpose; no purchase affordance |

An excluded feature is not merely hidden with CSS. Its executable code,
native libraries, catalogs, download URLs, routes, service-worker entries, and
packaged assets must be absent from the release profile.

## 3. Initial audit snapshot

This snapshot explains why the release remains blocked. It is not a permanent
status report; update the dashboard after each release gate.

| Area | Snapshot | Consequence |
| --- | --- | --- |
| Source identity | The release branch is synchronized with its canonical GitHub branch before publication | The publisher records the exact pushed commit in every release manifest |
| Browser/Android contracts | Current full Node suite passes 383 of 383 tests | Retain this baseline and keep the store boundary contracts mandatory |
| Rust server | 26 of 26 tests passed | Retain this baseline |
| Android build | Full development source remains separate; the stripped `product` release module owns canonical Caatuu artifacts | Keep the development build out of product publication |
| Public artifact | Caatuu 0.1.6 uses stable `versionCode` 158; stable code 157 remains the prior release, while transition code 157 carries older debug-lineage installs to the stable channel | Publish 158 and record the physical-device result |
| Version | Current `versionName` is `0.1.6`; prerelease names are retired | Increase `versionCode` for every later artifact without changing released bytes |
| Mandatory setup | 671 artifacts totaling 343,347,068 bytes | Reduce and test the first-run burden |
| LLM boundary | The development build retains LLM work; the audited `product` AAB and derived APK exclude its dependency, libraries, metadata, Chat, URLs, bridge, and UI | Keep the production origin isolated before declaring models not distributed |
| Embeddings | Active and required; approximately 56.8 MB of setup assets, including a roughly 20 MB vector DB | Preserve and release-audit independently from LLMs |
| Godot | Source remains in the repository; the audited `product` AAB and derived APK contain no Godot export, library, route, or launcher surface | Keep production routes disabled and retain the package assertion |
| Content review | Current Word World has 792 Codex-reviewed records and no human-approved records | Freeze a smaller exact release subset and obtain qualified review |
| Progression | Aggregate counters and a stronger semantic evidence ledger coexist; most games do not share stable item identities | Define progression v1 before claiming durable learning progress |
| Legal/privacy | Existing inventories explicitly contain stop-ship and preview-only entries | Close them for the exact release bytes |
| Device evidence | No complete signed-release physical-device record | Device and Play testing blocked |

## 4. Critical path and release gates

```text
scope lock
  -> clean integration checkpoint
  -> stripped store profile
  -> release content/asset allowlist
  -> progression and game gates
  -> rights/privacy/hosting closure
  -> signed RC AAB
  -> physical-device and Play internal tests
  -> closed test
  -> production approval and staged rollout
```

Content review, game refinement, store materials, policy drafting, and tester
recruitment may run in parallel after the store profile and release allowlist
are defined. The final source freeze cannot occur until their outputs are
integrated and every required gate is green.

## 5. Phase 0 — scope lock and repository cleanup

Goal: create a reviewable integration baseline without losing work owned by
the maintainer or another session.

- [ ] Name one integration owner for the release branch and shared dirty tree.
- [ ] Inventory every modified, deleted, and untracked path. Classify each as
  release source, preserved future source, generated output, private material,
  temporary work, or accidental residue.
- [ ] Preserve useful LLM, Godot, candidate-content, and research work in their
  documented source locations. Do not delete them to make the tree appear
  clean.
- [ ] Keep build products, caches, raw candidate workspaces, secrets, model
  weights, signing files, and ad-hoc `tmp/` output out of Git.
- [ ] Resolve the current `home.html` retirement and all stale route, asset,
  hard-coded record-count, and test expectations.
- [ ] Split the integration set into small reviewed commits. Stage only known
  paths; never use repository-wide destructive cleanup to achieve this gate.
- [ ] Scan the candidate source for credentials, private data, generated
  binaries, and unresolved third-party material.
- [ ] Run the repository structure and Markdown-link validators.
- [ ] Run the complete browser, Android contract, Compose, and locked Rust
  suites. Required result: no unexplained failure.
- [ ] Push the integration commits so the remote contains the exact reviewed
  first-party source.

Exit evidence:

- a clean, pushed integration commit;
- an inventory decision for every formerly dirty/untracked path;
- green current CI; and
- no release decision based on files that exist only in one mutable checkout.

## 6. Phase 1 — create the stripped Play release profile

Goal: make exclusion structural and testable while preserving the full
development application.

### 6.1 Distribution profiles

Use the named Android `product` distribution profile with
these capabilities:

```text
generative = false
embeddings = true
godot = false
selfUpdate = true for direct releases; false for a future Play-specific build
```

Keep a full development profile with generative and experimental source so the
preserved work continues to compile and receive tests. The store build script
must select only the stripped profile. The release must not depend on an
operator remembering environment flags.

### 6.2 Remove LLMs from the release, not from the repository

- [x] Make the store variant configure independently from the llama.cpp vendor
  checkout by selecting only the separate `:product` module.
- [x] Remove `:llamaLib` and every llama/ggml `.so` from the store variant.
- [x] Split native artifact/setup operations from optional generation
  operations so the store bridge exposes no model download, load, prompt, or
  delete method.
- [x] Exclude `data/models/**`, generation manifests, benchmarks, GGUF files,
  model URLs, and LLM metadata from store assets.
- [x] Exclude `chat.html` and `source/features/chat/**` from store assets.
- [x] Remove Chat, debug-chat, model selection, generation notices, and model
  management from the store UI and accessibility tree.
- [x] Force Word World to Standard content in the store profile. Migrate an
  old saved Generative preference safely to Standard so it cannot reactivate
  hidden behavior.
- [x] Separate any generation catalog loading from embedding catalog loading;
  Verb Nebula, Settings, licenses, and statistics must work without an LLM
  catalog.
- [x] Remove generation files from service-worker and offline-cache inputs.
- [x] Keep the full development profile building and tested; no LLM source is
  deleted.
- [ ] If model downloads remain on a development server, isolate them from the
  production release origin. Unresolved models must not remain a hidden public
  distribution merely because the Play UI no longer links to them.

Store AAB negative assertions:

- no `libllama*`, `libggml*`, `.gguf`, or generation model metadata;
- no Chat or generative UI/code;
- no model download URL or generation bridge operation; and
- no LLM route reachable from release navigation or stored legacy state.

### 6.3 Preserve the embedding subsystem

Do not apply broad exclusions such as “remove every model,” “remove every
ONNX file,” or “remove every WASM file.” MiniLM, Transformers.js, ONNX Runtime
Web, and sql.js support retained embedding and vector-search behavior.

- [x] Keep the active embedding catalog and pinned all-MiniLM-L6-v2 revision.
- [x] Keep the vector database manager, browser vector runtime, semantic
  evidence code, Transformers.js, sql.js, embedding-specific ONNX Runtime
  files, tokenizer/configuration, and setup-manifest entries.
- [ ] Rebuild the release vector database from the release content and asset
  allowlists. Every vector row must resolve to a rights-cleared included asset,
  an included content record, or an intentionally retained content-only row.
- [ ] Remove orphaned, development-only, excluded-game, and stop-ship asset
  references from the release vector database.
- [ ] Regenerate row counts, byte counts, hashes, catalog metadata, and
  `setup-assets.json` after the release dataset is frozen.
- [ ] Package the actual required Apache-2.0 and MIT license texts offline,
  including Transformers.js, MiniLM, ONNX Runtime, and sql.js.
- [ ] Verify image lookup, semantic selection, semantic statistics, restart,
  and offline use on Android after every LLM path is absent.

Embedding-positive assertions:

- the embedding catalog and manifests are present;
- the verified vector DB/runtime can be downloaded and served from app-private
  storage;
- semantic image retrieval and statistics work offline after setup; and
- no embedding dependency is accidentally classified as an excluded LLM.

### 6.4 Keep Godot source but exclude Godot from release

The accepted standalone-game boundary remains in
[`decisions/0002-standalone-caatuu-game-and-app-release-boundary.md`](decisions/0002-standalone-caatuu-game-and-app-release-boundary.md).

- [x] Keep `apps/games/caatuu-game` and its tooling in the repository.
- [ ] Make the store AAB build successfully when `artifacts/games/` is absent.
- [x] Exclude the standalone game from the static Pages export; Pages has no
  runtime `CAATUU_ENABLE_CAATUU_GAME_PREVIEW` configuration.
- [x] Hide the launcher's Caatuu Game preview link on the compiled store
  surface.
- [ ] Verify `/games/caatuu-game/` and versioned Godot routes return 404 in
  each public Pages deployment.
- [x] Assert that the AAB and generated device APKs contain no `.pck`, Godot
  WASM, `assets/games/**`, export, or Godot route string.

Phase 1 exit: a profile-aware package validator proves the negative LLM/Godot
boundary and the positive embedding boundary. Existing full-preview checks
must remain strict; do not weaken them to make the stripped profile pass.

Phase 1 implementation evidence (13 August 2026): the canonical unsigned
engineering build completed release Lint/R8, `bundletool validate`, universal
APK generation, and the profile-aware AAB/APK validator. Its AAB is 10,480,086
bytes with SHA-256
`5f6ab1926af723b65c4e7244491aacf208a57db6a4b97759e5289c22df94b5c8`.
This records a technical boundary milestone, not a signed or rights-cleared RC;
the generated inspection APK uses a one-use non-publishable certificate.

## 7. Phase 2 — release content, JSON, and asset authority

Goal: make every enabled game and asset traceable, stable, reviewable, and
packageable from an explicit source of truth.

### 7.1 Add one release game catalog

Create:

`apps/languages/czech/static/data/games/catalog.json`

The versioned catalog must own the release allowlist. At minimum, each entry
records:

- stable game ID and label;
- `included`, `candidate`, or `deferred` release state;
- route and runtime data manifest;
- course and target-language IDs;
- content version;
- minimum supported difficulty;
- packaging/offline requirement; and
- release approval state.

Navigation, service-worker inputs, offline assets, Android static assets, and
package validation must be generated from or checked against the same catalog.
A deferred game may stay in source, but it must not be reachable or packaged.

### 7.2 Give every enabled game a versioned content boundary

For every enabled game, add a build-time schema and a manifest that records:

| Field | Purpose |
| --- | --- |
| `gameId`, `courseId`, `targetLanguageId` | Prevent cross-game/course drift |
| content version | Bind saved state and evidence to content |
| immutable runtime path | Identify exact learner-facing JSON |
| schema path/version | Fail closed on invalid records |
| record count, bytes, SHA-256 | Bind the exact release payload |
| authoring mode and source provenance | Trace direct or generated content |
| review state and approval receipt | Distinguish machine review from qualified human approval |
| rights/license state | Prevent unresolved content from entering release |

Learner-facing JSON should remain small. Provenance and review detail may live
in sidecar authoring records, while the release manifest binds those records
to the exact runtime hash.

- [ ] Add stable `id` and `revision` fields to every assessed record referenced
  by progress. Update existing tests that currently prohibit those fields.
- [ ] Bump a record revision when a correction changes its learning meaning or
  accepted answer. Old evidence must not silently transfer.
- [ ] Reject duplicate IDs, invalid revisions, missing fields, unknown levels,
  unbounded accepted answers, and mismatched hashes at build time.
- [ ] Keep runtime validation fail-closed and show a bounded unavailable state;
  never invent fallback learning content.
- [ ] Add deterministic coverage reports for difficulty, topics, forms,
  concepts, assets, review state, and rights state.

### 7.3 Freeze and review the smallest useful content set

Current content volume is larger than the human-approved release set. Prefer a
smaller fully reviewed course over a larger unapproved corpus.

| Game | Required `v0.1.0` work |
| --- | --- |
| Word World | Standard-only; fix manifest/count drift; choose a balanced release subset from the 792 records; obtain qualified Czech and pedagogical review for its exact hash; keep sentence/image/dictionary/embedding integrity |
| Verb Nebula | Compile a finite verb-only pack from the mixed 865-row vocabulary source; add stable IDs/revisions, reviewed Czech/English pairs and difficulty; remove LLM-catalog coupling |
| Conjugation Comet | Make the five teaching verbs and one held-out verb explicit in JSON rather than deriving them from 59 records by order/filter; review every form, cue, accepted answer, hint and grammatical claim |
| Agreement Aurora | Add stable identities and review the exact included adjective phrases; finish phone, keyboard, screen-reader and reduced-motion behavior; include only if green by content freeze |
| Case Cosmos | Add stable identities and review all included case forms and complete sentences; finish its seven-choice interface and evidence behavior; otherwise leave it source-only for the next release |
| Memory Moon | Remove from the release catalog and navigation while it remains a placeholder |

Qualified review must bind to bytes or a content hash. “Codex-reviewed” is
useful development evidence but is not a substitute for independent Czech
approval of production learning content.

### 7.4 Clean the release asset set

- [ ] Create an asset allowlist derived from included games and retained shared
  UI; do not package the entire development asset tree by default.
- [ ] Give every included visual a stable ID, hash, author/provider, creation or
  retrieval date, source/evidence reference, redistribution grant/license,
  modification record, and attribution decision.
- [ ] Exclude all `local-preview-only`, unresolved, orphaned, superseded, raw
  candidate, and unreferenced assets.
- [ ] Rebuild loading animation, keymaps, embedding rows, setup manifest, and
  caches from the same allowlist.
- [ ] Measure mandatory setup after cleanup. Working goal: no more than 150 MB.
  A larger budget needs an explicit product-owner exception, an accurate store
  disclosure, and clean-device evidence showing that setup remains usable.
- [ ] Test setup with low storage, slow network, interruption, backgrounding,
  restart, resume, cancellation, and hash failure.

Phase 2 exit: every file reachable by an enabled game is schema-valid,
allowlisted, reviewed to the required level, rights-cleared, hash-bound, and
present in browser/offline/Android delivery; every other game/content/asset is
absent from the store package.

## 8. Phase 3 — progression, Backpack, statistics, and game completion

Goal: ship one coherent local progression system without making unsupported
mastery claims.

### 8.1 Progression v1

Use the existing semantic evidence ledger as canonical item/concept learning
history. Keep `CaatuuLearning` as the aggregate presentation layer for XP,
rounds, activities, and Backpack summaries instead of creating a third
competing history store.

- [ ] Identify assessed items as `gameId:itemId@revision`.
- [ ] Record the first response exactly once, including incorrect attempts.
- [ ] Record hint and reveal use. A reveal is exposure and contributes zero
  independent mastery weight.
- [ ] Separate exact-item familiarity, recognition, production, and transfer.
- [ ] Add a small versioned progression-policy JSON defining mission size,
  prerequisites, difficulty eligibility, new/review balance, and due/weak-item
  priority.
- [ ] Select due or weak eligible items first, then unseen eligible content.
  Random order may vary a ready queue but must not define the curriculum.
- [ ] Keep Explorer, Traveler, and Navigator learner-selectable in `v0.1.0`;
  do not introduce punitive locks before the evidence is calibrated.
- [ ] Persist mission identity, queue, content version, settlement receipt, and
  evidence across restart and app upgrade.
- [ ] Reject stale saved rounds against changed content revisions.
- [ ] Make Reset progress clear aggregates, per-game memory, prepared queues,
  and semantic evidence consistently and atomically enough to avoid ghost
  stats.
- [ ] Add migration tests from the latest public preview storage into the
  release profile, including a saved Generative Word World preference.

Progression acceptance:

- reordering JSON does not move progress to a different item;
- retries, repeated taps, hints, reveals, and page reloads cannot inflate
  independent accuracy or rewards;
- a revision bump does not inherit incompatible evidence;
- every enabled game updates compatible evidence and aggregate statistics;
- restart and upgrade preserve the correct mission; and
- offline statistics and Backpack work with all LLM code absent.

### 8.2 Backpack, rewards, and statistics

- [ ] Give XP and every earned object one idempotent award receipt.
- [ ] Ensure an activity cannot award the same reward repeatedly through
  reload, back navigation, or duplicated callbacks.
- [ ] Show only statistics that the stored observations support. Use terms such
  as practice, exposure, first-response accuracy, and activity; do not claim
  calibrated mastery or efficacy without evidence.
- [ ] Make Backpack a clear learner-facing summary, not a collection of dead
  purchase affordances.
- [ ] Hide coins, gems, inventory buttons, and shop language unless each has a
  complete free, earned-only role in `v0.1.0`.
- [ ] Keep the reward schema ready for future custom objects without promising
  purchases or allowing paid flags in the first release.

### 8.3 Finish enabled games

For every game still marked `included` at content freeze:

- [ ] one clear teaching and play loop with an understandable first action;
- [ ] reviewed instructions, prompts, answers, feedback, and summaries;
- [ ] no placeholder, debug, experimental, or “coming soon” action;
- [ ] one documented navigation contract with working Android Back behavior;
- [ ] touch, keyboard/switch, screen reader, reduced motion, small phone, and
  Czech text/input support;
- [ ] no drag-only or timing-only assessed interaction;
- [ ] bounded failure for missing/corrupt data and interrupted setup;
- [ ] offline behavior after setup;
- [ ] evidence and reward settlement exactly once; and
- [ ] focused contract, content, accessibility, and package-parity tests.

Before production, run facilitated usability checks with approximately 5–8
representative learners. At least 80% should finish the core mission without
facilitator intervention, with no critical accessibility or false-rejection
defect. A failed second attempt means defer, merge, replace, or stop that game;
it does not mean delay the entire release indefinitely.

### 8.4 Learner-content safety boundary

Learner-facing text is a release input, not harmless test data. The checked-in
game packs must pass `npm run validate:learner-content` from `tools/czech-ml`.
The Android product compiler repeats the same deterministic scan against the
exact packaged JSON and fails closed on unresolved block or review findings.

- [ ] Keep every shipped game JSON registered with a field-aware extractor.
- [ ] Reject alcohol, tobacco, illicit drugs, explicit sexual content,
  profanity, self-harm, graphic harm, weapons, credential requests, direct
  personal-data requests, and avoidable ambiguous phrasing.
- [ ] Preserve useful age-appropriate language for feelings, ordinary health,
  asking for help, trusted adults, sports, and online-safety instruction.
- [ ] Bind editorial corrections to exact record IDs and expected old content,
  and preserve historical candidate/review evidence rather than rewriting it.
- [ ] Rebuild content-addressed runtime packs after correction and invalidate
  browser caches for directly loaded JSON revisions.
- [ ] Run an independent bilingual Czech and child-development review against
  the exact final hashes. A deterministic pass means only that no encoded rule
  fired; it is not a claim of human approval or complete safety.
- [ ] Treat unrestricted dictionary definitions and semantic image retrieval
  as separate child-safety surfaces; curate or filter them before production.

## 9. Phase 4 — legal, privacy, business, and operations closure

### 9.1 Exact release legal inventory

- [ ] Refresh [`LEGAL_INVENTORY.md`](LEGAL_INVENTORY.md) against the final
  release commit and actual AAB-generated APK contents.
- [ ] Mark LLM and Godot items `NOT-DISTRIBUTED` for this release only after
  package and public-origin audits prove their absence.
- [ ] Close licenses/notices for MiniLM, Transformers.js, ONNX Runtime, sql.js,
  Android/Rust dependencies, dictionaries, curricula, and every included art
  asset.
- [ ] Generate an exact dependency inventory/SBOM and offline third-party
  notices view.
- [ ] Preserve Czech dictionary attribution, source links, modifications, and
  share-alike terms wherever the dictionary is delivered.
- [ ] Publish a simple Caatuu/Waajacu brand policy so AGPL code rights are not
  confused with rights to the names, logos, domain, or package identity.
- [ ] Point the in-app AGPL corresponding-source offer to the exact signed tag
  or immutable source archive, not mutable GitHub `main`.
- [ ] Keep the root AGPL license available offline in the app.

No unresolved-rights file enters the release because it is technically useful.

### 9.2 Release privacy baseline

The simplest `v0.1.0` baseline is no accounts, ads, analytics, cloud sync,
generative AI, remote diagnostics, or outbound feedback.

- [ ] Disable dictionary-gap transmission for `v0.1.0`, or complete a separate
  approved gate covering exact fields, purpose, lawful basis, retention,
  deletion, processor, user notice, Data Safety declaration, security, and
  child-data treatment. Device-local queues alone do not authorize later
  delivery.
- [ ] Replace [`PRIVACY.md`](PRIVACY.md)'s preview wording with the verified
  release data flow and publish it at a stable Waajacu HTTPS URL.
- [ ] Name Caatuu/Waajacu and the actual individual controller as required,
  while keeping non-public identity evidence outside Git.
- [ ] List the final hosting, DNS/CDN, email, Play, and support processors;
  document purposes, lawful bases, retention/deletion, security, transfers,
  and user-rights contact.
- [ ] Complete the Play Data Safety form from measured app behavior, including
  every third-party library and WebView request.
- [ ] Verify that in-app privacy, security, support, and source links work
  offline where appropriate and online at stable release URLs.

### 9.3 Children and store policy

The current learner content explicitly targets ages 6–8 and 6–10. The release
must not declare an adult-only audience merely to avoid policy work.

- [ ] Plan the listing for the applicable 6–8 and 9–12 Play audience groups,
  subject to the final reviewed content.
- [ ] Complete the Families-policy review for content, links, data behavior,
  SDKs, support, and commercial design.
- [ ] Keep the first release free of ads, social/community features, accounts,
  manipulative prompts, and purchases.
- [ ] Complete the IARC content-rating questionnaire accurately.
- [ ] Ensure every external link and support surface is appropriate for the
  declared audience.

### 9.4 Minimum viable operator

The free first release can be published by the maintainer through a personal
Play developer account. The public developer name can be `Waajacu`. No
incorporated entity or permanent European residence is a technical prerequisite
for the app release, but all identity and tax statements must be truthful for
the maintainer's actual jurisdiction.

Private owner-register checklist:

- legal publisher and controller identity;
- verified address, email, and phone used for account verification;
- account owner, recovery methods, 2FA, and emergency access;
- domain/DNS/hosting ownership and renewal dates;
- upload/signing key custodians and backup locations;
- support and security contacts; and
- later, before income, bank, tax, invoicing, refund, and business-registration
  decisions for the applicable jurisdiction.

Do not call Waajacu an incorporated company until it is one. A personal Play
account can later be converted or the application transferred through Google's
formal process when Waajacu becomes an eligible verified organization.

### 9.5 Hosting and continuity

Required setup and embedding downloads must not depend on the maintainer's
workstation or a mutable live checkout.

- [ ] Publish release assets under immutable, HTTPS, version-owned URLs.
- [ ] Upload files first and mutable catalogs/pointers last.
- [ ] Verify public bytes, sizes, hashes, cache behavior, range/resume support,
  and failure behavior after upload.
- [ ] Retain the current and previous release assets and release records.
- [ ] Back up and test recovery for domain/DNS, hosting, source, release
  records, account access, and signing credentials without the original
  workstation.
- [ ] Monitor certificate, domain, email, hosting, and Play-account expiry or
  policy notices.
- [ ] Keep LLM/model and Godot preview routes disabled on the production
  release origin.

### 9.6 Monetization after `v0.1.0`

Do not put a donation button or custom-object purchase into this release.
After stable use is demonstrated, open a separate monetization milestone:

- define the exact paid object/product and its child-safe value;
- clear the object's art, brand, code, and content rights;
- create a Play merchant/payments profile and verified payout bank account;
- determine tax/business registration and invoicing obligations;
- integrate Google Play Billing for digital characters, objects, levels, or
  other in-app benefits;
- implement purchase acknowledgement, restoration, refund/support handling,
  entitlement migration, price disclosure, and family-safe purchase UX; and
- test the free product independently so purchases never become necessary for
  meaningful learning.

A voluntary tip may be evaluated separately only if it grants no digital
benefit and the recipient, tax, accounting, audience, and Play-policy path are
settled first.

## 10. Phase 5 — release engineering, signing, and evidence

### 10.1 Create the Play AAB component contract

[`DEPLOYMENT_STANDARD.md`](DEPLOYMENT_STANDARD.md) currently records that the
direct-download Android contract does not cover a store AAB. Before RC1:

- [x] Define a profile-aware Play AAB/APK package validator. Register the final
  signed component and immutable evidence record before RC1.
- [x] Run `bundletool validate` and inspect a universal APK generated
  from the AAB; auditing only the bundle ZIP is insufficient.
- [ ] Record package ID, version, target/min SDK, ABI, permissions, components,
  debuggable state, cleartext state, direct-updater state, upload certificate,
  AAB hash/bytes, and generated APK results.
- [x] Add profile-aware LLM-negative, Godot-negative, and embedding-positive
  package checks.
- [x] Keep the existing full-preview validator strict and separate.

The generated Play APKs must prove:

- `com.waajacu.caatuu`;
- target SDK 36 or newer and min SDK 30 as intended;
- non-debuggable and cleartext disabled;
- `INTERNET` present, `REQUEST_INSTALL_PACKAGES` absent;
- direct APK updater disabled;
- only approved permissions, exported components, native libraries, and ABIs;
- no LLM or Godot material; and
- all required content, embedding runtime metadata, licenses, and notices.

### 10.2 Release identity and source freeze

- [ ] Reconcile versioning. Use `0.1.0-rc.1`, `0.1.0-rc.2`, and so on for
  candidates, with strictly increasing Android `versionCode`; use `0.1.0` only
  for the approved production bytes.
- [ ] Freeze one clean, reviewed, pushed commit and tag it `v<release_id>` as
  required by [`DEPLOYMENT_STANDARD.md`](DEPLOYMENT_STANDARD.md).
- [ ] Build from the canonical retained container environment, not a mutable
  host installation.
- [ ] Prove the AAB builds when llama vendor files and Godot exports are absent.
- [ ] Build once; promote the same approved bytes rather than rebuilding per
  Play track.
- [ ] Update [`CHANGELOG.md`](../CHANGELOG.md), known limitations, supported
  Android versions, support policy, and release notes.

### 10.3 Signing and account security

- [ ] Use Google Play App Signing and a dedicated upload key outside Git.
- [ ] Keep two independent protected key backups and test recovery before
  external testing.
- [ ] Record upload and Play delivery certificate fingerprints separately.
- [ ] Enable 2FA and preserve verified recovery methods and the Play receipt in
  the private owner register.
- [ ] Never turn a debug APK into a release by copying or renaming it.

### 10.4 Immutable release record

The release evidence must bind:

- release ID, source commit and tag;
- clean-tree/source-review result;
- build recipe, container/environment digest and tool versions;
- every external input and component manifest hash;
- AAB SHA-256 and exact byte size;
- upload and delivery signing identities;
- permissions/components/native-library inventory;
- content, dictionary, embedding, asset, SBOM and notice results;
- automated, device, Play pre-launch and tester results;
- migration effects, data-flow decision and known limitations;
- promotion approval and forward-fix target.

Store this through the repository's release-manifest/evidence contract. Do not
rely on terminal history or one workstation as the record.

## 11. Phase 6 — quality assurance and release-candidate testing

### 11.1 Automated gate

- [ ] Repository structure and Markdown links green.
- [ ] All browser, server, game, Android, content-schema, progression,
  service-worker, route, and package contracts green.
- [ ] Locked Rust suite green.
- [ ] Setup-asset and embedding catalogs current and hash-valid.
- [ ] Android Lint has no errors; every remaining warning is reviewed.
- [ ] Store AAB validator and generated-APK validator green.
- [ ] Clean rebuild from the tagged source reproduces component hashes.

### 11.2 Physical-device matrix

Test at least one clean device at or near API 30, one common intermediate
version, and one API 36 device or official equivalent. Include a representative
low-memory/low-storage phone.

- [ ] Install from Play internal testing with Play Protect enabled.
- [ ] First launch and complete setup.
- [ ] Slow, interrupted, cancelled, resumed, corrupt, and low-space downloads.
- [ ] Embedding-backed image retrieval and semantic statistics.
- [ ] Every included game, Czech speech, dictionary, navigation and Back.
- [ ] Airplane-mode/offline restart after setup.
- [ ] Background/resume, process death, reboot, and orientation changes.
- [ ] Progress/reward persistence, reset, and preview-to-release migration.
- [ ] Upgrade to a higher-code candidate without data loss.
- [ ] Font scaling, screen reader, switch/keyboard, reduced motion, contrast,
  small screen and large text.
- [ ] Confirm no Chat, model, generation, Godot, debug, preview, dead currency,
  or unfinished feature is visible or reachable.
- [ ] Uninstall removes app-private downloaded data as disclosed.

Every device run records app version, device/OS, AAB/generated APK identity,
steps, screenshots/logs, result, and unresolved defect.

### 11.3 Tester gate

- [ ] Recruit approximately 15 representative testers so at least 12 can
  remain continuously opted in.
- [ ] Give testers a short mission covering setup, embeddings, each enabled
  game, progression, restart/offline, and feedback through Play or support.
- [ ] Fix all crash, data-loss, blocked-setup, false-answer, inaccessible-core-
  flow, policy, and security defects before production.
- [ ] Record setup completion, repeat use, failed downloads, device coverage,
  usability findings, and the final production-access answers.

## 12. Phase 7 — Play Console, submission, and launch

### 12.1 First external cost and owner action

Create the personal Google Play developer account after Phase 1 locks the
permanent package ID and stripped store profile, and before final RC testing.
This is the first expected publication cost: Google's one-time US$25
registration fee.

The owner will need a dedicated or well-secured Google account, truthful legal
identity/address, verified phone/email, an accepted payment card, identity
verification documents if requested, and an Android device for verification.
A bank account is not needed while Caatuu is free and non-monetized.

New personal accounts must normally run a closed test with at least 12 testers
continuously opted in for 14 days before applying for production access.

### 12.2 Store package

- [ ] Reserve/register `com.waajacu.caatuu` and confirm it as permanent.
- [ ] Public developer name `Waajacu`; verified support email and website.
- [ ] Accurate title, short description, full description, category, and
  `v0.1.0` release notes. Do not advertise excluded AI generation or imply the
  initial setup is fully offline.
- [ ] Final 512×512 icon, 1024×500 feature graphic, and current phone
  screenshots showing only included release behavior.
- [ ] Stable HTTPS privacy, support, security, license/source and legal-notice
  pages.
- [ ] Ads declaration: no.
- [ ] App access: no login; disclose first-run setup requirements.
- [ ] Accurate Data Safety form.
- [ ] Target audience/Families declarations and IARC content rating.
- [ ] No in-app products or billing declaration for `v0.1.0`.

### 12.3 Track progression

1. Upload the signed, validated AAB to Play internal testing.
2. Resolve Play processing, policy warnings, pre-launch report findings, device
   compatibility issues, and signing/certificate records.
3. Promote the same approved bytes to closed testing.
4. Keep at least 12 testers opted in continuously for 14 days if the account is
   subject to the new-personal-account requirement.
5. Apply for production access with evidence-based answers.
6. Resolve review findings without weakening release gates.
7. Promote the approved bytes through a small staged production rollout.
8. Monitor crashes/ANRs, reviews, setup/support reports, hosting health, and
   policy mail before increasing the rollout.

Android rollback is a stop-rollout and forward-fix operation. Do not downgrade
installed users: publish corrected code with a higher `versionCode`.

## 13. Production definition of done

`v0.1.0` is releasable only when every item below is true:

- [ ] One clean, reviewed, pushed, tagged source commit reproduces the release.
- [ ] The release catalog is the authority for every enabled game and asset.
- [ ] Every included content record has stable identity, schema validation,
  exact-hash review, and cleared rights.
- [ ] Progression, rewards, reset, migration, and statistics pass their
  invariants across every enabled game.
- [ ] The signed Play AAB and generated APKs contain no LLM or Godot capability,
  code, catalog, route, or artifact.
- [ ] Required embeddings, image retrieval, semantic statistics, dictionary,
  speech, and offline use work after setup.
- [ ] Mandatory setup size and recovery behavior are accepted and disclosed.
- [ ] Every included dependency/data/art notice and corresponding-source link
  is complete and accessible.
- [ ] Privacy, Data Safety, Families, target audience, content rating, support,
  and security statements match measured behavior.
- [ ] Production hosting is immutable, HTTPS, hash-verified, monitored,
  recoverable, and independent of the original workstation.
- [ ] Full automated, physical-device, Play pre-launch, and tester gates are
  green with no unresolved release-blocking defect.
- [ ] Signing keys, account recovery, domain, release records, current and
  previous artifacts, and incident procedure are recoverable.
- [ ] The app remains free with no ads, purchases, donation prompt, dead shop
  UI, or unsupported product claim.
- [ ] The release owner records explicit production approval.

## 14. After launch

- Monitor Android vitals, Play policy messages, support email, GitHub issues,
  download/setup failures, hosting health, and certificate/domain expiry.
- Triage crashes, data loss, false content answers, inaccessible flows,
  security reports, and child-safety/privacy issues first.
- Retain release evidence and the ability to issue a higher-version-code
  forward fix.
- Review anonymized, voluntarily supplied tester/support findings; do not add
  analytics silently.
- Plan `v0.1.1` only from observed defects and small improvements.
- Open LLM reintroduction, Godot integration, additional planets, accounts,
  community, donations, or custom-object sales as separate gated milestones.

## 15. Owner action and cost triggers

| Trigger | Owner action | Expected direct cost |
| --- | --- | --- |
| Store profile and permanent package ID locked | Create/verify personal Play developer account | US$25 one time |
| Closed-test candidate ready | Recruit and retain at least 12 active testers for 14 continuous days if required | No required Play fee; possible voluntary testing costs |
| Durable production asset host chosen | Create provider account and approve its operating budget | Provider-dependent; prefer a measured low-cost tier |
| Qualified Czech/content review begins | Approve reviewer, scope, confidentiality, and payment if not volunteered | Scope-dependent |
| App remains free | No payout bank or merchant setup | None |
| Custom objects or other digital goods approved later | Create merchant/payments profile, verify bank/tax path, integrate Play Billing | Jurisdiction/provider/service-fee dependent |
| Waajacu becomes a legal organization later | Verify entity, D-U-N-S/account requirements, and convert or transfer formally | Jurisdiction-dependent; not a `v0.1.0` blocker |

The project should not pay the Play registration fee merely to compensate for
an undefined package. The payment moment is after the stripped store profile
exists and before internal-track release work begins.

## 16. Governing references

Repository contracts:

- [`PRODUCT_READINESS.md`](PRODUCT_READINESS.md)
- [`FIRST_ANDROID_RELEASE.md`](FIRST_ANDROID_RELEASE.md)
- [`RELEASING.md`](RELEASING.md)
- [`DEPLOYMENT_STANDARD.md`](DEPLOYMENT_STANDARD.md)
- [`COMPONENT_RELEASE_VALIDATORS.md`](COMPONENT_RELEASE_VALIDATORS.md)
- [`GAMES.md`](GAMES.md)
- [`LEGAL_INVENTORY.md`](LEGAL_INVENTORY.md)
- [`LICENSING.md`](LICENSING.md)
- [`PRIVACY.md`](PRIVACY.md)
- [Android build documentation](../apps/android/README.md)
- [Android tooling](../apps/android/tooling/README.md)

Current official Google/Android references:

- [Create a Play Console account and registration fee](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en)
- [Personal and organization account information](https://support.google.com/googleplay/android-developer/answer/10840893?hl=en)
- [New personal account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Target audience](https://support.google.com/googleplay/android-developer/answer/9867159?hl=en-EN)
- [Families policy](https://support.google.com/googleplay/android-developer/answer/9893335?hl=en)
- [Content rating](https://support.google.com/googleplay/android-developer/answer/9859655?hl=en)
- [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
- [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en)
- [Store listing asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en)
- [Payments and digital goods](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en)

Policy, costs, and account requirements can change. Recheck the official pages
when the relevant owner-action gate opens and again before production
submission.
