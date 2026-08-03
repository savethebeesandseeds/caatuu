#!/usr/bin/env bash
set -euo pipefail

app_root="/workspace/apps/animated-fabric"
if [[ ! -f "$app_root/pyproject.toml" ]]; then
  echo "Animated Fabric is not mounted from the canonical Caatuu workspace." >&2
  exit 2
fi
if ! cmp --silent \
  /tmp/animated-fabric-linux-py312.txt \
  "$app_root/constraints/linux-py312.txt"; then
  echo "The shared image dependency lock differs from Animated Fabric's canonical lock." >&2
  echo "Rebuild caatuu-dev from the root Caatuu Compose project before continuing." >&2
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
