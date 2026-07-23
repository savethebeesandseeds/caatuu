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

FROM python:3.12-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b AS triposr-runtime

ARG APP_GID=1000
ARG APP_UID=1000
ARG TRIPOSR_REVISION=d26e33181947bbbc4c6fc0f5734e1ec6c080956e

ENV ANIMATED_FABRIC_DINO_REVISION=f205d5d8e640a89a2b8ef0369670dfc37cc07fc2 \
    ANIMATED_FABRIC_MODEL_CACHE=/models/huggingface/hub \
    HF_HOME=/models/huggingface \
    HF_HUB_CACHE=/models/huggingface/hub \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HOME=/home/reconstruction \
    PIP_DEFAULT_TIMEOUT=300 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
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

COPY requirements-reconstruction.txt /tmp/requirements-reconstruction.txt
COPY requirements-reconstruction-torch.txt /tmp/requirements-reconstruction-torch.txt

RUN --mount=type=bind,from=torch-wheel-fetcher,source=/torch-2.2.2+cu118-cp312-cp312-linux_x86_64.whl,target=/tmp/torch-2.2.2+cu118-cp312-cp312-linux_x86_64.whl \
    python -m pip install \
        --index-url https://download.pytorch.org/whl/cu118 \
        /tmp/torch-2.2.2+cu118-cp312-cp312-linux_x86_64.whl

RUN python -m pip install --requirement /tmp/requirements-reconstruction.txt \
    && git clone https://github.com/VAST-AI-Research/TripoSR.git /opt/triposr \
    && git -C /opt/triposr checkout --detach "${TRIPOSR_REVISION}" \
    && test "$(git -C /opt/triposr rev-parse HEAD)" = "${TRIPOSR_REVISION}" \
    && rm -rf /root/.cache

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
