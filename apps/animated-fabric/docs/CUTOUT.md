# Optional background cutout

Animated Fabric owns an optional, self-contained preprocessing tool derived from the
proven Tukevejtso cutout engine. Prepared layered PNG files remain the stable application
input, so the base application neither imports this code nor installs ML dependencies.

The tool supports:

- `image`: one transparent PNG plus optional alpha, mask, diagnostic, and preview files;
- `batch`: stable lexical processing of a directory tree;
- `doctor`: offline dependency and pinned-model-cache checks;
- `models`: implemented provider and licensing information;
- `prefetch`: the only network-enabled operation, used to provision an immutable model;
- `classic`: a Pillow/NumPy border-connected fallback with no model download;
- `birefnet`: optional CPU or CUDA foreground segmentation.

## Supply-chain boundary

The default model is exactly:

```text
ZhengPeng7/BiRefNet@e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4
```

BiRefNet requires Hugging Face custom model code. Animated Fabric never follows a branch
or tag for that code: both provisioning and inference require a full 40-character commit.
`prefetch` downloads the immutable snapshot into a named model-cache volume. Runtime
inference passes `local_files_only=True` and is intended to run with `network_mode: none`.
Pinned custom code is materialized only in the container's disposable `/tmp` directory;
the shared model snapshot remains read-only during inference.

Model weights are not committed, copied from Tukevejtso, or included in any image layer.
The committed `tools/cutout/model-manifest.json` records SHA-256 values for the pinned
remote code, configuration, and weights. `prefetch`, `doctor`, and BiRefNet inference all
verify those four files. A different model ID or revision is rejected until its own
reviewed integrity manifest and license record are committed.

## Compose workflow

All productive work runs in Linux. Do not install these requirements on Windows.
Place source images under `workspaces/cutout/input/`; results are written under
`workspaces/cutout/output/`. Runtime services mount input read-only and never mount the
source checkout.

The lightweight classic provider needs no model and no network:

```bash
docker compose --profile cutout-classic build animated-fabric-cutout-classic
docker compose --profile cutout-classic run --rm \
  animated-fabric-cutout-classic doctor
docker compose --profile cutout-classic run --rm \
  animated-fabric-cutout-classic \
  image /input/source.png /output/result.png --engine classic
```

Build the CPU layer and provision the pinned BiRefNet snapshot. Only the provisioning
profile has network access, and it writes the named volume
`caatuu-animated-fabric-cutout-models`:

```bash
docker compose --profile cutout-provision build animated-fabric-cutout-prefetch
docker compose --profile cutout-provision run --rm \
  animated-fabric-cutout-prefetch
```

After provisioning, CPU inference is offline, read-only except for `/tmp` and `/output`,
and reads the model volume read-only:

```bash
docker compose --profile cutout build animated-fabric-cutout
docker compose --profile cutout run --rm animated-fabric-cutout doctor
docker compose --profile cutout run --rm animated-fabric-cutout models
docker compose --profile cutout run --rm animated-fabric-cutout \
  image /input/source.png /output/result.png --engine birefnet --device cpu
```

The CUDA service uses the Tukevejtso-validated PyTorch 2.11.0/CUDA 12.8 wheel set and
requests all Docker-visible NVIDIA GPUs:

```bash
docker compose --profile cutout-cuda build animated-fabric-cutout-cuda
docker compose --profile cutout-cuda run --rm animated-fabric-cutout-cuda doctor
docker compose --profile cutout-cuda run --rm animated-fabric-cutout-cuda \
  batch /input /output --engine birefnet --device cuda --recursive --save-extras
```

CUDA requires a compatible NVIDIA driver and Docker GPU support. Provisioning is shared;
do not run `prefetch` from a runtime profile.

## Direct Docker builds

Compose is authoritative. For image debugging only, the equivalent build targets are:

```bash
docker build --file Dockerfile.cutout --target cutout-core \
  --tag animated-fabric-cutout:core .
docker build --file Dockerfile.cutout --target cutout-cpu \
  --tag animated-fabric-cutout:cpu .
docker build --file Dockerfile.cutout --target cutout-cuda \
  --tag animated-fabric-cutout:cuda .
```

When invoking these images directly, keep provisioning network-enabled and model-volume
read/write, but run inference with `--network none` and the model volume read-only.

## Dependency layers

| Layer | Direct dependencies | Purpose |
|---|---|---|
| Core | Pillow, NumPy | PNG IO, classic cutout, alpha cleanup, previews |
| ML | Transformers, Hugging Face Hub, Accelerate, Safetensors, timm, einops, Kornia | Pinned BiRefNet loading and explicit provisioning |
| CPU | PyTorch, torchvision CPU wheels | CPU inference |
| CUDA | PyTorch 2.11.0+cu128, torchvision 0.26.0+cu128 | NVIDIA GPU inference |

Exact tested versions and indexes are recorded in the four
`requirements-cutout-*.txt` files. These files belong only to `Dockerfile.cutout`.

## Provenance and licenses

- The adapted Tukevejtso source is MIT licensed by Waajacu. Its complete notice is
  `tools/cutout/LICENSE.tukevejtso`.
- BiRefNet is MIT licensed by ZhengPeng. Its notice is
  `tools/cutout/LICENSE.birefnet`.
- Import provenance, source commits, copied files, changes, and repeatable diff procedure
  are recorded in `tools/cutout/UPSTREAM.md`.
- The default upstream project is <https://github.com/ZhengPeng7/BiRefNet>.

The notices cover source code. Operators remain responsible for reviewing the terms of
any selected model weights and for complying with the licenses of Python dependencies.
