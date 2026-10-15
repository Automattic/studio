#!/usr/bin/env bash
set -euo pipefail

PLATFORM=${1:-mac}

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
if [ "$PLATFORM" = "linux" ]; then
  # The a8c-ci-toolkit cache helpers only exist on the host, so
  # install-node-dependencies.sh cannot run inside the Linux container.
  npm ci --unsafe-perm --no-audit --no-progress --maxsockets 1
else
  bash .buildkite/commands/install-node-dependencies.sh
fi

echo '--- :node: Build CLI'
npm run cli:build

echo '--- :wordpress: Seed server files'
# Any CLI invocation copies the bundled WordPress into
# ~/.studio/server-files/wordpress-versions/latest, which the e2e harness requires.
node apps/cli/dist/cli/main.mjs site list

echo '--- :vitest: Run CLI E2E Tests'
# Serialize the files: each spins up its own sandbox WordPress + daemon, and
# booting several at once starves the CI host, flaking `site start`.
# Each test's daemon logs record why a site process died; keep them only when a test fails.
export STUDIO_E2E_DAEMON_LOGS_DIR=test-results/daemon-logs
test_exit=0
# TEMPORARY (revert before merge): repeat the flaky file until it fails, to capture its daemon logs.
if [ "$PLATFORM" = "windows" ]; then
  for run in $(seq 1 50); do
    echo "--- :repeat: site-management.e2e.test.ts run $run/50"
    npm test -- --project cli --tagsFilter='e2e' --no-file-parallelism apps/cli/commands/site/tests/site-management.e2e.test.ts || { test_exit=$?; break; }
  done
else
  npm test -- --project cli --tagsFilter='e2e' --no-file-parallelism .e2e.test.ts || test_exit=$?
fi
if [ "$test_exit" -eq 0 ]; then
  rm -rf "$STUDIO_E2E_DAEMON_LOGS_DIR"
fi
exit "$test_exit"
