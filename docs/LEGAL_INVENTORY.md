# Caatuu legal and provenance inventory

Last reviewed: 22 July 2026
Baseline commit: `0714ab3fe036c36b4061c419464a8332218b6075`

This is a working release-control inventory, not legal advice and not a license.
It grants no rights. A `STOP-SHIP` entry is a conservative Caatuu release
decision while evidence is incomplete; it is not a claim that the material is
unlawful.

## Status legend

- `CLEAR`: evidence is present and no additional release action is known.
- `CLEAR-WITH-NOTICE`: redistribution is expected to be possible if the listed
  attribution or license material is shipped.
- `REVIEW`: evidence exists, but scope or lineage needs a deliberate review.
- `STOP-SHIP`: exclude from product distribution until the stated gate is met.
- `NOT-DISTRIBUTED`: development material that must remain outside release
  packages.

## First-party scope

| ID | Material | Evidence | Release status | Required action |
| --- | --- | --- | --- | --- |
| FP-001 | Rust runtime | Root [`AGPL-3.0-only`](../LICENSE); prior MIT text preserved at [`apps/runtime/LICENSE-MIT-HISTORICAL`](../apps/runtime/LICENSE-MIT-HISTORICAL) | `CLEAR` for current first-party code | Maintain the private ownership register and preserve permissions already granted for historical MIT versions |
| FP-002 | Czech browser app, Android shell, unified launcher, ML tools, demos, and repository developer documentation | Root [`AGPL-3.0-only`](../LICENSE), scoped by [`LICENSING.md`](LICENSING.md) | `CLEAR` for first-party code | Keep product notices, package metadata, and the network corresponding-source offer aligned |
| FP-003 | Caatuu and Waajacu names, logos, domains, and Android package identity | No published brand policy | `REVIEW` | Publish a separate, owner-approved brand policy; do not imply that the code license grants brand rights |
| FP-004 | External contributions | No inbound contribution policy | `STOP-SHIP` | Do not merge outside code, data, models, or art until contribution terms are published |
| FP-005 | Animated Fabric first-party source and developer documentation under [`apps/animated-fabric`](../apps/animated-fabric/) | Root [`AGPL-3.0-only`](../LICENSE); scoped upstream notices remain under [`tools/cutout`](../apps/animated-fabric/tools/cutout/) | `CLEAR` for first-party code | Keep third-party notices and model terms scoped separately in every distribution |

Real names, addresses, agreements, tax information, and ownership evidence
belong in a private ownership register outside this public repository.

## Third-party software

