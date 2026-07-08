#!/usr/bin/env bash
set -euo pipefail

apt-get update

apt_packages=(
  ca-certificates \
  curl \
  file \
  git \
  unzip
)

if apt-cache show openjdk-17-jdk-headless >/dev/null 2>&1; then
  apt_packages+=(openjdk-17-jdk-headless)
fi

apt-get install -y --no-install-recommends "${apt_packages[@]}"
rm -rf /var/lib/apt/lists/*

if ! command -v java >/dev/null 2>&1 || ! java -version 2>&1 | grep -q 'version "17'; then
  echo "OpenJDK 17 is not available from apt here; setup-sdk.sh will install Temurin JDK 17."
fi
