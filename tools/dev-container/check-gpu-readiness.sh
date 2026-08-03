#!/usr/bin/env bash
set -euo pipefail

require_nvidia="${CAATUU_REQUIRE_NVIDIA:-0}"
case "$require_nvidia" in
  0 | 1) ;;
  *)
    echo "CAATUU_REQUIRE_NVIDIA must be 0 or 1." >&2
    exit 2
    ;;
esac

nvidia_command="${CAATUU_NVIDIA_SMI:-nvidia-smi}"
python_command="${CAATUU_GPU_PYTHON:-python}"
nvidia_ready=0

if command -v "$nvidia_command" >/dev/null 2>&1; then
  if "$nvidia_command" >/dev/null 2>&1; then
    printf "%-12s %s\n" "nvidia-smi" "$(command -v "$nvidia_command")"
    nvidia_ready=1
  elif [[ "$require_nvidia" == "1" ]]; then
    echo "The GPU override requires a working nvidia-smi command." >&2
    exit 1
  else
    printf "%-12s optional (present but unavailable in CPU mode)\n" "nvidia-smi"
  fi
elif [[ "$require_nvidia" == "1" ]]; then
  echo "The GPU override requires NVIDIA tooling." >&2
  exit 1
else
  printf "%-12s optional (CPU-compatible environment)\n" "nvidia-smi"
fi

if [[ "$require_nvidia" == "0" ]]; then
  exit 0
fi
if [[ "$nvidia_ready" != "1" ]]; then
  echo "The GPU override did not establish NVIDIA runtime readiness." >&2
  exit 1
fi

cuda_available="$($python_command -c 'import torch; print("true" if torch.cuda.is_available() else "false")')" || {
  echo "The GPU override could not probe Torch CUDA readiness." >&2
  exit 1
}
if [[ "$cuda_available" != "true" ]]; then
  echo "The GPU override requires torch.cuda.is_available() to be true." >&2
  exit 1
fi
printf "%-24s %s\n" "torch CUDA readiness" "ready"
