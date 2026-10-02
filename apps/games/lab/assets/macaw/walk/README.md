# Macaw walking and standing source

**Use this folder for the current walking animation.** It contains the selected
40 walking PNGs and five standing PNGs. The live Scenery lab reads these exact
files; there is no generated candidate or separate runtime copy to find.

- `images/`: transparent 512 × 512 source frames. `e-walk-01.png` through
  `e-walk-08.png` are one full cycle; `e-idle-v1.png` is standing. The same
  naming applies to `s`, `sw`, `ne` and `n`.
- `manifest.json`: frame hashes, eight direction mappings, scale information
  and the walking profile. W mirrors E, NW mirrors NE, and SE mirrors SW.
- `strips/`: eight editable horizontal PNGs. Every strip has nine 512-square
  cells: standing, then walking poses 1–8; mirrored directions are baked in.
- `stride-calibration.json`: source pixel measurements and conversion rules.
- `provenance/`: generation prompts, source-video selection, registration,
  volume normalization and original-video hashes. Historical working paths in
  these records describe the inputs used before temporary images were removed.
- `review/`: full loops, all 45 poses at a common scale, and contrasting edge
  backgrounds. [Open the pose review](review.html).

The original five videos remain at
`C:\Work\caatuu\artifacts\research\world-movement\source\macaw-walking`.
The four October 1–2 extraction/regeneration workspaces and two temporary lab
copies are retired after source and served-byte verification. Earlier unrelated
motion research and the historical curated workshop are retained.

## Walking speed and actor size

The two side-profile transfer poses give an average step of 136.698 pixels,
or 273.397 pixels per full two-step cycle. Eight poses at eight frames per second
give a nominal one-second cycle.

`cycle distance = stride pixels / 512 × displayed canvas world size`

`speed = cycle distance × frames per second / poses per cycle`

The regular full canvas spans 2.1 world units, giving 1.121354 world units per
second and 0.560677 units per step. Halving actor size halves both distances and
speed; cadence stays the same. Camera zoom changes sprite and ground pixels by
the same factor, so it does not change the conversion. The isometric ground
projection applies to both root travel and projected stride in every direction.

Playback advances from actual distance consumed along the route, including
corners and a partial final step. Changing Size mid-route preserves the current
phase and applies the new scale to subsequent travel. The Scenery lab currently
walks every route; running will receive its own profile with future artwork.

This is average stride calibration. Eight held drawings and regenerated foot
shapes do not provide continuous exact foot locking. Do not rescale each pose
independently to tune speed. The volume rule remains one factor per angle,
shared by standing and all eight poses, targeting 66,000 alpha-weighted pixels.

Recalculate measurements only after reviewing changed source poses:

```powershell
docker exec -w /workspace caatuu-dev python apps/games/caatuu-game/tooling/calibrate-walking.py
```

The PNGs remain read-only during calibration. Reload the existing service on
port 8765 after source or profile changes. [Open the movement demo](http://127.0.0.1:8765/games/lab/scenary).
