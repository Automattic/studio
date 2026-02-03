#!/usr/bin/env bash
set -euo pipefail

PLATFORM=${1:-}
ARCH=${2:-}

# TODO: Re-enable once implementation has been verified. See AINFRA-1888
# if .buildkite/commands/should-skip-job.sh --job-type validation; then
#   exit 0
# fi

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

export IS_DEV_BUILD=true

# Map platform names to electron-forge platform values
case "$PLATFORM" in
  mac)
    FORGE_PLATFORM="darwin"
    ;;
  windows)
    FORGE_PLATFORM="win32"
    ;;
  *)
    echo "Unknown platform: $PLATFORM"
    exit 1
    ;;
esac

# Use `electron-forge package` instead of `npm run make:*` for E2E tests.
# `make` creates signed distributables (installers), which requires code signing setup.
# `package` creates an unsigned app bundle, sufficient for E2E testing.
echo "--- :package: Package app for testing ($PLATFORM-$ARCH)"
npx electron-vite build --outDir=dist && npx electron-forge package --arch="$ARCH" --platform="$FORGE_PLATFORM"

echo '--- :playwright: Run End To End Tests'
echo 'Installing Playwright browsers...'
npx playwright install
echo 'Running Playwright tests...'
npx playwright test
