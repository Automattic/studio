#!/usr/bin/env bash
set -euo pipefail

# Publishes what run-docs-refresh.sh left: applies its patch to the docs refresh branch, pushes
# it, and opens or updates the pull request. The capture and the agent run in a container that
# cannot push; this step has the bot's Git access and does nothing else.
#
#   DOCS_REFRESH_DRY_RUN   true: push nothing; the patch stays an artifact of the run

source .buildkite/commands/docs-refresh-branch.sh

buildkite-agent artifact download "$OUT/*" . --step docs_refresh

if [[ ! -s "$OUT/docs-refresh.patch" ]]; then
  echo "No docs change to publish."
  exit 0
fi
if [[ "${DOCS_REFRESH_DRY_RUN:-false}" == "true" ]]; then
  annotate "Docs refresh for $TARGET (dry run): the change is in the \`docs-refresh.patch\` artifact; nothing was pushed."
  exit 0
fi

echo "--- :git: Check out $DOCS_BRANCH"
checkout_docs_branch
git apply --index "$OUT/docs-refresh.patch"
# The patch may only touch the docs, whatever produced it.
if git diff --cached --name-only | grep -qv '^docs/user/'; then
  echo "The patch changes files outside docs/user:"
  git diff --cached --name-only | grep -v '^docs/user/'
  exit 1
fi
git commit -m "Refresh the docs for $TARGET"

echo "--- :github: Open the pull request"
git push origin "$DOCS_BRANCH"
pr_url="$(node scripts/docs-refresh/docs-refresh.mjs open-pr \
  --repo Automattic/studio --head "$DOCS_BRANCH" --base "$BASE_BRANCH" \
  --target "$TARGET" --title "Refresh the docs for $TARGET" --out "$OUT")"
annotate "Docs refresh for $TARGET: $pr_url" success
