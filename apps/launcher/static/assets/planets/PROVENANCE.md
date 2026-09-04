# Planet emblem provenance

This record covers `conjugation-comet.png`, the selected catalog-only
`naturalization-nucleus.png`, the user-designated `sounds-quasar.png`
placeholder, the four reviewed `agreement-aurora.png` revisions, and the exact
Campaign Mode alias described below. It does not establish or extend
provenance, ownership, or release permission for the older Word World, Case
Cosmos, Memory Moon, and Verb Nebula assets in this directory.

## Canonical runtime filenames

Every enabled planet emblem uses the game ID as its filename. Generic lettered
filenames are retired and must not be reintroduced.

| Game ID | Runtime filename |
| --- | --- |
| `word-net` | `word-world.png` |
| `verb-lab` | `verb-nebula.png` |
| `conjugation-comet` | `conjugation-comet.png` |
| `case-cosmos` | `case-cosmos.png` |
| `agreement-aurora` | `agreement-aurora.png` |
| `memory-moon` | `memory-moon.png` |
| `sound-quasar` | `sounds-quasar.png` |
| `campaign` | `campaign-mode.png` |

`naturalization-nucleus.png` is the canonical Mandarin development-runtime art
for Naturalization Nucleus. It is wired into the shared launcher and the
Mandarin offline/setup catalogs, while remaining absent from the Czech course.

## Sounds Quasar placeholder emblem

| Field | Value |
| --- | --- |
| Runtime path | `apps/launcher/static/assets/planets/sounds-quasar.png` |
| Source | Existing user-designated local asset supplied for integration on 2026-09-04; earlier creation history is not recorded here |
| Final dimensions | 1254 x 1254 pixels |
| Final byte count | 790655 |
| Final SHA-256 | `aca07dcd615c021c00896ecd8698f14cf2f47522a64dc9e2a2cb539dc9a88e64` |
| Runtime status | Shared coming-later placeholder for every browser course |
| Release status | Follow each course's release allowlist; the placeholder is not gameplay authority |
| Attribution decision | Pending explicit owner decision |

The product owner explicitly selected this existing file for the shared
Sounds Quasar placeholder. That selection authorizes its repository and local
course integration, but this record does not infer an origin, third-party
license, public redistribution grant, or assessed audio/content authority.

## Naturalization Nucleus catalog emblem v1

| Field | Value |
| --- | --- |
| Stable evidence ID | `CAATUU-IMAGEGEN-NATURALIZATION-NUCLEUS-2026-08-31` |
| Runtime path | `apps/launcher/static/assets/planets/naturalization-nucleus.png` |
| Generator | OpenAI ImageGen, built-in `image_gen.imagegen` workflow |
| Generation mode | `stylized-concept` |
| Selected on | 2026-08-31 |
| Source | User-selected task-local ImageGen result reattached in the selection request; no third-party source URL |
| Selected-source byte count | 978138 |
| Selected-source SHA-256 | `49f0940852ae456de82b6e64e87f4585195fd862ede3ed7c731f9b6ad925dee1` |
| Final dimensions | 1254 x 1254 pixels |
| Final format | 8-bit RGBA PNG |
| Final byte count | 932587 |
| Final SHA-256 | `ac7954074fc337d42d3f1610f55c7f5e60dff722a6d9d0794972a13737d105cd` |
| Visible alpha bounds | Half-open bounds `x=[131, 1190)`, `y=[66, 1125)`; all four corner alpha values are zero |
| Alpha counts | 732880 fully transparent, 5271 partially transparent, and 834365 fully opaque pixels |
| Runtime status | Mandarin development runtime; wired into navigation and delivery manifests |
| Release status | `local-developer-preview-only` |
| Intended surfaces | Caatuu browser developer preview and Android developer preview |
| Attribution decision | Pending explicit owner decision |

### Style reference

`apps/launcher/static/assets/planets/word-world.png` was supplied to ImageGen as
a style reference only. The prompt explicitly prohibited editing, tracing, or
copying its continents. This record does not infer a license or redistribution
grant from the reference.

### Selected generation prompt

