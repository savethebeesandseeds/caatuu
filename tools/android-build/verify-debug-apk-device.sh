#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=versions.env
source "$repo_root/tools/android-build/versions.env"

adb_bin="${ADB:-$ANDROID_HOME/platform-tools/adb}"
apk_path="${APK:-$repo_root/artifacts/android/caatuu.apk}"
package_name="${PACKAGE_NAME:-com.waajacu.caatuu}"
activity_name="${ACTIVITY_NAME:-com.caatuu.android.MainActivity}"
report_dir="${REPORT_DIR:-$repo_root/artifacts/android/device-smoke}"

mkdir -p "$report_dir"

if [[ ! -x "$adb_bin" ]]; then
  echo "adb not found at $adb_bin. Run tools/android-build/setup-sdk.sh first." >&2
  exit 1
fi

if [[ ! -f "$apk_path" ]]; then
  echo "APK not found at $apk_path. Run tools/android-build/build-debug-apk.sh first." >&2
  exit 1
fi

mapfile -t devices < <("$adb_bin" devices | awk 'NR > 1 && $2 == "device" { print $1 }')
if [[ "${#devices[@]}" -ne 1 ]]; then
  echo "Expected exactly one authorized Android device; found ${#devices[@]}." >&2
  "$adb_bin" devices -l >&2
  exit 1
fi

device="${devices[0]}"
report="$report_dir/report.txt"
logcat_file="$report_dir/logcat.txt"
ui_file="$report_dir/window.xml"
screenshot_file="$report_dir/screenshot.png"

: > "$report"

run() {
  echo "$ $*" | tee -a "$report"
  "$@" 2>&1 | tee -a "$report"
}

run "$adb_bin" -s "$device" shell getprop ro.build.version.release
run "$adb_bin" -s "$device" shell getprop ro.build.version.sdk
run "$adb_bin" -s "$device" shell getprop ro.product.cpu.abi

run "$adb_bin" -s "$device" install -r -d "$apk_path"
run "$adb_bin" -s "$device" shell am force-stop "$package_name"
"$adb_bin" -s "$device" logcat -c || true
run "$adb_bin" -s "$device" shell am start -W -n "$package_name/$activity_name"

sleep 5

pid="$("$adb_bin" -s "$device" shell pidof "$package_name" | tr -d '\r' || true)"
if [[ -z "$pid" ]]; then
  "$adb_bin" -s "$device" logcat -d > "$logcat_file" || true
  echo "Caatuu package did not stay running after launch. See $logcat_file" >&2
  exit 1
fi
echo "pid: $pid" | tee -a "$report"

"$adb_bin" -s "$device" shell uiautomator dump /sdcard/caatuu-window.xml >> "$report" 2>&1 || true
"$adb_bin" -s "$device" pull /sdcard/caatuu-window.xml "$ui_file" >> "$report" 2>&1 || true
"$adb_bin" -s "$device" shell screencap -p /sdcard/caatuu-screen.png >> "$report" 2>&1 || true
"$adb_bin" -s "$device" pull /sdcard/caatuu-screen.png "$screenshot_file" >> "$report" 2>&1 || true
"$adb_bin" -s "$device" logcat -d > "$logcat_file" || true

if grep -Eiq "device-ai|archive/chinese|/zh" "$logcat_file"; then
  echo "Found retired browser/archive route text in device logcat. See $logcat_file" >&2
  exit 1
fi

echo "Caatuu Android device smoke passed."
echo "Report: $report"
echo "Logcat: $logcat_file"
echo "UI dump: $ui_file"
echo "Screenshot: $screenshot_file"
