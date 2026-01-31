#!/usr/bin/env bash

# --------------------------------
# Rust / Cargo bootstrap
# --------------------------------
if [ -f "$HOME/.cargo/env" ]; then
  . "$HOME/.cargo/env"
else
  export PATH="$HOME/.cargo/bin:/usr/local/cargo/bin:$PATH"
fi

set -Eeuo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$SCRIPT_DIR"

# --------------------------------
# Load environment (env.sh → env.local.sh)
# --------------------------------
# shellcheck source=/dev/null
source "$SCRIPT_DIR/env.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options] [-- <extra cargo args>]

Options:
  -c, --config <path>   Path to agent TOML config
  -r, --release         Build in release mode
  -h, --help            Show this help
EOF
}

CONFIG_PATH="${AGENT_CONFIG_PATH:-./profiles/word_challenge.toml}"
CARGO_MODE=()
EXTRA_ARGS=()

# --------------------------------
# Argument parsing
# --------------------------------
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

# --------------------------------
# Resolve config path
# --------------------------------
if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$PROJECT_ROOT/$CONFIG_PATH"
fi

# --------------------------------
# Validations
# --------------------------------
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY is not set (env.local.sh)" >&2
  exit 1
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "ERROR: Config file not found: $CONFIG_PATH" >&2
  exit 1
fi

export AGENT_CONFIG_PATH="$CONFIG_PATH"

# --------------------------------
# Cloudflared tunnel (token from env.local.sh)
# --------------------------------
start_cloudflared() {
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "⚠ cloudflared not installed — tunnel disabled"
    return 0
  fi

  if pgrep -fa "cloudflared.*tunnel.*run" >/dev/null 2>&1; then
    echo "→ cloudflared already running"
    return 0
  fi

  if [[ -z "${CLOUDFLARED_TOKEN:-}" ]]; then
    echo "⚠ CLOUDFLARED_TOKEN not set — tunnel disabled"
    return 0
  fi

  echo "→ starting cloudflared tunnel"
  cloudflared tunnel run --token "$CLOUDFLARED_TOKEN" \
    > /tmp/cloudflared.log 2>&1 &

  sleep 1
  if pgrep -fa "cloudflared.*tunnel.*run" >/dev/null 2>&1; then
    echo "→ cloudflared running"
  else
    echo "⚠ cloudflared failed to start"
    tail -n 50 /tmp/cloudflared.log || true
  fi
}

# --------------------------------
# Startup banner
# --------------------------------
echo "→ Starting Caatuu"
echo "  PORT=$PORT"
echo "  AGENT_CONFIG_PATH=$AGENT_CONFIG_PATH"
echo "  RUST_LOG=$RUST_LOG"
echo "  MODE=${CARGO_MODE[*]:-(dev)}"
echo

# --------------------------------
# Start tunnel (non-blocking)
# --------------------------------
start_cloudflared
echo

# --------------------------------
# Run server
# --------------------------------
cd "$PROJECT_ROOT"
cargo run "${CARGO_MODE[@]}" -- "${EXTRA_ARGS[@]}"
