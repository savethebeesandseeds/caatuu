# Local reconstruction lab

AF-045 evaluates whether local single-image reconstruction can replace repeated
manual character modeling. It is intentionally separate from the product
runtime and from accepted actor packages.

## Hardware target

The initial acceptance machine has:

- NVIDIA RTX A2000 Laptop GPU, 8 GiB VRAM, compute capability 8.6;
- Intel Core i7-12800HX, 16 cores and 24 threads;
- 32 GiB system RAM; and
- Docker Desktop's Linux/amd64 engine with the NVIDIA runtime.

The baseline runs one image and one provider at a time. Parallel inference and
models requiring more than 8 GiB are out of scope.

## Boundaries

The lab owns two Compose services, one model volume, and one
provisioning-only range-staging volume:

| Service | Network | GPU | Model mount | Purpose |
|---|---|---|---|---|
| `animated-fabric-3d-lab-provision` | enabled | no | read/write | download exact pinned files and verify hashes |
| `animated-fabric-3d-lab` | none | all | read-only | offline doctor and inference |

Both images run as non-root, drop all capabilities, enable
`no-new-privileges`, expose no ports, and mount no Docker socket. Inference
mounts `workspaces/reconstruction/input/` read-only and writes only to
`workspaces/reconstruction/output/`. Both directories and the model volume are
outside Git. Transformers' disposable cache metadata is redirected to the
runtime tmpfs so its one-time migration never attempts to mutate the read-only
verified model volume.

The provisioner is a small, separate image pinned to Hugging Face Hub 1.22.0
and hf-xet 1.5.1. It contains no Torch, CUDA, TripoSR checkout, product package,
candidate implementation, or inference entry point. The offline inference image
retains Hub 0.17.3 solely because that is the newest version compatible with
TripoSR's pinned Transformers/Tokenizers stack. Both images share only the
verified model volume and the bounded reconstruction tool sources.

The 1.68 GB checkpoint uses the persistent provisioning-only staging volume.
Eight HTTP/1.1 range files append every received byte directly to that volume,
survive container replacement, and are assembled only after every range reaches
its exact size. The provisioner verifies the complete checkpoint byte count and
SHA-256 before atomically publishing it into the normal Hub snapshot. Hub/Xet
then provisions only the small pinned configuration files and performs the same
committed snapshot verification. Offline inference never mounts the staging
volume.

## Model identities

| Component | Immutable identity | Runtime role |
|---|---|---|
| TripoSR source | `d26e33181947bbbc4c6fc0f5734e1ec6c080956e` | model implementation |
| TripoSR model | `stabilityai/TripoSR@5b521936b01fbe1890f6f9baed0254ab6351c04a` | reconstruction checkpoint and configuration |
| DINO config | `facebook/dino-vitb16@f205d5d8e640a89a2b8ef0369670dfc37cc07fc2` | tokenizer architecture configuration only |
| PyTorch | `2.2.2+cu118` CPython 3.12/Linux wheel, SHA-256 `c0fa31b7...d4aec` | GPU inference runtime compatible with the host NVIDIA driver |
| PyMCubes | version `0.1.6`, wheel SHA-256 `ea366a20...308a5` | CPU surface extraction after GPU density evaluation |

The committed `tools/reconstruction/model-manifest.json` records exact sizes
and SHA-256 values for every model file used at runtime. The approximately
1.68 GB checkpoint is never committed or baked into the image.

Both dependency-install steps use one locked BuildKit pip cache. Interrupted
image builds therefore reuse already downloaded transitive wheels while the
cache itself remains outside the final runtime image. The cache path is set
explicitly rather than inferred from the non-root runtime `HOME`, so build-time
pip cannot silently disable it on an ownership check. The image pins pip 25.2,
the first stable pip release with automatic download resumption, and allows up
to 240 resume attempts for the large CUDA runtime wheels.

The larger PyTorch wheel is fetched as four resumable, hash-verified HTTP/1.1
ranges in its own locked BuildKit cache. This avoids observed CDN HTTP/2 stream
resets without weakening the final byte-count or SHA-256 check.

The core identities and tested image digests are reproducible evidence, not a
claim that a future OCI rebuild will be byte-identical. Every Python artifact
is version-and-SHA locked for Linux x86-64 / CPython 3.12, including the one
source-only Antlr runtime and its pinned local build tools. Debian packages
still resolve from live Bookworm repositories without an immutable snapshot;
that remains a release-hardening gate, and the accepted image digests identify
the exact local environments tested here.

## Prepare an input

Reconstruction requires a reviewed RGBA cutout. Do not let TripoSR download or
run a second background-removal system. Copy a rights-cleared source into the
cutout input workspace and run the documented self-contained cutout profile:

