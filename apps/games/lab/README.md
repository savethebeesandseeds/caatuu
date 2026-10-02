# Caatuu lab

Status: **paused adventure concept**. The [resume guide](RESUME.md) records the
saved work and next steps; [concept.json](concept.json) records its delivery
boundary. The current learning app remains separate.

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

The [world map workshop](world-map/README.md) preserves the selected Sheltered
Sea layout, generation prompts and the plan for adjoining detailed scenery.
It is an authoring folder for approved art and future movement masks.

## Scenery and movement

[scene.mjs](scenary/scene.mjs) loads the selected 45 walking/standing PNGs from
the [macaw source folder](assets/macaw/walk/README.md), plus the canonical [scenery catalog](../../launcher/static/assets/scenery/metadata/catalog.json),
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

Scenery uses the current 40 regenerated walking poses and five standing poses.
Every route walks until a running set is generated. The **Size** control changes
the macaw's dimensions and travel speed together. Standing uses its own relaxed,
planted-foot image with the same direction mirrors and baseline as walking.
The earlier 55-frame Motion workshop remains a historical reference.

Final source PNGs live in `assets/macaw/walk/images/`, with eight editable strips,
generation prompts, calibration and review previews beside them. Scenery reads
these files directly. The original videos remain in ignored
`artifacts/research/world-movement/source/macaw-walking/`. The four October 1–2
walking extraction/regeneration folders and the two temporary lab copies are
retired after promotion and hash verification. Earlier unrelated research stays
in place. Old `?walking=...` links still open the current Scenery entry.

Pose-guide preparation restores one source-camera scale per orientation rather
than fitting every pose separately. Registration uses the fixed image-canvas
scale. The maintained [normalizer](../caatuu-game/tooling/normalize-motion.py)
then applies one uniform direction factor to all eight walking poses and their
standing image, targeting a median 66,000 alpha-weighted pixels. Individual poses
retain their natural silhouette differences; inspect head and torso proportions
at a common display scale before approving the gait.

The measured side-profile stride is 273.397 pixels for two steps. At the regular
2.1-world-unit canvas size, eight poses at eight fps yield 1.121354 world units
per second. Half size gives half speed and the same cadence. Camera zoom cancels
from the conversion. Playback consumes actual route distance, including corners
and the partial final step; changing size mid-trip preserves the current phase.
See the [source guide](assets/macaw/walk/README.md#walking-speed-and-actor-size)
for equations, source measurements and the limits of average stride calibration.

- [navigation.mjs](scenary/navigation.mjs): `planRoute` owns routing;
  `advanceRoute` accepts the caller's calibrated speed. `buildNavigation` derives the
  36 × 36 collision grid with 0.3 clearance and prevents diagonal corner cutting.
  `project`, `unproject` and `directionFor` share the 45°/30° camera projection.
- [scene.mjs](scenary/scene.mjs): `updateCamera` owns pixels per world unit and
  the follow zoom; `drawMacaw` uses the same actor canvas size as locomotion.
- [locomotion.mjs](assets/locomotion.mjs): one source-canvas-to-world conversion
  for stride, speed and phase. [walking-motion.mjs](assets/walking-motion.mjs)
  validates the selected source and samples poses from completed walking cycles.
- [lab.css](assets/lab.css): page layout, canvas viewport and responsive controls.

## Validation

Run the focused tests in the existing development container:

```powershell
docker exec -w /workspace caatuu-dev node --test apps/games/lab/tests/navigation.test.mjs apps/games/lab/tests/walking-motion.test.mjs apps/games/lab/tests/locomotion.test.mjs
```

The September 6, 2026 checks passed 9 navigation tests, 7 workshop tests,
28 route tests and 4 game-catalog tests. Browser review confirmed short-walk
arrival, longer running trips, retargeting, the follow camera and the old-URL
redirect, with no browser errors. The user's 674 × 879 viewport was checked in
both whole-grove and follow views, including click coordinates.
After movement or rendering changes, repeat these interactions in the browser;
passing data tests does not establish animation quality or final art approval.
