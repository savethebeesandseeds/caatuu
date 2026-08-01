# Caatuu deployment standard

Last reviewed: 1 August 2026

This document defines provider-neutral operational requirements for deploying
Caatuu. [`ARCHITECTURE.md`](ARCHITECTURE.md) owns component and route
boundaries; [`RELEASING.md`](RELEASING.md) owns channels, versioning, and
release gates; [`PRODUCT_READINESS.md`](PRODUCT_READINESS.md) owns current
status and blockers. Android-specific release evidence remains in
[`FIRST_ANDROID_RELEASE.md`](FIRST_ANDROID_RELEASE.md), and local Docker
commands remain in [`DEVELOPMENT.md`](DEVELOPMENT.md).

The words **must**, **must not**, **should**, and **may** are normative in this
document. Passing these deployment checks does not approve a release. Every
applicable release gate and product-readiness blocker must also be closed.

## Scope and invariants

A stable release point is a contract, not a particular vendor or server. It
consists of a stable HTTPS origin, immutable and traceable release objects,
small mutable channel pointers, and a tested recovery path.

Every public deployment must satisfy these invariants:

1. Delivery must not depend on a maintainer workstation remaining online.
2. Every release must identify one reviewed, clean source commit.
3. One release identity is built once. The same verified bytes may move between
   environments and compatible channel placements; promotion does not rebuild
   them. A channel transition that requires a different semantic version or
   tag creates a new release identity under [`RELEASING.md`](RELEASING.md).
4. Version-owned objects are immutable. Changed bytes require a new version.
5. Mutable channel pointers may reference only immutable objects whose size and
   SHA-256 have been verified at their final delivery location.
6. Payloads and component manifests are published first. Environment-dependent
   evidence and the final release manifest follow their checks. The channel
   pointer is published atomically and last.
7. Production must not read application code, static assets, or release bytes
   from a mutable development checkout or bind mount.
8. A deployment change must not silently enable accounts, analytics, feedback
   transmission, cloud sync, archived APIs, or another data-collecting feature.
9. Public statements about availability, privacy, support, and release maturity
   must match the deployed behavior.

## Required service boundary

The active product should keep the smallest possible network dependency.

| Capability | Required deployment behavior |
| --- | --- |
| Launcher, language UI, games, images, and curriculum | Serve as immutable static release content. |
| Android installer and updates | Serve a small mutable updater manifest plus immutable, signed APKs. Preserve the existing hostname and path contract for installed clients. |
| Models, dictionaries, embeddings, and setup assets | Serve versioned files or component catalogs with exact sizes and hashes. Clients verify before activation. |
| Browser inference and semantic search | Run locally after their static resources have been downloaded. |
| Browser dictionary | Either operate the current read-only search API continuously or replace it with a tested client-local/static implementation. |
| Feedback | Remain local-only unless a separately governed, durable receiver is deliberately enabled. Local processing may be intermittent; reliable reception may not be. |
| Archived Chinese backend | Remain opt-in and operationally separate from active Caatuu delivery. |

Static delivery, update delivery, and any optional dynamic service must be
independently replaceable. Failure of an optional API must not remove already
published installers or static learning content.

## Current migration direction

The first migration should separate delivery planes rather than move the whole
development Compose stack unchanged:

| Plane | Current fact | Clean target |
| --- | --- | --- |
| Static product and resources | The Rust runtime serves read-only bind mounts from the live local checkout through the local connector. Availability therefore depends on that workstation and its mutable files. | Assemble a channel-approved, version-owned web/resource bundle and publish it at a conforming HTTPS origin. Browser and installer availability then survives the loss of the workstation. |
| Release discovery and Android updates | Updater JSON and APKs are exposed through the same local runtime path. Existing installed clients constrain the hostname and compatibility aliases. | Keep the client-facing compatibility paths, but make each APK immutable and reduce mutable state to atomically replaced, hash-pinned channel/updater documents. |
| Dynamic Czech dictionary | The browser dictionary is the active feature that still needs the Rust API. | Either operate that narrow API whenever the browser feature is advertised, or replace it with a measured client-local/static implementation. An occasionally started server means occasional dictionary availability. |
| Feedback | Reports queue on the device and remote delivery is deliberately disabled by the privacy gate. | Keep remote delivery disabled until governance and durability pass. An intermittent receiver can drain only from clients that reconnect while it is reachable; it is not reliable reception and must not be described as such. |
| Demos and archives | Development routing currently exposes them from the workspace. | Decide their inclusion per channel and publish only the approved immutable subset; keep archived dynamic APIs separate and opt-in. |

