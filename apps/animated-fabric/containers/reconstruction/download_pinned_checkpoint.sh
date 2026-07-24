#!/usr/bin/env bash

set -Eeuo pipefail

readonly checkpoint_bytes=1677246742
readonly checkpoint_sha256=429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee
readonly model_revision=5b521936b01fbe1890f6f9baed0254ab6351c04a
readonly model_url="https://huggingface.co/stabilityai/TripoSR/resolve/${model_revision}/model.ckpt?download=true"
readonly segment_count=8
readonly segment_bytes=$(((checkpoint_bytes + segment_count - 1) / segment_count))
readonly staging_root="${ANIMATED_FABRIC_CHECKPOINT_STAGING:-/staging}"
readonly model_cache="${ANIMATED_FABRIC_MODEL_CACHE:-/models/huggingface/hub}"
readonly repository_root="${model_cache}/models--stabilityai--TripoSR"
readonly blob_root="${repository_root}/blobs"
readonly snapshot_root="${repository_root}/snapshots/${model_revision}"
readonly blob_path="${blob_root}/${checkpoint_sha256}"
readonly snapshot_path="${snapshot_root}/model.ckpt"

require_real_directory() {
  local path="$1"
  mkdir -p -- "$path"
  if [[ -L "$path" || ! -d "$path" ]]; then
    printf "Checkpoint directory must be one real directory: %s\n" "$path" >&2
    exit 20
  fi
}

verify_checkpoint() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || return 1
  [[ "$(stat --format=%s "$path")" == "$checkpoint_bytes" ]] || return 1
  [[ "$(sha256sum "$path" | cut -d" " -f1)" == "$checkpoint_sha256" ]]
}

download_segment() {
  local index="$1"
  local start=$((index * segment_bytes))
  local end=$((start + segment_bytes - 1))
  local target
  local expected
  local attempts=0
  local current
  local next
  local retry_delay

  if ((end >= checkpoint_bytes)); then
    end=$((checkpoint_bytes - 1))
  fi
  printf -v target "%s/segment-%02d.part" "$staging_root" "$index"
  expected=$((end - start + 1))

  while true; do
    current=0
    if [[ -f "$target" && ! -L "$target" ]]; then
      current="$(stat --format=%s "$target")"
    elif [[ -e "$target" || -L "$target" ]]; then
      printf "Checkpoint segment is not one regular file: %s\n" "$target" >&2
      return 21
    fi
    if ((current == expected)); then
      break
    fi
    if ((current > expected)); then
      printf "Checkpoint segment %s exceeds its expected size.\n" "$index" >&2
      return 22
    fi

    attempts=$((attempts + 1))
    if ((attempts > 240)); then
      printf "Checkpoint segment %s exhausted resumable attempts.\n" "$index" >&2
      return 23
    fi
    next=$((start + current))
    if curl \
      --location \
      --fail \
      --http1.1 \
      --silent \
      --show-error \
      --connect-timeout 30 \
      --speed-limit 1024 \
      --speed-time 120 \
      --range "$next-$end" \
      "$model_url" >>"$target"; then
      continue
    fi
    retry_delay=$((attempts * 5))
    if ((retry_delay > 30)); then
      retry_delay=30
    fi
    printf "Checkpoint segment %s paused for %ss before attempt %s.\n" \
      "$index" "$retry_delay" "$((attempts + 1))" >&2
    sleep "$retry_delay"
  done
  printf "Checkpoint segment %s complete: %s bytes\n" "$index" "$expected"
}

publish_snapshot_link() {
  local expected_target="../../blobs/${checkpoint_sha256}"
  local temporary_link="${snapshot_path}.af045-$$"

  if [[ -L "$snapshot_path" ]]; then
    if [[ "$(readlink "$snapshot_path")" != "$expected_target" ]]; then
      printf "Existing checkpoint snapshot link has an unexpected target.\n" >&2
      exit 24
    fi
    return
  fi
  if [[ -e "$snapshot_path" ]]; then
    printf "Checkpoint snapshot path exists and is not the expected link.\n" >&2
    exit 25
  fi
  ln -s "$expected_target" "$temporary_link"
  mv -- "$temporary_link" "$snapshot_path"
}

require_real_directory "$staging_root"
require_real_directory "$blob_root"
require_real_directory "$snapshot_root"

if [[ -e "$blob_path" || -L "$blob_path" ]]; then
  if ! verify_checkpoint "$blob_path"; then
    printf "Existing checkpoint blob failed exact size or SHA-256 verification.\n" >&2
    exit 26
  fi
  publish_snapshot_link
  printf "Verified existing pinned TripoSR checkpoint.\n"
  exit 0
fi

verified_path="${staging_root}/model.ckpt.verified"
if ! verify_checkpoint "$verified_path"; then
  pids=()
  for index in $(seq 0 $((segment_count - 1))); do
    download_segment "$index" &
    pids+=("$!")
  done
  failed=0
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      failed=1
    fi
  done
  if ((failed != 0)); then
    printf "At least one checkpoint segment failed; partial bytes are preserved.\n" >&2
    exit 27
  fi

  assembling_path="${staging_root}/model.ckpt.assembling"
  rm -f -- "$assembling_path"
  cat "${staging_root}"/segment-??.part >"$assembling_path"
  if ! verify_checkpoint "$assembling_path"; then
    printf "Assembled checkpoint failed exact size or SHA-256 verification.\n" >&2
    exit 28
  fi
  mv -- "$assembling_path" "$verified_path"
fi

temporary_blob="${blob_path}.af045-$$"
cp -- "$verified_path" "$temporary_blob"
if ! verify_checkpoint "$temporary_blob"; then
  rm -f -- "$temporary_blob"
  printf "Copied checkpoint blob failed exact verification.\n" >&2
  exit 29
fi
mv -- "$temporary_blob" "$blob_path"
publish_snapshot_link
printf "Published pinned TripoSR checkpoint: %s bytes sha256=%s\n" \
  "$checkpoint_bytes" "$checkpoint_sha256"
