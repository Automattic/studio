#!/usr/bin/env bash
set -euo pipefail

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

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
npm test -- --project cli --tagsFilter='e2e' --no-file-parallelism .e2e.test.ts || test_exit=$?
if [ "$test_exit" -eq 0 ]; then
  rm -rf "$STUDIO_E2E_DAEMON_LOGS_DIR"
fi
exit "$test_exit"
