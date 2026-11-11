#!/usr/bin/env bash
set -euo pipefail

# Refreshes the user docs (docs/user) against the Studio in this checkout: checks every docs
# screenshot, lets an agent update the pages and the shots that moved, and opens or updates one
# pull request. See "Docs refresh" in docs/release-process.md.
#
#   DOCS_REFRESH_VERSION   the release to document; defaults to the version of a release/<version> branch
#   DOCS_REFRESH_PROMPT    an extra instruction for the agent; also makes the agent run when nothing changed
#   DOCS_REFRESH_DRY_RUN   true: stop before pushing, and upload the change as a patch instead
#   DOCS_REFRESH_MODEL     the agent's model; defaults to the CLI's own default
#   DOCS_REFRESH_MAX_BUDGET_USD   the most one agent run may spend (default 25)

BASE_BRANCH="${BUILDKITE_BRANCH:?Expected BUILDKITE_BRANCH}"
VERSION="${DOCS_REFRESH_VERSION:-}"
if [[ -z "$VERSION" && "$BASE_BRANCH" == release/* ]]; then
  VERSION="${BASE_BRANCH#release/}"
fi
TARGET="${VERSION:-$BASE_BRANCH}"
DOCS_BRANCH="docs-refresh/$TARGET"
OUT="docs-refresh-output"
HARNESS=(node --experimental-strip-types tools/capture-harness/cli.ts)
SCENE=moire
CLAUDE_CODE_VERSION=2.1.322

annotate() {
  echo "$1"
  if command -v buildkite-agent >/dev/null; then
    buildkite-agent annotate "$1" --style "${2:-info}" --context docs-refresh
  fi
}

rm -rf "$OUT"
mkdir -p "$OUT"

echo "--- :git: Check out $DOCS_BRANCH"
# An open refresh for this target keeps its branch and pull request: start from it, with the base merged in.
if git ls-remote --exit-code --heads origin "$DOCS_BRANCH" >/dev/null; then
  git fetch origin "$DOCS_BRANCH"
  git checkout -B "$DOCS_BRANCH" FETCH_HEAD
  git merge --no-edit "$BUILDKITE_COMMIT"
else
  git checkout -B "$DOCS_BRANCH" "$BUILDKITE_COMMIT"
fi

echo "--- :npm: Install Node dependencies"
bash .buildkite/commands/install-node-dependencies.sh

echo "--- :hammer: Set up the capture harness"
"${HARNESS[@]}" setup
if [[ ! -f "tools/capture-harness/scenes/$SCENE/.baked/scene.json" ]]; then
  "${HARNESS[@]}" bake --scene "$SCENE"
fi

echo "--- :camera: Check the docs screenshots"
# Exits 1 when a shot changed or failed, which is a finding here, not an error.
"${HARNESS[@]}" check docs/user/screenshots/shots \
  --scene "$SCENE" --look docs \
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

echo "--- :robot_face: Update the docs"
: "${ANTHROPIC_API_KEY:?The docs need a refresh, but ANTHROPIC_API_KEY is not set for this job}"
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

if [[ -z "$(git status --porcelain -- docs/user)" ]]; then
  annotate "Docs refresh for $TARGET: the agent reviewed the changes and found the docs current." success
  exit 0
fi

git add docs/user
git commit -m "Refresh the docs for $TARGET"

if [[ "${DOCS_REFRESH_DRY_RUN:-false}" == "true" ]]; then
  git format-patch -1 --stdout > "$OUT/docs-refresh.patch"
  annotate "Docs refresh for $TARGET (dry run): the change is in the \`docs-refresh.patch\` artifact; nothing was pushed."
  exit 0
fi

echo "--- :github: Open the pull request"
git push origin "$DOCS_BRANCH"
pr_url="$(node scripts/docs-refresh/docs-refresh.mjs open-pr \
  --repo Automattic/studio --head "$DOCS_BRANCH" --base "$BASE_BRANCH" \
  --target "$TARGET" --title "Refresh the docs for $TARGET" --out "$OUT")"
annotate "Docs refresh for $TARGET: $pr_url" success
