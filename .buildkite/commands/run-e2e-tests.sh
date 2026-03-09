#!/usr/bin/env bash
set -euo pipefail

PLATFORM=${1:?Expected platform to be provided as first parameter}
ARCH=${2:?Expected architecture to be provided as second parameter}

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

export IS_DEV_BUILD=true

ARTIFACT_PATTERN="*studio-app-${PLATFORM}-${ARCH}.tar.gz"

# Use `electron-forge package` instead of `npm run make:*` for E2E tests.
# `make` creates signed distributables (installers), which requires code signing setup.
# `package` creates an unsigned app bundle, sufficient for E2E testing.
echo "--- :package: Package app for testing ($PLATFORM-$ARCH)"
npm -w studio-app run package -- --arch="$ARCH" --platform="$FORGE_PLATFORM"

echo '--- :playwright: Run End To End Tests'

echo 'Installing Playwright browsers...'
npx playwright install

echo 'Running Playwright tests...'
npx playwright test
