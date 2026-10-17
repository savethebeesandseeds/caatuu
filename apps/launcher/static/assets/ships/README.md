# Spaceship assets

`meta.json` is the authoritative catalog for every PNG in this directory. Keys
are encoded public asset paths. Each entry contains a manually written English
`description`, the `ship` category, `orientation`, and an `embedding` reference.
Vectors live in the course-independent index served at
`/language-runtime/static/data/image-embeddings/minilm-v1.json`; full vectors
are not duplicated in this JSON. Each `embedding` reference contains `index`,
`model_id`, `source_kind: "ship_asset"`, and the encoded public `asset_path`.

## Orientation

`orientation.heading_degrees` is the estimated forward heading of the original
artwork in the image plane, before any renderer transforms. It is a finite
number from 0 inclusive to 360 exclusive, increasing clockwise:

| Heading | Direction |
| --- | --- |
| 0 | Right |
| 90 | Down |
| 180 | Left |
| 270 | Up |

For example, 150 degrees points diagonally down and left. Angles are manually
estimated in five-degree steps. For rounded, bell-shaped, or nearly symmetric
craft, they describe the intended forward presentation rather than a precisely
measured physical axis. This is not a three-dimensional camera angle, roll, or
an assertion that the pictured ship is moving.

To face a desired heading, rotate by `desiredHeading - heading_degrees` in CSS
screen coordinates, assuming no preceding mirror or rotation. A horizontal
mirror changes the heading to `(180 - heading_degrees + 360) % 360`.

## Updating descriptions and vectors

Inspect the image, update its description and heading, and rebuild in the
existing `caatuu-dev` container from the canonical repository root:

```powershell
docker exec -w /workspace caatuu-dev node apps/language-runtime/tooling/build-image-embedding-index.mjs
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses --register-shared-runtime
```

The maintained builder reuses the pinned shared local runtime and embeds only
the English description. Orientation remains in `meta.json` as rendering
metadata. The index records source checksums, and the delivery refresh updates
setup hashes. Changing a heading must not change the text sent to the embedding
model. Shared artwork does not depend on the Czech curriculum database.
