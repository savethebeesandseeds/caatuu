# Traveler macaw walking cycle

This is the first browser-prototype walking cycle for the traveler macaw.

- `originals/macaw-walk-sheet-v1.png` is the generated 4-by-2 source sheet.
- `side/macaw-walk_001.png` through `macaw-walk_008.png` are transparent,
  bottom-aligned frames on identical 420-by-440 canvases.
- `animation.json` records frame order, source facing, mirroring, anchor, and
  distance-based cadence.

The sheet was processed with the object-aware workflow documented at
`C:\Work\tukevejtso\linux\scripts\images\SPRITE_SPLIT_REPACK.md` inside the
Tukevejtso container. The final split produced eight alpha-masked sprites with
no manifest warnings. The temporary split manifest and previews remain in the
ignored Tukevejtso image workspace and are not active game assets.
