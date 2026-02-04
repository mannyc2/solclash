# syntax=docker/dockerfile:1.7
FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_VERSION=20
ARG BUN_VERSION=1.1.17
ARG SOLANA_VERSION=stable

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    unzip \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    clang \
    cmake \
    python3 \
    --no-install-recommends

# Node.js
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
  && apt-get update \
  && apt-get install -y nodejs

# Bun
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
ENV PATH="/root/.bun/bin:${PATH}"
ENV BUN_INSTALL_CACHE_DIR="/root/.bun/install/cache"

# Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
  sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"

# Solana toolchain
RUN sh -c "$(curl -sSfL https://release.anza.xyz/${SOLANA_VERSION}/install)" \
  && ln -sf /root/.local/share/solana/install/active_release/bin/cargo-build-sbf /root/.cargo/bin/cargo-build-sbf \
  && ln -sf /root/.local/share/solana/install/active_release/bin/cargo-test-sbf /root/.cargo/bin/cargo-test-sbf \
  && /root/.local/share/solana/install/active_release/bin/solana --version \
  && /root/.cargo/bin/cargo-build-sbf --version
ENV PATH="/root/.local/share/solana/install/active_release/bin:${PATH}"

WORKDIR /opt/solclash
