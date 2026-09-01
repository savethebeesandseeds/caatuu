# Caatuu Dev And ML Container

The canonical durable `caatuu-dev` recreation path is the direct
`debian:latest` command and idempotent `setup.sh` documented in the root
[README](../../README.md#replicate-the-development-environment). The legacy
Compose definitions remain available to current CI and specialist services
during their separate retirement work; they are not required to recreate the
durable development container.

It includes:

```text
Training Python venv at /opt/caatuu-ml
CUDA 12.8 PyTorch
Transformers, PEFT, Accelerate, datasets, Hugging Face tools
MLC/WebLLM conversion venv at /opt/caatuu-mlc
Node.js and npm
Rust stable through rustup
git, git-lfs, CMake, Ninja, GCC/G++, Make
Pinned Temurin JDK 17 for Android builds, unzip, zip, rsync, jq
Pinned Android SDK and Gradle distribution in the durable container writable
layer for repeat Android builds
Animated Fabric Python 3.12 tool environment at `/opt/animated-fabric`
PySide6, OpenCV, Ruff, mypy, pytest, and the locked Animated Fabric dependencies
```

For ordinary local use after following the root recreation steps, start the
durable container and enter it from `C:\Work\caatuu`:

```powershell
docker start caatuu-dev
docker exec --interactive --tty --workdir /workspace caatuu-dev bash --login
```

The existing CPU-compatible Compose definition remains used by current CI. Its
optional GPU overlay also remains available to specialist work while that
legacy path is retired separately:

```powershell
docker compose -f compose.yaml -f compose/dev-gpu.yaml --profile dev `
  up -d --build caatuu-dev
```

Verify the environment:

```bash
check-caatuu-dev
```

Run Animated Fabric work through the same running container:

```bash
docker exec -w /workspace/apps/animated-fabric caatuu-dev \
  caatuu-animated-fabric ruff format --check .
docker exec -w /workspace/apps/animated-fabric caatuu-dev \
  caatuu-animated-fabric pytest -q
docker exec -w /workspace/apps/animated-fabric caatuu-dev \
  caatuu-animated-fabric python -m animated_fabric doctor
```

`caatuu-animated-fabric` selects the provisioned Python 3.12 environment and the
canonical source mounted at `/workspace/apps/animated-fabric`. Do not create a
second source mount, virtual environment, development container, or Compose
project for this application.

The direct setup records the canonical Animated Fabric lock beneath
`/opt/caatuu-dev/state`. The legacy image keeps its byte-identical build-context
mirror beneath `/tmp`; the helper and `check-caatuu-dev` accept either
provisioned location and reject any drift from
`apps/animated-fabric/constraints/linux-py312.txt`.

Run Czech ML tasks:

```bash
cd /workspace/tools/czech-ml
npm run check
npm run build:corpus
npm run build:dataset
python scripts/ml/train_lora.py --help
python scripts/ml/export_webllm.py --help
```

Run MLC/WebLLM conversion commands with the separate MLC Python:

```bash
caatuu-mlc-python scripts/ml/export_webllm.py --stage mlc --run-id qwen3-1.7b-lora-next
```

Run phone-bench preparation:

```bash
cd /workspace/tools/on-device-models
bash scripts/prepare-model.sh qwen3-lora-003-hard
```

Publish the stable, non-debuggable Android product inside this Linux container:

```bash
docker exec -w /workspace caatuu-dev \
  bash apps/android/tooling/publish-release.sh
```

The release publisher uses the Android toolchain already provisioned in the
durable container. Do not launch a new container for routine publishes. The
retired `publish-public-debug.sh` command is not a public publisher; its
explicit `--local-build` mode is only for a development artifact.

The default service is CPU-compatible. The GPU override requests all available
GPUs, and training still depends on the host Docker NVIDIA integration being
available.
