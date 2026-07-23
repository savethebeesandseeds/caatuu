# Shared launcher assets

This is the canonical catalog for visual assets shared by language apps, the
launcher, and Android packages. Physical directories use descriptive
lowercase kebab-case names. A few older public URLs remain stable so installed
apps, manifests, and persisted data continue to work.

| Physical source | Stable public URL |
| --- | --- |
| `language-mascots/` | `/assets/aliens/` |
| `loading-animation/` | `/assets/loading_animation/` |
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

Assets used by only one language belong in that language app. Large experiments
and generated candidates belong under `demos/` or ignored research workspaces,
not in this production catalog.
