#!/usr/bin/env bash
set -euo pipefail

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  file \
  git \
  openjdk-17-jdk-headless \
  unzip
rm -rf /var/lib/apt/lists/*
