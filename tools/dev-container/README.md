# Caatuu Dev And ML Container

The canonical durable `caatuu-dev` recreation path is the direct
`debian:latest` command and idempotent `setup.sh` documented in the root
[README](../../README.md#replicate-the-development-environment). The optional
Compose development definition remains available for explicitly coordinated
environment work; routine development reuses the durable container.

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
Pinned Pillow in /opt/caatuu-ml for deterministic Home artwork generation
```

For ordinary local use after following the root recreation steps, start the
durable container and enter it from `C:\Work\caatuu`:

```powershell
docker start caatuu-dev
docker exec --interactive --tty --workdir /workspace caatuu-dev bash --login
```

Verify the environment:

```bash
check-caatuu-dev
```

Verify the committed Home artwork through the provisioned Python environment:

```bash
docker exec -w /workspace caatuu-dev \
  python apps/language-runtime/tooling/build-home-art.py --check
```

Pillow is pinned in `requirements-ml.txt` to preserve the existing PNG bytes.
Animated Fabric's pipelines and automatic provisioning are retired; its
[source and artwork](../../apps/animated-fabric/README.md) remain historical
material. Setup does not delete any previously installed environment or data.

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
bash scripts/prepare-model.sh cstinyllama-1.2b-czech-word-sentence-001
```

Publish the stable Android product from PowerShell with the maintained release
entrypoint, which reuses this container:

```powershell
pwsh -NoProfile -File apps/android/tooling/release-android.ps1
```

The release publisher uses the Android toolchain already provisioned in the
durable container. Do not launch a new container for routine publishes. The
retired `publish-public-debug.sh` command is not a public publisher; its
explicit `--local-build` mode is only for a development artifact.

The default service is CPU-compatible. `compose/dev-gpu.yaml` remains an
optional override for explicitly coordinated GPU work; applying it requires
host Docker NVIDIA integration and an intentional container configuration
change.
