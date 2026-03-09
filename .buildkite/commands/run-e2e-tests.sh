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

if ! buildkite-agent artifact download "$ARTIFACT_PATTERN" .; then
  echo "^^^ +++ Required prebuilt app artifact not found: $ARTIFACT_PATTERN"
  exit 1
fi
ARTIFACT_FILE=$(find . -type f -name "studio-app-${PLATFORM}-${ARCH}.tar.gz" | head -n 1)
if [ -z "$ARTIFACT_FILE" ]; then
  echo "^^^ +++ Downloaded artifact but couldn't locate archive for ${PLATFORM}-${ARCH}"
  exit 1
fi
echo "--- :package: Extracting prebuilt app artifacts ($PLATFORM-$ARCH) from $ARTIFACT_FILE"
tar -xzf "$ARTIFACT_FILE"

echo '--- :playwright: Run End To End Tests'

echo 'Installing Playwright browsers...'
npx playwright install

echo 'Running Playwright tests...'
npx playwright test
