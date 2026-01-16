#!/usr/bin/env bash
set -euo pipefail

MATRIX=${1:-}

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

export IS_DEV_BUILD=true

echo '--- :package: Package app for testing'
npm run package

echo '--- :playwright: Run End To End Tests'
echo 'Installing Playwright browsers...'
npx playwright install
echo 'Running Playwright tests...'
npx playwright test
