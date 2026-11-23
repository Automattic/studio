#!/usr/bin/env bash

# Prints the commit a PR build may narrow its checks against: the merge base
# with the PR's base branch. Prints nothing, so every check runs in full,
# outside PR builds, in merge queue builds (the full suite gates trunk there),
# and when the diff touches an input that checks depend on without importing it.

set -euo pipefail

[[ "${BUILDKITE_PULL_REQUEST:-false}" =~ ^[0-9]+$ ]] || exit 0
[ -z "${BUILDKITE_MERGE_QUEUE_BASE_BRANCH:-}" ] || exit 0

base=${BUILDKITE_PULL_REQUEST_BASE_BRANCH:?}
# The containers have no GitHub host key, so fetch over HTTPS.
git -c url.https://github.com/.insteadOf=git@github.com: fetch --quiet origin "$base" >&2
if ! merge_base=$(git merge-base HEAD "origin/$base" 2> /dev/null); then
  echo "No merge base with origin/$base: every check runs in full" >&2
  exit 0
fi

while IFS= read -r file; do
  case "$file" in
    # Inputs every check depends on: dependencies, compiler, lint and test
    # config, mocks, setup files, install scripts and CI.
    package.json | */package.json | package-lock.json | .nvmrc | \
      tsconfig*.json | */tsconfig*.json | vitest.* | */vitest.* | \
      eslint.config.* | tools/eslint-plugin-studio/* | .prettierrc | .prettierignore | \
      apps/ui/src/lib/theme/*.css | apps/ui/src/lib/ui/*.css | \
      */__mocks__/* | *setup*.ts | scripts/* | apps/studio/patches/* | .buildkite/*)
      echo "Every check runs in full: $file changed" >&2
      exit 0
      ;;
    *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.css) ;;
    *)
      # Tests may read this file at run time, which imports don't show.
      echo "Every check runs in full: $file is not a source file" >&2
      exit 0
      ;;
  esac
done < <(git diff --name-only "$merge_base" HEAD)

echo "$merge_base"
