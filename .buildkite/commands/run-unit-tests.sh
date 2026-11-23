#!/usr/bin/env bash
set -euo pipefail

MATRIX=${1:-}

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
if [ "$MATRIX" = "linux" ]; then
  # Linux runs inside a Docker container; the a8c-ci-toolkit cache helpers
  # (hash_file, restore_cache) only exist on the host, so install-node-
  # dependencies.sh can't run here. Run npm ci directly instead.
  npm ci --unsafe-perm --no-audit --no-progress --maxsockets 1
else
  bash .buildkite/commands/install-node-dependencies.sh
fi

echo '--- :dart: Select tests'
# shellcheck disable=SC2207 # The script prints whitespace-free arguments.
SELECT_ARGS=($(bash .buildkite/commands/select-unit-tests.sh))
VITEST_ARGS=(--tagsFilter='!e2e' ${SELECT_ARGS[@]+"${SELECT_ARGS[@]}"})

SHARD_ARGS=()
if [ -n "${BUILDKITE_PARALLEL_JOB_COUNT:-}" ]; then
  SHARD_COUNT=$BUILDKITE_PARALLEL_JOB_COUNT
  SHARD_ARGS=(--shard="$((BUILDKITE_PARALLEL_JOB + 1))/$SHARD_COUNT")

  # Every shard checks that the shards together hold every test file, so a
  # file that falls between them fails the build instead of never running.
  echo "--- :mag: Check that the $SHARD_COUNT shards cover every test file"
  npx vitest list --filesOnly "${VITEST_ARGS[@]}" | sort -u > /tmp/all-test-files.txt
  for i in $(seq 1 "$SHARD_COUNT"); do
    npx vitest list --filesOnly "${VITEST_ARGS[@]}" --shard="$i/$SHARD_COUNT"
  done | sort -u > /tmp/sharded-test-files.txt
  if ! diff /tmp/all-test-files.txt /tmp/sharded-test-files.txt; then
    echo "^^^ +++ The shards miss or add test files (diff above)"
    exit 1
  fi
  echo "$(wc -l < /tmp/all-test-files.txt) test files across $SHARD_COUNT shards"
fi

echo "--- :npm: Run Unit Tests ${SHARD_ARGS[*]+${SHARD_ARGS[*]}}"
npm run test -- "${VITEST_ARGS[@]}" ${SHARD_ARGS[@]+"${SHARD_ARGS[@]}"}
