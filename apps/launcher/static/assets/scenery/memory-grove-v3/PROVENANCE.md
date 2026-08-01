# Memory Grove v3 provenance

Memory Grove v3 is an original modular scenery preview. Its terrain is created
at runtime from code-native geometry and colors; no ground painting, tile atlas,
or complete-scene image is used. The eight promoted PNGs each contain one
independently reusable object: two trees, one bush, one rock, one lantern, one
well, one arch, and one stone bridge.

## Generation authority

The objects were generated on 2026-08-01 in eight separate calls with OpenAI's
built-in ImageGen workflow. The approved simplified whole-map concept supplied
the palette, material language, 2:1 projection, and degree of simplification as
the shared style authority. It was not promoted as runtime terrain. Each object
prompt requested one isolated object, no scenery composition, no cast shadow,
no text, and a uniform `#ff00ff` background.

The generated originals are preserved under:

`C:/Work/tukevejtso/linux/workspaces/images/memory-moon-v3-modular-20260801/originals/`

One rejected overdetailed ground study is retained there as process history but
is neither catalogued nor shipped. It is not a source for any promoted object.

## Linux preparation

Preparation ran in the established Tukevejtso Linux environment. Automatic
border-key selection used a soft matte, transparent threshold 12, opaque
threshold 220, and despill. Every result was trimmed to its visible alpha bounds,
padded with 24 transparent pixels, and limited to a maximum dimension of 1,024
pixels. The resulting files use straight alpha and retain a transparent safety
border. The pipeline promoted eight objects from eight accepted sources with a
warning count of zero.

The manifest records the accepted source hash, output dimensions and hash,
single-object/reuse contract, inspected lower ground anchor, nominal display
height, and collision profile for every object. `SHA256SUMS` covers exactly the
eight promoted PNGs.

## Runtime scope

The first v3 layout places twenty object instances across seven back, six middle,
and seven front positions. The code-native terrain is one render batch with a
30 by 30 logical grid at 0.4 world units per cell. Eleven object placements have
simple gameplay footprints, accompanied by four continuous perimeter bodies.
Transparent art remains presentation-only; collision bodies are separate.

The stone bridge is a reusable edge landmark in this preview. It is placed
beyond the continuous walkable boundary, is deliberately not traversable in v3,
and must not be interpreted as a functioning path or level transition.

The bundle remains local-preview-only while its visual review and publication
record are completed. This provenance note does not infer a license from older
Memory Grove assets; v3 has no runtime dependency on the archived v1/v2 scenery.
