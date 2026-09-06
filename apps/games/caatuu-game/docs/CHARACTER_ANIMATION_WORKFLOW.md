# Character animation workflow

Use this process for Caatuu's illustrated character sprites, including new
characters and later clothing variants. The macaw standing/walking and running
sets are the worked examples: 25 walking-set frames plus 30 running frames,
covering eight directions through five authored views and three mirrors.
The animation review is separate from the Godot actor integration. Discover it
at <http://127.0.0.1:8765/games/lab>, with Motion at `/games/lab/motion` and the
independent click-to-move Scenery experiment at `/games/lab/scenary` (that exact
URL spelling).

## Approve the design, then keep it stable

Start from a user-approved standing design and the selected world style. Keep
the reference image, exact prompt, generated source path and SHA-256 together.
For the macaw, preserve the blue head, cream face patches, gold beak and feet,
brown robe with gold trim, backpack, proportions, camera angle and pixel detail.
State these invariants in every generation prompt. A clothing variant changes
the approved clothing boundary while retaining the character and reviewed poses.

Human approval freezes accepted poses. Do not regenerate an accepted direction
or batch to fix one frame. The September 6 walking repair changed only the foot
in `SE-walk-03`, preserving its unaffected body and the other 24 PNGs. The
subsequent all-direction running work preserves all 25 accepted walking-set
PNGs and east run poses 1–5 byte-for-byte. Its authorized east pose-6 arm repair
and other run candidates have separate provenance.

## Generate one sheet per direction

Generate five original directions: south (`S`), north (`N`), east (`E`),
northeast (`NE`) and southeast (`SE`). Horizontal mirrors supply west from east,
northwest from northeast and southwest from southeast. North and south need
their own drawings. Confirm that clothing, bags and held objects can be mirrored;
an asymmetric design may need separately authored counterparts.

For standing/walking, use one built-in image-generation call per direction,
with five poses together in a three-column, two-row sheet. This improves consistency over generating
every frame separately. Specify full silhouettes, generous empty gutters,
consistent character size and camera, and no labels or scenery.

| Cell 1 | Cell 2 | Cell 3 |
| --- | --- | --- |
| Standing | Contact A | Passing A |
| **Cell 4: Contact B** | **Cell 5: Passing B** | **Cell 6: Empty** |

For a running sheet, use six chronological poses in the same 3 × 2 layout,
with all cells occupied: first contact, first support, flight, opposite contact,
opposite support, opposite flight. It is a separate action, not a faster walk.

The walking poses should show opposite supporting feet and opposing arm swings.
Passing poses must differ from contact poses. Review the actual drawing rather
than assuming the requested layout guarantees correct gait.

Request genuine transparent alpha during generation. Inspect alpha metadata and
the image on contrasting backgrounds; a checkerboard picture is not proof of
transparency. Preserve usable alpha. If generation supplies a solid or baked
background, keep the art and clean it only when needed. Background removal is
optional during art review and must not stall approval or trigger repeated
generation solely to obtain alpha.

Save original sheets unchanged. Keep prompts, references, direction, source
paths, hashes and visual notes in the batch provenance. Keep candidates and
processing outputs separate from originals. Raw generations and temporary
research stay in ignored artifacts, not tracked production assets.

## Use the established image container

Work only in canonical `C:\Work\caatuu` on `main`, with the repository's
main-only and shared-session checks. Verify existing containers and mounts
before processing. Do not create another checkout, container, service or port.

The verified environment is:

| Existing container | Relevant storage |
| --- | --- |
| `caatuu-dev` | `C:\Work\caatuu` mounted at `/workspace` |
| `tukevejtso` | `C:\Work\tukevejtso` mounted at `/workspace/tukevejtso` |
| Tuke's existing `tukevejtso-cutout-venvs` volume | Mounted at `/opt/tukevejtso-venvs` |

Read `C:\Work\tukevejtso\windows\README.md`, its existing launcher and
`C:\Work\tukevejtso\linux\scripts\images\SPRITE_SPLIT_REPACK.md` before use.
Caatuu's container-only requirement overrides the external guide's optional
host-side Python example. Install no image packages on Windows.

If the inspected managed Tuke container is stopped, its established launcher is:

```powershell
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -File 'C:\Work\tukevejtso\windows\tools\docker-tukevejtso-shell.ps1' -NoShell
```

Use Windows PowerShell 5.1 for this launcher. In the confirmed September 6
incident, PowerShell 7 converted Docker volume `CreatedAt` into a `DateTime`,
changing the string used in the configuration fingerprint. Windows PowerShell
5.1 preserved the original string and matched the existing container. This
required no rebuild, recreation, guard bypass or volume change. A mismatch
that remains after the documented launcher is still a coordination blocker.

Put the existing `/opt/tukevejtso-venvs/cutout/bin` first on the process PATH
when invoking `image_tool.sh`: the system Python did not contain NumPy, while
the managed cutout environment already had the required packages. Do not
bootstrap or reinstall a healthy environment to work around PATH selection.

## Split, inspect and register