Repository-forge links, tagged uploads, or any other familiar URL may be tested
as pieces of these planes. Their brand is not the trust decision: only the
origin-conformance results, stable client contract, and retained recovery copy
decide whether they are acceptable.

## Environments and channels

An environment describes where software runs. A release channel describes who
may receive an artifact. They are separate concepts; channel definitions remain
authoritative in [`RELEASING.md`](RELEASING.md).

| Environment | Reachability and state | Allowed artifacts |
| --- | --- | --- |
| Local | Loopback or explicitly trusted LAN only. State and credentials are disposable developer inputs. | Development and explicitly disclosed debug artifacts. |
| Staging | Restricted external access with storage, credentials, configuration, and mutable pointers isolated from production. | The exact production candidate bytes. |
| Production | Public delivery with durable state, monitoring, rollback, and named operational ownership. | Only artifacts approved for their declared channel. |

A public preview is still a production deployment operationally. Its product
label may describe incomplete software, but its download integrity, privacy
behavior, and operational limitations must remain truthful.

The publication validator follows the channel ownership in
[`RELEASING.md`](RELEASING.md): public preview requires reviewed source,
artifact integrity, verified public download, an explicit prerelease version,
and a verified debug signature on a debug/debuggable Android package when
Android is present. A gate that does not apply to preview may be recorded as
`not-applicable` with an honest limitation; a failed check blocks every public
channel. Beta and stable publication additionally require their complete
applicable gate set and release notes.

## Release identity and evidence ledger

One immutable release record must tie together the release ID, source commit,
tag, build recipe, build environment, tool versions, component manifests,
evidence, checks, migration effects, and known limitations.

The tag must be `v<release_id>`. Source identity records both the Git object
algorithm and its lowercase digest. The recorded build timestamp must not be
later than the release timestamp.

`build.environment` identifies a canonical retained build-environment
descriptor; `build.environment_sha256` is the SHA-256 of that descriptor's
exact bytes. Build-provenance evidence must bind the release ID, source
revision, environment identity and digest, and every external input by logical
ID and SHA-256. Its `external_inputs` must include `build-environment` with the
same digest. A mutable image tag or unrecorded package repository is not a
reproducible input.

The version 1 contract consists of:

- the [immutable release-manifest schema](schemas/release-manifest.v1.schema.json);
- the [mutable channel-pointer schema](schemas/release-channel.v1.schema.json);
- an [example immutable release](examples/release-manifest.v1.example.json);
- an [example channel pointer](examples/release-channel.v1.example.json); and
- the dependency-free
  [`validate-release-manifest.mjs`](../tools/repository/validate-release-manifest.mjs)
  validator used by repository CI.

The JSON Schemas are structural interchange descriptions. The JavaScript
validator is normative for semantic relationships, publication policy,
cross-document integrity, and filesystem safety. Normal validation recursively
opens every referenced file, rejects symbolic links and directory escape, and
checks exact bytes and SHA-256. `--structure-only` is documentation and authoring
mode; it must never be used to approve publication.

The checked-in examples are synthetic structural illustrations. Their
referenced files do not exist and their placeholder reviews are not release
evidence, so they are valid only with `--structure-only`.

The immutable release manifest is a manifest of component manifests. It does
not duplicate Android, model, dictionary, embedding, or setup-asset metadata
owned by their component contracts. Each reference records the expected
external contract, relative path, media type, exact bytes, and SHA-256. Some
current legacy component files do not self-identify; the top-level declaration
therefore names the contract applied by release automation. The root validator
checks that mapping and a minimal legacy envelope. The component owner's own
validator must additionally prove that its catalog closes over every payload.
Only those checks together establish transitive integrity.

