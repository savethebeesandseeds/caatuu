# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

FROM python:3.12-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b

ARG APP_GID=1000
ARG APP_UID=1000

ENV PATH="/opt/venv/bin:${PATH}" \
    PIP_CONSTRAINT=/workspace/constraints/linux-py312.txt \
    PIP_CACHE_DIR=/home/animatedfabric/.cache/pip \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    QT_QPA_PLATFORM=offscreen \
    VIRTUAL_ENV=/opt/venv

RUN apt-get update \
    && apt-get install --no-install-recommends --yes \
        libdbus-1-3 \
        libegl1 \
        libfontconfig1 \
        libfreetype6 \
        libglib2.0-0 \
        libgl1 \
        libxcb-cursor0 \
        libxcb-icccm4 \
        libxcb-image0 \
        libxcb-keysyms1 \
        libxcb-render-util0 \
        libxcb-render0 \
        libxcb-shape0 \
        libxcb-util1 \
        libxkbcommon-x11-0 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid "${APP_GID}" animatedfabric \
    && useradd --create-home --gid "${APP_GID}" --uid "${APP_UID}" animatedfabric \
    && python -m venv "${VIRTUAL_ENV}" \
    && mkdir -p "${PIP_CACHE_DIR}" /workspace \
    && chown -R animatedfabric:animatedfabric \
        "${VIRTUAL_ENV}" \
        "${PIP_CACHE_DIR}" \
        /workspace

WORKDIR /workspace

COPY --chown=animatedfabric:animatedfabric . /workspace

RUN --mount=type=cache,target=/root/.cache/pip \
    PIP_CACHE_DIR=/root/.cache/pip python -m pip install --editable ".[dev]" \
    && chown -R animatedfabric:animatedfabric "${VIRTUAL_ENV}"

USER animatedfabric

CMD ["bash"]
