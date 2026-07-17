FROM debian:latest

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV VIRTUAL_ENV=/opt/caatuu-ml
ENV PATH="/opt/caatuu-ml/bin:/root/.cargo/bin:${PATH}"
ENV HF_HUB_ENABLE_HF_TRANSFER=1
ENV HF_XET_HIGH_PERFORMANCE=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      build-essential \
      ca-certificates \
      cmake \
      curl \
      file \
      g++ \
      gcc \
      git \
      git-lfs \
      gpg \
      jq \
      less \
      libssl-dev \
      make \
      nano \
      ninja-build \
      default-jdk-headless \
      openssh-client \
      pkg-config \
      procps \
      python3 \
      python3-dev \
      python3-pip \
      python3-venv \
      rsync \
      tini \
      unzip \
      vim-tiny \
      wget \
      zip \
    && git lfs install --system \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-ml.txt /tmp/caatuu-requirements-ml.txt

RUN python3 -m venv "$VIRTUAL_ENV" \
    && python -m pip install --no-cache-dir --upgrade pip wheel setuptools \
    && python -m pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cu128 \
      torch==2.11.0+cu128

RUN python -m pip install --no-cache-dir -r /tmp/caatuu-requirements-ml.txt

RUN python3 -m venv /opt/caatuu-mlc \
    && /opt/caatuu-mlc/bin/python -m pip install --no-cache-dir --upgrade pip wheel setuptools \
    && (/opt/caatuu-mlc/bin/python -m pip install --no-cache-dir --pre -U -f https://mlc.ai/wheels \
      mlc-llm-nightly-cu128 mlc-ai-nightly-cu128) \
      || (/opt/caatuu-mlc/bin/python -m pip install --no-cache-dir --pre -U -f https://mlc.ai/wheels \
      mlc-llm-nightly-cpu mlc-ai-nightly-cpu)

RUN /opt/caatuu-mlc/bin/python - <<'PY'
from pathlib import Path
import site

site_dirs = [Path(p) for p in site.getsitepackages()]
for site_dir in site_dirs:
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

RUN printf '%s\n' '#!/usr/bin/env bash' 'exec /opt/caatuu-mlc/bin/python "$@"' > /usr/local/bin/caatuu-mlc-python \
    && chmod +x /usr/local/bin/caatuu-mlc-python

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g npm@latest \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain stable \
    && rustup component add rustfmt clippy

COPY entrypoint.sh /usr/local/bin/caatuu-dev-entrypoint
COPY check-dev-env.sh /usr/local/bin/check-caatuu-dev
RUN chmod +x /usr/local/bin/caatuu-dev-entrypoint /usr/local/bin/check-caatuu-dev

WORKDIR /workspace

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/caatuu-dev-entrypoint"]
CMD ["bash"]
