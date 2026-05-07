#!/usr/bin/env bash
set -euo pipefail

MATRIX=${1:-}

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
if [ "$MATRIX" = "linux" ]; then
  # Linux runs inside the Docker container set up by the pipeline step. The
  # a8c-ci-toolkit cache helpers (hash_file, restore_cache) live on the host,
  # so install-node-dependencies.sh can't run here. Inline the equivalent
  # setup, matching the build step's approach (#3346) but skipping the apt
  # install — unit tests don't need fakeroot like the packaging step does.
  npm ci --unsafe-perm --no-audit --no-progress --maxsockets 1
else
  bash .buildkite/commands/install-node-dependencies.sh
fi

echo '--- :npm: Run Unit Tests'
npm run test

