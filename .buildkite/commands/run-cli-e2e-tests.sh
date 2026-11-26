#!/usr/bin/env bash
set -euo pipefail

PLATFORM=${1:-mac}

echo '--- :package: Install deps'
if [ "$PLATFORM" = "linux" ]; then
  # Linux runs inside a Docker container with the a8c-ci-toolkit mounted; its
  # cache helpers need the AWS CLI, as in the Lint job.
  apt-get -o Acquire::Retries=3 update
  apt-get install -y --no-install-recommends awscli jq
fi
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
