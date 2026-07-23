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

The lab owns two Compose services and one model volume:

| Service | Network | GPU | Model mount | Purpose |
|---|---|---|---|---|
| `animated-fabric-3d-lab-provision` | enabled | no | read/write | download exact pinned files and verify hashes |
| `animated-fabric-3d-lab` | none | all | read-only | offline doctor and inference |

Both images run as non-root, drop all capabilities, enable
`no-new-privileges`, expose no ports, and mount no Docker socket. Inference
mounts `workspaces/reconstruction/input/` read-only and writes only to
`workspaces/reconstruction/output/`. Both directories and the model volume are
outside Git.

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

## Prepare an input

Reconstruction requires a reviewed RGBA cutout. Do not let TripoSR download or
run a second background-removal system. Copy a rights-cleared source into the
cutout input workspace and run the documented self-contained cutout profile:

```bash
mkdir -p workspaces/cutout/input workspaces/cutout/output
docker compose --profile cutout run --rm animated-fabric-cutout \
  image /input/subject.png /output/subject-cutout.png \
  --engine birefnet --device cuda
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
the service has no network.

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

## Licenses and distribution

TripoSR source and the recorded model are MIT according to their upstream
repositories. The exact retained source notice and revision record live under
`tools/reconstruction/`. CUDA, PyTorch, Transformers, PyMCubes, and their
transitive dependencies retain separate terms.

The reconstruction image, model volume, and generated candidates are internal
development material. They are not release artifacts. Any later redistribution
requires an updated SBOM, vulnerability scan, complete notices, and a separate
model/candidate rights decision.