Referenced JSON evidence uses a minimal common envelope: `evidence_id` must
match the top-level evidence ID, and evidence that substantiates a release check
must record the same `status`. Signature evidence additionally records its
subject, certificate SHA-256, signed artifact SHA-256, and one or more signature
schemes. Source-review evidence binds the revision and tag; build-provenance
evidence binds the fields described above. Structured component manifests and
check evidence must use a JSON media type. Plain-text notices and checksum lists
are the only check-evidence exceptions. This envelope binds a claim to a file;
it does not replace the check-specific audit format or the package verifier that
produced the result.

The tracked [component release-validator registry](COMPONENT_RELEASE_VALIDATORS.md)
maps each v1 component contract to its current owner and executable checks. A
row marked as lacking payload-closure validation is a release blocker, not
permission to rely on the top-level envelope alone.

The release manifest is not the Android updater manifest. Existing
`caatuu.json`, `caatuu-preview.json`, and compatibility paths remain separate
client-facing contracts. Adding the release evidence ledger must not change
their fields, origin rules, caching rules, or installed-client behavior.
Version 1 represents the current direct-download Android updater contract. A
store-distributed AAB needs a new Android component contract that retains the
package, signature, and device gates; it must not be disguised as `other`.

Channel pointers are deliberately separate from immutable releases. A pointer
records a channel and the size and hash of one release manifest. The same
release bytes may therefore be evaluated or promoted between compatible
channels without changing the release record.

Validation proves that a record is structurally coherent. It does not prove
that a recorded review happened or that a legal, privacy, security, or product
gate is satisfied. Those claims require the evidence referenced by the record.

Version 1 does not cryptographically sign the top-level release manifest or
channel pointer. It relies on HTTPS, origin access control, create-only object
publication, recorded hashes, and the existing package-specific signing rules.
An Android signature proves package lineage; a digest proves byte consistency.
Neither proves who authored a mutable pointer if the origin itself is
compromised. A future signed-attestation or signed-pointer contract may add that
stronger property without pretending it exists today.

## Artifact and origin contract

Each release should contain the smallest approved content set:

- a web bundle produced from an explicit, channel-specific route allowlist;
  routes currently described in [`ARCHITECTURE.md`](ARCHITECTURE.md), including
  `/demos/` and `/archive/chinese/`, are not included automatically and require
  a deliberate release decision; secrets, raw sources, and unapproved assets
  are always excluded;
- an immutable runtime image or package when a dynamic runtime is required;
- signed, versioned Android packages and their client-facing updater manifests;
- versioned component catalogs for models, data, dictionaries, embeddings, and
  setup assets; and
- release notes, notices, software bill of materials, provenance, test results,
  and other required evidence.

The delivery origin must:

- use valid HTTPS and retain the stable client-facing hostname during a
  compatible migration;
- return channel and Android updater JSON directly rather than through a
  redirect;
- support `GET` and `HEAD`, exact content lengths, and byte-range downloads for
  large or resumable artifacts;
- use `no-store` for mutable pointers and aliases;
- use long-lived immutable caching for version-owned objects;
- prevent overwrite of a previously published version-owned path; and
- allow atomic replacement of a small mutable pointer after verification.

Immutable payloads and mutable pointers may use separate delivery systems if
each system satisfies the requirements that apply to it. A familiar link or a
tagged upload is not evidence of conformance by itself. Before any origin is
approved, retain one provider-conformance record that demonstrates:

1. direct HTTPS `GET` and `HEAD` responses without an unexpected redirect;
2. exact public content length and SHA-256 after a fresh download;
3. correct byte-range behavior for every artifact class that requires resume;
4. `no-store` behavior for pointers and immutable caching for versioned bytes;
5. a rejected overwrite attempt against an existing version-owned path;
6. atomic pointer replacement, observed by a reader that never receives a
   partial document or an unreferenced intermediate state; and
7. control-plane protection: least-privilege publisher roles, a protected
   mutation path, multifactor authentication and account recovery, credential
   rotation, retained mutation audit logs, and tested publisher revocation.