| ID | Component | Version or revision | Evidence | Release status | Required action |
| --- | --- | --- | --- | --- | --- |
| SW-001 | sql.js | 1.13.0 | Tracked MIT file at [`apps/languages/czech/static/vendor/sql.js/LICENSE`](../apps/languages/czech/static/vendor/sql.js/LICENSE) | `CLEAR-WITH-NOTICE` | Keep the MIT text in every web and Android distribution that contains sql.js |
| SW-002 | Transformers.js | 4.2.0 | Apache-2.0 text exists locally at `apps/languages/czech/static/vendor/transformers/LICENSE`, but the directory is not yet tracked | `STOP-SHIP` | Commit the exact source record and license with the bundled component |
| SW-003 | llama.cpp | `4fc4ec5541b243957ae5099edb67372f8f3b550e`, locally patched | Upstream MIT; ignored vendor checkout | `STOP-SHIP` for an APK containing `libllama` without its notice | Package the pinned upstream license and modification record in every APK/AAB |
| SW-004 | ONNX Runtime Web | `1.26.0-dev.20260416-b7804b056c` | Revision recorded in the embedding runtime manifest; upstream MIT | `STOP-SHIP` until notice is packaged | Add the exact MIT text beside the downloaded runtime and to the offline notice bundle |
| SW-005 | Rust and Android dependencies | Locked dependency graphs exist | Complete generated notice reports do not | `REVIEW` | Generate dependency inventories and ship all required notices |
| SW-006 | Three.js / GLTFLoader and Quaternius demo inputs | Local headers and CC0 records are incomplete or untracked | Demo provenance is incomplete | `NOT-DISTRIBUTED` outside development | Record exact sources, revisions, licenses, and modifications before publishing demos |
| SW-007 | Vendored and adapted Tukevejtso cutout engine | Source snapshot `e4990e59bfe2fa13be0e8f4d3e0355c8bd147169`; engine introduced at `906eefbc0314b2c0f02eda99c1310eb34c423dd9` | Source, copied modules, exclusions, and local modifications are recorded in [`UPSTREAM.md`](../apps/animated-fabric/tools/cutout/UPSTREAM.md); Waajacu's MIT text is retained in [`LICENSE.tukevejtso`](../apps/animated-fabric/tools/cutout/LICENSE.tukevejtso) | `CLEAR-WITH-NOTICE` for the identified source snapshot | Keep the complete Tukevejtso MIT notice and modification record with every source or container distribution containing this adapted engine; re-review any future upstream sync |
| SW-008 | TripoSR, PyTorch, PyMCubes, and the AF-045 reconstruction image dependency plane | TripoSR source revision `d26e33181947bbbc4c6fc0f5734e1ec6c080956e`; PyTorch `2.2.2+cu118` CPython 3.12 Linux wheel SHA-256 `c0fa31b79d2c06012422e4ed4ed08a86179615463647ac5c44c8f6abef1d4aec`; PyMCubes `0.1.6` CPython 3.12 Linux wheel SHA-256 `ea366a2064af0846093e0ad3f9035e375f4b14b62bb565c95dcc8dcaf78308a5`; exact local patches and retained notice in [`UPSTREAM.md`](../apps/animated-fabric/tools/reconstruction/UPSTREAM.md); container record in [`triposr.md`](../apps/animated-fabric/docs/third-party/triposr.md) | `NOT-DISTRIBUTED`; internal optional research image | Before any image distribution, generate a complete SBOM and notices, preserve corresponding source obligations, scan the image, and review every transitive dependency |

## Models, dictionaries, corpora, and embeddings

| ID | Artifact or lineage | Evidence | Release status | Required action |
| --- | --- | --- | --- | --- |
| DATA-001 | Czech–English Wiktionary/Kaikki dictionary | Exact source, dates, hashes, changes, and `CC-BY-SA-4.0 OR GFDL-1.3-or-later` are recorded in [`manifest.json`](../apps/languages/czech/static/data/dictionaries/kaikki-cs-en-2026-07-09/manifest.json) and [`ATTRIBUTION.md`](../apps/languages/czech/static/data/dictionaries/ATTRIBUTION.md) | `CLEAR-WITH-NOTICE` after files are tracked and packaged | Preserve attribution, applicable license terms, source links, and share-alike obligations in every distribution |
| DATA-002 | all-MiniLM-L6-v2 embedding runtime | Exact revision and Apache-2.0 model terms are recorded in its local manifest | `CLEAR-WITH-NOTICE` for the upstream model runtime; embedded content has separate status | Package its Apache text plus Transformers.js and ONNX notices |
| DATA-003 | Caatuu curriculum and asset vector database | Manifest identifies the source corpus and 431 image-asset records; “project-local” is not a license | `REVIEW` | Attest ownership and license the curriculum; clear every referenced asset before release |
| MODEL-001 | Active Word Sentence and Czech-to-English adapters | Base models are recorded as Apache-2.0; current training manifests point to curated Caatuu lanes | `REVIEW` | Add explicit licenses, owner attestation, pinned base revisions, and complete training-lineage cards for the derived artifacts |
| MODEL-002 | `qwen3-lora-003-hard` browser candidate | Base Qwen model is Apache-2.0; recorded training input includes a broad Czech seed corpus with Wikipedia and Gutenberg material | `STOP-SHIP` | Perform dataset-rights review or retrain from the cleared authored curriculum lane; do not describe the derived artifact as cleared merely from the base license |
| MODEL-003 | Legacy Planet Word Net models and training lanes | Training summaries include Gutenberg and Wikipedia rows; five raw František Omelka ebooks explicitly state that they are copyrighted and were posted with permission | `STOP-SHIP` | Review the specific permission scope with qualified counsel or retrain without the disputed sources; replace the current base-license-only artifact label |

