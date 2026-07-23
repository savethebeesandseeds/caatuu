# Browser Model Assets

This folder contains only browser/runtime assets for the Caatuu Czech app.

The current live browser model is:

```text
czech-finetuned/exports/qwen3-1.7b-lora-003-hard/webllm/Caatuu-Czech-Qwen3-1.7B-q4f16_1-MLC-003/
```

The app also keeps small metadata files used by the UI and service worker:

```text
models.json
export-spec.json
benchmarks/base-qwen3-1.7b.json
benchmarks/czech-language-benchmark-qwen3-1.7b-lora-003-hard.json
benchmarks/czech-language-benchmark-qwen3-1.7b-lora-003-hard.md
czech-finetuned/runs/qwen3-1.7b-lora-003-hard/training-run.json
czech-finetuned/runs/qwen3-1.7b-lora-003-hard/adapter/adapter_config.json
```

Full training artifacts are not kept in the static app folder. They live here:

```text
C:\Work\caatuu\tools\czech-ml\data\models
```

That ML workspace contains the corpus, Hugging Face cache, Python ML tools,
training datasets, complete LoRA adapters, checkpoints, merged models, old
exports, and benchmark history.