```text
Use case: stylized-concept
Asset type: review option C for the Caatuu game-world emblem "Naturalization Nucleus"
Input images: Image 1 is the primary style reference only. Do not edit, trace, or copy its continents.
Primary request: Create an original planet emblem in the same simple visual language as Word World. Show a mostly intact circular globe with one broad curved section of the outer shell neatly opened like a hinged puzzle piece, revealing the planet's interior: an orange mantle, a golden inner layer, and a large bright creamy nucleus centered inside. Keep every shape broad and connected; the opened section remains attached to the planet and does not float.
Style/medium: friendly polished 2D icon; rounded puzzle-like vector forms; subtle depth only; crisp edges; restrained highlights; same flat, readable, toy-like material treatment as Word World.
Composition/framing: centered front-facing round planet, fully contained with generous even padding; the cutaway is obvious but the planet silhouette stays compact and nearly circular.
Color palette: turquoise/teal outer shell with golden yellow, warm orange, creamy off-white, and restrained near-black separation channels.
Constraints: original design; genuinely transparent background; opaque solid forms; core clearly visible at the geometric center; no detached fragments; no orbit ring; no text; no flags; no people; no faces; no watermark; no cast shadow; no outer glow.
Avoid: glossy droplets, spiral shapes, generic Saturn, realistic geology, mechanical details, tiny particles, copied continents, scenery.
```

### Post-processing

The selected image already had a transparent background, but its solid subject
was encoded almost entirely at alpha values 248–254. The established offline
`caatuu-animated-fabric-cutout:core-py312` container normalized only the alpha
matte: values at or below 8 became transparent, values at or above 248 became
opaque, and the narrow interval between them was remapped with a smoothstep
curve to preserve antialiasing. RGB artwork, dimensions, and composition were
not changed.

### Review and release limits

The product owner explicitly selected this visual option and subsequently
requested its Naturalization Nucleus runtime integration. That approval does
not by itself establish a public redistribution license or attribution
decision. The exact hashed file may be used on the intended developer-preview
surfaces while those release questions remain pending.
Any regenerated, repainted, resized, or otherwise byte-different derivative
requires a new identity, hash, and review record.

## Conjugation Comet emblem v1

| Field | Value |
| --- | --- |
| Stable evidence ID | `CAATUU-IMAGEGEN-CONJUGATION-COMET-2026-08-02` |
| Runtime path | `apps/launcher/static/assets/planets/conjugation-comet.png` |
| Generator | OpenAI ImageGen, built-in `image_gen.imagegen` workflow |
| Generation mode | `stylized-concept` |
| Generated on | 2026-08-02 |
| Source | Original task-local ImageGen result; no third-party source URL |
| Final dimensions | 1254 x 1254 pixels |
| Final format | 8-bit RGBA PNG, non-interlaced |
| Final byte count | 534082 |
| Final SHA-256 | `78e59571a850aa92a3c3d6862f676d1b7fad54137b8ad10a74ef2eaaba20fee0` |
| Visible alpha bounds | Half-open bounds `x=[158, 1143)`, `y=[135, 1101)`; all four corner alpha values are zero |
| Release status | `local-developer-preview-only` |
| Intended surfaces | Caatuu browser developer preview and Android developer preview |
| Attribution decision | Pending explicit owner decision |

### Style references

The following repository assets were supplied to ImageGen as style references
only. The prompt explicitly prohibited editing or copying them:

- `apps/launcher/static/assets/planets/case-cosmos.png`
- retired predecessor `apps/launcher/static/assets/planets/planet_D.png`
  (`23aab30a20c4e348ba9cda0fe4cd2224f65671ee9b4c135caae9b4bf19645a1`)
- `apps/launcher/static/assets/planets/verb-nebula.png`

This record does not infer a license or redistribution grant from those
references.

### Final generation prompt

