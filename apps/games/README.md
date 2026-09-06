# Caatuu game concepts

The macaw adventure is a **paused concept**, preserved separately from the
current language-learning app. Start with the
[resume guide](lab/RESUME.md) for its saved state, assets and next steps.

## Retained concept

- [Local lab](lab/README.md): Motion and Scenery at
  <http://127.0.0.1:8765/games/lab>.
- [Character workshop](caatuu-game/character-workshop/README.md): selected macaw
  animations, editable strips and provenance.
- [World map workshop](lab/world-map/README.md): approved Sheltered Sea master,
  prompts and the plan for adjoining detailed sections.

The labs use the existing local server and
`ENABLE_CAATUU_GAME_PREVIEW=1`. They are noindex, source-backed review pages
outside the learning app, Android and public static packaging. No Godot export
is needed. The spelling `/games/lab/scenary` is intentional.

The older Godot implementation and export definitions are preserved in the
[legacy archive](../../archive/demos/caatuu-game-godot-v1/README.md).
They are no longer active source or reachable engine previews.

## Future standalone games

[catalog.json](catalog.json) is intentionally empty while the adventure is
paused. Concepts are not deliverable game entries. Keep the game schemas and
release guards for future implementations: an explicitly required game must
appear exactly once and meet all release and dependency-clearance checks.

Game source, engine configuration and build contracts belong under this
component. A future language adapter may describe and select a game, but must
not own its engine, build tooling or shared assets. Adding delivery to the
learning app or Android requires an explicit new integration decision.

Run the retained governance checks in the canonical development container:

```powershell
docker exec -w /workspace caatuu-dev node --test apps/games/test/*.test.mjs
```
