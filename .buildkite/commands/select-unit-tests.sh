#!/usr/bin/env bash

# Prints the Vitest arguments that narrow a PR build's unit tests to the test
# files its diff can reach through imports, or nothing to run every test.

set -euo pipefail

base=$(bash .buildkite/commands/pr-selection-base.sh)
if [ -n "$base" ]; then
  echo "Only the tests the diff can reach run; the merge queue runs them all" >&2
  echo "--changed=$base --passWithNoTests"
fi
