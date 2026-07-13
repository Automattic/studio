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

# The data-liberation plugin ships its MCP server as a committed esbuild
# bundle (the plugin installer copies the package from git verbatim — no
# npm install, no build). Rebuild it and fail if the committed artifact
# doesn't match src/, so the two can never drift. The build is
# byte-deterministic for a given lockfile, so a clean tree means fresh.
echo '--- :package: Verify data-liberation MCP bundle is fresh'
npm -w data-liberation run build:mcp-bundle
if ! git diff --exit-code -- packages/data-liberation-agent/dist/mcp-server.bundle.mjs; then
  echo "^^^ +++"
  echo "The committed data-liberation MCP bundle is stale. Run 'npm -w data-liberation run build:mcp-bundle' and commit the updated bundle."
  exit 1
fi
