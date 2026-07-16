# Resume checklist

Read `../README.md` and `effort-log.md` before continuing.

1. Treat the professional human rig as motion authority; do not derive timing
   or pose order from generated Macaw frames.
2. Inspect any proposed guide frame in `motion-reference/` before character
   generation.
3. For the next walk pass, begin with explicit down/up poses and exaggerate the
   separation of near/far hands from the robe and legs.
4. Generate a single Macaw test frame first, preserving the accepted identity
   anchor and recording the full prompt under `research/generated-candidates/`.
5. If the single transfer is credible, generate frames individually rather
   than as one crowded sheet.
6. Preserve originals. Run background removal, splitting, and normalization in
   the documented Tukevejtso container workflow.
7. Add new normalized frames as a separate experimental source; do not replace
   the human authority or silently overwrite an earlier candidate.
8. Review every frame, playback order, loop seam, start/stop transition, and
   browser console before declaring improvement.
9. Keep running and vertical-direction work separate until the walk cycle is
   accepted.
10. Promote nothing into production game assets without an explicit review.
