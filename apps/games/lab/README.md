# Caatuu lab

The lab is a local playground for the existing character and scenery assets.
Use the established Caatuu service on port 8765 with
`ENABLE_CAATUU_GAME_PREVIEW=1`.

| Route | Source |
| --- | --- |
| `/games/lab` | [Experiment hub](index.html) |
| `/games/lab/motion` | [Curated character workshop](../caatuu-game/character-workshop/README.md) |
| `/games/lab/scenary` | [Scenery page](scenary/index.html) |

`scenary` is the maintained URL spelling; the page label is Scenery. Open
<http://127.0.0.1:8765/games/lab>. The former
`/games/caatuu-game/godot-v1/review/macaw-walk-v1/` entry redirects to Motion.
These routes read the canonical source files directly. Validate a source
change, then refresh the page; no publisher or Godot export is needed. The
optional workshop snapshot is separate from the live lab. Pages use the local
preview gate and `noindex`; the lab is outside Godot, Android and Pages packaging.

## Scenery and movement

[scene.mjs](scenary/scene.mjs) loads the same 55 curated macaw PNGs and manifest
as Motion, plus the canonical [scenery catalog](../../launcher/static/assets/scenery/metadata/catalog.json),
[world layout](../../launcher/static/assets/scenery/metadata/world.json) and
runtime images under `/assets/scenery/images/`. It preserves the shared
512-square frame canvases and their 480-pixel ground baseline. Do not copy or
regenerate these assets to change the playground.

Click or tap to choose a destination; another click replaces the route. Trees,
stones and boundaries use the catalog collision profiles. Blocked or
unreachable targets resolve to a clear reachable spot, and the initial spawn
is resolved onto the navigation grid. “Back to start” plans a route home.
The view selector switches between the whole grove and a camera following the
macaw.

Movement uses route distance, including detours. A nonzero route shorter than
2.6 world units walks at 1.55 world units per second; a route of 2.6 or more
runs at 3.6. The action is selected once per new route and remains selected until
arrival, then returns to standing.

- [navigation.mjs](scenary/navigation.mjs): `planRoute` owns the distance
  threshold; `advanceRoute` owns movement speed. `buildNavigation` derives the
  36 × 36 collision grid with 0.3 clearance and prevents diagonal corner cutting.
  `project`, `unproject` and `directionFor` share the 45°/30° camera projection.
- [scene.mjs](scenary/scene.mjs): `updateCamera` owns pixels per world unit and
  the follow zoom; `drawMacaw` sets the full-canvas width to `camera.unit * 2.1`.
  It plays four walking poses at 6 fps or six running poses at 10 fps. Tune
  visual size here without resizing the accepted PNGs.
- [lab.css](assets/lab.css): page layout, canvas viewport and responsive controls.

## Validation

Run the focused tests in the existing development container:

```powershell
docker exec -w /workspace caatuu-dev node --test apps/games/lab/tests/navigation.test.mjs apps/games/caatuu-game/tooling/tests/character-workshop.test.mjs apps/games/test/game-catalog-contract.test.mjs
```

The September 6, 2026 checks passed 9 navigation tests, 7 workshop tests,
28 route tests and 4 game-catalog tests. Browser review confirmed short-walk
arrival, longer running trips, retargeting, the follow camera and the old-URL
redirect, with no browser errors. The user's 674 × 879 viewport was checked in
both whole-grove and follow views, including click coordinates.
After movement or rendering changes, repeat these interactions in the browser;
passing data tests does not establish animation quality or final art approval.
