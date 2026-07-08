# Caatuu Phone Bench

This folder is for the first honest offline-phone test of the Czech model.

The current browser path uses WebLLM and needs WebGPU. This benchmark uses
`llama.cpp` through Termux on Android so the phone can run the model locally
without the browser WebGPU requirement.

## Model Configs

Model preparation is driven by `model-configs.json`. The current entries are:

- `qwen3-lora-003-hard`: legacy/deprecated Caatuu Czech Qwen3 LoRA model.
- `cstinyllama-1.2b-base`: legacy/deprecated raw `BUT-FIT/CSTinyLlama-1.2B` baseline.
- `cstinyllama-1.2b-planet-wordnet-002-copy`: legacy/deprecated Planet Word Net CSTinyLlama LoRA, backed by the 003 clean SFT adapter.

Do not treat these entries as the recommended future generation models. They
remain published so existing app installs and tests keep working while the
curriculum translation and word-sentence LoRAs are evaluated, merged, quantized,
and intentionally wired into the app.

Use `scripts/prepare-model.sh <model-key>` so the Hugging Face source,
artifact path, basename, license metadata, and manifest stay consistent.

For a configured model, prefer the wrapper:

```bash
bash scripts/publish-configured-model.sh <model-key>
```

It runs tokenizer normalization when needed, GGUF conversion, Q4 quantization,
static publishing, and F16 cleanup. It does not edit Android/Kotlin or HTML
selectors; new model keys still need intentional app wiring and an APK rebuild.

## What We Test

- Default legacy model: `qwen3-lora-003-hard`
- Source: merged Hugging Face export in `tools/caatuu-cz-ml/data/models`
- Phone format: GGUF, quantized as `Q4_K_M`
- Runtime: native `llama.cpp` built on the phone through Termux

Generated models and cloned runtimes stay out of Git:

```text
tools/phone-bench/artifacts/
tools/phone-bench/vendor/
```

The llama.cpp checkout is patched during preparation from:

```text
tools/phone-bench/patches/
```

The current patch teaches the converter to treat the CSTinyLlama tokenizer as a
GPT-2-style byte-level BPE tokenizer.

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
bash scripts/prepare-model.sh qwen3-lora-003-hard
bash scripts/publish-static-model.sh qwen3-lora-003-hard
```

For the raw CSTinyLlama base model, use:

```bash
bash scripts/prepare-model.sh cstinyllama-1.2b-base
bash scripts/publish-static-model.sh cstinyllama-1.2b-base
```

For the Planet Word Net fine-tuned CSTinyLlama model, use:

```bash
bash scripts/publish-configured-model.sh cstinyllama-1.2b-planet-wordnet-002-copy
```

The output lands under the configured artifact directory:

```text
tools/phone-bench/artifacts/models/<artifact_subdir>/
```

After publishing, the phone can download the model from:

```text
https://caatuu.waajacu.com/cz/data/models/phone-bench/caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf
```

For the CSTinyLlama base model, the published file name is:

```text
caatuu-czech-cstinyllama-1.2b-base-q4_k_m.gguf
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
