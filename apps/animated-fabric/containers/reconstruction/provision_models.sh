#!/usr/bin/env bash

set -Eeuo pipefail

/usr/local/bin/download-pinned-triposr-checkpoint
exec python -m tools.reconstruction.provision
