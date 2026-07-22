# Macaw traveler reference package v1

This is the approved AF-054 modeling reference package for the traveler macaw. Its four
authoritative views are ordered `front`, `left`, `back`, `right` on a common 512 x 704 RGB canvas,
one 1:1 source-sheet pixel scale, and zero-based ground row 664.

The views are generated and inferred references accepted for human-reviewed modeling. They are not
recovered geometry, a mesh, a rig, an animation, or hidden-surface truth. The legacy rig is retained
only as articulation evidence. The staff is separate and excluded from the first actor and walk;
a compatible hand socket is required later, but AF-054 does not invent its identifier.

Approval was recorded at `2026-07-22T06:34:51Z` by the `product_owner` under evidence ID
`CAATUU-AF054-OWNER-APPROVAL-2026-07-22`. `review/source-approval.json` preserves that separately supplied decision;
`approval.json` carries its normative fields and binds the exact canonical `reference.json` hash and
ordered view-set digest. `LICENSE-CC0.md` applies only to the eight exact PNG hashes it names.

The generated sheets retain their embedded C2PA claim bytes. Those claims were detected and
recorded but not cryptographically validated. Derived views deliberately omit copied metadata.

Reproduce into an ignored workspace and verify inside the offline Linux development container:

```bash
docker compose run --rm -v ../..:/caatuu:ro animated-fabric-dev \
  python scripts/prepare_macaw_reference_package.py prepare \
  --review /workspace/assets/reference-packages/macaw-traveler-v1/review/review.json \
  --approval /workspace/assets/reference-packages/macaw-traveler-v1/review/source-approval.json \
  --source-repository-root /caatuu \
  --out /workspace/.tmp/af054-rebuild/macaw-traveler-v1
docker compose run --rm animated-fabric-dev \
  python scripts/prepare_macaw_reference_package.py verify \
  --package /workspace/assets/reference-packages/macaw-traveler-v1
```