```bash
mkdir -p workspaces/cutout/input workspaces/cutout/output
docker compose --profile cutout run --rm animated-fabric-cutout \
  image /input/subject.png /output/subject-cutout.png \
  --engine birefnet --device cpu
```

Review the cutout before copying the derived RGBA PNG into
`workspaces/reconstruction/input/`. Sources remain immutable.

## Build and provision

```bash
docker compose --profile reconstruction build animated-fabric-3d-lab
docker compose --profile reconstruction-provision run --rm \
  animated-fabric-3d-lab-provision
docker compose --profile reconstruction run --rm animated-fabric-3d-lab doctor
```

`doctor` must report the GPU and all three pinned runtime files as `ok` while
the service has no network. Provisioning resumes partial files in the
project-owned cache, uses at most two snapshot workers, and gives snapshot
metadata requests 30 seconds. The pinned Hub 1.22.0/Xet provisioner resumes
automatically and allows five-minute file reads for configuration artifacts.
The checkpoint's bounded range downloader persists partial bytes independently
of Xet buffering. The same Python tool also passes the legacy explicit resume
flag when tested with older Hub clients. An interrupted provisioning command
may be rerun without discarding either cache.

## Run a proposal

```bash
docker compose --profile reconstruction run --rm animated-fabric-3d-lab \
  reconstruct /input/subject-cutout.png \
  --candidate-id subject-triposr-r1 \
  --chunk-size 4096 \
  --mc-resolution 256 \
  --foreground-ratio 0.85
```

Start at chunk size 4096. If the 8 GiB GPU cannot complete surface extraction,
retry as a new candidate with 2048. Candidate IDs are immutable; the tool never
silently replaces a previous result.

The output is a closed proposal:

```text
workspaces/reconstruction/output/subject-triposr-r1/
|-- candidate.json
|-- input.png
`-- mesh.glb
```

`input.png` is the deterministic 512 × 512 gray-composited model input.
`mesh.glb` contains vertex colors and no rig or animation. `candidate.json`
binds source, normalized input, model revisions, parameters, mesh hash and
structure, GPU observation, and review status.

Render the immutable proposal through the existing isolated Blender worker:

```bash
bash scripts/run_reconstruction_candidate_review.sh subject-triposr-r1
```

The Linux runner reuses the repository-owned Blender image, mounts the
candidate and current AF-045 review sources read-only, disables the network and
authored script execution, and publishes exactly four fixed views plus
`review.json` under
`workspaces/blender/af045-subject-triposr-r1-review/`. Pass `--build` only when
the pinned Blender image does not already exist.

## Review and next gate

Acceptance is not based on the front view alone. Render the proposal at fixed
front, side, rear, and three-quarter cameras and evaluate:

- recognizable identity and silhouette;
- plausible hidden surfaces, clearly labeled as generated;
- connectedness, holes, self-intersection, triangle count, and bounds;
- stable feet/ground and readable limbs;
- whether a canonical avian skeleton can be placed without destructive
  remeshing; and
- whether a second clean run repeats the normalized input and GLB bytes.

Do not average vertices across candidates. Select the strongest valid proposal,
or align and compare/fuse candidates in rendered, point, voxel, or
signed-distance space. Only a later ticket may normalize a reviewed candidate
into `animated-fabric.actor-package.v1` and attempt automatic rigging.

## AF-045 observed result

The baseline was accepted on 2026-07-24 on the hardware above.

### Input lineage

The rights-cleared AF-054 `views/front.png`, cutout input, and their
byte-identical 434,460-byte RGB image have SHA-256
`386ff6120a72d88e171eef570b771b277c4455e9930e5e38d821146d247fbbb2`.
The self-contained BiRefNet plane used
`ZhengPeng7/BiRefNet@e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4` on CPU
with the `balanced` preset, 1024 px model input, alpha floor 24, and alpha
ceiling 250. Its reviewed 512 x 704 RGBA result is 512,129 bytes with SHA-256
`90395fe10f35d0693825919f450f71e5d5b76377cc87ab4fd09ae0706f6828bd`.
The reconstruction input is byte-identical to that result.

The provisioner published the exact 1,677,246,742-byte checkpoint with SHA-256
`429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee`.
A second clean provision command verified the existing checkpoint and both
pinned snapshots without downloading it again. The network-isolated runtime
doctor then reported every dependency, `tsr.system.TSR`, the NVIDIA RTX A2000
8GB Laptop GPU, and all three committed model files as `ok`.

### Reconstruction repeatability

Both candidates used chunk size 4096, marching-cubes resolution 256,
foreground ratio 0.85, `cuda:0`, and vertex colors. Neither run used a manual
mesh edit or an OOM retry.

| Observation | `macaw-front-triposr-r1` | `macaw-front-triposr-r2` |
|---|---:|---:|
| `candidate.json` SHA-256 | `53797203a32593e12c5915b75565c7e38045bafe77a6ad20afef421105a4de3e` | `ea070c80fb23743eeef6d897df8f42f7d4c07b63c5e3b390c1ccf18b1d96aeac` |
| normalized PNG bytes | 159,456 | 159,456 |
| normalized PNG SHA-256 | `d38da7d98b8be0ee786542e7651b719eb80856530cb8b0377e780813d1805e4f` | same |
| GLB bytes | 2,555,024 | 2,555,024 |
| GLB SHA-256 | `88ac489f649e0459e2c87417706e79eb20cc8aed3af7f92286b3f74726c9698a` | same |
| vertices / triangles | 63,850 / 127,700 | 63,850 / 127,700 |
| inference time | 12.814 s | 12.018 s |
| peak CUDA allocator bytes | 2,494,066,176 | 2,494,066,176 |

The manifests intentionally differ because candidate ID and elapsed time are
evidence. The normalized source, GLB, topology, and all four rendered review
PNGs repeat byte for byte. The recorded 2.323 GiB peak is PyTorch's CUDA
allocator peak, not total board usage; it leaves substantial room against the
8 GiB device without claiming that untracked driver allocations are free.

Read-only Trimesh inspection found six connected components, a watertight and
winding-consistent volume, Euler number zero, no boundary or non-manifold
edges, no duplicate faces, and five degenerate faces. A later normalization
step must identify the components and remove or repair the five degenerates.
No automated self-intersection claim is made; the fixed views show no obvious
large crossing surface.

### Fixed-view review

The renderer imports a private copy and records a -90 degree X rotation from
the proposal's image-oriented Y-up frame into the Z-up review frame. It does
not modify the immutable GLB. R1 and R2 review manifests have SHA-256
`d699121f4c11c62b4a00143cb1240246780bde3fa1f1de4c7ce37820982caa82`
and `7e04a19370348503754a276f8e66e66d463c13b45e6136a2dd520af8727d51e8`;
they differ only where their candidate identities differ.

| View | PNG bytes | SHA-256 | visible pixels | alpha bounds, bottom-left |
|---|---:|---|---:|---|
| front | 148,501 | `58a4c72c1a23feaca28b2a2824f464d226eaf130647fff9080fb0a8cd29c3df2` | 49,173 | `[131, 89, 381, 423]` |
| left | 132,421 | `e76ad369966687c4814b37329ae390399e36f0aff70e3043aec79da8c3a8b429` | 43,377 | `[157, 89, 355, 423]` |
| back | 138,763 | `568369a5047f1f68e5d0329259ed646be22e2f24acf7a7a3664a50c40eba2462` | 49,185 | `[131, 89, 381, 423]` |
| front-right three-quarter | 143,277 | `2e0c8dded31092916ea34b4d25ac7fe91a49afd50e74696c005b2c31382e3913` | 47,019 | `[139, 89, 353, 423]` |

The front and three-quarter views retain the macaw's head, beak, beard, robe,
belt, gloves, legs, and feet. The generated side and rear remain coherent and
give the robe and hood plausible volume, while their softened detail remains
generated plausibility rather than recovered truth. Shoulder, hand, hip, knee,
and ankle regions are readable enough for a bounded skeleton-placement
experiment. Sleeves and the long coat obscure exact elbow and upper-leg
landmarks, and the feet will need contact and deformation review.

### Decision: GO

Proceed to a separately scoped candidate-scoring, normalization, joint
estimation, and deformation-feasibility ticket. The baseline is recognizable,
fully local, fast enough for iteration, comfortably within this GPU's observed
allocator budget, and exactly repeatable for the same input. Repeating the same
feed-forward input is not an ensemble and adds no geometric diversity; use
controlled input variants or a second compatible provider only when a measured
quality goal requires it.

This decision does not accept either proposal as an actor package, start
automatic rigging in AF-045, resume AF-056 unchanged, add a product importer, or
publish the model/cache/mesh. The unchanged AF-055 validator remains the later
admission boundary.

## Licenses and distribution

TripoSR source and the recorded model are MIT according to their upstream
repositories. The exact retained source notice and revision record live under
`tools/reconstruction/`. CUDA, PyTorch, Transformers, PyMCubes, and their
transitive dependencies retain separate terms.

The reconstruction image, model volume, and generated candidates are internal
development material. They are not release artifacts. Any later redistribution
requires an updated SBOM, vulnerability scan, complete notices, and a separate
model/candidate rights decision.
