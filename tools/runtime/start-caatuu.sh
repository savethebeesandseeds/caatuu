#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
workspace_root="${CAATUU_WORKSPACE_ROOT:-$(cd -- "$script_dir/../.." && pwd -P)}"
runtime_dir="$workspace_root/apps/caatuu-runtime"
cd "$runtime_dir"

set +u
. ./env.sh >/tmp/caatuu-env.log 2>&1
set -u

export CAATUU_WORKSPACE_ROOT="$workspace_root"
export PORT="${PORT:-9172}"
export AGENT_CONFIG_PATH="${AGENT_CONFIG_PATH:-./profiles/word_challenge.toml}"

if command -v cargo >/dev/null 2>&1; then
  exec cargo run --release --locked
fi

if [ -x /usr/local/bin/caatuu-runtime ]; then
  exec /usr/local/bin/caatuu-runtime
fi

echo "Missing the packaged runtime and Cargo is unavailable." >&2
echo "Start with 'docker compose up -d --build caatuu' or install Rust." >&2
exit 1
