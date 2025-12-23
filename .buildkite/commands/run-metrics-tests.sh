#!/usr/bin/env bash
set -euo pipefail

echo '--- :package: Install main dependencies'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :package: Install compare-perf dependencies'
cd scripts/compare-perf
npm ci
cd -

echo '--- :white_check_mark: Dependencies installed successfully'
echo "Branch: $BUILDKITE_BRANCH"
echo "Commit: $BUILDKITE_COMMIT"
echo "PR Number: $BUILDKITE_PULL_REQUEST"
echo ""
echo "Next step: Add app packaging"
