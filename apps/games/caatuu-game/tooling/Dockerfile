# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df AS godot-provisioner

LABEL org.opencontainers.image.title="Caatuu Game Godot provisioner" \
    org.opencontainers.image.description="Resumable official Godot Web toolchain provisioner" \
    io.caatuu.caatuu-game.godot.version="4.7.1"

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=UTC

RUN apt-get update \
    && apt-get install --no-install-recommends --yes \
        ca-certificates \
        curl \
        python3 \
        unzip \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/caatuu-game /opt/licenses /toolchain

COPY GODOT-LICENSE.txt /opt/licenses/GODOT-LICENSE.txt
COPY tooling/extract_remote_zip.py /opt/caatuu-game/extract_remote_zip.py
COPY tooling/provision-toolchain.sh /usr/local/bin/provision-caatuu-game-godot

RUN chmod 0555 \
        /opt/caatuu-game/extract_remote_zip.py \
        /usr/local/bin/provision-caatuu-game-godot \
    && chmod -R a-w /opt/caatuu-game /opt/licenses

ENTRYPOINT ["/usr/local/bin/provision-caatuu-game-godot"]

FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df AS godot-exporter

ARG APP_GID=1000
ARG APP_UID=1000

LABEL org.opencontainers.image.title="Caatuu Game Godot exporter" \
    org.opencontainers.image.description="Bounded offline Linux Web exporter for the standalone Caatuu Game preview" \
    io.caatuu.caatuu-game.godot.version="4.7.1" \
    io.caatuu.caatuu-game.godot.editor-archive-sha256="c7ff14fd28472c8d4f193043de30278dcf7e5241a1dcf7566b02e27addaa33ba" \
    io.caatuu.caatuu-game.godot.web-template-sha256="b7b7d7da29fc6cc2f4934fdd26cc571a40e7af57f716ea3eb7e18da720dae28a"

ENV HOME=/tmp/godot/home \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PATH="/toolchain/bin:${PATH}" \
    TZ=UTC \
    XDG_CACHE_HOME=/tmp/godot/cache \
    XDG_CONFIG_HOME=/tmp/godot/config \
    XDG_DATA_HOME=/tmp/godot/data

RUN test "${APP_UID}" -gt 0 \
    && test "${APP_GID}" -gt 0 \
    && apt-get update \
    && apt-get install --no-install-recommends --yes \
        ca-certificates \
        libasound2 \
        libdbus-1-3 \
        libfontconfig1 \
        libgl1 \
        libglib2.0-0 \
        libudev1 \
        libx11-6 \
        libxcursor1 \
        libxext6 \
        libxi6 \
        libxinerama1 \
        libxrandr2 \
        unzip \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid "${APP_GID}" godot \
    && useradd --gid "${APP_GID}" \
        --home-dir /nonexistent \
        --no-create-home \
        --shell /usr/sbin/nologin \
        --uid "${APP_UID}" \
        godot \
    && mkdir -p /opt/licenses /output /project /reference /scenery-source /toolchain /work \
    && chown godot:godot /output /work

COPY GODOT-LICENSE.txt /opt/licenses/GODOT-LICENSE.txt
COPY tooling/export-web.sh /usr/local/bin/export-caatuu-game-web

RUN chmod 0555 /usr/local/bin/export-caatuu-game-web \
    && chmod -R a-w /opt/licenses

WORKDIR /work
USER godot

ENTRYPOINT ["/usr/local/bin/export-caatuu-game-web"]