```text
Use case: stylized-concept
Asset type: square game-world emblem for the Caatuu language-learning game "Conjugation Comet"
Input images: Images 1–3 are style references only; do not edit or copy them.
Primary request: create one original comet emblem that belongs naturally beside the referenced Caatuu planet and nebula assets. The mark should communicate fast, progressive verb-form practice through a compact comet silhouette: a rounded comet head with two or three broad, flowing ribbon-like tails that feel sequential and connected.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal. The background must be one uniform color with no shadows, gradients, texture, reflections, floor plane, lighting variation, stars, or scenery.
Style/medium: polished 2D/3D hybrid game icon; rounded vector-like forms; smooth organic curves; subtle internal dimensional shading; crisp clean edges; strong readable silhouette at small size; match the visual material and polish of the reference assets.
Composition/framing: single centered comet emblem, diagonal but balanced, fully contained with generous padding on every side. No cropping.
Color palette: the established Caatuu palette—turquoise/teal, warm orange, golden yellow, creamy off-white, and restrained near-black separation channels. Do not use #ff00ff anywhere in the subject.
Constraints: original design; opaque solid comet and tail shapes suitable for clean chroma-key removal; no outer glow, no smoke, no translucent particles, no cast shadow, no contact shadow, no reflection, no text, no letters, no numbers, no watermark, no border, no mockup.
Avoid: realistic astronomy, flames, sharp aggressive spikes, tiny decorative details, extra planets, character faces, logos or trademarks.
```

### Post-processing

The generated flat `#ff00ff` background was converted to transparency with the
bundled ImageGen `remove_chroma_key.py` helper inside the existing
`caatuu-animated-fabric-cutout:core-py312` container. A final matte-cleanup pass
removed faint corner residue. The accepted output has a transparent safety
border and the exact dimensions and SHA-256 recorded above. No other
modification is authorized or implied by this record.

### Review and release limits

The product owner requested this emblem and its integration, but that request
is not by itself an explicit public redistribution license, attribution
decision, or native-release approval. The exact hashed file may be used on the
intended developer-preview surfaces only until the owner records a release
grant and attribution decision and reviews the emblem at its browser and native
Android display sizes. Any regenerated, repainted, resized, or otherwise
byte-different derivative requires a new identity, hash, and review record.

## Agreement Aurora emblem v1 (superseded)

| Field | Value |
| --- | --- |
| Stable evidence ID | `CAATUU-IMAGEGEN-AGREEMENT-AURORA-2026-08-11` |
| Runtime path | `apps/launcher/static/assets/planets/agreement-aurora.png` |
| Generator | OpenAI ImageGen, built-in `image_gen.imagegen` workflow |
| Generation mode | `stylized-concept` |
| Generated on | 2026-08-11 |
| Source | Original task-local ImageGen result; no third-party source URL |
| Chroma-source SHA-256 | `3a546b28c32ad3043dbe1e323fc297574ce88c0b514c378815841fc2a7649120` |
| Final dimensions | 1254 x 1254 pixels |
| Final format | RGBA PNG |
| Final byte count | 886587 |
| Final SHA-256 | `4427e6f9ea952084e3446c038c8fe9ebfa5d0faf1defdd5c3a887ba25d99a6bd` |
| Visible alpha bounds | Half-open bounds `x=[161, 1093)`, `y=[131, 1087)`; all four corner alpha values are zero |
| Release status | `local-developer-preview-only` |
| Intended surfaces | Caatuu browser developer preview and Android developer preview |
| Attribution decision | Pending explicit owner decision |

### Style references

The following repository assets were supplied to ImageGen as style references
only. The prompt explicitly prohibited editing, tracing, or copying their
subjects:

- `apps/launcher/static/assets/planets/word-world.png`
- `apps/launcher/static/assets/planets/memory-moon.png`
- `apps/launcher/static/assets/planets/conjugation-comet.png`

This record does not infer a license or redistribution grant from those
references.

### Final generation prompt

