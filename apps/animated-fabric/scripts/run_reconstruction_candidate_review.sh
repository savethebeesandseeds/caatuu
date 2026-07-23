#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/run_reconstruction_candidate_review.sh [--build] CANDIDATE_ID

Render four fixed Blender views of one immutable AF-045 reconstruction proposal.
All Python and Blender work runs in the existing repository-owned Linux container.

Options:
  --build     Rebuild the existing directional Blender image before review.
  -h, --help  Show this help text.
EOF
}

build_image=false
candidate_id=""
while (($# > 0)); do
  case "$1" in
    --build)
      build_image=true
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$candidate_id" ]]; then
        printf 'Only one candidate ID is accepted.\n\n' >&2
        usage >&2
        exit 2
      fi
      candidate_id="$1"
      ;;
  esac
  shift
done

if [[ ! "$candidate_id" =~ ^[a-z0-9][a-z0-9_-]{0,63}$ ]]; then
  printf 'Candidate ID must contain 1-64 lowercase letters, digits, hyphens, or underscores.\n' >&2
  exit 2
fi
if [[ "$(uname -s)" != "Linux" ]]; then
  printf 'AF-045 review orchestration requires a Linux host.\n' >&2
  exit 2
fi

local_uid="$(id -u)"
local_gid="$(id -g)"
if [[ "$local_uid" == "0" || "$local_gid" == "0" ]]; then
  printf 'AF-045 review refuses to run as root or the root group.\n' >&2
  exit 2
fi
export LOCAL_UID="$local_uid"
export LOCAL_GID="$local_gid"

script_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
app_root="$(CDPATH= cd -- "$script_root/.." && pwd -P)"
candidate_parent="$app_root/workspaces/reconstruction/output"
candidate_root="$candidate_parent/$candidate_id"
blender_root="$app_root/workspaces/blender"
review_id="af045-${candidate_id}-review"
review_root="$blender_root/$review_id"
contract_source="$app_root/tools/blender/reconstruction_candidate_review.py"
renderer_source="$app_root/tools/blender/render_reconstruction_candidate.py"

for path in \
  "$app_root/workspaces" \
  "$app_root/workspaces/reconstruction" \
  "$candidate_parent" \
  "$candidate_root"; do
  if [[ -L "$path" || ! -d "$path" ]]; then
    printf 'AF-045 requires one real application-local directory: %s\n' "$path" >&2
    exit 2
  fi
done
resolved_candidate="$(CDPATH= cd -- "$candidate_root" && pwd -P)"
if [[ "$resolved_candidate" != "$candidate_root" ]]; then
  printf 'AF-045 candidate path must not escape the reconstruction workspace.\n' >&2
  exit 2
fi

expected_files=(candidate.json input.png mesh.glb)
for name in "${expected_files[@]}"; do
  path="$candidate_root/$name"
  if [[ -L "$path" || ! -f "$path" ]]; then
    printf 'AF-045 candidate is missing a regular file: %s\n' "$path" >&2
    exit 2
  fi
done
file_count="$(find "$candidate_root" -mindepth 1 -maxdepth 1 -printf '.' | wc -c)"
if [[ "$file_count" != "${#expected_files[@]}" ]]; then
  printf 'AF-045 candidate must contain exactly candidate.json, input.png, and mesh.glb.\n' >&2
  exit 2
fi
for source in "$contract_source" "$renderer_source"; do
  if [[ -L "$source" || ! -f "$source" ]]; then
    printf 'AF-045 review source is unavailable: %s\n' "$source" >&2
    exit 2
  fi
done

if [[ -L "$blender_root" ]]; then
  printf 'The application-local Blender workspace must not be a symbolic link.\n' >&2
  exit 2
fi
mkdir -p -- "$blender_root"
resolved_blender="$(CDPATH= cd -- "$blender_root" && pwd -P)"
if [[ "$resolved_blender" != "$blender_root" ]]; then
  printf 'The Blender workspace must remain application-local.\n' >&2
  exit 2
fi
if [[ -e "$review_root" || -L "$review_root" ]]; then
  printf 'AF-045 review output is immutable; destination already exists: %s\n' "$review_root" >&2
  exit 2
fi

command -v docker >/dev/null 2>&1 || {
  printf 'Docker with the Compose plugin is required.\n' >&2
  exit 2
}
command -v timeout >/dev/null 2>&1 || {
  printf 'GNU timeout is required.\n' >&2
  exit 2
}
command -v sha256sum >/dev/null 2>&1 || {
  printf 'sha256sum is required.\n' >&2
  exit 2
}

cd -- "$app_root"
compose=(
  docker compose
  --file "$app_root/compose.yaml"
  --project-directory "$app_root"
)
"${compose[@]}" --profile blender config --quiet

if [[ "$build_image" == true ]]; then
  "${compose[@]}" --profile blender build animated-fabric-blender
elif ! docker image inspect \
  caatuu-animated-fabric-blender:4.5.12-cycles-cpu >/dev/null 2>&1; then
  printf '%s\n' \
    'The pinned Blender image is absent. Re-run with --build to create it.' >&2
  exit 2
fi

worker_uid="$(
  "${compose[@]}" --profile blender run --rm --no-deps \
    --entrypoint /usr/bin/id animated-fabric-blender -u
)"
if [[ ! "$worker_uid" =~ ^[0-9]+$ || "$worker_uid" == "0" ]]; then
  printf 'The Blender worker must use a non-root numeric UID; got %s.\n' \
    "$worker_uid" >&2
  exit 2
fi

timeout --signal=TERM --kill-after=30s 5m \
  "${compose[@]}" --profile blender run --rm --no-deps \
  --entrypoint /opt/blender/blender \
  --volume "$candidate_root:/candidate:ro" \
  --volume \
    "$contract_source:/opt/animated-fabric/reconstruction_candidate_review.py:ro" \
  --volume \
    "$renderer_source:/opt/animated-fabric/render_reconstruction_candidate.py:ro" \
  animated-fabric-blender \
  --background \
  --factory-startup \
  --disable-autoexec \
  --offline-mode \
  -noaudio \
  --python-exit-code 10 \
  --python /opt/animated-fabric/render_reconstruction_candidate.py \
  -- \
  --expected-candidate-id "$candidate_id" \
  --out "/output/$review_id"

artifacts=(
  "$review_root/front.png"
  "$review_root/left.png"
  "$review_root/back.png"
  "$review_root/front-right-3q.png"
  "$review_root/review.json"
)
for artifact in "${artifacts[@]}"; do
  if [[ -L "$artifact" || ! -f "$artifact" ]]; then
    printf 'AF-045 review did not publish a regular artifact: %s\n' "$artifact" >&2
    exit 5
  fi
done
review_file_count="$(find "$review_root" -mindepth 1 -maxdepth 1 -printf '.' | wc -c)"
if [[ "$review_file_count" != "${#artifacts[@]}" ]]; then
  printf 'AF-045 review published an unexpected file set.\n' >&2
  exit 5
fi

printf 'AF-045 four-view review completed with worker UID %s.\n' "$worker_uid"
sha256sum -- "${artifacts[@]}"
printf 'Review: %s\n' "$review_root"
