# syntax=docker/dockerfile:1

FROM python:3.12-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b AS torch-wheel-fetcher

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install --no-install-recommends --yes \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY --chmod=0755 containers/reconstruction/download_pinned_torch.sh \
    /usr/local/bin/download-pinned-torch

RUN --mount=type=cache,id=animated-fabric-torch-2.2.2-cu118-cp312,target=/var/cache/animated-fabric/torch,sharing=locked \
    /usr/local/bin/download-pinned-torch /var/cache/animated-fabric/torch \
    && cp \
        /var/cache/animated-fabric/torch/torch-2.2.2+cu118-cp312-cp312-linux_x86_64.whl \
        /torch-2.2.2+cu118-cp312-cp312-linux_x86_64.whl

FROM python:3.12-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b AS model-provisioner

ARG APP_GID=1000
ARG APP_UID=1000

ENV ANIMATED_FABRIC_MODEL_CACHE=/models/huggingface/hub \
    HF_HOME=/models/huggingface \
    HF_HUB_CACHE=/models/huggingface/hub \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HOME=/home/reconstruction \
    PIP_DEFAULT_TIMEOUT=300 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_RESUME_RETRIES=240 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt/animated-fabric \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid "${APP_GID}" reconstruction \
    && useradd --create-home --gid "${APP_GID}" --uid "${APP_UID}" reconstruction \
    && mkdir -p /models/huggingface/hub /opt/animated-fabric/tools /staging \
    && chown -R reconstruction:reconstruction /models /opt/animated-fabric /staging

COPY requirements-reconstruction-bootstrap-lock.txt \
    /tmp/requirements-reconstruction-bootstrap-lock.txt
COPY requirements-reconstruction-provision-lock.txt \
    /tmp/requirements-reconstruction-provision-lock.txt
RUN --mount=type=cache,id=animated-fabric-reconstruction-provision-pip-py312,target=/var/cache/animated-fabric/pip,sharing=locked \
    PIP_CACHE_DIR=/var/cache/animated-fabric/pip \
        python -m pip install \
            --only-binary=:all: \
            --require-hashes \
            --requirement /tmp/requirements-reconstruction-bootstrap-lock.txt \
    && PIP_CACHE_DIR=/var/cache/animated-fabric/pip \
        python -m pip install \
            --only-binary=:all: \
            --require-hashes \
            --requirement /tmp/requirements-reconstruction-provision-lock.txt \
    && python -m pip check

COPY --chown=reconstruction:reconstruction \
    tools/reconstruction/__init__.py \
    tools/reconstruction/errors.py \
    tools/reconstruction/integrity.py \
    tools/reconstruction/model-manifest.json \
    tools/reconstruction/prefetch.py \
    tools/reconstruction/provision.py \
    /opt/animated-fabric/tools/reconstruction/
COPY --chmod=0755 \
    containers/reconstruction/download_pinned_checkpoint.sh \
    /usr/local/bin/download-pinned-triposr-checkpoint
COPY --chmod=0755 \
    containers/reconstruction/provision_models.sh \
    /usr/local/bin/provision-animated-fabric-models

WORKDIR /work
USER reconstruction

ENTRYPOINT ["provision-animated-fabric-models"]

FROM python:3.12-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b AS triposr-runtime

ARG APP_GID=1000
ARG APP_UID=1000

ENV ANIMATED_FABRIC_DINO_REVISION=f205d5d8e640a89a2b8ef0369670dfc37cc07fc2 \
    ANIMATED_FABRIC_MODEL_CACHE=/models/huggingface/hub \
    HF_HOME=/models/huggingface \
    HF_HUB_CACHE=/models/huggingface/hub \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HOME=/home/reconstruction \
    PIP_DEFAULT_TIMEOUT=300 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_RESUME_RETRIES=240 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt/animated-fabric:/opt/triposr \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install --no-install-recommends --yes \
        ca-certificates \
        git \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid "${APP_GID}" reconstruction \
    && useradd --create-home --gid "${APP_GID}" --uid "${APP_UID}" reconstruction \
    && mkdir -p /input /models/huggingface/hub /opt/animated-fabric/tools /output \
    && chown -R reconstruction:reconstruction /models /opt/animated-fabric /output

COPY requirements-reconstruction-bootstrap-lock.txt \
    /tmp/requirements-reconstruction-bootstrap-lock.txt
RUN --mount=type=cache,id=animated-fabric-reconstruction-pip-py312,target=/var/cache/animated-fabric/pip,sharing=locked \
    PIP_CACHE_DIR=/var/cache/animated-fabric/pip \
        python -m pip install \
            --only-binary=:all: \
            --require-hashes \
            --requirement /tmp/requirements-reconstruction-bootstrap-lock.txt

COPY requirements-reconstruction-torch.txt /tmp/requirements-reconstruction-torch.txt
RUN --mount=type=bind,from=torch-wheel-fetcher,source=/torch-2.2.2+cu118-cp312-cp312-linux_x86_64.whl,target=/tmp/torch-2.2.2+cu118-cp312-cp312-linux_x86_64.whl \
    python -m pip install \
        --find-links=/tmp \
        --no-deps \
        --no-index \
        --require-hashes \
        --requirement /tmp/requirements-reconstruction-torch.txt

COPY requirements-reconstruction-lock.txt /tmp/requirements-reconstruction-lock.txt

RUN --mount=type=cache,id=animated-fabric-reconstruction-lock-pip-py312-v1,target=/var/cache/animated-fabric/pip,sharing=locked \
    PIP_CACHE_DIR=/var/cache/animated-fabric/pip \
        python -m pip install \
            --no-build-isolation \
            --require-hashes \
            --requirement /tmp/requirements-reconstruction-lock.txt \
    && python -m pip check

RUN git clone https://github.com/VAST-AI-Research/TripoSR.git /opt/triposr \
    && git -C /opt/triposr checkout --detach "d26e33181947bbbc4c6fc0f5734e1ec6c080956e" \
    && test "$(git -C /opt/triposr rev-parse HEAD)" = \
        "d26e33181947bbbc4c6fc0f5734e1ec6c080956e"

COPY containers/reconstruction/patches /tmp/triposr-patches
RUN git -C /opt/triposr apply --check /tmp/triposr-patches/*.patch \
    && git -C /opt/triposr apply /tmp/triposr-patches/*.patch \
    && python -c "from tsr.system import TSR; assert TSR.__name__ == 'TSR'" \
    && rm -rf /opt/triposr/.git /tmp/triposr-patches

COPY --chown=reconstruction:reconstruction tools/reconstruction \
    /opt/animated-fabric/tools/reconstruction

WORKDIR /work
USER reconstruction

ENTRYPOINT ["python", "-m", "tools.reconstruction"]
CMD ["doctor"]