| MODEL-004 | ZhengPeng7/BiRefNet optional cutout model | Immutable revision `e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4`; upstream MIT text retained in [`LICENSE.birefnet`](../apps/animated-fabric/tools/cutout/LICENSE.birefnet) and the integration is recorded in [`UPSTREAM.md`](../apps/animated-fabric/tools/cutout/UPSTREAM.md) | `NOT-DISTRIBUTED` by Caatuu; weights are not bundled and require an explicit provisioning action | Keep provisioning explicit and revision-pinned; keep weights out of source and release packages; if Caatuu later redistributes a cache or weights, record hashes and package the MIT notice after a new release review |
| MODEL-005 | TripoSR checkpoint and DINO architecture configuration for AF-045 | TripoSR revision `5b521936b01fbe1890f6f9baed0254ab6351c04a`; DINO revision `f205d5d8e640a89a2b8ef0369670dfc37cc07fc2`; exact runtime-file sizes and hashes in [`model-manifest.json`](../apps/animated-fabric/tools/reconstruction/model-manifest.json); operational boundary in [`RECONSTRUCTION_LAB.md`](../apps/animated-fabric/docs/RECONSTRUCTION_LAB.md) | `NOT-DISTRIBUTED`; separately provisioned internal model volume, and generated meshes remain unapproved proposals | Keep weights and candidates out of Git, releases, and public CI; review exact model and generated-output terms again before any redistribution or candidate publication |

## Visual and generated assets

The repository contains hundreds of images and additional untracked release
candidates. Existing READMEs often record the generation or editing workflow,
but do not consistently establish author, generator terms, source, rights
holder, or redistribution permission.

Until a provenance register exists, any image, animation, font, audio file, or
generated asset without a complete evidence row is `STOP-SHIP` for a public or
paid release. A complete row needs:

- stable asset identifier and path;
- author, generator, or provider;
- source URL or private evidence identifier;
- creation or retrieval date;
- license or owner-approved grant;
- material modifications;
- required attribution; and
- the release surfaces that contain it.

