# Macaw character workshop

This is the durable source for the local animation review: 25 standing/walking
frames, six east-facing running frames, the interactive viewer and its manifest.
West, northwest and southwest walking use horizontal mirrors. Running currently
supports east and mirrored west only. The run is a first motion study with a
known final-frame arm-swing issue; see the [motion review](../docs/MACAW_MOTION_REVIEW.md).

The 31 selected PNGs are true-alpha, 512 × 512 canvases, about 4 MiB in total.
Their SHA-256 values, pose order and registration anchors are in
[manifest.json](manifest.json). [provenance.json](provenance.json) preserves exact
generation prompts, source hashes and the southeast foot-repair audit.
Original sheets, painted concept inspiration and discarded candidates remain
in the ignored local artifact archive identified there. Those intermediate
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
The viewer provides action selection, all available directions, speed and scale,
contrasting backgrounds, play/pause, stepping, a scrubber and frame contact sheets.
It is a local, noindex review, excluded from Godot resource import/export.

For future characters, clothes and animation changes, follow the
[character animation workflow](../docs/CHARACTER_ANIMATION_WORKFLOW.md).
Promote only reviewed registered frames into this folder; preserve accepted
frames and the source archive. Then update provenance and hashes, validate,
publish, reload and inspect the complete animation before committing.