```text
Use case: stylized-concept
Asset type: square game-world emblem for the Caatuu language-learning game "Agreement Aurora"
Input images: Images 1–3 are style references only; do not edit, trace, or copy their subjects.
Primary request: Create one original emblem that communicates Czech grammatical agreement: several distinct connected word-parts changing together in harmony. Depict a small welcoming celestial core embraced by three broad interlocking aurora ribbons. The ribbons should visibly belong together, align with one another, and flow as a coordinated system rather than as separate decoration.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal. The background must be one uniform color with no shadows, gradients, texture, reflections, floor plane, lighting variation, stars, or scenery.
Subject: one compact aurora-world emblem. Use three opaque ribbon shapes—turquoise/teal, warm orange/golden yellow, and creamy off-white—woven or nested around a small rounded core. The resulting silhouette must be clearly different from a Saturn-like ringed planet and clearly different from a comet or spiral nebula.
Style/medium: polished rounded 2D/3D hybrid game icon; vector-like organic forms; subtle internal dimensional shading; crisp clean edges; restrained material texture; match the friendly polish and color language of the supplied Caatuu references.
Composition/framing: single centered emblem, approximately circular overall, fully contained with generous even padding. Strong readable silhouette at 64–128 px.
Color palette: turquoise/teal, warm orange, golden yellow, creamy off-white, with restrained near-black separation channels. Do not use #ff00ff anywhere in the subject.
Constraints: original design; opaque solid subject shapes suitable for clean chroma-key removal; no transparency inside the subject; no cast shadow; no contact shadow; no outer glow; no reflection; no text; no letters; no numbers; no watermark; no border; no mockup.
Avoid: generic Saturn icon, rings around a plain sphere, realistic astronomy, flames, smoke, wispy translucent light, tiny decorative details, stars, faces, characters, logos, trademarks, and resemblance to any one reference subject.
```

### Post-processing

The generated flat magenta background was converted to transparency with the
installed ImageGen `remove_chroma_key.py` helper inside the established
`caatuu-dev` container. The helper sampled `#f904f7` from the border and used a
soft matte plus despill. The result contains 875616 fully transparent pixels
and 3249 partially transparent antialiasing pixels out of 1572516 total
pixels. No other image modification was applied.

### Review and release limits

The product owner requested this emblem, its canonical filename, and its
integration. That request does not by itself establish a public redistribution
license or attribution decision. The exact hashed file may be used on the
intended developer-preview surfaces until the owner records a release grant
and reviews it at browser and native Android display sizes. Any regenerated,
repainted, resized, or otherwise byte-different derivative requires a new
identity, hash, and review record.

## Agreement Aurora emblem v2

This revision restores the later reviewed rendezvous emblem that was preserved
in release-baseline recovery storage while the canonical runtime path still
contained v1. It replaces v1 at the same stable runtime path so the setup
manifest can deliver the corrected artwork to Android by its new byte hash.

| Field | Value |
| --- | --- |
| Recovered source | `artifacts/research/release-baseline-replaced-assets-2026-08-13/agreement-aurora-art-2.png` |
| Runtime path | `apps/launcher/static/assets/planets/agreement-aurora.png` |
| Final dimensions | 1254 x 1254 pixels |
| Final format | 8-bit RGBA PNG |
| Final byte count | 1511588 |
| Final SHA-256 | `abfc3a443f60e1a1c2f4c16fbb2cda0e20f46b4daeb75bdc35d3b99718cc79a6` |
| Release status | `local-developer-preview-only` |
| Intended surfaces | Caatuu browser developer preview and Android developer preview |
| Attribution decision | Pending explicit owner decision |

The recovered file is preserved byte-for-byte; this integration does not claim
new generation provenance or broader redistribution permission.

## Agreement Aurora emblem v3 (superseded)

This revision replaces the paired rendezvous emblem with a single round world
crowned by a coordinated three-band northern aurora. It keeps the canonical
runtime filename while bringing the subject into the same planet family as the
other Caatuu world emblems.

