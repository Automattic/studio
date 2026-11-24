#!/usr/bin/env bash
set -euo pipefail

MATRIX=${1:-}

echo '--- :package: Install deps'
if [ "$MATRIX" = "linux" ]; then
  # Linux runs inside a Docker container with the a8c-ci-toolkit mounted; its
  # cache helpers need the AWS CLI, as in the Lint job.
  apt-get -o Acquire::Retries=3 update
  apt-get install -y --no-install-recommends awscli jq
fi
bash .buildkite/commands/install-node-dependencies.sh

SHARD_ARGS=()
if [ -n "${BUILDKITE_PARALLEL_JOB_COUNT:-}" ]; then
  SHARD_COUNT=$BUILDKITE_PARALLEL_JOB_COUNT
  SHARD_ARGS=(--shard="$((BUILDKITE_PARALLEL_JOB + 1))/$SHARD_COUNT")

  # Every shard checks that the shards together hold every test file, so a
  # file that falls between them fails the build instead of never running.
  echo "--- :mag: Check that the $SHARD_COUNT shards cover every test file"
  npx vitest list --filesOnly --tagsFilter='!e2e' | sort -u > /tmp/all-test-files.txt
  for i in $(seq 1 "$SHARD_COUNT"); do
    npx vitest list --filesOnly --tagsFilter='!e2e' --shard="$i/$SHARD_COUNT"
  done | sort -u > /tmp/sharded-test-files.txt
  if ! diff /tmp/all-test-files.txt /tmp/sharded-test-files.txt; then
    echo "^^^ +++ The shards miss or add test files (diff above)"
    exit 1
  fi
  echo "$(wc -l < /tmp/all-test-files.txt) test files across $SHARD_COUNT shards"
fi

echo "--- :npm: Run Unit Tests ${SHARD_ARGS[*]+${SHARD_ARGS[*]}}"
npm run test -- --tagsFilter='!e2e' ${SHARD_ARGS[@]+"${SHARD_ARGS[@]}"}
