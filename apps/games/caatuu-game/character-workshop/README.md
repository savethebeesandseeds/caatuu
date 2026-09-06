# Macaw character workshop

This is the durable source for the local animation review: 25 standing/walking
frames, 30 running frames, the interactive viewer and its manifest. Both actions
have five authored directions: south, north, east, northeast and southeast.
West, northwest and southwest use horizontal mirrors, giving eight directions.
The run remains a motion study; see the [motion review](../docs/MACAW_MOTION_REVIEW.md)
for its corrections, draft limitations and completed validation.

The 55 selected PNGs use true-alpha, 512 × 512 canvases.
Their SHA-256 values, pose order and registration anchors are in
[manifest.json](manifest.json). [provenance.json](provenance.json) preserves exact
generation prompts, source hashes, the southeast walking-foot repair and the
historical first east-facing run. [run-v2-provenance.json](run-v2-provenance.json)
records the additional running directions and v2 corrections. All 25 walking-set
PNGs and east run poses 1–5 remain byte-identical to the accepted earlier set;
east pose 6 now has its corrected backward arm swing.
Original sheets, painted concept inspiration and discarded candidates remain
in the ignored local artifact archives, including `run-v2/`, identified in
provenance. Those intermediate
images are not necessary to restore this viewer from a fresh checkout.

With the established Caatuu services running, publish from the canonical checkout:

```powershell
docker exec -w /workspace caatuu-dev node apps/games/caatuu-game/tooling/publish-character-workshop.mjs
```

Open <http://127.0.0.1:8765/games/caatuu-game/godot-v1/review/macaw-walk-v1/>.
This uses the existing service and port; it does not start another preview.
The publisher verifies all inputs before replacing served files and publishes
the manifest last. Add `--check` to validate without writing output.

```powershell
docker exec -w /workspace caatuu-dev node --test apps/games/caatuu-game/tooling/tests/character-workshop.test.mjs
```

The focused tests cover playback cadence, complete frame identity and hashes,
transparent canvas metadata, unsafe paths and corrupted-input publication.
The viewer opens on south running at 10 fps, with a six-pose run cycle. Walking
uses four poses at 6 fps. Action changes retain the selected direction, and
running's contact sheet has five authored rows. The viewer provides action
selection, all eight directions, speed and scale,
contrasting backgrounds, play/pause, stepping, a scrubber and frame contact sheets.
It is a local, noindex review, excluded from Godot resource import/export.
Seven focused tests passed after the final northeast pose-5 scale adjustment.
Browser review loaded all 55 true-alpha frames without broken images or console
messages and checked the six-pose cycles in all eight directions, mirrors,
standing, action switching and hash refresh. Successful loading or registration
is not final gait approval.

For future characters, clothes and animation changes, follow the
[character animation workflow](../docs/CHARACTER_ANIMATION_WORKFLOW.md).
Promote only reviewed registered frames into this folder; preserve accepted
frames and the source archive. Then update provenance and hashes, validate,
publish, reload and inspect the complete animation before committing.
