# Caatuu Phone Bench

This folder is for the first honest offline-phone test of the Czech model.

The current browser path uses WebLLM and needs WebGPU. This benchmark uses
`llama.cpp` through Termux on Android so the phone can run the model locally
without the browser WebGPU requirement.

## What We Test

- Model: `qwen3-1.7b-lora-003-hard`
- Source: merged Hugging Face export in `tools/caatuu-cz-ml/data/models`
- Phone format: GGUF, quantized as `Q4_K_M`
- Runtime: native `llama.cpp` built on the phone through Termux

Generated models and cloned runtimes stay out of Git:

```text
tools/phone-bench/artifacts/
tools/phone-bench/vendor/
```

The temporary converter Python environment is created in container-local `/tmp`
by default so the shared Windows workspace does not get a large virtualenv.

## Build The Phone Model

Run this from PowerShell. It uses a temporary Debian container and writes the
GGUF files into the shared workspace.

```powershell
docker run --rm -it `
  -v C:\Work\caatuu:/workspace `
  -w /workspace/tools/phone-bench `
  debian:latest `
  bash
```

Inside that shell:

```bash
apt-get update
apt-get install -y ca-certificates git cmake build-essential python3 python3-venv python3-pip curl
bash scripts/prepare-gguf.sh
bash scripts/publish-static-model.sh
```

After publishing, the phone can download the model from:

```text
https://caatuu.waajacu.com/cz/data/models/phone-bench/caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf
```

## Run On The Phone

Install Termux on the phone. In Termux:

```bash
pkg update
pkg install -y curl
curl -L https://caatuu.waajacu.com/cz/data/models/phone-bench/termux-chat-caatuu.sh -o termux-chat-caatuu.sh
bash termux-chat-caatuu.sh
```

That starts an interactive local chat. The model stays loaded while you type.
Use `Ctrl+D` or `Ctrl+C` to leave.

For the fixed benchmark prompts:

```bash
curl -L https://caatuu.waajacu.com/cz/data/models/phone-bench/termux-run-caatuu-bench.sh -o termux-run-caatuu-bench.sh
bash termux-run-caatuu-bench.sh
```

The script builds `llama.cpp`, downloads the quantized model, runs Czech prompts,
and writes a timestamped result file under:

```text
$HOME/caatuu-phone-bench/results/
```

## What To Look At

The useful numbers are:

- model download size
- model load time
- first-token delay
- eval/decode tokens per second
- whether the Czech spelling and diacritics remain acceptable

If `Qwen3-1.7B Q4_K_M` is too slow, the next test should be a smaller model
with the same benchmark prompts before investing in an Android UI wrapper.
