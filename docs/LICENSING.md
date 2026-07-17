# Caatuu licensing

Last reviewed: 16 July 2026

## First-party software

Unless a file or directory says otherwise, Caatuu's first-party software and
developer documentation are licensed under the
[GNU Affero General Public License, version 3 only](../LICENSE) (`AGPL-3.0-only`).

Copyright (C) 2025-2026 Caatuu contributors.

This includes the first-party source for the browser app, Android shell, Rust
runtime, unified launcher, ML tooling, demos, and Animated Fabric. The AGPL is
a software license: it permits commercial use, modification, and distribution
subject to its terms, including the corresponding-source obligations for
modified versions used through a computer network.

The software is provided without warranty, as stated in the license. The
corresponding source for the version operated by Caatuu is available at
<https://github.com/savethebeesandseeds/caatuu>.

## Material with separate terms

The root AGPL does not replace or override separate terms for:

- third-party software and vendored dependencies;
- base-model weights, adapters, merged weights, and quantizations;
- dictionaries, datasets, corpora, and generated databases;
- images, animation, audio, fonts, and other artwork; or
- the Caatuu and Waajacu names, logos, domains, and package identity.

Those materials are governed by their own license files, manifests, notices,
and provenance records. A base model's license does not automatically license a
derived adapter, its training data, or its generated artifacts. If no license
or permission is identified for excluded material, no permission should be
inferred merely because the material is visible in this repository.

The release evidence and unresolved items are tracked in
[`LEGAL_INVENTORY.md`](LEGAL_INVENTORY.md).

## Historical MIT versions

The initial repository commit, `0f6a4af679b10d76ebb04964761661e53e2d7dcf`,
included a root MIT license. Commit
`7963709d8c9793d8f026a5615fa949a4d79f95ad` moved that exact file to
`apps/caatuu-chinese`, and commit
`ae94d213aaf127b9a833b441b3fad9251d5ef62c` moved it to the Rust runtime.

Permissions already granted for versions distributed under MIT remain valid.
The prior runtime text is preserved at
[`apps/runtime/LICENSE-MIT-HISTORICAL`](../apps/runtime/LICENSE-MIT-HISTORICAL)
as historical evidence; it does not change the license of new first-party
runtime changes released under the root AGPL.

## Contributions and ownership

External contributions remain paused under [the contribution policy](../.github/CONTRIBUTING.md)
until the project publishes inbound terms compatible with its future operating
model. Real names, addresses, agreements, tax information, and ownership
evidence belong in the project's private ownership register, not this public
repository.
