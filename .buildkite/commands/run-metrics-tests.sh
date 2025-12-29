#!/usr/bin/env bash
set -euo pipefail

# Only run metrics tests builds running on trunk or in PRs
if [ "${BUILDKITE_PULL_REQUEST}" == "false" ] && [ "${BUILDKITE_BRANCH}" != "trunk" ]; then
  echo "--- :information_source: Skipping metrics for non-trunk branch"
  exit 0
fi

echo '--- :package: Install main dependencies'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :package: Install compare-perf dependencies'
cd scripts/compare-perf
npm ci
cd -

export IS_DEV_BUILD=true
export ARTIFACTS_PATH=${PWD}/artifacts
export SKIP_WORKER_THREAD_BUILD='true'

# Detect if this is a PR or trunk push
if [ "${BUILDKITE_PULL_REQUEST}" != "false" ]; then
  # PR context - compare against trunk
  echo "--- :chart_with_upwards_trend: Running performance comparison against trunk"
  cd scripts/compare-perf
  npm run compare -- perf "$BUILDKITE_COMMIT" trunk --tests-branch "$BUILDKITE_COMMIT" --rounds 4

  echo "--- :github: Posting results to PR"
  # Parse repo from git@github.com:owner/repo.git or https://github.com/owner/repo.git format
  REPO_PATH=$(echo "$BUILDKITE_REPO" | sed 's|^git@github\.com:||' | sed 's|^https://github\.com/||' | sed 's|\.git$||')
  npm run post-to-github -- "$GITHUB_TOKEN" "$REPO_PATH" "$BUILDKITE_PULL_REQUEST" trunk "$BUILDKITE_COMMIT"
  cd -
elif [ "${BUILDKITE_BRANCH}" == "trunk" ]; then
  # Trunk push context - compare against baseline
  BASELINE_COMMIT="d1f49275f3e08fb675d5685855c2243b6cd183de"

  echo "--- :chart_with_upwards_trend: Running performance comparison against baseline"
  cd scripts/compare-perf
  npm run compare -- perf "$BUILDKITE_COMMIT" "$BASELINE_COMMIT" --tests-branch "$BUILDKITE_COMMIT" --rounds 3

  echo "--- :bar_chart: Logging metrics to CodeVitals"
  COMMITTED_AT=$(git show -s "$BUILDKITE_COMMIT" --format="%cI")
  npm run log-to-codevitals -- "$CODEVITALS_AUTH_TOKEN" trunk "$BUILDKITE_COMMIT" "$BASELINE_COMMIT" "$COMMITTED_AT"
  cd -
fi
