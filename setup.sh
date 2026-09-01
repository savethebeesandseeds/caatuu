#!/usr/bin/env bash
set -Eeuo pipefail

readonly python_version="3.12.14"
readonly python_sha256="5c8462af5790baf43a321a1559dbe0db06d1be4300fb85fb53c40060668e548a"
readonly python_prefix="/opt/cpython312"
readonly ml_environment="/opt/caatuu-ml"
readonly mlc_environment="/opt/caatuu-mlc"
readonly animated_fabric_environment="/opt/animated-fabric"
readonly setup_state_root="/opt/caatuu-dev/state"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
force_setup=0

if [[ "${1:-}" == "--force" ]]; then
  force_setup=1
  shift
fi
if [[ $# -ne 0 ]]; then
  echo "Usage: bash setup.sh [--force]" >&2
  exit 2
fi

on_error() {
  local exit_code=$?
  echo "Caatuu environment setup failed near line ${BASH_LINENO[0]}." >&2
  exit "$exit_code"
}
trap on_error ERR

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run setup.sh as root inside the caatuu-dev container." >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "The container does not expose /etc/os-release." >&2
  exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "debian" ]]; then
  echo "Caatuu requires a fresh Debian container; found ${ID:-unknown}." >&2
  exit 1
fi

if [[ "$script_dir" != "/workspace" ]] || [[ ! -f "$script_dir/README.md" ]]; then
  echo "Mount the canonical Caatuu repository at /workspace before running setup.sh." >&2
  exit 1
fi

required_sources=(
  "$script_dir/setup.sh"
  "$script_dir/tools/dev-container/requirements-ml.txt"
  "$script_dir/apps/animated-fabric/constraints/linux-py312.txt"
  "$script_dir/tools/dev-container/check-dev-env.sh"
  "$script_dir/tools/dev-container/check-gpu-readiness.sh"
  "$script_dir/tools/dev-container/animated-fabric.sh"
  "$script_dir/tools/dev-container/animated-fabric-entrypoint.sh"
  "$script_dir/apps/android/tooling/setup-jdk.sh"
  "$script_dir/apps/android/tooling/setup-sdk.sh"
  "$script_dir/apps/android/tooling/versions.env"
)
for source_path in "${required_sources[@]}"; do
  if [[ ! -f "$source_path" ]]; then
    echo "Required setup input is missing: $source_path" >&2
    exit 1
  fi
done

# shellcheck source=apps/android/tooling/versions.env
source "$script_dir/apps/android/tooling/versions.env"

mkdir -p "$setup_state_root"
setup_fingerprint="$({
  for source_path in "${required_sources[@]}"; do
    sha256sum "$source_path"
  done
  printf '%s\n' "$python_version" "$python_sha256"
} | sha256sum | awk '{print $1}')"
fingerprint_file="$setup_state_root/setup.sha256"

setup_is_complete() {
  [[ -f "$fingerprint_file" ]] || return 1
  [[ "$(<"$fingerprint_file")" == "$setup_fingerprint" ]] || return 1
  [[ -x "$python_prefix/bin/python3.12" ]] || return 1
  [[ -x "$ml_environment/bin/python" ]] || return 1
  [[ -x "$mlc_environment/bin/python" ]] || return 1
  [[ -x "$animated_fabric_environment/bin/python" ]] || return 1
  command -v node >/dev/null 2>&1 || return 1
  command -v cargo >/dev/null 2>&1 || return 1
  [[ -x /opt/jdk-17/bin/java ]] || return 1
  [[ -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]] || return 1
  [[ -x "$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS_VERSION/aapt2" ]] || return 1
  [[ -x "$GRADLE_HOME/bin/gradle" ]] || return 1
  cmp --silent \
    "$setup_state_root/animated-fabric-linux-py312.txt" \
    "$script_dir/apps/animated-fabric/constraints/linux-py312.txt" || return 1
}

if [[ "$force_setup" -eq 0 ]] && setup_is_complete; then
  echo "Caatuu development environment is already provisioned."
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
export CARGO_HOME=/root/.cargo
export RUSTUP_HOME=/root/.rustup
export VIRTUAL_ENV="$ml_environment"

