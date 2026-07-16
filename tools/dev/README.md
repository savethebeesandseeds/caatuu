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
Debian default JDK, unzip, zip, rsync, jq
Persistent Android SDK, Gradle distribution, and Gradle cache volumes for
repeat Android publishes
```

Start an interactive shell from `C:\Work\caatuu`:

```powershell
docker compose -f compose.tools.yaml --profile dev up -d --build caatuu-dev
docker compose -f compose.tools.yaml exec caatuu-dev bash
```

Verify the environment:

```bash
check-caatuu-dev
```

Run Czech ML tasks:

```bash
cd /workspace/tools/caatuu-cz-ml
npm run check
npm run build:corpus
npm run build:dataset
python data/models/tools/train_lora.py --help
python data/models/tools/export_webllm.py --help
```

Run MLC/WebLLM conversion commands with the separate MLC Python:

```bash
caatuu-mlc-python data/models/tools/export_webllm.py --stage mlc --run-id qwen3-1.7b-lora-next
```

Run phone-bench preparation:

```bash
cd /workspace/tools/phone-bench
bash scripts/prepare-model.sh qwen3-lora-003-hard
```

Publish the current debug-signing Android lineage inside this Linux container:

```bash
docker exec caatuu-dev bash -lc 'cd /workspace && bash tools/android-build/publish-public-debug.sh'
```

The Bash publisher uses the existing container and its persistent Android tool
volumes. Do not launch a new container for routine publishes.

The service requests all available GPUs. Training still depends on the host
Docker NVIDIA integration being available.
