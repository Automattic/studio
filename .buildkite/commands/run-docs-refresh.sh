#!/usr/bin/env bash
set -euo pipefail

# Refreshes the user docs (docs/user) against the Studio in this checkout: checks every docs
# screenshot, lets an agent update the pages and the shots that moved, and leaves the change as a
# patch for publish-docs-refresh.sh. See "Docs refresh" in docs/release-process.md.
#
# Runs as root in a Linux container, with the browser driver (`studio ui` in headless Chromium),
# as the docs images are captured: no window chrome from macOS or Windows, and no display.
#
#   DOCS_REFRESH_VERSION   the release to document; defaults to the version of a release/<version> branch
#   DOCS_REFRESH_PROMPT    an extra instruction for the agent; also makes the agent run when nothing changed
#   DOCS_REFRESH_CHECK_ONLY   true: stop after the screenshot check and the brief, without the agent
#   DOCS_REFRESH_MODEL     the agent's model; defaults to the CLI's own default
#   DOCS_REFRESH_MAX_BUDGET_USD   the most one agent run may spend (default 25)

source .buildkite/commands/docs-refresh-branch.sh

CLAUDE_CODE_VERSION=2.1.322

rm -rf "$OUT"
mkdir -p "$OUT"

echo "--- :git: Check out $DOCS_BRANCH"
# The container has no SSH keys and does not own the checkout; reading needs neither.
git config --global --add safe.directory "$PWD"
git remote set-url origin https://github.com/Automattic/studio.git
# For the merge commit, which stays in this container: the publish step makes its own.
export GIT_AUTHOR_NAME="Docs refresh" GIT_AUTHOR_EMAIL="docs-refresh@localhost"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
checkout_docs_branch

source .buildkite/commands/docs-refresh-setup.sh

echo "--- :camera: Check the docs screenshots"
# Exits 1 when a shot changed or failed, which is a finding here, not an error.
"${HARNESS[@]}" check docs/user/screenshots/shots --driver browser \
  --out docs/user/screenshots/images --diff-dir "$OUT/diffs" \
  --json > "$OUT/capture.json" || true
if ! node -e 'if ( ! Array.isArray( JSON.parse( require( "fs" ).readFileSync( process.argv[ 1 ], "utf8" ) ).shots ) ) process.exit( 1 )' "$OUT/capture.json"; then
  echo "The screenshot check did not finish: $OUT/capture.json has no results."
  exit 1
fi

echo "--- :memo: Collect what changed"
brief_args=(--out "$OUT" --capture "$OUT/capture.json")
if [[ -n "$VERSION" ]]; then
  brief_args+=(--version "$VERSION")
fi
decision="$(node scripts/docs-refresh/docs-refresh.mjs brief "${brief_args[@]}")"
cat "$OUT/brief.md"

if [[ "$decision" != "run" ]]; then
  annotate "Docs refresh for $TARGET: nothing changed since the docs were last updated, and every screenshot matches." success
  exit 0
fi

if [[ "${DOCS_REFRESH_CHECK_ONLY:-false}" == "true" ]]; then
  annotate "Docs refresh for $TARGET (check only): the docs need a refresh; see the brief and the screenshot results in the artifacts."
  exit 0
fi

echo "--- :robot_face: Update the docs"
# An API key in CI; on your own machine, a subscription token from `claude setup-token` works too.
if [[ -z "${ANTHROPIC_API_KEY:-}${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  echo "The docs need a refresh, but neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set."
  exit 1
fi
# Whatever setup left behind is not the agent's doing.
git status --porcelain --untracked-files=all > "$OUT/baseline.txt"

agent_args=(
  --print "Follow scripts/docs-refresh/agent-instructions.md."
  --permission-mode acceptEdits
  --max-budget-usd "${DOCS_REFRESH_MAX_BUDGET_USD:-25}"
  --output-format json
  --allowedTools
  "Read" "Edit" "Write" "Glob" "Grep"
  "Bash(git log:*)" "Bash(git show:*)" "Bash(git diff:*)" "Bash(git status:*)"
  "Bash(npm --prefix docs/user run screenshots:*)"
  "Bash(npx studio-capture:*)"
  "Bash(node --experimental-strip-types tools/capture-harness/cli.ts:*)"
)
if [[ -n "${DOCS_REFRESH_MODEL:-}" ]]; then
  agent_args+=(--model "$DOCS_REFRESH_MODEL")
fi
npx --yes "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" "${agent_args[@]}" > "$OUT/agent.json"

echo "--- :mag: Check the agent's work"
node scripts/docs-refresh/docs-refresh.mjs verify --baseline "$OUT/baseline.txt"
"${HARNESS[@]}" validate docs/user/screenshots/shots

git add docs/user
if git diff --cached --quiet; then
  annotate "Docs refresh for $TARGET: the agent reviewed the changes and found the docs current." success
  exit 0
fi

# Binary, for the images. The publish step applies it to the same tree and opens the pull request.
git diff --cached --binary > "$OUT/docs-refresh.patch"
annotate "Docs refresh for $TARGET: the agent changed the docs; the change is in the \`docs-refresh.patch\` artifact."
