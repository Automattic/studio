#!/usr/bin/env bash
set -euo pipefail

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :node: Build CLI'
npm run cli:build

echo '--- :wordpress: Seed server files'
# Any CLI invocation copies the bundled WordPress into
# ~/.studio/server-files/wordpress-versions/latest, which the e2e harness requires.
node apps/cli/dist/cli/main.mjs site list

echo '--- :vitest: Run CLI E2E Tests'
npm test -- --tagsFilter='e2e'
