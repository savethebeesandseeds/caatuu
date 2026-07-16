FROM rust:1.96-bookworm AS builder

WORKDIR /workspace/apps/caatuu-runtime
COPY apps/caatuu-runtime/Cargo.toml apps/caatuu-runtime/Cargo.lock ./
COPY apps/caatuu-runtime/src ./src
COPY tools/caatuu-cz-ml/vector-schema.sql /workspace/tools/caatuu-cz-ml/vector-schema.sql
RUN --mount=type=cache,id=caatuu-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=caatuu-cargo-target,target=/workspace/apps/caatuu-runtime/target \
    cargo build --release --locked \
    && cp target/release/caatuu-runtime /caatuu-runtime

FROM debian:bookworm-slim

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      gpg \
      procps \
      socat \
      tini \
    && mkdir -p /usr/share/keyrings \
    && curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg \
    && echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends cloudflared \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /caatuu-runtime /usr/local/bin/caatuu-runtime

WORKDIR /workspace/apps/caatuu-runtime
EXPOSE 9172

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/caatuu-runtime"]
