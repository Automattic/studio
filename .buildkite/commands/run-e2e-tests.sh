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

ARTIFACT_FILE="artifacts/studio-app-${PLATFORM}-${ARCH}.tar.gz"

if ! buildkite-agent artifact download "$ARTIFACT_FILE" .; then
  echo "^^^ +++ Required prebuilt app artifact not found: $ARTIFACT_FILE"
  exit 1
fi
echo "--- :package: Extracting prebuilt app artifacts ($PLATFORM-$ARCH)"
tar -xzf "$ARTIFACT_FILE"

echo '--- :playwright: Run End To End Tests'

echo 'Installing Playwright browsers...'
npx playwright install

echo 'Running Playwright tests...'
npx playwright test
