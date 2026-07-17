#!/usr/bin/env bash
set -e

export VIRTUAL_ENV="${VIRTUAL_ENV:-/opt/caatuu-ml}"
export PATH="$VIRTUAL_ENV/bin:/root/.cargo/bin:$PATH"
export HF_HOME="${HF_HOME:-/workspace/tools/czech-ml/data/models/english-base/hf-cache}"
export HF_HUB_ENABLE_HF_TRANSFER="${HF_HUB_ENABLE_HF_TRANSFER:-1}"
export HF_XET_HIGH_PERFORMANCE="${HF_XET_HIGH_PERFORMANCE:-1}"
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"

cd /workspace
exec "$@"
