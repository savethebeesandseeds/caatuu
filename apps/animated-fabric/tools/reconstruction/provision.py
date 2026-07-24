"""Fixed entry point for the network-enabled model provisioner image."""

from __future__ import annotations

import sys

from tools.reconstruction import configured_model_cache
from tools.reconstruction.prefetch import prefetch_all_models


def main() -> int:
    """Download and verify every immutable reconstruction model snapshot."""
    try:
        snapshots = prefetch_all_models(configured_model_cache())
    except Exception as exc:
        print(f"Error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    for snapshot in snapshots:
        print(f"Prefetched and verified: {snapshot}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
