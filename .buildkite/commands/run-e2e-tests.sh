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

# For mac-x64 on Apple Silicon: install Rosetta and run under x86_64 arch
arch_prefix=''
if [ "$PLATFORM" = "mac" ] && [ "$ARCH" = "x64" ]; then
  echo '~~~ Installing Rosetta for x64 emulation...'
  softwareupdate --install-rosetta --agree-to-license
  arch_prefix='arch -x86_64 '
fi

echo '~~~ Installing Playwright browsers...'
"${arch_prefix}npx playwright install"

echo '~~~ Running Playwright tests...'
"${arch_prefix}npx playwright test"