Release-owned references use standard URL resolution relative to the JSON
document that contains them. They are relative, traversal-free paths, which
keeps the immutable directory byte-identical when restored to another
conforming origin. A channel reference must include its release ID as an exact
path segment. Because parent traversal is forbidden, the channel document must
live in a directory that is an ancestor of the version-owned release directory,
for example `private-beta.json` beside `0.2.0-beta.1/release.json`. Current
absolute Android update URLs remain a compatibility exception until a
deliberate client migration changes that contract.

## Publication and promotion

Publication must follow this order:

1. Freeze and review one clean source commit and tag.
2. Build in a pinned environment and record its exact identity.
3. Sign where the channel requires it, audit, hash, and measure every generated
   artifact.
4. Generate and validate component manifests and all evidence that can be
   completed before deployment.
5. Upload payloads, component manifests, and finalized pre-deployment evidence
   with create-only version-owned paths.
6. Fetch those public objects and verify size, hash, redirects, headers, cache,
   and range behavior at their final delivery locations.
7. Deploy the exact candidate bytes to isolated staging and run the applicable
   automated, package, physical-device, privacy, and public-download checks.
8. Finalize and upload the immutable post-deployment evidence records for those
   checks at previously unused create-only paths.
9. Generate the top-level release manifest only after every recorded check has
   happened. Run the normative validator over the complete local release tree,
   run each component-owner validator, then upload the manifest create-only.
10. Fetch the public release manifest and verify its exact size and hash.
11. Record explicit promotion approval.
12. Atomically publish the mutable channel pointer or updater manifest last.
13. Verify the public channel from outside the deployment environment and
    retain the completed deployment record.

Structural validation of an incomplete tree is useful while authoring, but it
cannot substitute for steps 6 through 10 and cannot authorize step 12.

A deployment record must identify the environment, channel, release ID,
operator or automation identity, timestamp, previous release, pointer changes,
verification results, approval, and rollback target. Deployment records are
append-only operational evidence; they are not reconstructed from current
directory contents.

## Rollback

Rollback must never modify an immutable release:

- Web, runtime, and catalog rollback changes a mutable pointer to a retained,
  compatible release and verifies it again.
- Stateful services use backward-compatible migrations and a separately tested
  data-restore procedure.
- Android cannot be reliably downgraded on installed devices. Stop promotion if
  necessary, then publish reverted code as a newly signed release with a higher
  `versionCode`.

The current and previous approved releases must remain available for recovery.
Retention may be longer where installed clients or legal evidence require it.

## Configuration and secrets

Build-time and runtime configuration must be separate, documented, validated,
and fail closed. Public origins, environment identity, release identity,
feature flags, trusted origins, storage durability, logging, and compatibility
versions must not be scattered as undocumented constants.

Production must not depend on ignored workstation `.env` files. Credentials
must be scoped per environment and purpose, injected outside Git and release
artifacts, redacted from logs, inventoried, and covered by a rotation procedure.
Signing-key custody and backup-count policy remain authoritative in
[`RELEASING.md`](RELEASING.md) and
[`FIRST_ANDROID_RELEASE.md`](FIRST_ANDROID_RELEASE.md). Deployment readiness
additionally requires a successful restore drill before an external beta.

## Optional dynamic services and data

Any dynamic service must expose a narrower contract than the static release
surface and must declare its state and durability requirements.

Remote feedback remains disabled until the privacy and operational gates are
complete. If enabled later, a receiver must validate a versioned schema,
deduplicate by a stable client report ID, acknowledge only after durable
storage, enforce abuse controls, and preserve defined retention and deletion
behavior. Existing device-local reports must not begin transmitting without
new authorization consistent with [`PRIVACY.md`](PRIVACY.md).

The current browser dictionary API is the only active Czech feature that
requires a dynamic application service. Removing it requires measured browser
storage, startup, memory, offline, and mobile testing of the replacement rather
than assuming that a large local database will work everywhere.

## Operations and continuity

Each dynamic runtime must provide:

- liveness for process health;
- readiness for required configuration, catalogs, and durable stores;
- a version response identifying environment, release ID, source commit, and
  release-manifest digest; and
