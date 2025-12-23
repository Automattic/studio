#!/usr/bin/env bash
set -euo pipefail

echo '--- :package: Install main dependencies'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :package: Install compare-perf dependencies'
cd scripts/compare-perf
npm ci
cd -

export IS_DEV_BUILD=true
export ARTIFACTS_PATH=${PWD}/artifacts
export SKIP_WORKER_THREAD_BUILD='true'

echo '--- :package: Package app for testing'
npm run package

echo '--- :white_check_mark: App packaged successfully'
echo "Branch: $BUILDKITE_BRANCH"
echo "Commit: $BUILDKITE_COMMIT"
echo "PR Number: $BUILDKITE_PULL_REQUEST"
echo ""
echo "Next step: Add metrics test execution"