| Field | Value |
| --- | --- |
| Stable evidence ID | `CAATUU-IMAGEGEN-AGREEMENT-AURORA-2026-08-31` |
| Runtime path | `apps/launcher/static/assets/planets/agreement-aurora.png` |
| Generator | OpenAI ImageGen, built-in `image_gen.imagegen` workflow |
| Generation mode | `stylized-concept` |
| Generated on | 2026-08-31 |
| Source | Original task-local ImageGen result; no third-party source URL |
| Chroma-source byte count | 1328985 |
| Chroma-source SHA-256 | `2c0080cbf71f0d9ee389949ccd639200ee091276ffce8da4bf2e98f28c40205f` |
| Final dimensions | 1254 x 1254 pixels |
| Final format | 8-bit RGBA PNG |
| Final byte count | 1019766 |
| Final SHA-256 | `b2d2e0299701c2fb4e34daee37dcb93ab687877fc6589342e823b31306585bd7` |
| Visible alpha bounds | Half-open bounds `x=[162, 1185)`, `y=[30, 1194)`; all four corner alpha values are zero |
| Alpha counts | 706001 fully transparent, 3423 partially transparent, and 863092 fully opaque pixels |
| Release status | `local-developer-preview-only` |
| Intended surfaces | Caatuu browser developer preview and Android developer preview |
| Attribution decision | Pending explicit owner decision |

### Style references

The following images were supplied to ImageGen as style references only. The
prompt explicitly prohibited editing, tracing, or copying their subjects:

- user-selected task-local Naturalization Nucleus concept supplied in the
  request as `codex-clipboard-58d945de-cc65-4c0b-bd73-6e808892c3b5.png`
- `apps/launcher/static/assets/planets/word-world.png`

This record does not infer a license or redistribution grant from either
reference.

### Final generation prompt

```text
Use case: stylized-concept
Asset type: square game-world emblem for the Caatuu language-learning game "Agreement Aurora"
Input images: Image 1 is the primary style reference selected by the user; Image 2 is a supporting Caatuu planet reference. Use both only for visual language, palette, rounded geometry, and polish. Do not edit, trace, or copy either subject.
Primary request: Create one original, unmistakably round planet crowned by a very large aurora over its north pole. The lower two-thirds should read clearly as a complete globe with broad teal oceans and a few simple warm orange, golden-yellow, and creamy abstract land shapes separated by bold near-black channels. Across and above the entire northern third, form one spectacular aurora crown from three broad connected ribbon curtains. The ribbons should rise from the north polar horizon and sweep upward in a graceful wave from west to east, visibly belonging to the planet rather than floating elsewhere.
Subject meaning: agreement is expressed through the three aurora ribbons moving together in one coordinated flow. They remain distinct teal/cream/gold-orange bands but align, overlap, and resolve into one harmonious northern crown.
Scene/backdrop: perfectly flat solid #ff00ff magenta chroma-key background for local background removal. The background must be a single uniform color with no transparency, checkerboard, gradient, texture, stars, scenery, floor, reflection, shadow, or lighting variation. Do not use #ff00ff anywhere in the subject.
Style/medium: friendly polished 2D game icon; rounded vector-like forms; bold near-black separation channels; crisp clean edges; subtle controlled highlights and gentle dimensional shading; match the selected core planet's lively toy-like finish while keeping the simpler readability of Word World. The aurora should be stylized as solid broad ribbons, not realistic wispy light.
Composition/framing: centered front-facing circular planet, fully contained. The planet body occupies most of the lower canvas; the large aurora crown fills the upper area without touching the canvas edge. Generous even magenta safety padding on all four sides. Strong readable silhouette at 64–128 px.
Color palette: Caatuu turquoise/teal, warm orange, golden yellow, creamy off-white, with restrained near-black channels. Use the brightest cream and gold on the aurora so the northern crown is the focal point.
Constraints: original design; fully opaque solid subject suitable for clean chroma-key removal; one planet only; one coordinated three-band aurora; no detached fragments; no transparency inside the subject; no cast shadow; no contact shadow; no outer glow; no text; no letters; no numbers; no flags; no people; no faces; no watermark; no border; no mockup.
Avoid: the current Agreement Aurora's two opposing crescent/comet forms, paired objects, central collision, ringed Saturn, spiral nebula, realistic Earth continents, realistic thin aurora rays, wispy translucency, tiny particles, stars, excessive gloss, copied land shapes, logos, or trademarks.
```

### Post-processing

