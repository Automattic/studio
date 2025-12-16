#!/usr/bin/env bash
set -euo pipefail

MATRIX=${1:-}

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

export IS_DEV_BUILD=true

echo '--- :package: Package app for testing'
npm run package

echo '--- :playwright: Run End To End Tests'
echo 'Installing Playwright browsers...'
npx playwright install
echo 'Running Playwright tests...'
npx playwright test e2e/import-export.test.ts
