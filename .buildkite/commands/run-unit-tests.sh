#!/usr/bin/env bash
set -euo pipefail

MATRIX=${1:-}

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
if [ "$MATRIX" = "linux" ]; then
  # Linux runs inside a Docker container; the a8c-ci-toolkit cache helpers
  # (hash_file, restore_cache) only exist on the host, so install-node-
  # dependencies.sh can't run here. Run npm ci directly instead.
  npm ci --unsafe-perm --no-audit --no-progress --maxsockets 1
else
  bash .buildkite/commands/install-node-dependencies.sh
fi

echo '--- :npm: Run Unit Tests'
npm run test -- --tagsFilter='!e2e'
