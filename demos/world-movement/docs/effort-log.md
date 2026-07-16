# World Movement Lab effort log

This document records the completed animation work, including unsuccessful
approaches that should not be repeated without a deliberate reason.

## 1. Browser movement prototype

The first lab established continuous movement over a composed Caatuu town:
keyboard, click-to-walk, mobile direction controls, camera following, facing,
depth sorting, shadows, and distance-driven animation. This isolated movement
presentation from RPG rules, collision, dialogue, and game-state integration.

## 2. Early Macaw animation attempts

Existing Macaw walk images, a four-key-pose generated cycle, an eight-frame
down/up extension, and a browser-controlled separated-foot rig were compared.
The main failures were repeated poses, weak arm alternation, rigid transitions,
and inconsistent landing/standing behavior.

An optical-flow interpolation experiment produced more frames but introduced
ghost hands, doubled feet, dark motion trails, and unstable transparency. It
was rejected and remains only as a diagnostic under
`research/generated-candidates/macaw-walk-v5-optical-flow-test/`.

## 3. Professional human motion authority

The Quaternius Universal Animation Library Standard edition was adopted as a
CC0 motion source. The `motion-reference/` viewer provides strict side-view
inspection, phase scrubbing, joint overlays, and export of idle, walk, and
sprint sheets. This established a stable skeleton, ground line, camera, bone
lengths, and phase order independent of generated character art.

Several generations of silhouette guides refined limb readability. The final
human references use grayscale depth levels so near/far arms and legs remain
distinguishable without adding a foreign outline around the body.

## 4. Generated human playback baseline

Individual human poses were generated from the approved guides. Duplicate or
near-duplicate frames `02`, `04`, `08`, and `12` were removed from active
playback. Frame `11` was placed between `09` and `10`; frame `09` received a
replacement to preserve the correct near/far leg roles. The active order is:

`01, 03, 05, 06, 07, 09, 11, 10`

This sequence demonstrates that the browser animation code can play a readable
walk when supplied with coherent poses. Six independently generated standing
poses form the idle loop.

## 5. Silhouette-guided Macaw transfer

Eight Macaw frames were generated individually using the curated human frames
as pose guides and one accepted staff-free Macaw as the identity anchor. The
original model outputs, prompts, and processing notes are preserved under
`research/generated-candidates/macaw-pose-guided-v1/`.

Background removal and canvas normalization were performed in the Tukevejtso
container. A BiRefNet pass was retained diagnostically but rejected because of
magenta edge spill. The accepted frames used border-derived chroma removal,
soft mattes, despill, edge contraction, trim, scale, and bottom-centre placement
on a common transparent `520 x 570` canvas.

The transfer preserves leg contact and weight more successfully than earlier
Macaw sheets. Opposing arm movement remains weak because the robe and backpack
hide or visually absorb the arms. This is the central unresolved result.

## 6. Present stopping point

The demo is useful as a motion and generation laboratory, but the Macaw is not
ready for game integration. Missing work includes:

- explicit down and up poses for the final Macaw walk;
- a readable run/sprint cycle;
- up/down screen-direction animation sets;
- landing and stopping transitions that do not reuse a walking pose;
- stronger arm-separation conditioning for clothed or equipped characters;
- a standardized character-transfer contract reusable by future characters.

All project-owned browser files, research sources, generated originals,
manifests, previews, and documentation now live under `demos/world-movement/`.
Only shared production art remains in `/assets/`.
