# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

FROM python:3.12-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b AS blender-archive

ARG TARGETARCH

RUN test "${TARGETARCH}" = "amd64" \
    && apt-get update \
    && apt-get install --no-install-recommends --yes xz-utils \
    && rm -rf /var/lib/apt/lists/*

ADD --checksum=sha256:95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25 \
    https://download.blender.org/release/Blender4.5/blender-4.5.12-linux-x64.tar.xz \
    /tmp/blender.tar.xz

RUN mkdir -p /opt/blender \
    && tar --extract --xz \
        --file /tmp/blender.tar.xz \
        --directory /opt/blender \
        --strip-components=1 \
    && rm /tmp/blender.tar.xz \
    && test -x /opt/blender/blender \
    && find /opt/blender -type f -perm /6000 -exec chmod a-s {} +

FROM python:3.12-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b AS blender-runtime-base

ARG APP_GID=1000
ARG APP_UID=1000

LABEL org.opencontainers.image.title="Animated Fabric bounded Blender runtime" \
    org.opencontainers.image.description="Shared isolated runtime for fixed repository Blender workers" \
    io.caatuu.animated-fabric.blender.version="4.5.12" \
    io.caatuu.animated-fabric.blender.sha256="95e3a2dfedba3bd32ca54fc355eac6b15a11986954ccb02815a07535d0120a25"

ENV BLENDER_USER_CONFIG=/tmp/blender/config \
    BLENDER_USER_DATAFILES=/opt/blender-user-disabled/datafiles \
    BLENDER_USER_EXTENSIONS=/tmp/blender/extensions \
    BLENDER_USER_SCRIPTS=/opt/blender-user-disabled/scripts \
    HOME=/tmp/blender/home \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PATH="/opt/blender:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONHASHSEED=0 \
    PYTHONNOUSERSITE=1 \
    PYTHONPATH=/opt/animated-fabric \
    TZ=UTC

RUN test "${APP_UID}" -gt 0 \
    && test "${APP_GID}" -gt 0 \
    && apt-get update \
    && apt-get install --no-install-recommends --yes \
        libdbus-1-3 \
        libdecor-0-0 \
        libegl1 \
        libfontconfig1 \
        libfreetype6 \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        libice6 \
        libsm6 \
        libwayland-client0 \
        libwayland-cursor0 \
        libwayland-egl1 \
        libx11-6 \
        libxcursor1 \
        libxext6 \
        libxfixes3 \
        libxi6 \
        libxinerama1 \
        libxkbcommon0 \
        libxkbcommon-x11-0 \
        libxrandr2 \
        libxrender1 \
        libxxf86vm1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid "${APP_GID}" blender \
    && useradd --gid "${APP_GID}" \
        --home-dir /nonexistent \
        --no-create-home \
        --shell /usr/sbin/nologin \
        --uid "${APP_UID}" \
        blender \
    && mkdir -p \
        /opt/animated-fabric \
        /opt/blender-user-disabled/datafiles \
        /opt/blender-user-disabled/extensions \
        /opt/blender-user-disabled/scripts \
        /output \
        /work \
    && chown blender:blender /output /work

COPY --from=blender-archive /opt/blender /opt/blender
COPY tools/blender/ /opt/animated-fabric/
COPY containers/blender/Dockerfile /opt/animated-fabric/container.Dockerfile
COPY compose.yaml /opt/animated-fabric/compose.yaml

RUN chmod -R a-w /opt/animated-fabric /opt/blender-user-disabled \
    && test -r /opt/animated-fabric/render_walk.py \
    && test -r /opt/animated-fabric/render_actor_package.py \
    && test -r /opt/animated-fabric/actor_package.py

WORKDIR /work
USER blender

FROM blender-runtime-base AS directional-worker

LABEL org.opencontainers.image.title="Animated Fabric directional Blender worker" \
    org.opencontainers.image.description="Isolated AF-052 fixed-actor direct-yaw prerender worker"

ENTRYPOINT ["/opt/blender/blender", \
    "--background", \
    "--factory-startup", \
    "--disable-autoexec", \
    "--offline-mode", \
    "-noaudio", \
    "--python-exit-code", \
    "10", \
    "--python", \
    "/opt/animated-fabric/render_walk.py", \
    "--"]
CMD ["--out", "/output/af053-demo"]

FROM blender-runtime-base AS actor-validator

LABEL org.opencontainers.image.title="Animated Fabric actor-package validator" \
    org.opencontainers.image.description="Isolated AF-055 pinned data-only actor neutral renderer"

ENTRYPOINT ["/opt/blender/blender", \
    "--background", \
    "--factory-startup", \
    "--disable-autoexec", \
    "--offline-mode", \
    "-noaudio", \
    "--python-exit-code", \
    "10", \
    "--python", \
    "/opt/animated-fabric/render_actor_package.py", \
    "--"]
CMD ["--out", "/output/af055-neutral"]

FROM blender-runtime-base AS macaw-actor-validator

LABEL org.opencontainers.image.title="Animated Fabric macaw actor validator" \
    org.opencontainers.image.description="Isolated AF-056 pinned macaw rig and deformation-review renderer"

USER root

COPY assets/actor-reviews/macaw-traveler-avian-v1/rig-mapping.json \
    /opt/animated-fabric/macaw-rig-mapping.json

RUN chmod a-w /opt/animated-fabric/macaw-rig-mapping.json \
    && test -r /opt/animated-fabric/render_macaw_actor_review.py \
    && test -r /opt/animated-fabric/macaw-rig-mapping.json \
    && test -r /opt/animated-fabric/contracts/avian_v1.json \
    && test -r /opt/animated-fabric/contracts/af056_review_poses.json

USER blender

ENTRYPOINT ["/opt/blender/blender", \
    "--background", \
    "--factory-startup", \
    "--disable-autoexec", \
    "--offline-mode", \
    "-noaudio", \
    "--python-exit-code", \
    "10", \
    "--python", \
    "/opt/animated-fabric/render_macaw_actor_review.py", \
    "--"]
CMD ["--out", "/output/af056-review"]

# Preserve the historical default target and entrypoint for direct builds.
FROM directional-worker AS blender-runtime