- structured logs that carry release and request identity without leaking
  feedback content or secrets.

External checks must cover the launcher, one active language route, the channel
pointer, one immutable artifact, TLS, and every enabled dynamic API. Alert
ownership and honest availability objectives must be declared before beta.

Recovery must begin from a clean clone and retained release records, not from a
particular workstation. Before beta, inventory all durable state and define
recovery objectives, backup locations, encryption, custodians, restore steps,
and drill cadence for channel state, feedback if enabled, configuration, DNS or
ingress records, and signing keys.

## Acceptance criteria

Deployment standardization is complete only when every applicable control below
has an objective pass result. The deployment record must name the responsible
person or automation identity, mark applicability, cite the exact procedure,
and retain the evidence location. `Not applicable` requires a reason; an empty
cell or an unverified assertion is not a pass.

| Control | Applicability and accountable role | Objective pass procedure | Retained evidence |
| --- | --- | --- | --- |
| Reproducible candidate | Every release; release operator | On a clean machine, check out the recorded tag and run the manifest's canonical command with its recorded external inputs. Component manifests and payload hashes must equal the candidate. A nondeterministic difference is a failed gate, not an allowed rebuild during promotion. | Version-owned `evidence/reproducibility.json` |
| Complete integrity chain | Every public release; release automation owner | Run the validator without `--structure-only`, then run every component-owner validator. No missing file, symlink, path escape, byte-count, digest, contract, or payload-closure error is allowed. | Version-owned integrity and component-validation records |
| Origin conformance | Before first use, after delivery-system changes, and spot-checked each release; operations owner | Execute the seven origin checks in this standard, including delivery behavior and publisher control-plane protection. | Append-only provider-conformance record plus release download and access-control evidence |
| Workstation independence | Every public environment; operations owner | Turn off or disconnect the build workstation and local development server, then pass external launcher, installer, channel, artifact, and enabled-API checks. | Dated external-check record |
| Environment isolation | Staging and production; operations owner | Compare credential IDs, writable stores, and pointer paths. No credential, writable store, or mutable pointer resource may be shared. | Redacted environment inventory |
| Build-once promotion | Every promotion; release operator | Compare the source release record and all version-owned hashes before and after. Only the approved pointer may change, and only between channels compatible with that release identity. | Before/after pointer and hash record |
| Rollback and forward-fix | Before beta and after incompatible changes; operations and Android owners | Exercise web/runtime/catalog pointer rollback. For Android, exercise the documented stop-promotion and higher-`versionCode` forward-fix procedure. | Drill record with recovery time and result |
| Runtime observability | Each enabled dynamic runtime; runtime owner | The deployment record names the liveness, readiness, and version endpoints and their response contract. External checks must prove correct release identity and alert routing. | Endpoint contract, check output, and alert receipt |
| Feedback durability | Only when remote feedback is enabled; feedback-service owner | Submit a uniquely identified report, replace the process, container, and host, then prove one durable, deduplicated record remains. If this is not a pass, transmission stays disabled. | Privacy-approved durability drill record |
| Recovery without the workstation | Before beta and on the declared drill cadence; operations and signing-key custodians | Restore retained releases, channel state, configuration, ingress or DNS records, and signing access according to their authoritative policies without the original machine. | Restore log and custodian approval |
| Deliberate publication surface | Every release; release and legal owners | Compare the channel route/package allowlist with [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`LEGAL_INVENTORY.md`](LEGAL_INVENTORY.md). Development, secret, raw-source, and unapproved content must be absent; any demo or archive route must be explicitly approved for that channel. | Published-file inventory and approvals |
| Truthful public claims | Every public deployment; product owner | Compare observed behavior with [`PRIVACY.md`](PRIVACY.md), [`RELEASING.md`](RELEASING.md), [`PRODUCT_READINESS.md`](PRODUCT_READINESS.md), the public [`README.md`](../README.md), [`CHANGELOG.md`](../CHANGELOG.md), every published security-reporting or support statement, release notes, and in-product labels. Resolve every mismatch before publication. | Signed review checklist with tested URLs and package IDs |
