FROM rust:1.96-bookworm AS builder

WORKDIR /workspace/apps/server
COPY apps/server/Cargo.toml apps/server/Cargo.lock ./
COPY apps/server/src ./src
COPY tools/czech-ml/vector-schema.sql /workspace/tools/czech-ml/vector-schema.sql
RUN --mount=type=cache,id=caatuu-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=caatuu-cargo-target,target=/workspace/apps/server/target \
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
      jq \
      nodejs \
      procps \
      tini \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /caatuu-runtime /usr/local/bin/caatuu-runtime

WORKDIR /workspace/apps/server
EXPOSE 9172

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/caatuu-runtime"]
