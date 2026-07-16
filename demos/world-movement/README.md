# World Movement Lab

An isolated Caatuu browser project for establishing convincing character
locomotion before any animation is promoted into the game.

Open the main lab at `/demos/world-movement/`. The professional motion viewer
is available at `/demos/world-movement/motion-reference/`.

## Project layout

```text
demos/world-movement/
  index.html, world-movement.*  interactive world and animation comparison
  frame-review.*                curated human-frame review
  macaw-guided-review.html      paired silhouette/Macaw review
  experimental/                 normalized frames actually used by the lab
  motion-reference/             CC0 skeletal motion viewer and sheet exporter
  research/                     prompts and notes; raw sources and generated candidates stay local
  docs/                         effort log and restart checklist
```

The project owns everything under this directory. It deliberately references
the production `/assets/` catalog for shared town scenery, robots, existing
Macaw sprites, and the controlled-foot rig; those assets remain in their
canonical game locations instead of being duplicated here.

## What currently works

- Continuous WASD, arrow-key, click-to-walk, and mobile-pad movement.
- Camera tracking, facing, depth layering, ground shadow, and distance-driven
  animation cadence.
- A professional CC0 humanoid motion source with idle, walk, formal walk, jog,
  sprint, and landing inspection.
- A curated eight-pose human walking baseline in playback order
  `01, 03, 05, 06, 07, 09, 11, 10`, plus a six-frame standing loop.
- A separate eight-frame silhouette-guided Macaw transfer candidate.
- Frame-by-frame review pages and selectable legacy experiments for comparison.

## Current conclusion

The human reference proves that the browser playback system can show a clear
walk. Human silhouettes are also useful conditioning guides for the Macaw:
foot contact, leg lift, and weight transfer survive the character transfer.
They do not yet reliably preserve opposing arm movement because the Macaw's
robe and backpack dominate the generated silhouette.

The Macaw cycle is therefore an experiment, not a finished game animation.
Running frames, explicit down/up walking poses, directional cycles, and robust
landing/idle transitions are still missing. No candidate in this project has
been promoted into the production game animation system.

See `docs/effort-log.md` for the complete work record and
`docs/resume-checklist.md` before continuing.

## Pipeline rules

- Preserve generated originals locally under the ignored
  `research/generated-candidates/` workspace. Promote only reviewed runtime
  frames, manifests, and required attribution into tracked directories.
- Keep motion-reference approval separate from character generation.
- Split generated sprite sheets with
  `C:/Work/tukevejtso/linux/scripts/images/SPRITE_SPLIT_REPACK.md` inside the
  Tukevejtso container.
- Perform cutout and dependency-heavy image processing in the established
  Tukevejtso container, never in a newly assembled Windows host environment.
- Normalize frames to one canvas and bottom-centre anchor before integration.
- Validate the complete sequence both in motion and frame by frame.
