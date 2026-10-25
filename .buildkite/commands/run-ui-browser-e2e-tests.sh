#!/usr/bin/env bash
set -euo pipefail

if .buildkite/commands/should-skip-job.sh --job-type e2e; then
  exit 0
fi

echo '--- :package: Install deps'
# The a8c-ci-toolkit cache helpers only exist on the host, so
# install-node-dependencies.sh cannot run inside the Linux container.
npm ci --unsafe-perm --no-audit --no-progress --maxsockets 1

echo '--- :node: Build the CLI with the browser UI'
npm run cli:build:ui

echo '--- :playwright: Run the apps/ui browser e2e'
npx playwright install --with-deps chromium
export STUDIO_E2E_DAEMON_LOGS_DIR=test-results/daemon-logs
test_exit=0
npx playwright test --project=ui-web || test_exit=$?
if [ "$test_exit" -eq 0 ]; then
  rm -rf "$STUDIO_E2E_DAEMON_LOGS_DIR"
fi
exit "$test_exit"
