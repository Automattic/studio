#!/usr/bin/env bash
set -euo pipefail

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :npm: Run Unit Tests'
npm run test -- --tagsFilter='!e2e'
