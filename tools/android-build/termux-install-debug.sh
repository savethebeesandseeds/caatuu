#!/usr/bin/env sh
set -eu

APK_URL="${APK_URL:-https://caatuu.waajacu.com/android/caatuu-debug.apk}"
MANIFEST_URL="${MANIFEST_URL:-https://caatuu.waajacu.com/android/caatuu-debug.json}"
APK_FILE="${APK_FILE:-$HOME/caatuu-debug.apk}"
SHARED_APK="${SHARED_APK:-$HOME/storage/downloads/caatuu-debug.apk}"
EXPECTED_SHA="${EXPECTED_SHA:-9a281c3f622db8485622b9cf3dbaa47e74a9eb8840c6cd800b6c010af71eac91}"
REPORT_FILE="${REPORT_FILE:-$HOME/caatuu-install-debug-report.txt}"
LOGCAT_FILE="${LOGCAT_FILE:-$HOME/caatuu-install-logcat.txt}"
PM_FILE="${PM_FILE:-$HOME/caatuu-install-pm.txt}"

note() {
  printf '%s\n' "$*"
  printf '%s\n' "$*" >> "$REPORT_FILE"
}

run_report() {
  note "$ $*"
  "$@" >> "$REPORT_FILE" 2>&1 || true
}

run_show() {
  note "$ $*"
  "$@" 2>&1 | tee -a "$REPORT_FILE" || true
}

need_command() {
  command -v "$1" >/dev/null 2>&1
}

: > "$REPORT_FILE"
note "Caatuu Android debug install check"
note "Report file: $REPORT_FILE"
note ""

if need_command curl; then
  note "Published APK manifest"
  curl -L --fail --retry 3 "$MANIFEST_URL" 2>/dev/null | tee -a "$REPORT_FILE" || true
  note ""
fi

if need_command pkg; then
  if ! need_command curl || ! need_command sha256sum || ! need_command file; then
    note "Installing small Termux tools: curl coreutils file"
    pkg update -y >> "$REPORT_FILE" 2>&1 || true
    pkg install -y curl coreutils file >> "$REPORT_FILE" 2>&1 || true
  fi
fi

note ""
note "Device"
run_show getprop ro.build.version.release
run_show getprop ro.build.version.sdk
run_show getprop ro.product.cpu.abi
run_show getprop ro.product.cpu.abilist

note ""
note "Downloading APK"
rm -f "$APK_FILE"
curl -L --fail --retry 3 -o "$APK_FILE" "$APK_URL" 2>&1 | tee -a "$REPORT_FILE"

note ""
note "APK file"
run_show ls -lh "$APK_FILE"
run_show file "$APK_FILE"

ACTUAL_SHA="$(sha256sum "$APK_FILE" | awk '{print $1}')"
note "sha256: $ACTUAL_SHA"
note "expect: $EXPECTED_SHA"
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  note "ERROR: SHA-256 mismatch. Delete the APK and download again."
  exit 1
fi

note ""
note "Preparing shared APK path"
INSTALL_APK="$APK_FILE"
if [ ! -d "$HOME/storage/downloads" ] && need_command termux-setup-storage; then
  note "Requesting Termux storage permission. Approve the Android prompt if it appears."
  termux-setup-storage >> "$REPORT_FILE" 2>&1 || true
  sleep 3
fi

if [ -d "$HOME/storage/downloads" ]; then
  cp "$APK_FILE" "$SHARED_APK"
  chmod 644 "$SHARED_APK" 2>/dev/null || true
  INSTALL_APK="$SHARED_APK"
elif [ -d /sdcard/Download ]; then
  SHARED_APK="/sdcard/Download/caatuu-debug.apk"
  cp "$APK_FILE" "$SHARED_APK" 2>> "$REPORT_FILE" && INSTALL_APK="$SHARED_APK" || true
fi

run_show ls -lh "$INSTALL_APK"
run_show file "$INSTALL_APK"

note ""
note "Package manager diagnostic"
if need_command pm; then
  note "$ pm install -r $INSTALL_APK"
  pm install -r "$INSTALL_APK" > "$PM_FILE" 2>&1 || true
  cat "$PM_FILE" | tee -a "$REPORT_FILE"
else
  note "pm command not available"
fi

note ""
note "Opening Package Installer"
if need_command logcat; then
  logcat -c >> "$REPORT_FILE" 2>&1 || true
fi

termux-open --content-type application/vnd.android.package-archive "$INSTALL_APK" >> "$REPORT_FILE" 2>&1 || true

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
note "$PM_FILE"
