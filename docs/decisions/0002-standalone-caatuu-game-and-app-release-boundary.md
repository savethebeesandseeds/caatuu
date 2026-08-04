# Standalone Caatuu Game and Application Release Boundary

Status: accepted

Date: 2026-08-03

## Context

The Godot world previously used the `memory-moon` identity and was embedded in
the Czech browser application, copied into Android, exposed through a Czech
compatibility route, and required by application publication gates. The game is
still an early preview, while the browser and Android application need an
independent release path. Memory Moon is an application concept and must return
to its static placeholder.

## Decision

- The authored game ID is `caatuu-game` and its source lives at
  `apps/games/caatuu-game`.
- Its ignored Web export lives at
  `artifacts/games/caatuu-game/web/godot-v1`.
- The game is standalone and browser-only. It has no language adapter, parent
  window messaging contract, Czech route alias, or Android asset delivery.
- The stable local URL `/games/caatuu-game/` redirects to the versioned
  `/games/caatuu-game/godot-v1/` export.
- The existing Caatuu runtime and port serve the preview. No repository,
  Compose project, runtime container, or port is added.
- `ENABLE_CAATUU_GAME_PREVIEW` controls the route. Application publication may
  proceed with it disabled. A public tunnel may expose it only after the
  explicit `caatuu-game` release-readiness gate passes.
- Memory Moon remains a static “Coming next” screen in the browser and Android
  application and contains no executable game integration.

## Consequences

Application builds do not depend on Godot artifacts or preview-only game
authorities. The game can continue browser-first development at a direct URL
without destabilizing the app. Re-embedding it later requires a new reviewed
language adapter, an embedded host contract, an Android delivery decision, and
release-cleared dependencies; none are implied by this preview.

This decision supersedes the Memory Moon-specific Android and Czech
compatibility portions of decision 0001. Its source and artifact ownership
rules remain in force.
