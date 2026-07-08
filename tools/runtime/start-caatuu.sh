#!/usr/bin/env bash
set -euo pipefail

if pgrep -x nginx >/dev/null 2>&1; then
  nginx -s quit >/tmp/caatuu-nginx-stop.log 2>&1 || pkill -x nginx
fi

if pgrep -x caatuu-runtime >/dev/null 2>&1; then
  pkill -x caatuu-runtime
fi

cd /workspace/apps/caatuu-runtime

set +u
. ./env.sh >/tmp/caatuu-env.log 2>&1
set -u

export CAATUU_WORKSPACE_ROOT="${CAATUU_WORKSPACE_ROOT:-/workspace}"
export PORT="${PORT:-9172}"
export AGENT_CONFIG_PATH="${AGENT_CONFIG_PATH:-./profiles/word_challenge.toml}"

if [ -x /workspace/apps/caatuu-runtime/target-linux/debug/caatuu-runtime ]; then
  exec /workspace/apps/caatuu-runtime/target-linux/debug/caatuu-runtime
fi

if [ -x /workspace/apps/caatuu-runtime/target/debug/caatuu-runtime ]; then
  exec /workspace/apps/caatuu-runtime/target/debug/caatuu-runtime
fi

echo "Missing caatuu-runtime binary. Build it first with:"
echo "docker compose -f compose.tools.yaml run --rm caatuu-build"
exit 1
