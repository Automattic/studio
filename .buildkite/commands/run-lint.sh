#!/usr/bin/env bash

set -euo pipefail

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :eslint: Lint'
npm run lint

echo '--- :typescript: Typecheck'
npm run typecheck

# The data-liberation plugin ships its MCP server and skill-invoked driver
# scripts as committed esbuild bundles (the plugin installer copies the
# package from git verbatim — no npm install, no build). Rebuild them and
# fail if the committed artifacts don't match src/ and scripts/, so they can
# never drift. The build is byte-deterministic for a given lockfile, so a
# clean tree means fresh. Driver chunk files are content-hashed, so drift can
# show up as untracked/deleted files, not just modified ones — check the
# whole dist/ status, not only the diff.
echo '--- :package: Verify data-liberation plugin bundles are fresh'
npm -w data-liberation run build:mcp-bundle
if [[ -n "$(git status --porcelain -- packages/data-liberation-agent/dist)" ]]; then
  git status --porcelain -- packages/data-liberation-agent/dist
  git diff --stat -- packages/data-liberation-agent/dist
  echo "^^^ +++"
  echo "The committed data-liberation plugin bundles are stale. Run 'npm -w data-liberation run build:mcp-bundle' and commit the updated dist/ artifacts."
  exit 1
fi

# Skills invoke drivers as `node scripts/run.mjs <name>`, which in a plugin
# install can only run a committed bundle. A SKILL.md referencing a driver
# missing from SKILL_DRIVERS would fail only at plugin-user runtime — catch
# the drift here instead.
missing_drivers=$(grep -rhoE 'run\.mjs [a-z0-9_-]+' packages/data-liberation-agent/skills packages/data-liberation-agent/commands 2>/dev/null | awk '{print $2}' | sort -u | while read -r name; do
  [[ -f "packages/data-liberation-agent/dist/scripts/${name}.mjs" ]] || echo "$name"
done)
if [[ -n "$missing_drivers" ]]; then
  echo "^^^ +++"
  echo "Skills invoke drivers with no committed bundle: ${missing_drivers}. Add them to SKILL_DRIVERS in packages/data-liberation-agent/scripts/build-mcp-bundle.mjs and rebuild."
  exit 1
fi
