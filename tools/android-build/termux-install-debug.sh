#!/usr/bin/env sh
set -eu

APK_URL="${APK_URL:-https://caatuu.waajacu.com/android/caatuu-debug.apk}"
APK_FILE="${APK_FILE:-$HOME/caatuu-debug.apk}"
EXPECTED_SHA="${EXPECTED_SHA:-3a183b2b822557c0b3d30d8c431cb2208cef5f3a0a37cebc1e82f8d4255fb0a1}"
REPORT_FILE="${REPORT_FILE:-$HOME/caatuu-install-debug-report.txt}"
LOGCAT_FILE="${LOGCAT_FILE:-$HOME/caatuu-install-logcat.txt}"

note() {
  printf '%s\n' "$*"
  printf '%s\n' "$*" >> "$REPORT_FILE"
}

run_report() {
  note "$ $*"
  "$@" >> "$REPORT_FILE" 2>&1 || true
}

need_command() {
  command -v "$1" >/dev/null 2>&1
}

: > "$REPORT_FILE"
note "Caatuu Android debug install check"
note "Report file: $REPORT_FILE"
note ""

if need_command pkg; then
  if ! need_command curl || ! need_command sha256sum || ! need_command file; then
    note "Installing small Termux tools: curl coreutils file"
    pkg update -y >> "$REPORT_FILE" 2>&1 || true
    pkg install -y curl coreutils file >> "$REPORT_FILE" 2>&1 || true
  fi
fi

note ""
note "Device"
run_report getprop ro.build.version.release
run_report getprop ro.build.version.sdk
run_report getprop ro.product.cpu.abi
run_report getprop ro.product.cpu.abilist

note ""
note "Downloading APK"
rm -f "$APK_FILE"
curl -L --fail --retry 3 -o "$APK_FILE" "$APK_URL" 2>&1 | tee -a "$REPORT_FILE"

note ""
note "APK file"
run_report ls -lh "$APK_FILE"
run_report file "$APK_FILE"

ACTUAL_SHA="$(sha256sum "$APK_FILE" | awk '{print $1}')"
note "sha256: $ACTUAL_SHA"
note "expect: $EXPECTED_SHA"
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  note "ERROR: SHA-256 mismatch. Delete the APK and download again."
  exit 1
fi

note ""
note "Opening Package Installer"
if need_command logcat; then
  logcat -c >> "$REPORT_FILE" 2>&1 || true
fi

termux-open --content-type application/vnd.android.package-archive "$APK_FILE" >> "$REPORT_FILE" 2>&1 || true

note ""
note "After Package Installer shows the error, return to Termux and press Enter."
printf 'Press Enter after the install attempt... '
read _unused || true

if need_command logcat; then
  logcat -d \
    | grep -iE "caatuu|packageinstaller|packagemanager|parse|install_failed|apk|abi|sdk|native" \
    > "$LOGCAT_FILE" 2>/dev/null || true
  note ""
  note "Filtered logcat saved to: $LOGCAT_FILE"
  cat "$LOGCAT_FILE" | tail -120
fi

note ""
note "Done. Send these outputs/files back:"
note "$REPORT_FILE"
note "$LOGCAT_FILE"
