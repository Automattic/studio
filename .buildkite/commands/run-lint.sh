#!/usr/bin/env bash

set -euo pipefail

# TEMPORARY: always run while validating the default-queue move. Revert before merge.
if false && .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
# Runs in a Docker container, where the a8c-ci-toolkit cache helpers install-node-dependencies.sh needs don't exist.
npm ci --unsafe-perm --no-audit --no-progress --maxsockets 1

echo '--- :eslint: Lint'
npm run lint

echo '--- :scissors: Unused code'
npm run knip

echo '--- :typescript: Typecheck'
npm run typecheck
