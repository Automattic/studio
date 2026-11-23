#!/usr/bin/env bash

set -euo pipefail

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :aws: Install AWS CLI for the cache helpers'
apt-get -o Acquire::Retries=3 update
apt-get install -y --no-install-recommends awscli jq

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :eslint: Lint'
# On a PR, lint the files it changes; the merge queue lints everything.
base=$(bash .buildkite/commands/pr-selection-base.sh)
if [ -n "$base" ]; then
  # The folders the workspace `lint` scripts cover, and the files ESLint lints there.
  files=()
  while IFS= read -r file; do files+=("$file"); done < <(
    git diff --name-only --diff-filter=d "$base" HEAD -- \
      apps/cli apps/local apps/mcp-ui/src apps/studio/src apps/studio/e2e apps/ui/src \
      packages/agent packages/blueprints packages/common packages/design-md packages/providers \
      tools/capture-harness scripts |
      grep -E '\.(ts|tsx|js|jsx|mjs|cjs)$|^apps/ui/src/.*\.css$' || true
  )
  if [ ${#files[@]} -eq 0 ]; then
    echo "No changed files to lint"
  else
    echo "Linting the ${#files[@]} changed files; the merge queue lints everything"
    npx eslint --no-warn-ignored "${files[@]}"
  fi
else
  npm run lint
fi

echo '--- :scissors: Unused code'
npm run knip

echo '--- :typescript: Typecheck'
npm run typecheck
