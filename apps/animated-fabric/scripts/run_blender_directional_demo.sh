#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/run_blender_directional_demo.sh [--skip-build]

Render, visually verify, review, and package the fixed AF-053 directional demo.
Docker Compose performs all Python and Blender work inside the repository-owned
Linux containers. Outputs are fixed below workspaces/blender/.

Options:
  --skip-build  Reuse the existing development and Blender images.
  -h, --help    Show this help text.
EOF
}

skip_build=false
while (($# > 0)); do
  case "$1" in
    --skip-build)
      skip_build=true
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$(uname -s)" != "Linux" ]]; then
  printf 'AF-053 orchestration requires a Linux host.\n' >&2
  exit 2
fi

local_uid="$(id -u)"
local_gid="$(id -g)"
if [[ "$local_uid" == "0" || "$local_gid" == "0" ]]; then
  printf 'AF-053 orchestration refuses to run as root or the root group.\n' >&2
  exit 2
fi
export LOCAL_UID="$local_uid"
export LOCAL_GID="$local_gid"

script_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
app_root="$(CDPATH= cd -- "$script_root/.." && pwd -P)"
workspace_parent="$app_root/workspaces"
workspace_root="$workspace_parent/blender"

if [[ -L "$workspace_parent" || -L "$workspace_root" ]]; then
  printf 'The AF-053 workspace and its parent must not be symbolic links.\n' >&2
  exit 2
fi
mkdir -p -- "$workspace_root"
if [[ -L "$workspace_parent" || -L "$workspace_root" || ! -d "$workspace_root" ]]; then
  printf 'The AF-053 workspace could not be created safely.\n' >&2
  exit 2
fi
resolved_workspace="$(CDPATH= cd -- "$workspace_root" && pwd -P)"
if [[ "$resolved_workspace" == "/" || "$resolved_workspace" != "$workspace_root" ]]; then
  printf 'The AF-053 workspace must be the real application-local Blender directory.\n' >&2
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

evidence_relative="workspaces/blender/af053-demo"
product_relative="workspaces/blender/af053-product"
review_relative="workspaces/blender/af053-demo-review"

evidence_root="$app_root/$evidence_relative"
product_root="$app_root/$product_relative"
review_root="$app_root/$review_relative"

"${compose[@]}" --profile blender config --quiet

if [[ "$skip_build" == false ]]; then
  "${compose[@]}" --profile blender build \
    animated-fabric-dev animated-fabric-blender
fi

worker_uid="$(
  "${compose[@]}" --profile blender run --rm --no-deps \
    --entrypoint /usr/bin/id animated-fabric-blender -u
)"
if [[ ! "$worker_uid" =~ ^[0-9]+$ || "$worker_uid" == "0" ]]; then
  printf 'The Blender worker must run with a non-root numeric UID; got %s.\n' \
    "$worker_uid" >&2
  exit 2
fi
printf 'Verified non-root Blender worker UID %s.\n' "$worker_uid"

timeout --signal=TERM --kill-after=30s 5m \
  "${compose[@]}" --profile blender run --rm --no-deps \
  animated-fabric-blender --out /output/af053-demo

"${compose[@]}" run --rm --no-deps animated-fabric-dev \
  python scripts/verify_blender_directional_goldens.py \
  --source "$evidence_relative"

"${compose[@]}" run --rm --no-deps animated-fabric-dev \
  python scripts/package_blender_walk_demo.py \
  --source "$evidence_relative" \
  --out "$review_relative"

"${compose[@]}" run --rm --no-deps animated-fabric-dev \
  python scripts/package_blender_directional_export.py \
  --source "$evidence_relative" \
  --out "$product_relative"

artifacts=(
  "$evidence_root/directional-prerender.json"
  "$evidence_root/provenance.json"
  "$product_root/walk.png"
  "$product_root/walk.spritesheet.json"
  "$review_root/walk_contact_sheet.png"
  "$review_root/walk_review.gif"
)
for artifact in "${artifacts[@]}"; do
  if [[ -L "$artifact" || ! -f "$artifact" ]]; then
    printf 'AF-053 expected a regular output file: %s\n' "$artifact" >&2
    exit 5
  fi
done

printf 'AF-053 SHA-256 results:\n'
sha256sum -- "${artifacts[@]}"
printf 'AF-053 end-to-end directional demo completed successfully.\n'
printf 'Evidence: %s\n' "$evidence_root"
printf 'Product: %s\n' "$product_root"
printf 'Review: %s\n' "$review_root"
