# Macaw character workshop / Motion lab

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
records the additional running directions and v2 corrections. The current
55-frame set has a uniform scale refinement, documented in
[mass-normalization.json](mass-normalization.json). The earlier accepted bytes
remain recoverable from commit `6da3c49439eb226a6607101f91abaaabe1ab2683` and the
local archive `artifacts/games/lab/mass-normalization-20260906/originals/`.
Original sheets, painted concept inspiration and discarded candidates remain
in the ignored local artifact archives, including `run-v2/`, identified in
provenance. Those intermediate
images are not necessary to restore this viewer from a fresh checkout.

With the established local Caatuu service running and
`ENABLE_CAATUU_GAME_PREVIEW=1`, open
<http://127.0.0.1:8765/games/lab/motion>. The server reads this curated source
folder directly, so a source change needs validation and a page refresh, with
no publisher or Godot export step. The [lab hub](http://127.0.0.1:8765/games/lab)
links Motion and the separate
[Scenery experiment](http://127.0.0.1:8765/games/lab/scenary).

The old `/games/caatuu-game/godot-v1/review/macaw-walk-v1/` entry redirects to
the short Motion URL; existing asset links remain compatible. Both slashless
and trailing-slash Motion URLs work on the same service and port.

Validate the curated inputs without writing an export:

```powershell
docker exec -w /workspace caatuu-dev node apps/games/caatuu-game/tooling/publish-character-workshop.mjs --check
```

The optional publisher, invoked without `--check`, writes a snapshot under
`artifacts/games/lab/motion/`, outside the Godot export. It validates all inputs
before writing the snapshot and writes the manifest last. This snapshot is
not the live lab's source.

```powershell
docker exec -w /workspace caatuu-dev node --test apps/games/caatuu-game/tooling/tests/character-workshop.test.mjs
```

The focused tests cover playback cadence, complete frame identity and hashes,
transparent canvas metadata, unsafe paths, all 24 direction strips and
corrupted-input publication.
The viewer opens on south running at 10 fps, with a six-pose run cycle. Walking
uses four poses at 6 fps. Action changes retain the selected direction, and
running's contact sheet has five authored rows. The viewer provides action
selection, all eight directions, speed and scale,
contrasting backgrounds, play/pause, stepping, a scrubber and frame contact sheets.
It is a local, noindex review, excluded from Godot resource import/export.
The earlier 55-frame review, recorded in the [motion review](../docs/MACAW_MOTION_REVIEW.md),
passed seven focused tests after the final northeast pose-5 scale adjustment
and checked browser playback, mirrors, standing, action switching and hash
refresh. That historical review does not validate later route or lab changes.
Successful loading or registration is not final gait approval.

Scenery consumes this same manifest and the same 55 normalized PNGs. Its
click-to-move view lives under `apps/games/lab/scenary/`
and reuses `/assets/scenery/` metadata and images. The experiments remain
independent of the Godot game.

For future characters, clothes and animation changes, follow the
[character animation workflow](../docs/CHARACTER_ANIMATION_WORKFLOW.md).
Promote only reviewed registered frames into this folder; preserve accepted
frames and the source archive. Then update provenance and hashes, validate,
reload Motion and inspect the complete animation before committing. Export an
optional snapshot only when one is needed.

## Apparent size and editable strips

The scale target is consistent apparent body size, allowing leaning, compressed
support poses and extended strides to change total height. Each authored
direction has one scale for standing/walking and one for running. The factor is
the square root of 66,000 divided by that group's median alpha-weighted
silhouette area. Standing shares walking's factor to avoid resizing on stopping.
Individual poses are never independently equalized, so limb overlap does not
cause artificial body pulsing. Head and torso comparisons remain the final
visual check; equal area cannot repair differences in the original drawings.

Nearest-neighbor scaling preserves the existing palette on transparent
512 × 512 canvases. Grounded silhouettes end at y=480; running flight frames
retain the original 32-pixel clearance at y=448. Every silhouette stays inside
the canvas. The audit records each original hash, registration, factor and result.

In Motion, each contact-sheet direction label has a **Download** button. It
always starts with standing, then follows the current action: Walk (idle + 4
poses, 2560 × 512) or Run (idle + 6 poses, 3584 × 512). Both contact sheets show
Standing in their first image column. Standing mode shows the walking sheet
and its walking downloads. Idle is a reference cell; playback still loops only
the four walking or six running poses.
The separate download section and selector have been removed.

The curated asset package still contains all 24 strips, including the mirrored
directions and Complete (11 frames, 5632 × 512), listed in the manifest.
Complete order is standing, walk 1–4, then run 1–6. Every cell is exactly
512 × 512, with no labels or added gutters. West, northwest and southwest
contain mirrored pixels, ready to edit.

Keep the full canvas, transparency and cell boundaries when editing. The
downloads are copies; editing one does not automatically update the lab. Review
edited cells before promoting them and regenerate affected strips and hashes
together. Do not resize each cell to fit its individual silhouette.

The maintained [normalization utility](../tooling/normalize-motion.py) runs with
Pillow in the existing Tukevejtso container. It takes a read-only snapshot
containing `manifest.json` and `images/`, verifies all 55 source hashes, and
requires a fresh output directory. It refuses already-normalized inputs and
clipping; always start from the original snapshot when adjusting the target.
For the current archive, the container invocation after staging the script and
originals with `docker cp` was:

```powershell
docker exec tukevejtso /opt/tukevejtso-venvs/cutout/bin/python /tmp/caatuu-mass-20260906/normalize-motion.py --source /tmp/caatuu-mass-20260906/originals --output /tmp/caatuu-mass-20260906/normalized --source-revision 6da3c49439eb226a6607101f91abaaabe1ab2683 --source-archive artifacts/games/lab/mass-normalization-20260906/originals
```

Use a new output path for subsequent candidates. Inspect `mass-comparison.png`
before promoting the result. The utility verifies every encoded strip cell
against its corresponding normalized frame, including baked mirrors. Copy only
the final frames, strips and audit into this curated folder, then update the
manifest last. Generated previews stay in the ignored artifact archive.

The [normalization regression tests](../tooling/tests/test_normalize_motion.py)
run with the same managed Tukevejtso Python. Stage the utility and tests together
with their relative `tooling/` and `tooling/tests/` layout, then run the test file
directly. Eight cases verify that invalid frame paths, overlapping directories
and malformed direction/frame mappings leave all source bytes intact and create
no output. The nine Node workshop tests validate the promoted package and its
download strips.