| ID | Material | Evidence | Release status | Required action |
| --- | --- | --- | --- | --- |
| VIS-001 | Four AF-052 procedural directional walk phase-zero golden PNGs under `apps/animated-fabric/tests/golden/af052_blender_walk_*_t0000.png` | Author/provider, generator and source identities, creation date, exact hashes, modifications, review purpose, distribution surfaces, and no-attribution decision are recorded in [`af052_blender_walk.provenance.json`](../apps/animated-fabric/tests/golden/af052_blender_walk.provenance.json); owner-approved [`CC0-1.0`](../apps/animated-fabric/tests/golden/LICENSE-AF052-CC0.md) dedication | `CLEAR` for public source and unrestricted reuse | Keep the four PNG hashes, provenance record, and scoped CC0 notice synchronized; do not infer these terms for any other visual asset or for the Blender container |
| VIS-002 | Eight approved AF-054 traveler-macaw PNG identities under `apps/animated-fabric/assets/reference-packages/macaw-traveler-v1/` | Caatuu owner confirmation records that the character material was created from scratch and authorizes open reuse under evidence ID `CAATUU-AF054-OWNER-APPROVAL-2026-07-22`; the separately supplied decision is preserved in [`review/source-approval.json`](../apps/animated-fabric/assets/reference-packages/macaw-traveler-v1/review/source-approval.json); exact paths and hashes, authoring/provider records, embedded-but-unverified C2PA claim IDs, dates, transformations, source commit, and release surfaces are in [`reference.json`](../apps/animated-fabric/assets/reference-packages/macaw-traveler-v1/reference.json); [`approval.json`](../apps/animated-fabric/assets/reference-packages/macaw-traveler-v1/approval.json) binds the decision to the exact manifest and ordered view set; scoped [`CC0-1.0`](../apps/animated-fabric/assets/reference-packages/macaw-traveler-v1/LICENSE-CC0.md) notice | `CLEAR` for only the eight exact PNG hashes named by the scoped notice | Preserve the byte-identical generated sheets and their embedded claims; keep the package validator, hashes, approval, and notice synchronized; do not infer clearance for other macaw art, JSON, future meshes, textures, animation, or renders |
| VIS-003 | AF-055 repository-generated geometric actor neutral golden at `apps/animated-fabric/tests/golden/af055_actor_fixture_neutral.png` | Exact SHA-256 `e0c02f7af9371fb84a6695ff92bf298e1a955db2238266865d4d76bd09174880` and generation lineage in [`af055_actor_fixture_neutral.provenance.json`](../apps/animated-fabric/tests/golden/af055_actor_fixture_neutral.provenance.json); path-and-hash-scoped [`CC0-1.0`](../apps/animated-fabric/tests/golden/LICENSE-AF055-CC0.md) dedication | `CLEAR` only for the exact tracked PNG path and hash | Keep the golden, provenance record, and scoped notice synchronized; do not infer these terms for the GLB, texture, workspace render, actor manifest, validation report, or Blender |
| VIS-004 | AF-055 generated geometric fixture and neutral-render workspace evidence | Tracked provenance records the ignored outputs `actor.glb` SHA-256 `e3079588a75b9553609ee41939119cd00b119e750706e29426eafc472f2bafa3`, `textures/albedo.png` SHA-256 `fd6abcd872a1f4ada38e541352dfac74452597072fc5fea5d9ad5450a01e94e6`, and `neutral.png` SHA-256 `e0c02f7af9371fb84a6695ff92bf298e1a955db2238266865d4d76bd09174880`; actor manifest SHA-256 `1539adf989faee41bdb6b20a2bc46a04dfb95a3ff5c171d6b9175a68d04eec7c` binds content-set SHA-256 `a84df998d86644671bcbde1f1723132fd1f2b3fac8288ed28debac8f9cb245c4` in [`af055_actor_fixture_neutral.provenance.json`](../apps/animated-fabric/tests/golden/af055_actor_fixture_neutral.provenance.json) | `NOT-DISTRIBUTED`; recorded as reproducible internal validation identities, not as a publication grant | Keep the raw package, texture, render, and validation report out of public CI artifacts and releases; this geometric record does not extend AF-054 clearance to any macaw mesh, texture, package, animation, or render |

## Distribution gates

The following surfaces must be checked independently because they do not carry
the same files:

- public GitHub source;
- browser deployment;
- APK and AAB;
- downloadable models, dictionaries, and embedding packs;
- container images; and
- demos and media exports.

No private beta build may be distributed until:

1. the first-party AGPL scope, UI notice, and corresponding-source offer remain aligned;
2. every included file has a provenance decision;
3. required license and attribution texts are accessible offline;
4. `STOP-SHIP` artifacts are absent from the package and download catalog;
5. the APK/browser notice bundle is checked automatically;
6. privacy and security disclosures match actual behavior; and
7. the release record contains its source commit, version, hash, signer, test
   result, and known limitations.

## Evidence still to build

The durable inventory should eventually use machine-readable records with, at
minimum: identifier, type, path, author/provider, source, revision, SHA-256,
SPDX-style license expression, local license-text path, modifications,
training/input lineage, distribution surface, required notices, evidence
status, release decision, reviewer, and review date.
