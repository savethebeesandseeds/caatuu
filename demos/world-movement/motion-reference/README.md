# Motion Reference Lab

This isolated browser lab renders professionally authored humanoid locomotion
as a strict side-view motion study before any Caatuu character art is
generated.

The source is the Standard edition of the Quaternius Universal Animation
Library. It is preserved with its original license under
`../research/` and copied into `source/` only for this local reference viewer.
The library is CC0 1.0.

The lab provides:

- exact scrubbing through idle, walk, formal walk, jog, sprint, and landing;
- an optional structural overlay for the major humanoid joints;
- canonical contact and passing-pose shortcuts;
- automatically sampled standing, walking, and running silhouette sheets;
- restrained near/far limb guides inside exported poses, derived directly from
  the rig, so overlapping hands and feet remain distinguishable;
- a separate image-generation pose guide with an intact outer contour,
  borderless rig-clipped regions, and a grayscale value for every depth layer.
  Region fills overlap slightly at joints so no unpainted wedges remain, while
  the authored silhouette boundary is retained through transparency without a
  separately colored outline. Hands are painted only with their respective
  arms and therefore share exactly the same depth;
- PNG export for each approved sheet.

The next stage is to approve these human pose references in isolation. Only
after that approval may they be used as pose constraints for complete
full-body character frames. Generated character artwork must not be used as
the motion authority, and generating an image does not complete the sprite
pipeline: splitting, normalization, integration, sequence playback, and visual
review still have to follow.

The currently approved exports are kept outside the runtime asset tree under
`../research/silhouettes/`. This keeps the reference material isolated until a
character cycle passes visual review.

Open this viewer at `/demos/world-movement/motion-reference/` while the local
Caatuu runtime is running.
