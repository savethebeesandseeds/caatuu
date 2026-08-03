#!/usr/bin/env bash
set -euo pipefail

case "${0##*/}" in
  animated-fabric)
    exec caatuu-animated-fabric python -m animated_fabric "$@"
    ;;
  animated-fabric-gui)
    exec caatuu-animated-fabric python -c \
      'from animated_fabric.gui.app import main; raise SystemExit(main())' "$@"
    ;;
  *)
    echo "Unsupported Animated Fabric entrypoint: ${0##*/}" >&2
    exit 2
    ;;
esac