The generated flat magenta background was converted to transparency with the
bundled ImageGen `remove_chroma_key.py` helper inside the established offline
`caatuu-animated-fabric-cutout:core-py312` container. The helper sampled
`#f603f7` from the border and used a soft matte with transparent threshold 48,
opaque threshold 128, and despill cleanup. No other image modification was
applied.

### Review and release limits

The product owner requested this redraw and supplied the selected style
direction. That request does not by itself establish a public redistribution
license or attribution decision. The exact hashed file may be used on the
intended developer-preview surfaces until the owner records a release grant
and reviews it at browser and native Android display sizes. Any regenerated,
repainted, resized, or otherwise byte-different derivative requires a new
identity, hash, and review record.

## Agreement Aurora emblem v4

This revision replaces the flame-like solid crown from v3 with the
user-approved aurora-borealis design: a broad horizontal polar curtain with
vertical light rays above a complete planet. A second built-in ImageGen edit
removed the generated checkerboard and produced native alpha before the final
matte normalization.

| Field | Value |
| --- | --- |
| Stable evidence ID | `CAATUU-IMAGEGEN-AGREEMENT-AURORA-BOREALIS-2026-08-31` |
| Runtime path | `apps/launcher/static/assets/planets/agreement-aurora.png` |
| Generator | OpenAI ImageGen, built-in `image_gen.imagegen` generation and edit workflows |
| Generation mode | `stylized-concept`, followed by `background-extraction` |
| Approved on | 2026-08-31 |
| Source | Original task-local ImageGen result and task-local transparency edit; no third-party source URL |
| Approved-design source byte count | 1479348 |
| Approved-design source SHA-256 | `b82261f8a434838b2bcff056fdd455a1ef3bf24491c54ec2f54ee51d5c44c28c` |
| Native-alpha edit byte count | 1303111 |
| Native-alpha edit SHA-256 | `1b9a7f924762c4199b6d40718848dfaf1b7c14021ea218aa0ce22f63874d4f44` |
| Final dimensions | 1254 x 1254 pixels |
| Final format | 8-bit RGBA PNG |
| Final byte count | 1258690 |
| Final SHA-256 | `5fe5c25467d51dbec0c7e6600f187a685ccb0d42c34a47c3d1a737d2b6051966` |
| Visible alpha bounds | Half-open bounds `x=[103, 1158)`, `y=[75, 1191)`; all four corner alpha values are zero |
| Alpha counts | 627388 fully transparent, 64952 partially transparent, and 880176 fully opaque pixels |
| Release status | `local-developer-preview-only` |
| Intended surfaces | Caatuu browser developer preview and Android developer preview |
| Attribution decision | Pending explicit owner decision |

### Style references

The following repository images were supplied to the design generation as
style references only. The prompt explicitly prohibited editing, tracing, or
copying their subjects:

- `apps/launcher/static/assets/planets/naturalization-nucleus.png`
- `apps/launcher/static/assets/planets/word-world.png`

This record does not infer a license or redistribution grant from either
reference.

### Approved design prompt