Use `image_tool.sh sprite-split` and its object-aware masks, manifest and
previews. For the walking layout, the approved splitter supports
`--empty-slots 6`, using one-based row-major positions. It validates that the
other five cells contain sprites and that the declared empty cell is empty.
Omit `--empty-slots` for running: all six cells are occupied.

The [external splitter patch record](../tooling/patches/README.md) preserves
the compatibility change used here; inspect the current tool before applying it.

The worked macaw staging root inside Tuke is
`/tmp/caatuu-macaw-sheets-v2-20260906`. Its `originals/` are processing inputs
and remain unchanged. `split/`, `repacked/`, `previews/` and `registered/` are
separate outputs. Use a fresh bounded output location for a new character or
candidate; do not rerun this whole batch over accepted frames for one repair.

Inside the existing Tuke container, the full-batch command pattern is:

```bash
cd /workspace/tukevejtso/linux
export PATH="/opt/tukevejtso-venvs/cutout/bin:$PATH"
sprite_stage=/tmp/caatuu-macaw-sheets-v2-20260906
./scripts/images/image_tool.sh sprite-split \
  "$sprite_stage/originals" "$sprite_stage/split" \
  --rows 2 --cols 3 --empty-slots 6 \
  --prefix macaw-walk --padding 24 --tile-padding 48 \
  --mask-mode auto \
  --repack-dir "$sprite_stage/repacked" \
  --preview-dir "$sprite_stage/previews" \
  --manifest "$sprite_stage/split-manifest.json"
```

Use existing alpha where it is usable. Choose additional cutout settings only
after inspecting the affected input. The first macaw processing pass used
`--cutout-engine classic --alpha-threshold 200` to exclude a soft glow on the
east sheet. **Threshold 200 is not a reusable default**: it can remove valid
soft edges or artwork in another image. Background cleanup should solve an
observed problem, preserve the character, and produce a reviewed candidate.

Check both `sprites.length == expected_count == 25` and an empty `warnings`
list. A matching total alone can hide a missing pose and an unexpected object
in the empty cell. Inspect every repacked preview, the combined contact sheet
and relevant individual cuts for clipped feet, halos, detached details and
neighbor contamination. Correct splitting problems before registration. A
complete five-direction run batch instead requires
`sprites.length == expected_count == 30`, again with no warnings; a separately
processed single run sheet requires six.

The current macaw registration script is staged as
`$sprite_stage/register-frames.py` and reads `$sprite_stage/split-manifest.json`:

```bash
python "$sprite_stage/register-frames.py" \
  "$sprite_stage/split-manifest.json" "$sprite_stage/registered"
```

For this particular walk, registration uses one 512 × 512 canvas, horizontal
alpha-bounds centering and a ground baseline of 480. It translates native pixels
without independently resizing or warping poses. Those dimensions are a macaw
review choice, not a universal character requirement. Record canvas, anchors,
translation and scale in the frame manifest, and choose an appropriate common
contract when a new character or action needs one.

Map source cells to action IDs explicitly. In this macaw sheet set, standing is
cell 1, south's four walk frames use **2, 5, 4, 3**, and the other directions use
2, 3, 4, 5. South's passing drawings were generated in the opposite order.
Preserve this correction in provenance; do not silently assume row-major
playback for later characters.

## Review the latest frames in the Motion lab

The generation archive is
`artifacts/games/caatuu-game/art-direction/2026-09-05-macaw/sheets-v2/`.
It contains `originals/`, `batch-*.json`, `register-frames.py`, `motion-ui/` and
`publish-motion.mjs`. Copy the Tuke outputs into its
`processed/{split,repacked,previews,registered}/` and preserve
`processed/split-manifest.json` alongside them. Retain the generated sources
and processing evidence in the canonical workspace.

The selected frames, live viewer source, portable provenance and manifest are
tracked in the [character workshop](../character-workshop/README.md). Promote
reviewed frames there before live review; do not overwrite it with stale raw
split outputs. Original sources and intermediate candidates stay in the archive.
The local server now serves that tracked source directly at
`http://127.0.0.1:8765/games/lab/motion`, under its existing
`ENABLE_CAATUU_GAME_PREVIEW=1` gate. No publisher or Godot export is needed to
load a source change. Validate the complete curated package through `caatuu-dev`:

```powershell
docker exec -w /workspace caatuu-dev node apps/games/caatuu-game/tooling/publish-character-workshop.mjs --check
```

The maintained publisher remains available without `--check` for an optional
snapshot in `artifacts/games/lab/motion/`, outside the Godot export. That snapshot
does not back the live lab. Archive publishers record the earlier pipeline.
The former `/games/caatuu-game/godot-v1/review/macaw-walk-v1/` entry redirects
to the short Motion URL, with old asset paths retained for compatibility.
Keep its compass, standing/walking switch, play/pause, frame stepping, scrubber,
speed control, all eight directions and contact sheets. Walking uses four poses
at 6 fps; running uses six at 10 fps. The current 55-frame screen opens on south
running. Action changes retain the selected direction, and the running contact
sheet has five authored rows. Historical first-run behavior opened east and
limited running to east/west; that restriction no longer applies.
A full-sheet gallery may supplement this screen; it must not
replace the animation demo.

