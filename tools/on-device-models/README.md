# On-device models

This folder prepares the Czech GGUF models used by the Android app's optional
Generative mode and preserves manual Termux benchmarks. The Android runtime
uses `llama.cpp`; its vendor checkout is also owned here.

## Model Configs

Model preparation is driven by [`model-configs.json`](model-configs.json).
Its active models are downloaded on demand, rather than during initial setup:

- `qwen3-1.7b-translation-cs-en-001`: Czech-to-English translation.
- `cstinyllama-1.2b-czech-word-sentence-001`: Word World sentence generation
  and the configured default.

The Qwen3 003 Hard, raw CSTinyLlama, Planet Word Net and CSTinyLlama translation
entries are deprecated historical configurations. The app's generated model
catalog contains the active models; deprecated configuration entries are not
recommendations or evidence that a download remains publicly available.

Use `scripts/prepare-model.sh <model-key>` so the Hugging Face source,
artifact path, basename, license metadata, and manifest stay consistent.

For a configured model, prefer the wrapper:

```bash
bash scripts/publish-configured-model.sh <model-key>
```

It runs tokenizer normalization when needed, GGUF conversion, Q4 quantization,
static publishing, and F16 cleanup. It does not edit Android/Kotlin or HTML
selectors; new model keys still need intentional app wiring and an APK rebuild.

## Model Artifacts

- Default model: `cstinyllama-1.2b-czech-word-sentence-001`
- Source: merged Hugging Face export in `tools/czech-ml/data/models`
- Phone format: GGUF, quantized as `Q4_K_M`
- Runtime: native `llama.cpp` in Android; separate Termux scripts for benchmarks

Generated models and cloned runtimes stay out of Git:

```text
tools/on-device-models/artifacts/
tools/on-device-models/vendor/
```

The llama.cpp checkout is patched during preparation from:

```text
tools/on-device-models/patches/
```

The current patch teaches the converter to treat the CSTinyLlama tokenizer as a
GPT-2-style byte-level BPE tokenizer.

The temporary converter Python environment is created in container-local `/tmp`
by default so the shared Windows workspace does not get a large virtualenv.

## Build The Phone Model

Use the existing `caatuu-dev` container provisioned through the root
[setup guide](../../README.md#replicate-the-development-environment).
From PowerShell, enter the model workspace:

```powershell
docker exec --interactive --tty --workdir /workspace/tools/on-device-models caatuu-dev bash --login
```

Inside that shell:

```bash
bash scripts/publish-configured-model.sh cstinyllama-1.2b-czech-word-sentence-001
```

For the active translation model:

```bash
bash scripts/publish-configured-model.sh qwen3-1.7b-translation-cs-en-001
```

The output lands under the configured artifact directory:

```text
tools/on-device-models/artifacts/models/<artifact_subdir>/
```

The wrapper updates the local static catalog under
`apps/languages/czech/static/data/models/phone-bench/`. Public delivery remains
a separate release step. Use the catalog and per-model manifests for exact
filenames, sizes and hashes.

## Historical Termux Benchmarks

These scripts retain the original Qwen3 benchmark defaults. Before running an
old benchmark, check its configured model URL and availability; it does not
select the current Android model catalog automatically.

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

Compare candidate models with the same benchmark prompts and keep the results
separate from the Android app's release validation.
