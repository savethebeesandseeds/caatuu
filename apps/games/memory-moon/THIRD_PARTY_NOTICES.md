# Memory Moon third-party notices

## Godot Engine

The build and Web runtime use Godot Engine 4.7.1 under the MIT license. The
full notice is in `GODOT-LICENSE.txt` and is copied beside every generated Web
bundle.

## Quaternius Universal Animation Library

The prototype humanoid and animation clips are from the Quaternius Universal
Animation Library, Standard edition, released under CC0. Caatuu's authoritative
source and notice are:

- `demos/world-movement/motion-reference/source/AnimationLibrary_Godot_Standard.glb`
- `demos/world-movement/motion-reference/source/Quaternius-License.txt`

The exporter verifies these committed files before use and copies the notice
beside the generated Web bundle.

## Caatuu macaw traveler parts atlas

The experimental macaw shell uses only the exact AF-054 parts atlas published
by Caatuu under CC0 1.0:

- `apps/animated-fabric/assets/reference-packages/macaw-traveler-v1/sources/prepared-parts/macaw-traveler-parts-sheet-v1.png`
- SHA-256 `8761ea535ad5d5550989a9c2b9c92e7b163af032f6ed952b3b15024d16378419`

The exporter verifies the source and its package notice before use. The full
dedication is copied beside every generated Web bundle as
`LICENSES/Macaw-Parts-CC0.md`.

## Caatuu Memory Grove preview art

The active Memory Grove v6 scenery uses six exact, semantically renamed
promotions from Caatuu's curated visual-vocabulary folder, three single-object
images, and straight-down terrain material sources generated with OpenAI's
built-in ImageGen workflow. A deterministic local process derives four reusable
grass variants and the complete 16-tile cardinal path vocabulary, packs them in
an edge-extruded atlas, and authors the grove as a 12 by 12 tile-ID map. Godot
batches that map into streamed chunks and keeps the fine navigation grid
independent of visible texture density. The canonical packages live in Caatuu's
shared asset catalog. Their location under the launcher static tree does not imply launcher ownership. Godot stages only the active, hash-verified subset
into disposable build output and does not load archival diamond sheets or the
earlier v1/v3/v4/v5 runtime packages. Source and output hashes, dimensions,
processing settings, scale ranges, anchors, collision profiles, and reuse
limits are in:

- `apps/launcher/static/assets/scenery/memory-moon-style-v1/manifest.json`
- `apps/launcher/static/assets/scenery/memory-moon-style-v1/PROVENANCE.md`
- `apps/launcher/static/assets/scenery/memory-moon-style-v1/catalog.json`
- `apps/launcher/static/assets/scenery/memory-grove-v6/layout.json`
- `apps/launcher/static/assets/scenery/memory-grove-v6/manifest.json`
- `apps/launcher/static/assets/scenery/memory-grove-v6/PROVENANCE.md`

The earlier packages remain unchanged as reproducible design history and are
not part of the active Web export. The visual-vocabulary folder does not contain
a complete artwork license or redistribution grant, so the entire v6 package
remains `local-preview-only` and is stop-ship for public or paid distribution.
The exporter verifies the promoted runtime PNGs and copies the v6 provenance
note beside the generated Web bundle; no license is inferred by this notice.
Canonical repository storage likewise does not assert copyright ownership or
expand any license or publication right.
