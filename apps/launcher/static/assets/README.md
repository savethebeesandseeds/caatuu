# Shared Caatuu assets

This is the canonical repository catalog for visual assets shared by language
apps, games, the launcher, and Android packages. Its location below the
launcher's static directory provides one delivery boundary; it does not imply
that the launcher owns the assets. Physical directories use descriptive
lowercase kebab-case names. A few older public URLs remain stable so installed
apps, manifests, and persisted data continue to work.

| Physical source | Stable public URL |
| --- | --- |
| `language-mascots/` | `/assets/aliens/` |
| `loading-animation/` | `/assets/loading_animation/` |
| `motion/` | `/assets/motion/` |
| `scenery/` | `/assets/scenery/` |
| `visual-vocabulary/` | `/assets/miscellaneous/` |

Within `loading-animation/`, every immediate child folder beginning with
`animation` is an animation sequence. `animations_manifest.json` is generated
from those folders, and frames play by the final number in each filename;
numeric gaps are valid.

The Rust router, setup-manifest generator, Android packaging, and Czech vector
database builder all implement this compatibility map. Change a public prefix
only as an explicit migration across those consumers; renaming a physical
directory alone must not invalidate a downloaded asset URL.

Directories named `originals/` contain archival source art. They are
intentionally tracked even when processed frames or split assets exist, and
must not be treated as generated or redundant output during cleanup.

`scenery/` is the single canonical repository home for reusable world art,
versioned layouts, schemas, manifests, and provenance. Games consume these
packages; they do not keep canonical copies in their own source directories.
An engine build may stage the minimum active package into an ignored private
workspace when it requires project-local resources. Such staging is disposable
build output and must never become another source of truth.

`motion/` contains reusable animation and motion-reference packages. Each
package keeps its binary inputs, license, strict manifest, and promotion state
together so games never depend on an experimental workspace.

Assets used by only one language belong in that language app. Inactive experiments
belong under `archive/`; raw inputs and generated candidates belong under ignored
`artifacts/research/`, not in this production catalog.
