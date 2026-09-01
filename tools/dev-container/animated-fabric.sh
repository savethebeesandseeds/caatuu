#!/usr/bin/env bash
set -euo pipefail

app_root="/workspace/apps/animated-fabric"
lock_snapshot="/opt/caatuu-dev/state/animated-fabric-linux-py312.txt"
if [[ ! -f "$lock_snapshot" ]] && [[ -f /tmp/animated-fabric-linux-py312.txt ]]; then
  lock_snapshot="/tmp/animated-fabric-linux-py312.txt"
fi
if [[ ! -f "$app_root/pyproject.toml" ]]; then
  echo "Animated Fabric is not mounted from the canonical Caatuu workspace." >&2
  exit 2
fi
if [[ ! -f "$lock_snapshot" ]]; then
  echo "The provisioned Animated Fabric dependency lock is missing." >&2
  echo "Rerun /workspace/setup.sh inside caatuu-dev before continuing." >&2
  exit 2
fi
if ! cmp --silent \
  "$lock_snapshot" \
  "$app_root/constraints/linux-py312.txt"; then
  echo "The shared image dependency lock differs from Animated Fabric's canonical lock." >&2
  echo "Rerun /workspace/setup.sh inside caatuu-dev before continuing." >&2
  exit 2
fi

export PATH="/opt/animated-fabric/bin:$PATH"
export PIP_CONSTRAINT="$app_root/constraints/linux-py312.txt"
export PYTHONPATH="$app_root/src${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONDONTWRITEBYTECODE="${PYTHONDONTWRITEBYTECODE:-1}"
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"

cd "$app_root"
if [[ $# -eq 0 ]]; then
  exec bash
fi
exec "$@"
