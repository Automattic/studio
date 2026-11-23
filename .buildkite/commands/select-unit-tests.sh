#!/usr/bin/env bash

# Prints the Vitest arguments that narrow a PR build's unit tests to the test
# files its diff can reach through imports. Prints nothing, so every test runs,
# outside PR builds, in merge queue builds (the full suite gates trunk there),
# and when the diff touches an input that tests depend on without importing it.

set -euo pipefail

[[ "${BUILDKITE_PULL_REQUEST:-false}" =~ ^[0-9]+$ ]] || exit 0
[ -z "${BUILDKITE_MERGE_QUEUE_BASE_BRANCH:-}" ] || exit 0

base=${BUILDKITE_PULL_REQUEST_BASE_BRANCH:?}
# The containers have no GitHub host key, so fetch over HTTPS.
git -c url.https://github.com/.insteadOf=git@github.com: fetch --quiet origin "$base" >&2
if ! merge_base=$(git merge-base HEAD "origin/$base" 2> /dev/null); then
  echo "No merge base with origin/$base: every test runs" >&2
  exit 0
fi

while IFS= read -r file; do
  case "$file" in
    # Inputs every test depends on: dependencies, compiler and test config,
    # mocks, setup files, install scripts and CI.
    package.json | */package.json | package-lock.json | .nvmrc | \
      tsconfig*.json | */tsconfig*.json | vitest.* | */vitest.* | \
      */__mocks__/* | *setup*.ts | scripts/* | apps/studio/patches/* | .buildkite/*)
      echo "Every test runs: $file changed" >&2
      exit 0
      ;;
    *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.css) ;;
    *)
      # Tests may read this file at run time, which imports don't show.
      echo "Every test runs: $file is not a source file" >&2
      exit 0
      ;;
  esac
done < <(git diff --name-only "$merge_base" HEAD)

echo "Only the tests the diff can reach run; the merge queue runs them all" >&2
echo "--changed=$merge_base --passWithNoTests"
