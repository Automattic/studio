#!/usr/bin/env bash
set -euo pipefail

PLATFORM=${1:?Expected platform to be provided as first parameter}
ARCH=${2:?Expected architecture to be provided as second parameter}

echo "--- :package: Install deps"
bash .buildkite/commands/install-node-dependencies.sh

export IS_DEV_BUILD=true

case "$PLATFORM" in
  mac)
    SCRIPT_PLATFORM="macos"
    ;;
  windows)
    SCRIPT_PLATFORM="windows"
    ;;
  *)
    echo "Unknown platform: $PLATFORM"
    exit 1
    ;;
esac

echo "--- :package: Package app for CI reuse ($PLATFORM-$ARCH)"
npm run "package:${SCRIPT_PLATFORM}-${ARCH}"

mkdir -p artifacts
ARTIFACT_FILE="artifacts/studio-app-${PLATFORM}-${ARCH}.tar.gz"

echo "--- :package: Bundle packaged app into $ARTIFACT_FILE"
tar -czf "$ARTIFACT_FILE" apps/studio/out