echo "==> Installing Debian packages"
apt-get update
apt_packages=(
  bash
  build-essential
  ca-certificates
  cmake
  curl
  file
  g++
  gcc
  git
  git-lfs
  gpg
  jq
  less
  libbz2-dev
  libdbus-1-3
  libegl1
  libexpat1-dev
  libffi-dev
  libfontconfig1
  libfreetype6
  libgdbm-dev
  libgl1
  libglib2.0-0
  liblzma-dev
  libncursesw5-dev
  libreadline-dev
  libsqlite3-dev
  libssl-dev
  libxcb-cursor0
  libxcb-icccm4
  libxcb-image0
  libxcb-keysyms1
  libxcb-render-util0
  libxcb-render0
  libxcb-shape0
  libxcb-util1
  libxkbcommon-x11-0
  make
  nano
  ninja-build
  openssh-client
  pkg-config
  procps
  python3
  python3-dev
  python3-pip
  python3-venv
  rsync
  tar
  tk-dev
  unzip
  util-linux
  uuid-dev
  vim-tiny
  wget
  xz-utils
  xvfb
  zip
  zlib1g-dev
)
apt-get install -y --no-install-recommends "${apt_packages[@]}"
git lfs install --system
apt-get clean
rm -rf /var/lib/apt/lists/*

install_python312() {
  if [[ -x "$python_prefix/bin/python3.12" ]] \
      && [[ "$($python_prefix/bin/python3.12 --version 2>&1)" == "Python $python_version" ]]; then
    echo "==> Python $python_version is already installed"
    return
  fi

  local archive="/tmp/Python-${python_version}.tar.xz"
  local build_root="/tmp/Python-${python_version}"
  echo "==> Installing Python $python_version"
  curl -fL --retry 3 \
    -o "$archive" \
    "https://www.python.org/ftp/python/${python_version}/Python-${python_version}.tar.xz"
  printf '%s  %s\n' "$python_sha256" "$archive" | sha256sum -c -
  rm -rf "$build_root"
  tar -xJf "$archive" -C /tmp
  (
    cd "$build_root"
    ./configure --prefix="$python_prefix" --with-ensurepip=install
    make -j"$(nproc)"
    make install
  )
  rm -rf "$build_root" "$archive"
  [[ "$($python_prefix/bin/python3.12 --version 2>&1)" == "Python $python_version" ]]
}

ensure_venv() {
  local destination=$1
  if [[ ! -x "$destination/bin/python" ]]; then
    "$python_prefix/bin/python3.12" -m venv "$destination"
  fi
  "$destination/bin/python" -m pip install --no-cache-dir --upgrade pip wheel setuptools
}

install_python312

echo "==> Installing the Caatuu Python and ML environment"
ensure_venv "$ml_environment"
"$ml_environment/bin/python" -m pip install --no-cache-dir \
  --index-url https://download.pytorch.org/whl/cu128 \
  'torch==2.11.0+cu128'
"$ml_environment/bin/python" -m pip install --no-cache-dir \
  -r "$script_dir/tools/dev-container/requirements-ml.txt"

echo "==> Installing the MLC/WebLLM environment"
ensure_venv "$mlc_environment"
if ! "$mlc_environment/bin/python" -m pip install --no-cache-dir --pre -U \
  -f https://mlc.ai/wheels mlc-llm-nightly-cu128 mlc-ai-nightly-cu128; then
  echo "CUDA MLC wheels were unavailable; installing the CPU wheels instead."
  "$mlc_environment/bin/python" -m pip install --no-cache-dir --pre -U \
    -f https://mlc.ai/wheels mlc-llm-nightly-cpu mlc-ai-nightly-cpu
fi
"$mlc_environment/bin/python" - <<'PY'
from pathlib import Path
import site

for site_dir_name in site.getsitepackages():
    site_dir = Path(site_dir_name)
    init = site_dir / "mlc_llm" / "__init__.py"
    if init.exists():
        try:
            import mlc_llm  # noqa: F401
        except Exception:
            init.write_text(
                '"""Minimal MLC LLM init for offline conversion tools."""\n'
                'from .libinfo import __version__\n',
                encoding="utf-8",
            )

    contrib = site_dir / "tvm" / "contrib"
    if contrib.exists():
        for name in ["ndk", "tar", "xcode"]:
            module = contrib / f"{name}.py"
            if not module.exists():
                module.write_text(
                    '"""Conversion-container compatibility stub."""\n'
                    'def __getattr__(name):\n'
                    '    raise RuntimeError("tvm.contrib.%s is not available in the Caatuu dev container" % __name__.rsplit(".", 1)[-1])\n',
                    encoding="utf-8",
                )
PY

echo "==> Installing Node.js 22"
node_major=""
if command -v node >/dev/null 2>&1; then
  node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
fi
if [[ "$node_major" != "22" ]]; then
  node_setup="/tmp/caatuu-nodesource-22.sh"
  curl -fsSL --retry 3 https://deb.nodesource.com/setup_22.x -o "$node_setup"
  bash "$node_setup"
  rm -f "$node_setup"
  apt-get install -y --no-install-recommends nodejs
  apt-get clean
  rm -rf /var/lib/apt/lists/*
fi
npm install --global npm@latest

echo "==> Installing Rust"
if [[ ! -x "$CARGO_HOME/bin/rustup" ]]; then
  rustup_installer="/tmp/caatuu-rustup.sh"
  curl --proto '=https' --tlsv1.2 -fsS https://sh.rustup.rs -o "$rustup_installer"
  sh "$rustup_installer" -y --profile minimal --default-toolchain stable
  rm -f "$rustup_installer"
else
  "$CARGO_HOME/bin/rustup" toolchain install stable --profile minimal
  "$CARGO_HOME/bin/rustup" default stable
fi
"$CARGO_HOME/bin/rustup" component add rustfmt clippy

echo "==> Installing JDK 17"
bash "$script_dir/apps/android/tooling/setup-jdk.sh"

echo "==> Installing the Android SDK and Gradle"
bash "$script_dir/apps/android/tooling/setup-sdk.sh"

echo "==> Installing the Animated Fabric environment"
ensure_venv "$animated_fabric_environment"
"$animated_fabric_environment/bin/python" -m pip install --no-cache-dir \
  -r "$script_dir/apps/animated-fabric/constraints/linux-py312.txt"

echo "==> Installing Caatuu helper commands"
install -m 0755 "$script_dir/tools/dev-container/check-dev-env.sh" \
  /usr/local/bin/check-caatuu-dev
install -m 0755 "$script_dir/tools/dev-container/check-gpu-readiness.sh" \
  /usr/local/bin/check-caatuu-gpu-readiness
install -m 0755 "$script_dir/tools/dev-container/animated-fabric.sh" \
  /usr/local/bin/caatuu-animated-fabric
install -m 0755 "$script_dir/tools/dev-container/animated-fabric-entrypoint.sh" \
  /usr/local/bin/caatuu-animated-fabric-entrypoint
install -m 0644 "$script_dir/apps/animated-fabric/constraints/linux-py312.txt" \
  "$setup_state_root/animated-fabric-linux-py312.txt"
ln -sfn /usr/local/bin/caatuu-animated-fabric-entrypoint /usr/local/bin/animated-fabric
ln -sfn /usr/local/bin/caatuu-animated-fabric-entrypoint /usr/local/bin/animated-fabric-gui
ln -sfn "$ml_environment/bin/python" /usr/local/bin/python
ln -sfn "$ml_environment/bin/pip" /usr/local/bin/pip
ln -sfn "$CARGO_HOME/bin/cargo" /usr/local/bin/cargo
ln -sfn "$CARGO_HOME/bin/rustc" /usr/local/bin/rustc
ln -sfn "$CARGO_HOME/bin/rustup" /usr/local/bin/rustup
ln -sfn /opt/jdk-17/bin/java /usr/local/bin/java
ln -sfn /opt/jdk-17/bin/javac /usr/local/bin/javac
printf '%s\n' '#!/usr/bin/env bash' \
  'exec /opt/caatuu-mlc/bin/python "$@"' \
  > /usr/local/bin/caatuu-mlc-python
chmod 0755 /usr/local/bin/caatuu-mlc-python

profile_file="/etc/profile.d/caatuu-dev.sh"
printf '%s\n' \
  'export VIRTUAL_ENV=/opt/caatuu-ml' \
  'export JAVA_HOME=/opt/jdk-17' \
  "export ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT" \
  "export ANDROID_HOME=$ANDROID_HOME" \
  "export GRADLE_HOME=$GRADLE_HOME" \
  'export CARGO_HOME=/root/.cargo' \
  'export RUSTUP_HOME=/root/.rustup' \
  "export PATH=\"/opt/caatuu-ml/bin:/opt/jdk-17/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$GRADLE_HOME/bin:/root/.cargo/bin:\$PATH\"" \
  'export HF_HOME="${HF_HOME:-/workspace/tools/czech-ml/data/models/english-base/hf-cache}"' \
  'export HF_HUB_ENABLE_HF_TRANSFER="${HF_HUB_ENABLE_HF_TRANSFER:-1}"' \
  'export HF_XET_HIGH_PERFORMANCE="${HF_XET_HIGH_PERFORMANCE:-1}"' \
  'export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"' \
  'export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"' \
  'export CAATUU_REQUIRE_NVIDIA="${CAATUU_REQUIRE_NVIDIA:-0}"' \
  > "$profile_file"
chmod 0644 "$profile_file"

fingerprint_tmp="$setup_state_root/setup.sha256.tmp"
printf '%s\n' "$setup_fingerprint" > "$fingerprint_tmp"
mv -f "$fingerprint_tmp" "$fingerprint_file"

echo
echo "Caatuu development environment is ready."
echo "No Caatuu application build or test was run."
