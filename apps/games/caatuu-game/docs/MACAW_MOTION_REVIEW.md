# Macaw motion review — September 6, 2026

The [tracked workshop](../character-workshop/README.md) preserves 55 frames:
25 standing/walking frames and 30 running frames. Five authored directions and
three mirrors provide eight directions for both actions. This review does
not claim final animation approval or Godot actor integration. The final
northeast pose-5 scale adjustment and browser validation are complete.

## Walking

The five authored directions have standing plus four walking poses; three
horizontal mirrors produce eight travel directions. South retains the corrected
source-cell order 2, 5, 4, 3. All 25 current PNGs are byte-identical to the
previously served set, including the repaired `SE-walk-03` foot. The other
24 accepted frames were not regenerated. The foot-only correction preserves
all pixels outside its recorded bounds and is audited in provenance.

Contact and passing poses read at the default 6 fps. Small variations in torso
size and costume drawing remain, most noticeably across diagonal poses. Preserve
the accepted set; these are future polish observations, not permission to
regenerate the entire character. Older split/repack previews in the local archive
precede the foot correction and must not replace the registered final PNGs.

## Running: historical east/west study

The first running study contained six east-facing poses, mirrored for west,
at 10 fps. Native pixels used a common head anchor and 32-pixel airborne
clearance in poses 3 and 6. That 31-frame combined viewer loaded successfully
and kept the walking set unchanged. The source archive and earlier portable
provenance preserve this history.

The original `E-run-06` repeated the forward arm swing from pose 3. The selected
v2 replacement corrects that arm to swing backward. East run poses 1–5 remain
byte-identical. The old final pose must not replace the corrected current PNG.

## Running: current all-direction study

There are six running poses for each authored direction: south, north, east,
northeast and southeast. West mirrors east, northwest mirrors northeast, and
southwest mirrors southeast. All eight use a six-pose cycle at 10 fps. North
uses source cells **4, 2, 3, 1, 5, 6** to restore the opposing contact sequence.

Selected corrections address the arm in `SE-run-04`, the support poses in
`NE-run-02` and `NE-run-05`, and the backward arm in `E-run-06`. The final
`NE-run-05` scale correction uses only cell 5 from `ne-run-scale-fix.png`, with
the other 54 final PNGs unchanged. Its native height is now 348 pixels, compared
with 353 for the opposing support pose; the earlier 322-pixel pose caused a
more obvious size jump. A minor head difference remains.
The [v2 provenance](../character-workshop/run-v2-provenance.json) keeps prompts,
source hashes and candidate selection; original sheets and rejected candidates
remain in the ignored `run-v2/` archive.

The 30-frame contact review found complete silhouettes without material
clipping, stray checker backgrounds or extra limbs. The north contact remap
shows opposing arm/leg halves, and the southeast arm correction joins cleanly
at contact-sheet scale. Modest head/body size and costume drift remain; the
east final pose is slightly smaller. The northeast fifth-pose correction
reduces the size jump in motion. North and northeast show pronounced vertical
bounce. These are draft motion observations for loop review, not permission to
regenerate accepted frames or a claim of finished gait.

All 25 walking-set PNGs and east run poses 1–5 remain byte-identical to their
accepted versions. Lean and airborne clearance are intentional: do not force
every run pose onto the walking height or baseline without reviewing the motion.

## Viewer and preservation

The playback clock now carries the fractional time between display callbacks,
so choosing 6–12 fps does not systematically play slower on uneven callbacks.
After inactivity it advances one pose instead of rushing through missed poses.
The expanded focused tests cover cadence, the complete 55-frame set and hashes,
transparent 512-square PNGs, and rejection of corrupted assets before served
files change. All seven tests passed again after the final asset adjustment.

The viewer now opens on south running at 10 fps. Standing, Walking and Running
retain the selected direction; walking has four poses at 6 fps, running has six,
and the running contact sheet contains five authored rows. All eight directions
are available for both movement actions. The final browser pass confirmed:

- All 55 true-alpha frames loaded, with zero broken images and no console messages.
- The running contact sheet contained 30 cells, and all eight directions stepped
  through poses 1–6 and wrapped correctly. Mirrored directions used a horizontal
  `matrix(-1, …)` transform.
- Action switching retained southwest, changed between four walking poses at
  6 fps and six running poses at 10 fps, and standing worked.
- The corrected northeast fifth frame loaded with its new SHA-256 cache key,
  `de19d2956cafeeb8a985bdda30c1afd6a34a4d8efaa29d8fef4d1b1faadb5051`.
- Light and dark backgrounds and the final northeast loop were inspected.

These checks cover the current 55-frame review. The 31-frame browser result
above describes the historical first running study only.

The selected assets, viewer, portable provenance and publishing command are
tracked component files. Candidate generation folders remain ignored. A fresh
checkout can restore the review without those temporary files. The workshop
is excluded from the current Godot resource export and does not change gameplay.
