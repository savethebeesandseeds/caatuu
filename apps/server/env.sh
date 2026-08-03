#!/usr/bin/env bash
# env.sh — base env vars for Caatuu server
# Usage:
#   source ./env.sh            # load defaults (safe, no secrets)
#   OPENAI_API_KEY_FILE=/path/to/key source ./env.sh

# Fail fast if sourced in shells that support it
set -o nounset >/dev/null 2>&1 || true

# --- Defaults (can be overridden before sourcing) ---
: "${PORT:=9172}"
: "${BIND_ADDR:=127.0.0.1}"
: "${OPENAI_BASE_URL:=https://api.openai.com/v1}"
: "${OPENAI_FAST_MODEL:=gpt-4o-mini}"
: "${OPENAI_WRITING_MODEL:=gpt-4o-mini}"
: "${OPENAI_STRONG_MODEL:=gpt-4o}"
: "${OPENAI_SEQUENCE_MODEL:=gpt-4o-mini}"
: "${OPENAI_TRANSCRIBE_MODEL:=gpt-4o-transcribe}"
: "${RUST_LOG:=info,tower_http=info}"
: "${ENABLE_ARCHIVED_CHINESE_API:=0}"
: "${ENABLE_ANDROID_DEBUG_DOWNLOADS:=0}"
: "${OPENAI_API_KEY_FILE:=}"

# Note: do NOT put real secrets here if this file is committed.
# OPENAI_API_KEY is intentionally NOT defaulted.
# Export everything
export BIND_ADDR PORT OPENAI_BASE_URL OPENAI_FAST_MODEL OPENAI_WRITING_MODEL OPENAI_STRONG_MODEL OPENAI_SEQUENCE_MODEL OPENAI_TRANSCRIBE_MODEL RUST_LOG ENABLE_ARCHIVED_CHINESE_API ENABLE_ANDROID_DEBUG_DOWNLOADS OPENAI_API_KEY_FILE

# The Rust client reads OPENAI_API_KEY_FILE directly. Never copy file-backed
# secret contents into the launcher environment or command line.
