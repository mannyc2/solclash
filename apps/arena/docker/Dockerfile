FROM solclash-base AS deps

WORKDIR /opt/solclash

COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY apps/arena/package.json apps/arena/package.json
COPY apps/arena-harness/Cargo.toml apps/arena-harness/Cargo.toml
COPY apps/tournament/package.json apps/tournament/package.json
COPY packages/agents/package.json packages/agents/package.json
COPY packages/arenas/package.json packages/arenas/package.json
COPY packages/data/package.json packages/data/package.json
COPY packages/simulator/package.json packages/simulator/package.json

RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile

FROM solclash-base AS arena

WORKDIR /opt/solclash

COPY --from=deps /opt/solclash/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY docs ./docs
COPY arena-config.json ./

RUN --mount=type=cache,target=/root/.cargo/registry \
  --mount=type=cache,target=/root/.cargo/git \
  --mount=type=cache,target=/opt/solclash/apps/arena-harness/target \
  cargo build --manifest-path apps/arena-harness/Cargo.toml --release \
  && cp apps/arena-harness/target/release/solclash-harness /usr/local/bin/solclash-harness
