#!/usr/bin/env bash
set -euo pipefail

PLATFORM=${1:?Expected platform to be provided as first parameter}
ARCH=${2:?Expected architecture to be provided as second parameter}

echo "--- :package: Install deps"
export FILE_ARCHITECTURE="$ARCH"
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

if [ "$PLATFORM" = "mac" ] && [ "$ARCH" = "arm64" ] && [ "${BUILDKITE_BRANCH:-}" = "trunk" ]; then
  echo "--- :package: Caching trunk mac-arm64 package artifact for compare-perf reuse"
  TRUNK_ARTIFACT_CACHE_PATH="artifacts/trunk-mac-arm64"
  TRUNK_ARTIFACT_CACHE_KEY="$BUILDKITE_PIPELINE_SLUG-trunk-mac-arm64-package"

  mkdir -p "$TRUNK_ARTIFACT_CACHE_PATH"
  cp "$ARTIFACT_FILE" "$TRUNK_ARTIFACT_CACHE_PATH/studio-app-trunk-mac-arm64.tar.gz"
  save_cache "$TRUNK_ARTIFACT_CACHE_PATH" "$TRUNK_ARTIFACT_CACHE_KEY"
fi
