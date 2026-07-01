#!/usr/bin/env bash
set -euo pipefail

if pgrep -x nginx >/dev/null 2>&1; then
  nginx -s quit >/tmp/caatuu-nginx-stop.log 2>&1 || pkill -x nginx
fi

if pgrep -x caatuu-backend >/dev/null 2>&1; then
  pkill -x caatuu-backend
fi

cd /workspace/apps/caatuu-chinese

set +u
. ./env.sh >/tmp/caatuu-env.log 2>&1
set -u

export CAATUU_WORKSPACE_ROOT="${CAATUU_WORKSPACE_ROOT:-/workspace}"
export PORT="${PORT:-9172}"
export AGENT_CONFIG_PATH="${AGENT_CONFIG_PATH:-./profiles/word_challenge.toml}"

if [ -x /workspace/apps/caatuu-chinese/target-linux/debug/caatuu-backend ]; then
  exec /workspace/apps/caatuu-chinese/target-linux/debug/caatuu-backend
fi

if [ -x /workspace/apps/caatuu-chinese/target/debug/caatuu-backend ]; then
  exec /workspace/apps/caatuu-chinese/target/debug/caatuu-backend
fi

echo "Missing caatuu-backend binary. Build it first with:"
echo "docker run --rm -v C:\\Work\\caatuu:/workspace -w /workspace/apps/caatuu-chinese -e CARGO_TARGET_DIR=/workspace/apps/caatuu-chinese/target-linux rust:latest cargo build"
exit 1
