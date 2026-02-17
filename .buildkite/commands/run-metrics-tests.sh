#!/usr/bin/env bash
set -euo pipefail

if .buildkite/commands/should-skip-job.sh --job-type metrics; then
  exit 0
fi

echo '--- :package: Install main dependencies'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :package: Install compare-perf dependencies'
npm -w compare-perf install

export IS_DEV_BUILD=true
export ARTIFACTS_PATH=${PWD}/tools/metrics/artifacts
export SKIP_WORKER_THREAD_BUILD='true'
export COMPARE_PERF_PREBUILT_BRANCH=$BUILDKITE_COMMIT
export COMPARE_PERF_PREBUILT_OUT_DIR=${PWD}/apps/studio/out

echo '--- :package: Downloading prebuilt app artifacts'
buildkite-agent artifact download "artifacts/studio-app-mac-arm64.tar.gz" .
tar -xzf artifacts/studio-app-mac-arm64.tar.gz

if [ "${BUILDKITE_PULL_REQUEST}" != "false" ]; then
  TRUNK_ARTIFACT_CACHE_KEY="$BUILDKITE_PIPELINE_SLUG-trunk-mac-arm64-package"
  TRUNK_ARTIFACT_CACHE_PATH="artifacts/trunk-mac-arm64"
  TRUNK_ARTIFACT_FILE="$TRUNK_ARTIFACT_CACHE_PATH/studio-app-trunk-mac-arm64.tar.gz"
  TRUNK_EXTRACT_PATH="${PWD}/artifacts/trunk-mac-arm64-extract"

  echo '--- :package: Restoring latest cached trunk package artifact'
  if restore_cache "$TRUNK_ARTIFACT_CACHE_KEY" && [ -f "$TRUNK_ARTIFACT_FILE" ]; then
    rm -rf "$TRUNK_EXTRACT_PATH"
    mkdir -p "$TRUNK_EXTRACT_PATH"
    tar -xzf "$TRUNK_ARTIFACT_FILE" -C "$TRUNK_EXTRACT_PATH"
    export COMPARE_PERF_PREBUILT_BRANCH_BASE=trunk
    export COMPARE_PERF_PREBUILT_OUT_DIR_BASE="$TRUNK_EXTRACT_PATH/apps/studio/out"
  else
    echo "--- :warning: Could not restore cached trunk package artifact; compare-perf will build trunk"
  fi
fi

# Detect if this is a PR or trunk push
if [ "${BUILDKITE_PULL_REQUEST}" != "false" ]; then
  # PR context - compare against trunk
  echo "--- :chart_with_upwards_trend: Running performance comparison against trunk"
  npm -w compare-perf run compare -- perf $BUILDKITE_COMMIT trunk --tests-branch $BUILDKITE_COMMIT --rounds 3

  echo "--- :github: Posting results to PR"
  # Parse repo from git@github.com:owner/repo.git or https://github.com/owner/repo.git format
  REPO_PATH=$(echo $BUILDKITE_REPO | sed 's|^git@github\.com:||' | sed 's|^https://github\.com/||' | sed 's|\.git$||')
  npm -w compare-perf run post-to-github -- $GITHUB_TOKEN $REPO_PATH $BUILDKITE_PULL_REQUEST trunk $BUILDKITE_COMMIT
elif [ "${BUILDKITE_BRANCH}" == "trunk" ]; then
  # Trunk push context - compare against baseline
  BASELINE_COMMIT="58c52bfee7e585614ced202f43f217a01f94f029"

  echo "--- :chart_with_upwards_trend: Running performance comparison against baseline"
  npm -w compare-perf run compare -- perf $BUILDKITE_COMMIT $BASELINE_COMMIT --tests-branch $BUILDKITE_COMMIT --rounds 3

  echo "--- :bar_chart: Logging metrics to CodeVitals"
  COMMITTED_AT=$(git show -s $BUILDKITE_COMMIT --format="%cI")
  npm -w compare-perf run log-to-codevitals -- $CODEVITALS_AUTH_TOKEN trunk $BUILDKITE_COMMIT $BASELINE_COMMIT $COMMITTED_AT
else
  # Other branches - skip metrics
  echo "--- :information_source: Skipping metrics for non-trunk branch"
  exit 0
fi
