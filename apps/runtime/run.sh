#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
pid_file="$script_dir/.caatuu-runtime.pid"
lock_file="$script_dir/.caatuu-runtime.lock"

# shellcheck source=env.sh
source "$script_dir/env.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") [start|stop|restart|status] [options] [-- <server args>]

Runs the local Rust server only. Use the workspace Compose tunnel profile for
remote access; this script never reads or launches with a tunnel token.

Options:
  -c, --config <path>  Archived Chinese agent TOML (archive mode only)
  -r, --release        Build and run Cargo's release profile
  -h, --help           Show this help
EOF
}

is_enabled() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

process_start_ticks() {
  local pid="${1:-}"
  [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/stat" ]] || return 1

  local stat_line stat_tail
  local -a stat_fields
  IFS= read -r stat_line < "/proc/$pid/stat" || return 1
  stat_tail="${stat_line##*) }"
  [[ "$stat_tail" != "$stat_line" ]] || return 1
  read -r -a stat_fields <<< "$stat_tail"
  [[ "${#stat_fields[@]}" -ge 20 && "${stat_fields[19]}" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "${stat_fields[19]}"
}

read_process_state() {
  [[ -f "$pid_file" ]] || return 1
  local pid start_ticks extra
  read -r pid start_ticks extra < "$pid_file" || return 1
  [[ -z "${extra:-}" && "$pid" =~ ^[0-9]+$ && "$start_ticks" =~ ^[0-9]+$ ]] || return 1
  printf '%s %s\n' "$pid" "$start_ticks"
}

is_managed_process_running() {
  local pid="$1"
  local expected_start_ticks="$2"
  local actual_start_ticks
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  actual_start_ticks="$(process_start_ticks "$pid")" || return 1
  [[ "$actual_start_ticks" == "$expected_start_ticks" ]]
}

remove_state_if_owned() {
  local expected_pid="$1"
  local expected_start_ticks="$2"
  local current_pid current_start_ticks
  if read -r current_pid current_start_ticks < <(read_process_state) \
      && [[ "$current_pid" == "$expected_pid" && "$current_start_ticks" == "$expected_start_ticks" ]]; then
    rm -f "$pid_file"
  fi
}

stop_server() {
  local pid start_ticks
  if ! read -r pid start_ticks < <(read_process_state) \
      || ! is_managed_process_running "$pid" "$start_ticks"; then
    rm -f "$pid_file"
    echo "Caatuu runtime is not running through this launcher."
    return
  fi

  echo "Stopping Caatuu runtime (PID $pid)."
  if is_managed_process_running "$pid" "$start_ticks"; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
  for _ in {1..20}; do
    sleep 0.25
    is_managed_process_running "$pid" "$start_ticks" || break
  done
  if is_managed_process_running "$pid" "$start_ticks"; then
    echo "Runtime did not stop cleanly; sending KILL."
    if is_managed_process_running "$pid" "$start_ticks"; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  remove_state_if_owned "$pid" "$start_ticks"
}

command_name="${1:-start}"
if [[ "$command_name" =~ ^(start|stop|restart|status)$ ]]; then
  shift || true
else
  command_name="start"
fi

config_path="${AGENT_CONFIG_PATH:-}"
cargo_mode=()
cargo_profile="debug"
server_args=()
while (( $# )); do
  case "$1" in
    -c|--config)
      [[ $# -ge 2 ]] || { echo "Missing value for $1" >&2; exit 2; }
      config_path="$2"
      shift 2
      ;;
    -r|--release)
      cargo_mode=(--release)
      cargo_profile="release"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      server_args=("$@")
      break
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if ! command -v flock >/dev/null 2>&1; then
  echo "flock is required (install Debian's util-linux package)." >&2
  exit 1
fi

exec {lock_fd}>"$lock_file"

case "$command_name" in
  stop)
    flock "$lock_fd"
    stop_server
    flock -u "$lock_fd"
    exit 0
    ;;
  status)
    flock "$lock_fd"
    if read -r pid start_ticks < <(read_process_state) \
        && is_managed_process_running "$pid" "$start_ticks"; then
      echo "Caatuu runtime is running (PID $pid)."
    else
      rm -f "$pid_file"
      echo "Caatuu runtime is stopped."
    fi
    flock -u "$lock_fd"
    exit 0
    ;;
  restart)
    flock "$lock_fd"
    stop_server
    flock -u "$lock_fd"
    ;;
esac

if [[ "$command_name" == "restart" ]]; then
  if ! flock -w 5 "$lock_fd"; then
    echo "Timed out waiting for the previous Caatuu launcher to stop." >&2
    exit 1
  fi
elif ! flock -n "$lock_fd"; then
  if read -r pid start_ticks < <(read_process_state) \
      && is_managed_process_running "$pid" "$start_ticks"; then
    echo "Caatuu runtime is already running (PID $pid)." >&2
  else
    echo "Another Caatuu launcher is already starting or stopping." >&2
  fi
  exit 1
fi

# The kernel lock is authoritative. Once held, discard only stale state from a
# launcher that no longer owns a process with the recorded start time.
if read -r pid start_ticks < <(read_process_state); then
  if is_managed_process_running "$pid" "$start_ticks"; then
    echo "Caatuu runtime is already running (PID $pid)." >&2
    exit 1
  fi
  remove_state_if_owned "$pid" "$start_ticks"
else
  rm -f "$pid_file"
fi

if is_enabled "$ENABLE_ARCHIVED_CHINESE_API"; then
  if [[ -z "$config_path" && -f "$script_dir/profiles/word_challenge.toml" ]]; then
    config_path="$script_dir/profiles/word_challenge.toml"
  elif [[ -n "$config_path" && "$config_path" != /* ]]; then
    config_path="$script_dir/$config_path"
  fi
  if [[ -n "$config_path" ]]; then
    [[ -f "$config_path" ]] || { echo "Agent config not found: $config_path" >&2; exit 1; }
    export AGENT_CONFIG_PATH="$config_path"
  fi
else
  unset AGENT_CONFIG_PATH
fi

cd "$script_dir"
echo "Building Caatuu runtime (${cargo_mode[*]:-dev})."
cargo build --locked "${cargo_mode[@]}"

target_dir="${CARGO_TARGET_DIR:-$script_dir/target}"
if [[ "$target_dir" != /* ]]; then
  target_dir="$script_dir/$target_dir"
fi
server_binary="$target_dir/$cargo_profile/caatuu-runtime"
if [[ ! -x "$server_binary" ]]; then
  echo "Cargo build did not produce an executable runtime at $server_binary" >&2
  exit 1
fi

echo "Starting Caatuu runtime on port $PORT ($cargo_profile)."
"$server_binary" "${server_args[@]}" &
server_pid=$!
if ! server_start_ticks="$(process_start_ticks "$server_pid")"; then
  set +e
  wait "$server_pid"
  server_status=$?
  set -e
  echo "Caatuu runtime exited before launcher state could be recorded." >&2
  exit "$server_status"
fi

state_tmp="$pid_file.$BASHPID"
cleanup() {
  local server_status=$?
  trap - EXIT
  rm -f "${state_tmp:-}"
  if flock "$lock_fd"; then
    remove_state_if_owned "$server_pid" "$server_start_ticks"
    flock -u "$lock_fd"
  fi
  exit "$server_status"
}
forward_signal() {
  if is_managed_process_running "$server_pid" "$server_start_ticks"; then
    kill -TERM "$server_pid" 2>/dev/null || true
  fi
}
trap forward_signal INT TERM
trap cleanup EXIT

printf '%s %s\n' "$server_pid" "$server_start_ticks" > "$state_tmp"
mv -f "$state_tmp" "$pid_file"
flock -u "$lock_fd"

server_status=0
while true; do
  set +e
  wait "$server_pid"
  server_status=$?
  set -e
  is_managed_process_running "$server_pid" "$server_start_ticks" || break
done
exit "$server_status"
