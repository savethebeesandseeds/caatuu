# Resume the macaw adventure

Status: **paused concept**, saved September 6, 2026. Finish the current Caatuu
learning game first. This document records the stopping point, not an active
implementation queue.

## What is preserved

| Work | Authority |
| --- | --- |
| Standing, walking and running; eight directions | [Character workshop](../caatuu-game/character-workshop/README.md) |
| Transparent strips for editing, idle first | [Motion manifest](../caatuu-game/character-workshop/manifest.json) |
| Generation, splitting, registration and review process | [Animation workflow](../caatuu-game/docs/CHARACTER_ANIMATION_WORKFLOW.md) |
| Visual review findings and known limitations | [Motion review](../caatuu-game/docs/MACAW_MOTION_REVIEW.md) |
| Click-to-move grove, short walks and longer runs | [Scenery](scenary/index.html) and [navigation](scenary/navigation.mjs) |
| Approved world B, The Sheltered Sea | [Map workshop](world-map/README.md) |
| Concept status and source pointers | [Concept record](concept.json) |

Motion uses 55 selected poses: five authored directions, each with one standing,
four walking and six running frames; the other three directions mirror them.
Frames are registered on 512 × 512 canvases and normalized by direction and gait.
The 24 horizontal strips cover walking, running and complete motion in all
eight directions. Every download begins with standing; idle is not played
inside the run cycle. Keep the selected artwork and its provenance together.

The chosen map has a separate dark island with one purple source of magic.
Its approved 1536 × 1024 master is immutable. Geography, prompts and planned
section coordinates are saved; detailed sections, movement masks and overlays
are not yet made. Earlier map alternatives and generation candidates remain
local under ignored artifact folders; only curated sources are versioned.

## Isolation from the current app

The concept shares the canonical repository and existing local server, but
has no integration into the learning game, Android package or public static
release. The active standalone-game catalog is empty. Publishing a required
game still fails closed until a new release-cleared catalog entry is authored.

Review locally at:

- <http://127.0.0.1:8765/games/lab>
- <http://127.0.0.1:8765/games/lab/motion>
- <http://127.0.0.1:8765/games/lab/scenary>

These source-backed, noindex pages require the existing
`ENABLE_CAATUU_GAME_PREVIEW=1` switch. The switch now exposes the retained labs
only. No Godot installation, export, extra server or port is needed.
The lab is not linked from the learning-app launcher. The historical long
Motion URL remains a compatibility redirect.

## Retired experiments

The old humanoid, rigid macaw-parts shell and Godot grove implementation,
export tooling, notices and build definitions are frozen in the
[legacy archive](../../../archive/demos/caatuu-game-godot-v1/README.md).
Its engine routes return 404, even with concept preview enabled. Generated
old exports are not mounted. Existing ignored artifacts and Docker data were
not deleted.

Shared scenery and Quaternius authorities remain at their canonical paths.
The separate Animated Fabric application and its references are preserved.
Previously archived experiments remain archival; none is an active game.

## When we return

1. Review Motion and Scenery with the accepted macaw. Small pose corrections
   remain possible through the saved strips and documented process.
2. Use the selected world master to generate two adjacent detailed sections:
   city section `r00-c01` and west approach `r00-c00`. Preserve shared geography
   and overlapping context. Compare the macaw at the proposed gameplay scale.
3. Agree scale and fix the shared edge before expanding further. Retain each
   section's bounds, version and prompt; do not independently redraw the coast.
4. Draw walkable areas as separate masks and add foreground, interactive
   objects and NPCs as separate layers. The artwork alone does not define
   navigation or occlusion.
5. Decide the runtime after that small playable study. Godot and a globe remain
   options, not current dependencies or commitments.

Do not resume generation automatically. Keep future candidates under the
ignored artifact workspace and promote only reviewed results.
