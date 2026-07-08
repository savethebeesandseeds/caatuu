#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions.env
source "$script_dir/versions.env"

download_dir="${TMPDIR:-/tmp}/caatuu-android-build"
mkdir -p "$download_dir" "$ANDROID_HOME" "$(dirname "$GRADLE_HOME")"

bash "$script_dir/setup-jdk.sh"
# setup-jdk.sh may create JDK_HOME, so source the paths again.
source "$script_dir/versions.env"

download_cmdline_tools() {
  if [ -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
    echo "Android command-line tools already installed at $ANDROID_HOME"
    return
  fi

  local zip="$download_dir/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS_VERSION}_latest.zip"
  local url="https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS_VERSION}_latest.zip"
  local unpack_dir="$download_dir/cmdline-tools-unpack"

  echo "Downloading Android command-line tools $ANDROID_CMDLINE_TOOLS_VERSION"
  curl -fL --retry 3 -o "$zip" "$url"
  printf "%s  %s\n" "$ANDROID_CMDLINE_TOOLS_SHA1" "$zip" | sha1sum -c -

  rm -rf "$unpack_dir" "$ANDROID_HOME/cmdline-tools/latest"
  mkdir -p "$unpack_dir" "$ANDROID_HOME/cmdline-tools"
  unzip -q "$zip" -d "$unpack_dir"
  mv "$unpack_dir/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
}

download_gradle() {
  if [ -x "$GRADLE_HOME/bin/gradle" ]; then
    echo "Gradle already installed at $GRADLE_HOME"
    return
  fi

  local zip="$download_dir/gradle-${GRADLE_VERSION}-bin.zip"
  local sha_file="$download_dir/gradle-${GRADLE_VERSION}-bin.zip.sha256"
  local url="https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"

  echo "Downloading Gradle $GRADLE_VERSION"
  curl -fL --retry 3 -o "$zip" "$url"
  curl -fL --retry 3 -o "$sha_file" "$url.sha256"
  printf "%s  %s\n" "$(tr -d '[:space:]' < "$sha_file")" "$zip" | sha256sum -c -

  unzip -q "$zip" -d "$(dirname "$GRADLE_HOME")"
}

download_cmdline_tools
download_gradle

set +o pipefail
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses >/dev/null
license_status=$?
set -o pipefail
if [ "$license_status" -ne 0 ]; then
  echo "Android SDK license acceptance failed." >&2
  exit "$license_status"
fi

sdkmanager --sdk_root="$ANDROID_HOME" --install \
  "platform-tools" \
  "platforms;android-${ANDROID_COMPILE_SDK}" \
  "build-tools;${ANDROID_BUILD_TOOLS_VERSION}" \
  "build-tools;${ANDROID_FALLBACK_BUILD_TOOLS_VERSION}" \
  "ndk;${ANDROID_NDK_VERSION}" \
  "cmake;${ANDROID_CMAKE_VERSION}"

echo "Android SDK is ready at $ANDROID_HOME"
echo "Gradle is ready at $GRADLE_HOME"
