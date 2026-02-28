#!/usr/bin/env bash
# env.sh — base env vars for Caatuu server
# Usage:
#   source ./env.sh            # load defaults (safe, no secrets)
#   source ./env.local.sh      # (optional) your private overrides

# Fail fast if sourced in shells that support it
set -o nounset >/dev/null 2>&1 || true

# --- Defaults (can be overridden before sourcing, or by env.local.sh) ---
: "${PORT:=9172}"
: "${OPENAI_BASE_URL:=https://api.openai.com/v1}"
: "${OPENAI_FAST_MODEL:=gpt-5-nano}"
: "${OPENAI_STRONG_MODEL:=gpt-5-mini}"
: "${RUST_LOG:=info,challenge=debug,caatuu_backend=debug,tower_http=info,axum=info}"
: "${WS_ALLOW_ALL:=1}"

# Note: do NOT put real secrets here if this file is committed.
# OPENAI_API_KEY is intentionally NOT defaulted.
# Export everything
export PORT OPENAI_BASE_URL OPENAI_FAST_MODEL OPENAI_STRONG_MODEL RUST_LOG WS_ALLOW_ALL

# Optionally allow a local, untracked overrides file.
# Create env.local.sh and place your OPENAI_API_KEY there.
if [[ -f "$(dirname "${BASH_SOURCE[0]}")/env.local.sh" ]]; then
  # shellcheck source=/dev/null
  source "$(dirname "${BASH_SOURCE[0]}")/env.local.sh"
fi

# Sanity notes (no hard failure here—run.sh will enforce)
: "${OPENAI_API_KEY:=}"
export OPENAI_API_KEY