```text
Use case: stylized-concept
Asset type: review candidate for the Caatuu game-world emblem "Agreement Aurora"
Input images: Image 1 is the user-selected Caatuu style anchor; Image 2 is a supporting Caatuu planet style reference. Use them only for palette, rounded icon geometry, bold separation channels, and polish. Do not edit, trace, or copy their subjects.
Primary request: Create one original round planet with a large, unmistakable aurora borealis over the north pole. The planet is viewed slightly from above so the curved northern horizon is visible. Above that horizon, a wide luminous auroral curtain stretches horizontally from left to right across nearly the full width of the planet. It forms a graceful shallow arc that follows the planet's curvature, with several soft vertical folds and downward light curtains. The aurora must look like northern lights in the sky—not fire, hair, feathers, flames, a crown, or solid upward spikes.
Planet: a complete spherical world with a deep teal-to-navy northern hemisphere and a few broad simple warm orange, golden-yellow, and cream surface regions separated by restrained near-black channels. Keep the surface secondary to the aurora.
Aurora structure: three coordinated nested light curtains in luminous turquoise-green, pale cyan, and creamy golden-white. They overlap gently as one broad rippling band. Use smooth horizontal waves, subtle vertical striations, softly fading lower edges, and a calm polar glow along the northern horizon. No individual ribbon should have a pointed tip.
Scene/backdrop: genuinely transparent canvas with generous transparent padding. No stars, scenery, floor plane, cast shadow, or background color.
Style/medium: polished friendly 2D game icon; rounded vector-like planet forms; aurora painted as soft translucent light curtains with controlled glow; crisp planet edges; restrained dimensional shading; visually compatible with the supplied Caatuu references while allowing the aurora itself to be atmospheric and luminous.
Composition/framing: centered compact circular planet occupying the lower two-thirds; broad aurora spanning the upper third, clearly above the north pole and fully contained. Strong silhouette at 64–128 px.
Color palette: deep teal/navy planet, Caatuu turquoise, warm orange, golden yellow, creamy off-white; aurora adds natural mint-green and pale cyan light.
Constraints: original design; one planet only; aurora confined to the northern polar region; no text; no letters; no flags; no people; no faces; no watermark; no border; no mockup.
Avoid: flame shapes, fire colors dominating the aurora, solid pointed plumes, crown silhouette, three giant solid swooshes, wings, hair, feathers, ocean waves, Saturn rings, spiral nebula, realistic Earth continents, tiny particles, logos, or trademarks.
```

### Transparency edit prompt

```text
Use case: background-extraction
Asset type: production-ready Caatuu game-world emblem for "Agreement Aurora"
Input images: Image 1 is the exact approved edit target.
Primary request: Remove the entire gray-and-white checkerboard background and replace it with genuine transparent alpha. Preserve the planet and aurora borealis exactly.
Invariants: keep the exact planet geometry, northern viewpoint, land shapes, colors, black separation channels, broad horizontal auroral curtain, vertical light rays, mint/cyan/cream bands, glow, proportions, framing, and composition. Do not redraw, simplify, reposition, recolor, crop, or add anything.
Transparency: the canvas outside the planet and aurora must be alpha 0. Preserve the aurora's intentional soft translucent edges and glow with smooth partial alpha. Keep the solid planet interior fully opaque. Provide clean antialiased edges with no checkerboard pixels, white boxes, gray boxes, fringe, halo, or background residue.
Constraints: change only the background/matte; no cast shadow; no border; no text; no watermark; no new elements.
```

### Post-processing

The native-alpha ImageGen edit encoded almost all solid artwork at alpha values
248–254. The established offline
`caatuu-animated-fabric-cutout:core-py312` container normalized only the alpha
matte: values at or below 8 became transparent, values at or above 248 became
opaque, and the interval between them was remapped with a smoothstep curve.
This preserved the aurora's partially transparent curtain edges while making
the planet and bright curtain interior production-opaque. RGB artwork,
dimensions, and composition were not changed.

### Review and release limits

The product owner explicitly approved the aurora-borealis design and requested
native alpha transparency. That approval does not by itself establish a public
redistribution license or attribution decision. The exact hashed file may be
used on the intended developer-preview surfaces until the owner records a
release grant and reviews it at browser and native Android display sizes. Any
regenerated, repainted, resized, or otherwise byte-different derivative
requires a new identity, hash, and review record.

## Campaign Mode emblem alias v1

Campaign Mode intentionally reuses the existing spacecraft illustration as a
byte-identical logical alias. It owns no new artwork and does not alter the
source asset.

| Field | Value |
| --- | --- |
| Source path | `apps/launcher/static/assets/visual-vocabulary/miscellaneous (7).png` |
| Runtime path | `apps/launcher/static/assets/planets/campaign-mode.png` |
| Final dimensions | 115 x 224 pixels |
| Final format | RGBA PNG |
| Final byte count | 75480 |
| Source and runtime SHA-256 | `7a520ce44254c280ab463fcf0f5eb273ccdcbd29f7a3771e0d2843f8b825f4aa` |

This alias inherits the source asset's provenance and release limits; copying
it into the planet catalog does not establish additional rights.
