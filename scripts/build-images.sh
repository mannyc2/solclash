#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

PLATFORM="${SOLCLASH_PLATFORM:-linux/amd64}"

docker build --platform "$PLATFORM" -t solclash-base -f docker/base/Dockerfile .
docker build --platform "$PLATFORM" -t solclash-agent -f apps/tournament/docker/agent/Dockerfile .
docker build --platform "$PLATFORM" -t solclash-arena -f apps/tournament/docker/arena/Dockerfile .
