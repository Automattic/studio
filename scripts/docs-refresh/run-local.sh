#!/usr/bin/env bash
set -euo pipefail

# Runs the docs refresh on this machine, in the container CI uses, so the screenshots come out as
# they do there. Needs Docker. Nothing is pushed and this checkout is not touched: the run works
# on a clone of the commit you name, and its results land in docs-refresh-output/ here.
#
#   scripts/docs-refresh/run-local.sh [<commit or branch, default HEAD>]
#
# Only committed work is included. The agent needs ANTHROPIC_API_KEY, or CLAUDE_CODE_OAUTH_TOKEN
# (a Claude subscription's token, from `claude setup-token`). Without either the run stops after
# the screenshot check and the brief; with one, it leaves docs-refresh-output/docs-refresh.patch,
# which `git apply --index docs-refresh-output/docs-refresh.patch` puts on your branch.
# The DOCS_REFRESH_* variables of run-docs-refresh.sh pass through.

ROOT="$(git rev-parse --show-toplevel)"
REF="${1:-HEAD}"
COMMIT="$(git -C "$ROOT" rev-parse --verify "$REF^{commit}")"
BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref "$REF")"
if [[ "$BRANCH" == "HEAD" ]]; then
  BRANCH="local"
fi
IMAGE="node:$(sed 's/^v//' "$ROOT/.nvmrc")-bookworm"
# Kept between runs, so later ones reuse the clone.
WORK="${DOCS_REFRESH_WORKDIR:-${TMPDIR:-/tmp}/studio-docs-refresh}"

if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running. Start it and run this again." >&2
  exit 1
fi

if [[ ! -d "$WORK/.git" ]]; then
  git clone --quiet --no-checkout "$ROOT" "$WORK"
fi
git -C "$WORK" fetch --quiet "$ROOT" "$COMMIT"
git -C "$WORK" checkout --quiet --force --detach "$COMMIT"
# What an earlier run changed, without the installed dependencies.
git -C "$WORK" clean --quiet -fd

if [[ -z "${ANTHROPIC_API_KEY:-}${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  echo "Neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set: checking the screenshots and writing the brief only."
  export DOCS_REFRESH_CHECK_ONLY=true
fi

env_args=(-e "BUILDKITE_BRANCH=$BRANCH" -e "BUILDKITE_COMMIT=$COMMIT" -e ANTHROPIC_API_KEY -e CLAUDE_CODE_OAUTH_TOKEN)
for name in $(compgen -v DOCS_REFRESH_); do
  env_args+=(-e "$name")
done

echo "Refreshing the docs for $BRANCH at ${COMMIT:0:9} in $IMAGE..."
status=0
docker run --rm --init -v "$WORK:/workdir" -w /workdir "${env_args[@]}" "$IMAGE" \
  bash .buildkite/commands/run-docs-refresh.sh || status=$?

rm -rf "$ROOT/docs-refresh-output"
if [[ -d "$WORK/docs-refresh-output" ]]; then
  cp -R "$WORK/docs-refresh-output" "$ROOT/docs-refresh-output"
  echo "Results are in docs-refresh-output/ (start with brief.md)."
fi
exit "$status"
