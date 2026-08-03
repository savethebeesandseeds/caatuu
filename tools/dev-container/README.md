# Caatuu Dev And ML Container

This image is the heavy Debian workspace for model work and local build tasks.
It is separate from the lightweight `caatuu` server container.

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
Persistent Android SDK, Gradle distribution, and Gradle cache volumes for
repeat Android publishes
Animated Fabric Python 3.12 tool environment at `/opt/animated-fabric`
PySide6, OpenCV, Ruff, mypy, pytest, and the locked Animated Fabric dependencies
```

Start an interactive shell from `C:\Work\caatuu`:

```powershell
docker compose --profile dev up -d --build caatuu-dev
docker compose exec caatuu-dev bash
```

This CPU-compatible definition is the default and is also used by CI. On a
host with working NVIDIA Container Toolkit support, request the GPU on the same
service and in the same `caatuu` Compose project:

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

`caatuu-animated-fabric` selects the baked Python 3.12 environment and the
canonical source mounted at `/workspace/apps/animated-fabric`. Do not create a
second source mount, virtual environment, development container, or Compose
project for this application.

Docker receives only this small tool directory as its primary build context.
`animated-fabric-linux-py312.txt` is a byte-identical build-context mirror of
`apps/animated-fabric/constraints/linux-py312.txt`; `check-caatuu-dev` rejects
any drift between them.

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

Publish the current debug-signing Android lineage inside this Linux container:

```bash
docker exec caatuu-dev bash -lc 'cd /workspace && bash apps/android/tooling/publish-public-debug.sh'
```

The Bash publisher uses the existing container and its persistent Android tool
volumes. Do not launch a new container for routine publishes.

The default service is CPU-compatible. The GPU override requests all available
GPUs, and training still depends on the host Docker NVIDIA integration being
available.
