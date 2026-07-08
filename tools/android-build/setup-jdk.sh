#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions.env
source "$script_dir/versions.env"

java_major() {
  "$1" -version 2>&1 | sed -nE 's/^[^"]*version "([0-9]+).*/\1/p' | head -1
}

if [ -x "$JDK_HOME/bin/java" ] && [ -x "$JDK_HOME/bin/javac" ]; then
  if [ "$(java_major "$JDK_HOME/bin/java")" = "17" ]; then
    echo "JDK 17 already installed at $JDK_HOME"
    exit 0
  fi
fi

if command -v java >/dev/null 2>&1 && command -v javac >/dev/null 2>&1; then
  if [ "$(java_major "$(command -v java)")" = "17" ]; then
    echo "System JDK 17 already available at $(dirname "$(dirname "$(command -v java)")")"
    exit 0
  fi
fi

download_dir="${TMPDIR:-/tmp}/caatuu-android-build"
mkdir -p "$download_dir" "$JDK_HOME"

archive="$download_dir/temurin-jdk-17.tar.gz"
checksum_file="$download_dir/temurin-jdk-17.tar.gz.sha256.txt"

echo "Downloading Temurin JDK 17"
effective_url="$(curl -fL --retry 3 -o "$archive" -w "%{url_effective}" "$JDK_DOWNLOAD_URL")"
if curl -fL --retry 3 -o "$checksum_file" "${effective_url}.sha256.txt"; then
  expected_checksum="$(sed -nE 's/^([0-9a-fA-F]{64}).*/\1/p' "$checksum_file" | head -1)"
  if [ -n "$expected_checksum" ]; then
    printf "%s  %s\n" "$expected_checksum" "$archive" | sha256sum -c -
  else
    echo "JDK checksum file did not contain a SHA-256 hash; validating extracted Java version instead." >&2
  fi
else
  echo "JDK checksum file was not available; validating extracted Java version instead." >&2
fi

rm -rf "$JDK_HOME"
mkdir -p "$JDK_HOME"
tar -xzf "$archive" -C "$JDK_HOME" --strip-components=1

if [ "$(java_major "$JDK_HOME/bin/java")" != "17" ]; then
  echo "Downloaded JDK at $JDK_HOME is not Java 17." >&2
  exit 1
fi

echo "JDK 17 is ready at $JDK_HOME"
