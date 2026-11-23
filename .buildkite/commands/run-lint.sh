#!/usr/bin/env bash

set -euo pipefail

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :aws: Install AWS CLI for the cache helpers'
apt-get -o Acquire::Retries=3 update
apt-get install -y --no-install-recommends awscli jq

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

# Run every check even when an earlier one fails, so one run lists every failure.
failed=()

echo '--- :eslint: Lint'
npm run lint || failed+=(lint)

echo '--- :scissors: Unused code'
npm run knip || failed+=(knip)

echo '--- :typescript: Typecheck'
npm run typecheck || failed+=(typecheck)

if [ ${#failed[@]} -gt 0 ]; then
  echo "^^^ +++ Failed: ${failed[*]}"
  exit 1
fi
