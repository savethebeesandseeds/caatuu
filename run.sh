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
PID_FILE="$PROJECT_ROOT/.caatuu-backend.pid"

# --------------------------------
# Load environment (env.sh → env.local.sh)
# --------------------------------
# shellcheck source=/dev/null
source "$SCRIPT_DIR/env.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") [start|stop|restart|status] [options] [-- <extra cargo args>]

Commands:
  start                Start backend (default) + ensure cloudflared is running
  stop                 Stop backend only (does NOT stop cloudflared)
  restart              Stop backend, then start it again
  status               Show backend/cloudflared status

Options (for start/restart):
  -c, --config <path>  Path to agent TOML config
  -r, --release        Build in release mode
  -h, --help           Show this help
EOF
}

COMMAND="start"
if (( "$#" )); then
  case "$1" in
    start|stop|restart|status)
      COMMAND="$1"
      shift
      ;;
  esac
fi

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

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$PROJECT_ROOT/$CONFIG_PATH"
fi

is_pid_running() {
  local pid="${1:-}"
  [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

read_pid_file() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(tr -d '[:space:]' < "$PID_FILE" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  echo "$pid"
}

stop_backend() {
  local stopped=0
  local pid=""

  if pid="$(read_pid_file)"; then
    if is_pid_running "$pid"; then
      echo "→ stopping Caatuu backend (PID $pid)"
      kill -TERM "$pid" >/dev/null 2>&1 || true
      for _ in {1..20}; do
        sleep 0.25
        is_pid_running "$pid" || break
      done
      if is_pid_running "$pid"; then
        echo "→ force-stopping Caatuu backend (PID $pid)"
        kill -KILL "$pid" >/dev/null 2>&1 || true
      fi
      stopped=1
    fi
  fi
  rm -f "$PID_FILE"

  # Fallback in case PID file is stale/missing.
  # Stop both historical names: caatuu-backend and caatuu.
  local orphan_pids
  orphan_pids="$(
    {
      pgrep -x caatuu-backend || true
      pgrep -x caatuu || true
    } | awk 'NF' | sort -u
  )"
  if [[ -n "$orphan_pids" ]]; then
    echo "→ stopping backend orphan PID(s) (caatuu-backend/caatuu): $orphan_pids"
    # shellcheck disable=SC2086
    kill -TERM $orphan_pids >/dev/null 2>&1 || true
    sleep 1
    orphan_pids="$(
      {
        pgrep -x caatuu-backend || true
        pgrep -x caatuu || true
      } | awk 'NF' | sort -u
    )"
    if [[ -n "$orphan_pids" ]]; then
      echo "→ force-stopping backend orphan PID(s): $orphan_pids"
      # shellcheck disable=SC2086
      kill -KILL $orphan_pids >/dev/null 2>&1 || true
    fi
    stopped=1
  fi

  if (( stopped )); then
    echo "→ backend stopped"
  else
    echo "→ backend not running"
  fi
}

status_backend() {
  local pid=""
  if pid="$(read_pid_file)" && is_pid_running "$pid"; then
    echo "backend: running (pid file PID $pid)"
  else
    local pids
    pids="$(
      {
        pgrep -x caatuu-backend || true
        pgrep -x caatuu || true
      } | awk 'NF' | sort -u
    )"
    if [[ -n "$pids" ]]; then
      echo "backend: running (PID(s): $pids)"
    else
      echo "backend: stopped"
    fi
  fi
}

status_cloudflared() {
  if pgrep -fa "cloudflared.*tunnel.*run" >/dev/null 2>&1; then
    echo "cloudflared: running"
  else
    echo "cloudflared: stopped"
  fi
}

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

run_backend_foreground() {
  cd "$PROJECT_ROOT"
  cargo run "${CARGO_MODE[@]}" -- "${EXTRA_ARGS[@]}" &
  local backend_pid=$!
  echo "$backend_pid" > "$PID_FILE"

  on_signal() {
    echo
    echo "→ stop sequence: shutting down backend (PID $backend_pid)"
    kill -TERM "$backend_pid" >/dev/null 2>&1 || true
  }

  trap on_signal INT TERM
  wait "$backend_pid"
  local rc=$?
  trap - INT TERM
  rm -f "$PID_FILE"
  return "$rc"
}

validate_startup_requirements() {
  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    echo "ERROR: OPENAI_API_KEY is not set (env.local.sh)" >&2
    exit 1
  fi

  if [[ ! -f "$CONFIG_PATH" ]]; then
    echo "ERROR: Config file not found: $CONFIG_PATH" >&2
    exit 1
  fi

  export AGENT_CONFIG_PATH="$CONFIG_PATH"
}

case "$COMMAND" in
  stop)
    stop_backend
    exit 0
    ;;
  status)
    status_backend
    status_cloudflared
    exit 0
    ;;
  restart)
    stop_backend
    ;;
  start)
    # Safe-start: make sure stale backend instances are not holding the port.
    stop_backend
    ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    usage
    exit 2
    ;;
esac

validate_startup_requirements

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
# Start backend with stop sequence
# --------------------------------
run_backend_foreground
