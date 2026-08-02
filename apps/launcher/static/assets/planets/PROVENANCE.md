# Planet emblem provenance

This record covers only `conjugation-comet.png`. It does not establish or
extend provenance, ownership, or release permission for the older planet and
nebula assets in this directory.

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

- `apps/launcher/static/assets/planets/planet_B.png`
- `apps/launcher/static/assets/planets/planet_D.png`
- `apps/launcher/static/assets/planets/nebula.png`

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
