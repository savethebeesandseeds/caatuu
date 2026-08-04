# Game Source, Delivery, and Language Ownership

Status: accepted

Partially superseded by decision 0002 for the current standalone Caatuu Game.

Date: 2026-08-03

## Context

Caatuu's authored games are language-independent, but Memory Moon's generated
Web export was historically written below the Czech static application. That
made a reproducible delivery artifact appear to be Czech source and caused the
Android application to include the game only because it copied the complete
Czech static tree.

## Decision

- Authored game source lives under `apps/games/<game-id>`.
- Generated game exports live under
  `artifacts/games/<game-id>/<target>/<release-id>` and remain ignored.
- Browser delivery uses `/games/<game-id>/<release-id>/` independently of a
  language route.
- A language application owns only localized host presentation, navigation,
  curriculum bindings, and other punctual integration metadata.
- Android selects and validates game artifacts explicitly. It must not inherit
  them by recursively copying a language application.
- Game dependencies cannot use archived experiments as their authority.
- Component tests live beside their owner. Runtime retains only route and
  composition contracts.

During migration, `/cz/games/**` may serve the same physical artifact as
`/games/**`. It is a compatibility alias, never a second generated bundle.

A `local-preview-only` manifest may name a centralized catalog package whose
provenance or distribution review is incomplete. That dependency must remain
`preview-only` and cannot be promoted or distributed until its own authority
manifest is released.

## Consequences

Game source, generated delivery, and localization now have distinct owners.
Browser and Android builds must fail when a selected generated artifact is
missing or incomplete. Existing public URLs may be retained temporarily while
installed clients migrate.

Memory Moon remains `local-preview-only` until all of its distributed motion
and character inputs satisfy the repository's legal and provenance gates.
