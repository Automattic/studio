#!/usr/bin/env bash
set -euo pipefail

BUILD_TYPE=${1:?Expected build type as first parameter (dev|release)}
ARCH=${2:?Expected architecture as second parameter (x64|arm64)}

if [ "$BUILD_TYPE" != "dev" ] && [ "$BUILD_TYPE" != "release" ]; then
  echo "Unknown build type: $BUILD_TYPE"
  exit 1
fi

if [ "$ARCH" != "x64" ] && [ "$ARCH" != "arm64" ]; then
  echo "Unknown architecture: $ARCH"
  exit 1
fi

.buildkite/commands/prepare-environment.sh
.buildkite/commands/install-node-dependencies.sh

if [ "$BUILD_TYPE" = "dev" ]; then
  node ./scripts/prepare-dev-build-version.mjs
  export IS_DEV_BUILD=true

  ARTIFACT_PATTERN="*studio-app-mac-$ARCH.tar.gz"
  printf 'Artifact search query: <%s>\n' "$ARTIFACT_PATTERN"
  if ! buildkite-agent artifact download "$ARTIFACT_PATTERN" .; then
    echo "^^^ +++ Required prebuilt app artifact not found: $ARTIFACT_PATTERN"
    exit 1
  fi

  ARTIFACT_FILE=$(find . -type f -name "studio-app-mac-$ARCH.tar.gz" | head -n 1)
  if [ -z "$ARTIFACT_FILE" ]; then
    echo "^^^ +++ Downloaded artifact but couldn't locate archive for mac-$ARCH"
    exit 1
  fi

  printf 'Resolved downloaded artifact: <%s>\n' "$ARTIFACT_FILE"
  echo "--- :package: Extracting prebuilt app artifacts (mac-$ARCH) from $ARTIFACT_FILE"
  tar -xzf "$ARTIFACT_FILE"
else
  node ./scripts/confirm-tag-matches-version.mjs

  echo "--- :package: Packaging app"
  npm run "package:macos-$ARCH"
fi

echo "--- :node: Building installer artifacts"
npm run "make:macos-$ARCH"

# Local trial and error show this needs to run before DMG generation,
# but after the binary has been built.
echo "--- :hammer: Rebuild fs-attr if necessary before generating DMG"
case "$ARCH" in
  x64)
    echo "Rebuilding fs-xattr for $ARCH architecture"
    npm rebuild fs-xattr --cpu universal
    ;;
  arm64)
    echo "No need to rebuild fs-xattr because it works out of the box on Apple Silicon"
    ;;
esac

echo "--- :node: Packaging in DMG"
npm run "make:dmg-$ARCH"

echo "--- 📃 Notarizing Binary"
bundle exec fastlane notarize_binary
