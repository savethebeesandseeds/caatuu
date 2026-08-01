# Memory Grove v5 provenance

Memory Grove v5 is an authored-map composition for the existing
`memory-moon-style-v1` object catalog. It replaces the visibly repeated floor
tile treatment with one coherent ground plate while keeping navigation,
collision, and reusable props as independent data.

This historical package's canonical repository home is
`apps/launcher/static/assets/scenery/memory-grove-v5/`. Its location below the
launcher is Caatuu's shared catalog and delivery boundary, not a statement of
launcher ownership. Memory Moon consumes scenery from the centralized catalog
and does not maintain a second canonical copy in the game source.

## Authored ground plate

OpenAI ImageGen's built-in generation mode produced
`terrain/moonroot-ground-plate.png` on 2026-08-01. No paid image API or external
runtime service is required to load it. The source identifier is
`imagegen-moonroot-ground-plate-20260801`.

Prompt summary: create one original, square, straight-down storybook game map
ground plate for Memory Moon, with broad low-frequency moss, an irregular warm
earth route entering from the south, a hero clearing in the upper-left, a
smaller well pocket to the left, and an eastward branch; keep it free of
objects, characters, text, borders, grids, cast shadows, and scene framing.

The promoted PNG is 1254 by 1254 pixels and covers exactly 12 by 12 world
units, yielding 104.5 pixels per world unit. It is authored top-down rather
than as a pre-projected diamond. The fixed Godot world camera remains
responsible for the final isometric projection.

The plate is the sole rendered terrain authority for this layout. Its SHA-256,
byte length, mapping, source identifier, and render role are recorded in
`manifest.json` and repeated as a machine-readable contract under
`terrain.ground_plate` in `layout.json`.

## Navigation and composition

The 36 by 36 logical grid and 0.333333-unit cell size are retained for
navigation compatibility. Every logical cell is represented as grass because
the grid no longer describes visible texture changes; the authored plate owns
the route and clearing artwork. This separation prevents microscopic source
texture detail from being repeated and minified once per navigation cell.

The composition follows the plate rather than the old orthogonal crossroads:

- the player enters on the path from the south;
- the principal route bends toward the hero clearing in the upper-left;
- a short western branch terminates at the village-well pocket;
- an eastern branch leads toward the map boundary;
- eighteen catalog placements form purposeful landmark, route, and perimeter
  clusters, with fewer repeated generated props than Memory Grove v4;
- four perimeter colliders and three critical route polylines remain explicit.

All props continue to resolve through the adjacent shared
`memory-moon-style-v1/catalog.json`. This historical layout neither duplicates
the catalog into a game directory nor modifies its scale, collision, reuse,
anchor, or rights contracts. A build may stage hash-verified inputs in an
ignored private project, but that disposable copy is not an asset authority.

## Rights and release boundary

This package is `local-preview-only`. That status covers the generated ground
plate and inherits the catalog's conservative publication boundary. It must not
be treated as cleared for public or paid distribution until an owner-approved,
path-and-hash-scoped grant is recorded for every active visual input.
Canonical repository storage does not assert copyright ownership or expand any
license or publication right.

## Integrity

`manifest.json` locks the exact layout, catalog, and ground-plate hashes and
byte lengths. Memory Grove v4 remains unchanged as the rollback comparison;
v5 is an additive package.
