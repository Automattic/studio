#!/usr/bin/env bash
set -euo pipefail

# Runs the docs refresh on this machine, in the container CI uses, so the screenshots come out as
# they do there. Needs Docker. Nothing is pushed and this checkout is not touched: the run works
# on a copy of the commit you name, in a Docker volume, and its results land in
# docs-refresh-output/ here.
#
#   scripts/docs-refresh/run-local.sh [<commit or branch, default HEAD>] [-- <command>…]
#
# Only committed work is included. The agent needs ANTHROPIC_API_KEY, or CLAUDE_CODE_OAUTH_TOKEN
# (a Claude subscription's token, from `claude setup-token`). Without either the run stops after
# the screenshot check and the brief. The DOCS_REFRESH_* variables of run-docs-refresh.sh pass
# through.
#
# With a command, that runs in the container instead of the refresh, after the same setup, to
# recapture by hand: `run-local.sh -- npm --prefix docs/user run screenshots -- --suite site-menu`.
# Either way, what the run changed under docs/user comes back as docs-refresh-output/local.patch:
# `git apply --index docs-refresh-output/local.patch` puts it on your branch.

ROOT="$(git rev-parse --show-toplevel)"
REF=HEAD
if [[ $# -gt 0 && "$1" != "--" ]]; then
  REF="$1"
  shift
fi
if [[ "${1:-}" == "--" ]]; then
  shift
fi
COMMIT="$(git -C "$ROOT" rev-parse --verify "$REF^{commit}")"
BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref "$REF")"
if [[ "$BRANCH" == "HEAD" ]]; then
  BRANCH="local"
fi
IMAGE="node:$(sed 's/^v//' "$ROOT/.nvmrc")-bookworm"
# A plain clone the container can read the commit from: this checkout may be a worktree, whose
# Git folder is elsewhere.
SOURCE="${TMPDIR:-/tmp}/studio-docs-refresh-source"
# The run's own checkout, with its installed dependencies, kept between runs. A volume, because
# the build cannot write through a folder shared from macOS.
VOLUME="${DOCS_REFRESH_VOLUME:-studio-docs-refresh}"

if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running. Start it and run this again." >&2
  exit 1
fi

if [[ ! -d "$SOURCE" ]]; then
  git clone --quiet --bare "$ROOT" "$SOURCE"
fi
git -C "$SOURCE" fetch --quiet "$ROOT" "$COMMIT"

if [[ $# -eq 0 && -z "${ANTHROPIC_API_KEY:-}${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  echo "Neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set: checking the screenshots and writing the brief only."
  export DOCS_REFRESH_CHECK_ONLY=true
fi

env_args=(-e "BUILDKITE_BRANCH=$BRANCH" -e "BUILDKITE_COMMIT=$COMMIT" -e ANTHROPIC_API_KEY -e CLAUDE_CODE_OAUTH_TOKEN)
for name in $(compgen -v DOCS_REFRESH_); do
  env_args+=(-e "$name")
done

rm -rf "$ROOT/docs-refresh-output"
mkdir -p "$ROOT/docs-refresh-output"

echo "Refreshing the docs for $BRANCH at ${COMMIT:0:9} in $IMAGE..."
# shellcheck disable=SC2016
docker run --rm --init "${env_args[@]}" \
  -v "$VOLUME:/workdir" -v "$SOURCE:/source:ro" -v "$ROOT/docs-refresh-output:/out" \
  -w /workdir "$IMAGE" bash -c '
    set -euo pipefail
    git config --global --add safe.directory "*"
    if [[ ! -d .git ]]; then
      git init --quiet .
      git remote add origin https://github.com/Automattic/studio.git
    fi
    git fetch --quiet /source "$BUILDKITE_COMMIT"
    git checkout --quiet --force --detach "$BUILDKITE_COMMIT"
    git clean --quiet -fd
    status=0
    if [[ $# -eq 0 ]]; then
      bash .buildkite/commands/run-docs-refresh.sh || status=$?
    else
      source .buildkite/commands/docs-refresh-setup.sh
      "$@" || status=$?
    fi
    git add docs/user
    git diff --cached --binary "$BUILDKITE_COMMIT" -- docs/user > /out/local.patch
    if [[ -d docs-refresh-output ]]; then
      cp -R docs-refresh-output/. /out/
    fi
    exit "$status"
  ' run-local "$@"
