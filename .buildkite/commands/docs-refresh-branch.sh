#!/usr/bin/env bash

# Sourced by both docs refresh steps, so they work on the same tree: the names of a run's target
# and branch, and the checkout of that branch.

BASE_BRANCH="${BUILDKITE_BRANCH:?Expected BUILDKITE_BRANCH}"
VERSION="${DOCS_REFRESH_VERSION:-}"
if [[ -z "$VERSION" && "$BASE_BRANCH" == release/* ]]; then
  VERSION="${BASE_BRANCH#release/}"
fi
TARGET="${VERSION:-$BASE_BRANCH}"
DOCS_BRANCH="docs-refresh/$TARGET"
OUT="docs-refresh-output"

annotate() {
  echo "$1"
  if command -v buildkite-agent >/dev/null; then
    buildkite-agent annotate "$1" --style "${2:-info}" --context docs-refresh
  fi
}

# An open refresh for this target keeps its branch and pull request: start from it, with the base merged in.
checkout_docs_branch() {
  if git ls-remote --exit-code --heads origin "$DOCS_BRANCH" >/dev/null; then
    git fetch origin "$DOCS_BRANCH"
    git checkout -B "$DOCS_BRANCH" FETCH_HEAD
    git merge --no-edit "$BUILDKITE_COMMIT"
  else
    git checkout -B "$DOCS_BRANCH" "$BUILDKITE_COMMIT"
  fi
}
