#!/usr/bin/env bash

set -Eeuo pipefail

readonly wheel_name="torch-2.2.2+cu118-cp312-cp312-linux_x86_64.whl"
readonly wheel_url="https://download-r2.pytorch.org/whl/cu118/torch-2.2.2%2Bcu118-cp312-cp312-linux_x86_64.whl"
readonly wheel_bytes=819120631
readonly wheel_sha256="c0fa31b79d2c06012422e4ed4ed08a86179615463647ac5c44c8f6abef1d4aec"
readonly segment_count=4
readonly segment_bytes=$(((wheel_bytes + segment_count - 1) / segment_count))
readonly cache_root="${1:?cache root is required}"
readonly wheel_path="${cache_root}/${wheel_name}"

sha256() {
  sha256sum "$1" | cut -d" " -f1
}

wheel_is_valid() {
  [[ -f "$wheel_path" ]] &&
    [[ "$(stat --format=%s "$wheel_path")" == "$wheel_bytes" ]] &&
    [[ "$(sha256 "$wheel_path")" == "$wheel_sha256" ]]
}

download_segment() {
  local index="$1"
  local start=$((index * segment_bytes))
  local end=$((start + segment_bytes - 1))
  local expected
  local target
  local current
  local next
  local attempts=0

  if ((end >= wheel_bytes)); then
    end=$((wheel_bytes - 1))
  fi
  expected=$((end - start + 1))
  printf -v target "%s/%s.segment-%02d" "$cache_root" "$wheel_name" "$index"

  while true; do
    current=0
    if [[ -f "$target" ]]; then
      current="$(stat --format=%s "$target")"
    fi
    if ((current == expected)); then
      break
    fi
    if ((current > expected)); then
      printf "Torch segment %s exceeds its expected size.\n" "$index" >&2
      return 21
    fi

    attempts=$((attempts + 1))
    if ((attempts > 40)); then
      printf "Torch segment %s exhausted resumable attempts.\n" "$index" >&2
      return 22
    fi
    next=$((start + current))
    curl \
      --location \
      --fail \
      --silent \
      --show-error \
      --connect-timeout 30 \
      --speed-limit 1024 \
      --speed-time 120 \
      --range "$next-$end" \
      "$wheel_url" >>"$target" || true
  done
  printf "Torch segment %s complete: %s bytes\n" "$index" "$expected"
}

mkdir -p "$cache_root"
if wheel_is_valid; then
  printf "Verified cached Torch wheel: %s\n" "$wheel_path"
  exit 0
fi
if [[ -e "$wheel_path" ]]; then
  printf "Cached Torch wheel exists but does not match its pinned identity.\n" >&2
  exit 23
fi

for index in $(seq 0 $((segment_count - 1))); do
  download_segment "$index" &
done
wait

temporary_path="${wheel_path}.partial"
cat "${cache_root}/${wheel_name}".segment-?? >"$temporary_path"
if [[ "$(stat --format=%s "$temporary_path")" != "$wheel_bytes" ]]; then
  printf "Assembled Torch wheel has the wrong byte count.\n" >&2
  exit 24
fi
actual_sha256="$(sha256 "$temporary_path")"
if [[ "$actual_sha256" != "$wheel_sha256" ]]; then
  printf "Assembled Torch wheel failed SHA-256: %s\n" "$actual_sha256" >&2
  exit 25
fi
mv "$temporary_path" "$wheel_path"
printf "Verified Torch wheel: %s bytes, SHA-256 %s\n" \
  "$wheel_bytes" "$wheel_sha256"
