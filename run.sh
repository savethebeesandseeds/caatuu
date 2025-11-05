#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$SCRIPT_DIR"

# Load env (defaults + optional local overrides)
# shellcheck source=/dev/null
source "$SCRIPT_DIR/env.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options] [-- <extra cargo args>]

Options:
  -c, --config <path>   Path to agent TOML config (default: ./profiles/word_challenge.toml)
  -r, --release         Build in release mode (cargo --release)
  -h, --help            Show this help

Environment (from env.sh / env.local.sh or your shell):
  PORT                  (default: $PORT)
  OPENAI_API_KEY        (required)
  OPENAI_BASE_URL       (default: $OPENAI_BASE_URL)
  OPENAI_FAST_MODEL     (default: $OPENAI_FAST_MODEL)
  OPENAI_STRONG_MODEL   (default: $OPENAI_STRONG_MODEL)
  RUST_LOG              (default: $RUST_LOG)

Examples:
  $(basename "$0")
  $(basename "$0") -c configs/hard.toml
  $(basename "$0") --release -c ./profiles/word_challenge.toml
  $(basename "$0") -c ./profiles/word_challenge.toml -- --features ws
EOF
}

CONFIG_PATH="${AGENT_CONFIG_PATH:-./profiles/word_challenge.toml}"
CARGO_MODE=()
EXTRA_ARGS=()

# Parse args (stop at -- to pass through)
while (( "$#" )); do
  case "$1" in
    -c|--config)
      [[ $# -ge 2 ]] || { echo "Missing value for $1"; exit 2; }
      CONFIG_PATH="$2"; shift 2;;
    -r|--release)
      CARGO_MODE+=(--release); shift;;
    -h|--help)
      usage; exit 0;;
    --)
      shift
      EXTRA_ARGS=("$@")
      break;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 2;;
  esac
done

# Resolve config path relative to project root if needed
if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$PROJECT_ROOT/$CONFIG_PATH"
fi

# Validations
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY is not set. Put it in env.local.sh (untracked) or export it in your shell." >&2
  exit 1
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "ERROR: Config file not found: $CONFIG_PATH" >&2
  exit 1
fi

export AGENT_CONFIG_PATH="$CONFIG_PATH"

# Friendly log line
echo "→ Starting Caatuu server"
echo "  PORT=$PORT"
echo "  AGENT_CONFIG_PATH=$AGENT_CONFIG_PATH"
echo "  RUST_LOG=$RUST_LOG"
echo "  MODE=${CARGO_MODE[*]:-(dev)}"
echo

# Run
# You can swap to `cargo watch -x run` if you want hot reloads.
cargo run "${CARGO_MODE[@]}" -- "${EXTRA_ARGS[@]}"
