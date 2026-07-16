#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MODEL_KEY="${1:-${MODEL_KEY:-}}"
CLEAN_F16="${CLEAN_F16:-1}"
NORMALIZE_TOKENIZER="${NORMALIZE_TOKENIZER:-auto}"
CONFIG_VENV_DIR="${CONFIG_VENV_DIR:-/tmp/caatuu-phone-bench-config-venv}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/publish-configured-model.sh <model-key>

Runs the configured phone/app publish path:
  1. Resolve tools/phone-bench/model-configs.json.
  2. Normalize CSTinyLlama-style BPE tokenizer metadata when needed.
  3. Convert the Hugging Face export to GGUF and quantize with llama.cpp.
  4. Publish the Q4 model, manifest, sha file, and models.json into the app.
  5. Remove the temporary F16 GGUF by default.

Environment:
  CLEAN_F16=0              Keep the temporary F16 GGUF.
  NORMALIZE_TOKENIZER=0    Skip tokenizer metadata normalization.
  FORCE_REBUILD_GGUF=1     Reconvert and re-quantize even if GGUF files exist.

This script does not edit Android/Kotlin or HTML selectors. Add new model keys
to the app UI intentionally, then rebuild the APK.
EOF
}

if [ -z "$MODEL_KEY" ] || [ "$MODEL_KEY" = "-h" ] || [ "$MODEL_KEY" = "--help" ]; then
  usage
  exit 0
fi

eval "$(python3 "$SCRIPT_DIR/resolve-model-config.py" "$MODEL_KEY")"

ensure_hf_snapshot() {
  if [ "$MODEL_SOURCE_TYPE" != "hf_snapshot" ] || [ -f "$MODEL_HF_DIR/config.json" ]; then
    return 0
  fi

  echo "Downloading Hugging Face snapshot: $MODEL_REPO_ID"
  python3 -m venv "$CONFIG_VENV_DIR"
  # shellcheck source=/dev/null
  . "$CONFIG_VENV_DIR/bin/activate"
  python -m pip install --upgrade pip wheel setuptools
  python -m pip install "huggingface_hub>=0.24"
  python "$SCRIPT_DIR/download-hf-snapshot.py" \
    --repo-id "$MODEL_REPO_ID" \
    --out-dir "$MODEL_HF_DIR"
  deactivate || true
}

normalize_bpe_tokenizer() {
  [ "$NORMALIZE_TOKENIZER" != "0" ] || return 0
  [ -f "$MODEL_HF_DIR/tokenizer.json" ] || return 0

  python3 - "$MODEL_HF_DIR" "$MODEL_REPO_ID" <<'PY'
import json
import sys
from pathlib import Path

model_dir = Path(sys.argv[1])
repo_id = sys.argv[2]
tokenizer_path = model_dir / "tokenizer.json"
config_path = model_dir / "tokenizer_config.json"

tokenizer = json.loads(tokenizer_path.read_text(encoding="utf-8"))
model = tokenizer.get("model") or {}
if model.get("type") != "BPE":
    print("Tokenizer normalization skipped: tokenizer.json is not BPE.")
    raise SystemExit(0)

config = {}
if config_path.is_file():
    config = json.loads(config_path.read_text(encoding="utf-8"))

needs_normalization = (
    repo_id == "BUT-FIT/CSTinyLlama-1.2B"
    or config.get("tokenizer_class") == "TokenizersBackend"
)
if not needs_normalization:
    print("Tokenizer normalization skipped: model does not require the CSTinyLlama BPE sidecar workaround.")
    raise SystemExit(0)

vocab = model.get("vocab")
merges = model.get("merges")
if not isinstance(vocab, dict) or not isinstance(merges, list):
    raise SystemExit("BPE tokenizer is missing model.vocab or model.merges.")

merge_lines = []
for entry in merges:
    if isinstance(entry, str):
        merge_lines.append(entry)
    elif (
        isinstance(entry, list)
        and len(entry) == 2
        and all(isinstance(piece, str) for piece in entry)
    ):
        merge_lines.append(" ".join(entry))
    else:
        raise SystemExit(f"Unsupported BPE merge entry: {entry!r}")

config["tokenizer_class"] = "GPT2TokenizerFast"
config.setdefault("bos_token", "<|endoftext|>")
config.setdefault("eos_token", "[EOS]")
config.setdefault("unk_token", "[UNK]")
config.setdefault("pad_token", config.get("eos_token", "[EOS]"))
config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

(model_dir / "vocab.json").write_text(json.dumps(vocab, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(model_dir / "merges.txt").write_text("#version: 0.2\n" + "\n".join(merge_lines) + "\n", encoding="utf-8")

specials_path = model_dir / "special_tokens_map.json"
if not specials_path.is_file():
    specials = {
        "bos_token": config.get("bos_token", "<|endoftext|>"),
        "eos_token": config.get("eos_token", "[EOS]"),
        "unk_token": config.get("unk_token", "[UNK]"),
        "pad_token": config.get("pad_token", config.get("eos_token", "[EOS]")),
    }
    specials_path.write_text(json.dumps(specials, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print(f"Tokenizer normalized for GGUF conversion: vocab={len(vocab)} merges={len(merge_lines)}")
PY
}

echo "Publishing configured model: $MODEL_KEY"
echo "HF dir: $MODEL_HF_DIR"
echo "Artifacts: $OUT_DIR"

ensure_hf_snapshot
normalize_bpe_tokenizer

bash "$SCRIPT_DIR/prepare-model.sh" "$MODEL_KEY"

f16_gguf="$OUT_DIR/$MODEL_BASENAME-f16.gguf"
if [ "$CLEAN_F16" != "0" ] && [ -f "$f16_gguf" ]; then
  rm -f "$f16_gguf"
  echo "Removed temporary F16 GGUF: $f16_gguf"
fi

bash "$SCRIPT_DIR/publish-static-model.sh" "$MODEL_KEY"

manifest="$OUT_DIR/manifest.json"
static_manifest="$TOOL_DIR/../../apps/caatuu-czech/static/data/models/phone-bench/$MODEL_KEY.manifest.json"

python3 - "$manifest" "$static_manifest" <<'PY'
import json
import sys
from pathlib import Path

for label, path in [("artifact", Path(sys.argv[1])), ("static", Path(sys.argv[2]))]:
    data = json.loads(path.read_text(encoding="utf-8"))
    print(f"{label}_manifest={path}")
    print(f"model_key={data['model_key']}")
    print(f"model_file={data['model_file']}")
    print(f"bytes={data['bytes']}")
    print(f"sha256={data['sha256']}")
PY

cat <<EOF

Next manual app steps, when this is a new model key:
  - Add the model to apps/caatuu-android/.../ModelManager.kt.
  - Add selector/legal entries in apps/caatuu-czech/static/*.html and *.js.
  - Bump the APK version and web cache query strings.
  - Build the APK with tools/android-build/build-debug-apk.sh.
  - Verify /android/caatuu-debug.json and /cz/data/models/phone-bench/models.json.
EOF