The latest manifest is the only frame source. Missing frames remain visible
placeholders, with no fallback to earlier images. The viewer validates relative
`images/*.png` paths and uses each SHA-256 as an internal cache key so Refresh
files loads changed bytes. Review playback, stopping, mirror directions and
individual poses; check frame counts, real alpha, loading failures and hashes.
Registration and successful playback do not by themselves certify the gait.

The adjacent Scenery experiment is authored under `apps/games/lab/scenary/`.
It reads Motion's same manifest and 55 selected PNGs, and the existing canonical
`/assets/scenery/metadata/{catalog,world}.json` and `/assets/scenery/images/`
resources. Click a destination; movement chooses walking for routes shorter
than 2.6 world units and running otherwise, at 1.55 and 3.6 units per second
respectively. Arrow keys are not required. Review character scale, gait and
placement there without treating this browser experiment as Godot integration.
The lab hub and both experiments stay local, `noindex`, and outside game,
application and Android exports.

## Repair only the rejected area

Before a repair, snapshot the accepted manifest and hashes. Identify the exact
frame and rejected feature. Generate or edit a candidate using that frame and
its neighbors as references, stating that every unaffected part must stay fixed.
If the generator changes the body while fixing a foot, treat it as a donor
candidate: isolate the correction and integrate only the approved foot region
through the existing container workflow. Preserve the accepted body pixels.

Compare every accepted output hash afterward. Only authorized frames may change;
all others must remain byte-identical. For the walking foot repair, that meant
one changed PNG and 24 unchanged PNGs. Preserve before/after candidates and
record the local correction, source, processing and approval. Update the one
manifest entry, validate the latest bytes, refresh Motion and inspect the full loop and
the corrected pose. Do not turn a single-frame request into clothing, timing,
background or whole-character changes.

## Running: historical first action study

The user authorized creating a six-frame east-facing run on September 6, 2026. The
reviewed east walk sheet supplies the character identity and costume reference.
Running uses its own lean, stride, support/flight phases and clothing motion.
Start with one facing and review its poses and loop before expanding directions.

The first study is preserved beside `sheets-v2/` in
`artifacts/games/caatuu-game/art-direction/2026-09-05-macaw/run-v1/`.
Its `generation.json` records the exact built-in prompt and source reference.
Six poses occupy all cells of a 3 × 2 sheet, so this split has no empty slot.
The selected split manifest requires count=expected_count=6 and warnings=[].
Only this sheet's observed pale edges and three enclosed checkerboard islands
needed cleanup, using the documented splitter and bounded `hole-knockout` tool.

`register-run.py` keeps native pixels, aligns the upper blue-head median x to
the approved east idle reference, and uses the shared 512-square canvas and
ground baseline 480. Airborne frames 3 and 6 retain 32 pixels of clearance.
This avoids forcing every foot to the ground and losing the running lift.
Record such action-specific anchors explicitly instead of applying the walking
registration formula blindly.

That first review combined 25 walking-set frames with six east run frames and
mirrored west. `run-v1/verify-preview.mjs` recorded preservation of the earlier
walking PNGs and the six served run hashes. Its final east pose repeated the
forward arm swing; the v2 correction now supplies the backward swing. The
first-run archive is historical evidence, not the current frame authority.

## Running: current all-direction study

The current package contains 30 running frames: six each for south, north,
east, northeast and southeast. Three horizontal mirrors provide eight running
directions. The local archive is
`artifacts/games/caatuu-game/art-direction/2026-09-05-macaw/run-v2/`.
The tracked [run-v2 provenance](../character-workshop/run-v2-provenance.json)
preserves exact prompts, source hashes, selected candidates and registration.

North's actual source order is **4, 2, 3, 1, 5, 6**: the generated contact cells
needed swapping. Record that mapping explicitly. The selected v2 candidates
also correct the arm in `SE-run-04`, support poses in `NE-run-02` and `NE-run-05`,
and the backward arm in `E-run-06`. The final `NE-run-05` scale correction uses
only cell 5 from `ne-run-scale-fix.png`; the other 54 final PNGs stayed unchanged.
All 25 walking-set PNGs and east run poses 1–5 remain byte-identical to the
accepted earlier set.

Modest size and costume drift remain, and north/northeast have pronounced
vertical bounce. Inspect them in motion without assuming registration has
solved anatomy or timing. Seven focused tests passed after the final asset
adjustment. Browser review loaded all 55 frames and checked all eight run
directions, wraparound, mirrors, standing, action switching and hash refresh.
The [motion review](MACAW_MOTION_REVIEW.md) records the evidence and remaining
visual limitations. Generation,
registration and successful loading do not imply final gait approval or Godot
actor integration.

For documentation or structural commits, run both repository checks in the
existing Node container, as required by the repository instructions:

```powershell
docker exec -w /workspace caatuu-dev node tools/repository/check-tracked-files.mjs
docker exec -w /workspace caatuu-dev node tools/repository/check-markdown-links.mjs
```
