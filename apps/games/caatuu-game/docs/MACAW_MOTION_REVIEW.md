# Macaw motion review — September 6, 2026

The [tracked workshop](../character-workshop/README.md) preserves the current
25-frame walking set and six-frame east/west running study. This review does
not claim final animation approval or Godot actor integration.

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

## Running

Six distinct east-facing poses are mirrored for west and play at 10 fps. Native
pixels use a common head anchor and 32-pixel airborne clearance in poses 3 and 6.
Both feet remain fully inside the canvas; no broad background rectangle or
clipped silhouette was found. A few small pale pixels near ankles/tail and minor
backpack/torso variation remain visible at large review scale.

The main art issue is `E-run-06`: its near arm repeats the forward swing from
pose 3 instead of completing the opposite backward swing. This affects the
5 → 6 → 1 transition. Make a targeted arm correction before treating this as
the reference for additional running directions. Keep the rest of the accepted
identity and existing walking assets unchanged. Do not independently resize
each run frame to match walking height; the lean and flight are intentional.

## Viewer and preservation

The playback clock now carries the fractional time between display callbacks,
so choosing 6–12 fps does not systematically play slower on uneven callbacks.
After inactivity it advances one pose instead of rushing through missed poses.
Focused tests cover cadence, all 31 unique frame IDs and hashes, transparent
512-square PNGs, and rejection of corrupted assets before served files change.

The refreshed browser loaded 31/31 images with no broken image elements. Each
authored walking direction stepped through phases 1–4 and wrapped correctly;
west/northwest/southwest used the expected mirrored source PNGs. Running retained
its separate six-pose cycle and contact sheet, and action switching restored
walking's eight directions and 6 fps. Visual review used the current registered
frames, including all poses together on contrasting review backgrounds.

The selected assets, viewer, portable provenance and publishing command are
tracked component files. Candidate generation folders remain ignored. A fresh
checkout can restore the review without those temporary files. The workshop
is excluded from the current Godot resource export and does not change gameplay.
