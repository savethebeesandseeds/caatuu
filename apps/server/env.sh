#!/usr/bin/env bash
# env.sh — base env vars for Caatuu server
# Usage: source ./env.sh

# Fail fast if sourced in shells that support it
set -o nounset >/dev/null 2>&1 || true

# --- Defaults (can be overridden before sourcing) ---
: "${PORT:=9172}"
: "${BIND_ADDR:=127.0.0.1}"
: "${RUST_LOG:=info,tower_http=info}"
: "${ENABLE_ANDROID_DEBUG_DOWNLOADS:=0}"

export BIND_ADDR PORT RUST_LOG ENABLE_ANDROID_DEBUG_DOWNLOADS
