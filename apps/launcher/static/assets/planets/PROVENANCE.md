# Planet emblem provenance

This record covers `conjugation-comet.png`, the two reviewed
`agreement-aurora.png` revisions, and the exact Campaign Mode alias described
below. It does not establish or extend provenance, ownership, or release
permission for the older Word World, Case Cosmos, Memory Moon, and Verb Nebula
assets in this directory.

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
| `campaign` | `campaign-mode.png` |

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
